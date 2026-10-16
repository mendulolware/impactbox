import * as THREE from 'three';
import { sfx } from './audio.js';

// Gadgets (the Gear group in weapons.js):
//   black hole  a grenade (props.js, 'singularity') that, when its fuse runs out, opens a hole that pulls in everything
//               within 10 m for four seconds, takes apart whatever reaches the middle, and goes off as it closes
//   sticky C4   left button throws a charge that sticks to whatever it hits (a wall, a prop, someone, and goes where
//               they go); right button sets every one of them off
//   mine        left button puts one down on the floor where you look; armed a moment later, it jumps up and goes off
//               when someone comes within reach
// Everything here is the host's (in co-op what they do to bodies and props reaches the other player as usual).

const rnd = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const HOLE_R = 10, HOLE_LIFE = 4;
const PURPLE = new THREE.Color(1.4, 0.35, 2.6);

export class Devices {
  constructor(ctx) {
    this.ctx = ctx;
    this.holes = [];
    this.charges = [];       // { mesh, led, v, flying }
    this.mines = [];         // { mesh, led, p, t, armed, fired }
    this.ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.1), toneMapped: false });
    this.c4Mat = new THREE.MeshStandardMaterial({ color: 0xcdbb8a, roughness: 0.9 });
    this.mineMat = new THREE.MeshStandardMaterial({ color: 0x3d4630, roughness: 0.6, metalness: 0.4 });
  }

  // ---------------------------------------------------------------- the black hole
  blackHole(p) {
    const ctx = this.ctx, g = new THREE.Group();
    g.position.set(p.x, p.y + 0.6, p.z);
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const disk = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.18, 8, 48).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: PURPLE, toneMapped: false, transparent: true, opacity: 0.85 }));
    g.add(core, disk);
    g.scale.setScalar(0.01);
    ctx.scene.add(g);
    this.holes.push({ g, core, disk, t: 0 });
    sfx.hole();
    ctx.alert('explosion', g.position, 40);
  }

  updateHoles(dt) {
    const ctx = this.ctx;
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i], c = h.g.position;
      h.t += dt;
      const grow = Math.min(1, h.t / 0.4) * (h.t > HOLE_LIFE - 0.3 ? Math.max(0, (HOLE_LIFE - h.t) / 0.3) : 1);
      h.g.scale.setScalar(0.32 * grow + 0.01);
      h.disk.rotation.y += dt * 6;
      h.disk.material.opacity = 0.5 + 0.4 * Math.sin(h.t * 30);
      if (h.t >= HOLE_LIFE) {
        ctx.scene.remove(h.g);
        h.core.geometry.dispose(); h.disk.geometry.dispose(); h.core.material.dispose(); h.disk.material.dispose();
        this.holes.splice(i, 1);
        ctx.explode({ x: c.x, y: c.y, z: c.z }, 5, 0.8);          // and what is left is thrown out as it closes
        continue;
      }
      // Everything in reach is steered toward the middle, faster the closer it is, and swung round it. (Steered, not pushed:
      // pushed, a body races through the middle, swings out the far side and is flung clear.)
      const want = (d) => Math.min(16, 2.5 + 30 / Math.max(0.5, d)) * grow;      // m/s
      const k = Math.min(1, dt * 5);
      const steer = (body, d, lift = 1) => {
        _v.multiplyScalar(1 / d);
        _w.set(-_v.z, 0, _v.x);
        const s = want(d), lv = body.linvel();
        body.setLinvel({ x: lv.x + (_v.x * s + _w.x * s * 0.35 - lv.x) * k, y: lv.y + (_v.y * s + lift - lv.y) * k, z: lv.z + (_v.z * s + _w.z * s * 0.35 - lv.z) * k }, true);
      };
      // people: pulled in and spun round it; what reaches the middle is taken apart
      for (const r of ctx.ragdolls) {
        if (r.removed || r.puppet) continue;
        let near = false;
        for (const n in r.parts) {
          const p = r.parts[n];
          if (p.gone) continue;
          const t = p.body.translation();
          _v.set(c.x - t.x, c.y - t.y, c.z - t.z);
          const d = _v.length();
          if (d > HOLE_R) continue;
          near = true;
          if (d < 0.6) { r.gib(n, Math.random() < 0.3); continue; }
          if (p.body.isDynamic()) steer(p.body, d);
        }
        if (near && r.mode !== 'ragdoll') r.goLimp(3);
      }
      for (const p of ctx.props) {
        if (p.removed || !p.body.isDynamic()) continue;
        const t = p.body.translation();
        _v.set(c.x - t.x, c.y - t.y, c.z - t.z);
        const d = _v.length();
        if (d > HOLE_R) continue;
        if (d < 0.6) { p.hit(400, new THREE.Vector3(t.x, t.y, t.z), _v.clone().normalize(), 0, {}); if (!p.removed && p.hp === Infinity) p.remove(); continue; }
        steer(p.body, d);
      }
      for (const ch of ctx.gore.chunkList) {
        if (ch.stuck) continue;
        const t = ch.body.translation();
        _v.set(c.x - t.x, c.y - t.y, c.z - t.z);
        const d = _v.length();
        if (d > HOLE_R || d < 0.05) continue;
        if (ch.body.isDynamic()) steer(ch.body, d, 0);
      }
      // you: dragged toward it, and hurt if you get too close
      const pl = ctx.player;
      if (!pl.dead) {
        _v.set(c.x - pl.pos.x, c.y - pl.pos.y, c.z - pl.pos.z);
        const d = _v.length();
        if (d < HOLE_R) {
          pl.vel.addScaledVector(_v.multiplyScalar(1 / d), want(d) * 1.6 * dt);     // (you can run against it, just)
          pl.grounded = false;
          if (d < 1.4 && (h.hurtT = (h.hurtT || 0) - dt) <= 0) { h.hurtT = 0.3; pl.hurt(12, null); }
        }
      }
      // the light it bends: sparks drawn in round it
      for (let k = 0; k < 3; k++) {
        const a = rnd(0, 6.283), rr = rnd(1.5, 4);
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr, y = c.y + rnd(-1, 1);
        ctx.gore.fire.emit(x, y, z, (c.x - x) * 1.6 - Math.sin(a) * 2, (c.y - y) * 1.6, (c.z - z) * 1.6 + Math.cos(a) * 2, rnd(0.03, 0.07), 0.5, 0, 0.7, 0.25, 1.0, 0, 1);
      }
    }
  }

  // ---------------------------------------------------------------- sticky C4
  /** Throw a charge from `o` along `d`: it sticks to the first thing it hits. */
  throwC4(o, d, carry) {
    const ctx = this.ctx;
    if (this.charges.length >= 6) { ctx.toast('SIX CHARGES OUT - RIGHT CLICK TO SET THEM OFF'); return; }
    const mesh = new THREE.Group();
    const brick = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.08), this.c4Mat);
    brick.castShadow = true;
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.012, 0.015), this.ledMat);
    led.position.set(0.04, 0.031, 0);
    mesh.add(brick, led);
    mesh.position.copy(o).addScaledVector(d, 0.6);
    ctx.scene.add(mesh);
    this.charges.push({ mesh, led, v: d.clone().multiplyScalar(13).add(carry), flying: true, t: 0 });
    sfx.slash();
  }

  /** Right button: every charge goes off where it is now (stuck to a body, it is wherever that body went). */
  detonate() {
    const ctx = this.ctx;
    if (!this.charges.length) return;
    const list = this.charges.splice(0);
    sfx.tick();
    for (const c of list) {
      const p = c.mesh.getWorldPosition(new THREE.Vector3());
      c.mesh.removeFromParent();
      ctx.explode(p, 6, 1.1);
    }
  }

  updateCharges(dt) {
    const ctx = this.ctx;
    for (const c of this.charges) {
      c.t += dt;
      c.led.visible = Math.sin(c.t * 9) > 0;
      if (!c.flying) continue;
      c.v.y -= 9.81 * dt;
      const sp = c.v.length();
      _v.copy(c.v).multiplyScalar(1 / sp);
      const hit = ctx.raycast(c.mesh.position, _v, sp * dt + 0.05);
      if (!hit) { c.mesh.position.addScaledVector(c.v, dt); c.mesh.rotation.x += dt * 8; continue; }
      // stuck: flat on the face it hit, and from now on it goes where that thing goes
      const o = ctx.owners.get(hit.collider.handle);
      const pt = c.mesh.position.clone().addScaledVector(_v, hit.timeOfImpact);
      const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      const part = o?.kind === 'part' ? o.ragdoll.parts[o.name] : null;
      const parent = part ? (part.gone ? ctx.scene : part.mesh) : o?.kind === 'prop' ? o.prop.mesh : ctx.scene;
      c.mesh.position.copy(pt).addScaledVector(n, 0.025);
      c.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      c.mesh.updateMatrixWorld(true);
      parent.updateMatrixWorld(true);
      parent.attach(c.mesh);
      c.flying = false;
      sfx.thud(0.4);
    }
  }

  // ---------------------------------------------------------------- mines
  /** Put a mine on the floor where the ray from `o` along `d` meets it (within 5 m). */
  placeMine(o, d) {
    const ctx = this.ctx;
    const hit = ctx.raycast(o, d, 5);
    if (!hit || hit.normal.y < 0.6 || ctx.owners.get(hit.collider.handle)?.kind === 'part') { ctx.toast('A MINE GOES ON THE FLOOR'); return; }
    if (this.mines.length >= 10) { const m = this.mines.shift(); m.mesh.removeFromParent(); }
    const p = o.clone().addScaledVector(d, hit.timeOfImpact);
    const mesh = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.05, 16), this.mineMat);
    disc.castShadow = disc.receiveShadow = true;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), this.ledMat);
    led.position.y = 0.03;
    mesh.add(disc, led);
    mesh.position.copy(p).add(_v.set(0, 0.025, 0));
    ctx.scene.add(mesh);
    this.mines.push({ mesh, led, p, t: 0, fired: -1 });
    sfx.tick();
  }

  updateMines(dt) {
    const ctx = this.ctx;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.t += dt;
      const armed = m.t > 1.5;
      m.led.visible = armed ? Math.sin(m.t * 6) > 0.6 : Math.sin(m.t * 25) > 0;
      if (m.fired >= 0) {
        // it jumps to waist height, then goes off
        m.fired += dt;
        m.mesh.position.y = m.p.y + 0.025 + Math.min(1, m.fired / 0.3) * 0.9;
        if (m.fired >= 0.3) {
          this.mines.splice(i, 1);
          m.mesh.removeFromParent();
          ctx.explode(m.mesh.position.clone(), 5.5, 1.1);
        }
        continue;
      }
      if (!armed) continue;
      for (const r of ctx.ragdolls) {
        if (r.removed || r.puppet) continue;
        const t = r.parts.pelvis.gone ? null : r.parts.pelvis.body.translation();
        if (t && Math.hypot(t.x - m.p.x, t.z - m.p.z) < 1.3 && Math.abs(t.y - m.p.y) < 1.6) { m.fired = 0; sfx.tick(); break; }
      }
    }
  }

  update(dt) {
    this.updateHoles(dt);
    this.updateCharges(dt);
    this.updateMines(dt);
  }

  /** The sandbox was cleared, or the map changed. */
  clear() {
    for (const h of this.holes) this.ctx.scene.remove(h.g);
    for (const c of this.charges) c.mesh.removeFromParent();
    for (const m of this.mines) m.mesh.removeFromParent();
    this.holes.length = this.charges.length = this.mines.length = 0;
  }
}
