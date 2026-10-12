import * as THREE from 'three';
import { sfx } from './audio.js';
import { getModel } from './models.js';

export const WEAPONS = [
  { name: 'Pistol',   type: 'gun',     auto: false, rate: 0.20,  dmg: 34, impulse: 140, pellets: 1,  spread: 0.003, sound: 'pistol',  kick: 0.07 },
  { name: 'Shotgun',  type: 'gun',     auto: false, rate: 0.85,  dmg: 15, impulse: 110, pellets: 10, spread: 0.055, sound: 'shotgun', kick: 0.16 },
  { name: 'Rifle',    type: 'gun',     auto: true,  rate: 0.075, dmg: 17, impulse: 95,  pellets: 1,  spread: 0.010, sound: 'rifle',   kick: 0.035 },
  { name: 'Machete',  type: 'melee',   auto: true,  rate: 0.40,  dmg: 48, impulse: 220, range: 2.7 },
  { name: 'Grenade',  type: 'grenade', auto: false, rate: 0.7 },
  { name: 'Grab Gun', type: 'grab' },
];

// How each weapon sits in first person, in the same order as WEAPONS. All positions are in the
// weapon model's own space (three.js axes: -Z is down the barrel), in metres before RIG_SCALE.
//   model  - name in assets/models.glb
//   hip    - where the rig sits when not aiming
//   sight  - height of the sight line above the model origin; aiming puts it on the screen centre
//   adsZ   - how far in front of the eye the weapon is held while aiming
//   muzzle - where tracers and the flash come from
//   handR / handL - [x, y, z, pitch] for the gripping / supporting hand
const RIG_SCALE = 0.8;
const HELMET_DROP = 0.1;   // how far the eyes are below the helmet camera (matches player.js)
const VIEW = [
  { model: 'Pistol',  hip: [0.19, -0.19, -0.50], sight: 0.053, adsZ: -0.42, muzzle: [0, 0.031, -0.118],
    handR: [0, -0.046, 0.058, -0.25], handL: [0, -0.115, 0.08, -0.25] },
  { model: 'Shotgun', hip: [0.19, -0.2, -0.42], sight: 0.041, adsZ: -0.44, muzzle: [0, 0.016, -0.63],
    handR: [0, -0.04, 0.135, -0.7], handL: [0, -0.034, -0.27, 0] },
  { model: 'Rifle',   hip: [0.19, -0.2, -0.42], sight: 0.067, adsZ: -0.44, muzzle: [0, 0.006, -0.665],
    handR: [0, -0.072, 0.095, -0.3], handL: [0, -0.024, -0.235, 0] },
  { model: 'Machete', hip: [0.3, -0.3, -0.5], melee: true },
  { model: 'Grenade', hip: [0.28, -0.3, -0.5], held: true },
  { model: 'GrabGun', hip: [0.21, -0.22, -0.45], muzzle: [0, 0.005, -0.37],
    handR: [0, -0.088, 0.1, -0.25], handL: [0, -0.036, -0.08, 0] },
];

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Quaternion();

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
  if (v.melee) {
    // fist at the origin, blade standing up out of it and tipped forward
    model.rotation.x = Math.PI / 2;
    g.add(model);
    const h = hand('HandR', [0, 0, 0, 0]);
    if (h) g.add(h);
    g.rotation.x = -0.9;
  } else if (v.held) {
    model.position.set(-0.004, 0.03, 0);
    g.add(model);
    const h = hand('HandR', [0, 0, 0, 0]);
    if (h) g.add(h);
  } else {
    g.add(model);
    const r = v.handR && hand('HandR', v.handR);
    const l = v.handL && hand('HandL', v.handL);
    if (r) g.add(r);
    if (l) g.add(l);
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

  buildBar() {
    const bar = document.getElementById('weapon-bar');
    bar.innerHTML = '';
    this.slots = WEAPONS.map((w, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<b>${i + 1}</b>${w.name}`;
      bar.appendChild(el);
      return el;
    });
    this.refreshBar();
  }

  refreshBar() {
    this.slots.forEach((s, i) => s.classList.toggle('on', i === this.index));
  }

  select(i) {
    i = (i + WEAPONS.length) % WEAPONS.length;
    if (i === this.index) return;
    this.releaseGrab();
    this.index = i;
    this.models.forEach((m, k) => (m.visible = k === i));
    this.cool = 0.12;
    this.ads = 0;
    this.refreshBar();
    sfx.pop();
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
      const hit = ctx.raycast(origin, d, 300);
      let end;
      if (hit) {
        end = origin.clone().addScaledVector(d, hit.timeOfImpact);
        ctx.applyHit(hit, end, d, w.dmg, w.impulse, {});
      } else {
        end = origin.clone().addScaledVector(d, 120);
      }
      if (i < 3 || w.pellets === 1) this.tracer(muzzle, end);
    }
    sfx[w.sound]();
    this.kick = w.kick;
    this.muzzle.position.copy(muzzle);
    this.muzzle.intensity = 30;
    this.flash.position.copy(muzzle).addScaledVector(fwd, 0.06);
    this.flash.scale.setScalar(0.05 + w.kick * 0.5 + Math.random() * 0.03);
    this.flash.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.flash.visible = true;
    this.muzzleT = 0.05;
    ctx.player.recoil(w.kick * (0.6 - 0.2 * this.ads));
  }

  fireMelee(w) {
    const ctx = this.ctx;
    this.aim();
    const origin = _o.clone();
    const fwd = _d.clone();
    const right = _r.clone();
    const up = _u.clone();
    sfx.slash();
    this.swing = 0.28;

    const seen = new Set();
    const offsets = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.22], [0, -0.22], [0.5, 0.1], [-0.5, 0.1]];
    let hitSomething = false;
    for (const [ox, oy] of offsets) {
      const d = fwd.clone().addScaledVector(right, ox).addScaledVector(up, oy).normalize();
      const hit = ctx.raycast(origin, d, w.range);
      if (!hit) continue;
      const h = hit.collider.handle;
      if (seen.has(h)) continue;
      seen.add(h);
      const pt = origin.clone().addScaledVector(d, hit.timeOfImpact);
      ctx.applyHit(hit, pt, d, w.dmg, w.impulse, { blade: true });
      hitSomething = true;
    }
    if (hitSomething) { sfx.chop(); ctx.player.recoil(0.02); }
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
    const wantAds = w.type === 'gun' && input.right ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 11);
    if (Math.abs(wantAds - this.ads) < 0.002) this.ads = wantAds;

    if (w.type === 'grab') {
      this.updateGrab(dt, input);
    } else if (this.cool <= 0) {
      const trigger = w.auto ? input.left : input.leftDown;
      if (trigger) {
        this.cool = w.rate;
        if (w.type === 'gun') this.fireGun(w);
        else if (w.type === 'melee') this.fireMelee(w);
        else if (w.type === 'grenade') this.throwGrenade();
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
    this.pivot.rotation.set(pl.aimOff.pitch + this.swayPitch, pl.aimOff.yaw + this.swayYaw, 0);

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
