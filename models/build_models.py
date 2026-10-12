"""Builds every IMPACTBOX model procedurally and exports assets/models.glb.

Run inside Blender with models/impactbox-models.blend open (Scripting tab > Run Script).
Conventions: metres, Z up, +Y is "forward" (becomes -Z in three.js after glTF export).
Each model is one object whose origin is the point the game attaches it by:
  - character parts: centre of the physics collider
  - weapons: roughly the grip
  - props: centre of the collider
Material names are part of the contract: the game re-tints Skin / Shirt / Pants per NPC.
"""
import bpy
import bmesh
import math
import os
from math import pi, sin, cos, radians
from mathutils import Matrix, Euler

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


# metal is kept low on purpose: the game has no environment map, so true metals render black
Skin = material('Skin', (0.80, 0.56, 0.42), 0.65)
Shirt = material('Shirt', (0.62, 0.10, 0.08), 0.8)
Pants = material('Pants', (0.10, 0.13, 0.22), 0.85)
Hair = material('Hair', (0.10, 0.06, 0.04), 0.7)
Shoe = material('Shoe', (0.07, 0.07, 0.08), 0.6)
Sole = material('Sole', (0.75, 0.75, 0.72), 0.8)
Belt = material('Belt', (0.09, 0.06, 0.04), 0.6)
EyeWhite = material('EyeWhite', (0.92, 0.92, 0.90), 0.3)
EyeDark = material('EyeDark', (0.02, 0.02, 0.02), 0.3)
Mouth = material('Mouth', (0.30, 0.07, 0.07), 0.6)

Gunmetal = material('Gunmetal', (0.16, 0.17, 0.19), 0.4, 0.3)
Polymer = material('Polymer', (0.05, 0.05, 0.06), 0.75)
Steel = material('Steel', (0.68, 0.70, 0.74), 0.3, 0.35)
Brass = material('Brass', (0.78, 0.55, 0.18), 0.4, 0.3)
Wood = material('Wood', (0.36, 0.20, 0.09), 0.7)
GrenadeBody = material('GrenadeBody', (0.15, 0.24, 0.12), 0.7)
GrenadeDark = material('GrenadeDark', (0.07, 0.11, 0.06), 0.8)
GrabBody = material('GrabBody', (0.16, 0.22, 0.36), 0.5, 0.2)
GlowCyan = material('GlowCyan', (0.25, 0.80, 1.0), 0.3, 0.0, emit=3.0)

CrateWood = material('CrateWood', (0.60, 0.40, 0.19), 0.85)
CrateFrame = material('CrateFrame', (0.38, 0.23, 0.10), 0.85)
BarrelBlue = material('BarrelBlue', (0.10, 0.26, 0.52), 0.5, 0.25)
BarrelRed = material('BarrelRed', (0.66, 0.08, 0.06), 0.5, 0.25)
BarrelRim = material('BarrelRim', (0.22, 0.24, 0.27), 0.5, 0.3)
Hazard = material('Hazard', (0.95, 0.72, 0.04), 0.6)
Concrete = material('Concrete', (0.44, 0.45, 0.47), 0.95)
ConcreteDark = material('ConcreteDark', (0.33, 0.34, 0.36), 0.95)


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

    def sphere(self, r, loc, m, scale=(1, 1, 1), rot=(0, 0, 0), seg=16, rings=10, keep=None):
        """keep = optional predicate on the unscaled vertex position; other verts are deleted."""
        verts = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r)['verts']
        if keep:
            drop = [v for v in verts if not keep(v.co)]
            verts = [v for v in verts if keep(v.co)]
            bmesh.ops.delete(self.bm, geom=drop, context='VERTS')
        for v in verts:
            v.co.x *= scale[0]; v.co.y *= scale[1]; v.co.z *= scale[2]
        bmesh.ops.transform(self.bm, matrix=xf(loc, rot), verts=verts)
        self._paint(verts, m)
        return self

    def capsule(self, r, h, loc, m, rot=(0, 0, 0), seg=14, taper_bottom=1.0, taper_top=1.0):
        """Z-axis capsule, h = half length of the straight section (matches Rapier's capsule)."""
        verts = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=9, radius=r)['verts']
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


m = Model('Head')
m.sphere(0.118, (0, 0, 0.005), Skin, scale=(0.92, 1.0, 1.08), seg=20, rings=14)
m.sphere(0.085, (0, 0.022, -0.062), Skin, scale=(0.95, 0.95, 0.8), seg=16, rings=10)          # jaw
m.sphere(0.128, (0, -0.012, 0.024), Hair, scale=(0.98, 1.05, 1.08), seg=20, rings=14,
         keep=lambda c: c.z > 0.010 + c.y * 0.5)                                               # hair cap
