"""Builds every IMPACTBOX model procedurally and exports assets/models.glb.

Run inside Blender with models/impactbox-models.blend open (Scripting tab > Run Script).
Conventions: metres, Z up, +Y is "forward" (becomes -Z in three.js after glTF export).
Each model is one object whose origin is the point the game attaches it by:
  - character parts: centre of the physics collider
  - weapons: roughly the grip
  - props: centre of the collider
Material names are part of the contract: the game re-tints Skin / Shirt / Pants per NPC.
The game has an environment map, so metals can be properly metallic.
"""
import bpy
import bmesh
import math
import os
from math import pi, sin, cos, radians
from mathutils import Matrix, Euler, Vector

assert bpy.data.filepath.endswith("impactbox-models.blend"), "open models/impactbox-models.blend first"
ROOT = os.path.dirname(os.path.dirname(bpy.data.filepath))

# ------------------------------------------------------------------ reset (idempotent)
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for b in list(block):
        block.remove(b)
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


# ------------------------------------------------------------------ materials
def material(name, color, rough=0.6, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emit
    m.diffuse_color = (*color, 1)
    return m


Skin = material('Skin', (0.78, 0.55, 0.42), 0.55)
Shirt = material('Shirt', (0.42, 0.10, 0.09), 0.85)
Pants = material('Pants', (0.09, 0.11, 0.17), 0.9)
Hair = material('Hair', (0.05, 0.035, 0.025), 0.85)
Shoe = material('Shoe', (0.05, 0.045, 0.04), 0.55)
Sole = material('Sole', (0.2, 0.2, 0.19), 0.9)
Belt = material('Belt', (0.07, 0.045, 0.03), 0.5)
EyeWhite = material('EyeWhite', (0.85, 0.84, 0.80), 0.25)
EyeDark = material('EyeDark', (0.06, 0.035, 0.02), 0.15)
Lip = material('Lip', (0.52, 0.27, 0.24), 0.5)

Gunmetal = material('Gunmetal', (0.13, 0.135, 0.15), 0.42, 0.85)
Polymer = material('Polymer', (0.035, 0.035, 0.04), 0.7)
Steel = material('Steel', (0.62, 0.64, 0.67), 0.28, 0.95)
Bore = material('Bore', (0.01, 0.01, 0.01), 0.9)
Brass = material('Brass', (0.72, 0.52, 0.2), 0.35, 0.9)
Wood = material('Wood', (0.30, 0.15, 0.06), 0.55)
GrenadeBody = material('GrenadeBody', (0.13, 0.19, 0.10), 0.65, 0.2)
GrenadeDark = material('GrenadeDark', (0.06, 0.09, 0.05), 0.8)
GrabBody = material('GrabBody', (0.14, 0.19, 0.30), 0.45, 0.5)
GlowCyan = material('GlowCyan', (0.25, 0.80, 1.0), 0.3, 0.0, emit=3.0)

Glove = material('Glove', (0.045, 0.045, 0.05), 0.8)
GlovePad = material('GlovePad', (0.10, 0.10, 0.105), 0.6)
Sleeve = material('Sleeve', (0.17, 0.20, 0.13), 0.9)

CrateWood = material('CrateWood', (0.50, 0.33, 0.16), 0.85)
CrateFrame = material('CrateFrame', (0.30, 0.18, 0.08), 0.85)
BarrelBlue = material('BarrelBlue', (0.08, 0.20, 0.42), 0.45, 0.6)
BarrelRed = material('BarrelRed', (0.52, 0.06, 0.05), 0.45, 0.6)
BarrelRim = material('BarrelRim', (0.2, 0.21, 0.23), 0.45, 0.8)
Hazard = material('Hazard', (0.85, 0.62, 0.03), 0.6)
Concrete = material('Concrete', (0.40, 0.41, 0.42), 0.95)
ConcreteDark = material('ConcreteDark', (0.30, 0.31, 0.32), 0.95)


def xf(loc=(0, 0, 0), rot=(0, 0, 0)):
    return Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4()


AXIS_Y = (pi / 2, 0, 0)   # rotate a Z-axis primitive so it lies along Y
AXIS_X = (0, pi / 2, 0)   # ... along X


# ------------------------------------------------------------------ mesh builder
class Model:
    """Accumulates primitives into one mesh with per-face materials."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _paint(self, verts, m):
        idx = self._mi(m)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = idx
            f.smooth = True

    def _bevel(self, edges, amount, m, seg=2):
        if amount <= 0 or not edges:
            return
        r = bmesh.ops.bevel(self.bm, geom=list(edges), offset=amount, offset_type='OFFSET',
                            segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)
        idx = self._mi(m)
        for f in r['faces']:
            f.material_index = idx
            f.smooth = True

    def box(self, size, loc, m, rot=(0, 0, 0), bevel=0.0, taper=(1, 1), seg=2):
        """taper = (x, y) scale applied to the top (+Z) face."""
        verts = bmesh.ops.create_cube(self.bm, size=1.0)['verts']
        for v in verts:
            top = v.co.z > 0
            v.co.x *= size[0] * (taper[0] if top else 1)
            v.co.y *= size[1] * (taper[1] if top else 1)
            v.co.z *= size[2]
        bmesh.ops.transform(self.bm, matrix=xf(loc, rot), verts=verts)
        self._paint(verts, m)
        self._bevel({e for v in verts for e in v.link_edges}, bevel, m, seg)
        return self

    def cyl(self, r, depth, loc, m, rot=(0, 0, 0), r2=None, seg=16, bevel=0.0):
        """Z-axis cylinder / cone. r = bottom radius, r2 = top radius."""
        verts = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg,
                                      radius1=r, radius2=r if r2 is None else r2, depth=depth)['verts']
        rim = {e for v in verts for e in v.link_edges if (e.verts[0].co.z > 0) == (e.verts[1].co.z > 0)}
        bmesh.ops.transform(self.bm, matrix=xf(loc, rot), verts=verts)
        self._paint(verts, m)
        self._bevel(rim, bevel, m)
        return self

    def sphere(self, r, loc, m, scale=(1, 1, 1), rot=(0, 0, 0), seg=16, rings=10, keep=None, warp=None):
        """keep = optional predicate on the unscaled vertex position; other verts are deleted.
        warp = optional function that reshapes each vertex position in place (sculpting)."""
        verts = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r)['verts']
        if keep:
            drop = [v for v in verts if not keep(v.co)]
            verts = [v for v in verts if keep(v.co)]
            bmesh.ops.delete(self.bm, geom=drop, context='VERTS')
        for v in verts:
            if warp:
                warp(v.co)
            v.co.x *= scale[0]; v.co.y *= scale[1]; v.co.z *= scale[2]
        bmesh.ops.transform(self.bm, matrix=xf(loc, rot), verts=verts)
        self._paint(verts, m)
        return self

    def capsule(self, r, h, loc, m, rot=(0, 0, 0), seg=14, taper_bottom=1.0, taper_top=1.0, rings=9):
        """Z-axis capsule, h = half length of the straight section (matches Rapier's capsule)."""
        verts = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r)['verts']
        for v in verts:
            if v.co.z > 0:
                v.co.x *= taper_top; v.co.y *= taper_top
                v.co.z = v.co.z * taper_top + h
            else:
                v.co.x *= taper_bottom; v.co.y *= taper_bottom
                v.co.z = v.co.z * taper_bottom - h
        bmesh.ops.transform(self.bm, matrix=xf(loc, rot), verts=verts)
        self._paint(verts, m)
        return self

    def limb(self, p0, p1, r, m, r2=None, seg=8, rings=5):
        """Capsule between two points; r2 = radius at the p1 end."""
        a, b = Vector(p0), Vector(p1)
        d = b - a
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
        return self.capsule(r, d.length / 2, (a + b) / 2, m, rot=rot, seg=seg, rings=rings,
                            taper_top=(r2 / r) if r2 else 1.0)

    def chain(self, pts, r, m, seg=6):
        """A bent finger: capsules joined end to end."""
        for a, b in zip(pts, pts[1:]):
            self.limb(a, b, r, m, seg=seg)
        return self

    def loft(self, rings, loc, m, rot=(0, 0, 0), seg=14):
        """Skin a stack of ellipses along Z. Each ring is (z, rx, ry[, cx, cy]); ends are capped.
        This is what gives limbs and torsos an anatomical profile instead of a tube."""
        bm = self.bm
        loops = []
        for ring in rings:
            z, rx, ry = ring[:3]
            cx = ring[3] if len(ring) > 3 else 0.0
            cy = ring[4] if len(ring) > 4 else 0.0
            loops.append([bm.verts.new((cx + rx * cos(2 * pi * i / seg), cy + ry * sin(2 * pi * i / seg), z))
                          for i in range(seg)])
        for a, b in zip(loops, loops[1:]):
            for i in range(seg):
                bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
        bm.faces.new(loops[0])
        bm.faces.new(loops[-1])
        verts = [v for l in loops for v in l]
        bmesh.ops.transform(bm, matrix=xf(loc, rot), verts=verts)
        self._paint(verts, m)
        return self

    def torus(self, R, r, loc, m, rot=(0, 0, 0), seg=20, sub=8):
        bm = self.bm
        rings = []
        for i in range(seg):
            a = 2 * pi * i / seg
            rings.append([bm.verts.new(((R + r * cos(2 * pi * j / sub)) * cos(a),
                                        (R + r * cos(2 * pi * j / sub)) * sin(a),
                                        r * sin(2 * pi * j / sub))) for j in range(sub)])
        for i in range(seg):
            for j in range(sub):
                bm.faces.new((rings[i][j], rings[(i + 1) % seg][j],
                              rings[(i + 1) % seg][(j + 1) % sub], rings[i][(j + 1) % sub]))
        verts = [v for ring in rings for v in ring]
        bmesh.ops.transform(bm, matrix=xf(loc, rot), verts=verts)
        self._paint(verts, m)
        return self

    def prism(self, pts, thick, loc, m, rot=(0, 0, 0), bevel=0.0):
        """Extrude a (y, z) outline along X by `thick`, centred."""
        bm = self.bm
        a = [bm.verts.new((-thick / 2, y, z)) for y, z in pts]
        b = [bm.verts.new((thick / 2, y, z)) for y, z in pts]
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
        n = len(pts)
        for i in range(n):
            bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
        verts = a + b
        bmesh.ops.transform(bm, matrix=xf(loc, rot), verts=verts)
        self._paint(verts, m)
        for f in {f for v in verts for f in v.link_faces}:
            f.smooth = False
        self._bevel({e for v in verts for e in v.link_edges}, bevel, m, 1)
        return self

    def finish(self, coll, loc=(0, 0, 0)):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        me.set_sharp_from_angle(angle=radians(42))
        ob = bpy.data.objects.new(self.name, me)
        ob.location = loc
        coll.objects.link(ob)
        return ob


# ================================================================== CHARACTER
# Part centres in character space (x, forward, up) - same numbers as PARTS in ragdoll.js.
CHAR_AT = (-3.0, 0.0, 0.0)
POSE = {
    'Pelvis': (0, 0, 1.00), 'Torso': (0, 0, 1.33), 'Head': (0, 0, 1.70),
    'UpperArm': (0.25, 0, 1.33), 'Forearm': (0.25, 0, 1.005),
    'Thigh': (0.10, 0, 0.705), 'Shin': (0.10, 0, 0.23),
}
char = collection('Character')


def at(name):
    p = POSE[name]
    return (CHAR_AT[0] + p[0], CHAR_AT[1] + p[1], CHAR_AT[2] + p[2])


def head_shape(c, k=1.0):
    """Sculpt a sphere (r = 0.1) into a skull: narrow, tall, tapering jaw, flat face."""
    x, y, z = c.x * 0.80, c.y, c.z * 1.2
    if z < 0:
        t = min(1.0, -z / 0.12)
        x *= 1 - 0.30 * t * t                                # jaw narrows toward the chin
        y *= (1 - 0.30 * t) if y < 0 else (1 - 0.05 * t)     # back of the skull tucks into the neck
    if y > 0.062:
        y = 0.062 + (y - 0.062) * 0.55                       # the face is flatter than the back of the head
    c.x, c.y, c.z = x * k, y * k, z * k


m = Model('Head')
m.sphere(0.1, (0, 0, 0), Skin, seg=24, rings=18, warp=head_shape)
m.sphere(0.1, (0, -0.004, 0.004), Hair, seg=24, rings=18, warp=lambda c: head_shape(c, 1.07),
         keep=lambda c: c.z > 0.05 + max(0.0, c.y) * 0.22 or (c.y < 0.01 and c.z > -0.03) or (c.y < -0.04 and c.z > -0.06))
for sx in (-1, 1):
    m.sphere(0.0125, (sx * 0.032, 0.0665, 0.02), EyeWhite, seg=12, rings=8)
    m.sphere(0.0065, (sx * 0.032, 0.0745, 0.02), EyeDark, seg=10, rings=6)
    m.sphere(0.0145, (sx * 0.032, 0.0685, 0.0275), Skin, scale=(1.15, 0.8, 0.5), seg=10, rings=6)       # upper lid
    m.box((0.034, 0.008, 0.006), (sx * 0.033, 0.079, 0.04), Hair, rot=(0, sx * 0.12, 0), bevel=0.002)  # brow
    m.sphere(0.02, (sx * 0.081, -0.006, 0.0), Skin, scale=(0.35, 0.8, 1.25), seg=8, rings=6)           # ear
    m.sphere(0.009, (sx * 0.011, 0.085, -0.028), Skin, seg=8, rings=6)                                 # nostril wing
m.prism([(0.074, 0.024), (0.075, -0.032), (0.101, -0.027), (0.097, -0.018)], 0.019, (0, 0, 0), Skin, bevel=0.004)  # nose
m.sphere(0.01, (0, 0.073, -0.054), Lip, scale=(2.3, 0.8, 0.42), seg=10, rings=6)
m.sphere(0.01, (0, 0.072, -0.063), Lip, scale=(2.0, 0.8, 0.5), seg=10, rings=6)
m.loft([(-0.17, 0.047, 0.05), (-0.09, 0.044, 0.047, 0, -0.006)], (0, -0.004, 0), Skin, seg=12)         # neck
m.finish(char, at('Head'))

m = Model('Torso')
m.loft([(-0.235, 0.132, 0.092), (-0.15, 0.138, 0.098), (-0.05, 0.152, 0.108, 0, 0.004),
        (0.05, 0.170, 0.116, 0, 0.008), (0.13, 0.182, 0.112, 0, 0.004), (0.185, 0.176, 0.098),
        (0.222, 0.115, 0.078), (0.238, 0.062, 0.062)], (0, 0, 0), Shirt, seg=20)
for sx in (-1, 1):
    m.sphere(0.07, (sx * 0.195, 0, 0.162), Shirt, scale=(1, 0.95, 1.05), seg=12, rings=8)             # deltoids
m.loft([(0.225, 0.05, 0.052), (0.262, 0.047, 0.05)], (0, -0.002, 0), Skin, seg=12)                   # neck base
m.torus(0.058, 0.01, (0, -0.002, 0.236), Shirt, seg=18, sub=6)                                        # collar
m.box((0.075, 0.006, 0.07), (0.085, 0.108, 0.07), Shirt, bevel=0.002)                                 # chest pocket
m.finish(char, at('Torso'))

m = Model('Pelvis')
m.loft([(-0.13, 0.11, 0.08), (-0.1, 0.176, 0.098), (-0.04, 0.18, 0.105), (0.02, 0.17, 0.106), (0.092, 0.14, 0.096)],
       (0, 0, 0), Pants, seg=18)
m.loft([(0.052, 0.156, 0.106), (0.094, 0.146, 0.101)], (0, 0, 0), Belt, seg=18)
m.box((0.045, 0.012, 0.034), (0, 0.103, 0.073), Steel, bevel=0.004)                                   # buckle
m.finish(char, at('Pelvis'))

m = Model('UpperArm')
m.loft([(-0.172, 0.036, 0.037), (-0.1, 0.04, 0.043), (0.02, 0.046, 0.052, 0, 0.004), (0.12, 0.05, 0.054),
        (0.172, 0.044, 0.046)], (0, 0, 0), Skin, seg=12)
m.sphere(0.038, (0, 0, -0.168), Skin, seg=10, rings=8)                                                # elbow
m.loft([(-0.03, 0.05, 0.056, 0, 0.004), (0.06, 0.052, 0.058), (0.14, 0.054, 0.058), (0.18, 0.048, 0.05)],
       (0, 0, 0), Shirt, seg=12)                                                                      # sleeve
m.torus(0.052, 0.005, (0, 0.004, -0.03), Shirt, seg=14, sub=5)
m.finish(char, at('UpperArm'))

m = Model('Forearm')
m.loft([(-0.152, 0.025, 0.029), (-0.1, 0.029, 0.032), (0.0, 0.038, 0.041), (0.09, 0.043, 0.046),
        (0.155, 0.037, 0.038)], (0, 0, 0), Skin, seg=12)
m.box((0.03, 0.07, 0.085), (0, 0.004, -0.2), Skin, bevel=0.013, taper=(1, 0.8))                       # palm
for i, y in enumerate((-0.024, -0.008, 0.008, 0.024)):                                               # fingers, slightly curled
    m.chain([(0.0, y, -0.24), (0.006, y, -0.275), (0.016, y, -0.3 + abs(i - 1.5) * 0.006)], 0.0085, Skin)
m.chain([(0.004, 0.036, -0.185), (0.01, 0.052, -0.22), (0.014, 0.055, -0.245)], 0.0105, Skin)          # thumb
m.finish(char, at('Forearm'))

m = Model('Thigh')
m.loft([(-0.244, 0.055, 0.058), (-0.15, 0.062, 0.067), (0.0, 0.076, 0.082, 0, 0.004), (0.15, 0.086, 0.09),
        (0.246, 0.08, 0.084)], (0, 0, 0), Pants, seg=14)
m.sphere(0.056, (0, 0.004, -0.242), Pants, seg=10, rings=8)                                           # knee
m.finish(char, at('Thigh'))

m = Model('Shin')
m.loft([(-0.19, 0.039, 0.042), (-0.13, 0.041, 0.044), (0.0, 0.05, 0.055, 0, -0.004),
        (0.12, 0.057, 0.064, 0, -0.008), (0.232, 0.054, 0.056)], (0, 0, 0), Pants, seg=14)
m.torus(0.041, 0.006, (0, 0, -0.188), Pants, seg=14, sub=5)                                           # trouser hem
m.cyl(0.044, 0.05, (0, -0.004, -0.178), Shoe, seg=12, bevel=0.006)                                    # ankle collar
m.box((0.09, 0.2, 0.062), (0, 0.035, -0.203), Shoe, bevel=0.024, taper=(0.8, 0.9), seg=3)             # upper
m.sphere(0.047, (0, 0.125, -0.208), Shoe, scale=(0.98, 1.2, 0.62), seg=12, rings=8)                   # toe box
m.box((0.098, 0.262, 0.022), (0, 0.045, -0.237), Sole, bevel=0.007)
m.box((0.09, 0.07, 0.014), (0, -0.045, -0.228), Sole, bevel=0.004)                                    # heel
for i in range(4):
    m.box((0.05, 0.007, 0.006), (0, 0.045 + i * 0.022, -0.172 - i * 0.004), Sole, rot=(0.25, 0, 0))   # laces
m.finish(char, at('Shin'))

# mirrored copies so the Blender scene shows a whole person (not exported)
preview = collection('CharacterPreview')
for name in ('UpperArm', 'Forearm', 'Thigh', 'Shin'):
    src = bpy.data.objects[name]
    dup = bpy.data.objects.new(name + '_previewR', src.data)
    p = POSE[name]
    dup.location = (CHAR_AT[0] - p[0], CHAR_AT[1] + p[1], CHAR_AT[2] + p[2])
    preview.objects.link(dup)

# ================================================================== WEAPONS
weapons = collection('Weapons')
WZ = 1.0  # display height

# Sights are real: a rear notch and a front post on the centre line, so aiming down them works.
m = Model('Pistol')
m.box((0.028, 0.19, 0.03), (0, 0.01, 0.03), Gunmetal, bevel=0.005)                              # slide
m.box((0.0285, 0.04, 0.014), (0, 0.02, 0.038), Steel, bevel=0.002)                              # ejection port
for i in range(6):
    m.box((0.0295, 0.0035, 0.022), (0, -0.04 - i * 0.007, 0.031), Polymer)                      # serrations
m.box((0.026, 0.165, 0.02), (0, 0.0, 0.006), Polymer, bevel=0.003)                              # frame
m.box((0.02, 0.06, 0.01), (0, 0.065, -0.006), Polymer, bevel=0.002)                             # accessory rail
for i in range(3):
    m.box((0.022, 0.006, 0.004), (0, 0.048 + i * 0.016, -0.011), Polymer)
m.cyl(0.0078, 0.016, (0, 0.108, 0.031), Steel, rot=AXIS_Y, seg=12)                              # barrel
m.cyl(0.0048, 0.017, (0, 0.109, 0.031), Bore, rot=AXIS_Y, seg=10)
m.box((0.027, 0.046, 0.105), (0, -0.058, -0.046), Polymer, rot=(-0.25, 0, 0), bevel=0.008)      # grip
m.box((0.029, 0.05, 0.012), (0, -0.074, -0.1), Polymer, rot=(-0.25, 0, 0), bevel=0.003)         # magazine baseplate
m.box((0.008, 0.055, 0.006), (0, 0.004, -0.036), Polymer, bevel=0.002)                          # trigger guard
m.box((0.008, 0.006, 0.032), (0, 0.031, -0.021), Polymer, bevel=0.002)
m.box((0.006, 0.006, 0.022), (0, 0.004, -0.017), Steel, rot=(0.3, 0, 0))                        # trigger
m.box((0.0305, 0.022, 0.005), (0, -0.01, 0.016), Steel, bevel=0.001)                            # slide stop
m.box((0.0035, 0.006, 0.008), (0, 0.097, 0.049), Polymer)                                       # front post
for sx in (-1, 1):
    m.box((0.006, 0.007, 0.008), (sx * 0.0068, -0.078, 0.049), Polymer)                         # rear notch
m.finish(weapons, (0.0, -1.5, WZ))

m = Model('Shotgun')
m.box((0.045, 0.2, 0.066), (0, 0, 0), Gunmetal, bevel=0.009)                                    # receiver
m.box((0.046, 0.06, 0.02), (0, 0.02, 0.012), Bore, bevel=0.002)                                 # ejection port
m.cyl(0.013, 0.52, (0, 0.36, 0.016), Gunmetal, rot=AXIS_Y, seg=14)                              # barrel
m.cyl(0.0105, 0.01, (0, 0.6205, 0.016), Bore, rot=AXIS_Y, seg=12)
m.cyl(0.012, 0.42, (0, 0.31, -0.014), Gunmetal, rot=AXIS_Y, seg=12)                             # magazine tube
m.cyl(0.014, 0.02, (0, 0.525, -0.014), Steel, rot=AXIS_Y, seg=12, bevel=0.003)                  # tube cap
m.cyl(0.025, 0.17, (0, 0.27, -0.014), Wood, rot=AXIS_Y, seg=12, bevel=0.005)                    # pump
for i in range(6):
    m.torus(0.025, 0.003, (0, 0.205 + i * 0.026, -0.014), Wood, rot=AXIS_Y, seg=12, sub=4)      # pump grooves
m.box((0.03, 0.012, 0.045), (0, 0.5, 0.001), Gunmetal, bevel=0.003)                             # barrel band
m.box((0.01, 0.5, 0.004), (0, 0.36, 0.031), Gunmetal)                                           # sighting rib
m.sphere(0.0045, (0, 0.6, 0.038), Brass, seg=8, rings=6)                                        # bead sight
m.prism([(-0.095, 0.032), (-0.095, -0.032), (-0.17, -0.05), (-0.42, -0.105), (-0.43, -0.1),
         (-0.43, 0.01), (-0.24, 0.03)], 0.04, (0, 0, 0), Wood, bevel=0.008)                     # stock
m.box((0.042, 0.02, 0.118), (0, -0.44, -0.046), Polymer, rot=(-0.06, 0, 0), bevel=0.006)        # recoil pad
m.box((0.008, 0.06, 0.006), (0, -0.04, -0.05), Gunmetal, bevel=0.002)                           # trigger guard
m.box((0.008, 0.006, 0.02), (0, -0.012, -0.042), Gunmetal, bevel=0.002)
m.box((0.006, 0.006, 0.02), (0, -0.04, -0.04), Steel, rot=(0.3, 0, 0))
m.finish(weapons, (0.5, -1.5, WZ))

m = Model('Rifle')
m.box((0.045, 0.27, 0.06), (0, 0, 0), Gunmetal, bevel=0.006)                                    # receiver
m.box((0.04, 0.21, 0.022), (0, -0.015, 0.038), Gunmetal, bevel=0.01)                            # dust cover
for i in range(3):
    m.box((0.041, 0.006, 0.02), (0, -0.07 + i * 0.06, 0.039), Gunmetal, bevel=0.002)            # cover ribs
m.box((0.047, 0.2, 0.05), (0, 0.235, -0.002), Wood, bevel=0.014)                                # lower handguard
m.box((0.036, 0.17, 0.022), (0, 0.235, 0.034), Wood, bevel=0.009)                               # upper handguard
m.cyl(0.009, 0.3, (0, 0.47, 0.006), Gunmetal, rot=AXIS_Y, seg=12)                               # barrel
m.cyl(0.008, 0.2, (0, 0.24, 0.036), Gunmetal, rot=AXIS_Y, seg=10)                               # gas tube
m.box((0.02, 0.035, 0.05), (0, 0.345, 0.022), Gunmetal, bevel=0.004)                            # gas block
m.cyl(0.0035, 0.25, (0, 0.47, -0.012), Steel, rot=AXIS_Y, seg=6)                                # cleaning rod
m.box((0.014, 0.022, 0.048), (0, 0.55, 0.03), Gunmetal, bevel=0.003)                            # front sight base
m.box((0.003, 0.004, 0.014), (0, 0.55, 0.061), Gunmetal)                                        # front post
for sx in (-1, 1):
    m.box((0.003, 0.02, 0.022), (sx * 0.009, 0.55, 0.062), Gunmetal, bevel=0.001)               # sight ears
    m.box((0.005, 0.008, 0.01), (sx * 0.006, 0.11, 0.063), Gunmetal)                            # rear notch
m.box((0.02, 0.05, 0.012), (0, 0.12, 0.053), Gunmetal, bevel=0.003)                             # rear sight leaf
m.cyl(0.013, 0.05, (0, 0.635, 0.006), Gunmetal, rot=AXIS_Y, seg=10, bevel=0.003)                # muzzle brake
m.cyl(0.0065, 0.052, (0, 0.636, 0.006), Bore, rot=AXIS_Y, seg=10)
m.prism([(0.025, -0.028), (0.09, -0.028), (0.125, -0.12), (0.15, -0.205), (0.092, -0.222),
         (0.066, -0.13)], 0.03, (0, 0, 0), Gunmetal, bevel=0.004)                               # curved magazine
m.box((0.032, 0.042, 0.095), (0, -0.095, -0.072), Wood, rot=(-0.3, 0, 0), bevel=0.01)           # pistol grip
m.box((0.008, 0.07, 0.006), (0, -0.035, -0.055), Gunmetal, bevel=0.002)                         # trigger guard
m.box((0.006, 0.006, 0.022), (0, -0.04, -0.04), Steel, rot=(0.3, 0, 0))
m.prism([(-0.135, 0.026), (-0.135, -0.022), (-0.385, -0.08), (-0.4, -0.075), (-0.4, 0.036),
         (-0.37, 0.042)], 0.036, (0, 0, 0), Wood, bevel=0.007)                                  # stock
m.box((0.04, 0.012, 0.12), (0, -0.405, -0.02), Gunmetal, bevel=0.003)                           # butt plate
m.box((0.01, 0.03, 0.012), (0.027, 0.04, 0.02), Steel, bevel=0.003)                             # charging handle
m.box((0.004, 0.08, 0.012), (0.0235, -0.03, 0.0), Steel, rot=(0.15, 0, 0), bevel=0.001)         # selector lever
m.finish(weapons, (1.0, -1.5, WZ))

m = Model('Machete')
m.box((0.028, 0.15, 0.036), (0, 0, 0), Wood, bevel=0.011)                                       # handle
for y in (-0.045, 0.0, 0.045):
    m.cyl(0.005, 0.031, (0, y, 0), Brass, rot=AXIS_X, seg=8)                                    # rivets
m.box((0.034, 0.014, 0.062), (0, 0.08, 0), Gunmetal, bevel=0.004)                               # guard
m.prism([(0.085, 0.02), (0.085, -0.022), (0.3, -0.04), (0.47, -0.05), (0.57, -0.038), (0.63, 0.0),
         (0.61, 0.03), (0.4, 0.027)], 0.005, (0, 0, 0), Steel)                                  # blade
m.finish(weapons, (1.5, -1.5, WZ))

m = Model('Grenade')
m.sphere(0.05, (0, 0, 0), GrenadeBody, scale=(1, 1, 1.2), seg=16, rings=12)
for z in (-0.03, 0.0, 0.03):
    R = 0.05 * math.sqrt(1 - (z / 0.06) ** 2)
    m.torus(R, 0.0045, (0, 0, z), GrenadeDark, seg=16, sub=6)                                    # horizontal grooves
for i in range(8):
    a = i * pi / 4
    m.torus(0.05, 0.004, (0, 0, 0), GrenadeDark, rot=(pi / 2, 0, a), seg=14, sub=4)              # vertical grooves
m.cyl(0.019, 0.022, (0, 0, 0.064), Steel, seg=12, bevel=0.003)
m.cyl(0.013, 0.026, (0, 0, 0.086), Steel, seg=10, bevel=0.002)                                  # fuse
m.box((0.016, 0.045, 0.004), (0, 0.012, 0.101), Steel, bevel=0.001)                             # lever top
m.box((0.016, 0.004, 0.085), (0, 0.047, 0.058), Steel, rot=(-0.33, 0, 0), bevel=0.001)          # lever side
m.torus(0.016, 0.0025, (0.03, 0, 0.088), Steel, rot=AXIS_Y, seg=14, sub=5)                      # pin ring
m.finish(weapons, (2.0, -1.5, WZ))

m = Model('GrabGun')
m.box((0.07, 0.3, 0.08), (0, -0.02, 0), GrabBody, bevel=0.016, seg=3)                           # body
m.cyl(0.028, 0.22, (0, 0.21, 0.005), Gunmetal, rot=AXIS_Y, seg=14)                              # barrel
for y in (0.15, 0.20, 0.25):
    m.torus(0.034, 0.008, (0, y, 0.005), Brass, rot=AXIS_Y, seg=16, sub=6)                      # coils
for k in range(3):
    a = pi / 2 + k * 2 * pi / 3
    m.box((0.022, 0.13, 0.012), (cos(a) * 0.042, 0.35, 0.005 + sin(a) * 0.042), GrabBody,
          rot=(0, -(a - pi / 2), 0), bevel=0.004)                                               # emitter prongs
m.sphere(0.027, (0, 0.345, 0.005), GlowCyan, seg=12, rings=8)                                   # core
m.cyl(0.022, 0.15, (0, -0.04, 0.058), Steel, rot=AXIS_Y, seg=12, bevel=0.005)                   # tank
for sx in (-1, 1):
    m.box((0.004, 0.2, 0.01), (sx * 0.0355, -0.02, 0.008), GlowCyan)                            # glow strips
m.box((0.04, 0.05, 0.115), (0, -0.1, -0.088), Polymer, rot=(-0.25, 0, 0), bevel=0.011)          # handle
m.box((0.008, 0.06, 0.006), (0, -0.035, -0.06), Polymer, bevel=0.002)
m.finish(weapons, (2.5, -1.5, WZ))

# ================================================================== FIRST-PERSON HANDS
# Gloved hands with a sleeve. HandR is a fist around a vertical grip at its origin (index finger
# straight along the frame). HandL is an open hand cupping something from below at its origin.
# Forearms run back and down, toward where the player's shoulders would be.
hands = collection('Hands')

m = Model('HandR')
for i, z in enumerate((-0.012, -0.034, -0.055)):                                                 # three fingers round the grip
    m.chain([(0.03, -0.022, z), (0.027, 0.026, z), (-0.012, 0.034, z - 0.002), (-0.026, 0.012, z - 0.003)],
            0.0105 - i * 0.0005, Glove)
m.chain([(0.03, -0.02, 0.012), (0.026, 0.03, 0.014), (0.02, 0.068, 0.012)], 0.0098, Glove)         # index finger
m.chain([(0.012, -0.045, 0.012), (-0.02, -0.03, 0.016), (-0.026, 0.02, 0.014)], 0.0115, Glove)     # thumb
m.box((0.034, 0.07, 0.092), (0.03, -0.035, -0.024), Glove, rot=(0, 0, 0.25), bevel=0.013)          # back of the hand
m.box((0.012, 0.05, 0.062), (0.05, -0.028, -0.02), GlovePad, rot=(0, 0, 0.25), bevel=0.004)        # knuckle guard
W, E = Vector((0.036, -0.075, -0.03)), Vector((0.19, -0.68, -0.3))
m.limb(W, W.lerp(E, 0.13), 0.034, Glove, r2=0.038)                                               # glove cuff
m.limb(W.lerp(E, 0.09), E, 0.041, Sleeve, r2=0.055, seg=10)                                      # sleeve
m.finish(hands, (0.0, -2.6, WZ))

m = Model('HandL')
m.box((0.075, 0.095, 0.03), (0, 0, -0.022), Glove, bevel=0.012)                                  # palm
m.box((0.05, 0.06, 0.008), (0, 0, -0.04), GlovePad, bevel=0.003)
for i, y in enumerate((-0.033, -0.011, 0.011, 0.033)):                                          # fingers up the far side
    m.chain([(0.03, y, -0.02), (0.044, y, 0.004), (0.04, y + 0.003, 0.03), (0.026, y + 0.004, 0.043)], 0.0102, Glove)
m.chain([(-0.03, -0.02, -0.02), (-0.044, 0.0, 0.004), (-0.04, 0.02, 0.03)], 0.0115, Glove)         # thumb
W, E = Vector((-0.02, -0.06, -0.03)), Vector((-0.3, -0.62, -0.3))
m.limb(W, W.lerp(E, 0.13), 0.034, Glove, r2=0.038)
m.limb(W.lerp(E, 0.09), E, 0.041, Sleeve, r2=0.055, seg=10)
m.finish(hands, (0.6, -2.6, WZ))

# ================================================================== PROPS
props = collection('Props')

m = Model('Crate')
m.box((0.55, 0.55, 0.55), (0, 0, 0), CrateWood)
e = 0.27
for a in (-1, 1):
    for b in (-1, 1):
        m.box((0.6, 0.06, 0.06), (0, a * e, b * e), CrateFrame, bevel=0.006)
        m.box((0.06, 0.6, 0.06), (a * e, 0, b * e), CrateFrame, bevel=0.006)
        m.box((0.06, 0.06, 0.6), (a * e, b * e, 0), CrateFrame, bevel=0.006)
for s in (-1, 1):
    m.box((0.02, 0.055, 0.69), (s * 0.282, 0, 0), CrateFrame, rot=(pi / 4, 0, 0), bevel=0.004)
    m.box((0.055, 0.02, 0.69), (0, s * 0.282, 0), CrateFrame, rot=(0, pi / 4, 0), bevel=0.004)
    m.box((0.69, 0.055, 0.02), (0, 0, s * 0.282), CrateFrame, rot=(0, 0, pi / 4), bevel=0.004)
m.finish(props, (0.0, 0, 0.3))


def barrel(name, paint, band=None):
    b = Model(name)
    b.cyl(0.288, 0.9, (0, 0, 0), paint, seg=28, bevel=0.012)
    for z in (-0.16, 0.16):
        b.torus(0.288, 0.013, (0, 0, z), paint, seg=28, sub=6)                                  # ribs
    for z in (-0.44, 0.44):
        b.torus(0.288, 0.012, (0, 0, z), BarrelRim, seg=28, sub=6)                              # rims
    b.cyl(0.25, 0.012, (0, 0, 0.449), BarrelRim, seg=24)                                        # lid
    b.cyl(0.03, 0.02, (0.15, 0, 0.458), BarrelRim, seg=10, bevel=0.003)                         # bung
    if band:
        b.cyl(0.292, 0.2, (0, 0, 0), band, seg=28)
        for k in range(8):
            a = k * pi / 4
            b.box((0.006, 0.07, 0.13), (cos(a) * 0.292, sin(a) * 0.292, 0), paint,
                  rot=(0, 0, a + 0.0), bevel=0.0)                                               # hazard stripes
    return b


barrel('Barrel', BarrelBlue).finish(props, (1.0, 0, 0.45))
barrel('ExplosiveBarrel', BarrelRed, Hazard).finish(props, (2.0, 0, 0.45))

m = Model('Block')
m.box((1.0, 1.0, 1.0), (0, 0, 0), Concrete, bevel=0.05, seg=2)
for s in (-1, 1):
    m.box((0.02, 0.74, 0.74), (s * 0.495, 0, 0), ConcreteDark, bevel=0.006)
    m.box((0.74, 0.02, 0.74), (0, s * 0.495, 0), ConcreteDark, bevel=0.006)
    m.box((0.74, 0.74, 0.02), (0, 0, s * 0.495), ConcreteDark, bevel=0.006)
m.finish(props, (3.3, 0, 0.5))

m = Model('Plank')
m.box((2.2, 0.28, 0.1), (0, 0, 0), CrateWood, bevel=0.012)
for sx in (-1, 1):
    for sy in (-1, 1):
        m.cyl(0.012, 0.012, (sx * 1.0, sy * 0.08, 0.05), Steel, seg=8)                          # nails
    m.box((0.004, 0.28, 0.101), (sx * 0.55, 0, 0), CrateFrame)                                  # grain lines
m.finish(props, (1.5, 1.5, 0.05))

# ================================================================== STAGE (not exported)
stage = collection('Stage')
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 4.0
sun.rotation_euler = (radians(50), 0, radians(30))
stage.objects.link(sun)
fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'SUN'))
fill.data.energy = 1.2
fill.rotation_euler = (radians(60), 0, radians(-140))
stage.objects.link(fill)
cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
stage.objects.link(cam)
bpy.context.scene.camera = cam
world = bpy.context.scene.world or bpy.data.worlds.new('World')
bpy.context.scene.world = world
world.use_nodes = True
bg = next((n for n in world.node_tree.nodes if n.type == 'BACKGROUND'), None)
if bg:
    bg.inputs[0].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs[1].default_value = 0.6

# ================================================================== EXPORT
EXPORT = [o for c in (char, weapons, hands, props) for o in c.objects]
for o in bpy.data.objects:
    o.select_set(o in EXPORT)
bpy.context.view_layer.objects.active = EXPORT[0]
out = os.path.join(ROOT, 'assets', 'models.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
bpy.ops.wm.save_mainfile()

result = {
    'exported': out,
    'bytes': os.path.getsize(out),
    'models': {o.name: {'tris': sum(len(p.vertices) - 2 for p in o.data.polygons),
                        'size': [round(d, 3) for d in o.dimensions]} for o in EXPORT},
}
