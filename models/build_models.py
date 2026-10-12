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
Olive = material('Olive', (0.16, 0.19, 0.11), 0.6, 0.35)
Lens = material('Lens', (0.02, 0.04, 0.07), 0.05, 0.9)

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

m = Model('Revolver')
m.box((0.026, 0.085, 0.05), (0, -0.005, 0.02), Gunmetal, bevel=0.005)                           # frame
m.box((0.02, 0.07, 0.008), (0, 0.0, 0.048), Gunmetal, bevel=0.002)                              # top strap
m.cyl(0.0225, 0.044, (0, 0.002, 0.024), Steel, rot=AXIS_Y, seg=12, bevel=0.003)                 # cylinder
for k in range(6):
    a6 = k * pi / 3
    m.cyl(0.0065, 0.046, (cos(a6) * 0.0235, 0.002, 0.024 + sin(a6) * 0.0235), Bore, rot=AXIS_Y, seg=6)  # flutes
m.cyl(0.0095, 0.15, (0, 0.105, 0.036), Gunmetal, rot=AXIS_Y, seg=12)                            # barrel
m.cyl(0.0058, 0.012, (0, 0.176, 0.036), Bore, rot=AXIS_Y, seg=10)
m.box((0.012, 0.13, 0.014), (0, 0.1, 0.022), Gunmetal, bevel=0.003)                             # ejector shroud
m.box((0.012, 0.14, 0.006), (0, 0.105, 0.048), Gunmetal, bevel=0.001)                           # barrel rib
m.box((0.008, 0.018, 0.022), (0, -0.052, 0.046), Steel, rot=(0.5, 0, 0), bevel=0.002)           # hammer
m.box((0.03, 0.044, 0.105), (0, -0.062, -0.048), Wood, rot=(-0.35, 0, 0), bevel=0.012)          # grip
m.box((0.008, 0.05, 0.006), (0, -0.005, -0.03), Gunmetal, bevel=0.002)                          # trigger guard
m.box((0.008, 0.006, 0.026), (0, 0.02, -0.018), Gunmetal, bevel=0.002)
m.box((0.006, 0.006, 0.02), (0, -0.008, -0.014), Steel, rot=(0.3, 0, 0))                        # trigger
m.box((0.003, 0.012, 0.008), (0, 0.168, 0.054), Gunmetal)                                       # front blade
for sx in (-1, 1):
    m.box((0.006, 0.008, 0.008), (sx * 0.0065, -0.036, 0.054), Gunmetal)                        # rear notch
m.finish(weapons, (3.0, -1.5, WZ))

m = Model('SMG')
m.box((0.04, 0.27, 0.056), (0, 0, 0), Gunmetal, bevel=0.007)                                    # receiver
m.cyl(0.02, 0.2, (0, 0.03, 0.028), Gunmetal, rot=AXIS_Y, seg=12)                                # receiver tube
m.box((0.043, 0.12, 0.048), (0, 0.115, -0.006), Polymer, bevel=0.01)                            # handguard
m.cyl(0.0085, 0.1, (0, 0.21, 0.006), Gunmetal, rot=AXIS_Y, seg=10)                              # barrel
m.cyl(0.0052, 0.012, (0, 0.256, 0.006), Bore, rot=AXIS_Y, seg=8)
m.box((0.026, 0.036, 0.17), (0, 0.035, -0.105), Gunmetal, rot=(0.13, 0, 0), bevel=0.004)        # magazine
m.box((0.03, 0.042, 0.09), (0, -0.07, -0.07), Polymer, rot=(-0.25, 0, 0), bevel=0.009)          # grip
m.box((0.008, 0.06, 0.006), (0, -0.02, -0.05), Polymer, bevel=0.002)                            # trigger guard
m.box((0.006, 0.006, 0.02), (0, -0.03, -0.038), Steel, rot=(0.3, 0, 0))
for sx in (-1, 1):
    m.cyl(0.004, 0.2, (sx * 0.015, -0.23, 0.012), Steel, rot=AXIS_Y, seg=6)                     # stock rods
    m.box((0.003, 0.014, 0.02), (sx * 0.009, 0.17, 0.047), Gunmetal, bevel=0.001)               # front sight ears
    m.box((0.005, 0.008, 0.01), (sx * 0.006, -0.1, 0.046), Gunmetal)                            # rear notch
m.box((0.04, 0.014, 0.1), (0, -0.335, -0.012), Polymer, bevel=0.005)                            # butt plate
m.box((0.003, 0.004, 0.012), (0, 0.17, 0.045), Gunmetal)                                        # front post
m.box((0.008, 0.026, 0.01), (0.024, 0.04, 0.03), Steel, bevel=0.002)                            # cocking handle
m.finish(weapons, (3.5, -1.5, WZ))

m = Model('Sniper')
m.prism([(-0.1, 0.03), (-0.1, -0.03), (-0.2, -0.05), (-0.46, -0.1), (-0.475, -0.095), (-0.475, 0.025),
         (-0.3, 0.04), (-0.2, 0.03)], 0.042, (0, 0, 0), Wood, bevel=0.008)                      # stock
m.box((0.044, 0.02, 0.125), (0, -0.485, -0.036), Polymer, bevel=0.006)                          # recoil pad
m.box((0.044, 0.46, 0.04), (0, 0.13, -0.012), Wood, bevel=0.012)                                # forend
m.cyl(0.02, 0.26, (0, 0.03, 0.02), Gunmetal, rot=AXIS_Y, seg=14)                                # receiver
m.cyl(0.0105, 0.62, (0, 0.46, 0.02), Gunmetal, rot=AXIS_Y, seg=12)                              # barrel
m.cyl(0.015, 0.06, (0, 0.76, 0.02), Gunmetal, rot=AXIS_Y, seg=10, bevel=0.003)                  # muzzle brake
m.cyl(0.0065, 0.062, (0, 0.761, 0.02), Bore, rot=AXIS_Y, seg=8)
m.cyl(0.0055, 0.05, (0.03, -0.06, 0.02), Steel, rot=(0, pi / 2 + 0.5, 0), seg=8)                # bolt handle
m.sphere(0.011, (0.056, -0.06, 0.007), Polymer, seg=8, rings=6)
m.box((0.028, 0.06, 0.05), (0, 0.04, -0.045), Gunmetal, bevel=0.004)                            # magazine
m.box((0.008, 0.06, 0.006), (0, -0.045, -0.04), Gunmetal, bevel=0.002)                          # trigger guard
m.box((0.006, 0.006, 0.02), (0, -0.05, -0.03), Steel, rot=(0.3, 0, 0))
m.cyl(0.0165, 0.2, (0, 0.03, 0.072), Polymer, rot=AXIS_Y, seg=14)                               # scope tube
m.cyl(0.024, 0.07, (0, 0.165, 0.072), Polymer, rot=AXIS_Y, r2=0.0165, seg=14)                   # objective bell
m.cyl(0.0165, 0.05, (0, -0.095, 0.072), Polymer, rot=AXIS_Y, r2=0.021, seg=14)                  # eyepiece
m.cyl(0.021, 0.004, (0, 0.2, 0.072), Lens, rot=AXIS_Y, seg=14)
m.cyl(0.019, 0.004, (0, -0.121, 0.072), Lens, rot=AXIS_Y, seg=14)
m.cyl(0.009, 0.018, (0, 0.03, 0.094), Polymer, seg=10)                                          # elevation turret
m.cyl(0.009, 0.018, (0.022, 0.03, 0.072), Polymer, rot=AXIS_X, seg=10)                          # windage turret
for y in (-0.03, 0.09):
    m.box((0.02, 0.016, 0.03), (0, y, 0.05), Gunmetal, bevel=0.003)                             # scope rings
