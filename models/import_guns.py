"""Bring downloaded gun models into the game (assets/weapons.glb), replacing the built ones of the same name.

Source: "Free CC0 Guns & Explosives Pack" by 3dmodelscc0 (public domain),
https://3dmodelscc0.itch.io/free-cc0-guns-explosives-pack - unpack it and pass the folder:

    blender -b -P models/import_guns.py -- <folder with AK-47, M4A1, ...> assets/weapons.glb

Each gun is turned to the game's convention (barrel along +Y, up +Z), and moved so its trigger sits where
the old model's trigger was: the hands in weapons.js VIEW are placed round that, so they still fit.
It prints the muzzle, sight height and support-hand height of every gun, for VIEW.
"""
import bpy, sys, os, json
import numpy as np
from mathutils import Vector, Matrix

SRC, OUT = sys.argv[sys.argv.index('--') + 1:]
SCALE = {'Pistol': 0.88}    # this file's pistol is oversized; this fits the gloved hands
TEX = 1024           # textures are shrunk to this: the originals are 4k and would make the download huge

# game name: (folder, file, texture prefix, normal map is DirectX-style, old trigger centre (y, z), old support hand y)
GUNS = {
    'Pistol':  ('Pistol_MK', 'Makarov.fbx', 'Makarov', False, (0.007, -0.010), None),
    'SMG':     ('GreaseGun', 'Grease_Gun.fbx', 'Grease_Gun', True, (-0.016, -0.0465), 0.125),
    'Shotgun': ('Shotgun', 'Shotgun.fbx', 'Shotgun', True, (-0.035, -0.048), 0.27),
    'Rifle':   ('AK-47', 'AK47.fbx', 'AK47', True, (-0.031, -0.043), 0.235),
    'AR15':    ('M4A1', 'M4A1.fbx', 'M4A1', False, (0.007, -0.035), 0.255),
    'Sniper':  ('Sniper', 'Sniper.fbx', 'Sniper', False, (-0.049, -0.0485), 0.2),
}


