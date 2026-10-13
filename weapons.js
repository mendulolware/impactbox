import * as THREE from 'three';
import { sfx } from './audio.js';
import { getModel } from './models.js';

// Number keys pick a group; pressing the same key again steps through the group.
export const SLOTS = ['Sidearms', 'SMGs', 'Shotguns', 'Rifles', 'Heavy', 'Blades', 'Blunt', 'Gear'];

// type: gun (hitscan) | rocket | flame | melee (a swing) | saw | vrknife | grenade | grab
// Guns: pierce = how many bodies one round passes through, zoom = how far the view narrows when aimed,
//   mag/reload = shots before a pause, spin = seconds of wind-up, bolt = leaves a bolt where it hits,
//   quiet = nobody hears it.
// Melee is weak on purpose: a hit staggers, it takes several to bring someone down, and a limb only
// comes off once its health is gone. blunt = breaks instead of cuts.
export const WEAPONS = [
  { name: 'Pistol',   slot: 0, type: 'gun', auto: false, rate: 0.20,  dmg: 34,  impulse: 140, pellets: 1,  spread: 0.003, sound: 'pistol',   kick: 0.07,  hole: 0.034 },
  { name: 'Revolver', slot: 0, type: 'gun', auto: false, rate: 0.50,  dmg: 70,  impulse: 260, pellets: 1,  spread: 0.002, sound: 'revolver', kick: 0.17,  hole: 0.046 },
  { name: 'SMG',      slot: 1, type: 'gun', auto: true,  rate: 0.055, dmg: 11,  impulse: 60,  pellets: 1,  spread: 0.020, sound: 'smg',      kick: 0.022, hole: 0.022 },
  { name: 'Uzi',      slot: 1, type: 'gun', auto: true,  rate: 0.048, dmg: 9,   impulse: 50,  pellets: 1,  spread: 0.034, sound: 'smg',      kick: 0.026, hole: 0.022 },
  { name: 'Shotgun',  slot: 2, type: 'gun', auto: false, rate: 0.85,  dmg: 15,  impulse: 110, pellets: 10, spread: 0.055, sound: 'shotgun',  kick: 0.16,  hole: 0.027 },
  { name: 'Double Barrel', slot: 2, type: 'gun', auto: false, rate: 0.22, dmg: 16, impulse: 120, pellets: 12, spread: 0.075, sound: 'shotgun', kick: 0.2, hole: 0.028, mag: 2, reload: 1.5 },
  { name: 'Rifle',    slot: 3, type: 'gun', auto: true,  rate: 0.075, dmg: 17,  impulse: 95,  pellets: 1,  spread: 0.010, sound: 'rifle',    kick: 0.035, hole: 0.03 },
  { name: 'Sniper',   slot: 3, type: 'gun', auto: false, rate: 1.30,  dmg: 150, impulse: 420, pellets: 1,  spread: 0,     sound: 'sniper',   kick: 0.22,  hole: 0.05, pierce: 3, zoom: 0.82 },
  { name: 'Crossbow', slot: 3, type: 'gun', auto: false, rate: 1.25,  dmg: 85,  impulse: 180, pellets: 1,  spread: 0.001, sound: 'twang',    kick: 0.05,  hole: 0.02, bolt: true, quiet: true, zoom: 0.45 },
  { name: 'Rocket',   slot: 4, type: 'rocket', auto: false, rate: 1.40, sound: 'rocket', kick: 0.13 },
  { name: 'Minigun',  slot: 4, type: 'gun', auto: true,  rate: 0.028, dmg: 12,  impulse: 70,  pellets: 1,  spread: 0.030, sound: 'rifle',    kick: 0.018, hole: 0.026, spin: 0.7, hipOnly: true },
  { name: 'Flamethrower', slot: 4, type: 'flame', range: 7.5, dmg: 5, heat: 0.13 },
  { name: 'Knife',    slot: 5, type: 'vrknife' },
  { name: 'Machete',  slot: 5, type: 'melee', rate: 0.60, dmg: 14, impulse: 60,  range: 1.7 },
  { name: 'Katana',   slot: 5, type: 'melee', rate: 0.55, dmg: 18, impulse: 50,  range: 1.9 },
  { name: 'Axe',      slot: 5, type: 'melee', rate: 0.90, dmg: 22, impulse: 110, range: 1.6 },
  { name: 'Chainsaw', slot: 5, type: 'saw',   rate: 0.08, dmg: 3,  impulse: 20,  range: 1.6 },
  { name: 'Bat',      slot: 6, type: 'melee', rate: 0.60, dmg: 9,  impulse: 150, range: 1.7, blunt: true },
  { name: 'Crowbar',  slot: 6, type: 'melee', rate: 0.60, dmg: 11, impulse: 120, range: 1.5, blunt: true },
  { name: 'Sledgehammer', slot: 6, type: 'melee', rate: 1.20, dmg: 24, impulse: 320, range: 1.7, blunt: true },
  { name: 'Grenade',  slot: 7, type: 'grenade', auto: false, rate: 0.7 },
  { name: 'Grab Gun', slot: 7, type: 'grab' },
];