m.finish(weapons, (4.0, -1.5, WZ))

m = Model('RocketLauncher')
m.cyl(0.04, 0.9, (0, 0.05, 0.06), Olive, rot=AXIS_Y, seg=16)                                    # tube
m.cyl(0.04, 0.14, (0, -0.44, 0.06), Olive, rot=AXIS_Y, r2=0.062, seg=16)                        # rear flare (wide end back)
m.cyl(0.046, 0.26, (0, -0.16, 0.06), Wood, rot=AXIS_Y, seg=16)                                  # heat shield
m.cyl(0.044, 0.03, (0, 0.49, 0.06), Gunmetal, rot=AXIS_Y, seg=16)                               # muzzle ring
m.cyl(0.032, 0.1, (0, 0.55, 0.06), Olive, rot=AXIS_Y, seg=12)                                   # warhead body
m.cyl(0.006, 0.16, (0, 0.67, 0.06), Olive, rot=AXIS_Y, r2=0.05, seg=12)                         # warhead cone
m.cyl(0.05, 0.05, (0, 0.585, 0.06), Olive, rot=AXIS_Y, r2=0.05, seg=12)
m.box((0.03, 0.04, 0.1), (0, 0.0, -0.03), Polymer, rot=(-0.15, 0, 0), bevel=0.009)              # front grip
m.box((0.03, 0.04, 0.09), (0, -0.13, -0.025), Wood, rot=(-0.15, 0, 0), bevel=0.009)             # rear grip
m.box((0.008, 0.05, 0.006), (0, 0.035, -0.015), Gunmetal, bevel=0.002)
m.box((0.006, 0.006, 0.02), (0, 0.025, -0.002), Steel, rot=(0.3, 0, 0))
m.box((0.006, 0.01, 0.05), (0, 0.16, 0.118), Gunmetal, bevel=0.001)                             # front sight
for sx in (-1, 1):
    m.box((0.005, 0.01, 0.03), (sx * 0.007, -0.02, 0.126), Gunmetal)                            # rear notch
m.box((0.02, 0.03, 0.05), (0, -0.02, 0.105), Gunmetal, bevel=0.003)
m.finish(weapons, (4.6, -1.5, WZ))

m = Model('Rocket')                                                                              # the projectile, nose toward +Y
m.cyl(0.03, 0.26, (0, 0, 0), Olive, rot=AXIS_Y, seg=10)
m.cyl(0.006, 0.14, (0, 0.2, 0), Olive, rot=AXIS_Y, r2=0.05, seg=10)
m.cyl(0.05, 0.03, (0, 0.118, 0), Olive, rot=AXIS_Y, seg=10)
for k in range(4):
    a4 = k * pi / 2
    m.box((0.004, 0.09, 0.06), (cos(a4) * 0.05, -0.1, sin(a4) * 0.05), Gunmetal, rot=(0, -a4 + pi / 2, 0))   # fins
m.finish(weapons, (5.1, -1.5, WZ))

m = Model('Knife')                                                                               # handle on the origin, blade toward +Y
m.cyl(0.0155, 0.115, (0, 0, 0), Polymer, rot=AXIS_Y, seg=10, bevel=0.004)                        # handle
for i in range(5):
    m.torus(0.0155, 0.0022, (0, -0.04 + i * 0.02, 0), Polymer, rot=AXIS_Y, seg=10, sub=4)        # grip rings
m.box((0.014, 0.012, 0.056), (0, 0.062, 0), Gunmetal, bevel=0.003)                               # guard
m.cyl(0.017, 0.012, (0, -0.062, 0), Gunmetal, rot=AXIS_Y, seg=10, bevel=0.003)                   # pommel
m.prism([(0.066, 0.018), (0.066, -0.018), (0.2, -0.018), (0.265, -0.004), (0.285, 0.012), (0.24, 0.018)],
        0.0045, (0, 0, 0), Steel)                                                                # blade, edge down
m.box((0.0052, 0.11, 0.005), (0, 0.13, 0.008), Gunmetal)                                         # fuller
m.finish(weapons, (5.5, -1.5, WZ))

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

# The knife hand: a right fist around a handle that points forward (+Y), thumb along the top.
# It has no forearm: the game draws one from WRIST back to the player's elbow as the hand moves.
m = Model('KnifeHand')
for i, y in enumerate((0.03, 0.01, -0.012, -0.034)):                                            # four fingers under and round
    k = 0.78
    m.chain([(0.022 * k, y, -0.03 * k), (-0.026 * k, y, -0.027 * k), (-0.034 * k, y - 0.002, 0.012 * k),
             (-0.012 * k, y - 0.003, 0.028 * k)], 0.0105 - i * 0.0004, Glove)
m.chain([(0.022, -0.022, 0.012), (0.008, 0.02, 0.023), (0.001, 0.047, 0.021)], 0.0115, Glove)      # thumb along the spine
m.box((0.03, 0.09, 0.062), (0.03, -0.004, -0.006), Glove, rot=(0, 0.2, 0), bevel=0.013)            # back of the hand
m.box((0.01, 0.06, 0.045), (0.047, 0.0, -0.004), GlovePad, rot=(0, 0.2, 0), bevel=0.004)           # knuckle guard
m.limb((0.04, -0.06, -0.018), (0.07, -0.16, -0.06), 0.033, Glove, r2=0.038)                       # wrist and cuff
m.finish(hands, (1.2, -2.6, WZ))

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

# ================================================================== LIBRARY: MELEE
# Additional models are assets only. Continue the weapon row in half-metre slots.
m = Model('Axe')
m.loft([(-0.43, 0.019, 0.015), (-0.34, 0.017, 0.014), (-0.1, 0.016, 0.012),
        (0.20, 0.019, 0.013), (0.38, 0.022, 0.015)], (0, 0, 0), Wood, rot=AXIS_Y, seg=10)
m.cyl(0.021, 0.20, (0, 0, 0), Polymer, rot=AXIS_Y, seg=10)                      # grip at origin
for y in (-0.075, -0.025, 0.025, 0.075):
    m.torus(0.021, 0.002, (0, y, 0), Polymer, rot=AXIS_Y, seg=10, sub=4)
