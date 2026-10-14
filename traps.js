import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Traps for the sandbox (spawn menu, Traps):
//   saw       a circular blade spinning on a post: it cuts whatever reaches its edge and flings the pieces
//   spikes    a plate on the floor: stand on it and a moment later spikes come up through it
//   launcher  a pad that throws whatever lands on it up and forward
//   crusher   a heavy block that slams down between two posts and flattens what is under it
// Each owns a fixed body for its frame and, where something moves, a kinematic body that update() drives
// before the physics step. What they do to people is worked out from where body parts are, not from contact
// events, so they only ever call into the world between steps (never from inside one).

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const yawQ = (yaw) => new THREE.Quaternion().setFromAxisAngle(UP, yaw);
const rnd = (a, b) => a + Math.random() * (b - a);

const steel = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.3, metalness: 0.9 });
const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.65, metalness: 0.5 });
let stripes = null;
/** Yellow and black warning stripes, drawn once. */
function hazard() {
  if (stripes) return stripes;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e8b400'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#151515';
  for (let k = -64; k < 128; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 16, 0); g.lineTo(k - 48, 64); g.lineTo(k - 64, 64); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  stripes = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.3 });
  return stripes;
}

class Trap {
  constructor(ctx, type, pos, yaw) {
    this.ctx = ctx;
    this.type = type;
    this.yaw = yaw;
    this.t = 0;
    this.removed = false;
    this.pos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.rot = yawQ(yaw);
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.rot);
    ctx.scene.add(this.group);
    this.fixed = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(this.rot));
    this.bodies = [this.fixed];
    this.cools = new Map();      // what was just hurt -> when it can be again
  }

  /** A box in the trap's frame, with a collider on `body` (the frame unless said otherwise). */
  box(w, h, d, x, y, z, mat, body = this.fixed, parent = this.group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    if (body) {
      const c = this.ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setFriction(0.8), body);
      this.ctx.owners.set(c.handle, { kind: 'trap', trap: this });
    }
    return m;
  }

  /** World point -> the trap's own frame (x across, y up, z toward where it faces). */
  local(p, out) { return out.set(p.x - this.pos.x, p.y - this.pos.y, p.z - this.pos.z).applyQuaternion(_q.copy(this.rot).invert()); }

  /** Every body part still there: [ragdoll, name, part, its position]. */
  parts() {
    const out = [];
    for (const r of this.ctx.ragdolls) {
      if (r.removed) continue;
      for (const name in r.parts) { const p = r.parts[name]; if (!p.gone) out.push([r, name, p, p.body.translation()]); }
    }
    return out;
  }

  /** Not more often than every `gap` seconds for the same thing. */
  ready(key, gap) {
    if (this.t < (this.cools.get(key) || 0)) return false;
    this.cools.set(key, this.t + gap);
    return true;
  }

  update(dt) { this.t += dt; }

  remove() {
    if (this.removed) return;
    this.removed = true;
    for (const b of this.bodies) {
      for (let i = 0; i < b.numColliders(); i++) this.ctx.owners.delete(b.collider(i).handle);
      this.ctx.world.removeRigidBody(b);
    }
    this.ctx.scene.remove(this.group);
  }
}

