"""Renders the pictures in models/previews from the models currently in the .blend.

Run after build_models.py, in the same Blender session or from the command line:
    blender -b models/impactbox-models.blend -P models/build_models.py -P models/render_previews.py
"""
import bpy
import glob
import os

HERE = os.path.dirname(bpy.data.filepath)
PREV = os.path.join(HERE, 'previews')
os.makedirs(PREV, exist_ok=True)

ns = {'ONLY': set()}                       # load the kit and materials without rebuilding any model
for f in ('kit.py', 'materials.py'):
    p = os.path.join(HERE, f)
    exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), ns)
ns['preview_nodes'](True)                  # show the baked shading and wear
if not bpy.data.objects.get('Camera'):
    ns['studio']()
shot = ns['shot']


def names(collection):
    return [o.name for o in bpy.data.collections[collection].objects]


for old in glob.glob(os.path.join(PREV, '*.png')):
    os.remove(old)

def laid_out(group, path, pitch=0.30, res=(1400, 560)):
    """Lay the weapons on their sides in a row, as on a table, photograph them from above, put them back."""
    keep = []
    x = 0.0
    for n in group:
        o = bpy.data.objects[n]
        keep.append((o, o.location.copy(), o.rotation_euler.copy()))
        o.rotation_euler = (0, -1.5708, 0)
        o.location = (40.0 + x, 0.0, 1.0)
        x += max(pitch, o.dimensions.z + 0.10)
    bpy.context.view_layer.update()
    shot(group, path, view=(0.0, -0.001, 1.0), res=res, margin=1.06)
    for o, loc, rot in keep:
        o.location, o.rotation_euler = loc, rot


GUNS = ['Pistol', 'Revolver', 'SMG', 'Shotgun', 'Rifle', 'Sniper', 'RocketLauncher', 'Rocket', 'GrabGun', 'Machete', 'Knife',
        'Grenade']
laid_out(GUNS, os.path.join(PREV, 'weapons.png'))
laid_out([n for n in names('Weapons') if n not in GUNS], os.path.join(PREV, 'armoury.png'))
shot(names('Hands'), os.path.join(PREV, 'hands.png'), view=(-0.5, -0.6, 1.0), res=(1100, 560))
shot([n for n in names('Props') if n != 'Car'], os.path.join(PREV, 'props.png'), view=(0.5, -1.0, 0.6), res=(1280, 600))
shot(['Car'], os.path.join(PREV, 'car.png'), view=(-0.8, 1.0, 0.35), res=(1100, 560))
shot(names('Character'), os.path.join(PREV, 'character.png'), view=(0.3, 1.0, 0.1), res=(560, 900))
shot(names('Character'), os.path.join(PREV, 'face.png'), view=(0.45, 1.0, 0.08), res=(640, 640), focus=((0, 0, 1.68), 0.16))
shot(names('Accessories'), os.path.join(PREV, 'headwear.png'), view=(0.4, 1.0, 0.3), res=(1100, 420))

for o in bpy.data.objects:                 # leave everything visible for whoever opens the file
    o.hide_render = False
bpy.ops.wm.save_mainfile()
print('previews:', sorted(os.path.basename(f) for f in glob.glob(os.path.join(PREV, '*.png'))))