m.prism([(0.34, 0.035), (0.35, -0.055), (0.30, -0.135), (0.49, -0.135),
         (0.465, -0.045), (0.46, 0.035), (0.40, 0.15), (0.385, 0.15)],
        0.046, (0, 0, 0), BarrelRed, bevel=0.003)                                # painted head / pick
m.prism([(0.30, -0.135), (0.49, -0.135), (0.51, -0.18), (0.285, -0.18)],
        0.008, (0, 0, 0), Steel)                                                # exposed cutting edge
m.cyl(0.011, 0.048, (0, 0.402, 0.008), Steel, rot=AXIS_X, seg=8)
m.finish(weapons, (6.0, -1.5, WZ))

m = Model('BaseballBat')
m.loft([(-0.70, 0.023, 0.023), (-0.68, 0.032, 0.032), (-0.52, 0.033, 0.033),
        (-0.38, 0.028, 0.028), (-0.20, 0.018, 0.018), (-0.08, 0.014, 0.014),
        (0.12, 0.014, 0.014), (0.14, 0.020, 0.020)], (0, 0, 0), CrateWood, rot=AXIS_Y, seg=14)
m.cyl(0.022, 0.012, (0, -0.145, 0), Wood, rot=AXIS_Y, seg=14)
m.cyl(0.015, 0.21, (0, 0, 0), Glove, rot=AXIS_Y, seg=12)                         # wrapped handle
for i in range(7):
    m.torus(0.015, 0.0015, (0, -0.09 + i * 0.03, 0), GlovePad, rot=AXIS_Y, seg=10, sub=4)
m.finish(weapons, (6.5, -1.5, WZ))

m = Model('Crowbar')
m.cyl(0.012, 0.63, (0, 0, 0), BarrelRed, rot=AXIS_Y, seg=10)
m.chain([(0, 0.31, 0), (0, 0.365, -0.004), (0, 0.401, -0.034),
         (0, 0.402, -0.07), (0, 0.38, -0.093)], 0.012, BarrelRed, seg=8)
for sx in (-1, 1):
    m.prism([(0.385, -0.08), (0.385, -0.101), (0.337, -0.108), (0.34, -0.099)],
            0.009, (sx * 0.007, 0, 0), Steel)                                  # split nail-pulling claw
m.prism([(-0.307, 0.012), (-0.307, -0.012), (-0.389, -0.035), (-0.395, -0.029)],
        0.024, (0, 0, 0), Steel)                                               # flattened pry end
m.finish(weapons, (7.0, -1.5, WZ))

m = Model('Katana')
m.box((0.025, 0.265, 0.034), (0, 0, 0), Glove, bevel=0.005, seg=1)
for i in range(9):
    for sx in (-1, 1):
        m.box((0.002, 0.026, 0.009), (sx * 0.013, -0.11 + i * 0.027, 0), GlovePad,
              rot=(sx * 0.68, 0, 0))                                          # crossed handle wrap
for y in (-0.136, 0.137):
    m.box((0.028, 0.014, 0.037), (0, y, 0), Brass, bevel=0.003, seg=1)
m.cyl(0.045, 0.007, (0, 0.151, 0), Gunmetal, rot=AXIS_Y, seg=16)                  # tsuba
m.box((0.011, 0.025, 0.034), (0, 0.168, 0), Brass)
m.prism([(0.18, -0.016), (0.40, -0.013), (0.64, 0.003), (0.80, 0.024),
         (0.88, 0.062), (0.79, 0.055), (0.63, 0.034), (0.40, 0.018), (0.18, 0.017)],
        0.005, (0, 0, 0), Steel)
m.prism([(0.18, 0.011), (0.40, 0.012), (0.63, 0.028), (0.79, 0.049),
         (0.88, 0.062), (0.79, 0.055), (0.63, 0.034), (0.40, 0.018), (0.18, 0.017)],
        0.0058, (0, 0, 0), Gunmetal)                                           # dark spine, bright edge
m.finish(weapons, (7.5, -1.5, WZ))

m = Model('Chainsaw')
m.box((0.19, 0.28, 0.17), (0, 0.255, 0.025), BarrelRed, bevel=0.018, seg=1)       # engine housing
m.box((0.035, 0.19, 0.125), (0.102, 0.26, 0.015), Gunmetal, bevel=0.009, seg=1)   # clutch cover
m.cyl(0.066, 0.02, (-0.101, 0.235, 0.025), Polymer, rot=AXIS_X, seg=16)
for z in (-0.025, -0.005, 0.015, 0.035, 0.055):
    m.box((0.005, 0.08, 0.007), (-0.113, 0.24, z), Bore)                        # starter vents
m.cyl(0.021, 0.025, (0.042, 0.205, 0.112), Polymer, seg=10)                     # fuel cap
m.cyl(0.019, 0.16, (0, 0, 0), Polymer, rot=AXIS_Y, seg=10)                      # rear grip at origin
m.box((0.026, 0.19, 0.018), (0, 0.004, -0.079), Polymer, bevel=0.006, seg=1)
for y in (-0.083, 0.085):
    m.box((0.027, 0.027, 0.096), (0, y, -0.035), Polymer, bevel=0.006, seg=1)
m.box((0.013, 0.03, 0.012), (0, 0.03, -0.024), Hazard)                          # throttle
m.chain([(-0.105, 0.19, 0.015), (-0.12, 0.16, 0.16), (0.10, 0.16, 0.16),
         (0.10, 0.22, 0.015)], 0.013, Polymer, seg=8)                           # front handle
m.box((0.17, 0.014, 0.07), (0, 0.29, 0.125), Polymer, rot=(0.16, 0, 0))         # chain brake
m.prism([(0.35, -0.055), (0.80, -0.055), (0.846, -0.035), (0.86, 0),
         (0.846, 0.035), (0.80, 0.055), (0.35, 0.055)], 0.024, (0, 0, 0), Gunmetal)
m.prism([(0.35, -0.041), (0.80, -0.041), (0.831, -0.026), (0.843, 0),
         (0.831, 0.026), (0.80, 0.041), (0.35, 0.041)], 0.027, (0, 0, 0), Steel)
for i in range(13):
    for sz in (-1, 1):
        m.box((0.031, 0.014, 0.009), (0, 0.397 + i * 0.033, sz * 0.058), Steel,
              rot=(sz * 0.3, 0, 0))                                           # individual chain teeth
for a in (-pi / 3, 0, pi / 3):
    m.box((0.031, 0.009, 0.014), (0, 0.802 + 0.061 * cos(a), 0.061 * sin(a)), Steel,
          rot=(a, 0, 0))
m.finish(weapons, (8.0, -1.5, WZ))

m = Model('SledgeHammer')
m.loft([(-0.61, 0.017, 0.022), (-0.35, 0.015, 0.019), (0.12, 0.016, 0.018),
        (0.27, 0.018, 0.02)], (0, 0, 0), Wood, rot=AXIS_Y, seg=10)
