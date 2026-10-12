import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { getModel } from './models.js';
import { openWound } from './wounds.js';

// An NPC has two lives:
//   'anim'    - bodies are kinematic and follow a procedural walk/idle animation (no physics jitter)
//   'ragdoll' - bodies are dynamic and hang off joints (after any hit, fall, explosion, or death)
//   'getup'   - kinematic blend from wherever the ragdoll ended up back into the animation
// Parts that have been cut off are always dynamic.

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
    this.zombie = !!opts.zombie;

    // animation / AI state
    this.mode = 'ragdoll';
    this.stun = 0;
    this.t = Math.random() * 10;
    this.seed = Math.random() * 10;
    this.root = new THREE.Vector3(pos.x, pos.y, pos.z); // feet position
    this.heading = yaw;
    this.targetHeading = yaw;
    this.speed = 0;
    this.phase = Math.random() * 6;
    this.state = 'idle';
    this.stateT = rnd(1, 4);
    this.probeT = 0;
    this.getupT = 0;
    this.pose = {};
    this.captured = {};

    const skin = this.zombie ? 0x8fbf6a : SKIN[Math.floor(Math.random() * SKIN.length)];
    const colors = {
      skin,
      shirt: SHIRT[Math.floor(Math.random() * SHIRT.length)],
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
          .setLinearDamping(0.2)
          .setAngularDamping(2.0)
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
      mesh.traverse((o) => { if (o.isMesh) skin.push({ mesh: o, body: bodyMats.has(o.material) || o === mesh }); });
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

    if (opts.limp) {
      this.stun = opts.limp; // start as a falling ragdoll
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
    if (this.mode !== 'ragdoll') { this.setMode('ragdoll'); this.speed = 0; }
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
    this.ctx.onKill(this, cause);
  }

  /** Apply a hit to a single part. opts: { blade, explosion, normal } */
  hit(name, dmg, point, dir, impulse = 0, opts = {}) {
    const p = this.parts[name];
    if (!p || p.gone) return;
    const { gore, sfx } = this.ctx;

    this.goLimp(0.9 + Math.min(2.6, impulse / 110 + dmg / 60));

    if (impulse > 0) {
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

    const mult = name === 'head' ? 2.2 : LIMBS.has(name) ? 0.55 : 1;
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
        this.die('torso');
      } else if (name === 'pelvis') {
        this.die('pelvis');
      }
    }
    this.damage(dmg * mult);
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
  computePose() {
    const z = this.zombie;
    const stride = z ? 0.38 : 0.55;
    const w = clamp(this.speed / (z ? 0.7 : 1.3), 0, 1); // 0 = standing, 1 = full walk
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const t = this.t;
    const L = (name, x, y = 0, zr = 0) => this.joints[name].local.setFromEuler(_e.set(x, y, zr, 'YXZ'));

    // +x rotation swings a limb forward; knees only bend backward (negative)
    L('hipL', stride * s * w, 0, 0.02);
    L('hipR', -stride * s * w, 0, -0.02);
    L('kneeL', -(0.06 + 0.95 * Math.max(0, c)) * w - 0.03);
    L('kneeR', -(0.06 + 0.95 * Math.max(0, -c)) * w - 0.03);
    const breathe = Math.sin(t * 1.6 + this.seed);
    if (z) {
      L('spine', -0.22 + 0.03 * breathe, 0.1 * s * w, 0.08 * Math.sin(t * 0.9 + this.seed));
      L('neck', 0.2, 0.25 * Math.sin(t * 0.5 + this.seed), 0.25);
      L('shoulderL', 1.35 + 0.08 * Math.sin(t * 2.1 + this.seed), 0, 0.1);
      L('shoulderR', 1.25 + 0.08 * Math.sin(t * 1.7 + this.seed), 0, -0.1);
      L('elbowL', 0.15);
      L('elbowR', 0.3);
    } else {
      L('spine', -0.05 * w + 0.012 * breathe, -0.12 * s * w, 0);
      L('neck', 0.04 * w, 0.3 * Math.sin(t * 0.45 + this.seed) * (1 - w), 0);
      L('shoulderL', -0.5 * s * w + 0.03 * breathe, 0, 0.07);
      L('shoulderR', 0.5 * s * w - 0.03 * breathe, 0, -0.07);
      L('elbowL', 0.18 + 0.3 * w + 0.25 * Math.max(0, -s) * w);
      L('elbowR', 0.18 + 0.3 * w + 0.25 * Math.max(0, s) * w);
    }

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
    // drop the body so the lower foot rests on the ground
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

  /** Wander around: walk, stop, turn at obstacles, fall off ledges. */
  think(dt) {
    this.stateT -= dt;
    if (this.stateT <= 0) {
      if (this.state === 'idle') {
        this.state = 'walk';
        this.stateT = rnd(3, 7);
        this.targetHeading = this.heading + rnd(-2.2, 2.2);
      } else {
        this.state = 'idle';
        this.stateT = rnd(1.5, 4);
      }
    }
    const want = this.state === 'walk' ? (this.zombie ? 0.7 : 1.3) : 0;
    this.speed += (want - this.speed) * Math.min(1, dt * 4);

    if (Math.abs(this.root.x) > 37 || Math.abs(this.root.z) > 37) {
      this.targetHeading = Math.atan2(this.root.x, this.root.z); // forward is (-sin, -cos): face the origin
    }
    let dh = this.targetHeading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += clamp(dh, -2.6 * dt, 2.6 * dt);
    _fwd.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));

    if (this.speed > 0.05) {
      // something in the way? (walls, props, other NPCs, the player)
      this.probeT -= dt;
      if (this.probeT <= 0) {
        this.probeT = 0.12;
        const own = this.colHandles;
        const ray = new RAPIER.Ray({ x: this.root.x, y: this.root.y + 0.75, z: this.root.z }, { x: _fwd.x, y: 0, z: _fwd.z });
        const hit = this.ctx.world.castRay(ray, 0.95, true, undefined, undefined, undefined, undefined, (c) => !own.has(c.handle));
        if (hit) this.targetHeading = this.heading + rnd(1.2, 2.6) * (Math.random() < 0.5 ? -1 : 1);
      }

      const nx = this.root.x + _fwd.x * this.speed * dt, nz = this.root.z + _fwd.z * this.speed * dt;
      const gy = this.groundBelow(nx, this.root.y + 0.8, nz, 2.2);
      if (gy === null || gy < this.root.y - 0.7) {
        // stepped off a ledge: let physics take over
        this.root.x = nx; this.root.z = nz;
        this.goLimp(1.6);
        return;
      }
      if (gy > this.root.y + 0.45) {
        this.targetHeading = this.heading + rnd(1.5, 3); // too tall to step on
      } else {
        this.root.x = nx; this.root.z = nz;
        this.root.y += (gy - this.root.y) * Math.min(1, dt * 12);
        this.phase += this.speed * dt * (Math.PI * 2) / (this.zombie ? 1.3 : 1.9);
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

  /** Stops ragdoll limbs folding through the body, without the jitter of hard self-collision. */
  softLimits(dt) {
    for (const j of JOINTS) {
      if (!j.cone || this.severed.has(j.b)) continue;
      const A = this.parts[j.a], B = this.parts[j.b];
      if (A.gone || B.gone || B.body.isSleeping()) continue;
      const ra = A.body.rotation(), rb = B.body.rotation();
      _a.set(0, 1, 0).applyQuaternion(_q.set(ra.x, ra.y, ra.z, ra.w));
      _b.set(0, 1, 0).applyQuaternion(_q2.set(rb.x, rb.y, rb.z, rb.w));
      const ang = Math.acos(clamp(_a.dot(_b), -1, 1));
      if (ang <= j.cone) continue;
      _v.crossVectors(_b, _a); // turning B about this axis brings it back toward A
      const l = _v.length();
      if (l < 1e-4) continue;
      _v.multiplyScalar(1 / l);
      const wa = A.body.angvel(), wb = B.body.angvel();
      const wrel = (wb.x - wa.x) * _v.x + (wb.y - wa.y) * _v.y + (wb.z - wa.z) * _v.z;
      // Sized by the lighter of the two bodies, or the reaction torque spins it up and the
      // corpse never settles. Never wakes a body: a limb resting past its limit can still sleep.
      const wn = 11;
      const I = Math.min(A.inertia, B.inertia);
      const tau = clamp(I * (wn * wn * (ang - j.cone) - 2 * wn * wrel), -I * 300, I * 300) * dt;
      B.body.applyTorqueImpulse({ x: _v.x * tau, y: _v.y * tau, z: _v.z * tau }, false);
      A.body.applyTorqueImpulse({ x: -_v.x * tau, y: -_v.y * tau, z: -_v.z * tau }, false);
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
    this.state = 'idle';
    this.stateT = rnd(1, 2.5);
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
      this.think(dt);
      if (this.mode !== 'anim') return; // walked off a ledge
      this.computePose();
      this.applyPose();
      this.checkKnocks();
    } else if (this.mode === 'getup') {
      this.getupT += dt;
      const k = Math.min(1, this.getupT / 1.1);
      this.computePose();
      this.applyPose(k * k * (3 - 2 * k));
      this.checkKnocks();
      if (k >= 1 && this.mode === 'getup') this.mode = 'anim';
    } else {
      this.softLimits(dt);
      if (this.stun > 0) this.stun -= dt;
      else if (!this.dead && !this.crippled && this.health > 20) this.tryGetUp();
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
