"""Render the added asset library with the scene's existing Eevee stage.

blender -b models/impactbox-models.blend -P models/preview_library.py
Writes individual PNGs into models/previews/library/. Does not save the scene.
Accessories are shown attached to a copy of Head, with both local origins aligned.
"""
import bpy
import json
import os
from mathutils import Vector

GROUPS = {
    'melee': ['Axe', 'BaseballBat', 'Crowbar', 'Katana', 'Chainsaw', 'SledgeHammer'],
    'guns': ['DoubleBarrel', 'Uzi', 'Minigun', 'Crossbow', 'Flamethrower'],
    'props': ['Chair', 'Table', 'TrafficCone', 'PropaneTank', 'WoodenPallet',
              'Dumpster', 'StreetLamp', 'SandbagWall', 'Toilet', 'Car'],
    'accessories': ['PoliceCap', 'HardHat', 'CombatHelmet', 'Balaclava'],
}

root = os.path.dirname(os.path.dirname(bpy.data.filepath))
out = os.path.join(root, 'models', 'previews', 'library')
os.makedirs(out, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 720
scene.render.resolution_y = 540
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
cam = scene.camera
cam.data.type = 'ORTHO'
cam.data.lens = 50
cam.data.clip_start = 0.001
cam.data.clip_end = 200

for ob in bpy.data.objects:
    if ob.type == 'MESH':
        ob.hide_render = True

metadata = {}
for group, names in GROUPS.items():
    for name in names:
        src = bpy.data.objects[name]
        ob = bpy.data.objects.new('PreviewAsset', src.data)
        scene.collection.objects.link(ob)
        extras = []
        if group == 'accessories':
            head = bpy.data.objects.new('PreviewHead', bpy.data.objects['Head'].data)
            scene.collection.objects.link(head)
            extras.append(head)
        scene.view_layers.update()
        points = [Vector(p) for item in [ob] + extras for p in item.bound_box]
        centre = (Vector(tuple(min(p[i] for p in points) for i in range(3))) +
                  Vector(tuple(max(p[i] for p in points) for i in range(3)))) / 2
        direction = Vector((1.65, 1.1, 1.1) if group in ('melee', 'guns') else (1.4, 1.8, 1.05))
        if group == 'accessories':
            direction = Vector((0.65, 2.2, 0.65))
        if name == 'StreetLamp':
            direction = Vector((1.5, 2.0, 0.4))
        cam.location = centre + direction.normalized() * 12
        cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.view_layers.update()
        local = [cam.matrix_world.inverted() @ p for p in points]
        width = max(p.x for p in local) - min(p.x for p in local)
        height = max(p.y for p in local) - min(p.y for p in local)
        cam.data.ortho_scale = max(width, height * 4 / 3) * 1.17
        scene.render.filepath = os.path.join(out, name + '.png')
        bpy.ops.render.render(write_still=True)
        metadata[name] = {
            'group': group,
            'triangles': sum(len(p.vertices) - 2 for p in src.data.polygons),
            'dimensions': [round(v, 3) for v in src.dimensions],
        }
        bpy.data.objects.remove(ob, do_unlink=True)
        for item in extras:
            bpy.data.objects.remove(item, do_unlink=True)
with open(os.path.join(out, 'manifest.json'), 'w') as f:
    json.dump(metadata, f, indent=2)
print('Rendered', len(metadata), 'library previews into', out)