m.cyl(0.022, 0.25, (0, 0, 0), Polymer, rot=AXIS_Y, seg=10)
for i in range(6):
    m.torus(0.022, 0.002, (0, -0.10 + i * 0.04, 0), GlovePad, rot=AXIS_Y, seg=10, sub=4)
m.box((0.075, 0.09, 0.225), (0, 0.60, 0), Gunmetal, bevel=0.012, seg=1)
for sz in (-1, 1):
    m.box((0.079, 0.094, 0.026), (0, 0.60, sz * 0.117), Steel, bevel=0.006, seg=1)
m.box((0.022, 0.012, 0.04), (0, 0.65, 0), Wood)                                 # wedged handle end
m.finish(weapons, (8.5, -1.5, WZ))

# ================================================================== LIBRARY: GUNS
# Grips start at (0, 0, 0). Each sight line has an open rear notch at x = 0.
m = Model('DoubleBarrel')
m.box((0.063, 0.13, 0.056), (0, 0.08, 0.035), Gunmetal, bevel=0.006, seg=1)
for sx in (-1, 1):
    m.cyl(0.016, 0.32, (sx * 0.018, 0.29, 0.04), Gunmetal, rot=AXIS_Y, seg=14)
    m.cyl(0.0115, 0.008, (sx * 0.018, 0.449, 0.04), Bore, rot=AXIS_Y, seg=12)
    m.cyl(0.005, 0.007, (sx * 0.033, 0.095, 0.034), Steel, rot=AXIS_X, seg=8)      # hinge pins
    m.box((0.004, 0.012, 0.012), (sx * 0.006, 0.031, 0.073), Gunmetal)           # rear notch
    m.box((0.006, 0.012, 0.022), (sx * 0.022, 0.003, 0.063), Steel, rot=(0.4, 0, 0))
m.box((0.012, 0.32, 0.007), (0, 0.29, 0.056), Gunmetal)                         # joining / sight rib
m.box((0.003, 0.008, 0.012), (0, 0.427, 0.073), Brass)                          # front post
m.box((0.055, 0.14, 0.035), (0, 0.23, 0.01), Wood, bevel=0.01, seg=1)
m.prism([(-0.026, 0), (0.025, 0), (0.018, -0.035), (-0.035, -0.11),
         (-0.088, -0.101), (-0.054, -0.055)], 0.038, (0, 0, 0), Wood, bevel=0.005)
m.box((0.01, 0.07, 0.008), (0, 0.064, -0.034), Gunmetal, bevel=0.002, seg=1)
m.box((0.01, 0.008, 0.056), (0, 0.095, -0.005), Gunmetal, bevel=0.002, seg=1)
for y in (0.042, 0.064):
    m.box((0.006, 0.007, 0.025), (0, y, -0.014), Steel, rot=(0.3, 0, 0))          # twin triggers
m.box((0.01, 0.04, 0.007), (0.011, 0.035, 0.067), Steel, rot=(0, 0, -0.3))       # opening lever
m.finish(weapons, (9.0, -1.5, WZ))

m = Model('Uzi')
m.box((0.05, 0.255, 0.069), (0, 0.055, 0.036), Gunmetal, bevel=0.006, seg=1)
m.box((0.043, 0.22, 0.012), (0, 0.051, 0.077), Gunmetal, bevel=0.003, seg=1)
m.box((0.038, 0.047, 0.10), (0, 0, -0.05), Polymer, bevel=0.006, seg=1)          # grip / magazine well
m.box((0.028, 0.036, 0.17), (0, 0, -0.143), Gunmetal, bevel=0.003, seg=1)
m.box((0.034, 0.041, 0.009), (0, 0, -0.23), Polymer)
m.box((0.012, 0.005, 0.07), (0, -0.025, -0.05), GlovePad)                      # grip safety
m.box((0.053, 0.085, 0.04), (0, 0.137, -0.005), Polymer, bevel=0.007, seg=1)
for i in range(5):
    m.box((0.055, 0.004, 0.032), (0, 0.105 + i * 0.015, -0.008), GlovePad)
m.cyl(0.015, 0.028, (0, 0.193, 0.033), Gunmetal, rot=AXIS_Y, seg=12)              # barrel nut
m.cyl(0.009, 0.076, (0, 0.24, 0.033), Steel, rot=AXIS_Y, seg=12)
m.cyl(0.005, 0.008, (0, 0.278, 0.033), Bore, rot=AXIS_Y, seg=10)
m.box((0.009, 0.077, 0.008), (0, 0.064, -0.041), Gunmetal)
m.box((0.009, 0.009, 0.058), (0, 0.099, -0.015), Gunmetal)
m.box((0.006, 0.008, 0.025), (0, 0.043, -0.017), Steel, rot=(0.3, 0, 0))
m.box((0.026, 0.037, 0.013), (0, 0.03, 0.086), Polymer, bevel=0.003, seg=1)       # top cocking knob
for sx in (-1, 1):
    m.box((0.004, 0.012, 0.015), (sx * 0.007, -0.054, 0.104), Gunmetal)
    m.box((0.004, 0.02, 0.024), (sx * 0.02, 0.157, 0.096), Gunmetal)             # front sight guards
    m.box((0.005, 0.155, 0.018), (sx * 0.029, -0.132, 0.0), Steel)               # folded stock arms
m.box((0.003, 0.006, 0.015), (0, 0.157, 0.104), Gunmetal)
m.box((0.061, 0.018, 0.085), (0, -0.217, -0.03), Gunmetal, bevel=0.004, seg=1)
m.box((0.005, 0.052, 0.023), (0.026, 0.083, 0.047), Bore)                       # ejection port
m.finish(weapons, (9.5, -1.5, WZ))

m = Model('Minigun')
m.cyl(0.075, 0.235, (0, 0.20, 0.056), Gunmetal, rot=AXIS_Y, seg=16)              # receiver
m.cyl(0.081, 0.022, (0, 0.086, 0.056), Steel, rot=AXIS_Y, seg=16)
m.cyl(0.055, 0.20, (0.092, 0.205, 0.022), Gunmetal, rot=AXIS_Y, seg=12)          # drive motor
m.cyl(0.047, 0.025, (0.092, 0.10, 0.022), Polymer, rot=AXIS_Y, seg=12)
for k in range(6):
    a = k * pi / 3
    x, z = 0.05 * cos(a), 0.056 + 0.05 * sin(a)
    m.cyl(0.012, 0.59, (x, 0.602, z), Gunmetal, rot=AXIS_Y, seg=10)
    m.cyl(0.007, 0.008, (x, 0.9, z), Bore, rot=AXIS_Y, seg=8)
for y in (0.35, 0.69, 0.863):
    m.cyl(0.07, 0.022, (0, y, 0.056), Steel, rot=AXIS_Y, seg=16)                 # barrel cluster clamps