// ------------------------------------------------------------------ saw
class Saw extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'saw', pos, yaw);
    this.R = 0.45;
    this.box(0.8, 0.06, 0.8, 0, 0.03, 0, hazard());
    this.box(0.12, 1.05, 0.12, -0.16, 0.55, 0, dark);
    this.box(0.16, 0.05, 0.05, -0.08, 1.05, 0, steel, null);       // the axle
    this.hub = new THREE.Vector3(0, 1.05, 0).applyQuaternion(this.rot).add(this.pos);
    this.axis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.rot);
    this.angle = 0;
    // the blade: a kinematic body spinning about the trap's x axis, so whatever it touches gets thrown
    this.blade = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.hub.x, this.hub.y, this.hub.z).setRotation(this.rot));
    this.bodies.push(this.blade);
    const c = ctx.world.createCollider(RAPIER.ColliderDesc.cylinder(0.006, this.R).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2)).setFriction(0.4), this.blade);
    ctx.owners.set(c.handle, { kind: 'trap', trap: this });
    // the picture of it: a disc with teeth round the edge, turning on a pivot at the hub
    const shape = new THREE.Shape();
    const teeth = 36;
    for (let k = 0; k <= teeth; k++) {
      const a0 = (k / teeth) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / teeth * 0.6;
      const p0 = [Math.cos(a0) * this.R * 0.93, Math.sin(a0) * this.R * 0.93], p1 = [Math.cos(a1) * this.R, Math.sin(a1) * this.R];
      if (k === 0) shape.moveTo(...p0); else shape.lineTo(...p0);
      if (k < teeth) shape.lineTo(...p1);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.03, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -0.004).rotateY(Math.PI / 2);
    this.pivot = new THREE.Group();
    this.pivot.position.set(0, 1.05, 0);
    const disc = new THREE.Mesh(geo, steel);
    disc.castShadow = true;
    this.pivot.add(disc);
    this.group.add(this.pivot);
  }

  update(dt) {
    super.update(dt);
    this.angle -= dt * 30;
    this.pivot.rotation.x = this.angle;
    this.blade.setNextKinematicRotation(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.angle).premultiply(this.rot));
    // anything at the edge: a gash, and the edge's own direction of travel throws it
    for (const [r, name, p, t] of this.parts()) {
      _v.set(t.x - this.hub.x, t.y - this.hub.y, t.z - this.hub.z);
      const ax = _v.dot(this.axis);
      if (Math.abs(ax) > 0.13) continue;
      _v.addScaledVector(this.axis, -ax);
      const rad = _v.length();
      if (rad > this.R + 0.08 || rad < 0.05 || !this.ready(p, 0.12)) continue;
      _w.crossVectors(this.axis, _v).normalize();
      const at = new THREE.Vector3().copy(this.hub).addScaledVector(_v, Math.min(1, this.R / rad)).addScaledVector(this.axis, ax);
      if (r.mode !== 'ragdoll') r.goLimp(2.5);
      r.hit(name, 28, at, _w.clone(), 70, { blade: true, chop: true });
      this.ctx.sfx.saw();
    }
    const pl = this.ctx.player;
    _v.set(pl.pos.x - this.hub.x, pl.pos.y - 0.3 - this.hub.y, pl.pos.z - this.hub.z);
    const pax = _v.dot(this.axis);
    if (!pl.dead && Math.abs(pax) < 0.4 && _v.addScaledVector(this.axis, -pax).length() < this.R + 0.3 && this.ready('player', 0.3)) pl.hurt(22, this.hub);
  }
}

