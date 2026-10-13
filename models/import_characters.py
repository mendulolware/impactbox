"""Turn downloaded, rigged characters (Mixamo FBX) into NPC bodies for the game: assets/characters.glb.

    blender -b -P models/import_characters.py -- assets/characters.glb <one.fbx> <two.fbx> ...

The game's NPC is eleven rigid bodies with fixed joints (PARTS / JOINTS in ragdoll.js) and a body mesh cut
into a piece per rigid body, each vertex following one or two of them. So for every character this:
  1. stands it in the game's rest pose (facing +Y, arms straight down, feet together), moving each of its
     joints onto the ragdoll's joint and stretching the limb between them to fit;
  2. bakes that pose into the mesh;
  3. gives every vertex its two strongest ragdoll bodies, from the character's own skin weights (_skin);
  4. cuts the mesh into a piece per body along where those weights change hands, and closes each cut
     with a cap of flesh (hidden until the joint parts);
  5. shrinks the textures and writes everything out as <Name>_<part> objects.
"""
import bpy, sys, os, math
import bmesh
from mathutils import Vector, Matrix

OUT, *FILES = sys.argv[sys.argv.index('--') + 1:]
TEX = 1024
HEIGHT = 1.82                 # the game's NPC, crown of the head
PARTS = ['pelvis', 'torso', 'head', 'uarmL', 'farmL', 'uarmR', 'farmR', 'thighL', 'shinL', 'thighR', 'shinR']   # order = bone index in the game
AX, LX = 0.21, 0.10           # arms and legs hang this far out from the centre line
SPINE, NECK, SHOULDER, ELBOW, WRIST, HIP, KNEE = 1.10, 1.56, 1.45, 1.16, 0.88, 0.95, 0.46


def part_of(bone, flip):
    """Which ragdoll body a character's bone belongs to. flip: its 'Left' is on the game's R side."""
    if 'Eye' in bone or bone.startswith('Head'):
        return 'head'
    side = 'L' if bone.startswith('Left') else 'R' if bone.startswith('Right') else None
    if side is None:
        return 'pelvis' if bone == 'Hips' else 'torso'
    n = bone[4:] if side == 'L' else bone[5:]
    if flip:
        side = 'R' if side == 'L' else 'L'
    if n == 'Shoulder': return 'torso'
    if n == 'Arm': return 'uarm' + side
    if n.startswith('ForeArm') or n.startswith('Hand'): return 'farm' + side
    if n == 'UpLeg': return 'thigh' + side
    return 'shin' + side


bpy.ops.wm.read_factory_settings(use_empty=True)
flesh = bpy.data.materials.new('Flesh')
flesh.use_nodes = True
flesh.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.3, 0.02, 0.02, 1)
flesh.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.35
made = []