m.box((0.035, 0.052, 0.115), (0, 0, -0.0575), Polymer, bevel=0.007, seg=1)
m.box((0.05, 0.10, 0.028), (0, 0.027, 0.013), Gunmetal, bevel=0.004, seg=1)      # grip attaches receiver
m.box((0.01, 0.084, 0.009), (0, 0.061, -0.046), Gunmetal)
m.box((0.01, 0.01, 0.057), (0, 0.10, -0.019), Gunmetal)
m.box((0.007, 0.008, 0.027), (0, 0.043, -0.016), Steel, rot=(0.3, 0, 0))
m.chain([(-0.053, 0.17, 0.10), (-0.115, 0.17, 0.17), (-0.115, 0.32, 0.17),
         (-0.053, 0.32, 0.10)], 0.014, Polymer, seg=8)                           # offset carrying handle
m.box((0.055, 0.082, 0.054), (-0.071, 0.245, 0.006), Gunmetal)                  # ammunition inlet
for i in range(5):
    m.cyl(0.008, 0.057, (-0.10 - i * 0.018, 0.235, -0.003 - i * 0.004), Brass,
          rot=AXIS_Y, seg=8)
m.box((0.03, 0.055, 0.019), (-0.13, 0.224, -0.019), Gunmetal)                   # feed belt backing
for y in (0.115, 0.842):
    m.box((0.025, 0.016, 0.02), (0, y, 0.128), Gunmetal)
for sx in (-1, 1):
    m.box((0.004, 0.01, 0.015), (sx * 0.007, 0.115, 0.1455), Gunmetal)
m.box((0.003, 0.008, 0.015), (0, 0.842, 0.1455), Gunmetal)
m.finish(weapons, (10.0, -1.5, WZ))

m = Model('Crossbow')
m.box((0.052, 0.49, 0.037), (0, 0.145, 0.041), Gunmetal, bevel=0.004, seg=1)      # bolt track
m.prism([(-0.035, 0.025), (-0.32, 0.018), (-0.35, -0.075), (-0.26, -0.079),
         (-0.15, -0.013), (-0.035, -0.012)], 0.047, (0, 0, 0), Olive, bevel=0.004)
m.box((0.047, 0.018, 0.11), (0, -0.35, -0.027), Polymer, bevel=0.004, seg=1)
m.box((0.035, 0.05, 0.10), (0, 0, -0.05), Polymer, bevel=0.006, seg=1)
m.box((0.052, 0.125, 0.058), (0, 0.20, -0.004), Olive, bevel=0.009, seg=1)
m.box((0.008, 0.07, 0.008), (0, 0.054, -0.048), Gunmetal)
m.box((0.008, 0.01, 0.07), (0, 0.085, -0.013), Gunmetal)
m.box((0.006, 0.007, 0.025), (0, 0.045, -0.019), Steel, rot=(0.3, 0, 0))
for sx in (-1, 1):
    m.prism([(0.0, 0.36), (0.14, 0.385), (0.28, 0.355), (0.355, 0.26),
             (0.343, 0.251), (0.265, 0.328), (0.135, 0.344), (0.0, 0.32)],
            0.027, (0, 0, 0.043), Olive, rot=(0, -sx * pi / 2, -sx * pi / 2))    # swept limbs in XY
    m.limb((sx * 0.35, 0.26, 0.061), (0, -0.052, 0.061), 0.0017, Glove, seg=6)  # cocked string
    m.box((0.004, 0.009, 0.015), (sx * 0.007, -0.06, 0.097), Gunmetal)
m.cyl(0.003, 0.43, (0, 0.165, 0.068), Wood, rot=AXIS_Y, seg=8)                  # bolt shaft
m.cyl(0.0005, 0.045, (0, 0.4025, 0.068), Steel, rot=AXIS_Y, r2=0.008, seg=8)     # point forward
for sx in (-1, 1):
    m.box((0.018, 0.045, 0.0015), (sx * 0.009, -0.031, 0.069), BarrelRed)
m.box((0.024, 0.015, 0.022), (0, 0.31, 0.072), Gunmetal)
m.box((0.003, 0.006, 0.015), (0, 0.31, 0.097), Gunmetal)
m.chain([(-0.055, 0.34, 0.025), (-0.067, 0.47, 0.025), (0.067, 0.47, 0.025),
         (0.055, 0.34, 0.025)], 0.007, Steel, seg=6)                             # stirrup
m.finish(weapons, (11.0, -1.5, WZ))                                              # wider bow needs the 10.5 slot too

m = Model('Flamethrower')
m.box((0.06, 0.20, 0.065), (0, 0.09, 0.039), Olive, bevel=0.007, seg=1)
m.cyl(0.017, 0.48, (0, 0.39, 0.048), Gunmetal, rot=AXIS_Y, seg=12)
m.cyl(0.027, 0.24, (0, 0.32, 0.048), Olive, rot=AXIS_Y, seg=12)                  # heat shield
for i in range(5):
    for sx in (-1, 1):
        m.box((0.003, 0.025, 0.009), (sx * 0.027, 0.23 + i * 0.044, 0.048), Bore)
m.cyl(0.04, 0.085, (0, 0.645, 0.048), Gunmetal, rot=AXIS_Y, r2=0.017, seg=14)     # nozzle flares forward
m.cyl(0.034, 0.008, (0, 0.688, 0.048), Bore, rot=AXIS_Y, seg=14)
m.cyl(0.006, 0.11, (0, 0.617, 0.005), Brass, rot=AXIS_Y, seg=8)                  # pilot tube
m.box((0.012, 0.014, 0.05), (0, 0.61, 0.019), Gunmetal)
m.box((0.035, 0.05, 0.105), (0, 0, -0.0525), Polymer, bevel=0.007, seg=1)
m.box((0.032, 0.04, 0.09), (0, 0.235, -0.033), Polymer, bevel=0.006, seg=1)
m.box((0.009, 0.075, 0.008), (0, 0.06, -0.04), Gunmetal)
m.box((0.009, 0.01, 0.059), (0, 0.092, -0.014), Gunmetal)
m.box((0.006, 0.008, 0.025), (0, 0.043, -0.015), Brass, rot=(0.3, 0, 0))
m.capsule(0.066, 0.13, (0.115, 0.13, -0.08), Olive, rot=AXIS_Y, seg=12, rings=7)  # self-contained fuel canister
for y in (0.04, 0.22):
    m.torus(0.067, 0.005, (0.115, y, -0.08), Gunmetal, rot=AXIS_Y, seg=12, sub=4)
    m.box((0.06, 0.018, 0.045), (0.05, y, -0.056), Gunmetal)                    # tank brackets
m.cyl(0.014, 0.035, (0.115, -0.084, -0.08), Brass, rot=AXIS_Y, seg=8)
m.torus(0.019, 0.004, (0.115, -0.107, -0.08), BarrelRed, rot=AXIS_Y, seg=10, sub=4)
m.chain([(0.115, -0.096, -0.08), (0.13, -0.15, -0.18), (0.015, -0.12, -0.19),
         (0, -0.045, -0.093)], 0.009, Polymer, seg=8)                            # connected fuel hose
for y in (0.025, 0.57):
    m.box((0.024, 0.014, 0.025), (0, y, 0.081), Gunmetal)