// ------------------------------------------------------------------ spikes
class Spikes extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'spikes', pos, yaw);
    this.half = 0.7;
    this.box(1.5, 0.06, 1.5, 0, 0.03, 0, hazard());
    this.box(1.3, 0.02, 1.3, 0, 0.065, 0, dark, null);
    // 6 x 6 spikes as one mesh, hidden in the plate until they fire
    const cone = new THREE.ConeGeometry(0.03, 0.55, 6).translate(0, 0.275, 0);
    this.spikes = new THREE.InstancedMesh(cone, steel, 36);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 36; i++) this.spikes.setMatrixAt(i, m.makeTranslation(((i % 6) - 2.5) * 0.21, 0, (Math.floor(i / 6) - 2.5) * 0.21));
    this.spikes.castShadow = true;
    this.spikes.position.y = -0.5;
    this.group.add(this.spikes);
    this.state = 'armed';
    this.timer = 0;
    this.h = 0;          // 0 = down, 1 = up
  }

  onPlate(p) {
    this.local(p, _v);
    return Math.abs(_v.x) < this.half && Math.abs(_v.z) < this.half && _v.y > -0.05 && _v.y < 0.6;
  }

  update(dt) {
    super.update(dt);
    const pl = this.ctx.player, feet = { x: pl.pos.x, y: pl.pos.y - 0.85, z: pl.pos.z };
    if (this.state === 'armed') {
      if ((!pl.dead && this.onPlate(feet)) || this.parts().some(([, , , t]) => this.onPlate(t))) { this.state = 'primed'; this.timer = 0.3; this.ctx.sfx.tick(); }
    } else if ((this.timer -= dt) <= 0) {
      if (this.state === 'primed') {
        // up they come: everything on the plate is run through and thrown a little
        this.state = 'up'; this.timer = 1.8;
        this.ctx.sfx.chop(); this.ctx.sfx.crack();
        for (const [r, name, p, t] of this.parts()) {
          if (p.gone || !this.onPlate(t)) continue;
          if (r.mode !== 'ragdoll') r.goLimp(3);
          r.hit(name, 50, new THREE.Vector3(t.x, t.y - 0.05, t.z), UP.clone(), 110, { stab: true });
        }
        if (!pl.dead && this.onPlate(feet)) { pl.hurt(45, null); pl.vel.y = Math.max(pl.vel.y, 4); }
      } else if (this.state === 'up') { this.state = 'reset'; this.timer = 1.2; }
      else this.state = 'armed';
    }
    const want = this.state === 'up' ? 1 : 0;
    this.h += (want - this.h) * Math.min(1, dt * (want ? 30 : 4));
    this.spikes.position.y = -0.5 + 0.56 * this.h;
  }
}

// ------------------------------------------------------------------ launch pad
class Launcher extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'launcher', pos, yaw);
    this.half = 0.6;
    this.box(1.3, 0.08, 1.3, 0, 0.04, 0, dark);
    this.pad = this.box(1.1, 0.06, 1.1, 0, 0.1, 0, new THREE.MeshStandardMaterial({ color: 0x1d6dff, emissive: 0x0a3cff, emissiveIntensity: 0.9, roughness: 0.4 }), null);
    // an arrow on it, pointing the way it throws
    const s = new THREE.Shape();
    s.moveTo(0, -0.38); s.lineTo(0.26, -0.08); s.lineTo(0.1, -0.08); s.lineTo(0.1, 0.36); s.lineTo(-0.1, 0.36); s.lineTo(-0.1, -0.08); s.lineTo(-0.26, -0.08); s.lineTo(0, -0.38);
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    arrow.position.y = 0.135;
    this.group.add(arrow);
    this.dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rot);     // (forward: away from whoever put it down)
    this.bounce = 0;
  }

  on(p) {
    this.local(p, _v);
    return Math.abs(_v.x) < this.half && Math.abs(_v.z) < this.half && _v.y > -0.05 && _v.y < 0.8;
  }

  throw() { return { x: this.dir.x * 7, y: 13, z: this.dir.z * 7 }; }

  update(dt) {
    super.update(dt);
    let fired = false;
    const seen = new Set();
    for (const [r, , , t] of this.parts()) {
      if (seen.has(r) || !this.on(t) || !this.ready(r, 1.2)) continue;
      seen.add(r);
      r.goLimp(3);
      for (const n in r.parts) if (!r.parts[n].gone) r.parts[n].body.setLinvel(this.throw(), true);
      fired = true;
    }
    for (const p of this.ctx.props) {
      if (p.removed || !p.body.isDynamic() || !this.on(p.body.translation()) || !this.ready(p, 1.2)) continue;
      p.body.setLinvel(this.throw(), true);
      fired = true;
    }
    const pl = this.ctx.player;
    if (!pl.dead && this.on({ x: pl.pos.x, y: pl.pos.y - 0.85, z: pl.pos.z }) && this.ready('player', 1)) {
      const v = this.throw();
      pl.vel.set(v.x, v.y, v.z);
      pl.grounded = false;
      fired = true;
    }
    if (fired) { this.bounce = 1; this.ctx.sfx.boing(); }
    this.bounce = Math.max(0, this.bounce - dt * 4);
    this.pad.position.y = 0.1 + 0.12 * Math.sin(this.bounce * Math.PI);
  }
}

