"""Turn a recorded animation (Mixamo FBX, one loop of a run or walk) into joint angles for the game's NPC.

    blender -b -P models/import_anim.py -- assets/run.json Running.fbx

The NPC is posed by ten joints between eleven rigid bodies (JOINTS in ragdoll.js), each a rotation of the child
body relative to its parent, all of them zero in the rest pose (standing, arms straight down). So for every frame
this takes the bone that stands for each body, works out how far it has turned from where it is in that rest pose,
and writes the parent-to-child difference for every joint, plus the turn of the pelvis itself.
Frames are shifted so that frame 0 is phase 0 of the game's walk cycle (the game's L leg furthest forward at a quarter).
"""
import bpy, sys, json, math
from mathutils import Matrix, Vector

OUT, SRC = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
pre = arm.data.bones[0].name.split(':')[0] + ':' if ':' in arm.data.bones[0].name else ''
rest = {b.name[len(pre):]: (arm.matrix_world @ b.matrix_local) for b in arm.data.bones}
head = lambda n: rest[n].to_translation()

# face +Y like the converted characters do; the game's L is +X
toes = head('LeftToeBase') - head('LeftFoot')
turn = Matrix.Rotation(math.pi, 3, 'Z') if toes.y < 0 else Matrix.Identity(3)
flip = (turn @ head('LeftArm')).x < 0
side = lambda s: ('Right' if s == 'L' else 'Left') if flip else ('Left' if s == 'L' else 'Right')

BONE = {'pelvis': 'Hips', 'torso': 'Spine1', 'head': 'Head'}
for s in 'LR':
    BONE.update({'uarm' + s: side(s) + 'Arm', 'farm' + s: side(s) + 'ForeArm', 'thigh' + s: side(s) + 'UpLeg', 'shin' + s: side(s) + 'Leg'})
JOINTS = {'spine': ('pelvis', 'torso'), 'neck': ('torso', 'head')}
for s in 'LR':
    JOINTS.update({'shoulder' + s: ('torso', 'uarm' + s), 'elbow' + s: ('uarm' + s, 'farm' + s), 'hip' + s: ('pelvis', 'thigh' + s), 'knee' + s: ('thigh' + s, 'shin' + s)})

# each bone's orientation in the game's rest pose: as modelled, except the arms, which hang straight down
ref = {}
for part, b in BONE.items():
    r = turn @ rest[b].to_3x3().normalized()
    if 'arm' in part:
        r = (r @ Vector((0, 1, 0))).rotation_difference(Vector((0, 0, -1))).to_matrix() @ r
    ref[part] = r

def three(q):                  # Blender (Z up, facing +Y) -> three.js (Y up, facing -Z), as [x, y, z, w]
    return [round(v, 4) for v in (q.x, q.z, -q.y, q.w)]

act = bpy.data.actions[0]
f0, f1 = (int(v) for v in act.frame_range)
frames = []
for f in range(f0, f1):        # the last frame repeats the first
    bpy.context.scene.frame_set(f)
    D = {}
    for part, b in BONE.items():
        now = turn @ (arm.matrix_world @ arm.pose.bones[pre + b].matrix).to_3x3().normalized()
        D[part] = now @ ref[part].inverted()
    row = {'pelvis': D['pelvis'].to_quaternion()}
    for j, (a, c) in JOINTS.items():
        row[j] = (D[a].inverted() @ D[c]).to_quaternion()
    frames.append((row, (D['thighL'] @ Vector((0, 0, -1))).y))      # how far forward the game's L thigh points

n = len(frames)
peak = max(range(n), key=lambda i: frames[i][1])
shift = peak - n // 4
out = {name: [three(frames[(i + shift) % n][0][name]) for i in range(n)] for name in ['pelvis'] + list(JOINTS)}
json.dump({'frames': n, 'joints': out}, open(OUT, 'w'), separators=(',', ':'))
print('WROTE', OUT, 'frames', n, 'shift', shift, 'flip', flip)
