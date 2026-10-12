"""Builds every IMPACTBOX model procedurally and exports assets/models.glb.

Run inside Blender with models/impactbox-models.blend open (Scripting tab > Run Script).
The work is split over the files next to this one:
  kit.py        the modelling kit: primitives, baked normals / shading / edge wear, export
  materials.py  every material, and what the game should do with it
  guns.py, guns2.py, melee.py, extras.py   weapons
  hands.py      first-person hands (and the hand builder the NPCs share)
  props.py, car.py   things in the yard
  character.py  the NPC body
  hats.py       headwear

Conventions: metres, Z up, +Y is "forward" (becomes -Z in three.js after glTF export).
Each model is one object whose origin is the point the game attaches it by:
  - character parts: the character's feet (they are skinned, see character.py)
  - weapons: the grip          - props: centre of the collider
Material names are part of the contract: the game re-tints Skin / Shirt / Pants / Hair per NPC.

To rebuild only some models while working, set ONLY = {'Pistol', ...} before running.
"""
import bpy
import os
import time

assert bpy.data.filepath.endswith("impactbox-models.blend"), "open models/impactbox-models.blend first"
HERE = os.path.dirname(bpy.data.filepath)
ROOT = os.path.dirname(HERE)
PARTS = ['kit.py', 'materials.py', 'guns.py', 'guns2.py', 'melee.py', 'extras.py', 'hands.py', 'props.py', 'car.py',
         'character.py', 'hats.py']
EXPORTED = ('Character', 'Weapons', 'Hands', 'Props', 'Accessories')

ns = {'ONLY': globals().get('ONLY'), 'FAST': globals().get('FAST', False)}
t0 = time.time()

if ns['ONLY'] is None:                      # a full build starts from an empty file
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for b in list(block):
            block.remove(b)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)

for f in PARTS:
    p = os.path.join(HERE, f)
    if os.path.exists(p):
        exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), ns)

ns['studio']()
EXPORT = [o for c in EXPORTED if bpy.data.collections.get(c) for o in bpy.data.collections[c].objects]
out = os.path.join(ROOT, 'assets', 'models.glb')
size = ns['export_glb'](EXPORT, out)
bpy.ops.wm.save_mainfile()

result = {
    'exported': out,
    'bytes': size,
    'seconds': round(time.time() - t0, 1),
    'models': len(EXPORT),
    'triangles': sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in EXPORT),
    'built': ns['BUILT'],
    'ref': ns.get('REF', {}),      # sight heights, muzzles and hand positions for weapons.js
}