// ------------------------------------------------------------------ crusher
const TOP = 2.75, BOTTOM = 0.3, CYCLE = 4.2;
class Crusher extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'crusher', pos, yaw);
    this.box(0.18, 3.3, 0.18, -1.0, 1.65, 0, dark);
    this.box(0.18, 3.3, 0.18, 1.0, 1.65, 0, dark);
    this.box(2.2, 0.22, 0.34, 0, 3.4, 0, dark);
    this.box(1.6, 0.04, 1.2, 0, 0.02, 0, hazard(), null);
    this.block = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + TOP, pos.z).setRotation(this.rot));
    this.bodies.push(this.block);
    this.blockMesh = new THREE.Group();
    this.blockMesh.position.y = TOP;
    this.group.add(this.blockMesh);
    this.box(1.6, 0.5, 1.2, 0, 0, 0, steel, this.block, this.blockMesh);
    this.box(1.62, 0.12, 1.22, 0, 0.12, 0, hazard(), null, this.blockMesh);
    this.y = TOP;
    this.down = false;
  }

  /** Height of the block's middle at a point in its cycle: wait at the top, slam, hold, wind back up. */
  height(c) {
    if (c < 1.6) return TOP;
    if (c < 1.85) { const k = (c - 1.6) / 0.25; return TOP - (TOP - BOTTOM) * k * k; }
    if (c < 2.5) return BOTTOM;
    return BOTTOM + (TOP - BOTTOM) * (c - 2.5) / (CYCLE - 2.5);
  }

  update(dt) {
    super.update(dt);
    this.y = this.height(this.t % CYCLE);
    this.blockMesh.position.y = this.y;
    _v.set(0, this.y, 0).applyQuaternion(this.rot).add(this.pos);
    this.block.setNextKinematicTranslation(_v);
    const down = this.y <= BOTTOM + 0.01;
    if (down && !this.down) this.slam();
    this.down = down;
  }

  /** It hit the floor: whatever was under it is gone, and the ground shakes. */
  slam() {
    const { sfx, gore, player: pl } = this.ctx;
    sfx.thud(1.8); sfx.crack();
    gore.debris(new THREE.Vector3(this.pos.x, this.pos.y + 0.1, this.pos.z), 0x8a8a8a, 18);
    // under it: anything low in its footprint, and anyone still standing there (a walking body is kinematic, so the block went through them)
    const under = (t, kin = false) => { this.local(t, _w); return Math.abs(_w.x) < 0.85 && Math.abs(_w.z) < 0.65 && (_w.y < BOTTOM + 0.45 || (kin && _w.y < TOP)); };
    const hit = this.parts().filter(([, , p, t]) => under(t, p.body.isKinematic()));
    for (const [r, name, p] of hit) if (!p.gone && !r.removed) r.gib(name);
    for (const p of this.ctx.props) if (!p.removed && under(p.body.translation())) p.hit(400, p.body.translation(), new THREE.Vector3(0, -1, 0), 0, {});
    if (!pl.dead && under({ x: pl.pos.x, y: pl.pos.y - 0.6, z: pl.pos.z })) pl.hurt(500, null);
    if (!pl.dead && pl.pos.distanceTo(this.pos) < 6) pl.shake = Math.min(1, pl.shake + 0.5);
  }
}

const TYPES = { saw: Saw, spikes: Spikes, launcher: Launcher, crusher: Crusher };
export const TRAP_TYPES = {
  saw: { label: 'Saw Blade', icon: '🪚', small: 'cuts what touches it' },
  spikes: { label: 'Spike Trap', icon: '📌', small: 'step on it' },
  launcher: { label: 'Launch Pad', icon: '🚀', small: 'up and away' },
  crusher: { label: 'Crusher', icon: '🔨', small: 'flattens' },
};
export function makeTrap(ctx, type, pos, yaw) { return new TYPES[type](ctx, pos, yaw); }
