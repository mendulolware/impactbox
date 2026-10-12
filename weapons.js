import * as THREE from 'three';
import { sfx } from './audio.js';
import { getModel } from './models.js';

// model names in assets/models.glb, in the same order as WEAPONS
const VIEWMODELS = ['Pistol', 'Shotgun', 'Rifle', 'Machete', 'Grenade', 'GrabGun'];

export const WEAPONS = [
  { name: 'Pistol',   type: 'gun',     auto: false, rate: 0.20,  dmg: 34, impulse: 140, pellets: 1,  spread: 0.003, sound: 'pistol',  kick: 0.07 },
  { name: 'Shotgun',  type: 'gun',     auto: false, rate: 0.85,  dmg: 15, impulse: 110, pellets: 10, spread: 0.055, sound: 'shotgun', kick: 0.16 },
  { name: 'Rifle',    type: 'gun',     auto: true,  rate: 0.075, dmg: 17, impulse: 95,  pellets: 1,  spread: 0.010, sound: 'rifle',   kick: 0.035 },
  { name: 'Machete',  type: 'melee',   auto: true,  rate: 0.40,  dmg: 48, impulse: 220, range: 2.7 },
  { name: 'Grenade',  type: 'grenade', auto: false, rate: 0.7 },
  { name: 'Grab Gun', type: 'grab' },
];

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Quaternion();

function box(w, h, d, color, x = 0, y = 0, z = 0, metal = 0.15) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: metal })
  );
  m.position.set(x, y, z);
  return m;
}

function buildViewmodels() {
  const g = [];

  const pistol = new THREE.Group();
  pistol.add(box(0.05, 0.07, 0.30, 0x4a4a52, 0, 0, 0));
  pistol.add(box(0.045, 0.12, 0.07, 0x35353c, 0, -0.08, 0.1, 0.1));
  g.push(pistol);

  const shotgun = new THREE.Group();
  shotgun.add(box(0.05, 0.06, 0.75, 0x55555e, 0, 0, -0.1));
  shotgun.add(box(0.07, 0.07, 0.30, 0x6a4a2a, 0, -0.01, 0.35, 0.1));
  shotgun.add(box(0.06, 0.045, 0.26, 0x6a4a2a, 0, -0.045, -0.15, 0.1));
  g.push(shotgun);

  const rifle = new THREE.Group();
  rifle.add(box(0.055, 0.08, 0.62, 0x2d3a2d, 0, 0, 0));
  rifle.add(box(0.03, 0.03, 0.30, 0x333333, 0, 0.01, -0.45));
  rifle.add(box(0.05, 0.16, 0.08, 0x3a3a3a, 0, -0.12, 0.05, 0.2));
  rifle.add(box(0.06, 0.09, 0.24, 0x2d3a2d, 0, -0.01, 0.40, 0.1));
  g.push(rifle);

  const machete = new THREE.Group();
  machete.add(box(0.035, 0.035, 0.18, 0x222222, 0, 0, 0.1, 0.1));
  machete.add(box(0.012, 0.085, 0.62, 0xc8ccd0, 0, 0.0, -0.32, 0.9));
  g.push(machete);

  const gren = new THREE.Group();
  gren.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.6 })));
  gren.add(box(0.02, 0.05, 0.02, 0x999999, 0, 0.07, 0));
  g.push(gren);

  const grab = new THREE.Group();
  grab.add(box(0.07, 0.07, 0.5, 0x3a4a6a, 0, 0, -0.1));
  grab.add(box(0.1, 0.1, 0.12, 0x66ccff, 0, 0, -0.4, 0.2));
  g.push(grab);

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

    // Blender viewmodels where available, box placeholders otherwise
    const placeholders = buildViewmodels();
    this.models = VIEWMODELS.map((name, i) => getModel(name, null, false) || placeholders[i]);
    this.rig = new THREE.Group();
    this.rig.position.set(0.24, -0.22, -0.5);
    this.rig.scale.setScalar(0.8);
    this.models.forEach((m, i) => { m.visible = i === 0; this.rig.add(m); });
    ctx.camera.add(this.rig);

    this.muzzle = new THREE.PointLight(0xffc070, 0, 8, 2);
    this.muzzle.position.set(0.24, -0.15, -1.0);
    ctx.camera.add(this.muzzle);
    this.muzzleT = 0;

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
  }

  get current() { return WEAPONS[this.index]; }

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
    this.refreshBar();
    sfx.pop();
  }

  releaseGrab() {
    this.grab = null;
    this.beam.visible = false;
    document.getElementById('crosshair').classList.remove('grab');
  }

  // ---- helpers
  aim() {
    const cam = this.ctx.camera;
    cam.getWorldPosition(_o);
    cam.getWorldDirection(_d);
    _q.copy(cam.quaternion);
    _r.set(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(_q));
    _u.set(0, 1, 0).applyQuaternion(_q);
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
    const muzzle = origin.clone().addScaledVector(right, 0.24).addScaledVector(up, -0.15).addScaledVector(fwd, 1.0);

    for (let i = 0; i < w.pellets; i++) {
      const d = fwd.clone()
        .addScaledVector(right, (Math.random() - 0.5) * 2 * w.spread)
        .addScaledVector(up, (Math.random() - 0.5) * 2 * w.spread)
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
    this.muzzle.intensity = 25;
    this.muzzleT = 0.05;
    ctx.player.recoil(w.kick * 0.6);
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

    // beam
    const pos = this.beam.geometry.attributes.position;
    _m.copy(_o).addScaledVector(_r, 0.24).addScaledVector(_u, -0.15).addScaledVector(_d, 0.9);
    pos.setXYZ(0, _m.x, _m.y, _m.z);
    pos.setXYZ(1, gp.x, gp.y, gp.z);
    pos.needsUpdate = true;
    this.beam.visible = true;

    if (input.rightDown) {
      const m = g.body.mass();
      g.body.applyImpulse({ x: _d.x * m * 24, y: _d.y * m * 24 + m * 2, z: _d.z * m * 24 }, true);
      this.releaseGrab();
      sfx.slash();
    }
  }

  update(dt, input) {
    const w = this.current;
    this.cool -= dt;

    if (input.wheel !== 0 && !this.grab) {
      this.select(this.index + (input.wheel > 0 ? 1 : -1));
    }

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
    const bob = this.ctx.player.bob;
    this.rig.position.set(0.24 + s * -0.2, -0.22 + Math.sin(bob * 2) * 0.006 - s * 0.05, -0.5 + this.kick * 1.4);
    this.rig.rotation.set(this.kick * 2.2 + s * 0.4, s * 0.9, s * -0.8);

    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) this.muzzle.intensity = 0;
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