for path in FILES:
    name = os.path.basename(path).split('_')[0].split('.')[0]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = [o for o in new if o.type == 'MESH']
    pre = arm.data.bones[0].name.split(':')[0] + ':' if ':' in arm.data.bones[0].name else ''
    W = lambda n: arm.matrix_world @ arm.data.bones[pre + n].head_local

    # ---- 1. stand it in the game's rest pose
    toes = W('LeftToeBase') - W('LeftFoot')
    turn = Matrix.Rotation(math.pi, 4, 'Z') if toes.y < 0 else Matrix.Identity(4)       # face +Y
    k = HEIGHT / (W('HeadTop_End').z + 0.04)
    fit = Matrix.Scale(k, 4) @ turn
    for o in [arm] + [m for m in meshes if m.parent is not arm]:
        o.matrix_world = fit @ o.matrix_world
    bpy.context.view_layer.update()
    for b in arm.data.bones:
        b.inherit_scale = 'NONE'                 # so stretching a limb does not fatten what hangs off it
    rest = {b.name[len(pre):]: arm.matrix_world @ b.head_local for b in arm.data.bones}
    flip = rest['LeftArm'].x < 0                  # the game's L is +X
    dy = -rest['LeftUpLeg'].y                     # hip joints onto the centre plane
    zs, zn = rest['Spine'].z, rest['Neck'].z
    up = lambda z: SPINE + (z - zs) * (NECK - SPINE) / (zn - zs)

    T = {'Hips': Vector((0, rest['Hips'].y + dy, HIP + rest['Hips'].z - rest['LeftUpLeg'].z))}
    for n in ('Spine', 'Spine1', 'Spine2', 'Neck'):
        T[n] = Vector((0, rest[n].y + dy, up(rest[n].z)))
    T['Head'] = Vector((0, rest['Head'].y + dy, NECK + rest['Head'].z - zn))
    for S in ('Left', 'Right'):
        s = (-1 if flip else 1) * (1 if S == 'Left' else -1)
        ya = rest[S + 'Arm'].y + dy
        T[S + 'Shoulder'] = Vector((rest[S + 'Shoulder'].x, rest[S + 'Shoulder'].y + dy, up(rest[S + 'Shoulder'].z)))
        T[S + 'Arm'] = Vector((s * AX, ya, SHOULDER))
        T[S + 'ForeArm'] = Vector((s * AX, ya, ELBOW))
        T[S + 'Hand'] = Vector((s * AX, ya, WRIST))
        T[S + 'UpLeg'] = Vector((s * LX, 0, HIP))
        T[S + 'Leg'] = Vector((s * LX, 0, KNEE))
        T[S + 'Foot'] = Vector((s * LX, 0, rest[S + 'Foot'].z))

    def place(bone, toward=None, like=None):
        """Put a bone's joint on its target. toward: the next joint, which it is turned and stretched to reach."""
        pb = arm.pose.bones[pre + bone]
        axes = (arm.matrix_world @ pb.bone.matrix_local).to_3x3()
        rot = like if like is not None else Matrix.Identity(3)
        if toward:
            d = T[toward] - T[bone]
            rot = (rest[toward] - rest[bone]).normalized().rotation_difference(d.normalized()).to_matrix()
            axes = rot @ axes
            f = d.length / (rest[toward] - rest[bone]).length
            for i in range(3):
                axes[i][1] *= f                  # stretch along the bone only
        else:
            axes = rot @ axes
        pb.matrix = arm.matrix_world.inverted() @ Matrix.Translation(T[bone]) @ axes.to_4x4()
        bpy.context.view_layer.update()
        return rot

    place('Hips'); place('Spine', 'Spine1'); place('Spine1', 'Spine2'); place('Spine2', 'Neck'); place('Neck', 'Head'); place('Head')
    for S in ('Left', 'Right'):
        place(S + 'Shoulder', S + 'Arm')
        place(S + 'Arm', S + 'ForeArm')
        r = place(S + 'ForeArm', S + 'Hand')
        place(S + 'Hand', like=r)                # the hand carries on down the line of the forearm
        place(S + 'UpLeg', S + 'Leg')
        place(S + 'Leg', S + 'Foot')
        place(S + 'Foot')

    # ---- 2, 3. bake the pose; two strongest ragdoll bodies per vertex
    dg = bpy.context.evaluated_depsgraph_get()
    posed = []
    for o in meshes:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(o.matrix_world)
        to_part = [PARTS.index(part_of(g.name[len(pre):], flip)) for g in o.vertex_groups]
        skin = me.attributes.new('_skin', 'FLOAT_VECTOR', 'POINT')
        main = me.attributes.new('vp', 'INT', 'POINT')
        for v in me.vertices:
            w = [0.0] * len(PARTS)
            for g in v.groups:
                w[to_part[g.group]] += g.weight
            order = sorted(range(len(PARTS)), key=lambda i: -w[i])
            a, b = order[0], order[1]
            wa = w[a] / (w[a] + w[b]) if w[a] + w[b] > 0 else 1.0
            skin.data[v.index].vector = (a, b, wa)
            main.data[v.index].value = a
        p = bpy.data.objects.new(o.name + '_posed', me)
        bpy.context.scene.collection.objects.link(p)
        posed.append(p)
    for o in new:
        bpy.data.objects.remove(o)
    for o in bpy.data.objects:
        o.select_set(o in posed)
    bpy.context.view_layer.objects.active = posed[0]
    bpy.ops.object.join()
    whole = bpy.context.view_layer.objects.active
    whole.data.materials.append(flesh)
    cap_slot = len(whole.data.materials) - 1
    lo = min(v.co.z for v in whole.data.vertices)
    whole.data.transform(Matrix.Translation((0, 0, -lo)))       # soles on the ground

    # ---- 4. a piece per body, each cut closed with flesh
    bm = bmesh.new()
    bm.from_mesh(whole.data)
    vp = bm.verts.layers.int['vp']
    fp = bm.faces.layers.int.new('fp')
    cut = bm.edges.layers.int.new('cut')
    for f in bm.faces:
        votes = [v[vp] for v in f.verts]
        f[fp] = max(set(votes), key=votes.count)
        f.smooth = True
    for e in bm.edges:
        if len({f[fp] for f in e.link_faces}) > 1:
            e[cut] = 1
    for i, part in enumerate(PARTS):
        pb = bm.copy()
        fpl, cutl = pb.faces.layers.int['fp'], pb.edges.layers.int['cut']
        bmesh.ops.delete(pb, geom=[f for f in pb.faces if f[fpl] != i], context='FACES')
        if not pb.faces:
            pb.free(); continue
        rim = [e for e in pb.edges if e[cutl] and e.is_boundary]
        caps = bmesh.ops.holes_fill(pb, edges=rim, sides=0)['faces'] if rim else []
        if caps:
            caps = bmesh.ops.triangulate(pb, faces=caps)['faces']
            for f in caps:
                f.material_index = cap_slot
                f.smooth = False
            bmesh.ops.recalc_face_normals(pb, faces=caps)
        me = bpy.data.meshes.new(f'{name}_{part}')
        pb.to_mesh(me)
        pb.free()
        for m in whole.data.materials:
            me.materials.append(m)
        o = bpy.data.objects.new(f'{name}_{part}', me)
        bpy.context.scene.collection.objects.link(o)
        made.append(o)
        print('PART', name, part, 'faces', len(me.polygons), 'caps', len(caps))
    bm.free()
    bpy.data.objects.remove(whole)

# ---- 5. textures down to size, and out
for m in bpy.data.materials:                     # the old-style shine maps read as wet latex in the game: plain cloth instead
    bsdf = m.node_tree and m.node_tree.nodes.get('Principled BSDF')
    if not bsdf or m is flesh:
        continue
    for n, v in (('Metallic', 0.0), ('Roughness', 0.8), ('Specular IOR Level', 0.5)):
        for l in list(bsdf.inputs[n].links):
            m.node_tree.links.remove(l)
        bsdf.inputs[n].default_value = v
for im in bpy.data.images:
    if im.size[0] > TEX or im.size[1] > TEX:
        im.scale(TEX, TEX)
        im.pack()
for o in bpy.data.objects:
    o.select_set(o in made)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                          export_normals=True, export_tangents=False, export_animations=False, export_skins=False,
                          export_attributes=True, export_image_format='WEBP', export_image_quality=80)
print('BYTES', os.path.getsize(OUT), 'objects', len(made))