for sx in (-1, 1):
    m.sphere(0.021, (sx * 0.042, 0.094, 0.014), EyeWhite, seg=10, rings=8)
    m.sphere(0.011, (sx * 0.042, 0.110, 0.014), EyeDark, seg=8, rings=6)
    m.box((0.042, 0.012, 0.009), (sx * 0.042, 0.106, 0.046), Hair, rot=(0, sx * 0.15, 0), bevel=0.002)
    m.sphere(0.022, (sx * 0.108, 0.0, 0.0), Skin, scale=(0.5, 1.0, 1.3), seg=8, rings=6)      # ears
m.box((0.022, 0.03, 0.036), (0, 0.112, -0.012), Skin, bevel=0.008)                             # nose
m.box((0.05, 0.008, 0.008), (0, 0.098, -0.058), Mouth, bevel=0.002)
m.cyl(0.042, 0.09, (0, -0.005, -0.13), Skin, seg=12)                                           # neck
m.finish(char, at('Head'))

m = Model('Torso')
m.box((0.30, 0.18, 0.44), (0, 0, 0), Shirt, bevel=0.045, taper=(1.2, 1.15), seg=3)
for sx in (-1, 1):
    m.sphere(0.074, (sx * 0.19, 0, 0.165), Shirt, seg=12, rings=8)                             # shoulders
m.torus(0.05, 0.014, (0, 0, 0.222), Shirt, seg=16, sub=6)                                      # collar
m.box((0.012, 0.004, 0.2), (0, 0.112, 0.05), Shirt, bevel=0.001)                               # placket
m.finish(char, at('Torso'))

m = Model('Pelvis')
m.box((0.32, 0.19, 0.18), (0, 0, 0), Pants, bevel=0.04, taper=(1.05, 1.05), seg=3)
m.box((0.34, 0.205, 0.036), (0, 0, 0.074), Belt, bevel=0.008)
m.box((0.045, 0.012, 0.032), (0, 0.105, 0.074), Brass, bevel=0.004)
m.finish(char, at('Pelvis'))

m = Model('UpperArm')
m.capsule(0.046, 0.12, (0, 0, 0), Skin)
m.capsule(0.056, 0.065, (0, 0, 0.062), Shirt, taper_bottom=1.0)                                # short sleeve
m.torus(0.052, 0.007, (0, 0, -0.012), Shirt, seg=14, sub=6)                                    # sleeve hem
m.finish(char, at('UpperArm'))

m = Model('Forearm')
m.capsule(0.045, 0.11, (0, 0, 0), Skin, taper_bottom=0.78)
m.box((0.036, 0.078, 0.09), (0, 0.004, -0.185), Skin, bevel=0.014)                             # hand
m.box((0.022, 0.03, 0.045), (0, 0.048, -0.168), Skin, rot=(0.5, 0, 0), bevel=0.008)            # thumb
m.finish(char, at('Forearm'))

m = Model('Thigh')
m.capsule(0.078, 0.17, (0, 0, 0), Pants, taper_bottom=0.84)
m.finish(char, at('Thigh'))

m = Model('Shin')
m.capsule(0.064, 0.17, (0, 0, 0), Pants, taper_bottom=0.8)
m.torus(0.05, 0.008, (0, 0, -0.165), Pants, seg=14, sub=6)                                     # trouser hem
m.box((0.095, 0.235, 0.07), (0, 0.045, -0.2), Shoe, bevel=0.026, taper=(0.9, 0.92), seg=3)
m.box((0.1, 0.24, 0.02), (0, 0.045, -0.238), Sole, bevel=0.005)
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

m = Model('Pistol')
m.box((0.028, 0.19, 0.03), (0, 0.01, 0.03), Gunmetal, bevel=0.004)                              # slide
m.box((0.0285, 0.04, 0.014), (0, 0.02, 0.038), Steel, bevel=0.002)                              # ejection port
for i in range(5):
    m.box((0.0295, 0.004, 0.022), (0, -0.045 - i * 0.008, 0.031), Polymer)                      # serrations