def image(path, flip_green=False):
    img = bpy.data.images.load(path)
    if max(img.size) > TEX:
        img.scale(TEX, TEX)
    if flip_green:                       # DirectX normal maps point the other way up
        px = np.empty(TEX * TEX * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px[1::4] = 1.0 - px[1::4]
        img.pixels.foreach_set(px)
    img.pack()
    return img


def material(name, folder, prefix, directx):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']

    def tex(suffix, colour, flip=False):
        for s in (suffix, suffix + '_DirectX'):
            p = os.path.join(folder, f'{prefix}_{s}.png')
            if os.path.isfile(p):
                n = nt.nodes.new('ShaderNodeTexImage')
                n.image = image(p, flip)
                if not colour:
                    n.image.colorspace_settings.name = 'Non-Color'
                return n
        return None

    base, metal, rough, normal = tex('Base_Color', True), tex('Metallic', False), tex('Roughness', False), tex('Normal', False, directx)
    if base: nt.links.new(base.outputs['Color'], bsdf.inputs['Base Color'])
    if metal: nt.links.new(metal.outputs['Color'], bsdf.inputs['Metallic'])
    if rough: nt.links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
    if normal:
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(normal.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def band(co, lo, hi):
    """Vertices with lo <= y < hi."""
    return co[(co[:, 1] >= lo) & (co[:, 1] < hi)]


ref, made = {}, []
bpy.ops.wm.read_factory_settings(use_empty=True)
for name, (folder, fbx, prefix, directx, trig, hand_y) in GUNS.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, folder, fbx))
    meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    trigger = next((o for o in meshes if 'trigger' in o.name.lower()), None)
    tpos = barrel = None
    for o in meshes:                     # bake every object's placement into its vertices
        world = o.matrix_world.copy()
        o.parent = None
        o.data.transform(world)
        o.matrix_world = Matrix.Identity(4)
        if o.name.lower().startswith('barrel'):
            barrel = [v.co[:] for v in o.data.vertices]
        if o is trigger:
            tpos = sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
    for o in bpy.data.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    gun = bpy.context.view_layer.objects.active
    for o in [o for o in bpy.data.objects if o not in before and o is not gun]:
        bpy.data.objects.remove(o)       # empties the file came with
    me = gun.data
    co = np.array([v.co[:] for v in me.vertices])

    # which end is the muzzle (the thin one), and which way is up (most of a gun hangs below its barrel)
    y0, y1 = co[:, 1].min(), co[:, 1].max()
    L = y1 - y0
    a, b = band(co, y0, y0 + L * 0.08), band(co, y1 - L * 0.08, y1 + 1)
    turn = Matrix.Identity(4)
    if np.ptp(a[:, 2]) < np.ptp(b[:, 2]):                    # muzzle at -Y: turn it round
        turn = Matrix.Rotation(np.pi, 4, 'Z')
        a, b = b, a
    bore = (b[:, 2].min() + b[:, 2].max()) / 2
    if co[:, 2].max() - bore > bore - co[:, 2].min():       # upside down
        turn = Matrix.Rotation(np.pi, 4, 'Y') @ turn
    turn = Matrix.Scale(SCALE.get(name, 1), 4) @ turn
    me.transform(turn)
    co = np.array([v.co[:] for v in me.vertices])
    # the sniper rifle's file has it lying at an angle: level it by the line of its barrel
    if name == 'Sniper' and barrel is not None:
        f = np.array([(turn @ Vector(v))[:] for v in barrel])[:, 1:]
        ax = np.linalg.svd(f - f.mean(axis=0), full_matrices=False)[2][0]
        tilt = np.arctan2(ax[1], ax[0]) if ax[0] > 0 else np.arctan2(-ax[1], -ax[0])
        level = Matrix.Rotation(-tilt, 4, 'X')
        me.transform(level)
        turn = level @ turn
        co = np.array([v.co[:] for v in me.vertices])
    if tpos is not None:
        tpos = turn @ tpos
    if tpos is None:                     # no separate trigger: guess just behind the middle, under the bore
        tpos = Vector((0, co[:, 1].mean(), co[:, 2].mean()))
    shift = Vector((-(co[:, 0].min() + co[:, 0].max()) / 2, trig[0] - tpos.y, trig[1] - tpos.z))
    me.transform(Matrix.Translation(shift))
    co = co + np.array(shift)

    me.materials.clear()
    me.materials.append(material(name + 'Tex', os.path.join(SRC, folder), prefix, directx))
    for p in me.polygons:
        p.material_index = 0
        p.use_smooth = True
    gun.name = me.name = name
    made.append(gun)

    # what weapons.js needs to know about it
    y1 = co[:, 1].max()
    tip = band(co, y1 - 0.02, y1 + 1)
    front = band(co, y1 - (y1 - co[:, 1].min()) * 0.3, y1 + 1)
    r = {'length': round(float(y1 - co[:, 1].min()), 3), 'muzzle': [round(float(y1), 3), round(float((tip[:, 2].min() + tip[:, 2].max()) / 2), 4)],
         'sight': round(float(front[:, 2].max()), 4), 'top': round(float(co[:, 2].max()), 4)}
    if hand_y:
        hy = min(hand_y, y1 * 0.6)
        under = next(v for v in (band(co, hy - w, hy + w) for w in (0.03, 0.08, 0.2, 9)) if len(v))   # low-poly: widen until there is something
        r['handL'] = [round(float(hy), 3), round(float(under[:, 2].min()) + 0.002, 4)]
    ref[name] = r

for o in bpy.data.objects:
    o.select_set(o in made)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                          export_normals=True, export_tangents=False, export_animations=False, export_skins=False,
                          export_image_format='JPEG', export_image_quality=85)
print('REF ' + json.dumps(ref))
print('BYTES', os.path.getsize(OUT))