for sx in (-1, 1):
    m.box((0.004, 0.01, 0.014), (sx * 0.007, 0.025, 0.1), Gunmetal)
m.box((0.003, 0.008, 0.014), (0, 0.57, 0.1), Gunmetal)
m.finish(weapons, (11.5, -1.5, WZ))

# ================================================================== LIBRARY: PROPS
TrafficOrange = material('TrafficOrange', (0.95, 0.19, 0.025), 0.65)
Ceramic = material('Ceramic', (0.86, 0.87, 0.84), 0.22)
SandCanvas = material('SandCanvas', (0.43, 0.36, 0.22), 0.95)

m = Model('Chair')
m.box((0.46, 0.44, 0.045), (0, 0, 0.005), Wood, bevel=0.009, seg=1)               # seat 0.45 m above feet
for sx in (-1, 1):
    for sy in (-1, 1):
        m.box((0.037, 0.037, 0.43), (sx * 0.195, sy * 0.18, -0.235), CrateFrame,
              bevel=0.003, seg=1)
    m.box((0.037, 0.04, 0.475), (sx * 0.195, -0.18, 0.2125), CrateFrame, bevel=0.003, seg=1)
    m.box((0.026, 0.36, 0.028), (sx * 0.195, 0, -0.22), Wood)
for z in (0.20, 0.37):
    m.box((0.36, 0.035, 0.105), (0, -0.18, z), Wood, bevel=0.007, seg=1)           # back slats
m.box((0.39, 0.025, 0.03), (0, 0.18, -0.10), CrateFrame)
for sx in (-1, 1):
    for z in (0.20, 0.37):
        m.cyl(0.005, 0.005, (sx * 0.155, -0.159, z), Brass, rot=AXIS_Y, seg=6)
m.finish(props, (0.0, 3.5, 0.45))

m = Model('Table')
m.box((1.2, 0.8, 0.05), (0, 0, 0.355), Wood, bevel=0.012, seg=1)
for sx in (-1, 1):
    for sy in (-1, 1):
        m.box((0.055, 0.055, 0.71), (sx * 0.52, sy * 0.32, -0.025), CrateFrame, bevel=0.004, seg=1)
        m.box((0.065, 0.065, 0.022), (sx * 0.52, sy * 0.32, -0.369), Polymer, bevel=0.003, seg=1)
    m.box((0.03, 0.68, 0.10), (sx * 0.52, 0, 0.27), Wood)
    m.box((1.065, 0.03, 0.10), (0, sx * 0.32, 0.27), Wood)
for x in (-0.4, -0.2, 0, 0.2, 0.4):
    m.box((0.0015, 0.775, 0.001), (x, 0, 0.3805), CrateFrame)                    # joined top boards
m.finish(props, (1.6, 3.5, 0.38))

m = Model('TrafficCone')
m.box((0.38, 0.38, 0.055), (0, 0, -0.3225), Polymer, bevel=0.014, seg=1)
m.cyl(0.15, 0.64, (0, 0, 0.02), TrafficOrange, r2=0.029, seg=20)
for lo, hi in ((-0.11, -0.035), (0.09, 0.165)):
    rlo = 0.15 - (lo + 0.30) / 0.64 * 0.121
    rhi = 0.15 - (hi + 0.30) / 0.64 * 0.121
    m.cyl(rlo + 0.001, hi - lo, (0, 0, (lo + hi) / 2), Ceramic, r2=rhi + 0.001, seg=20)
m.torus(0.023, 0.006, (0, 0, 0.344), TrafficOrange, seg=16, sub=4)
m.cyl(0.019, 0.002, (0, 0, 0.341), Bore, seg=16)                                 # opening at cone tip
m.finish(props, (2.7, 3.5, 0.35))

m = Model('PropaneTank')
m.loft([(-0.225, 0.085, 0.085), (-0.20, 0.135, 0.135), (-0.15, 0.154, 0.154),
        (0.11, 0.154, 0.154), (0.16, 0.13, 0.13), (0.19, 0.058, 0.058)], (0, 0, 0), Ceramic, seg=20)
m.torus(0.154, 0.004, (0, 0, -0.01), BarrelRim, seg=20, sub=4)                    # welded seam
m.torus(0.10, 0.012, (0, 0, -0.248), Gunmetal, seg=16, sub=6)                     # foot ring
for a in (0, 2 * pi / 3, 4 * pi / 3):
    m.box((0.016, 0.04, 0.04), (0.095 * cos(a), 0.095 * sin(a), -0.229), Gunmetal,
          rot=(0, 0, a))
    m.box((0.014, 0.035, 0.067), (0.095 * cos(a), 0.095 * sin(a), 0.22), Ceramic,
          rot=(0, 0, a))
m.torus(0.095, 0.007, (0, 0, 0.253), Ceramic, seg=16, sub=6)                      # open valve protection ring
m.cyl(0.018, 0.049, (0, 0, 0.211), Brass, seg=10)
m.cyl(0.014, 0.04, (0, 0.022, 0.214), Brass, rot=AXIS_Y, seg=10)
m.cyl(0.008, 0.003, (0, 0.044, 0.214), Bore, rot=AXIS_Y, seg=8)
m.cyl(0.025, 0.012, (0, 0, 0.242), BarrelRed, seg=8)
m.box((0.08, 0.002, 0.07), (0, 0.154, 0.04), Hazard)                            # plain warning plate
m.finish(props, (3.6, 3.5, 0.26))

m = Model('WoodenPallet')
for y in (-0.28, 0, 0.28):
    m.box((1.2, 0.12, 0.022), (0, y, -0.061), CrateWood)
    for x in (-0.49, 0, 0.49):
        m.box((0.14, 0.12, 0.078), (x, y, -0.011), CrateFrame)
for x in (-0.49, 0, 0.49):
    m.box((0.14, 0.8, 0.022), (x, 0, 0.039), CrateWood)
for i in range(7):
    y = -0.35 + i * 0.1166667
    m.box((1.2, 0.10, 0.022), (0, y, 0.061), CrateWood)
    for x in (-0.49, 0, 0.49):
        m.cyl(0.004, 0.002, (x, y, 0.072), BarrelRim, seg=6)                     # countersunk nails
m.finish(props, (5.0, 3.5, 0.072))