// How each weapon sits in first person, in the same order as WEAPONS. All positions are in the
// weapon model's own space (three.js axes: -Z is down the barrel), in metres before RIG_SCALE.
//   model  - name in assets/models.glb
//   hip    - where the rig sits when not aiming
//   sight  - height of the sight line above the model origin; aiming puts it on the screen centre
//   adsZ   - how far in front of the eye the weapon is held while aiming
//   muzzle - where tracers and the flash come from
//   handR / handL - [x, y, z, pitch] for the gripping / supporting hand
//   handS  - pistols: the other hand closed round the gripping one (two-handed hold)
// sight, muzzle and the hand positions come out of the model build (REF in models/guns.py, extras.py).
//   scope  - aiming swaps the weapon for a full-screen scope picture
//   melee  - held in the fist, business end up and forward; tilt = how far it leans forward
//   vr     - hand-driven: the mouse moves the hand itself (see updateKnife)
const RIG_SCALE = 0.8;
const HELMET_DROP = 0.1;   // how far the eyes are below the helmet camera (matches player.js)
const VIEW = [
  { model: 'Pistol',  hip: [0.19, -0.19, -0.50], sight: 0.053, adsZ: -0.42, muzzle: [0, 0.034, -0.106],
    handR: [0, -0.046, 0.0625, -0.226], handS: [0, -0.046, 0.0625, -0.226] },
  { model: 'Revolver', hip: [0.19, -0.19, -0.50], sight: 0.058, adsZ: -0.42, muzzle: [0, 0.038, -0.181],
    handR: [0, -0.048, 0.062, -0.35], handS: [0, -0.048, 0.062, -0.35] },
  { model: 'SMG',     hip: [0.19, -0.2, -0.42], sight: 0.0615, adsZ: -0.40, muzzle: [0, 0.006, -0.265],
    handR: [0, -0.072, 0.068, -0.25], handL: [0, -0.021, -0.125, 0] },
  { model: 'Uzi',     hip: [0.19, -0.2, -0.46], sight: 0.059, adsZ: -0.40, muzzle: [0, 0.012, -0.23],
    handR: [0, -0.066, 0.006, -0.12], handL: [0, -0.030, -0.098, 0] },
  { model: 'Shotgun', hip: [0.19, -0.2, -0.42], sight: 0.040, adsZ: -0.44, muzzle: [0, 0.016, -0.63],
    handR: [0, -0.038, 0.135, -0.7], handL: [0, -0.040, -0.27, 0] },
  { model: 'DoubleBarrel', hip: [0.19, -0.2, -0.42], sight: 0.0378, adsZ: -0.44, muzzle: [0, 0.018, -0.58],
    handR: [0, -0.045, 0.115, -0.7], handL: [0, -0.036, -0.18, 0] },
  { model: 'Rifle',   hip: [0.19, -0.2, -0.42], sight: 0.067, adsZ: -0.44, muzzle: [0, 0.006, -0.665],
    handR: [0, -0.072, 0.095, -0.3], handL: [0, -0.030, -0.235, 0] },
  { model: 'Sniper',  hip: [0.19, -0.2, -0.42], sight: 0.072, adsZ: -0.30, muzzle: [0, 0.02, -0.795], scope: true,
    handR: [0, -0.050, 0.128, -0.6], handL: [0, -0.040, -0.2, 0] },
  { model: 'Crossbow', hip: [0.19, -0.21, -0.42], sight: 0.082, adsZ: -0.40, muzzle: [0, 0.0405, -0.43],
    handR: [0, -0.070, 0.094, -0.3], handL: [0, -0.020, -0.18, 0] },
  { model: 'RocketLauncher', hip: [0.22, -0.13, -0.26], sight: 0.14, adsZ: -0.24, muzzle: [0, 0.07, -0.84],
    handR: [0, -0.03, 0.010, -0.15], handL: [0, 0.0445, -0.27, 0] },
  { model: 'Minigun', hip: [0.24, -0.3, -0.32], muzzle: [0, 0, -0.76],
    handR: [0, -0.060, 0.068, -0.2], handL: [0, 0.107, -0.10, 0] },
  { model: 'Flamethrower', hip: [0.22, -0.26, -0.3], muzzle: [0, 0.03, -0.69],
    handR: [0, -0.040, 0.014, -0.2], handL: [0, -0.030, -0.414, 0] },
  { model: 'Knife',   hip: [0.22, -0.2, -0.45], vr: true },
  { model: 'Machete', hip: [0.3, -0.3, -0.5], melee: true },
  { model: 'Katana',  hip: [0.3, -0.32, -0.5], melee: true, tilt: 0.75 },
  { model: 'Axe',     hip: [0.3, -0.3, -0.5], melee: true, tilt: 0.7, grip: -0.18 },
  { model: 'Chainsaw', hip: [0.2, -0.3, -0.34], muzzle: [0.07, 0.005, -0.8],
    handR: [0, 0, 0, -0.1], handL: [0, 0.185, -0.275, 0] },
  { model: 'BaseballBat', hip: [0.3, -0.3, -0.5], melee: true, tilt: 0.7 },
  { model: 'Crowbar', hip: [0.3, -0.3, -0.5], melee: true, tilt: 0.75, grip: -0.12 },
  { model: 'SledgeHammer', hip: [0.3, -0.32, -0.5], melee: true, tilt: 0.6, grip: -0.2 },
  { model: 'Grenade', hip: [0.28, -0.3, -0.5], held: true },
  { model: 'GrabGun', hip: [0.21, -0.22, -0.45], muzzle: [0, 0.005, -0.37],
    handR: [0, -0.088, 0.1, -0.25], handL: [0, -0.045, -0.075, 0] },
];

