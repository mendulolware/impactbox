import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { getModel } from './models.js';
import { openWound } from './wounds.js';
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

const UP = new THREE.Vector3(0, 1, 0);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;

// Body layout (feet at y = 0, character faces -Z). pos = part centre.
const PARTS = {
  pelvis: { shape: 'box', half: [0.17, 0.09, 0.10], pos: [0, 1.00, 0], hp: 70, role: 'pants' },
  torso:  { shape: 'box', half: [0.18, 0.22, 0.10], pos: [0, 1.33, 0], hp: 90, role: 'shirt' },
  head:   { shape: 'ball', r: 0.12,                  pos: [0, 1.70, 0], hp: 32, role: 'skin' },
  uarmL:  { shape: 'cap', h: 0.12, r: 0.050, pos: [0.25, 1.33, 0], hp: 36, role: 'shirt' },
  farmL:  { shape: 'cap', h: 0.11, r: 0.045, pos: [0.25, 1.005, 0], hp: 30, role: 'skin' },
  uarmR:  { shape: 'cap', h: 0.12, r: 0.050, pos: [-0.25, 1.33, 0], hp: 36, role: 'shirt' },
  farmR:  { shape: 'cap', h: 0.11, r: 0.045, pos: [-0.25, 1.005, 0], hp: 30, role: 'skin' },
  thighL: { shape: 'cap', h: 0.17, r: 0.075, pos: [0.10, 0.705, 0], hp: 46, role: 'pants' },
  shinL:  { shape: 'cap', h: 0.17, r: 0.060, pos: [0.10, 0.23, 0], hp: 38, role: 'pants' },
  thighR: { shape: 'cap', h: 0.17, r: 0.075, pos: [-0.10, 0.705, 0], hp: 46, role: 'pants' },
  shinR:  { shape: 'cap', h: 0.17, r: 0.060, pos: [-0.10, 0.23, 0], hp: 38, role: 'pants' },
};

// a = parent, b = child; anchor in character space. Listed parent-first (the animation relies on it).
// stump = radius of the wound left behind, cone = soft swing limit (radians) while ragdolled.
const JOINTS = [
  { name: 'spine',     a: 'pelvis', b: 'torso',  anchor: [0, 1.10, 0], stump: 0.13, cone: 0.55 },
  { name: 'neck',      a: 'torso',  b: 'head',   anchor: [0, 1.56, 0], stump: 0.05, cone: 0.7 },
  { name: 'shoulderL', a: 'torso',  b: 'uarmL',  anchor: [0.25, 1.50, 0], stump: 0.05, cone: 2.3 },
  { name: 'elbowL',    a: 'uarmL',  b: 'farmL',  anchor: [0.25, 1.16, 0], stump: 0.043, axis: [1, 0, 0], limits: [0, 2.4] },
  { name: 'shoulderR', a: 'torso',  b: 'uarmR',  anchor: [-0.25, 1.50, 0], stump: 0.05, cone: 2.3 },
  { name: 'elbowR',    a: 'uarmR',  b: 'farmR',  anchor: [-0.25, 1.16, 0], stump: 0.043, axis: [1, 0, 0], limits: [0, 2.4] },
  { name: 'hipL',      a: 'pelvis', b: 'thighL', anchor: [0.10, 0.95, 0], stump: 0.072, cone: 1.5 },
  { name: 'kneeL',     a: 'thighL', b: 'shinL',  anchor: [0.10, 0.46, 0], stump: 0.058, axis: [1, 0, 0], limits: [-2.4, 0] },
  { name: 'hipR',      a: 'pelvis', b: 'thighR', anchor: [-0.10, 0.95, 0], stump: 0.072, cone: 1.5 },
  { name: 'kneeR',     a: 'thighR', b: 'shinR',  anchor: [-0.10, 0.46, 0], stump: 0.058, axis: [1, 0, 0], limits: [-2.4, 0] },
];

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
const FLINCH = 0.45, PUNCH = 0.35, LUNGE = 0.5;