m = Model('Dumpster')
m.box((1.63, 0.85, 1.13), (0, 0, 0.08), Olive, taper=(1.1, 1.16), bevel=0.012, seg=1)
for sx in (-1, 1):
    m.box((0.035, 1.015, 0.055), (sx * 0.893, 0, 0.63), Gunmetal)
    m.box((0.884, 1.055, 0.06), (sx * 0.452, 0, 0.687), Polymer, bevel=0.01, seg=1)
    m.cyl(0.025, 0.78, (sx * 0.452, -0.505, 0.665), Steel, rot=AXIS_X, seg=8)    # lid hinge
    m.box((0.24, 0.05, 0.025), (sx * 0.45, 0.42, 0.728), Polymer, bevel=0.006, seg=1)
    for sy in (-1, 1):
        m.box((0.10, 0.08, 0.12), (sx * 0.70, sy * 0.33, -0.52), Gunmetal)
        m.cyl(0.10, 0.072, (sx * 0.70, sy * 0.33, -0.6405), Polymer, rot=AXIS_X, seg=12)
        m.cyl(0.035, 0.077, (sx * 0.70, sy * 0.33, -0.6405), Steel, rot=AXIS_X, seg=8)
        m.box((0.09, 0.94, 0.065), (sx * 0.84, 0, -0.07), Gunmetal)              # fork pockets
for x in (-0.6, 0, 0.6):
    for sy in (-1, 1):
        m.box((0.036, 0.028, 0.84), (x, sy * 0.473, 0.065), Olive, rot=(sy * -0.063, 0, 0))
m.box((0.22, 0.015, 0.15), (0, 0.49, 0.30), Hazard)
m.finish(props, (7.1, 3.5, 0.7405))

m = Model('StreetLamp')
m.box((0.34, 0.34, 0.05), (0, -0.38, -2.075), Gunmetal, bevel=0.008, seg=1)
m.cyl(0.092, 0.36, (0, -0.38, -1.87), Gunmetal, r2=0.06, seg=12)
m.cyl(0.057, 3.58, (0, -0.38, 0.08), Gunmetal, r2=0.035, seg=12)
m.chain([(0, -0.38, 1.84), (0, -0.35, 1.98), (0, -0.18, 2.044),
         (0, 0.27, 2.044)], 0.027, Gunmetal, seg=8)
m.box((0.29, 0.56, 0.075), (0, 0.32, 2.0625), Gunmetal, bevel=0.022, seg=1)
m.box((0.23, 0.46, 0.017), (0, 0.32, 2.017), EyeWhite, bevel=0.006, seg=1)        # light diffuser
m.box((0.05, 0.012, 0.18), (0, -0.322, -1.5), BarrelRim, bevel=0.005, seg=1)      # access panel
for sx in (-1, 1):
    for sy in (-1, 1):
        m.cyl(0.013, 0.017, (sx * 0.125, -0.38 + sy * 0.125, -2.044), Steel, seg=6)
m.finish(props, (9.0, 4.5, 2.1))

m = Model('SandbagWall')
for row in range(3):
    # The half-length end bags keep the staggered courses centred on the origin.
    bags = [(-0.81, 0.25), (-0.375, 0.56), (0.245, 0.56), (0.785, 0.37)] if row == 1 else [(-0.62, 0.58), (0, 0.58), (0.62, 0.58)]
    for x, length in bags:
        m.box((length, 0.36, 0.175), (x, 0, -0.18 + row * 0.18), SandCanvas,
              bevel=0.053, seg=2)                                             # soft squared bags
        m.box((length - 0.08, 0.003, 0.009), (x, 0.181, -0.18 + row * 0.18), CrateFrame,
              bevel=0.002, seg=1)                                             # stitched front seam
m.finish(props, (10.8, 3.5, 0.2675))

m = Model('Toilet')
m.loft([(-0.4, 0.15, 0.205, 0, 0.005), (-0.36, 0.14, 0.19), (-0.18, 0.09, 0.105, 0, -0.035),
        (-0.06, 0.13, 0.15)], (0, 0, 0), Ceramic, seg=16)                        # pedestal
m.sphere(0.20, (0, 0.03, 0.005), Ceramic, scale=(1, 1.36, 0.95), seg=20, rings=12,
         keep=lambda c: c.z <= 0)                                              # open bowl, no cap across mouth
m.torus(0.159, 0.028, (0, 0.04, 0.007), Ceramic, seg=20, sub=6)                 # round seat / visible opening
m.cyl(0.13, 0.008, (0, 0.04, -0.038), Bore, seg=20)                             # shadow inside bowl
m.cyl(0.072, 0.008, (0, 0.04, -0.031), Lens, seg=16)                            # water surface
m.box((0.36, 0.19, 0.39), (0, -0.214, 0.185), Ceramic, bevel=0.025, seg=2)       # cistern
m.box((0.38, 0.215, 0.033), (0, -0.214, 0.3835), Ceramic, bevel=0.01, seg=1)
m.box((0.045, 0.018, 0.014), (-0.124, -0.107, 0.315), Steel, bevel=0.004, seg=1)  # flush lever
for sx in (-1, 1):
    m.cyl(0.011, 0.012, (sx * 0.105, -0.07, -0.375), Steel, seg=8)               # floor fixing caps
m.finish(props, (0.0, 5.5, 0.4))

m = Model('Car')
# Sedan: length 4.3 m on Y, tyres on X axles, +Y is the bonnet/front.
m.box((1.65, 3.99, 0.44), (0, 0, -0.20), BarrelBlue, bevel=0.07, seg=1)
m.box((1.59, 1.27, 0.16), (0, 1.305, 0.075), BarrelBlue, bevel=0.035, seg=1)      # bonnet
m.box((1.59, 0.66, 0.14), (0, -1.61, 0.065), BarrelBlue, bevel=0.035, seg=1)     # boot
m.prism([(-1.28, 0.11), (-0.80, 0.64), (0.38, 0.64), (0.92, 0.13)],
        1.42, (0, 0, 0), BarrelBlue, bevel=0.025)                                # cabin silhouette
for sx in (-1, 1):
    m.prism([(-1.15, 0.17), (-0.765, 0.575), (-0.29, 0.575), (-0.29, 0.17)],
            0.006, (sx * 0.713, 0, 0), Lens)                                   # rear side glass
    m.prism([(-0.22, 0.17), (-0.22, 0.575), (0.35, 0.575), (0.79, 0.17)],
            0.006, (sx * 0.713, 0, 0), Lens)                                   # front side glass
    for y in (-0.78, 0.22):
        m.box((0.016, 0.14, 0.027), (sx * 0.826, y, -0.004), Steel, bevel=0.005, seg=1)
    m.box((0.11, 0.15, 0.09), (sx * 0.865, 0.75, 0.14), BarrelBlue, bevel=0.025, seg=1)
    m.box((0.075, 0.008, 0.057), (sx * 0.876, 0.673, 0.14), Lens)                # mirrors
    m.box((0.018, 3.75, 0.032), (sx * 0.829, 0, -0.22), Polymer)                # side rub strip
    for y in (-1.31, 1.30):
        m.cyl(0.30, 0.20, (sx * 0.81, y, -0.34), Polymer, rot=AXIS_X, seg=20)    # four separate tyre cylinders
        m.cyl(0.18, 0.012, (sx * 0.918, y, -0.34), Steel, rot=AXIS_X, seg=16)
        m.cyl(0.067, 0.018, (sx * 0.927, y, -0.34), Gunmetal, rot=AXIS_X, seg=10)
        for k in range(5):
            a = k * 2 * pi / 5
            m.cyl(0.031, 0.014, (sx * 0.929, y + cos(a) * 0.122, -0.34 + sin(a) * 0.122),
                  Bore, rot=AXIS_X, seg=6)                                    # wheel vents
