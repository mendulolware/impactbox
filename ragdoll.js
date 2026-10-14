import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { getModel, bodyPieces, bodyWhole, isCap, looks, tintedMaterial } from './models.js';
import { openWound, burn, makeStump } from './wounds.js';
import { Brain } from './brain.js';

// An NPC has two lives:
//   'anim'    - bodies are kinematic and follow a procedural animation chosen by its Brain (brain.js)
//   'ragdoll' - bodies are dynamic and hang off joints (heavy hits, falls, explosions, death)
//   'getup'   - kinematic blend from wherever the ragdoll ended up back into the animation
// Parts that have been cut off are always dynamic.
//
// The ragdoll is "active": muscles() pulls every joint toward a pose with a strength called tone.
// A living body braces as it falls and writhes when badly hurt; a dead one loses tone over a
// second or so and goes limp. Light hits on a standing NPC make it flinch instead of collapse.
//
// Being hurt shows: a wrecked arm hangs dead while its owner keeps walking, a bad leg limps, a hand
// goes to a gut wound, wounds drip and leave a trail, blood loss ends in a collapse, and someone who
// cannot stand drags themselves along the ground. Hard landings break things too.

const VOICES = false;        // NPC screams, grunts, death cries and zombie growls: switched off (set true to bring them back)
const UP = new THREE.Vector3(0, 1, 0);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const CRAWL_PULL = 12;     // m/s^2 an arm can drag the body with

// Body layout (feet at y = 0, character faces -Z). pos = part centre.
const PARTS = {
  pelvis: { shape: 'box', half: [0.17, 0.09, 0.10], pos: [0, 1.00, 0], hp: 70, role: 'pants' },
  torso:  { shape: 'box', half: [0.18, 0.22, 0.10], pos: [0, 1.33, 0], hp: 90, role: 'shirt' },
  head:   { shape: 'ball', r: 0.12,                  pos: [0, 1.70, 0], hp: 32, role: 'skin' },
  uarmL:  { shape: 'cap', h: 0.12, r: 0.050, pos: [0.21, 1.33, 0], hp: 36, role: 'shirt' },
  farmL:  { shape: 'cap', h: 0.11, r: 0.045, pos: [0.21, 1.005, 0], hp: 30, role: 'skin' },
  uarmR:  { shape: 'cap', h: 0.12, r: 0.050, pos: [-0.21, 1.33, 0], hp: 36, role: 'shirt' },
  farmR:  { shape: 'cap', h: 0.11, r: 0.045, pos: [-0.21, 1.005, 0], hp: 30, role: 'skin' },
  thighL: { shape: 'cap', h: 0.17, r: 0.075, pos: [0.10, 0.705, 0], hp: 46, role: 'pants' },
  shinL:  { shape: 'cap', h: 0.17, r: 0.060, pos: [0.10, 0.23, 0], hp: 38, role: 'pants' },
  thighR: { shape: 'cap', h: 0.17, r: 0.075, pos: [-0.10, 0.705, 0], hp: 46, role: 'pants' },
  shinR:  { shape: 'cap', h: 0.17, r: 0.060, pos: [-0.10, 0.23, 0], hp: 38, role: 'pants' },
};

// a = parent, b = child; anchor in character space. Listed parent-first (the animation relies on it).
// cut = half-widths of the wound left when the joint parts, kind = what that wound looks like.
// cone = soft swing limit (radians) while ragdolled, measured from the middle of the joint's range:
// ref = [forward, outward] says where that middle is (a hip swings far forward and hardly back).
const JOINTS = [
  { name: 'spine',     a: 'pelvis', b: 'torso',  anchor: [0, 1.10, 0], cut: [0.15, 0.095], kind: 'gut', cone: 0.6, ref: [-0.15, 0] },
  { name: 'neck',      a: 'torso',  b: 'head',   anchor: [0, 1.56, 0], cut: [0.052, 0.052], kind: 'neck', cone: 0.7, ref: [-0.1, 0] },
  { name: 'shoulderL', a: 'torso',  b: 'uarmL',  anchor: [0.21, 1.45, 0], cut: [0.05, 0.05], kind: 'limb', cone: 2.0, ref: [0.5, 0.5] },
  { name: 'elbowL',    a: 'uarmL',  b: 'farmL',  anchor: [0.21, 1.16, 0], cut: [0.043, 0.043], kind: 'limb2', axis: [1, 0, 0], limits: [0, 2.4] },
  { name: 'shoulderR', a: 'torso',  b: 'uarmR',  anchor: [-0.21, 1.45, 0], cut: [0.05, 0.05], kind: 'limb', cone: 2.0, ref: [0.5, -0.5] },
  { name: 'elbowR',    a: 'uarmR',  b: 'farmR',  anchor: [-0.21, 1.16, 0], cut: [0.043, 0.043], kind: 'limb2', axis: [1, 0, 0], limits: [0, 2.4] },
  { name: 'hipL',      a: 'pelvis', b: 'thighL', anchor: [0.10, 0.95, 0], cut: [0.075, 0.075], kind: 'limb', cone: 1.15, ref: [0.55, 0.1] },
  { name: 'kneeL',     a: 'thighL', b: 'shinL',  anchor: [0.10, 0.46, 0], cut: [0.058, 0.058], kind: 'limb2', axis: [1, 0, 0], limits: [-2.4, 0] },
  { name: 'hipR',      a: 'pelvis', b: 'thighR', anchor: [-0.10, 0.95, 0], cut: [0.075, 0.075], kind: 'limb', cone: 1.15, ref: [0.55, -0.1] },
  { name: 'kneeR',     a: 'thighR', b: 'shinR',  anchor: [-0.10, 0.46, 0], cut: [0.058, 0.058], kind: 'limb2', axis: [1, 0, 0], limits: [-2.4, 0] },
];
for (const j of JOINTS) {
  j.refAxis = new THREE.Vector3(0, 1, 0);
  if (j.ref) j.refAxis.applyEuler(new THREE.Euler(j.ref[0], 0, j.ref[1], 'YXZ'));
}

// Hands and feet: extra shapes on the forearm and shin bodies, so a body lies on the ground the way
// one does (feet do not sink in, legs do not roll like pipes). Shin-local / forearm-local.
const EXTRA = {
  shinL: () => RAPIER.ColliderDesc.cuboid(0.045, 0.04, 0.115).setTranslation(0, -0.19, -0.075),
  shinR: () => RAPIER.ColliderDesc.cuboid(0.045, 0.04, 0.115).setTranslation(0, -0.19, -0.075),
  farmL: () => RAPIER.ColliderDesc.ball(0.042).setTranslation(0, -0.2, 0),
  farmR: () => RAPIER.ColliderDesc.ball(0.042).setTranslation(0, -0.2, 0),
};

// ragdoll part -> model name in assets/models.glb (left and right share a mesh)
const MODEL_OF = {
  pelvis: 'Pelvis', torso: 'Torso', head: 'Head',
  uarmL: 'UpperArm', uarmR: 'UpperArm', farmL: 'Forearm', farmR: 'Forearm',
  thighL: 'Thigh', thighR: 'Thigh', shinL: 'Shin', shinR: 'Shin',
};

// Ragdoll muscle targets (rotation about the joint's local X, same convention as the animation):
// REST is how a body lies when relaxed, BRACE is the protective curl of someone falling.
const REST = { spine: 0, neck: 0, shoulderL: 0.25, shoulderR: 0.25, elbowL: 0.45, elbowR: 0.45, hipL: 0.2, hipR: 0.2, kneeL: -0.35, kneeR: -0.35 };
const BRACE = { spine: -0.3, neck: -0.35, shoulderL: 1.35, shoulderR: 1.35, elbowL: 0.6, elbowR: 0.6, hipL: 0.7, hipR: 0.7, kneeL: -1.0, kneeR: -1.0 };
const TWIST = { spine: 0.5, neck: 0.9, shoulderL: 1.2, shoulderR: 1.2, hipL: 0.7, hipR: 0.7 };
// Recorded motion (assets/<name>.json, made by models/import_anim.py from Mixamo clips): a rotation per joint per
// frame. walk and run are loops that take over from the worked-out stride; die is a stagger and fall that a person
// too hurt to stand plays before the ragdoll takes them; reload is an armed suspect changing magazines.
// A missing file just leaves the worked-out motion.
const CLIPS = {};
for (const k of ['walk', 'run', 'die', 'reload']) fetch(`assets/${k}.json`).then((r) => r.json()).then((j) => { CLIPS[k] = j; }).catch(() => {});
const _c0 = new THREE.Quaternion(), _c1 = new THREE.Quaternion();
/** A clip's rotation for one joint. u = how far through it, 0..1 (wrapping round for a loop). */
function clipAt(clip, name, u, out, loop = true) {
  const rows = clip.joints[name], n = clip.frames;
  const f = loop ? (((u % 1) + 1) % 1) * n : Math.min(Math.max(u, 0), 1) * (n - 1);
  const i = Math.floor(f);
  return out.fromArray(rows[i % n]).slerp(_c1.fromArray(rows[loop ? (i + 1) % n : Math.min(i + 1, n - 1)]), f - i);
}
/** Seconds a one-off clip lasts. */
const clipLen = (clip) => clip.frames / (clip.fps || 30);

const MAG = 8;            // an armed suspect's rounds between reloads
const FLINCH = 0.45, PUNCH = 0.35, LUNGE = 0.5, STUMBLE = 0.9;

const PARENT = {};
const JOINT_OF = {};
for (const j of JOINTS) { PARENT[j.b] = j.a; JOINT_OF[j.b] = j; }

// Which parts of one body may collide with each other: everything except neighbours across a joint.
// (Neighbours overlap by design; the joint and its limits keep them apart.)
const SELF = new Set();
for (const x in PARTS) for (const y in PARTS) if (x < y && PARENT[x] !== y && PARENT[y] !== x) SELF.add(x + '|' + y);
export const selfCollide = (x, y) => SELF.has(x < y ? x + '|' + y : y + '|' + x);

const LEGS = new Set(['thighL', 'thighR', 'shinL', 'shinR']);
const ARMS = new Set(['uarmL', 'farmL', 'uarmR', 'farmR']);
const CORE = ['head', 'torso', 'pelvis'];
// how hard (m/s lost within a few hundredths of a second) a part may hit something before it does damage
const IMPACT = { head: 4.8, torso: 4.5, pelvis: 4.5 };
const LIMBS = new Set(['uarmL', 'farmL', 'uarmR', 'farmR', 'thighL', 'shinL', 'thighR', 'shinR']);
const KNOCK_PARTS = ['torso', 'head', 'pelvis', 'thighL', 'thighR'];

// The body model (models/character.py) is one skinned figure cut into a piece per ragdoll body.
// Each rigid body is a bone; these are the bones' places in the rest pose the model was built in.
const BONE_INDEX = {};
Object.keys(PARTS).forEach((n, i) => { BONE_INDEX[n] = i; });
const REST_INV = Object.values(PARTS).map((d) => new THREE.Matrix4().makeTranslation(-d.pos[0], -d.pos[1], -d.pos[2]));
const IDENT = new THREE.Matrix4();
const BODY_MATS = new Set(['Skin', 'Shirt', 'Pants']);   // what has flesh behind it

const ZOMBIE = 0x9fc98a;     // what the dead look like when they are a downloaded person (a tint over their texture)
const SKIN = [0xf1c8a0, 0xe0ac86, 0xc68a62, 0x9a6444, 0x6b4430];
const HAIR = [0x17100b, 0x2a1a10, 0x4a3018, 0x6b4a26, 0x8a7a66, 0x101012];
const SHIRT = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x7d3c98, 0xecf0f1, 0xe67e22, 0x2c3e50];
const PANTS = [0x2c3e50, 0x1b1b1f, 0x5d4e37, 0x34495e, 0x566573];

// ---- cached geometry / materials so spawning hundreds of parts stays cheap ----
const geoCache = new Map();
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const matCache = new Map();
function mat(color) {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.0 }); matCache.set(color, m); }
  return m;
}
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _c = new THREE.Vector3();
const _qt = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();

const KIN = () => RAPIER.RigidBodyType.KinematicPositionBased;
const DYN = () => RAPIER.RigidBodyType.Dynamic;

/** Some NPCs wear something on their head (models by Codex, origin at the head centre). */
function pickHat(kind) {
  const r = Math.random();
  const name = kind === 'thug' ? (r < 0.55 ? 'Balaclava' : r < 0.75 ? 'CombatHelmet' : null)
    : kind === 'civilian' ? (r < 0.16 ? 'HardHat' : r < 0.26 ? 'PoliceCap' : null)
    : null;
  return name ? getModel(name) : null;
}