// ---- hand-driven knife (all in camera space: +x right, +y up, -z forward)
const HAND_REST = new THREE.Vector3(0.22, -0.2, -0.45);
const HAND_MIN = new THREE.Vector3(-0.5, -0.45, -0.95);
const HAND_MAX = new THREE.Vector3(0.6, 0.35, -0.28);
const ELBOW = new THREE.Vector3(0.37, -0.37, -0.14);       // where the forearm disappears off screen (hand at rest)
const SLEEVE_LEN = 0.3;                                    // length of the SleeveArm model
const BACK = new THREE.Vector3(0, 0, 1);
const WRIST = new THREE.Vector3(0.0035, 0.060, 0.102);     // on the KnifeHand model (REF.KnifeHand.wrist)
const BLADE = [new THREE.Vector3(0, 0, -0.07), new THREE.Vector3(0, 0, -0.18), new THREE.Vector3(0, 0, -0.285)]; // base, middle, tip

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _roll = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, -1);
const UPV = new THREE.Vector3(0, 1, 0);

function hand(name, [x, y, z, pitch]) {
  const h = getModel(name, null, false);
  if (!h) return null;
  h.position.set(x, y, z);
  h.rotation.x = pitch;
  return h;
}

/** One group per weapon: the weapon model plus the hands holding it. */
function buildViewmodel(v) {
  const g = new THREE.Group();
  const model = getModel(v.model, null, false)
    || new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.3), new THREE.MeshStandardMaterial({ color: 0x4a4a52 }));
  if (v.vr) {
    g.add(model);
    const h = hand('KnifeHand', [0, 0, 0, 0]);
    if (h) g.add(h);
  } else if (v.melee) {
    // fist at the origin, blade standing up out of it and tipped forward
    // (grip slides the fist along a long handle, toward the butt end)
    model.rotation.x = Math.PI / 2;
    model.position.y = -(v.grip || 0);
    g.add(model);
    const h = hand('HandR', [0, 0, 0, 0]);
    if (h) g.add(h);
    g.rotation.x = -(v.tilt ?? 0.9);
  } else if (v.held) {
    model.position.set(-0.004, 0.03, 0);
    g.add(model);
    const h = hand('HandR', [0, 0, 0, 0]);
    if (h) g.add(h);
  } else {
    g.add(model);
    const r = v.handR && hand('HandR', v.handR);
    const l = v.handL && hand('HandL', v.handL);
    const s = v.handS && hand('HandSupport', v.handS);
    if (r) g.add(r);
    if (l) g.add(l);
    if (s) g.add(s);
  }
  return g;
}

