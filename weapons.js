import * as THREE from 'three';
import { sfx, deafen } from './audio.js';
import { getModel } from './models.js';

// Number keys pick a group; pressing the same key again steps through the group.
export const SLOTS = ['Sidearms', 'SMGs', 'Shotguns', 'Rifles', 'Heavy', 'Blades', 'Blunt', 'Gear'];

// Less-lethal: tase = seconds a hit keeps someone on the floor, daze = seconds they are no use after (no fighting,
// cuffable), blunt = a bag, not a bullet. range = metres a round carries at all.
// type: gun (hitscan) | rocket | drone (a flying bomb you steer from its own camera) | spray (a cone of pepper) | flame | melee (a swing) | saw | knife (slice and stab) | grenade | grab
// Guns: pierce = how many bodies one round passes through, zoom = how far the view narrows when aimed,
//   rec = [up, sideways] recoil per shot in radians (the view kicks, and part of it stays: bursts climb),
//   drift = how much the sideways part leans one way, shell = spent cases hit the ground,
//   mag = rounds it holds, reload = seconds to refill it (R), shells = loaded one at a time (reload is per shell,
//   and firing interrupts it), selfLoad = reloads itself when empty, jam = chance per shot that the action
//   stops (F clears it). Automatic guns switch between auto and single shots with B.
//   pen = metres of wall, door or crate a round goes through (and whether body armour stops it),
//   spin = seconds of wind-up, bolt = leaves a bolt where it hits,
//   quiet = nobody hears it.
// Melee is weak on purpose: a hit staggers, it takes several to bring someone down, and a limb only
// comes off once its health is gone. blunt = breaks instead of cuts.
export const WEAPONS = [
  { name: 'Pistol',   slot: 0, type: 'gun', auto: false, rate: 0.20,  dmg: 34,  impulse: 140, pellets: 1,  spread: 0.003, sound: 'pistol',   kick: 0.07,  hole: 0.034, rec: [0.020, 0.006], shell: true, mag: 17, reload: 1.5, jam: 0.004 },
  { name: 'Revolver', slot: 0, type: 'gun', auto: false, rate: 0.50,  dmg: 70,  impulse: 260, pellets: 1,  spread: 0.002, sound: 'revolver', kick: 0.17,  hole: 0.046, rec: [0.055, 0.012], mag: 6, reload: 2.6, pen: 0.2 },
  { name: 'Taser',    slot: 0, type: 'gun', auto: false, rate: 0.6,   dmg: 2,   impulse: 0,   pellets: 1,  spread: 0.004, sound: 'taser',    kick: 0.03,  rec: [0.012, 0.003], mag: 1, reload: 3.2, pen: 0, range: 7, daze: 6, tase: 5 },
  { name: 'SMG',      slot: 1, type: 'gun', auto: true,  rate: 0.055, dmg: 11,  impulse: 60,  pellets: 1,  spread: 0.020, sound: 'smg',      kick: 0.022, hole: 0.022, rec: [0.0075, 0.004], shell: true, mag: 30, reload: 1.9, jam: 0.007 },
  { name: 'Uzi',      slot: 1, type: 'gun', auto: true,  rate: 0.048, dmg: 9,   impulse: 50,  pellets: 1,  spread: 0.034, sound: 'uzi',      kick: 0.026, hole: 0.022, rec: [0.0095, 0.0065], shell: true, mag: 32, reload: 1.8, jam: 0.011 },
  { name: 'Shotgun',  slot: 2, type: 'gun', auto: false, rate: 0.85,  dmg: 15,  impulse: 110, pellets: 10, spread: 0.055, sound: 'shotgun',  kick: 0.16,  hole: 0.027, rec: [0.065, 0.015], shell: true, mag: 6, reload: 0.5, shells: true, jam: 0.006 },
  { name: 'Double Barrel', slot: 2, type: 'gun', auto: false, rate: 0.22, dmg: 16, impulse: 120, pellets: 12, spread: 0.075, sound: 'dbarrel', kick: 0.2, hole: 0.028, mag: 2, reload: 1.5, selfLoad: true, rec: [0.085, 0.02] },
  { name: 'Beanbag',  slot: 2, type: 'gun', auto: false, rate: 0.9,   dmg: 6,   impulse: 280, pellets: 1,  spread: 0.012, sound: 'beanbag',  kick: 0.14,  rec: [0.055, 0.012], shell: true, mag: 5, reload: 0.6, shells: true, pen: 0, range: 18, blunt: true, daze: 3 },
  { name: 'Rifle',    slot: 3, type: 'gun', auto: true,  rate: 0.075, dmg: 17,  impulse: 95,  pellets: 1,  spread: 0.010, sound: 'rifle',    kick: 0.035, hole: 0.03, rec: [0.015, 0.007], drift: 0.25, shell: true, mag: 30, reload: 2.2, jam: 0.004, pen: 0.35 },
  { name: 'AR-15',    slot: 3, type: 'gun', auto: true,  rate: 0.072, dmg: 15,  impulse: 80,  pellets: 1,  spread: 0.006, sound: 'ar15',     kick: 0.03,  hole: 0.027, rec: [0.011, 0.0045], shell: true, mag: 30, reload: 2.0, jam: 0.008, pen: 0.3 },
  { name: 'Sniper',   slot: 3, type: 'gun', auto: false, rate: 1.30,  dmg: 150, impulse: 420, pellets: 1,  spread: 0,     sound: 'sniper',   kick: 0.22,  hole: 0.05, pierce: 3, zoom: 0.82, rec: [0.085, 0.01], shell: true, mag: 5, reload: 2.8, pen: 0.7 },
  { name: 'Crossbow', slot: 3, type: 'gun', auto: false, rate: 1.25,  dmg: 85,  impulse: 180, pellets: 1,  spread: 0.001, sound: 'twang',    kick: 0.05,  hole: 0.02, bolt: true, quiet: true, zoom: 0.45, rec: [0.01, 0.002], mag: 1, reload: 1.1, selfLoad: true },
  { name: 'Rocket',   slot: 4, type: 'rocket', auto: false, rate: 0.3, sound: 'rocket', kick: 0.13, mag: 1, reload: 1.4, selfLoad: true },
  { name: 'Minigun',  slot: 4, type: 'gun', auto: true,  rate: 0.028, dmg: 12,  impulse: 70,  pellets: 1,  spread: 0.030, sound: 'minigun',  kick: 0.018, hole: 0.026, spin: 0.7, hipOnly: true, rec: [0.0045, 0.004], shell: true, mag: 200, reload: 4.5, jam: 0.002, pen: 0.3 },
  { name: 'Flamethrower', slot: 4, type: 'flame', range: 7.5, dmg: 5, heat: 0.13, mag: 100, reload: 3.0 },
  { name: 'Knife',    slot: 5, type: 'knife', slice: { rate: 0.32, dmg: 8, impulse: 15, range: 1.9 }, stab: { rate: 0.55, dmg: 16, impulse: 25, range: 1.8 } },
  { name: 'Machete',  slot: 5, type: 'melee', rate: 0.60, dmg: 14, impulse: 60,  range: 1.7 },
  { name: 'Katana',   slot: 5, type: 'melee', rate: 0.55, dmg: 18, impulse: 50,  range: 1.9 },
  { name: 'Axe',      slot: 5, type: 'melee', rate: 0.90, dmg: 22, impulse: 110, range: 1.6 },
  { name: 'Chainsaw', slot: 5, type: 'saw',   rate: 0.08, dmg: 3,  impulse: 20,  range: 1.6 },
  { name: 'Bat',      slot: 6, type: 'melee', rate: 0.60, dmg: 9,  impulse: 150, range: 1.7, blunt: true },
  { name: 'Crowbar',  slot: 6, type: 'melee', rate: 0.60, dmg: 11, impulse: 120, range: 1.5, blunt: true },
  { name: 'Sledgehammer', slot: 6, type: 'melee', rate: 1.20, dmg: 24, impulse: 320, range: 1.7, blunt: true },
  { name: 'Grenade',  slot: 7, type: 'grenade', auto: false, rate: 0.7 },
  { name: 'Flashbang', slot: 7, type: 'grenade', prop: 'flashbang', auto: false, rate: 0.9 },
  { name: 'Grab Gun', slot: 7, type: 'grab' },
  { name: 'Drone',    slot: 7, type: 'drone', auto: false, rate: 1.0 },
  { name: 'Pepper Spray', slot: 7, type: 'spray', range: 3.2, mag: 100, reload: 2.0 },
  { name: 'Rope Tool', slot: 7, type: 'tool', tool: 'rope' },      // tools.js: click one thing, then another
  { name: 'Weld Tool', slot: 7, type: 'tool', tool: 'weld' },
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
//   knife  - held point-forward in its own hand, with a sleeve running back off screen
const RIG_SCALE = 0.8;
const RECOIL = 3.4;        // one dial for how hard every gun kicks
const CAN = 0.17;          // suppressor length, in weapon-model metres
const HELMET_DROP = 0.1;   // how far the eyes are below the helmet camera (matches player.js)
const VIEW = [
  { model: 'Pistol',  hip: [0.19, -0.19, -0.50], sight: 0.0319, adsZ: -0.42, muzzle: [0, 0.0201, -0.081],
    handR: [0, -0.046, 0.0625, -0.226], handS: [0, -0.046, 0.0625, -0.226] },
  { model: 'Revolver', hip: [0.19, -0.19, -0.50], sight: 0.058, adsZ: -0.42, muzzle: [0, 0.038, -0.181],
    handR: [0, -0.048, 0.062, -0.35], handS: [0, -0.048, 0.062, -0.35] },
  { model: 'Pistol',  hip: [0.19, -0.19, -0.50], sight: 0.0319, adsZ: -0.42, muzzle: [0, 0.0201, -0.081], tint: 0xe0c020,   // the taser: a pistol in police yellow
    handR: [0, -0.046, 0.0625, -0.226], handS: [0, -0.046, 0.0625, -0.226] },
  { model: 'SMG',     hip: [0.19, -0.2, -0.42], sight: 0.0594, adsZ: -0.40, muzzle: [0, 0.0301, -0.438],
    handR: [0, -0.072, 0.068, -0.25], handL: [0, -0.0213, -0.125, 0] },
  { model: 'Uzi',     hip: [0.19, -0.2, -0.46], sight: 0.059, adsZ: -0.40, muzzle: [0, 0.012, -0.23],
    handR: [0, -0.066, 0.006, -0.12], handL: [0, -0.030, -0.098, 0] },
  { model: 'Shotgun', hip: [0.19, -0.2, -0.42], sight: 0.0521, adsZ: -0.44, muzzle: [0, 0.03, -0.759],
    handR: [0, -0.038, 0.135, -0.3], handL: [0, -0.0369, -0.27, 0] },
  { model: 'DoubleBarrel', hip: [0.19, -0.2, -0.42], sight: 0.0378, adsZ: -0.44, muzzle: [0, 0.018, -0.58],
    handR: [0, -0.045, 0.115, -0.7], handL: [0, -0.036, -0.18, 0] },
  { model: 'Shotgun', hip: [0.19, -0.2, -0.42], sight: 0.0521, adsZ: -0.44, muzzle: [0, 0.03, -0.759], tint: 0xe06a10,   // the beanbag gun: the pump gun in orange
    handR: [0, -0.038, 0.135, -0.3], handL: [0, -0.0369, -0.27, 0] },
  { model: 'Rifle',   hip: [0.19, -0.2, -0.42], sight: 0.0562, adsZ: -0.44, muzzle: [0, 0.0011, -0.526],
    handR: [0, -0.072, 0.095, -0.3], handL: [0, -0.034, -0.235, 0] },
  { model: 'AR15',    hip: [0.19, -0.21, -0.40], sight: 0.1002, adsZ: -0.40, muzzle: [0, 0.0331, -0.569],
    handR: [0, -0.066, 0.045, -0.3], handL: [0, -0.002, -0.255, 0] },
  { model: 'Sniper',  hip: [0.19, -0.2, -0.42], sight: 0.072, adsZ: -0.30, muzzle: [0, -0.0078, -0.721], scope: true,
    handR: [0, -0.050, 0.128, -0.6], handL: [0, -0.048, -0.2, 0] },
  { model: 'Crossbow', hip: [0.19, -0.21, -0.42], sight: 0.082, adsZ: -0.40, muzzle: [0, 0.0405, -0.43],
    handR: [0, -0.070, 0.094, -0.3], handL: [0, -0.020, -0.18, 0] },
  { model: 'RocketLauncher', hip: [0.22, -0.13, -0.26], sight: 0.14, adsZ: -0.24, muzzle: [0, 0.07, -0.84],
    handR: [0, -0.03, 0.010, -0.15], handL: [0, 0.0445, -0.27, 0] },
  { model: 'Minigun', hip: [0.24, -0.3, -0.32], muzzle: [0, 0, -0.76],
    handR: [0, -0.060, 0.068, -0.2], handL: [0, 0.107, -0.10, 0] },
  { model: 'Flamethrower', hip: [0.22, -0.26, -0.3], muzzle: [0, 0.03, -0.69],
    handR: [0, -0.040, 0.014, -0.2], handL: [0, -0.030, -0.414, 0] },
  { model: 'Knife',   hip: [0.2, -0.2, -0.42], knife: true },
  { model: 'Machete', hip: [0.3, -0.3, -0.5], melee: true },
  { model: 'Katana',  hip: [0.3, -0.32, -0.5], melee: true, tilt: 0.75 },
  { model: 'Axe',     hip: [0.3, -0.3, -0.5], melee: true, tilt: 0.7, grip: -0.18 },
  { model: 'Chainsaw', hip: [0.2, -0.3, -0.34], muzzle: [0.07, 0.005, -0.8],
    handR: [0, 0, 0, -0.1], handL: [0, 0.185, -0.275, 0] },
  { model: 'BaseballBat', hip: [0.3, -0.3, -0.5], melee: true, tilt: 0.7 },
  { model: 'Crowbar', hip: [0.3, -0.3, -0.5], melee: true, tilt: 0.75, grip: -0.12 },
  { model: 'SledgeHammer', hip: [0.3, -0.32, -0.5], melee: true, tilt: 0.6, grip: -0.2 },
  { model: 'Grenade', hip: [0.28, -0.3, -0.5], held: true },
  { model: 'Grenade', hip: [0.28, -0.3, -0.5], held: true },      // shortcut: the flashbang is held as a grenade; give it its own model when one is built
  { model: 'GrabGun', hip: [0.21, -0.22, -0.45], muzzle: [0, 0.005, -0.37],
    handR: [0, -0.088, 0.1, -0.25], handL: [0, -0.045, -0.075, 0] },
  { model: 'Grenade', hip: [0.28, -0.3, -0.5], held: true },      // shortcut: the drone is a grenade in the hand, give it its own model when someone builds one
  { model: 'PepperSpray', hip: [0.26, -0.26, -0.46], can: true, muzzle: [0, 0.07, -0.03] },
  { model: 'GrabGun', hip: [0.21, -0.22, -0.45], muzzle: [0, 0.005, -0.37], tint: 0xb07a3a,       // the rope tool: the grab gun in brown
    handR: [0, -0.088, 0.1, -0.25], handL: [0, -0.045, -0.075, 0] },
  { model: 'GrabGun', hip: [0.21, -0.22, -0.45], muzzle: [0, 0.005, -0.37], tint: 0xff9a2a,       // the weld tool: in orange
    handR: [0, -0.088, 0.1, -0.25], handL: [0, -0.045, -0.075, 0] },
];

const SLEEVE_LEN = 0.3;                                    // length of the SleeveArm model
const WRIST = new THREE.Vector3(0.0035, 0.060, 0.102);     // on the KnifeHand model (REF.KnifeHand.wrist)

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, -1);

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
  let model = getModel(v.model, null, false);
  if (!model && v.can) {                       // a spray can: a red tin with a black cap
    model = new THREE.Group();
    const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.13, 16), new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.4, metalness: 0.3 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }));
    cap.position.y = 0.08;
    model.add(tin, cap);
  }
  model ||= new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.3), new THREE.MeshStandardMaterial({ color: 0x4a4a52 }));
  if (v.tint) model.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.set(v.tint); } });
  if (v.knife) {
    // blade forward, tipped up and in a little; the arm runs back and down out of the picture
    g.add(model);
    const h = hand('KnifeHand', [0, 0, 0, 0]);
    if (h) g.add(h);
    const arm = getModel('SleeveArm', null, false);
    if (arm) {
      arm.position.copy(WRIST);
      arm.rotation.set(0.5, 0.35, 0);
      arm.scale.z = 0.6 / SLEEVE_LEN;
      g.add(arm);
    }
    g.rotation.set(0.22, 0.3, -0.25);
  } else if (v.melee) {
    // fist at the origin, blade standing up out of it and tipped forward
    // (grip slides the fist along a long handle, toward the butt end)
    model.rotation.x = Math.PI / 2;
    model.position.y = -(v.grip || 0);
    g.add(model);
    const h = hand('HandR', [0, 0, 0, 0]);
    if (h) g.add(h);
    g.rotation.x = -(v.tilt ?? 0.9);
  } else if (v.can) {
    g.add(model);
    const h = hand('HandR', [0, -0.07, 0.03, 0]);
    if (h) g.add(h);
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
    // the hand that changes magazines, and the magazine it brings up (a box: the guns are downloaded models with no loose parts)
    const off = l || s;
    if (off) {
      g.userData.off = off;
      g.userData.rest = off.position.clone();
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.12, 0.06), new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.5 }));
      mag.position.set(0, -0.06, 0.02);
      mag.visible = false;
      off.add(mag);
      g.userData.mag = mag;
    }
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

    this.thrust = 0;       // knife: time left in a stab
    this.bloom = 0;        // how far sustained fire has opened the spread up
    this.kickSide = 0;     // the weapon twists a little differently with every shot
    this.ammo = WEAPONS.map((w) => w.mag || 0);     // rounds in each weapon
    this.jammed = WEAPONS.map(() => false);
    this.single = WEAPONS.map(() => false);         // automatic weapons switched to one shot per pull
    this.reloadT = 0;      // seconds left of the reload in hand (0 = not reloading)
    this.clearT = 0;       // seconds left of clearing a jam
    this.busy = 0;         // 0..1: how far the weapon is lowered while being worked on
    this.ammoEl = document.getElementById('ammo');
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
    this.flash = muzzleFlash();
    ctx.scene.add(this.flash);

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

    // attachments: a suppressor per gun (J), and a laser (K) with its dot and, in the dark, its beam
    this.can = WEAPONS.map(() => false);
    this.canMesh = [];
    this.laser = false;
    const glow = document.createElement('canvas'); glow.width = glow.height = 32;
    const gg = glow.getContext('2d'), gr = gg.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    gg.fillStyle = gr; gg.fillRect(0, 0, 32, 32);
    this.dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glow), color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.dot.visible = false;
    ctx.scene.add(this.dot);
    this.ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ray.frustumCulled = false;
    this.ray.visible = false;
    ctx.scene.add(this.ray);

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

  buildBar() {
    const bar = document.getElementById('weapon-bar');
    bar.innerHTML = '';
    this.inSlot = SLOTS.map((_, n) => WEAPONS.map((w, i) => i).filter((i) => WEAPONS[i].slot === n));
    this.last = this.inSlot.map((list) => list[0]);       // the weapon each group was last left on
    this.slots = SLOTS.map((label, n) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<div class="list"></div><b><kbd>${n + 1}</kbd>${label}</b><span></span>`;
      bar.appendChild(el);
      return el;
    });
    this.refreshBar();
  }

  refreshBar() {
    const slot = this.current.slot;
    this.slots.forEach((el, n) => {
      el.classList.toggle('on', n === slot);
      el.classList.toggle('locked', !!this.allowed && !this.inSlot[n].some((i) => this.allowed.has(i)));
      el.querySelector('span').textContent = WEAPONS[this.last[n]].name;
      el.querySelector('.list').innerHTML = n === slot && this.inSlot[n].length > 1
        ? this.inSlot[n].map((i) => `<i class="${i === this.index ? 'cur' : this.allowed && !this.allowed.has(i) ? 'locked' : ''}">${WEAPONS[i].name}</i>`).join('') : '';
    });
  }

  /** A number key: go to that group's weapon, or step to the next one if already in the group. */
  selectSlot(n) {
    // (allowed: Zombie Survival's owned weapons; null everywhere else)
    const list = this.inSlot[n]?.filter((i) => !this.allowed || this.allowed.has(i));
    if (!list) return;
    if (!list.length) { this.ctx.toast('LOCKED - BUY IT IN THE SHOP (Y)'); return; }
    if (this.current.slot === n) this.select(list[(list.indexOf(this.index) + 1) % list.length]);
    else this.select(list.includes(this.last[n]) ? this.last[n] : list[0]);
  }

  select(i) {
    i = (i + WEAPONS.length) % WEAPONS.length;
    if (i === this.index || (this.allowed && !this.allowed.has(i))) return;
    this.releaseGrab();
    this.index = i;
    this.last[WEAPONS[i].slot] = i;
    this.models.forEach((m, k) => (m.visible = k === i));
    this.cool = 0.12;
    this.ads = 0;
    this.reloadT = this.clearT = 0;       // putting it away abandons whatever you were doing to it
    this.spin = 0;
    this.thrust = 0;
    this.rig.visible = true;
    document.body.classList.remove('scoped');
    this.refreshBar();
    sfx.pop();
  }

  // ---- ammunition
  /** One round gone. It may jam the action; an empty self-loading weapon starts its own reload. */
  spend(w) {
    if (!w.mag) return;
    const i = this.index;
    if (--this.ammo[i] > 0 && w.jam && Math.random() < w.jam) {
      this.jammed[i] = true;
      sfx.tick();
      this.ctx.toast('JAMMED - F to clear');
    }
    if (this.ammo[i] <= 0 && w.selfLoad) this.reload();
  }

  /** Can it fire right now? `pulled` = the trigger was pressed this frame (so an empty gun clicks once, not forever). */
  ready(w, pulled) {
    if (!w.mag) return true;
    const i = this.index;
    if (this.clearT > 0) return false;
    if (this.reloadT > 0) {
      if (!(w.shells && this.ammo[i] > 0)) return false;
      this.reloadT = 0;                      // shells already in: stop loading and shoot
    }
    if (this.jammed[i] || this.ammo[i] <= 0) {
      if (pulled) { sfx.tick(); this.ctx.toast(this.jammed[i] ? 'JAMMED - F to clear' : 'EMPTY - R to reload'); }
      return false;
    }
    return true;
  }

  /** R: refill the magazine (or start feeding shells). */
  reload() {
    const w = this.current, i = this.index;
    if (!w.mag || this.reloadT > 0 || this.clearT > 0 || this.jammed[i] || this.ammo[i] >= w.mag + (chamber(w) ? 1 : 0)) return;
    this.topped = chamber(w) && this.ammo[i] > 0;             // one still in the chamber rides along
    this.reloadT = w.reload * (chamber(w) && !this.topped ? 1.3 : 1);   // from empty, the bolt has to go forward too
    this.ads = 0;
    sfx.reload();
    if (w.type === 'gun' && w.shell && !w.shells && !w.spin) this.dropMag();
  }

  /** The old magazine falls out and stays where it lands (the last dozen do). */
  dropMag() {
    const ctx = this.ctx;
    this.aim();
    const p = _o.clone().addScaledVector(_d, 0.45).addScaledVector(_r, 0.16).addScaledVector(_u, -0.3);
    const m = ctx.spawnProp('mag', p, ctx.player.yaw);
    const v = ctx.player.vel;
    m.body.setLinvel({ x: v.x + _d.x * 0.6, y: -1.2, z: v.z + _d.z * 0.6 }, true);
    m.body.setAngvel({ x: rnd(-4, 4), y: rnd(-2, 2), z: rnd(-4, 4) }, true);
    this.mags = (this.mags || []).filter((o) => !o.removed);
    this.mags.push(m);
    if (this.mags.length > 12) this.mags.shift().remove();
  }

  /** F: rack the action to clear a jam. Costs the round that was stuck. */
  unjam() {
    const i = this.index;
    if (!this.jammed[i] || this.clearT > 0) return;
    this.clearT = 0.7;
    this.reloadT = 0;
    sfx.reload();
  }

  /** Fire out of a muzzle at p, pointing along dir: a flame star about len metres long, and a moment of light. */
  fireFlash(p, dir, len, follow = false) {
    const f = this.flash;
    this.flashFollow = follow;                    // your own: it stays on the muzzle while the gun kicks up
    f.position.copy(p).addScaledVector(dir, 0.02);
    f.quaternion.setFromUnitVectors(FWD, dir);
    f.rotateZ(Math.random() * Math.PI);
    f.scale.setScalar(len * rnd(0.8, 1.2));
    f.children[2].material.rotation = Math.random() * Math.PI;
    f.visible = true;
    this.muzzle.position.copy(p).addScaledVector(dir, 0.55);     // (ahead of the gun, so it lights the room more than your own hands)
    this.muzzle.intensity = 12 + len * 45;
    this.muzzleT = 0.045;
  }

  /** J: screw a suppressor on or off (single-projectile guns, not the revolver). */
  toggleCan() {
    const w = this.current, i = this.index;
    if (w.type !== 'gun' || w.spin || w.pellets > 1 || w.bolt || w.name === 'Revolver') return;
    this.can[i] = !this.can[i];
    if (!this.canMesh[i]) {
      const m = VIEW[i].muzzle || [0, 0, -0.3];
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, CAN, 14).rotateX(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.45, metalness: 0.6 }));
      c.position.set(m[0], m[1], m[2] - CAN / 2);
      this.models[i].add(c);
      this.canMesh[i] = c;
    }
    this.canMesh[i].visible = this.can[i];
    sfx.tick();
    this.ctx.toast(this.can[i] ? 'SUPPRESSOR ON' : 'SUPPRESSOR OFF');
  }

  /** The laser: a red dot where the barrel points (and the beam itself after dark). */
  updateLaser() {
    const show = this.laser && this.current.type === 'gun' && !this.ctx.drone && this.rig.visible;
    this.dot.visible = this.ray.visible = false;
    if (!show) return;
    this.aim();
    const from = this.muzzlePoint(new THREE.Vector3());
    const hit = this.ctx.raycast(from, _d, 120);
    const to = from.clone().addScaledVector(_d, hit ? hit.timeOfImpact - 0.02 : 120);
    if (hit) {
      this.dot.position.copy(to);
      this.dot.scale.setScalar(0.02 + hit.timeOfImpact * 0.0035);
      this.dot.visible = true;
    }
    const pos = this.ray.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z); pos.setXYZ(1, to.x, to.y, to.z); pos.needsUpdate = true;
    this.ray.material.opacity = this.ctx.night ? 0.35 : 0.06;
    this.ray.visible = true;
  }

  /** B: automatic weapons between full auto and one shot per pull. */
  toggleMode() {
    const w = this.current;
    if (w.type !== 'gun' || !w.auto || w.spin) return;
    this.single[this.index] = !this.single[this.index];
    sfx.tick();
    this.ctx.toast(this.single[this.index] ? 'SEMI' : 'AUTO');
  }

  /** Run the reload / clearing in hand, and keep the counter on screen right. */
  tickAmmo(dt) {
    const w = this.current, i = this.index;
    if (this.clearT > 0 && (this.clearT -= dt) <= 0) {
      this.jammed[i] = false;
      this.ammo[i] = Math.max(0, this.ammo[i] - 1);
    }
    if (this.reloadT > 0 && (this.reloadT -= dt) <= 0) {
      if (w.shells) {
        this.ammo[i]++;
        if (this.ammo[i] < w.mag) { this.reloadT = w.reload; sfx.reload(); }      // next shell
      } else {
        this.ammo[i] = w.mag + (this.topped ? 1 : 0);
        if (chamber(w) && !this.topped) sfx.reload();
        sfx.tick();
      }
    }
    const working = this.reloadT > 0 || this.clearT > 0;
    this.busy += ((working ? 1 : 0) - this.busy) * Math.min(1, dt * 10);
    // the weapon's name over the count (or what is being done to it), and the fire mode
    const mode = w.type === 'gun' && w.auto && !w.spin ? `<em>${this.single[i] ? 'SEMI' : 'AUTO'}</em>` : '';
    const state = this.clearT > 0 ? 'CLEARING' : this.jammed[i] ? 'JAMMED <kbd>F</kbd>' : this.reloadT > 0 ? 'RELOADING' : '';
    const text = `<small>${w.name}${mode}</small>` + (!w.mag ? '' : state ? `<b class="st">${state}</b>`
      : `<b>${Math.min(this.ammo[i], w.mag)}${this.ammo[i] > w.mag ? '<sup>+1</sup>' : ''}</b><i>/ ${w.mag}</i>`);
    if (text !== this.ammoText) {
      this.ammoText = text;
      this.ammoEl.innerHTML = text;
      this.ammoEl.classList.toggle('warn', this.jammed[i] || (w.mag > 0 && this.ammo[i] === 0));
      this.ammoEl.classList.toggle('low', w.mag > 3 && this.ammo[i] > 0 && this.ammo[i] <= w.mag / 4);
    }
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
    return this.models[this.index].localToWorld(out.set(m[0], m[1], m[2] - (this.can[this.index] ? CAN : 0)));
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
    const pl = ctx.player, moving = Math.min(1, Math.hypot(pl.vel.x, pl.vel.z) / 5.2) * 1.2 + (pl.grounded ? 0 : 2.5);
    // steadier down the sights, wilder the longer you hold it, and on the move or in the air
    const spread = (w.spread + this.bloom * 0.014) * (1 - 0.65 * this.ads) * (1 + moving);

    for (let i = 0; i < w.pellets; i++) {
      const d = fwd.clone()
        .addScaledVector(right, (Math.random() - 0.5) * 2 * spread)
        .addScaledVector(up, (Math.random() - 0.5) * 2 * spread)
        .normalize();
      // a round carries on: through bodies if the weapon pierces, out the back of anything thinner than it can
      // punch through (pen, metres), or skipping off a surface it only grazes. Each of those costs it some force.
      const pen = w.pen ?? (w.pellets > 1 ? 0.03 : 0.1);
      let from = origin, end = null, first = null, dmg = w.dmg, bodies = w.pierce || 1;
      for (let leg = 0; leg < 5; leg++) {
        const hit = ctx.raycast(from, d, w.range || 300);
        if (!hit) { end = from.clone().addScaledVector(d, w.range || 120); break; }
        end = from.clone().addScaledVector(d, hit.timeOfImpact);
        const glass = ctx.owners.get(hit.collider.handle)?.kind === 'glass';
        dmg *= ctx.water.through(from, end);           // (a splash where it goes in, and water soaks up a round fast)
        ctx.applyHit(hit, end, d, dmg, w.impulse * dmg / w.dmg, w.bolt ? { hole: w.hole, stab: true } : { hole: w.hole, pen, blunt: w.blunt, daze: w.daze, tase: w.tase });
        if (w.bolt) { this.stickBolt(hit, end, d); break; }
        first ??= end;
        if (glass) { from = end.clone().addScaledVector(d, 0.05); continue; }     // through the window, and on
        if (ctx.owners.get(hit.collider.handle)?.kind === 'part') {
          if (--bodies <= 0) break;
          from = end.clone().addScaledVector(d, 0.45);
          continue;
        }
        const n = hit.normal, graze = -(d.x * n.x + d.y * n.y + d.z * n.z);
        if (graze < 0.22 && Math.random() < 0.6) {                 // ricochet
          d.set(d.x + 2 * graze * n.x, d.y + 2 * graze * n.y, d.z + 2 * graze * n.z).normalize();
          from = end.clone().addScaledVector(d, 0.02);
          dmg *= 0.5;
          continue;
        }
        if (ctx.world.getCollider(hit.collider.handle) !== hit.collider) break;     // what it hit is gone (a barrel that went up): nothing to come out of
        const out = ctx.exitPoint(hit.collider, end, d, pen);
        if (!out) break;
        ctx.gore.bulletHole(out, d);
        ctx.gore.sparks(out, d, 3);
        from = out;
        dmg *= 0.6;
      }
      if (!w.bolt && (i < 3 || w.pellets === 1)) this.tracer(muzzle, first || end);
    }
    const can = this.can[this.index];
    ctx.soundAt = null;                   // (the shot is heard from the gun, not from where the round landed)
    if (can) sfx.suppressed(); else sfx[w.sound]();
    if (!w.bolt) {                                // a puff of smoke out of the muzzle, not a fireball
      for (let k = 0; k < 2; k++) {
        ctx.gore.smoke.emit(muzzle.x + fwd.x * 0.12, muzzle.y + fwd.y * 0.12, muzzle.z + fwd.z * 0.12, fwd.x * rnd(0.3, 1) + rnd(-0.15, 0.15), fwd.y * rnd(0.3, 1) + rnd(0.05, 0.3), fwd.z * rnd(0.3, 1) + rnd(-0.15, 0.15),
          rnd(0.035, 0.065) * (can ? 1.4 : 1), rnd(0.5, 1.1), -0.15, 0.3, 0.3, 0.3, 0, 3);
      }
    }
    if (w.shell && (!w.auto || Math.random() < 0.5)) sfx.shell();
    if (w.shell && !w.shells) {                  // the spent case flies out to the right
      const p = muzzle.clone().addScaledVector(fwd, -0.3).addScaledVector(up, 0.03), s = rnd(2, 3.2);
      ctx.gore.drops.emit(p.x, p.y, p.z, right.x * s + up.x * 1.5, right.y * s + up.y * 1.5 + 1, right.z * s + up.z * 1.5,
        0.009, 1.1, 11, 0.75, 0.55, 0.2, 2);
    }
    this.kick = w.kick * 1.3;
    this.kickSide = (Math.random() - 0.5) * 2.6 * w.kick;
    if (can) ctx.alert('shot', ctx.player.pos, 9);      // quieter, not silent
    else if (!w.quiet) {
      deafen(0.04 + w.kick * 0.5, true);
      ctx.alert('shot', ctx.player.pos, 40);
      this.fireFlash(muzzle, fwd, (0.14 + w.kick * 1.3) * (w.pellets > 1 ? 1.25 : 1), true);
    }
    // recoil: up, and a little to one side or the other; less with the stock in your shoulder
    const rec = w.rec || [w.kick * 0.25, 0];
    const hold = RECOIL * (1 - 0.3 * this.ads);
    ctx.player.recoil(rec[0] * hold * rnd(0.85, 1.15), rec[1] * hold * (rnd(-1, 1) + (w.drift || 0) * 2));
    this.bloom = Math.min(1.5, this.bloom + rec[0] * 9);
    this.spend(w);
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
    this.spend(w);
  }

  /**
   * Knife: left button slices (a quick sideways cut that opens a gash), right button stabs
   * (a thrust: slower, shorter, deeper).
   */
  updateKnife(input, w) {
    if (this.cool > 0) return;
    const stab = input.rightDown, slice = !stab && input.left;
    if (!stab && !slice) return;
    const ctx = this.ctx, k = stab ? w.stab : w.slice;
    this.cool = k.rate;
    if (stab) this.thrust = 0.24; else this.swing = 0.28;
    sfx.slash();
    this.aim();
    const origin = _o.clone(), fwd = _d.clone(), right = _r.clone();
    // a slice travels across the target (right to left), so the cut it leaves runs that way too
    const travel = stab ? fwd : fwd.clone().multiplyScalar(0.55).addScaledVector(right, -0.85).normalize();
    for (const ox of stab ? [0] : [0, 0.14, -0.14]) {
      const d = fwd.clone().addScaledVector(right, ox).normalize();
      const hit = ctx.raycast(origin, d, k.range);
      if (!hit) continue;
      const pt = origin.clone().addScaledVector(d, hit.timeOfImpact);
      ctx.applyHit(hit, pt, travel, k.dmg, k.impulse, stab ? { stab: true, melee: true } : { blade: true, light: true });
      if (ctx.owners.get(hit.collider.handle)?.kind === 'part') { sfx.chop(); ctx.alert('violence', ctx.player.pos, 12); }
      break;
    }
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
  /** Pepper spray: a short cone of it, and anyone in it is no use for a few seconds. */
  updateSpray(dt, input, w) {
    if (!input.left || !this.ready(w, input.leftDown)) return;
    const ctx = this.ctx, smoke = ctx.gore.smoke;
    this.aim();
    const origin = _o.clone(), fwd = _d.clone(), right = _r.clone(), up = _u.clone();
    const m = this.muzzlePoint(new THREE.Vector3());
    for (let i = 0; i < 2; i++) {
      const s = rnd(5, 8);
      smoke.emit(m.x, m.y, m.z, fwd.x * s + right.x * rnd(-0.6, 0.6) + up.x * rnd(-0.4, 0.4), fwd.y * s + rnd(-0.4, 0.4), fwd.z * s + right.z * rnd(-0.6, 0.6) + up.z * rnd(-0.4, 0.4),
        rnd(0.04, 0.09), rnd(0.5, 0.9), -0.3, 0.95, 0.7, 0.35, 0, 2.5);
    }
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = 0.08;
    this.ammo[this.index]--;
    sfx.spray();
    for (const r of ctx.ragdolls) {
      if (r.removed || r.dead) continue;
      const c = r.center(_m).sub(origin);
      const dist = c.length();
      if (dist > w.range || c.dot(fwd) / dist < 0.9 || !r.brain.los(origin)) continue;   // in the cone, and nothing between
      r.brain.flashed = Math.max(r.brain.flashed || 0, 3.5);
      r.lessLethal = true;
      r.flinchT = r.flinchT || 0.2;
    }
    ctx.alert('violence', ctx.player.pos, 6);
  }

  updateFlame(dt, input, w) {
    if (!input.left || !this.ready(w, input.leftDown)) return;
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
    this.ammo[this.index]--;                 // fuel
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

  launchDrone() {
    const ctx = this.ctx;
    this.aim();
    const d = ctx.spawnProp('rocket', _o.clone().addScaledVector(_d, 1.0));
    d.drone = true;
    d.mesh.visible = false;                       // you are looking out of it
    d.launch(_d, 13);
    d.body.setGravityScale(0, true);
    d.life = 40;                                  // battery
    ctx.drone = d;
    sfx.tick();
    ctx.toast('DRONE: MOUSE STEERS - SHIFT FAST - CLICK DETONATES');
  }

  throwGrenade(type = 'grenade') {
    const ctx = this.ctx;
    this.aim();
    const p = _o.clone().addScaledVector(_d, 0.9).addScaledVector(_u, -0.1);
    const g = ctx.spawnProp(type, p);
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
    if (ctx.world.getRigidBody(g.body.handle) !== g.body) { this.releaseGrab(); return; }     // (the same body: its slot may hold a new one)
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
    const twist = this.kick > 0 ? this.kickSide * (1 - 0.6 * a) : 0;
    this.rig.rotation.set(this.kick * (2.2 - 1.4 * a) + s * 0.4, s * 0.9 + twist * 0.9, s * -0.8 + (1 - a) * -0.03 + twist * 1.6);
    const run = this.sprintK * this.sprintK * (3 - 2 * this.sprintK);
    if (run > 0.01) {                            // sprinting: carried low and across the body
      this.rig.position.x -= 0.06 * run; this.rig.position.y -= 0.08 * run;
      this.rig.rotation.x -= 0.55 * run; this.rig.rotation.y += 0.6 * run; this.rig.rotation.z += 0.25 * run;
    }
    if (this.busy > 0.01) {                      // reloading or clearing a jam: the weapon comes down and tips over
      const b = this.busy * this.busy * (3 - 2 * this.busy);
      this.rig.position.y -= 0.16 * b;
      this.rig.position.x -= 0.03 * b;
      this.rig.rotation.x += 0.45 * b;
      this.rig.rotation.z += 0.5 * b;
    }
    // the off hand: down out of the picture for a magazine, back up with it, and onto the gun again
    const u = this.models[this.index].userData;
    if (u.off) {
      const w = this.current;
      const t = this.reloadT > 0 && w.reload && !w.shells ? 1 - this.reloadT / (this.topped ? w.reload : w.reload * 1.3) : -1;
      const k = t < 0 ? 0 : t < 0.4 ? t / 0.4 : t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;   // how far from the gun the hand is
      const e = k * k * (3 - 2 * k);
      u.off.position.set(u.rest.x - 0.12 * e, u.rest.y - 0.3 * e, u.rest.z + 0.18 * e);
      u.off.rotation.x = (this.view.handL || this.view.handS || [0, 0, 0, 0])[3] + 0.9 * e;
      u.mag.visible = t >= 0.35 && t < 0.8;        // comes up in the hand, goes in at the top of the stroke
    }
    if (this.thrust > 0) {                       // a stab: straight out toward the middle of the view and back
      const t = Math.sin((1 - this.thrust / 0.24) * Math.PI);
      this.rig.position.x -= 0.12 * t;
      this.rig.position.y += 0.05 * t;
      this.rig.position.z -= 0.3 * t;
      this.rig.rotation.y += 0.25 * t;
    }
  }

  update(dt, input) {
    this.ctx.soundAt = null;              // (co-op: what this player's weapons sound like comes from where they stand)
    const w = this.current;
    const pl = this.ctx.player;
    this.sprintK = (this.sprintK || 0) + ((pl.sprinting ? 1 : 0) - (this.sprintK || 0)) * Math.min(1, dt * 9);
    this.cool -= dt;
    this.tickAmmo(dt);

    if (input.wheel !== 0 && !this.grab) {
      // the next weapon along that can be picked up
      const d = input.wheel > 0 ? 1 : -1;
      let i = this.index;
      for (let k = 0; k < WEAPONS.length; k++) { i = (i + d + WEAPONS.length) % WEAPONS.length; if (!this.allowed || this.allowed.has(i)) break; }
      this.select(i);
    }

    // right mouse: aim down the sights (guns only; the grab gun uses it to throw)
    const wantAds = (w.type === 'gun' || w.type === 'rocket') && !w.hipOnly && input.right && this.busy < 0.3 ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 11);
    if (Math.abs(wantAds - this.ads) < 0.002) this.ads = wantAds;

    // scoped weapons swap the viewmodel for a scope picture once fully aimed
    const scoped = !!this.view.scope && this.ads > 0.85;
    this.rig.visible = !scoped;
    document.body.classList.toggle('scoped', scoped);

    if (this.ctx.drone) {
      if (input.leftDown) this.ctx.drone.life = 0;          // flying: the trigger sets it off
    } else if (w.type === 'knife') {
      this.updateKnife(input, w);
    } else if (w.type === 'grab') {
      this.updateGrab(dt, input);
    } else if (w.type === 'tool') {
      this.aim();
      if (input.leftDown) this.ctx.tools.use(w.tool, _o, _d);
      else if (input.rightDown) this.ctx.tools.unlink(_o, _d);
    } else if (w.type === 'saw') {
      this.updateSaw(dt, input, w);
    } else if (w.type === 'flame') {
      this.updateFlame(dt, input, w);
    } else if (w.type === 'spray') {
      this.updateSpray(dt, input, w);
    } else if (w.spin && this.spin < 1) {
      // the barrels have to come up to speed before anything leaves them
      const was = this.spin;
      this.spin = input.left ? Math.min(1, this.spin + dt / w.spin) : Math.max(0, this.spin - dt * 2);
      if (input.left && Math.floor(was * 6) !== Math.floor(this.spin * 6)) sfx.whirr(this.spin);
    } else if (this.cool <= 0) {
      if (w.spin && !input.left) this.spin = 0.99;      // let go: they start to wind down
      const trigger = w.auto && !this.single[this.index] ? input.left : input.leftDown;
      if (trigger && this.sprintK < 0.3 && this.ready(w, input.leftDown)) {
        this.cool = w.rate;
        if (w.type === 'gun') this.fireGun(w);
        else if (w.type === 'melee') this.fireMelee(w);
        else if (w.type === 'grenade') this.throwGrenade(w.prop);
        else if (w.type === 'rocket') this.fireRocket(w);
        else if (w.type === 'drone') this.launchDrone();
      }
    }

    // viewmodel animation
    this.kick = Math.max(0, this.kick - dt * 1.2);
    this.bloom = Math.max(0, this.bloom - dt * 2.6);
    this.swing = Math.max(0, this.swing - dt);
    this.thrust = Math.max(0, this.thrust - dt);
    const s = this.swing > 0 ? Math.sin((1 - this.swing / 0.28) * Math.PI) : 0;
    this.placeRig(s);

    // the weapon trails the mouse a little, and (helmet cam) leads the lagging camera
    const k = (1 - 0.75 * this.ads);
    this.swayYaw = THREE.MathUtils.clamp(this.swayYaw - (input.mx || 0) * 0.0007 * k, -0.07, 0.07);
    this.swayPitch = THREE.MathUtils.clamp(this.swayPitch - (input.my || 0) * 0.0007 * k, -0.07, 0.07);
    const decay = Math.exp(-dt * 9);
    this.swayYaw *= decay; this.swayPitch *= decay;
    this.pivot.rotation.set(pl.aimOff.pitch + this.swayPitch, pl.aimOff.yaw + this.swayYaw, 0);
    this.updateLaser();

    if (this.muzzleT > 0) {
      if (this.flashFollow) {
        const m = this.models[this.index];
        this.muzzlePoint(this.flash.position);
        this.flash.quaternion.copy(m.getWorldQuaternion(_q));
      }
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

/**
 * A muzzle flash: two crossed flames along the barrel and a star facing the camera, all additive and brighter than
 * white so the bloom catches them. Drawn once on canvases; one length unit = one flash length (fireFlash scales it).
 */
function muzzleFlash() {
  const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return new THREE.CanvasTexture(c); };
  const side = canvas(128, 32, (g, w, h) => {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {                  // overlapping tongues of different lengths: a ragged flame
      const len = w * rnd(0.45, 1), th = h * rnd(0.18, 0.42);
      const gr = g.createLinearGradient(0, 0, len, 0);
      gr.addColorStop(0, 'rgba(255,250,225,0.8)'); gr.addColorStop(0.35, 'rgba(255,190,90,0.55)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(len / 2, h / 2 + rnd(-2, 2), len / 2, th / 2, 0, 0, Math.PI * 2); g.fill();
    }
  });
  const star = canvas(64, 64, (g, w) => {
    g.globalCompositeOperation = 'lighter';
    g.translate(w / 2, w / 2);
    for (let i = 0; i < 7; i++) {                  // spikes
      g.rotate(Math.PI * 2 / 7 + rnd(-0.2, 0.2));
      const r = w / 2 * rnd(0.6, 1);
      const gr = g.createLinearGradient(0, 0, r, 0);
      gr.addColorStop(0, 'rgba(255,230,170,0.9)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -3); g.lineTo(r, 0); g.lineTo(0, 3); g.fill();
    }
    const core = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.22);
    core.addColorStop(0, 'rgba(255,255,240,1)'); core.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = core; g.fillRect(-w / 2, -w / 2, w, w);
  });
  const hot = new THREE.Color(4, 2.6, 1.2);
  const mat = new THREE.MeshBasicMaterial({ map: side, color: hot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const plane = new THREE.PlaneGeometry(1, 0.3).translate(0.5, 0, 0).rotateY(Math.PI / 2);   // base at the muzzle, out along -z
  const g = new THREE.Group();
  g.add(new THREE.Mesh(plane, mat), new THREE.Mesh(plane.clone().rotateZ(Math.PI / 2), mat));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, color: hot, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(0.55);
  g.add(s);
  g.visible = false;
  return g;
}

/** Magazine guns with a closed bolt keep a round in the chamber through a reload (30+1). */
function chamber(w) { return w.type === 'gun' && !!w.shell && !w.shells && !w.spin && w.mag > 2; }