export class Ragdoll {
  constructor(ctx, pos, yaw = 0, opts = {}) {
    this.ctx = ctx;
    const { world, scene } = ctx;

    this.parts = {};
    this.joints = {};
    this.colHandles = new Set();
    this.severed = new Set();
    this.bleeders = [];
    this.health = 100;
    this.dead = false;
    this.deadT = 0;
    this.pooled = false;
    this.crippled = false;
    this.removed = false;
    this.bleedRate = 0;         // health lost per second, from every open wound together
    this.sevBleed = 0;          // the part of that which comes from missing limbs
    this.drips = [];            // open wounds: { part, local, rate, hp, t, acc }
    this.limp = new Set();      // parts that hang dead while the rest of the body is still animated
    this.lame = { L: 0, R: 0 }; // 0..1 how badly each leg is hurt
    this.gutShot = false;       // hurt in the body: a hand goes to it
    this.clutch = 0;
    this.squat = 0;             // getting up goes through a crouch
    this.crawling = false;
    this.crawlPhase = Math.random() * 6;
    this.impactMute = 0.3;      // no landing damage while this runs (after hits, grabs and mode changes)
    this.trailAt = new THREE.Vector3(pos.x, -99, pos.z);
    this.mass = 0;
    this.voice = (opts.kind === 'zombie' || opts.zombie ? 0.7 : 0.8) + Math.random() * 0.5;   // whose throat it is
    this.voiceT = 0;            // no more noise out of it before this time
    this.wasState = 'calm';
    this.heat = 0;              // how much fire it has taken
    this.burnT = 0;             // seconds left alight
    this.lastDt = 1 / 60;
    this.kind = opts.kind || (opts.zombie ? 'zombie' : 'civilian'); // 'civilian' | 'thug' | 'zombie'
    this.infected = false;      // bitten: rises as a zombie after dying
    this.PUNCH = PUNCH;
    this.LUNGE = LUNGE;

    // animation state (the Brain writes the "wants", the body follows)
    this.mode = 'ragdoll';
    this.stun = 0;
    this.t = Math.random() * 10;
    this.seed = Math.random() * 10;
    this.root = new THREE.Vector3(pos.x, pos.y, pos.z); // feet position
    this.heading = yaw;
    this.targetHeading = yaw;
    this.speed = 0;
    this.wantSpeed = 0;
    this.phase = Math.random() * 6;
    this.gesture = 'none';      // 'handsUp' | 'cower' | 'fight'
    this.gw = { handsUp: 0, cower: 0, fight: 0, aim: 0, kneel: 0, hold: 0 };   // eased gesture weights
    this.look = null;           // world point the head turns toward
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.flinchT = 0;
    this.flinchSide = 1;
    this.flinchDir = new THREE.Vector3();
    this.punchT = 0;
    this.lungeT = 0;
    this.hitAccum = 0;          // recent hit force: enough of it knocks a standing NPC down
    this.getupT = 0;
    this.pose = {};
    this.captured = {};

    // ragdoll muscle state
    this.tone = 0.3;
    this.fallT = 9;
    this.twitch = 0;

    const skin = this.kind === 'zombie' ? 0x8fbf6a : SKIN[Math.floor(Math.random() * SKIN.length)];
    const colors = {
      skin,
      shirt: this.kind === 'thug' ? 0x1a1a1c : SHIRT[Math.floor(Math.random() * SHIRT.length)],
      pants: PANTS[Math.floor(Math.random() * PANTS.length)],
    };
    // who this is: one of the downloaded people if there are any, else the built figure in random colours
    const people = looks();
    this.model = opts.model && people.includes(opts.model) ? opts.model : people.length ? people[(Math.random() * people.length) | 0] : 'Body';
    this.real = this.model !== 'Body';
    this.armour = this.model === 'Ch15' ? 120 : 0;   // the soldier's vest and helmet: how much more they can take
    this.stumbleT = 0;
    this.skinned = !!bodyPieces('pelvis', this.model);
    const tint = this.real ? {} : this.skinned
      ? {
        Skin: tintedMaterial('Skin', colors.skin), Shirt: tintedMaterial('Shirt', colors.shirt),
        Pants: tintedMaterial('Pants', colors.pants), Hair: tintedMaterial('Hair', HAIR[Math.floor(Math.random() * HAIR.length)]),
      }
      : { Skin: mat(colors.skin), Shirt: mat(colors.shirt), Pants: mat(colors.pants) };

    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, yaw);