export class Weapons {
  constructor(ctx) {
    this.ctx = ctx;
    this.index = 0;
    this.cool = 0;
    this.kick = 0;
    this.swing = 0;
    this.grab = null;
    this.ads = 0;          // 0 = hip, 1 = fully aimed down the sights
    this.swayYaw = 0;
    this.swayPitch = 0;

    // hand-driven knife
    this.handTarget = HAND_REST.clone();   // where the mouse has put the hand
    this.handPos = HAND_REST.clone();      // where the hand actually is (follows with a little weight)
    this.handVel = new THREE.Vector3();
    this.bladePrev = null;                 // last frame's blade points in the world, for the cut sweep
    this.cutCool = new Map();              // collider -> time of the last cut, so one pass is one cut
    this.clock = 0;
    this.swishT = 0;
    this.shots = 0;        // fired since the last reload (weapons with a magazine)
    this.spin = 0;         // minigun barrels: 0 = stopped, 1 = up to speed
    this.tickT = 0;        // chainsaw / flamethrower: time to the next bite

    // pivot sits at the eye and turns the whole rig (aim lag, sway); rig holds the weapon
    this.pivot = new THREE.Group();
    this.pivot.rotation.order = 'YXZ';
    this.rig = new THREE.Group();
    this.rig.scale.setScalar(RIG_SCALE);
    this.models = VIEW.map(buildViewmodel);
    this.models.forEach((m, i) => { m.visible = i === 0; this.rig.add(m); });
    this.pivot.add(this.rig);
    ctx.camera.add(this.pivot);

    this.muzzle = new THREE.PointLight(0xffc070, 0, 8, 2);
    ctx.scene.add(this.muzzle);
    this.muzzleT = 0;
    this.flash = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.flash.visible = false;
    ctx.scene.add(this.flash);

    // the knife arm: a sleeve stretched from the wrist back to the elbow as the hand moves
    // (the SleeveArm model runs 0.3 m from its origin along +Z; a plain tube stands in if it is missing)
    this.forearm = getModel('SleeveArm', null, false);
    if (!this.forearm) {
      const g = new THREE.CylinderGeometry(0.045, 0.04, SLEEVE_LEN, 10);
      g.rotateX(Math.PI / 2).translate(0, 0, SLEEVE_LEN / 2);
      this.forearm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2c3321, roughness: 0.9 }));
    }
    this.forearm.visible = false;
    ctx.camera.add(this.forearm);

    // tracer pool
    this.tracers = [];
    const tg = new THREE.BoxGeometry(0.014, 0.014, 1);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true }));
      m.visible = false;
      m.userData.t = 0;
      ctx.scene.add(m);
      this.tracers.push(m);
    }
    this.tracerI = 0;

    // crossbow bolts left standing in whatever they hit
    this.bolts = [];
    const bg = new THREE.CylinderGeometry(0.006, 0.006, 0.44, 6).rotateX(Math.PI / 2);
    const bm = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.6 });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(bg, bm);
      m.castShadow = true;
      m.visible = false;
      this.bolts.push(m);
    }
    this.boltI = 0;

    // grab beam
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.beam = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x66ccff }));
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    ctx.scene.add(this.beam);

    this.buildBar();
    this.placeRig(0);
  }

  get current() { return WEAPONS[this.index]; }
  get view() { return VIEW[this.index]; }
  /** How much the view narrows at full aim (0.3 = a little, 0.82 = sniper scope). */
  get zoom() { return this.current.zoom || 0.3; }

  /** Knife out and a mouse button held: the mouse drives the hand, not the camera. */
  get handMode() {
    const i = this.ctx.input;
    return this.current.type === 'vrknife' && (i.left || i.right) && !this.ctx.player.dead;
  }

  /** Mouse movement while in hand mode. Left button: move the hand up/down/sideways.
   *  Right button: push the mouse forward to thrust, pull back to draw the hand in. */
  handMove(dx, dy) {
    const t = this.handTarget;
    t.x += dx * 0.0016;
    if (this.ctx.input.right) t.z += dy * 0.0022;
    else t.y -= dy * 0.0016;
    t.clamp(HAND_MIN, HAND_MAX);
  }

  buildBar() {
    const bar = document.getElementById('weapon-bar');
    bar.innerHTML = '';
    this.inSlot = SLOTS.map((_, n) => WEAPONS.map((w, i) => i).filter((i) => WEAPONS[i].slot === n));
    this.last = this.inSlot.map((list) => list[0]);       // the weapon each group was last left on
    this.slots = SLOTS.map((label, n) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<div class="list"></div><b>${n + 1} &middot; ${label}</b><span></span>`;
      bar.appendChild(el);
      return el;
    });
    this.refreshBar();
  }

  refreshBar() {
    const slot = this.current.slot;
    this.slots.forEach((el, n) => {
      el.classList.toggle('on', n === slot);
      el.querySelector('span').textContent = WEAPONS[this.last[n]].name;
      el.querySelector('.list').innerHTML = n === slot && this.inSlot[n].length > 1
        ? this.inSlot[n].map((i) => `<i class="${i === this.index ? 'cur' : ''}">${WEAPONS[i].name}</i>`).join('') : '';
    });
  }

  /** A number key: go to that group's weapon, or step to the next one if already in the group. */
  selectSlot(n) {
    const list = this.inSlot[n];
    if (!list) return;
    if (this.current.slot === n) this.select(list[(list.indexOf(this.index) + 1) % list.length]);
    else this.select(this.last[n]);
  }

  select(i) {
    i = (i + WEAPONS.length) % WEAPONS.length;
    if (i === this.index) return;
    this.releaseGrab();
    this.index = i;
    this.last[WEAPONS[i].slot] = i;
    this.models.forEach((m, k) => (m.visible = k === i));
    this.cool = 0.12;
    this.ads = 0;
    this.shots = 0;
    this.spin = 0;
    this.bladePrev = null;
    this.handTarget.copy(HAND_REST);
    this.handPos.copy(HAND_REST);
    this.forearm.visible = false;
    this.rig.visible = true;
    document.body.classList.remove('scoped');
    this.refreshBar();
    sfx.pop();
  }

  /** Leave a crossbow bolt standing in what it hit. It goes where that thing goes. */
  stickBolt(hit, point, dir) {
    const owner = this.ctx.owners.get(hit.collider.handle);
    const parent = owner?.kind === 'part' ? owner.ragdoll.parts[owner.name].mesh
      : owner?.kind === 'prop' ? owner.prop.mesh : this.ctx.scene;
    if (!parent) return;
    const b = this.bolts[this.boltI++ % this.bolts.length];
    this.ctx.scene.add(b);                                  // place it in the world first...
    b.position.copy(point).addScaledVector(dir, -0.1);
    b.quaternion.setFromUnitVectors(FWD, dir);
    b.visible = true;
    b.updateMatrixWorld(true);
    parent.updateMatrixWorld(true);
    parent.attach(b);                                       // ...then hand it over without it moving
  }

  /** Take every bolt back (the sandbox was cleared, or the map changed). */
  clearBolts() {
    for (const b of this.bolts) { b.removeFromParent(); b.visible = false; }
  }

  releaseGrab() {
    this.grab = null;
    this.beam.visible = false;
    document.getElementById('crosshair').classList.remove('grab');
  }

  // ---- helpers
  /** Origin and basis of the true aim (where the mouse points, not where a lagging camera looks). */
  aim() {
    const pl = this.ctx.player;
    this.ctx.camera.getWorldPosition(_o);
    _q.copy(pl.aimQuat);
    _d.set(0, 0, -1).applyQuaternion(_q);
    _r.set(1, 0, 0).applyQuaternion(_q);
    _u.set(0, 1, 0).applyQuaternion(_q);
    // the helmet camera sits above the eyes, so shots leave from eye level, in line with the weapon
    if (this.ctx.helmet) _o.addScaledVector(_u, -HELMET_DROP);
  }

  /** World position of the current weapon's muzzle. */
  muzzlePoint(out) {
    const m = this.view.muzzle || [0, 0, -0.3];
    this.ctx.camera.updateMatrixWorld(true);
    return this.models[this.index].localToWorld(out.set(m[0], m[1], m[2]));
  }

  tracer(from, to) {
    const t = this.tracers[this.tracerI++ % this.tracers.length];
    _m.copy(to).sub(from);
    const len = _m.length();
    if (len < 0.01) return;
    t.position.copy(from).addScaledVector(_m, 0.5);
    t.scale.set(1, 1, len);
    t.lookAt(to);
    t.visible = true;
    t.userData.t = 0.06;
    t.material.opacity = 0.9;
  }

  // ---- firing
  fireGun(w) {
    const ctx = this.ctx;
    this.aim();
    const origin = _o.clone();
    const fwd = _d.clone();
    const right = _r.clone();
    const up = _u.clone();
    const muzzle = this.muzzlePoint(new THREE.Vector3());
    const spread = w.spread * (1 - 0.65 * this.ads); // steadier down the sights

    for (let i = 0; i < w.pellets; i++) {
      const d = fwd.clone()
        .addScaledVector(right, (Math.random() - 0.5) * 2 * spread)
        .addScaledVector(up, (Math.random() - 0.5) * 2 * spread)
        .normalize();
      // a round stops at the first thing it hits, unless the weapon pierces bodies
      let from = origin, end = null;
      for (let left = w.pierce || 1; left > 0; left--) {
        const hit = ctx.raycast(from, d, 300);
        if (!hit) { end = from.clone().addScaledVector(d, 120); break; }
        end = from.clone().addScaledVector(d, hit.timeOfImpact);
        ctx.applyHit(hit, end, d, w.dmg, w.impulse, w.bolt ? { hole: w.hole, stab: true } : { hole: w.hole });
        if (w.bolt) { this.stickBolt(hit, end, d); break; }
        if (ctx.owners.get(hit.collider.handle)?.kind !== 'part') break; // walls and props stop it
        from = end.clone().addScaledVector(d, 0.45);
      }
      if (!w.bolt && (i < 3 || w.pellets === 1)) this.tracer(muzzle, end);
    }
    sfx[w.sound]();
    this.kick = w.kick;
    if (!w.quiet) {
      ctx.alert('shot', ctx.player.pos, 40);
      this.muzzle.position.copy(muzzle);
      this.muzzle.intensity = 30;
      this.flash.position.copy(muzzle).addScaledVector(fwd, 0.06);
      this.flash.scale.setScalar(0.05 + w.kick * 0.5 + Math.random() * 0.03);
      this.flash.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.flash.visible = true;
      this.muzzleT = 0.05;
    }
    ctx.player.recoil(w.kick * (0.6 - 0.2 * this.ads));
    if (w.mag && ++this.shots >= w.mag) {         // both barrels gone: break it open
      this.shots = 0;
      this.cool = w.reload;
      ctx.later(w.reload * 0.6, () => sfx.tick());
    }
  }

  fireRocket(w) {
    const ctx = this.ctx;
    this.aim();
    const fwd = _d.clone();
    const muzzle = this.muzzlePoint(new THREE.Vector3());
    const r = ctx.spawnProp('rocket', muzzle.clone().addScaledVector(fwd, 0.2));
    r.launch(fwd, 46);
    // backblast
    for (let i = 0; i < 14; i++) {
      const g = 0.25 + Math.random() * 0.2;
      ctx.gore.smoke.emit(muzzle.x - fwd.x * 1.2, muzzle.y - fwd.y * 1.2, muzzle.z - fwd.z * 1.2,
        -fwd.x * rnd(2, 7) + rnd(-1, 1), -fwd.y * rnd(2, 7) + rnd(0, 1.5), -fwd.z * rnd(2, 7) + rnd(-1, 1),
        rnd(0.3, 0.7), rnd(0.6, 1.3), -0.3, g, g, g, 0, 2);
    }
    sfx[w.sound]();
    ctx.alert('shot', ctx.player.pos, 40);
    this.kick = w.kick;
    ctx.player.recoil(w.kick * 0.5);
  }

  /**
   * The knife is held, not fired. The hand follows the mouse; the blade is swept through the
   * world every frame and whatever it passes through gets cut. How fast the blade was moving
   * decides how deep, and moving point-first makes it a stab rather than a slash.
   */
  updateKnife(dt, input) {
    const ctx = this.ctx, cam = ctx.camera, pl = ctx.player;
    this.clock += dt;
    this.swishT -= dt;
    if (!input.left && !input.right) this.handTarget.lerp(HAND_REST, Math.min(1, dt * 7)); // let go: hand comes home

    _p.copy(this.handPos);
    this.handPos.lerp(this.handTarget, Math.min(1, dt * 26));
    this.handVel.copy(this.handPos).sub(_p).multiplyScalar(1 / Math.max(dt, 1e-4));

    // the blade points out from the body, more so the further the hand is from rest
    _z.set((this.handPos.x - HAND_REST.x) * 1.1, 0.12 + (this.handPos.y - HAND_REST.y) * 0.9, -1).normalize();
    _x.crossVectors(_z, UPV).normalize();          // right
    _y.crossVectors(_x, _z);                        // up
    _mat.makeBasis(_x, _y, _z.clone().negate());    // model's -Z along the blade direction
    this.rig.position.copy(this.handPos);
    this.rig.quaternion.setFromRotationMatrix(_mat);
    // the wrist rolls into a sideways slash
    _roll.setFromAxisAngle(FWD, THREE.MathUtils.clamp(this.handVel.x * 0.13, -0.8, 0.8));
    this.rig.quaternion.multiply(_roll);
    this.pivot.rotation.set(pl.aimOff.pitch, pl.aimOff.yaw, 0);

    // forearm from the wrist back to the elbow
    cam.updateMatrixWorld(true);
    const model = this.models[this.index];
    const wrist = cam.worldToLocal(model.localToWorld(_m.copy(WRIST)));
    _o.copy(this.handPos).sub(HAND_REST).multiplyScalar(0.55).add(ELBOW);   // the elbow follows the hand part of the way
    const len = wrist.distanceTo(_o);
    this.forearm.position.copy(wrist);
    this.forearm.scale.set(1, 1, len / SLEEVE_LEN);
    this.forearm.quaternion.setFromUnitVectors(BACK, _o.sub(wrist).normalize());
    this.forearm.visible = true;

    // sweep the blade through the world
    const pts = BLADE.map((b) => model.localToWorld(b.clone()));
    const bladeDir = pts[2].clone().sub(pts[0]).normalize();
    if (this.bladePrev && dt > 0) {
      let fastest = 0;
      for (let k = 1; k < 3; k++) {                 // middle and tip of the blade
        const v = pts[k].clone().sub(this.bladePrev[k]);
        const dist = v.length();
        const speed = dist / dt;
        fastest = Math.max(fastest, speed);
        if (speed < 0.9 || dist < 0.003) continue;  // resting against something does not cut
        v.multiplyScalar(1 / dist);
        const hit = ctx.raycast(this.bladePrev[k], v, dist + 0.03);
        if (!hit) continue;
        const h = hit.collider.handle;
        if (this.clock - (this.cutCool.get(h) || -9) < 0.14) continue;
        this.cutCool.set(h, this.clock);
        const point = this.bladePrev[k].clone().addScaledVector(v, hit.timeOfImpact);
        const stab = v.dot(bladeDir) > 0.6;
        if (stab) ctx.applyHit(hit, point, v, THREE.MathUtils.clamp(speed * 2.2, 3, 14), 20, { stab: true });
        else ctx.applyHit(hit, point, v, THREE.MathUtils.clamp(speed * 1.3, 2, 9), 12 + speed * 2, { blade: true, light: true });
        if (ctx.owners.get(h)?.kind === 'part') { sfx.chop(); ctx.alert('violence', pl.pos, 12); }
      }
      if (fastest > 4.5 && this.swishT <= 0) { sfx.slash(); this.swishT = 0.28; }
    }
    this.bladePrev = pts;
    if (this.cutCool.size > 200) this.cutCool.clear();
  }

  /** One swing of a hand weapon: a short, narrow arc in front of you. */
  fireMelee(w) {
    const ctx = this.ctx;
    this.aim();
    const origin = _o.clone();
    const fwd = _d.clone();
    const right = _r.clone();
    sfx.slash();
    this.swing = 0.28;

    const seen = new Set();
    let hitSomething = false;
    for (const ox of [0, 0.16, -0.16]) {
      const d = fwd.clone().addScaledVector(right, ox).normalize();
      const hit = ctx.raycast(origin, d, w.range);
      if (!hit) continue;
      const h = hit.collider.handle;
      if (seen.has(h)) continue;
      seen.add(h);
      const pt = origin.clone().addScaledVector(d, hit.timeOfImpact);
      ctx.applyHit(hit, pt, d, w.dmg, w.impulse, w.blunt ? { blunt: true } : { blade: true, light: true, chop: true });
      hitSomething = true;
      break;                                   // one swing, one thing hit
    }
    if (hitSomething) {
      if (w.blunt) sfx.thud(1.4); else sfx.chop();
      ctx.player.recoil(0.02);
      ctx.alert('violence', ctx.player.pos, 12);
    }
  }

  /** Chainsaw: while the trigger is held the chain bites whatever is right in front of it, a little at a time. */
  updateSaw(dt, input, w) {
    if (!input.left) return;
    const ctx = this.ctx;
    this.kick = 0.012 + Math.random() * 0.012;           // it shakes in your hands
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = w.rate;
    sfx.saw();
    this.aim();
    const origin = _o.clone(), fwd = _d.clone(), right = _r.clone();
    for (const ox of [0, 0.1, -0.1]) {
      const d = fwd.clone().addScaledVector(right, ox).normalize();
      const hit = ctx.raycast(origin, d, w.range);
      if (!hit) continue;
      const pt = origin.clone().addScaledVector(d, hit.timeOfImpact);
      ctx.applyHit(hit, pt, d, w.dmg, w.impulse, { blade: true, light: true });
      if (ctx.owners.get(hit.collider.handle)?.kind === 'part') ctx.alert('violence', ctx.player.pos, 16);
      break;
    }
  }

  /** Flamethrower: a jet of fire. What it washes over chars, and people it stays on catch light. */
  updateFlame(dt, input, w) {
    if (!input.left) return;
    const ctx = this.ctx, fire = ctx.gore.fire;
    this.aim();
    const origin = _o.clone(), fwd = _d.clone(), right = _r.clone(), up = _u.clone();
    const m = this.muzzlePoint(new THREE.Vector3());
    for (let i = 0; i < 5; i++) {
      const s = rnd(9, 14), hot = Math.random();
      fire.emit(m.x, m.y, m.z,
        fwd.x * s + right.x * rnd(-1.2, 1.2) + up.x * rnd(-1, 1), fwd.y * s + rnd(-1, 1.4), fwd.z * s + right.z * rnd(-1.2, 1.2) + up.z * rnd(-1, 1),
        rnd(0.16, 0.42), rnd(0.32, 0.58), -2.2, 1, 0.35 + hot * 0.4, hot * 0.1, 0, 1.4);
    }
    this.muzzle.position.copy(m).addScaledVector(fwd, 1.6);
    this.muzzle.intensity = 22 + Math.random() * 16;
    this.muzzleT = 0.08;
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = 0.09;
    sfx.flame();
    ctx.alert('violence', ctx.player.pos, 16);
    for (const ox of [0, 0.11, -0.11]) {
      const d = fwd.clone().addScaledVector(right, ox).normalize();
      const hit = ctx.raycast(origin, d, w.range);
      if (!hit) continue;
      const owner = ctx.owners.get(hit.collider.handle);
      const pt = origin.clone().addScaledVector(d, hit.timeOfImpact);
      if (owner?.kind === 'part') owner.ragdoll.scorch(owner.name, w.heat, w.dmg, ctx.player.pos);
      else if (owner?.kind === 'prop') owner.prop.hit(w.dmg, pt, d, 4, {});
    }
  }

  throwGrenade() {
    const ctx = this.ctx;
    this.aim();
    const p = _o.clone().addScaledVector(_d, 0.9).addScaledVector(_u, -0.1);
    const g = ctx.spawnProp('grenade', p);
    const v = ctx.player.vel;
    g.body.setLinvel({ x: _d.x * 15 + v.x, y: _d.y * 15 + 3 + v.y, z: _d.z * 15 + v.z }, true);
    g.body.setAngvel({ x: rnd(-8, 8), y: rnd(-8, 8), z: rnd(-8, 8) }, true);
    this.swing = 0.2;
    sfx.slash();
  }

  updateGrab(dt, input) {
    const ctx = this.ctx;
    const crosshair = document.getElementById('crosshair');
    this.aim();

    if (input.left && !this.grab) {
      const hit = ctx.raycast(_o, _d, 16);
      if (hit) {
        const owner = ctx.owners.get(hit.collider.handle);
        if (owner?.kind === 'part') owner.ragdoll.goLimp(2); // grabbing an NPC drops it into physics
        const body = hit.collider.parent();
        if (body && body.isDynamic()) {
          const t = body.translation(), r = body.rotation();
          _p.copy(_o).addScaledVector(_d, hit.timeOfImpact);
          _q.set(r.x, r.y, r.z, r.w).invert();
          const local = _p.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(_q);
          this.grab = { body, dist: Math.max(1.2, hit.timeOfImpact), local, rag: owner?.kind === 'part' ? owner.ragdoll : null };
          crosshair.classList.add('grab');
        }
      }
    }
    if (!input.left && this.grab) this.releaseGrab();

    const g = this.grab;
    if (!g) return;
    // body might have been destroyed (gib, delete, clear)
    if (!ctx.world.getRigidBody(g.body.handle)) { this.releaseGrab(); return; }
    if (g.rag) g.rag.goLimp(1.2); // stays limp for as long as it is held
    const t = g.body.translation(), r = g.body.rotation();

    g.dist = THREE.MathUtils.clamp(g.dist + input.wheel * -0.004, 1.0, 14);
    _q.set(r.x, r.y, r.z, r.w);
    const gp = g.local.clone().applyQuaternion(_q).add(new THREE.Vector3(t.x, t.y, t.z));
    const target = _o.clone().addScaledVector(_d, g.dist);
    const err = target.sub(gp);
    const v = err.multiplyScalar(14);
    if (v.length() > 28) v.setLength(28);
    g.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    const w = g.body.angvel();
    g.body.setAngvel({ x: w.x * 0.9, y: w.y * 0.9, z: w.z * 0.9 }, true);

    // beam from the emitter to the held point
    const pos = this.beam.geometry.attributes.position;
    this.muzzlePoint(_m);
    pos.setXYZ(0, _m.x, _m.y, _m.z);
    pos.setXYZ(1, gp.x, gp.y, gp.z);
    pos.needsUpdate = true;
    this.beam.visible = true;

    if (input.rightDown) {
      this.aim();
      const m = g.body.mass();
      g.body.applyImpulse({ x: _d.x * m * 24, y: _d.y * m * 24 + m * 2, z: _d.z * m * 24 }, true);
      this.releaseGrab();
      sfx.slash();
    }
  }

  /** Position the rig between the hip pose and the aimed pose. */
  placeRig(s) {
    const v = this.view, pl = this.ctx.player;
    if (v.vr) return; // the knife places its own hand
    const helmet = this.ctx.helmet ? 1 : 0;
    const a = this.ads * this.ads * (3 - 2 * this.ads); // ease in and out of the sights
    const bob = pl ? pl.bob : 0;
    const hipX = v.hip[0] - 0.04 * helmet, hipY = v.hip[1] - 0.06 * helmet, hipZ = v.hip[2];
    // Normal view: the sights come up to the middle of the screen.
    // Helmet cam: the weapon comes up to the shooter's eye, which is below the camera, so you see
    // it shouldered from above the way real helmet footage looks, and aim along the top of it.
    const adsY = -(v.sight || 0) * RIG_SCALE - HELMET_DROP * helmet, adsZ = v.adsZ || hipZ;
    const bobK = (1 - 0.85 * a) * (1 + helmet);
    this.rig.position.set(
      THREE.MathUtils.lerp(hipX, 0, a) + s * -0.2 + Math.cos(bob) * 0.004 * bobK,
      THREE.MathUtils.lerp(hipY, adsY, a) + Math.sin(bob * 2) * 0.005 * bobK - s * 0.05,
      THREE.MathUtils.lerp(hipZ, adsZ, a) + this.kick * (1.4 - 0.7 * a)
    );
    this.rig.rotation.set(this.kick * (2.2 - 1.4 * a) + s * 0.4, s * 0.9, s * -0.8 + (1 - a) * -0.03);
  }

  update(dt, input) {
    const w = this.current;
    const pl = this.ctx.player;
    this.cool -= dt;

    if (input.wheel !== 0 && !this.grab) {
      this.select(this.index + (input.wheel > 0 ? 1 : -1));
    }

    // right mouse: aim down the sights (guns only; the grab gun uses it to throw)
    const wantAds = (w.type === 'gun' || w.type === 'rocket') && !w.hipOnly && input.right ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 11);
    if (Math.abs(wantAds - this.ads) < 0.002) this.ads = wantAds;

    // scoped weapons swap the viewmodel for a scope picture once fully aimed
    const scoped = !!this.view.scope && this.ads > 0.85;
    this.rig.visible = !scoped;
    document.body.classList.toggle('scoped', scoped);

    if (w.type === 'vrknife') {
      this.updateKnife(dt, input);
    } else if (w.type === 'grab') {
      this.updateGrab(dt, input);
    } else if (w.type === 'saw') {
      this.updateSaw(dt, input, w);
    } else if (w.type === 'flame') {
      this.updateFlame(dt, input, w);
    } else if (w.spin && this.spin < 1) {
      // the barrels have to come up to speed before anything leaves them
      const was = this.spin;
      this.spin = input.left ? Math.min(1, this.spin + dt / w.spin) : Math.max(0, this.spin - dt * 2);
      if (input.left && Math.floor(was * 6) !== Math.floor(this.spin * 6)) sfx.whirr(this.spin);
    } else if (this.cool <= 0) {
      if (w.spin && !input.left) this.spin = 0.99;      // let go: they start to wind down
      const trigger = w.auto ? input.left : input.leftDown;
      if (trigger) {
        this.cool = w.rate;
        if (w.type === 'gun') this.fireGun(w);
        else if (w.type === 'melee') this.fireMelee(w);
        else if (w.type === 'grenade') this.throwGrenade();
        else if (w.type === 'rocket') this.fireRocket(w);
      }
    }

    // viewmodel animation
    this.kick = Math.max(0, this.kick - dt * 1.2);
    this.swing = Math.max(0, this.swing - dt);
    const s = this.swing > 0 ? Math.sin((1 - this.swing / 0.28) * Math.PI) : 0;
    this.placeRig(s);

    // the weapon trails the mouse a little, and (helmet cam) leads the lagging camera
    const k = (1 - 0.75 * this.ads);
    this.swayYaw = THREE.MathUtils.clamp(this.swayYaw - (input.mx || 0) * 0.0007 * k, -0.07, 0.07);
    this.swayPitch = THREE.MathUtils.clamp(this.swayPitch - (input.my || 0) * 0.0007 * k, -0.07, 0.07);
    const decay = Math.exp(-dt * 9);
    this.swayYaw *= decay; this.swayPitch *= decay;
    if (w.type !== 'vrknife') this.pivot.rotation.set(pl.aimOff.pitch + this.swayPitch, pl.aimOff.yaw + this.swayYaw, 0);

    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) { this.muzzle.intensity = 0; this.flash.visible = false; }
    }
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.t -= dt;
      t.material.opacity = Math.max(0, t.userData.t / 0.06);
      if (t.userData.t <= 0) t.visible = false;
    }
  }
}

function rnd(a, b) { return a + Math.random() * (b - a); }