m.box((0.026, 0.165, 0.02), (0, 0.0, 0.006), Polymer, bevel=0.003)                              # frame
m.cyl(0.0075, 0.014, (0, 0.108, 0.031), Steel, rot=AXIS_Y, seg=10)                              # muzzle
m.box((0.027, 0.046, 0.105), (0, -0.058, -0.046), Polymer, rot=(-0.25, 0, 0), bevel=0.007)      # grip
m.box((0.008, 0.055, 0.006), (0, 0.004, -0.036), Polymer, bevel=0.002)                          # guard bottom
m.box((0.008, 0.006, 0.032), (0, 0.031, -0.021), Polymer, bevel=0.002)                          # guard front
m.box((0.006, 0.006, 0.022), (0, 0.004, -0.017), Steel, rot=(0.3, 0, 0))                        # trigger
m.box((0.004, 0.006, 0.006), (0, 0.097, 0.048), Polymer)                                        # front sight
m.box((0.016, 0.006, 0.006), (0, -0.078, 0.048), Polymer)                                       # rear sight
m.finish(weapons, (0.0, -1.5, WZ))

m = Model('Shotgun')
m.box((0.045, 0.2, 0.066), (0, 0, 0), Gunmetal, bevel=0.009)                                    # receiver
m.cyl(0.013, 0.52, (0, 0.36, 0.016), Gunmetal, rot=AXIS_Y, seg=12)                              # barrel
m.cyl(0.012, 0.42, (0, 0.31, -0.014), Gunmetal, rot=AXIS_Y, seg=12)                             # magazine tube
m.cyl(0.025, 0.17, (0, 0.27, -0.014), Wood, rot=AXIS_Y, seg=10, bevel=0.005)                    # pump
for i in range(5):
    m.torus(0.025, 0.003, (0, 0.21 + i * 0.03, -0.014), Wood, rot=AXIS_Y, seg=10, sub=4)        # pump grooves
m.box((0.03, 0.012, 0.045), (0, 0.5, 0.001), Gunmetal, bevel=0.003)                             # barrel band
m.sphere(0.004, (0, 0.61, 0.031), Brass, seg=6, rings=4)                                        # bead sight
m.prism([(-0.095, 0.032), (-0.095, -0.032), (-0.17, -0.05), (-0.43, -0.105), (-0.445, -0.1),
         (-0.445, 0.01), (-0.24, 0.03)], 0.04, (0, 0, 0), Wood, bevel=0.007)                    # stock
m.box((0.008, 0.06, 0.006), (0, -0.04, -0.05), Gunmetal, bevel=0.002)
m.box((0.006, 0.006, 0.02), (0, -0.04, -0.04), Steel, rot=(0.3, 0, 0))
m.finish(weapons, (0.5, -1.5, WZ))

m = Model('Rifle')
m.box((0.045, 0.27, 0.06), (0, 0, 0), Gunmetal, bevel=0.006)                                    # receiver
m.box((0.04, 0.21, 0.022), (0, -0.015, 0.038), Gunmetal, bevel=0.009)                           # dust cover
m.box((0.047, 0.2, 0.052), (0, 0.235, 0.0), Wood, bevel=0.013)                                  # handguard
m.cyl(0.009, 0.3, (0, 0.47, 0.006), Gunmetal, rot=AXIS_Y, seg=10)                               # barrel
m.cyl(0.008, 0.21, (0, 0.24, 0.036), Gunmetal, rot=AXIS_Y, seg=10)                              # gas tube
m.box((0.014, 0.02, 0.05), (0, 0.55, 0.03), Gunmetal, bevel=0.003)                              # front sight
m.cyl(0.013, 0.045, (0, 0.635, 0.006), Gunmetal, rot=AXIS_Y, seg=10, bevel=0.003)               # muzzle brake
m.box((0.014, 0.03, 0.014), (0, 0.11, 0.052), Gunmetal, bevel=0.003)                            # rear sight
m.prism([(0.025, -0.028), (0.09, -0.028), (0.125, -0.12), (0.15, -0.205), (0.092, -0.222),
         (0.066, -0.13)], 0.03, (0, 0, 0), Steel, bevel=0.004)                                  # curved magazine
m.box((0.032, 0.042, 0.095), (0, -0.095, -0.072), Wood, rot=(-0.3, 0, 0), bevel=0.009)          # pistol grip
m.box((0.008, 0.07, 0.006), (0, -0.035, -0.055), Gunmetal, bevel=0.002)                         # trigger guard
m.box((0.006, 0.006, 0.022), (0, -0.04, -0.04), Steel, rot=(0.3, 0, 0))
m.prism([(-0.135, 0.026), (-0.135, -0.022), (-0.39, -0.08), (-0.405, -0.075), (-0.405, 0.036),
         (-0.37, 0.042)], 0.036, (0, 0, 0), Wood, bevel=0.006)                                  # stock
m.box((0.01, 0.03, 0.012), (0.027, 0.04, 0.02), Steel, bevel=0.003)                             # charging handle
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
EXPORT = [o for c in (char, weapons, props) for o in c.objects]
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