    for (const [name, d] of Object.entries(PARTS)) {
      const off = new THREE.Vector3(...d.pos).applyQuaternion(qYaw);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x + off.x, pos.y + off.y, pos.z + off.z)
          .setRotation({ x: qYaw.x, y: qYaw.y, z: qYaw.z, w: qYaw.w })
          .setLinearDamping(0.05)
          .setCcdEnabled(true)      // thrown bodies must not pass through walls
          .setAngularDamping(0.7)   // joint friction in muscles() does the real damping
      );
      let cd, g, len;
      if (d.shape === 'box') {
        cd = RAPIER.ColliderDesc.cuboid(d.half[0], d.half[1], d.half[2]);
        g = () => geo(`box${d.half}`, () => new THREE.BoxGeometry(d.half[0] * 2, d.half[1] * 2, d.half[2] * 2));
        len = Math.max(d.half[0], d.half[1]) * 2;
      } else if (d.shape === 'ball') {
        cd = RAPIER.ColliderDesc.ball(d.r);
        g = () => geo(`ball${d.r}`, () => new THREE.SphereGeometry(d.r, 16, 12));
        len = d.r * 2.5;
      } else {
        cd = RAPIER.ColliderDesc.capsule(d.h, d.r);
        g = () => geo(`cap${d.h},${d.r}`, () => new THREE.CapsuleGeometry(d.r, d.h * 2, 4, 10));
        len = d.h * 2 + d.r * 2;
      }
      // the contact hook (main.js) decides which parts of the same NPC may touch
      cd.setDensity(900).setFriction(0.9).setRestitution(0.02).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const collider = world.createCollider(cd, body);
      const inertia = body.mass() * len * len / 12;
      const colliders = [collider];
      if (EXTRA[name]) {
        colliders.push(world.createCollider(EXTRA[name]().setDensity(500).setFriction(0.9).setRestitution(0.02)
          .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), body));
      }
      this.mass += body.mass();

      // With the skinned body this is just the bone: an empty that follows the rigid body, and that
      // hats, stumps, innards and blood marks hang off. Without models it is the collider shape itself.
      let mesh = this.skinned ? new THREE.Group() : getModel(MODEL_OF[name], tint);
      if (!mesh) {
        mesh = new THREE.Mesh(g(), mat(colors[d.role]));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (name === 'head') {
          for (const x of [-0.045, 0.045]) {
            const eye = new THREE.Mesh(geo('eye', () => new THREE.SphereGeometry(0.018, 6, 6)), eyeMat);
            eye.position.set(x, 0.02, -0.105);
            mesh.add(eye);
          }
        }
      }
      scene.add(mesh);
      const hat = name === 'head' && !this.real && pickHat(this.kind);
      // the meshes bullets can punch holes in; "body" ones (skin, shirt, trousers) have flesh behind them
      const bodyMats = new Set(Object.values(tint));
      const skin = [];
      mesh.traverse((o) => { if (o.isMesh) skin.push({ mesh: o, body: bodyMats.has(o.material) || o === mesh, isSkin: o.material === tint.Skin }); });
      // local box around the part, used to work out where a bullet comes out the other side
      const ext = d.shape === 'box' ? d.half : d.shape === 'ball' ? [d.r, d.r, d.r] : [d.r, d.h + d.r, d.r];
      this.parts[name] = {
        name, def: d, body, collider, colliders, mesh, skin, ext, hp: d.hp, gone: false, inertia,
        skinned: [], rest: new THREE.Vector3(...d.pos), hat: hat ? hat.name : null, pv: new THREE.Vector3(), vy0: 0,
      };
      if (hat) mesh.add(hat); // added after `skin` was collected, so headwear is not cut by wounds
      this.pose[name] = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
      this.captured[name] = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
      for (const c of colliders) {
        this.colHandles.add(c.handle);
        ctx.owners.set(c.handle, { kind: 'part', ragdoll: this, name });
      }
    }

    if (this.skinned) {
      // one skeleton for the whole figure: bone i is the group that follows rigid body i
      this.skeleton = new THREE.Skeleton(Object.keys(PARTS).map((n) => this.parts[n].mesh), REST_INV);
      this.bald = Math.random() < 0.08 || this.parts.head.hat === 'Balaclava';
      this.tint = tint;
      // Untouched, the figure is drawn as one mesh per material. The first injury splits it into
      // a set of meshes per body part (split()), which is what wounds, burns and cuts work on.
      this.whole = [];
      if (this.real && this.kind === 'zombie') this.sicken();
      for (const piece of bodyWhole(Object.keys(PARTS), this.model)) {
        if (piece.material.name === 'Hair' && this.bald) continue;
        this.whole.push(this.skinMesh(piece, this.skeleton));
      }
    }

    for (const j of JOINTS) {
      const A = PARTS[j.a], B = PARTS[j.b];
      const a1 = new THREE.Vector3(j.anchor[0] - A.pos[0], j.anchor[1] - A.pos[1], j.anchor[2] - A.pos[2]);
      const a2 = new THREE.Vector3(j.anchor[0] - B.pos[0], j.anchor[1] - B.pos[1], j.anchor[2] - B.pos[2]);
      const jd = j.axis
        ? RAPIER.JointData.revolute(a1, a2, { x: j.axis[0], y: j.axis[1], z: j.axis[2] })
        : RAPIER.JointData.spherical(a1, a2);
      jd.contactsEnabled = false;
      const joint = world.createImpulseJoint(jd, this.parts[j.a].body, this.parts[j.b].body, true);
      if (j.limits) joint.setLimits(j.limits[0], j.limits[1]);
      this.joints[j.name] = { joint, a1, a2, def: j, local: new THREE.Quaternion() };
    }

    this.brain = new Brain(this, this.kind);

    if (opts.limp) {
      this.stun = opts.limp; // start as a falling ragdoll
      this.fallT = 0;
      this.tone = 0.9;
    } else {
      const gy = this.groundBelow(pos.x, pos.y + 0.8, pos.z, 3);
      if (gy !== null) this.root.y = gy;
      this.setMode('anim');
      this.computePose();
      for (const n in this.parts) { // start in pose rather than snapping on the first frame
        this.parts[n].body.setTranslation(this.pose[n].p, true);
        this.parts[n].body.setRotation(this.pose[n].q, true);
      }
    }
    this.sync();
  }

  get alive() { return !this.dead && !this.removed; }

  /** A downloaded person as a zombie: every one of their materials gets a sickly cast. */
  sicken() {
    for (const piece of bodyWhole(Object.keys(PARTS), this.model)) this.tint[piece.material.name] = tintedMaterial(piece.material.name, ZOMBIE);
  }

  skinMesh(piece, skeleton) {
    const sm = new THREE.SkinnedMesh(piece.geometry, this.tint[piece.material.name] || piece.material);
    sm.bind(skeleton, IDENT);
    sm.frustumCulled = false;      // it sits at the origin while its bones are out in the world
    sm.castShadow = true;
    sm.receiveShadow = true;
    this.ctx.scene.add(sm);
    return sm;
  }

  /** Swap the joined-up figure for one set of meshes per body part. Happens once, at the first injury. */
  split() {
    if (!this.whole) return;
    for (const m of this.whole) this.ctx.scene.remove(m);
    this.whole = null;
    for (const name in PARTS) {
      const part = this.parts[name];
      for (const piece of bodyPieces(name, this.model)) {
        const mn = piece.material.name;
        if (isCap(mn) || (mn === 'Hair' && this.bald)) continue;     // the caps come with the cut (detach)
        const sm = this.skinMesh(piece, this.skeleton);
        part.skinned.push(sm);
        part.skin.push({ mesh: sm, body: this.real || BODY_MATS.has(mn), isSkin: mn === 'Skin' });
      }
    }
  }

  /** Where this NPC is, standing or sprawled. */
  center(out) {
    if (this.mode === 'ragdoll' && !this.removed && !this.parts.pelvis.gone) {     // (a deleted body has no physics left to ask)
      const t = this.parts.pelvis.body.translation();
      return out.set(t.x, t.y, t.z);
    }
    return out.set(this.root.x, this.root.y + 1, this.root.z);
  }

  // is this part cut off from the pelvis?
  isFree(name) {
    for (let n = name; n; n = PARENT[n]) if (this.severed.has(n)) return true;
    return false;
  }

  // ------------------------------------------------------------ mode switching
  setMode(mode) {
    const kin = mode !== 'ragdoll';
    for (const n in this.parts) {
      const p = this.parts[n];
      if (p.gone) continue;
      const wantKin = kin && !this.isFree(n) && !this.limp.has(n);
      if (p.body.isKinematic() !== wantKin) {
        p.body.setBodyType(wantKin ? KIN() : DYN(), true);
        if (!wantKin) {
          // carry the walking speed into the fall
          p.body.setLinvel({ x: -Math.sin(this.heading) * this.speed, y: 0, z: -Math.cos(this.heading) * this.speed }, true);
          p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }
    this.mode = mode;
    this.impactMute = Math.max(this.impactMute, 0.3);
  }

  /** Drop into physics for at least `seconds`. Safe to call repeatedly. */
  goLimp(seconds = 1.5) {
    this.stun = Math.max(this.stun, seconds);
    this.stumbleT = this.collapseT = this.reloadT = 0;
    if (this.mode !== 'ragdoll') {
      this.setMode('ragdoll');
      this.speed = 0;
      this.fallT = 0;     // muscles tense: brace for the fall
      this.tone = 0.9;
    }
  }

  // ------------------------------------------------------------ damage
  damage(n, cause) {
    if (this.dead) return;
    this.health -= n;
    if (this.health <= 0) this.die(cause);
  }

  die(cause) {
    if (this.dead) return;
    if (cause !== 'headshot') { this.voiceT = 0; this.cry(this.kind === 'zombie' ? 'growl' : 'deathcry', 9); }   // (a head shot is over before any sound)
    this.dead = true;
    this.goLimp(1e9);
    this.tone = Math.min(this.tone, 0.05);   // nothing holds the body up any more: it drops like a cut puppet
    this.twitch = cause === 'headshot' ? 1.3 : 1.0;   // nerves fire for a moment after death
    this.ctx.onKill(this, cause);
    this.ctx.alert('death', this.center(_c), 16);
  }

  /** Make a noise: 'grunt' | 'scream' | 'deathcry' | 'growl'. Quieter with distance; `gap` = seconds before the next. */
  cry(kind, gap = 0.5) {
    if (!VOICES || this.t < this.voiceT || this.parts.head.gone || this.severed.has('head')) return;
    this.voiceT = this.t + gap;
    const d = this.center(_c).distanceTo(this.ctx.player.pos);
    this.ctx.sfx[kind](1 / (1 + d * d / 60), this.voice);
  }

  /** Apply a hit to a single part. opts: { blade, light, stab, bite, explosion, heat, hole, normal, from } */
  hit(name, dmg, point, dir, impulse = 0, opts = {}) {
    const p = this.parts[name];
    if (!p || p.gone) return;
    const { gore, sfx } = this.ctx;
    this.impactMute = Math.max(this.impactMute, 0.35);   // being shot is not a fall
    if (this.collapseT > 0) this.goLimp(2);
    if (opts.daze && !this.dead) {               // a bag, a taser, the spray: no use to anyone for a while, and cuffable
      this.brain.flashed = Math.max(this.brain.flashed || 0, opts.daze);
      this.lessLethal = true;
      if (opts.tase) {                           // every muscle locked, then on the floor
        this.goLimp(opts.tase);
        this.twitch = Math.max(this.twitch, opts.tase);
        this.tone = 0.9;
        this.ctx.sfx.crack();
      }
    }
    if (dmg > 0 && this.armour > 0 && (name === 'torso' || name === 'head') && opts.pen !== undefined && opts.pen < 0.25) {
      // pistol-weight rounds stop in the vest or the helmet: a thump and a bruise, no hole. Plates only take so much
      this.armour -= dmg;
      gore.sparks(point, new THREE.Vector3(-dir.x, -dir.y, -dir.z), 4);
      sfx.impact();
      dmg *= 0.2;
      opts = { ...opts, blunt: true };
    }
    if (dmg > 0 || opts.explosion) this.split();

    // Light hits stagger a standing NPC; legs, heads, blades, blasts, repeated hits and low
    // health put them on the ground. Zombies shrug off far more.
    const zombie = this.kind === 'zombie';
    this.hitAccum += impulse;
    const standing = this.mode !== 'ragdoll';
    // (hand weapons are the exception: a swing staggers, wherever it lands, until the blows add up)
    const melee = opts.melee || opts.blunt || (opts.blade && opts.light);
    const heavy = (opts.blade && !opts.light) || opts.explosion || (!melee && (name === 'head' || LEGS.has(name)))
      || this.hitAccum > (zombie ? 480 : 250) || (!zombie && this.health - dmg < 40);
    // not every hard hit is a fall: some reel backward with the legs going, and then either catch it or do not
    const reel = standing && !this.dead && !zombie && !opts.explosion && !opts.blade && !opts.daze && name !== 'head' && this.stumbleT <= 0
      && this.health - dmg > 0 && Math.random() < (heavy ? 0.65 : !melee && dmg >= 15 ? 0.4 : 0);
    if (reel) {
      this.stumbleT = STUMBLE;
      this.stumbleFall = LEGS.has(name) || Math.random() < (heavy ? 0.5 : 0.15);
      this.flinchDir.set(dir.x, 0, dir.z).normalize();
    } else if (standing && !heavy && !this.dead) {
      this.flinchT = FLINCH;
      this.flinchDir.set(dir.x, 0, dir.z).normalize();
      const pt = p.body.translation();
      // which side was hit, relative to where the NPC faces: the torso twists away from it
      this.flinchSide = ((point.x - pt.x) * Math.cos(this.heading) - (point.z - pt.z) * Math.sin(this.heading)) > 0 ? 1 : -1;
    } else {
      this.goLimp(0.9 + Math.min(2.6, impulse / 110 + dmg / 60));
    }
    this.brain.notice('hurt', opts.from || this.ctx.player.pos);
    if (dmg > 0 && !this.dead) this.cry(zombie ? 'growl' : dmg > 25 || opts.explosion || opts.blade ? 'scream' : 'grunt');

    if (impulse > 0 && this.mode === 'ragdoll') {
      // a body already off its feet has nothing to push back with: rounds throw it about
      _v.copy(dir).multiplyScalar(impulse * (this.mode === 'ragdoll' && !opts.explosion ? 1.5 : 1));
      p.body.applyImpulseAtPoint({ x: _v.x, y: _v.y, z: _v.z }, point, true);
    }

    // the hit in the part's own space
    const t = p.body.translation(), r = p.body.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    const lp = new THREE.Vector3(point.x - t.x, point.y - t.y, point.z - t.z).applyQuaternion(_q);
    const ld = new THREE.Vector3(dir.x, dir.y, dir.z).applyQuaternion(_q).normalize();
    const big = name === 'torso' || name === 'pelvis';
    const maxR = big ? 0.11 : name === 'head' ? 0.07 : p.def.r * 0.95;

    if (opts.explosion) {
      // burned, and peppered with whatever the blast threw
      const heat = opts.heat ?? Math.min(1, dmg / 105);
      if (heat > 0.12) burn(p, Math.min(1, heat * 1.25));
      if (heat > 0.35 && Math.random() < 0.45) {
        let k = 9;
        for (let i = 0; i < 3; i++) k = Math.min(k, p.ext[i] / Math.max(1e-3, Math.abs(ld.getComponent(i))));
        lp.copy(ld).multiplyScalar(-k * 0.95);
        lp.x += rnd(-0.02, 0.02); lp.y += rnd(-0.03, 0.03); lp.z += rnd(-0.02, 0.02);
        openWound(p, lp, rnd(0.012, 0.028), maxR, null, ld, 0.04);
        this.bleed(p, lp, 3, 0.3);
      }
    } else if (dmg > 0) {
      if (opts.blade) {
        // a gash: along the blade's travel for a swipe, any way across the body for a chop
        const ln = opts.normal ? new THREE.Vector3(opts.normal.x, opts.normal.y, opts.normal.z).applyQuaternion(_q).normalize() : ld.clone().negate();
        const swipe = opts.light && !opts.chop;
        const tan = swipe ? ld.clone().addScaledVector(ln, -ld.dot(ln)) : new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).cross(ld);
        if (tan.lengthSq() < 1e-6) tan.set(0, 1, 0);
        tan.normalize();
        const half = swipe ? 0.03 + Math.min(0.05, dmg * 0.0014) : opts.light ? rnd(0.035, 0.065) : rnd(0.07, 0.11);
        openWound(p, lp.clone().addScaledVector(tan, -half), opts.light ? 0.01 : 0.015, maxR, lp.clone().addScaledVector(tan, half),
          swipe ? ln.negate() : ld, opts.light ? 0.035 : 0.07);
        this.bleed(p, lp, opts.light ? 4 : 8, opts.light ? 0.35 : 1.0);
        _t.copy(dir).multiplyScalar(0.5); _t.y += 0.5;
        gore.blood(point, _t, opts.light ? 12 : 26, 5, 1.0);
        gore.mist(point, _t, 3);
        gore.wallSplatter(point, dir, 2.5);
      } else if (opts.blunt) {
        // a blow: bruising, and split skin if it was a hard one
        if (dmg >= 20) {
          openWound(p, lp, 0.016, maxR, null, ld, 0.03);
          this.bleed(p, lp, 3, 0.25);
          sfx.crack();
        }
        _t.copy(dir).multiplyScalar(0.3); _t.y += 0.5;
        gore.blood(point, _t, dmg >= 20 ? 10 : 3, 2.5, 1.0);
      } else if (opts.bite || opts.stab) {
        openWound(p, lp, opts.stab ? 0.02 : 0.024, maxR, null, opts.stab ? ld : null, 0.06);   // a puncture or a torn chunk, no exit wound
        this.bleed(p, lp, opts.stab ? 6 : 4, opts.stab ? 0.8 : 0.4);
        _t.copy(dir).multiplyScalar(-0.5); _t.y += 0.4;
        gore.blood(point, _t, 9, 2.8, 0.9);               // wells up out of the wound
      } else {
        // entry hole, and a bigger one where the bullet leaves
        openWound(p, lp, opts.hole || 0.026, maxR, null, ld);
        this.bleed(p, lp, big ? 5 : name === 'head' ? 4 : 3, big ? 0.4 : name === 'head' ? 0.4 : 0.18);
        let k = 0.6;
        for (let i = 0; i < 3; i++) {
          const c = ld.getComponent(i);
          if (Math.abs(c) > 1e-4) k = Math.min(k, (Math.sign(c) * p.ext[i] - lp.getComponent(i)) / c);
        }
        if (k > 0.03) {
          const out = lp.clone().addScaledVector(ld, k);
          openWound(p, out, (opts.hole || 0.026) * 1.5, maxR, null, ld);
          this.bleed(p, out, 3, 0);
        }
        gore.blood(point, dir, 14, 7, 0.35);              // exit spray carries on past the body
        if (name === 'torso' && !this.gutted && p.hp - dmg < p.def.hp * 0.3) {
          // shot to pieces: the front of the body opens and what was inside comes out
          this.gutted = true;
          openWound(p, lp, 0.07, maxR, null, ld, 0.09);
          this.bleed(p, lp, 10, 1.2);
          gore.chunks(point, 5, 1.6, { x: -dir.x * 1.2, y: 0.4, z: -dir.z * 1.2 }, 'torso');
          gore.gush(point, _t.set(-dir.x, 0.2, -dir.z), 36, 4);
        }
        _t.copy(dir).multiplyScalar(-0.4); _t.y += 0.3;
        gore.blood(point, _t, 5, 2.5, 0.8);                // a little comes back out the front
        gore.mist(point, dir, name === 'head' ? 7 : 4, name === 'head' ? 1.5 : 1);
        gore.wallSplatter(point, dir, 4.5 * Math.min(2, (opts.hole || 0.026) / 0.03));   // a bigger round carries more, further
      }
      if (big) this.gutShot = true;
    }

    // zombies only really go down to head trauma
    // (a hand weapon to the head is bad, but it is not a bullet; and it wears a part down at half the rate)
    const mult = name === 'head' ? (melee ? 1.4 : 2.2) : (LIMBS.has(name) ? 0.55 : 1) * (zombie ? 0.3 : 1);
    p.hp -= melee ? dmg * 0.5 : dmg;

    // a badly hurt limb stops working before it comes off
    if (p.hp > 0 && dmg > 0) {
      const side = name.slice(-1);
      if (ARMS.has(name) && p.hp < p.def.hp * 0.55) this.dangle(name);
      if (LEGS.has(name)) {
        const th = this.parts['thigh' + side], sh = this.parts['shin' + side];
        this.lame[side] = clamp((0.85 - Math.min(th.hp / th.def.hp, sh.hp / sh.def.hp)) / 0.5, 0, 1);
      }
    }

    // resolve what happens to the part first so the kill gets the right label
    if (p.hp <= 0) {
      if (opts.explosion && p.hp < -75 && name !== 'pelvis') {      // right on top of it: nothing left
        this.gib(name);
      } else if (opts.explosion && name !== 'torso' && name !== 'pelvis' && Math.random() < 0.45) {
        // blasts don't take every limb off: this one is mangled but still attached
        if (ARMS.has(name)) this.dangle(name);
      } else if (name === 'head') {
        if (opts.blade || opts.explosion) this.sever('head', dir);
        else if (p.hp < -26) this.gib('head');   // overkill: the head pops
        else {
          if (!opts.blunt) {
            // the back of the skull goes with the round
            gore.chunks(point, 3, 3, { x: dir.x * 4, y: dir.y * 4 + 1, z: dir.z * 4 }, 'head');
            gore.gush(point, dir, 30, 7);
            gore.wallSplatter(point, dir, 7);
          }
          this.die(opts.blunt ? 'beaten' : 'headshot');
        }
      } else if (LIMBS.has(name)) {
        if (opts.blunt) {
          // clubs break limbs, they do not take them off
          p.hp = 1;
          if (ARMS.has(name)) this.dangle(name); else this.lame[name.slice(-1)] = 1;
          sfx.crack();
        } else this.sever(name, dir);
      } else if (name === 'torso') {
        if (opts.blade || opts.explosion) this.sever('torso', dir);
        if (!zombie || this.severed.has('torso')) this.die(opts.blunt ? 'beaten' : 'torso');
      } else if (name === 'pelvis') {
        if (!zombie) this.die(opts.blunt ? 'beaten' : 'pelvis');
      }
    }
    this.damage(dmg * mult);
    // a hostage-taker hurt but still on his feet has a gun at someone's head
    const h = this.hostage;
    if (h && dmg > 0 && !this.dead && this.mode === 'anim' && !opts.daze && !h.dead && h.mode === 'anim' && Math.random() < 0.5) {
      this.ctx.later(0.25, () => {
        if (this.dead || this.removed || this.mode !== 'anim' || h.dead || h.removed || h.heldBy !== this) return;
        const hp = h.parts.head.body.translation();
        h.hit('head', 200, new THREE.Vector3(hp.x, hp.y, hp.z - 0.1), new THREE.Vector3(0, -0.2, 1).normalize(), 90, { hole: 0.03, from: this.root });
        this.ctx.sfx.pistol();
      });
    }
  }

  /** Fire on a body part: it chars and hurts, and enough of it sets the whole NPC alight. */
  scorch(name, heat, dmg, from) {
    const p = this.parts[name];
    if (!p || p.gone) return;
    this.split();
    p.heat = Math.min(1, (p.heat || 0) + heat);
    burn(p, p.heat);
    this.heat += heat;
    if (this.heat > 0.5) this.burnT = Math.max(this.burnT, 7);
    this.brain.notice('hurt', from);
    this.damage(dmg, 'burned');
  }

  /** Hand this NPC a pistol: from now on it is an armed suspect (see suspect() in brain.js). */
  arm(model = 'Pistol') {
    this.armed = true;
    this.rounds = MAG;
    this.gun = getModel(model);
    if (!this.gun) return;
    this.gun.position.set(0, -0.2, -0.03);       // in the hand at the end of the forearm, barrel along it
    this.gun.rotation.x = -Math.PI / 2;
    this.parts.farmR.mesh.add(this.gun);
  }

  /** Fire the gun at a target: the player, or another NPC. The further away, the more it misses. */
  shoot(target) {
    const arm = this.parts.farmR;
    if (arm.gone || this.isFree('farmR') || this.limp.has('farmR')) { this.armed = false; return; }   // no gun hand: no longer a shooter
    if (this.reloadT > 0) return;                    // busy with a fresh magazine: your chance
    if (--this.rounds <= 0 && CLIPS.reload) this.reloadT = 1e-3;
    const npc = !!target.parts;
    if (npc && target.removed) return;
    const from = this.localToWorld(arm, { x: 0, y: -0.3, z: -0.03 });
    const to = npc ? target.center(new THREE.Vector3()).setY(target.center(_c).y + 0.1) : new THREE.Vector3(target.pos.x, target.pos.y + 0.3, target.pos.z);
    const d = from.distanceTo(to);
    const hit = Math.random() < clamp(0.8 - d * 0.03, 0.12, 0.8);
    if (!hit) to.add(_v.set(rnd(-1, 1), rnd(-0.3, 0.8), rnd(-1, 1)).multiplyScalar(0.25 + d * 0.06)).addScaledVector(_t.copy(to).sub(from).normalize(), 4);
    this.ctx.weapons.tracer(from, to);
    this.ctx.weapons.fireFlash(from, _t.copy(to).sub(from).normalize(), 0.15);
    if (this.kind === 'swat') this.ctx.sfx.rifle(); else this.ctx.sfx.pistol();
    if (!hit) { if (!npc) { target.suppress = Math.min(1, target.suppress + 0.45); this.ctx.sfx.impact(); } return; }   // the crack of one going past
    if (!npc) { target.hurt(rnd(14, 24), this.root); return; }
    const part = [target.parts.torso, target.parts.pelvis].find((p) => !p.gone);
    if (part) target.hit(part.name, this.kind === 'swat' ? rnd(14, 22) : rnd(12, 20), to, _t.copy(to).sub(from).normalize(), 80, { hole: 0.03, from: this.root });
  }

  /** An open wound: it drips, and costs health until it clots (limbs) or kills (body wounds). */
  bleed(part, local, rate, hp) {
    this.bled = true;
    if (this.drips.length >= 10) this.drips.shift();
    this.drips.push({ part, local: local.clone(), rate, hp, t: 0, acc: 0 });
  }

  /** This arm is finished: from here on it just hangs, even while its owner walks about. */
  dangle(name) {
    if (this.limp.has(name) || this.isFree(name)) return;
    const side = name.slice(-1);
    this.limp.add('farm' + side);
    if (name.startsWith('uarm')) this.limp.add(name);
    if (this.mode !== 'ragdoll') this.setMode(this.mode);
  }

  /** A zombie got hold of this NPC. */
  bitten(by) {
    if (this.dead || this.removed) return;
    const part = this.parts.torso.gone ? this.parts.pelvis : this.parts.torso;
    const t = part.body.translation();
    const from = by.center(_c);
    const dir = new THREE.Vector3(t.x - from.x, 0, t.z - from.z).normalize();
    const point = new THREE.Vector3(t.x - dir.x * 0.1, t.y + 0.12, t.z - dir.z * 0.1);
    this.infected = true;
    this.hit(part.name, 20, point, dir, 90, { bite: true, from: by.root });
  }

  /** The infected do not stay dead. */
  reanimate() {
    this.dead = false;
    this.kind = 'zombie';
    this.infected = false;
    this.brain = new Brain(this, 'zombie');
    this.health = 70;
    this.bleedRate = this.sevBleed = 0;
    this.burnT = 0;
    this.gutShot = false;
    this.stun = 0.6;
    this.twitch = 1;
    if (this.real) {
      // a downloaded person has no separate skin to turn green: the whole of them goes off-colour
      this.sicken();
      const turn = (m) => { if (m.material.onBeforeCompile && m.material.customProgramCacheKey) m.material.color.set(ZOMBIE); else if (this.tint[m.material.name]) m.material = this.tint[m.material.name]; };
      for (const m of this.whole || []) turn(m);
      for (const n in this.parts) for (const s of this.parts[n].skin) turn(s.mesh);
    }
    const green = this.skinned ? tintedMaterial('Skin', 0x8fbf6a) : mat(0x8fbf6a);
    if (this.whole) for (const m of this.whole) if (m.material === this.tint.Skin) m.material = green;
    if (this.tint) this.tint.Skin = green;
    for (const n in this.parts) {
      for (const s of this.parts[n].skin) {
        if (!s.isSkin) continue;
        if (s.mesh.material.onBeforeCompile && this.parts[n].wounds) s.mesh.material.color.set(0x8fbf6a); // wounded: private copy
        else s.mesh.material = green;
      }
    }
    this.ctx.toast('IT GETS BACK UP');
  }

  /** Cut a part (and anything hanging off it) free of its parent. */
  sever(name, dir) {
    if (this.severed.has(name) || !JOINT_OF[name]) return;   // (the pelvis is the root: it hangs off nothing)
    const jd = this.joints[JOINT_OF[name].name];
    if (!jd) return;
    this.split();
    this.goLimp(3);
    // removing a joint twice (e.g. its body was gibbed) would panic the wasm world, so check first
    if (this.ctx.world.getImpulseJoint(jd.joint.handle)) this.ctx.world.removeImpulseJoint(jd.joint, true);
    this.severed.add(name);
    this.detach(jd.def);

    const { gore, sfx } = this.ctx;
    const parent = this.parts[jd.def.a];
    const child = this.parts[name];
    const wp = this.localToWorld(parent, jd.a1);
    gore.gush(wp, dir || UP, 42, 6);
    gore.chunks(wp, 2, 3, null, 'limb');
    sfx.chop();

    // wound direction in each part's local frame: along the limb. (The shoulder is cut under the
    // cap of the shoulder, so the body's side of it faces down the arm, not up.)
    const side = jd.def.name.startsWith('shoulder');
    const outA = new THREE.Vector3(0, side ? -1 : Math.sign(jd.a1.y) || 1, 0);
    const outB = new THREE.Vector3(0, Math.sign(jd.a2.y) || 1, 0);
    if (!parent.gone) {
      this.addStump(parent, jd.a1, outA, jd.def);
      this.bleeders.push({ part: parent, local: jd.a1, out: outA, t: 10, rate: 42, pooled: false });
    }
    this.addStump(child, jd.a2, outB, jd.def);
    this.bleeders.push({ part: child, local: jd.a2, out: outB, t: 6, rate: 24, pooled: false });
    this.sevBleed += name.startsWith('farm') || name.startsWith('shin') ? 1.6 : 2.6;   // the nearer the body, the faster it empties
    this.bled = true;

    this.damage(12);
    if (name === 'head') this.die('decap');
    else if (name === 'torso') this.die('bisect');
    else if (LEGS.has(name)) this.crippled = true;

    if (dir) child.body.applyImpulse({ x: dir.x * 25, y: 15, z: dir.z * 25 }, true);
  }

  /** Blow a part to pieces. */
  gib(name) {
    const p = this.parts[name];
    if (!p || p.gone) return;
    this.split();
    this.goLimp(3);
    if (name !== 'torso') this.sever(name, null);
    const t = p.body.translation(), v = p.body.linvel();
    const at = { x: t.x, y: t.y, z: t.z };
    const core = name === 'torso' || name === 'pelvis';
    this.ctx.gore.gibs(at, core ? 70 : 45);
    this.ctx.gore.chunks(at, core ? 11 : name === 'head' ? 9 : 5, 6, v, core ? 'torso' : name === 'head' ? 'head' : 'limb');
    for (const c of p.colliders) {
      this.ctx.owners.delete(c.handle);
      this.colHandles.delete(c.handle);
    }
    this.ctx.world.removeRigidBody(p.body); // also drops every joint attached to it
    this.ctx.scene.remove(p.mesh);
    for (const m of p.skinned) this.ctx.scene.remove(m);
    p.gone = true;
    for (const j of JOINTS) if (j.a === name || j.b === name) this.detach(j);
    // everything that hung off this part is now loose
    for (const n in PARTS) for (let a = PARENT[n]; a; a = PARENT[a]) if (a === name) this.severed.add(n);
    this.severed.add(name);
    if (LEGS.has(name)) this.crippled = true;
    if (name === 'head' || name === 'torso' || name === 'pelvis') this.die('gib');
  }

  /**
   * A joint has parted. The skin on each side was blending toward the other side's bone; from now on
   * it follows a stand-in fixed to its own side instead, so the cut end keeps the shape it had at rest.
   */
  detach(def) {
    if (!this.skinned) return;
    for (const [self, other] of [[def.a, def.b], [def.b, def.a]]) {
      const p = this.parts[self];
      if (p.gone) continue;
      if (!p.cutFrom) p.cutFrom = new Set();
      if (p.cutFrom.has(other)) continue;
      p.cutFrom.add(other);
      if (!p.skeleton) {              // its own copy of the bone list, so the swap below is private to this part
        p.skeleton = new THREE.Skeleton(this.skeleton.bones, REST_INV);
        for (const m of p.skinned) m.bind(p.skeleton, IDENT);
        // now that an end of it is open, it needs the flesh and bone that close its cuts
        for (const piece of bodyPieces(self, this.model)) if (isCap(piece.material.name)) p.skinned.push(this.skinMesh(piece, p.skeleton));
      }
      const a = PARTS[other].pos, b = PARTS[self].pos;
      const standIn = new THREE.Object3D();
      standIn.position.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      p.mesh.add(standIn);
      p.skeleton.bones[BONE_INDEX[other]] = standIn;
    }
  }

  addStump(part, local, out, def) {
    const s = makeStump(def.cut[0], def.cut[1], def.kind);
    s.quaternion.setFromUnitVectors(UP, out);
    s.position.copy(local);
    part.mesh.add(s);
  }

  localToWorld(part, local, isDir = false) {
    const r = part.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const v = new THREE.Vector3(local.x, local.y, local.z).applyQuaternion(_q);
    if (!isDir) { const t = part.body.translation(); v.x += t.x; v.y += t.y; v.z += t.z; }
    return v;
  }

  // ------------------------------------------------------------ animation
  /** Fill this.pose with the animated world transform of every part. */
  computePose(dt = 0) {
    const z = this.kind === 'zombie';
    const mix = THREE.MathUtils.lerp;
    const w = clamp(this.speed / (z ? 0.8 : 1.3), 0, 1);     // 0 = standing, 1 = walking
    const run = clamp((this.speed - 1.7) / 2.0, 0, 1);        // 0 = walk, 1 = flat-out run
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const t = this.t;
    const breathe = Math.sin(t * 1.6 + this.seed);
    const pv = this.seed / 10;                                // 0..1: everyone carries themselves a little differently
    const idle = 1 - w;
    const shift = Math.sin(t * 0.35 + this.seed) * idle;      // standing: weight moves slowly from one leg to the other
    let turn = this.targetHeading - this.heading;             // about to turn: the head goes first, the body leans in
    turn = clamp(Math.atan2(Math.sin(turn), Math.cos(turn)), -1, 1);
    this.turnLean = (this.turnLean || 0) + (turn - (this.turnLean || 0)) * Math.min(1, dt * 5);
    turn = this.turnLean;

    // gestures ease in and out; one-shot moves follow a half-sine
    const G = this.gw;
    for (const k in G) G[k] += ((this.gesture === k ? 1 : 0) - G[k]) * Math.min(1, dt * 7);
    const up = G.handsUp, cw = G.cower, ft = G.fight, kn = G.kneel;
    const fl = this.flinchT > 0 ? Math.sin(Math.PI * (1 - this.flinchT / FLINCH)) : 0;
    const pn = this.punchT > 0 ? Math.sin(Math.PI * (1 - this.punchT / PUNCH)) : 0;
    const lg = this.lungeT > 0 ? Math.sin(Math.PI * (1 - this.lungeT / LUNGE)) : 0;
    // hurt: a hand pressed to a body wound (if there is a working arm to do it with), a bad leg favoured
    const armOk = (side) => !this.limp.has('farm' + side) && !this.isFree('farm' + side);
    const cSide = armOk('L') ? 'L' : armOk('R') ? 'R' : null;
    const wantClutch = this.gutShot && !z && cSide && this.gesture === 'none' ? 1 : 0;
    this.clutch += (wantClutch - this.clutch) * Math.min(1, dt * 4);
    const cl = cSide ? this.clutch : 0, sq = this.squat;
    const lameL = this.lame.L, lameR = this.lame.R;

    // ---- legs. +x swings a limb forward; knees only bend backward (negative)
    const stride = mix(z ? 0.38 : 0.55, 0.8, run) * (0.88 + 0.24 * pv);
    const lift = mix(0.85, 1.55, run);
    const trail = z ? 0.1 : mix(0.3, 0.8, run);              // the leg left behind bends as it pushes off
    // a leg reaches further forward than it trails behind
    let hipL = stride * (s + 0.2) * w * (1 - 0.45 * lameL), hipR = stride * (-s + 0.2) * w * (1 - 0.45 * lameR);
    // knee: folds to swing the foot through, and gives a little as the heel takes the weight
    const give = z ? 0.2 : mix(0.5, 0.9, run);
    let kneeL = -(0.06 + lift * Math.max(0, c) * (1 - 0.65 * lameL) + give * Math.max(0, -c) * Math.max(0, s) + trail * Math.max(0, -s) + 0.15 * run) * w - 0.03;       // a bad leg is swung stiff
    let kneeR = -(0.06 + lift * Math.max(0, -c) * (1 - 0.65 * lameR) + give * Math.max(0, c) * Math.max(0, -s) + trail * Math.max(0, s) + 0.15 * run) * w - 0.03;
    // standing: the leg without the weight on it goes soft
    hipL += 0.09 * Math.max(0, shift); kneeL -= 0.16 * Math.max(0, shift);
    hipR += 0.09 * Math.max(0, -shift); kneeR -= 0.16 * Math.max(0, -shift);
    hipL = mix(hipL, 1.9, cw); hipR = mix(hipR, 1.9, cw);                 // squat right down
    kneeL = mix(kneeL, -2.3, cw); kneeR = mix(kneeR, -2.3, cw);
    hipL = mix(hipL, 1.65, kn); hipR = mix(hipR, 1.65, kn);               // down on the haunches: over a body, or behind cover
    kneeL = mix(kneeL, -2.15, kn); kneeR = mix(kneeR, -2.15, kn);
    hipL += 0.12 * ft; kneeL -= 0.25 * ft + 0.3 * fl;                    // fighting crouch / buckling
    hipR += 0.12 * ft; kneeR -= 0.25 * ft + 0.3 * fl;
    hipL = mix(hipL, 1.75, sq); hipR = mix(hipR, 1.75, sq);               // getting up starts from a crouch
    kneeL = mix(kneeL, -2.2, sq); kneeR = mix(kneeR, -2.2, sq);

    // ---- upper body
    let spX, spY, spZ = 0, nkX, nkY, nkZ = 0, shLx, shRx, shLz = 0.07, shRz = -0.07, elL, elR;
    if (z) {
      spX = -0.22 + 0.03 * breathe; spY = 0.1 * s * w; spZ = 0.08 * Math.sin(t * 0.9 + this.seed);
      nkX = 0.2; nkY = 0.25 * Math.sin(t * 0.5 + this.seed); nkZ = 0.25;
      shLx = 1.35 + 0.08 * Math.sin(t * 2.1 + this.seed); shRx = 1.25 + 0.08 * Math.sin(t * 1.7 + this.seed);
      shLz = 0.1; shRz = -0.1;
      elL = 0.15; elR = 0.3;
    } else {
      const arm = mix(0.5, 0.95, run) * (0.8 + 0.4 * pv);
      const sa = Math.sin(this.phase - 0.3);                  // the arms trail the legs a touch
      spX = -0.05 * w - 0.26 * run + 0.012 * breathe - 0.07 * pv * idle; spY = -0.12 * s * w + 0.25 * turn;
      spZ = 0.04 * c * w - 0.05 * shift;                      // shoulders counter the hips
      nkX = 0.04 * w + 0.16 * run + 0.05 * pv * idle;
      nkY = 0.3 * Math.sin(t * 0.45 + this.seed) * idle + 0.1 * s * w + 0.45 * turn;   // head held steady over the twisting trunk
      shLx = -arm * sa * w + 0.03 * breathe + 0.04 * Math.sin(t * 0.7 + this.seed) * idle;
      shRx = arm * sa * w - 0.03 * breathe - 0.04 * Math.sin(t * 0.6 + this.seed) * idle;
      shLz += 0.04 * w; shRz -= 0.04 * w;
      elL = 0.18 + 0.14 * pv + 0.3 * w + 0.3 * Math.max(0, -sa) * w + 1.1 * run;
      elR = 0.18 + 0.14 * pv + 0.3 * w + 0.3 * Math.max(0, sa) * w + 1.1 * run;
    }
    // hands up: arms overhead in a V
    shLx = mix(shLx, 2.85, up); shRx = mix(shRx, 2.85, up);
    shLz = mix(shLz, 0.4, up); shRz = mix(shRz, -0.4, up);
    elL = mix(elL, 0.5, up); elR = mix(elR, 0.5, up);
    // cower: folded over, hands on head
    spX = mix(spX, -0.95, cw); nkX = mix(nkX, -0.45, cw);
    shLx = mix(shLx, 2.5, cw); shRx = mix(shRx, 2.5, cw);
    shLz = mix(shLz, -0.25, cw); shRz = mix(shRz, 0.25, cw);
    elL = mix(elL, 2.2, cw); elR = mix(elR, 2.2, cw);
    spX = mix(spX, -0.55, kn); shLx = mix(shLx, 0.9, kn * (1 - G.aim)); elL = mix(elL, 0.5, kn * (1 - G.aim));   // (kneeling: a hand reaching down)
    // fight: guard up, right arm fires out on a punch
    shLx = mix(shLx, 1.0, ft); elL = mix(elL, 1.9, ft);
    shRx = mix(shRx, mix(0.95, 1.55, pn), ft); elR = mix(elR, mix(1.9, 0.12, pn), ft);
    spY += (0.2 - 0.6 * pn) * ft;
    // aim: pistol arm straight out, the other hand up under it
    const am = G.aim;
    shRx = mix(shRx, 1.5, am); elR = mix(elR, 0.08, am); shRz = mix(shRz, 0.12, am);
    shLx = mix(shLx, 1.25, am); elL = mix(elL, 0.6, am); shLz = mix(shLz, -0.3, am);
    // zombie lunge, and recoiling from a hit
    spX += -0.4 * lg + 0.32 * fl;
    shLx += 0.3 * lg; shRx += 0.3 * lg;
    spY += this.flinchSide * 0.45 * fl;
    nkX += 0.25 * fl;
    // stumbling: bent back, arms thrown out for balance, feet scrabbling to get back under the body
    if (this.stumbleT > 0) {
      const k = 1 - this.stumbleT / STUMBLE, st = this.stumbleFall ? Math.min(1, k * 2.5) : Math.sin(Math.PI * k);
      const f = Math.sin(t * 15);
      hipL += 0.55 * st * f; hipR -= 0.55 * st * f;
      kneeL -= st * (0.35 + 0.45 * Math.max(0, f)); kneeR -= st * (0.35 + 0.45 * Math.max(0, -f));
      spX += 0.3 * st; nkX -= 0.15 * st; spZ += 0.12 * st * Math.sin(t * 7);
      shLz += 0.8 * st; shRz -= 0.8 * st;
      shLx += 0.5 * st * Math.sin(t * 9); shRx += 0.5 * st * Math.cos(t * 8);
      elL += 0.4 * st; elR += 0.4 * st;
    }
    // limping: the body tips over the bad leg while it carries the weight
    spZ += (lameR * Math.max(0, c) - lameL * Math.max(0, -c)) * 0.2 * w;
    spX -= 0.12 * Math.max(lameL, lameR) * w;
    // clutching a wound: forearm across the belly, hunched over it
    let shLy = 0, shRy = 0;
    if (cl > 0.01) {
      if (cSide === 'L') { shLx = mix(shLx, 0.3, cl); shLy = 0.8 * cl; shLz = mix(shLz, 0, cl); elL = mix(elL, 1.6, cl); }
      else { shRx = mix(shRx, 0.3, cl); shRy = -0.8 * cl; shRz = mix(shRz, 0, cl); elR = mix(elR, 1.6, cl); }
      spX -= 0.18 * cl;
      nkX -= 0.1 * cl;
    }
    // holding a hostage: the gun arm out as when aiming, the other arm wrapped round in front of them
    const hd = G.hold;
    shRx = mix(shRx, 1.5, hd); elR = mix(elR, 0.08, hd); shRz = mix(shRz, 0.12, hd);
    shLx = mix(shLx, 1.45, hd); elL = mix(elL, 1.35, hd); shLz = mix(shLz, -0.5, hd); shLy = mix(shLy, 0.6, hd);
    // getting up: folded forward, hands leaving the ground
    spX = mix(spX, -0.6, sq);
    shLx = mix(shLx, 0.7, sq); shRx = mix(shRx, 0.7, sq);
    elL = mix(elL, 0.4, sq); elR = mix(elR, 0.4, sq);

    // ---- head follows whatever the brain is looking at
    let wantYaw = 0, wantPitch = 0;
    if (this.look) {
      const dx = this.look.x - this.root.x, dz = this.look.z - this.root.z;
      let a = Math.atan2(-dx, -dz) - this.heading - spY;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      wantYaw = clamp(a, -1.1, 1.1);
      wantPitch = clamp(Math.atan2(this.look.y - (this.root.y + 1.65), Math.hypot(dx, dz)), -0.6, 0.6);
    }
    const lk = Math.min(1, dt * 8);
    this.lookYaw += (wantYaw - this.lookYaw) * lk;
    this.lookPitch += (wantPitch - this.lookPitch) * lk;
    if (this.look) nkY = this.lookYaw; else nkY += this.lookYaw;
    nkX += this.lookPitch;

    const L = (name, x, y = 0, zr = 0) => this.joints[name].local.setFromEuler(_e.set(x, y, zr, 'YXZ'));
    const roll = 0.035 * c * w + (z ? 0.05 * s : 0) + 0.045 * shift + 0.1 * turn * w;   // hips drop to the swinging side, and lean into a turn
    L('hipL', hipL, 0, 0.02 + 0.05 * ft - roll);            // (legs stay upright under tilted hips)
    L('hipR', hipR, 0, -0.02 - 0.05 * ft - roll);
    L('kneeL', kneeL);
    L('kneeR', kneeR);
    L('spine', spX, spY, spZ);
    L('neck', nkX, nkY, nkZ);
    L('shoulderL', shLx, shLy, shLz);
    L('shoulderR', shRx, shRy, shRz);
    L('elbowL', elL);
    L('elbowR', elR);
    // running: the recorded stride takes over, as far as nothing else (a gesture, a bad leg, a stumble) wants the body
    const free = z ? 0 : w * (1 - clamp(up + cw + ft + kn + sq + cl + fl + Math.max(lameL, lameR) + (this.stumbleT > 0 ? 1 : 0), 0, 1));
    const u = this.phase / (Math.PI * 2);
    for (const [clip, k] of [[CLIPS.walk, free * (1 - run)], [CLIPS.run, free * run]]) {
      if (!clip || k < 0.01) continue;
      for (const name in this.joints) {
        if (name === 'neck' && this.look) continue;                         // the head is busy looking at something
        if ((am > 0.01 || hd > 0.01) && (name.startsWith('shoulder') || name.startsWith('elbow'))) continue;   // the arms are busy with a gun
        this.joints[name].local.slerp(clipAt(clip, name, u, _c0), k);
      }
    }
    // changing magazines: the upper body plays the reload, eased in and out
    if (this.reloadT > 0 && CLIPS.reload) {
      this.reloadT += dt;
      const len = clipLen(CLIPS.reload), r = this.reloadT / len, k = clamp(Math.min(r, 1 - r) * 6, 0, 1);
      for (const name of ['spine', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR']) this.joints[name].local.slerp(clipAt(CLIPS.reload, name, r, _c0, false), k);
      if (r >= 1) { this.reloadT = 0; this.rounds = MAG; }
    }
    // too hurt to stay up: the recorded stagger and fall, all of it, until the hips are on their way down
    let fall = 0;
    if (this.collapseT > 0) {
      this.collapseT += dt;
      const len = clipLen(CLIPS.die), r = this.collapseT / len, f = Math.min(CLIPS.die.frames - 1, Math.floor(r * CLIPS.die.frames));
      fall = clamp(this.collapseT * 4, 0, 1);
      for (const name in this.joints) this.joints[name].local.slerp(clipAt(CLIPS.die, name, r, _c0, false), fall);
      this.slump = CLIPS.die.hips[f] < 0.8;                    // (move() stops walking once the legs go)
      if (CLIPS.die.hips[f] < 0.62 || r >= 1) { this.goLimp(2); fall = 0; }
    }

    // forward kinematics from the pelvis, placed at the origin first
    const pel = this.pose.pelvis;
    pel.q.setFromEuler(_e.set(-0.03 * w - 0.07 * run, this.heading + 0.1 * s * w, roll, 'YXZ'));
    for (const [clip, k] of [[CLIPS.walk, free * (1 - run)], [CLIPS.run, free * run]]) {
      if (clip && k > 0.01) pel.q.slerp(_q.setFromEuler(_e.set(0, this.heading, 0, 'YXZ')).multiply(clipAt(clip, 'pelvis', u, _c0)), k);
    }
    if (fall > 0) pel.q.slerp(_q.setFromEuler(_e.set(0, this.heading, 0, 'YXZ')).multiply(clipAt(CLIPS.die, 'pelvis', this.collapseT / clipLen(CLIPS.die), _c0, false)), fall);
    pel.p.set(0, 0, 0);
    for (const j of JOINTS) {
      const jd = this.joints[j.name];
      const A = this.pose[j.a], B = this.pose[j.b];
      B.q.copy(A.q).multiply(jd.local);
      B.p.copy(jd.a1).applyQuaternion(A.q).add(A.p).sub(_v.copy(jd.a2).applyQuaternion(B.q));
    }
    // drop the body so the lower foot rests on the ground (this is what makes a squat a squat)
    let low = Infinity;
    for (const n of ['shinL', 'shinR']) {
      const y = _v.set(0, -0.245, 0).applyQuaternion(this.pose[n].q).y + this.pose[n].p.y;
      if (y < low) low = y;
    }
    _t.set(this.root.x, this.root.y - low, this.root.z);
    for (const n in this.pose) this.pose[n].p.add(_t);
  }

  /** Drive the kinematic bodies. blend < 1 mixes from the captured ragdoll pose (getting up). */
  applyPose(blend = 1) {
    for (const n in this.parts) {
      const p = this.parts[n];
      if (p.gone || !p.body.isKinematic()) continue;
      const tgt = this.pose[n];
      if (blend < 1) {
        const c = this.captured[n];
        _v.copy(c.p).lerp(tgt.p, blend);
        _q.copy(c.q).slerp(tgt.q, blend);
        p.body.setNextKinematicTranslation(_v);
        p.body.setNextKinematicRotation(_q);
      } else {
        p.body.setNextKinematicTranslation(tgt.p);
        p.body.setNextKinematicRotation(tgt.q);
      }
    }
  }

  groundBelow(x, y, z, max) {
    const hit = this.ctx.gore.castFixed(x, y, z, 0, -1, 0, max);
    return hit ? y - hit.timeOfImpact : null;
  }

  /** Carry out what the brain asked for: turn, accelerate, walk the root over the ground. */
  move(dt) {
    this.flinchT = Math.max(0, this.flinchT - dt);
    this.punchT = Math.max(0, this.punchT - dt);
    this.lungeT = Math.max(0, this.lungeT - dt);
    this.hitAccum = Math.max(0, this.hitAccum - dt * 320);
    if (this.stumbleT > 0 && (this.stumbleT -= dt) <= 0 && this.stumbleFall) { this.goLimp(1.4); return; }   // did not catch it

    // a hit stops you in your tracks; a bad leg or a hole in the gut slows you down
    const want = this.flinchT > 0 || this.stumbleT > 0 || (this.collapseT > 0 && this.slump) ? 0 : this.wantSpeed * (1 - 0.5 * Math.max(this.lame.L, this.lame.R)) * (1 - 0.15 * this.clutch);
    this.speed += (want - this.speed) * Math.min(1, dt * 5);
    let dh = this.targetHeading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const turn = this.speed > 2 ? 6 : 3.4;
    this.heading += clamp(dh, -turn * dt, turn * dt);
    _fwd.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));

    // staggering back from a hit
    let vx = _fwd.x * this.speed, vz = _fwd.z * this.speed;
    if (this.flinchT > 0) {
      const k = 1.5 * Math.sin(Math.PI * (1 - this.flinchT / FLINCH));
      vx += this.flinchDir.x * k; vz += this.flinchDir.z * k;
    }
    if (this.stumbleT > 0) {
      const k = 2.4 * this.stumbleT / STUMBLE;
      vx += this.flinchDir.x * k; vz += this.flinchDir.z * k;
    }
    if (Math.abs(vx) + Math.abs(vz) < 0.02) return;

    const nx = this.root.x + vx * dt, nz = this.root.z + vz * dt;
    const gy = this.groundBelow(nx, this.root.y + 0.8, nz, 2.2);
    if (gy === null || gy < this.root.y - 0.7) {
      // a drop ahead: zombies and anyone knocked backward go over it, everyone else turns away
      if (this.kind === 'zombie' || this.flinchT > 0) {
        this.root.x = nx; this.root.z = nz;
        this.goLimp(1.6);
      } else {
        this.brain.bump();
        this.speed = 0;
      }
      return;
    }
    if (gy > this.root.y + 0.45) { this.brain.bump(); return; }   // too tall to step on
    this.root.x = nx; this.root.z = nz;
    this.root.y += (gy - this.root.y) * Math.min(1, dt * 12);
    const run = clamp((this.speed - 1.7) / 2.0, 0, 1);
    const cycle = THREE.MathUtils.lerp(this.kind === 'zombie' ? 1.3 : 1.9, 3.3, run); // metres per two steps
    this.phase += this.speed * dt * (Math.PI * 2) / cycle;
    // each footfall: stepping in blood wets the soles, and the next few steps print it
    const stepN = Math.floor(this.phase / Math.PI);
    if (stepN !== this.stepN) {
      this.stepN = stepN;
      const gore = this.ctx.gore;
      if (gore.wetAt(this.root)) this.bloody = 9;
      else if (this.bloody > 0) {
        const side = stepN % 2 ? 0.1 : -0.1;
        gore.footprint({ x: this.root.x - _fwd.z * side, y: this.root.y, z: this.root.z + _fwd.x * side }, _fwd, this.bloody-- / 9);
      }
    }
  }

  /** Something heavy and fast touching an animated NPC knocks it over. */
  checkKnocks() {
    let hitBy = null;
    for (const n of KNOCK_PARTS) {
      const p = this.parts[n];
      if (p.gone) continue;
      this.ctx.world.contactPairsWith(p.collider, (other) => {
        if (hitBy || this.colHandles.has(other.handle)) return;
        const b = other.parent();
        if (!b || !b.isDynamic()) return;
        const v = b.linvel();
        const sp = Math.hypot(v.x, v.y, v.z), m = b.mass();
        if (sp > 2.2 && m * sp > 22) hitBy = { v, sp, m, part: n };
      });
      if (hitBy) break;
    }
    if (!hitBy) return;
    const { v, sp, m, part } = hitBy;
    this.goLimp(1.5 + Math.min(2.5, m * sp / 150));
    const k = Math.min(260, m * sp * 0.6);
    this.parts[part].body.applyImpulse({ x: v.x / sp * k, y: v.y / sp * k + 20, z: v.z / sp * k }, true);
    const dmg = Math.min(70, Math.max(0, m * sp * 0.12 - 4));
    if (dmg > 1) {
      this.parts[part].hp -= dmg * 0.5;
      this.damage(dmg);
      if (dmg > 18) {
        const t = this.parts[part].body.translation();
        this.ctx.gore.blood(t, _v.set(v.x / sp, 0.4, v.z / sp), 10, 3.5, 0.9);
      }
    }
  }

  /**
   * Active ragdoll. Every joint is pulled toward a target angle with strength `tone`, and always
   * has some friction, so limbs behave like limbs rather than rope. Joint limits (swing cone and
   * twist) stop arms and legs folding the wrong way.
   * limpOnly: the body is being animated and only its dead-hanging limbs are simulated.
   */
  muscles(dt, limpOnly = false) {
    let brace = false, hurt = false, wake = true, settled = false, crawl = null, tone = 0.04;
    if (!limpOnly) {
      this.fallT += dt;
      brace = !this.dead && this.fallT < 0.3;      // a moment of reflex; by the time the ground arrives the body is loose again
      hurt = !this.dead && !brace && (this.crippled || this.health <= 20 || this.bleedRate > 1);
      crawl = this.crawl(dt, brace);
      // the dead keep a trace of tone for a few seconds, then only joint friction is left
      const want = this.dead ? (this.deadT > 3 ? 0 : 0.05) : brace ? 0.6 : crawl ? 0.6 : hurt ? 0.3 : 0.18;   // loose: a body that is down is mostly dead weight
      this.tone += (want - this.tone) * Math.min(1, dt * (this.dead ? 1.5 : 6));
      tone = this.tone;
      wake = hurt || brace;     // the living keep moving; the dead are allowed to settle and sleep
      // a corpse that has come to rest is left alone: limit forces on a limb pinned against the
      // floor would otherwise keep nudging it forever
      settled = this.dead && this.deadT > 4;
    }

    for (const j of JOINTS) {
      if (this.severed.has(j.b)) continue;
      const slack = this.limp.has(j.b);       // nothing works this joint any more
      if (limpOnly && !slack) continue;
      const A = this.parts[j.a], B = this.parts[j.b];
      if (A.gone || B.gone) continue;
      if (!wake && B.body.isSleeping()) continue;
      const kp = (slack ? Math.min(tone, 0.04) : tone) * 81, kd = slack ? 3.6 : tone * 14 + 2.2;
      const ra = A.body.rotation(), rb = B.body.rotation();
      _q.set(ra.x, ra.y, ra.z, ra.w);
      _q2.set(rb.x, rb.y, rb.z, rb.w);
      _a.copy(j.refAxis).applyQuaternion(_q);  // the middle of the joint's range, as the parent holds it now
      _b.set(0, 1, 0).applyQuaternion(_q2);    // child's long axis
      // inertia is stored about the part's centre; a limb swings about its end, which is ~4x more.
      // Without that factor the muscles are too weak to lift a limb against gravity.
      const I = Math.min(A.inertia, B.inertia) * 4;
      const wa = A.body.angvel(), wb = B.body.angvel();
      const wx = wb.x - wa.x, wy = wb.y - wa.y, wz = wb.z - wa.z;

      // --- pose: rotation that would take the child to its target, as an axis * angle
      let x = brace ? BRACE[j.name] : REST[j.name];
      if (crawl && !slack) {
        // arms take turns reaching out past the head and dragging back; the head is held up
        const side = j.name.slice(-1);
        if (j.name.startsWith('shoulder')) x = 1.2 + 1.6 * crawl[side];
        else if (j.name.startsWith('elbow')) x = 0.25 + 1.3 * (1 - crawl[side]);
        else if (j.name === 'neck') x = 0.45;
        else if (j.name === 'spine') x = 0.12;
      } else if (hurt && !slack && j.name !== 'spine' && j.name !== 'neck') {
        // writhing: slow, uneven pulls on each limb
        const sgn = j.name.startsWith('knee') ? -1 : 1;
        x += sgn * 0.55 * (0.5 + 0.5 * Math.sin(this.t * (1.3 + (j.anchor[0] > 0 ? 0.4 : 0)) + j.anchor[1] * 9 + this.seed));
      }
      _qt.setFromEuler(_e.set(x, 0, 0, 'YXZ'));
      _qw.copy(_q).multiply(_qt).multiply(_qInv.copy(_q2).invert());
      if (_qw.w < 0) { _qw.x = -_qw.x; _qw.y = -_qw.y; _qw.z = -_qw.z; _qw.w = -_qw.w; }
      const half = Math.acos(clamp(_qw.w, -1, 1));
      const sh = Math.sin(half);
      const ang = half * 2;
      let tx = 0, ty = 0, tz = 0;
      if (sh > 1e-4) { const k = kp * ang / sh; tx = _qw.x * k; ty = _qw.y * k; tz = _qw.z * k; }
      tx -= wx * kd; ty -= wy * kd; tz -= wz * kd;
      // a limb has almost no inertia about its own long axis: use far less torque that way
      const along = (tx * _b.x + ty * _b.y + tz * _b.z) * 0.93;
      tx -= _b.x * along; ty -= _b.y * along; tz -= _b.z * along;

      // --- swing limit: child may only bend so far from the middle of its range
      if (j.cone && !(settled && Math.hypot(wx, wy, wz) < 1.5)) {
        const sw = Math.acos(clamp(_a.dot(_b), -1, 1));
        if (sw > j.cone) {
          _v.crossVectors(_b, _a);
          const l = _v.length();
          if (l > 1e-4) {
            const k = 121 * (sw - j.cone) / l;
            tx += _v.x * k; ty += _v.y * k; tz += _v.z * k;
          }
          // a joint at its limit soaks the motion up; without this it is a spring and throws it back
          tx -= wx * 18; ty -= wy * 18; tz -= wz * 18;
        }
        // --- twist limit: and may only rotate so far about its own axis
        _qw.copy(_q).invert().multiply(_q2);           // child relative to parent
        let tw = 2 * Math.atan2(_qw.y, _qw.w);
        tw = Math.atan2(Math.sin(tw), Math.cos(tw));
        const lim = TWIST[j.name] || 0.9;
        if (Math.abs(tw) > lim) {
          const k = -Math.sign(tw) * (Math.abs(tw) - lim) * 121 * 0.07;
          tx += _b.x * k; ty += _b.y * k; tz += _b.z * k;
        }
      }

      const mag = Math.hypot(tx, ty, tz);
      if (mag < 1e-5) continue;
      const s = I * Math.min(1, 320 / mag) * dt;
      B.body.applyTorqueImpulse({ x: tx * s, y: ty * s, z: tz * s }, wake);
      A.body.applyTorqueImpulse({ x: -tx * s, y: -ty * s, z: -tz * s }, wake);
    }

    // death throes: a few fading jerks
    if (!limpOnly && this.twitch > 0) {
      this.twitch -= dt;
      if (Math.random() < dt * 14 * this.twitch) {
        const names = ['farmL', 'farmR', 'shinL', 'shinR', 'head'];
        const p = this.parts[names[(Math.random() * names.length) | 0]];
        if (!p.gone && !this.isFree(p.name)) {
          const k = p.inertia * 14 * Math.min(1, this.twitch);
          p.body.applyTorqueImpulse({ x: rnd(-1, 1) * k, y: rnd(-0.3, 0.3) * k, z: rnd(-1, 1) * k }, true);
        }
      }
    }
  }

  /**
   * Too hurt to stand but not finished: drag yourself along the ground. People crawl away from what
   * frightened them, zombies toward whatever they were after (and still bite when they get there).
   * Returns how far each arm is reached out ({ L, R }, 0..1), or null when not crawling.
   */
  crawl(dt, brace) {
    this.crawling = false;
    const tor = this.parts.torso, pel = this.parts.pelvis;
    if (this.dead || brace || this.fallT < 1.4 || tor.gone || pel.gone || this.severed.has('torso')) return null;
    const zombie = this.kind === 'zombie';
    if (!(this.crippled || (!zombie && this.health <= 20))) return null;
    if (this.ctx.weapons?.grab?.rag === this) return null;
    const armL = !this.limp.has('uarmL') && !this.isFree('uarmL'), armR = !this.limp.has('uarmR') && !this.isFree('uarmR');
    if (!armL && !armR) return null;

    // keep thinking; the brain reckons from where the feet would be
    const t = pel.body.translation();
    this.root.set(t.x, t.y - 0.12, t.z);
    this.crawling = true;
    this.brain.update(dt);
    const b = this.brain;
    let dx, dz;
    if (zombie) {
      const tg = b.target;
      if (!tg) return null;
      const tp = tg === this.ctx.player ? tg.pos : tg.center(_c);
      dx = tp.x - t.x; dz = tp.z - t.z;
      if (Math.hypot(dx, dz) < 0.7) return null;        // there: stop dragging, start biting
    } else {
      if (b.state === 'calm') return null;
      dx = t.x - b.threat.x; dz = t.z - b.threat.z;
      if (Math.hypot(dx, dz) > 24) return null;         // far enough: lie still
    }
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;

    this.crawlPhase += dt * (zombie ? 3.4 : 4.4);
    const ph = this.crawlPhase;
    const reach = { L: armL ? 0.5 + 0.5 * Math.sin(ph) : 0, R: armR ? 0.5 - 0.5 * Math.sin(ph) : 0 };
    // an arm drags while it is coming back toward the body
    const pull = (armL ? Math.max(0, -Math.cos(ph)) : 0) + (armR ? Math.max(0, Math.cos(ph)) : 0);
    const r = tor.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _a.set(0, 1, 0).applyQuaternion(_q);      // toward the head
    _b.set(0, 0, -1).applyQuaternion(_q);     // out of the chest
    const v = tor.body.linvel();
    if (v.x * dx + v.z * dz < (zombie ? 0.75 : 0.6)) {
      // pulled from the shoulders, so the rest of the body swings round to trail behind
      const f = this.mass * CRAWL_PULL * pull * dt;
      const tt = tor.body.translation();
      tor.body.applyImpulseAtPoint({ x: dx * f, y: f * 0.3, z: dz * f }, { x: tt.x + _a.x * 0.18, y: tt.y + _a.y * 0.18, z: tt.z + _a.z * 0.18 }, true);
    }
    // roll chest-down: nobody crawls on their back
    let s = _b.z * _a.x - _b.x * _a.z;
    if (_b.y > 0.9) s = 1;
    const w = tor.body.angvel();
    const k = (s * 9 - (w.x * _a.x + w.y * _a.y + w.z * _a.z) * 1.2) * dt;
    tor.body.applyTorqueImpulse({ x: _a.x * k, y: _a.y * k, z: _a.z * k }, true);
    pel.body.applyTorqueImpulse({ x: _a.x * k * 0.5, y: _a.y * k * 0.5, z: _a.z * k * 0.5 }, true);
    return reach;
  }

  /** A bleeding body pulled over the ground (crawling, dragged, sliding) leaves a smear. */
  trail() {
    if (!(this.drips.length || this.sevBleed) || this.deadT > 120) return;
    const p = this.parts.torso.gone ? this.parts.pelvis : this.parts.torso;
    if (p.gone) return;
    const t = p.body.translation();
    const dx = t.x - this.trailAt.x, dz = t.z - this.trailAt.z, d = Math.hypot(dx, dz);
    if (d < 0.32) return;
    const fresh = this.trailAt.y < -50;      // first look: only note where we are
    this.trailAt.set(t.x, 0, t.z);
    if (fresh || d > 1.2) return;            // (a jump that big was a throw, not a drag)
    const gore = this.ctx.gore;
    const hit = gore.castFixed(t.x, t.y, t.z, 0, -1, 0, 0.3);
    if (hit) gore.smear({ x: t.x - dx * 0.5, y: t.y - hit.timeOfImpact, z: t.z - dz * 0.5 }, hit.normal, { x: dx, y: 0, z: dz }, rnd(0.16, 0.3), d * 1.6);
  }

  /** Something in the body stopped dead against something solid: bruises, breaks, blood on the wall. */
  impacts() {
    if (this.ctx.weapons?.grab?.rag === this) this.impactMute = Math.max(this.impactMute, 0.1);   // being waved about by the grab gun
    let touching = null;                      // found out only if something looks like a hit
    // pv trails the real velocity by a few frames, so a stop spread over several steps (legs
    // crumpling under a long fall) counts the same as one that happens in a single step
    const lag = 1 - Math.exp(-this.lastDt / 0.06);
    for (const n of CORE) {
      const p = this.parts[n];
      if (p.gone) continue;
      const v = p.body.linvel();
      const dv = Math.hypot(v.x - p.pv.x, v.y - p.pv.y, v.z - p.pv.z);
      if (this.impactMute <= 0 && dv > IMPACT[n]) {
        // it only counts if the body is against something that is not itself (the legs may have
        // taken the landing: the torso need not be the part that touched)
        if (touching === null) touching = this.touching();
        if (touching) { this.impact(p, dv - IMPACT[n], touching); return; }
      }
      p.pv.x += (v.x - p.pv.x) * lag; p.pv.y += (v.y - p.pv.y) * lag; p.pv.z += (v.z - p.pv.z) * lag;
    }
  }

  /** Something outside this body that it is in contact with right now, or false. */
  touching() {
    let found = false;
    for (const n in this.parts) {
      const p = this.parts[n];
      if (p.gone || this.isFree(n)) continue;
      for (const col of p.colliders) {
        this.ctx.world.contactPairsWith(col, (c) => {
          if (found || this.colHandles.has(c.handle)) return;
          this.ctx.world.contactPair(col, c, (m) => { if (m.numContacts() > 0) found = c; });
        });
        if (found) return found;
      }
    }
    return false;
  }

  impact(p, over, other) {
    const { gore, sfx } = this.ctx;
    this.impactMute = 0.2;                    // one landing, one injury
    const head = p.name === 'head';
    const dmg = over * 10 * (this.kind === 'zombie' ? 0.4 : 1);
    const t = p.body.translation();
    const sp = p.pv.length() || 1;
    _v.copy(p.pv).multiplyScalar(1 / sp);     // the way it was going
    sfx.thud(Math.min(1.6, 0.5 + dmg / 25));
    if (dmg > 8) {
      if (dmg > 16) sfx.crack();
      gore.blood(t, _t.set(-_v.x * 0.3, 0.6, -_v.z * 0.3), Math.min(24, 4 + dmg * 0.5), 3, 1.3);
      const b = other.parent();
      if (!b || b.isFixed()) {
        const hit = gore.castFixed(t.x, t.y, t.z, _v.x, _v.y, _v.z, 0.6);
        if (hit) {
          const at = { x: t.x + _v.x * hit.timeOfImpact, y: t.y + _v.y * hit.timeOfImpact, z: t.z + _v.z * hit.timeOfImpact };
          gore.splat(at, hit.normal, Math.min(0.7, 0.12 + dmg * 0.012));
          if (dmg > 20) gore.run(at, hit.normal);
        }
      }
      if (head && dmg > 14) {                 // the scalp splits where it landed
        this.split();
        const r = p.body.rotation();
        const lp = _v.clone().applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert()).multiplyScalar(0.11);
        openWound(p, lp, Math.min(0.045, 0.015 + dmg * 0.0008), 0.07);
        this.bleed(p, lp, 4, 0.4);
      }
    }
    for (const n of CORE) { const q = this.parts[n]; if (!q.gone) { const v = q.body.linvel(); q.pv.set(v.x, v.y, v.z); } }
    p.hp -= dmg * 0.5;
    if (dmg > 3 && !this.dead) this.stun = Math.max(this.stun, 1 + Math.min(3, dmg / 15));
    if (head && p.hp <= 0) this.die('impact');
    else this.damage(dmg * (head ? 1.5 : 1), 'impact');
  }

  tryGetUp() {
    const pel = this.parts.pelvis, tor = this.parts.torso;
    if (pel.gone || tor.gone) return;
    const v = pel.body.linvel();
    if (Math.hypot(v.x, v.y, v.z) > 0.6) { this.stun = 0.3; return; } // still tumbling
    const t = pel.body.translation();
    const gy = this.groundBelow(t.x, t.y + 0.4, t.z, 2.0);
    if (gy === null) { this.stun = 0.5; return; }
    this.root.set(t.x, gy, t.z);
    // keep facing roughly where the body points, if that is meaningful
    const r = pel.body.rotation();
    _v.set(0, 0, -1).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
    if (Math.hypot(_v.x, _v.z) > 0.4) this.heading = Math.atan2(-_v.x, -_v.z);
    this.targetHeading = this.heading;
    this.speed = 0;
    this.wantSpeed = 0;
    this.gw.handsUp = this.gw.cower = this.gw.fight = this.gw.aim = this.gw.hold = 0;
    for (const n in this.parts) {
      const p = this.parts[n];
      if (p.gone) continue;
      const pt = p.body.translation(), pr = p.body.rotation();
      this.captured[n].p.set(pt.x, pt.y, pt.z);
      this.captured[n].q.set(pr.x, pr.y, pr.z, pr.w);
    }
    this.getupT = 0;
    this.squat = 1;
    this.setMode('getup');
  }

  // ------------------------------------------------------------ per-frame
  /** Called before the physics step. */
  update(dt) {
    if (this.removed || dt <= 0) return;
    this.t += dt;
    this.lastDt = dt;
    const gore = this.ctx.gore;

    // arterial spurts from stumps: pulsing, aimed out of the wound, fading with time
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const b = this.bleeders[i];
      b.t -= dt;
      if (b.t <= 0 || b.part.gone) { this.bleeders.splice(i, 1); continue; }
      const strength = Math.min(1, b.t / 7);
      const pulse = Math.pow(Math.max(0, Math.sin(this.t * 8.5)), 2);
      b.acc = (b.acc || 0) + b.rate * (0.15 + 0.85 * pulse) * strength * dt;
      if (b.acc >= 1) {
        const wp = this.localToWorld(b.part, b.local);
        const out = this.localToWorld(b.part, b.out, true);
        const n = Math.floor(b.acc);
        b.acc -= n;
        gore.blood(wp, out, n, 0.6 + 3.2 * strength * (0.4 + pulse), 0.35);
      }
      if (!b.pooled && b.t < 5 && b.part.body.isSleeping()) {
        b.pooled = true;
        const wp = this.localToWorld(b.part, b.local);
        const hit = gore.castFixed(wp.x, wp.y + 0.1, wp.z, 0, -1, 0, 0.7);
        if (hit) gore.pool({ x: wp.x, y: wp.y + 0.1 - hit.timeOfImpact, z: wp.z }, hit.normal, rnd(0.5, 0.9));
      }
    }
    // open wounds drip (a trail, if their owner is moving) and drain health until they clot
    const zombie = this.kind === 'zombie';
    const pulse = this.dead ? Math.max(0, 1 - this.deadT / 9) : 1;      // no heartbeat, no pressure
    let seep = 0;
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.t += dt;
      if (d.part.gone || d.t > 150 || pulse <= 0) { this.drips.splice(i, 1); continue; }
      const clot = Math.exp(-d.t / (LIMBS.has(d.part.name) ? 35 : 140));
      seep += d.hp * clot;
      d.acc += d.rate * 0.6 * (0.2 + 0.8 * Math.exp(-d.t / 6)) * clot * pulse * dt;
      if (d.acc >= 1) {
        d.acc -= 1;
        const v = d.part.body.linvel();
        gore.drip(this.localToWorld(d.part, d.local), _v.set(v.x * 0.6, v.y * 0.6, v.z * 0.6));
      }
    }
    // many holes do not empty a body many times faster: there is only so much pressure behind them
    const loss = zombie ? 0 : this.sevBleed + Math.min(1.6, seep);
    this.bleedRate = loss;
    if (loss > 0 && !this.dead) this.damage(loss * dt, 'bled');
    if (this.impactMute > 0) this.impactMute -= dt;

    // alight: flames off every part, charring as it goes, and it does not last long
    if (this.burnT > 0) {
      this.burnT -= dt;
      if (!this.dead) {
        this.cry(this.kind === 'zombie' ? 'growl' : 'scream', 0.9);
        this.damage(9 * dt, 'burned');
        if (this.brain.state !== 'flee' && this.kind !== 'zombie') { this.brain.state = 'flee'; this.brain.fear = 1; }
      }
      const names = Object.keys(this.parts);
      for (let k = 0; k < 2; k++) {
        const p = this.parts[names[(Math.random() * names.length) | 0]];
        if (p.gone) continue;
        const t = p.body.translation(), hot = Math.random();
        gore.fire.emit(t.x + rnd(-0.08, 0.08), t.y + rnd(-0.1, 0.1), t.z + rnd(-0.08, 0.08), rnd(-0.4, 0.4), rnd(1.2, 2.6), rnd(-0.4, 0.4),
          rnd(0.18, 0.4), rnd(0.3, 0.6), -1.5, 1, 0.35 + hot * 0.4, hot * 0.1, 0, 1);
        if (Math.random() < 0.08) gore.smoke.emit(t.x, t.y + 0.3, t.z, rnd(-0.3, 0.3), rnd(1, 2), rnd(-0.3, 0.3), rnd(0.4, 0.8), rnd(1, 2), -0.4, 0.08, 0.08, 0.08, 0, 1.2);
        p.heat = Math.min(1, (p.heat || 0) + dt * 0.5);
        burn(p, p.heat);
      }
    }
    // too much blood gone to stay on your feet
    if (this.mode !== 'ragdoll' && !this.dead && !zombie && this.health <= 20 && !(this.collapseT > 0)) {
      if (CLIPS.die && this.mode === 'anim' && this.stumbleT <= 0) this.collapseT = 1e-3; else this.goLimp(2);
    }

    if (this.dead) {
      this.deadT += dt;
      // bitten and still in one piece: it gets back up
      if (this.infected && this.deadT > 6 && !this.crippled && !this.parts.head.gone && !this.parts.torso.gone
        && !this.severed.has('head') && !this.severed.has('torso')) {
        this.reanimate();
      }
      // blood slowly pools under a body once it has come to rest
      if (!this.pooled && this.bled && this.deadT > 1.2) {
        const tor = [this.parts.torso, this.parts.pelvis].find((p) => !p.gone);
        if (!tor) this.pooled = true;                  // blown to bits: nothing left to pool under
        const v = tor ? tor.body.linvel() : null;
        if (v && Math.hypot(v.x, v.y, v.z) < 0.25) {
          this.pooled = true;
          const t = tor.body.translation();
          const hit = gore.castFixed(t.x, t.y + 0.1, t.z, 0, -1, 0, 0.8);
          if (hit) gore.pool({ x: t.x, y: t.y + 0.1 - hit.timeOfImpact, z: t.z }, hit.normal, rnd(0.8, 1.2) + Math.min(0.7, this.drips.length * 0.12));
        }
      }
    }

    if (this.mode === 'anim') {
      this.brain.update(dt);
      // people scream when they start to run; the dead moan when they have someone to go for
      const state = this.brain.state;
      if (state === 'flee' && this.wasState !== 'flee' && Math.random() < 0.6) this.cry('scream', 1.5);
      else if (zombie && this.brain.target && Math.random() < dt * 0.3) this.cry('growl', 2.5);
      this.wasState = state;
      this.move(dt);
      if (this.mode !== 'anim') return; // went over a ledge
      this.computePose(dt);
      this.applyPose();
      if (this.limp.size) this.muscles(dt, true);
      this.checkKnocks();
    } else if (this.mode === 'getup') {
      // onto hands and knees first, then up
      this.getupT += dt;
      const k = Math.min(1, this.getupT / 1.5);
      this.squat = 1 - smooth(0.45, 1, k);
      this.computePose(dt);
      this.applyPose(smooth(0, 0.6, k));
      if (this.limp.size) this.muscles(dt, true);
      this.checkKnocks();
      if (k >= 1 && this.mode === 'getup') { this.mode = 'anim'; this.squat = 0; }
    } else {
      this.muscles(dt);
      this.trail();
      this.hitAccum = Math.max(0, this.hitAccum - dt * 320);
      if (this.stun > 0) this.stun -= dt;
      else if (!this.dead && !this.crippled && (this.health > 20 || this.kind === 'zombie')) this.tryGetUp();
    }
  }

  /** Called right before the physics step, once everything has had its say about velocities. */
  preStep() {
    if (this.removed) return;
    for (const n in this.parts) {
      const p = this.parts[n];
      p.vy0 = p.gone || !p.body.isDynamic() || p.body.isSleeping() ? 0 : p.body.linvel().y;
    }
  }

  sync() {
    if (this.removed) return; // bodies are gone; reading them would panic the wasm world
    for (const n in this.parts) {
      const p = this.parts[n];
      if (p.gone) continue;
      if (p.vy0 < -1.5) {
        // Flesh does not bounce. A part that was coming down and left the step going up was thrown
        // back by the solver (a heavy torso landing on a light head does it); take that energy out.
        const v = p.body.linvel();
        const most = 0.25 - p.vy0 * 0.06;
        if (v.y > most) p.body.setLinvel({ x: v.x, y: most, z: v.z }, true);
      }
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    if (this.mode === 'ragdoll') this.impacts();
  }

  destroy() {
    if (this.removed) return;
    this.removed = true;
    for (const n in this.parts) {
      const p = this.parts[n];
      for (const c of p.colliders) this.ctx.owners.delete(c.handle);
      if (!p.gone) {
        this.ctx.world.removeRigidBody(p.body);
        this.ctx.scene.remove(p.mesh);
        for (const m of p.skinned) this.ctx.scene.remove(m);
      }
      if (p.skeleton) p.skeleton.dispose();
    }
    if (this.whole) for (const m of this.whole) this.ctx.scene.remove(m);
    if (this.skeleton) this.skeleton.dispose();
  }
}

export const RAGDOLL_PARTS = PARTS;