const PARENT = {};
const JOINT_OF = {};
for (const j of JOINTS) { PARENT[j.b] = j.a; JOINT_OF[j.b] = j; }

const LEGS = new Set(['thighL', 'thighR', 'shinL', 'shinR']);
const LIMBS = new Set(['uarmL', 'farmL', 'uarmR', 'farmR', 'thighL', 'shinL', 'thighR', 'shinR']);
const KNOCK_PARTS = ['torso', 'head', 'pelvis', 'thighL', 'thighR'];

const SKIN = [0xf1c8a0, 0xe0ac86, 0xc68a62, 0x9a6444, 0x6b4430];
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
const fleshMat = new THREE.MeshStandardMaterial({ color: 0x7a0a0a, roughness: 0.25 });
const fatMat = new THREE.MeshStandardMaterial({ color: 0xa8423a, roughness: 0.4 });
const boneMat = new THREE.MeshStandardMaterial({ color: 0xded7c2, roughness: 0.55 });
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

/** Cross-section left where a limb was removed: flesh, a ring of fat, and a bone end. */
function makeStump(radius) {
  const g = new THREE.Group(); // +Y points out of the wound
  const flesh = new THREE.Mesh(geo('stumpF', () => new THREE.CylinderGeometry(1, 0.92, 0.5, 12)), fleshMat);
  flesh.scale.set(radius, 0.05, radius);
  const fat = new THREE.Mesh(geo('stumpR', () => new THREE.TorusGeometry(0.9, 0.16, 5, 12)), fatMat);
  fat.rotation.x = Math.PI / 2;
  fat.scale.setScalar(radius);
  fat.position.y = 0.012;
  const bone = new THREE.Mesh(geo('stumpB', () => new THREE.CylinderGeometry(0.8, 1, 1, 7)), boneMat);
  bone.scale.set(radius * 0.32, 0.07 + radius * 0.4, radius * 0.32);
  bone.position.y = 0.03;
  g.add(flesh, fat, bone);
  for (let i = 0; i < 3; i++) { // ragged bits
    const bit = new THREE.Mesh(geo('stumpBit', () => new THREE.IcosahedronGeometry(1, 0)), fleshMat);
    const a = Math.random() * 6.28;
    bit.position.set(Math.cos(a) * radius * 0.6, 0.02, Math.sin(a) * radius * 0.6);
    bit.scale.set(radius * 0.3, radius * rnd(0.3, 0.7), radius * 0.3);
    g.add(bit);
  }
  return g;
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
    this.bleedRate = 0;
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
    this.gw = { handsUp: 0, cower: 0, fight: 0 };   // eased gesture weights
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
    const tint = { Skin: mat(colors.skin), Shirt: mat(colors.shirt), Pants: mat(colors.pants) };

    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, yaw);

    for (const [name, d] of Object.entries(PARTS)) {
      const off = new THREE.Vector3(...d.pos).applyQuaternion(qYaw);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x + off.x, pos.y + off.y, pos.z + off.z)
          .setRotation({ x: qYaw.x, y: qYaw.y, z: qYaw.z, w: qYaw.w })
          .setLinearDamping(0.05)
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
      // the contact hook (main.js) turns off collisions between parts of the same NPC
      cd.setDensity(900).setFriction(0.9).setRestitution(0.02).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const collider = world.createCollider(cd, body);

      // Blender model if available, otherwise the collider shape itself
      let mesh = getModel(MODEL_OF[name], tint);
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
      // the meshes bullets can punch holes in; "body" ones (skin, shirt, trousers) have flesh behind them
      const bodyMats = new Set(Object.values(tint));
      const skin = [];
      mesh.traverse((o) => { if (o.isMesh) skin.push({ mesh: o, body: bodyMats.has(o.material) || o === mesh, isSkin: o.material === tint.Skin }); });
      // local box around the part, used to work out where a bullet comes out the other side
      const ext = d.shape === 'box' ? d.half : d.shape === 'ball' ? [d.r, d.r, d.r] : [d.r, d.h + d.r, d.r];
      this.parts[name] = { name, def: d, body, collider, mesh, skin, ext, hp: d.hp, gone: false, inertia: body.mass() * len * len / 12 };
      this.pose[name] = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
      this.captured[name] = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
      this.colHandles.add(collider.handle);
      ctx.owners.set(collider.handle, { kind: 'part', ragdoll: this, name });
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

  /** Where this NPC is, standing or sprawled. */
  center(out) {
    if (this.mode === 'ragdoll' && !this.parts.pelvis.gone) {
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
      const wantKin = kin && !this.isFree(n);
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
  }

  /** Drop into physics for at least `seconds`. Safe to call repeatedly. */
  goLimp(seconds = 1.5) {
    this.stun = Math.max(this.stun, seconds);
    if (this.mode !== 'ragdoll') {
      this.setMode('ragdoll');
      this.speed = 0;
      this.fallT = 0;     // muscles tense: brace for the fall
      this.tone = 0.9;
    }
  }

  // ------------------------------------------------------------ damage
  damage(n) {
    if (this.dead) return;
    this.health -= n;
    if (this.health <= 0) this.die();
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.goLimp(1e9);
    this.twitch = cause === 'headshot' ? 1.3 : 0.6;   // nerves fire for a moment after death
    this.ctx.onKill(this, cause);
    this.ctx.alert('death', this.center(_c), 16);
  }

  /** Apply a hit to a single part. opts: { blade, explosion, normal } */
  hit(name, dmg, point, dir, impulse = 0, opts = {}) {
    const p = this.parts[name];
    if (!p || p.gone) return;
    const { gore, sfx } = this.ctx;

    // Light hits stagger a standing NPC; legs, heads, blades, blasts, repeated hits and low
    // health put them on the ground. Zombies shrug off far more.
    const zombie = this.kind === 'zombie';
    this.hitAccum += impulse;
    const standing = this.mode !== 'ragdoll';
    const heavy = opts.blade || opts.explosion || name === 'head' || LEGS.has(name)
      || this.hitAccum > (zombie ? 480 : 250) || (!zombie && this.health - dmg < 40);
    if (standing && !heavy && !this.dead) {
      this.flinchT = FLINCH;
      this.flinchDir.set(dir.x, 0, dir.z).normalize();
      const pt = p.body.translation();
      // which side was hit, relative to where the NPC faces: the torso twists away from it
      this.flinchSide = ((point.x - pt.x) * Math.cos(this.heading) - (point.z - pt.z) * Math.sin(this.heading)) > 0 ? 1 : -1;
    } else {
      this.goLimp(0.9 + Math.min(2.6, impulse / 110 + dmg / 60));
    }
    this.brain.notice('hurt', opts.from || this.ctx.player.pos);

    if (impulse > 0 && this.mode === 'ragdoll') {
      _v.copy(dir).multiplyScalar(impulse);
      p.body.applyImpulseAtPoint({ x: _v.x, y: _v.y, z: _v.z }, point, true);
    }

    if (dmg > 0 && !opts.explosion) {
      // a wound on the body itself
      const t = p.body.translation(), r = p.body.rotation();
      _q.set(r.x, r.y, r.z, r.w).invert();
      const lp = new THREE.Vector3(point.x - t.x, point.y - t.y, point.z - t.z).applyQuaternion(_q);
      const ln = opts.normal ? new THREE.Vector3(opts.normal.x, opts.normal.y, opts.normal.z) : _a.copy(dir).negate().clone();
      ln.applyQuaternion(_q);
      const ld = new THREE.Vector3(dir.x, dir.y, dir.z).applyQuaternion(_q).normalize();
      const big = name === 'torso' || name === 'pelvis';
      const maxR = big ? 0.11 : name === 'head' ? 0.07 : p.def.r * 0.95;
      if (opts.blade) {
        gore.wound(p.mesh, lp, ln, { size: 0.07, slash: true });   // a slash mark, with a gash cut into it
        openWound(p, lp, 0.03, maxR);
      } else if (opts.bite) {
        openWound(p, lp, 0.024, maxR);                             // a chunk torn out, no exit wound
      } else {
        // entry hole, and a bigger one where the bullet leaves
        openWound(p, lp, opts.hole || 0.026, maxR);
        let t = 0.6;
        for (let i = 0; i < 3; i++) {
          const c = ld.getComponent(i);
          if (Math.abs(c) > 1e-4) t = Math.min(t, (Math.sign(c) * p.ext[i] - lp.getComponent(i)) / c);
        }
        if (t > 0.03) openWound(p, lp.clone().addScaledVector(ld, t), (opts.hole || 0.026) * 1.5, maxR);
      }

      if (opts.blade) {
        _t.copy(dir).multiplyScalar(0.5); _t.y += 0.5;
        gore.blood(point, _t, 26, 5, 1.0);
        gore.wallSplatter(point, dir, 2.5);
      } else {
        gore.blood(point, dir, 14, 7, 0.35);              // exit spray carries on past the body
        _t.copy(dir).multiplyScalar(-0.4); _t.y += 0.3;
        gore.blood(point, _t, 5, 2.5, 0.8);                // a little comes back out the front
        gore.wallSplatter(point, dir, 4.5);
      }
      sfx.squish();
    }

    // zombies only really go down to head trauma
    const mult = name === 'head' ? 2.2 : (LIMBS.has(name) ? 0.55 : 1) * (zombie ? 0.3 : 1);
    p.hp -= dmg;

    // resolve what happens to the part first so the kill gets the right label
    if (p.hp <= 0) {
      if (opts.explosion && p.hp < -40 && name !== 'pelvis') {
        this.gib(name);
      } else if (opts.explosion && name !== 'torso' && name !== 'pelvis' && Math.random() < 0.45) {
        // blasts don't take every limb off: this one is mangled but still attached
      } else if (name === 'head') {
        if (opts.blade || opts.explosion) this.sever('head', dir);
        else if (p.hp < -26) this.gib('head');   // overkill: the head pops
        else this.die('headshot');
      } else if (LIMBS.has(name)) {
        this.sever(name, dir);
      } else if (name === 'torso') {
        if (opts.blade || opts.explosion) this.sever('torso', dir);
        if (!zombie || this.severed.has('torso')) this.die('torso');
      } else if (name === 'pelvis') {
        if (!zombie) this.die('pelvis');
      }
    }
    this.damage(dmg * mult);
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
    this.bleedRate = 0;
    this.stun = 0.6;
    this.twitch = 1;
    const green = mat(0x8fbf6a);
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
    if (this.severed.has(name)) return;
    const jd = this.joints[JOINT_OF[name].name];
    if (!jd) return;
    this.goLimp(3);
    // removing a joint twice (e.g. its body was gibbed) would panic the wasm world, so check first
    if (this.ctx.world.getImpulseJoint(jd.joint.handle)) this.ctx.world.removeImpulseJoint(jd.joint, true);
    this.severed.add(name);

    const { gore, sfx } = this.ctx;
    const parent = this.parts[jd.def.a];
    const child = this.parts[name];
    const wp = this.localToWorld(parent, jd.a1);
    gore.gush(wp, dir || UP, 42, 6);
    gore.chunks(wp, 2, 3);
    sfx.chop();

    // wound direction in each part's local frame: shoulders face sideways, everything else along the limb
    const side = jd.def.name.startsWith('shoulder');
    const outA = side ? new THREE.Vector3(Math.sign(jd.a1.x), 0, 0) : new THREE.Vector3(0, Math.sign(jd.a1.y) || 1, 0);
    const outB = new THREE.Vector3(0, Math.sign(jd.a2.y) || 1, 0);
    if (!parent.gone) {
      this.addStump(parent, jd.a1, outA, jd.def.stump);
      this.bleeders.push({ part: parent, local: jd.a1, out: outA, t: 10, rate: 70, pooled: false });
    }
    this.addStump(child, jd.a2, outB, jd.def.stump);
    this.bleeders.push({ part: child, local: jd.a2, out: outB, t: 6, rate: 40, pooled: false });
    this.bleedRate += 3;

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
    this.goLimp(3);
    if (name !== 'torso') this.sever(name, null);
    const t = p.body.translation(), v = p.body.linvel();
    const at = { x: t.x, y: t.y, z: t.z };
    this.ctx.gore.gibs(at, 55);
    this.ctx.gore.chunks(at, name === 'torso' ? 9 : 6, 6, v);
    this.ctx.sfx.squish();
    this.ctx.owners.delete(p.collider.handle);
    this.colHandles.delete(p.collider.handle);
    this.ctx.world.removeRigidBody(p.body); // also drops every joint attached to it
    this.ctx.scene.remove(p.mesh);
    p.gone = true;
    // everything that hung off this part is now loose
    for (const n in PARTS) for (let a = PARENT[n]; a; a = PARENT[a]) if (a === name) this.severed.add(n);
    this.severed.add(name);
    if (LEGS.has(name)) this.crippled = true;
    if (name === 'head' || name === 'torso') this.die('gib');
  }

  addStump(part, local, out, radius) {
    const s = makeStump(radius);
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

    // gestures ease in and out; one-shot moves follow a half-sine
    const G = this.gw;
    for (const k in G) G[k] += ((this.gesture === k ? 1 : 0) - G[k]) * Math.min(1, dt * 7);
    const up = G.handsUp, cw = G.cower, ft = G.fight;
    const fl = this.flinchT > 0 ? Math.sin(Math.PI * (1 - this.flinchT / FLINCH)) : 0;
    const pn = this.punchT > 0 ? Math.sin(Math.PI * (1 - this.punchT / PUNCH)) : 0;
    const lg = this.lungeT > 0 ? Math.sin(Math.PI * (1 - this.lungeT / LUNGE)) : 0;

    // ---- legs. +x swings a limb forward; knees only bend backward (negative)
    const stride = mix(z ? 0.38 : 0.55, 0.95, run);
    const lift = mix(0.95, 1.55, run);
    let hipL = stride * s * w, hipR = -stride * s * w;
    let kneeL = -(0.06 + lift * Math.max(0, c)) * w - 0.03;
    let kneeR = -(0.06 + lift * Math.max(0, -c)) * w - 0.03;
    hipL = mix(hipL, 1.9, cw); hipR = mix(hipR, 1.9, cw);                 // squat right down
    kneeL = mix(kneeL, -2.3, cw); kneeR = mix(kneeR, -2.3, cw);
    hipL += 0.12 * ft; kneeL -= 0.25 * ft + 0.3 * fl;                    // fighting crouch / buckling
    hipR += 0.12 * ft; kneeR -= 0.25 * ft + 0.3 * fl;

    // ---- upper body
    let spX, spY, spZ = 0, nkX, nkY, nkZ = 0, shLx, shRx, shLz = 0.07, shRz = -0.07, elL, elR;
    if (z) {
      spX = -0.22 + 0.03 * breathe; spY = 0.1 * s * w; spZ = 0.08 * Math.sin(t * 0.9 + this.seed);
      nkX = 0.2; nkY = 0.25 * Math.sin(t * 0.5 + this.seed); nkZ = 0.25;
      shLx = 1.35 + 0.08 * Math.sin(t * 2.1 + this.seed); shRx = 1.25 + 0.08 * Math.sin(t * 1.7 + this.seed);
      shLz = 0.1; shRz = -0.1;
      elL = 0.15; elR = 0.3;
    } else {
      const arm = mix(0.5, 0.95, run);
      spX = -0.05 * w - 0.26 * run + 0.012 * breathe; spY = -0.12 * s * w;
      nkX = 0.04 * w + 0.16 * run; nkY = 0.3 * Math.sin(t * 0.45 + this.seed) * (1 - w);
      shLx = -arm * s * w + 0.03 * breathe; shRx = arm * s * w - 0.03 * breathe;
      elL = 0.18 + 0.3 * w + 0.25 * Math.max(0, -s) * w + 1.1 * run;
      elR = 0.18 + 0.3 * w + 0.25 * Math.max(0, s) * w + 1.1 * run;
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
    // fight: guard up, right arm fires out on a punch
    shLx = mix(shLx, 1.0, ft); elL = mix(elL, 1.9, ft);
    shRx = mix(shRx, mix(0.95, 1.55, pn), ft); elR = mix(elR, mix(1.9, 0.12, pn), ft);
    spY += (0.2 - 0.6 * pn) * ft;
    // zombie lunge, and recoiling from a hit
    spX += -0.4 * lg + 0.32 * fl;
    shLx += 0.3 * lg; shRx += 0.3 * lg;
    spY += this.flinchSide * 0.45 * fl;
    nkX += 0.25 * fl;

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
    L('hipL', hipL, 0, 0.02 + 0.05 * ft);
    L('hipR', hipR, 0, -0.02 - 0.05 * ft);
    L('kneeL', kneeL);
    L('kneeR', kneeR);
    L('spine', spX, spY, spZ);
    L('neck', nkX, nkY, nkZ);
    L('shoulderL', shLx, 0, shLz);
    L('shoulderR', shRx, 0, shRz);
    L('elbowL', elL);
    L('elbowR', elR);

    // forward kinematics from the pelvis, placed at the origin first
    const pel = this.pose.pelvis;
    pel.q.setFromEuler(_e.set(0, this.heading + 0.1 * s * w, 0.035 * c * w + (z ? 0.05 * s : 0), 'YXZ'));
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

    const want = this.flinchT > 0 ? 0 : this.wantSpeed;       // a hit stops you in your tracks
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
   * twist) stop arms and legs folding through the body.
   */
  muscles(dt) {
    this.fallT += dt;
    const brace = !this.dead && this.fallT < 0.55;
    const hurt = !this.dead && !brace && (this.crippled || this.health <= 20 || this.bleedRate > 0);
    // the dead keep a trace of tone for a few seconds, then only joint friction is left
    const want = this.dead ? (this.deadT > 3 ? 0 : 0.05) : brace ? 0.9 : hurt ? 0.42 : 0.3;
    this.tone += (want - this.tone) * Math.min(1, dt * (this.dead ? 1.5 : 6));
    const tone = this.tone;
    const kp = tone * 81, kd = tone * 14 + 2.2;
    const wake = hurt || brace;     // the living keep moving; the dead are allowed to settle and sleep
    // a corpse that has come to rest is left alone: limit forces on a limb pinned against the
    // floor would otherwise keep nudging it forever
    const settled = this.dead && this.deadT > 4;

    for (const j of JOINTS) {
      if (this.severed.has(j.b)) continue;
      const A = this.parts[j.a], B = this.parts[j.b];
      if (A.gone || B.gone) continue;
      if (!wake && B.body.isSleeping()) continue;
      const ra = A.body.rotation(), rb = B.body.rotation();
      _q.set(ra.x, ra.y, ra.z, ra.w);
      _q2.set(rb.x, rb.y, rb.z, rb.w);
      _a.set(0, 1, 0).applyQuaternion(_q);    // parent's long axis
      _b.set(0, 1, 0).applyQuaternion(_q2);   // child's long axis
      // inertia is stored about the part's centre; a limb swings about its end, which is ~4x more.
      // Without that factor the muscles are too weak to lift a limb against gravity.
      const I = Math.min(A.inertia, B.inertia) * 4;
      const wa = A.body.angvel(), wb = B.body.angvel();
      const wx = wb.x - wa.x, wy = wb.y - wa.y, wz = wb.z - wa.z;

      // --- pose: rotation that would take the child to its target, as an axis * angle
      let x = brace ? BRACE[j.name] : REST[j.name];
      if (hurt && j.name !== 'spine' && j.name !== 'neck') {
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

      // --- swing limit: child may only bend so far from the parent
      if (j.cone && !(settled && Math.hypot(wx, wy, wz) < 1.5)) {
        const sw = Math.acos(clamp(_a.dot(_b), -1, 1));
        if (sw > j.cone) {
          _v.crossVectors(_b, _a);
          const l = _v.length();
          if (l > 1e-4) {
            const k = 121 * (sw - j.cone) / l;
            tx += _v.x * k; ty += _v.y * k; tz += _v.z * k;
          }
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
    if (this.twitch > 0) {
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
    this.gw.handsUp = this.gw.cower = this.gw.fight = 0;
    for (const n in this.parts) {
      const p = this.parts[n];
      if (p.gone) continue;
      const pt = p.body.translation(), pr = p.body.rotation();
      this.captured[n].p.set(pt.x, pt.y, pt.z);
      this.captured[n].q.set(pr.x, pr.y, pr.z, pr.w);
    }
    this.getupT = 0;
    this.setMode('getup');
  }

  // ------------------------------------------------------------ per-frame
  /** Called before the physics step. */
  update(dt) {
    if (this.removed || dt <= 0) return;
    this.t += dt;
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
    if (this.bleedRate > 0 && !this.dead) this.damage(this.bleedRate * dt);

    if (this.dead) {
      this.deadT += dt;
      // bitten and still in one piece: it gets back up
      if (this.infected && this.deadT > 6 && !this.crippled && !this.parts.head.gone && !this.parts.torso.gone
        && !this.severed.has('head') && !this.severed.has('torso')) {
        this.reanimate();
      }
      // blood slowly pools under a body once it has come to rest
      if (!this.pooled && this.deadT > 1.2) {
        const tor = this.parts.torso.gone ? this.parts.pelvis : this.parts.torso;
        const v = tor.body.linvel();
        if (Math.hypot(v.x, v.y, v.z) < 0.25) {
          this.pooled = true;
          const t = tor.body.translation();
          const hit = gore.castFixed(t.x, t.y + 0.1, t.z, 0, -1, 0, 0.8);
          if (hit) gore.pool({ x: t.x, y: t.y + 0.1 - hit.timeOfImpact, z: t.z }, hit.normal, rnd(0.8, 1.25));
        }
      }
    }

    if (this.mode === 'anim') {
      this.brain.update(dt);
      this.move(dt);
      if (this.mode !== 'anim') return; // went over a ledge
      this.computePose(dt);
      this.applyPose();
      this.checkKnocks();
    } else if (this.mode === 'getup') {
      this.getupT += dt;
      const k = Math.min(1, this.getupT / 1.1);
      this.computePose(dt);
      this.applyPose(k * k * (3 - 2 * k));
      this.checkKnocks();
      if (k >= 1 && this.mode === 'getup') this.mode = 'anim';
    } else {
      this.muscles(dt);
      this.hitAccum = Math.max(0, this.hitAccum - dt * 320);
      if (this.stun > 0) this.stun -= dt;
      else if (!this.dead && !this.crippled && (this.health > 20 || this.kind === 'zombie')) this.tryGetUp();
    }
  }

  sync() {
    if (this.removed) return; // bodies are gone; reading them would panic the wasm world
    for (const n in this.parts) {
      const p = this.parts[n];
      if (p.gone) continue;
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  destroy() {
    if (this.removed) return;
    this.removed = true;
    for (const n in this.parts) {
      const p = this.parts[n];
      this.ctx.owners.delete(p.collider.handle);
      if (!p.gone) {
        this.ctx.world.removeRigidBody(p.body);
        this.ctx.scene.remove(p.mesh);
      }
    }
  }
}

export const RAGDOLL_PARTS = PARTS;