m.prism([(0.395, 0.611), (0.866, 0.165), (0.853, 0.156), (0.382, 0.602)],
        1.28, (0, 0, 0), Lens)                                                 # windshield
m.prism([(-1.228, 0.156), (-0.815, 0.609), (-0.80, 0.599), (-1.213, 0.145)],
        1.28, (0, 0, 0), Lens)                                                 # rear screen
for sy in (-1, 1):
    m.box((1.69, 0.16, 0.145), (0, sy * 2.07, -0.22), Polymer, bevel=0.025, seg=1)
    m.box((0.37, 0.012, 0.12), (0, sy * 2.155, -0.20), Ceramic)                  # blank plate
    for sx in (-1, 1):
        m.box((0.36, 0.025, 0.12), (sx * 0.59, sy * 1.998, -0.045),
              EyeWhite if sy == 1 else BarrelRed, bevel=0.012, seg=1)
m.box((0.66, 0.026, 0.16), (0, 2.002, -0.038), Bore)
for x in (-0.27, -0.135, 0, 0.135, 0.27):
    m.box((0.016, 0.029, 0.13), (x, 2.006, -0.038), Steel)
m.cyl(0.026, 0.14, (-0.59, -2.03, -0.37), Gunmetal, rot=AXIS_Y, seg=10)
m.finish(props, (4.0, 7.3, 0.64))

# ================================================================== LIBRARY: HEAD ACCESSORIES
# All four meshes are authored about the Head origin, facing +Y. Open shells keep
# the head cavity clear; no solid cylinder or loft cap passes through the face.
accessories = collection('Accessories')
PoliceNavy = material('PoliceNavy', (0.025, 0.045, 0.09), 0.85)

m = Model('PoliceCap')
m.sphere(0.12, (0, 0, 0.076), PoliceNavy, scale=(0.91, 1.04, 0.60), seg=20, rings=12,
         keep=lambda c: c.z >= -0.001)
m.torus(0.101, 0.009, (0, 0, 0.068), Polymer, seg=20, sub=6)                     # head band
m.sphere(0.115, (0, 0.045, 0.064), Polymer, scale=(0.94, 1.0, 0.045), seg=20, rings=8,
         keep=lambda c: c.y >= 0.045)                                          # visor only outside head cavity
m.chain([(-0.088, 0.071, 0.078), (-0.057, 0.104, 0.077), (0, 0.117, 0.076),
         (0.057, 0.104, 0.077), (0.088, 0.071, 0.078)], 0.003, Brass, seg=6)      # chin cord above visor
for sx in (-1, 1):
    m.sphere(0.006, (sx * 0.098, 0.04, 0.082), Brass, scale=(0.3, 1, 1), seg=8, rings=5)
m.prism([(-0.012, 0.014), (0.012, 0.014), (0.013, -0.005), (0, -0.019), (-0.013, -0.005)],
        0.004, (0, 0.122, 0.105), Brass, rot=(0, 0, -pi / 2))                   # shield badge faces forward
m.finish(accessories, (0, -3.8, 1.0))

m = Model('HardHat')
m.sphere(0.125, (0, 0, 0.031), Hazard, scale=(1, 1, 0.90), seg=20, rings=12,
         keep=lambda c: c.z >= -0.001)
m.torus(0.132, 0.010, (0, 0, 0.035), Hazard, seg=20, sub=6)                      # brim with open centre
for sx in (-1, 1):
    m.chain([(sx * 0.049, -0.098, 0.09), (sx * 0.048, -0.055, 0.128),
             (sx * 0.044, 0.016, 0.142), (sx * 0.045, 0.074, 0.116)], 0.005, Hazard, seg=6)
    for y in (-0.034, 0, 0.034):
        m.box((0.003, 0.017, 0.006), (sx * 0.112, y, 0.08), Bore)               # ventilation slots
m.sphere(0.105, (0, 0.039, 0.033), Hazard, scale=(1.12, 1, 0.04), seg=16, rings=8,
         keep=lambda c: c.y >= 0.075)                                          # short forward peak
m.finish(accessories, (0.5, -3.8, 1.0))

m = Model('CombatHelmet')
m.sphere(0.13, (0, -0.008, 0.024), Olive, scale=(0.91, 1, 0.9), seg=24, rings=16,
         keep=lambda c: c.z >= (-0.055 if c.y < 0.05 else 0.015))                # brow opening, lower sides / rear
m.chain([(-0.087, 0.063, 0.066), (-0.057, 0.1, 0.063), (0, 0.12, 0.061),
         (0.057, 0.1, 0.063), (0.087, 0.063, 0.066)], 0.0045, GrenadeDark, seg=6)
for sx in (-1, 1):
    m.chain([(sx * 0.106, 0.011, 0.012), (sx * 0.079, 0.049, -0.054),
             (sx * 0.035, 0.025, -0.107), (0, 0.024, -0.119)], 0.006, Glove, seg=6)
    m.box((0.011, 0.014, 0.017), (sx * 0.077, 0.047, -0.055), Gunmetal)          # strap buckles
    m.sphere(0.008, (sx * 0.113, 0.014, 0.031), Gunmetal, scale=(0.4, 1, 1), seg=8, rings=6)
m.box((0.031, 0.011, 0.035), (0, 0.119, 0.073), Gunmetal, bevel=0.004, seg=1)    # front mounting plate
m.finish(accessories, (1.0, -3.8, 1.0))

m = Model('Balaclava')
# The same skull warp as Head, expanded enough to cover its existing hair.
# Remove front vertices in the eye band: this is an actual opening, not black paint.
m.sphere(0.1, (0, -0.002, 0.002), Glove, seg=32, rings=24,
         warp=lambda c: head_shape(c, 1.13),
         keep=lambda c: not (c.y > 0.042 and 0.004 < c.z < 0.040))
m.chain([(-0.063, 0.073, 0.05), (-0.032, 0.087, 0.051), (0, 0.090, 0.050),
         (0.032, 0.087, 0.051), (0.063, 0.073, 0.05)], 0.003, GlovePad, seg=6)     # sewn eye opening
m.chain([(-0.063, 0.073, 0.003), (-0.032, 0.087, 0.003), (0, 0.09, 0.004),
         (0.032, 0.087, 0.003), (0.063, 0.073, 0.003)], 0.003, GlovePad, seg=6)
m.sphere(0.033, (0, 0.086, -0.032), Glove, scale=(0.85, 0.77, 1.08), seg=12, rings=8)  # nose fabric clears Head nose
m.torus(0.052, 0.009, (0, -0.009, -0.131), GlovePad, seg=16, sub=5)              # lower hem
m.finish(accessories, (1.5, -3.8, 1.0))

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
EXPORT = [o for c in (char, weapons, hands, props, accessories) for o in c.objects]
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
print(result)
