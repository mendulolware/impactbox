import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Traps and machines for the sandbox (spawn menu, Traps):
//   saw       a circular blade spinning on a post: it cuts whatever reaches its edge and flings the pieces
//   spikes    a plate on the floor: stand on it and a moment later spikes come up through it
//   launcher  a pad that throws whatever lands on it up and forward
//   crusher   a heavy block that slams down between two posts and flattens what is under it
//   grinder   a hopper on two toothed rollers: what goes in comes out of the chute
//   wrecker   a wrecking ball swinging from a gantry
//   tesla     a Tesla coil that throws a bolt at whoever is nearest
//   lasers    a laser grid: beams sweeping up and down between two posts cut through whatever crosses them
//   guillotine  a blade dropped every few seconds onto whoever is under it
//   maiden    an iron maiden: the spiked doors slam on whoever is inside
//   chair     an electric chair: whoever is put in it is strapped in and jolted until dead
// Each owns a fixed body for its frame and, where something moves, a kinematic body that update() drives
// before the physics step. What they do to people is worked out from where body parts are, not from contact
// events, so they only ever call into the world between steps (never from inside one).
// In co-op the other player's copy is a puppet: it moves (pose) to the state the host sends (v), and decides nothing.

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const yawQ = (yaw) => new THREE.Quaternion().setFromAxisAngle(UP, yaw);
const players = (ctx) => [ctx.player, ...(ctx.remotes || [])];       // you, and the other player in co-op (coop.js)
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

  /** Every piece cut off someone (ragdoll.js slice): [ragdoll, piece, the middle of it]. */
  pieces() {
    const out = [];
    for (const r of this.ctx.ragdolls) {
      if (r.removed) continue;
      for (const p of r.pieces) {
        if (p.gone) continue;
        out.push([r, p, r.localToWorld(p, { x: 0, y: (p.range[0] + p.range[1]) / 2, z: 0 })]);
      }
    }
    return out;
  }

  /** Not more often than every `gap` seconds for the same thing. */
  ready(key, gap) {
    if (this.t < (this.cools.get(key) || 0)) return false;
    this.cools.set(key, this.t + gap);
    return true;
  }

  /** logic: what the trap does (the host's copy only); pose: where its moving parts are (every copy). */
  update(dt) {
    this.t += dt;
    this.ctx.soundAt = this.pos;
    if (!this.puppet) this.logic(dt);
    this.pose(dt);
  }
  logic() {}
  pose() {}
  get v() { return 0; }       // the one number a puppet copy needs (spikes' height, the crusher's block, the pad's bounce)
  set v(x) {}

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

  pose(dt) {
    this.angle -= dt * 30;
    this.pivot.rotation.x = this.angle;
    this.blade.setNextKinematicRotation(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.angle).premultiply(this.rot));
  }

  logic() {
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
    for (const pl of players(this.ctx)) {
      _v.set(pl.pos.x - this.hub.x, pl.pos.y - 0.3 - this.hub.y, pl.pos.z - this.hub.z);
      const pax = _v.dot(this.axis);
      if (!pl.dead && Math.abs(pax) < 0.4 && _v.addScaledVector(this.axis, -pax).length() < this.R + 0.3 && this.ready(pl, 0.3)) pl.hurt(22, this.hub);
    }
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

  get v() { return this.h; }
  set v(h) { this.h = h; }

  logic(dt) {
    const feet = (pl) => ({ x: pl.pos.x, y: pl.pos.y - 0.85, z: pl.pos.z });
    if (this.state === 'armed') {
      if (players(this.ctx).some((pl) => !pl.dead && this.onPlate(feet(pl))) || this.parts().some(([, , , t]) => this.onPlate(t))) { this.state = 'primed'; this.timer = 0.3; this.ctx.sfx.tick(); }
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
        for (const pl of players(this.ctx)) if (!pl.dead && this.onPlate(feet(pl))) { pl.hurt(45, null); if (pl.launch) pl.launch({ x: 0, y: 4, z: 0 }); else pl.vel.y = Math.max(pl.vel.y, 4); }
      } else if (this.state === 'up') { this.state = 'reset'; this.timer = 1.2; }
      else this.state = 'armed';
    }
    const want = this.state === 'up' ? 1 : 0;
    this.h += (want - this.h) * Math.min(1, dt * (want ? 30 : 4));
  }

  pose() { this.spikes.position.y = -0.5 + 0.56 * this.h; }
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

  get v() { return this.bounce; }
  set v(b) { this.bounce = b; }

  logic(dt) {
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
    for (const pl of players(this.ctx)) {
      if (pl.dead || !this.on({ x: pl.pos.x, y: pl.pos.y - 0.85, z: pl.pos.z }) || !this.ready(pl, 1)) continue;
      const v = this.throw();
      if (pl.launch) pl.launch(v);           // (the other player in co-op: their own game moves them)
      else { pl.vel.set(v.x, v.y, v.z); pl.grounded = false; }
      fired = true;
    }
    if (fired) { this.bounce = 1; this.ctx.sfx.boing(); }
    this.bounce = Math.max(0, this.bounce - dt * 4);
  }

  pose() { this.pad.position.y = 0.1 + 0.12 * Math.sin(this.bounce * Math.PI); }
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

  get v() { return this.y; }
  set v(y) { this.y = y; }

  logic() {
    this.y = this.height(this.t % CYCLE);
    const down = this.y <= BOTTOM + 0.01;
    if (down && !this.down) this.slam();
    this.down = down;
  }

  pose() {
    this.blockMesh.position.y = this.y;
    _v.set(0, this.y, 0).applyQuaternion(this.rot).add(this.pos);
    this.block.setNextKinematicTranslation(_v);
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
    for (const p of players(this.ctx)) if (!p.dead && under({ x: p.pos.x, y: p.pos.y - 0.6, z: p.pos.z })) p.hurt(500, null);
    if (!pl.dead && pl.pos.distanceTo(this.pos) < 6) pl.shake = Math.min(1, pl.shake + 0.5);
  }
}

// ------------------------------------------------------------------ meat grinder
// A hopper on a drum: whatever goes in over the rim is drawn down onto two toothed rollers, a part at a time, and comes
// out of the chute at the front as a spray. (People do not walk in: throw them in with the Grab Gun or the wand, or
// point a launch pad at it.)
const RIM = 1.25;
class Grinder extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'grinder', pos, yaw);
    this.box(1.5, 0.35, 1.5, 0, 0.175, 0, dark);                                   // the drum (its top is the floor inside)
    for (const s of [-1, 1]) {
      this.box(0.08, RIM - 0.35, 1.5, s * 0.71, 0.35 + (RIM - 0.35) / 2, 0, steel);  // the hopper's walls
      this.box(1.34, RIM - 0.35, 0.08, 0, 0.35 + (RIM - 0.35) / 2, s * 0.71, steel);
      this.box(1.56, 0.1, 0.1, 0, RIM, s * 0.75, hazard(), null);                    // a striped lip
    }
    const chute = this.box(0.5, 0.05, 0.75, 0, 0.3, 1.05, steel, null);             // the chute, out of the front
    chute.rotation.x = 0.35;
    for (const s of [-1, 1]) { const side = this.box(0.04, 0.16, 0.75, s * 0.25, 0.37, 1.05, steel, null); side.rotation.x = 0.35; }
    this.mouth = new THREE.Vector3(0, 0.2, 1.42).applyQuaternion(this.rot).add(this.pos);
    this.out = new THREE.Vector3(0, -0.2, 1).normalize().applyQuaternion(this.rot);
    // two toothed rollers turning in toward each other
    this.rollers = [-0.2, 0.2].map((z) => {
      const r = new THREE.Group();
      r.position.set(0, 0.42, z);
      r.add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.3, 16).rotateZ(Math.PI / 2), dark));
      for (let k = 0; k < 8; k++) {
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.05), steel), a = k * Math.PI / 4;
        tooth.position.set(0, Math.cos(a) * 0.18, Math.sin(a) * 0.18);
        tooth.rotation.x = a;
        r.add(tooth);
      }
      this.group.add(r);
      return r;
    });
    this.spin = 0;
    this.busy = 0;
  }

  inside(t) { this.local(t, _v); return Math.abs(_v.x) < 0.66 && Math.abs(_v.z) < 0.66 && _v.y > 0 && _v.y < RIM + 0.15; }
  /** On it at all: inside, or lying across the rim (a body is longer than the hopper is wide). */
  caught(t) { this.local(t, _v); return Math.abs(_v.x) < 0.95 && Math.abs(_v.z) < 0.95 && _v.y > 0 && _v.y < RIM + 0.8; }

  get v() { return this.busy; }
  set v(b) { this.busy = b; }

  logic(dt) {
    this.busy = Math.max(0, this.busy - dt);
    // once any of someone is in, all of them is dragged in: toward the middle and down onto the rollers
    const caught = new Set();
    for (const [r, , , t] of this.parts()) if (this.caught(t)) caught.add(r);
    for (const r of caught) {
      if (r.mode !== 'ragdoll') r.goLimp(3);
      for (const name in r.parts) {
        const p = r.parts[name];
        if (p.gone) continue;
        const t = p.body.translation(), lv = p.body.linvel();
        _w.set(this.pos.x - t.x, 0, this.pos.z - t.z);
        p.body.setLinvel({ x: lv.x * 0.6 + _w.x * 2.5, y: Math.min(lv.y, -1.2), z: lv.z * 0.6 + _w.z * 2.5 }, true);
        if (this.inside(t) && _v.y < 0.8 && this.ready(r, 0.14)) { r.gib(name, false); this.spray(); }   // (a part at a time)
      }
    }
    for (const p of this.ctx.props) {
      if (p.removed || !p.body.isDynamic() || !this.inside(p.body.translation())) continue;
      const lv = p.body.linvel();
      p.body.setLinvel({ x: lv.x * 0.6, y: Math.min(lv.y, -1.2), z: lv.z * 0.6 }, true);
      if (_v.y < 0.8 && this.ready(p, 0.3)) { p.hit(60, p.body.translation(), new THREE.Vector3(0, -1, 0), 0, {}); this.ctx.gore.debris(this.mouth, p.def.debris || 0x777777, 8); this.ctx.sfx.grind(); this.busy = 0.6; }
    }
    for (const pl of players(this.ctx)) {
      if (!pl.dead && this.inside({ x: pl.pos.x, y: pl.pos.y - 0.7, z: pl.pos.z }) && this.ready(pl, 0.3)) { pl.hurt(25, this.mouth); pl.shake = Math.min(1, (pl.shake || 0) + 0.4); this.spray(); }
    }
  }

  /** What went in comes out of the chute. */
  spray() {
    const { gore, sfx } = this.ctx;
    gore.blood(this.mouth, this.out, 22, 5.5, 0.35);
    gore.chunks(this.mouth, 2, 3, { x: this.out.x * 3, y: this.out.y * 3, z: this.out.z * 3 }, 'any');
    sfx.grind();
    this.busy = 0.6;
  }

  pose(dt) {
    this.spin += dt * (this.busy > 0 ? 16 : 5);
    this.rollers[0].rotation.x = this.spin;
    this.rollers[1].rotation.x = -this.spin;
  }
}

// ------------------------------------------------------------------ wrecking ball
// A tonne of iron on a chain from a gantry, swinging through the middle of it and back, forever. A walking person
// it meets is knocked flying; a body it meets is broken by it.
const BEAM = 6.0, CHAIN = 4.9, SWING = 1.05, BALL = 0.5;      // (at the bottom of its swing the ball is at chest height)
class Wrecker extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'wrecker', pos, yaw);
    for (const s of [-1, 1]) this.box(0.24, BEAM, 0.24, s * 1.7, BEAM / 2, 0, dark);
    this.box(3.64, 0.3, 0.3, 0, BEAM + 0.15, 0, hazard());
    this.omega = Math.sqrt(9.81 / CHAIN);          // (a pendulum that long swings at its own pace)
    this.theta = 0;
    this.ball = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + BEAM - CHAIN, pos.z));
    this.bodies.push(this.ball);
    const c = ctx.world.createCollider(RAPIER.ColliderDesc.ball(BALL).setFriction(0.6), this.ball);
    ctx.owners.set(c.handle, { kind: 'trap', trap: this });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.45, metalness: 0.8 });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL, 24, 16), iron);
    this.ballMesh.castShadow = true;
    this.chain = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, CHAIN, 6), steel);
    this.chain.castShadow = true;
    this.group.add(this.ballMesh, this.chain);
    this.vel = new THREE.Vector3();
  }

  get v() { return this.theta; }
  set v(a) { this.theta = a; }

  /** Where the ball is (in the machine's own frame) at a swing angle. */
  at(theta, out) { return out.set(0, BEAM - CHAIN * Math.cos(theta), CHAIN * Math.sin(theta)); }

  logic() {
    this.theta = SWING * Math.sin(this.t * this.omega);
    const w = SWING * this.omega * Math.cos(this.t * this.omega);                    // how fast it is swinging now
    this.vel.set(0, Math.sin(this.theta), Math.cos(this.theta)).multiplyScalar(CHAIN * w).applyQuaternion(this.rot);
    const speed = this.vel.length();
    if (speed < 1.2) return;
    const c = this.at(this.theta, _w).applyQuaternion(this.rot).add(this.pos);
    const dir = this.vel.clone().divideScalar(speed);
    for (const [r, name, p, t] of this.parts()) {
      _v.set(t.x - c.x, t.y - c.y, t.z - c.z);
      if (_v.length() > BALL + 0.22 || !this.ready(r, 0.5)) continue;
      const point = c.clone().addScaledVector(_v.normalize(), BALL);
      if (r.mode !== 'ragdoll') r.knockBy(name, this.vel, speed, 1500);
      r.hit(name, speed * 7, point, dir, speed * 35, { blunt: true });
      this.ctx.sfx.thud(1.6);
      if (speed > 4) this.ctx.sfx.crack();
    }
    for (const pl of players(this.ctx)) {
      if (pl.dead || pl.pos.distanceTo(c) > BALL + 0.7 || !this.ready(pl, 0.6)) continue;
      pl.hurt(speed * 6, c);
      const v = { x: this.vel.x * 1.3, y: 3.5, z: this.vel.z * 1.3 };
      if (pl.launch) pl.launch(v); else { pl.vel.set(v.x, v.y, v.z); pl.grounded = false; }
      this.ctx.sfx.thud(1.8);
    }
  }

  pose() {
    const local = this.at(this.theta, _v);
    this.ballMesh.position.copy(local);
    this.chain.position.set(0, (BEAM + local.y) / 2, local.z / 2);
    this.chain.rotation.x = this.theta;
    this.ball.setNextKinematicTranslation(local.applyQuaternion(this.rot).add(this.pos));
  }
}

// ------------------------------------------------------------------ tesla coil
// It charges, and about once a second throws a bolt at whatever is nearest within 7 m: a person goes rigid and falls,
// and it burns where it lands. Enough of them kill. (No lamp in it: adding a light to the scene makes every material
// rebuild its shader, a stall. The bolt glows through the bloom.)
const REACH = 7;
class Tesla extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'tesla', pos, yaw);
    this.box(0.9, 0.2, 0.9, 0, 0.1, 0, dark);
    const copper = new THREE.MeshStandardMaterial({ color: 0xb8733a, metalness: 0.9, roughness: 0.35 });
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 1.7, 18), copper);
    coil.position.y = 1.05;
    coil.castShadow = true;
    this.group.add(coil);
    const cc = ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(0.16, 0.85, 0.16).setTranslation(0, 1.05, 0).setFriction(0.8), this.fixed);   // (the coil's collider)
    ctx.owners.set(cc.handle, { kind: 'trap', trap: this });
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.95, roughness: 0.2, emissive: 0x6a9cff, emissiveIntensity: 0 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 10, 28).rotateX(Math.PI / 2), this.ringMat);
    ring.position.y = 2.0;
    this.group.add(ring);
    this.top = new THREE.Vector3(0, 2.0, 0).applyQuaternion(this.rot).add(this.pos);
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 3.2, 5.0), toneMapped: false });
    this.boltMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat);
    this.boltMesh.visible = false;
    this.boltMesh.frustumCulled = false;
    ctx.scene.add(this.boltMesh);
    this.target = new THREE.Vector3();
    this.charge = 0;
    this.boltT = 0;
    this.zaps = 0;
  }

  get v() { return this.zaps; }
  set v(n) {                       // (co-op: the other player's copy draws a bolt to whoever is nearest there when the count goes up)
    if (n === this.zaps) return;
    this.zaps = n;
    const near = this.nearest();
    if (near) this.strike(near.point);
  }

  /** The nearest body part or player within reach of the top. */
  nearest() {
    let best = null, bd = REACH;
    for (const [r, name, p, t] of this.parts()) {
      const d = Math.hypot(t.x - this.top.x, t.y - this.top.y, t.z - this.top.z);
      if (d < bd) { bd = d; best = { r, name, point: new THREE.Vector3(t.x, t.y, t.z) }; }
    }
    for (const pl of players(this.ctx)) {
      if (pl.dead) continue;
      const d = Math.hypot(pl.pos.x - this.top.x, pl.pos.y - this.top.y, pl.pos.z - this.top.z);
      if (d < bd) { bd = d; best = { pl, point: new THREE.Vector3(pl.pos.x, pl.pos.y, pl.pos.z) }; }
    }
    return best;
  }

  logic(dt) {
    this.charge += dt;
    if (this.charge < 0.9) return;
    const n = this.nearest();
    if (!n) return;
    this.charge = 0;
    this.zaps++;
    this.strike(n.point);
    this.ctx.sfx.zap();
    const dir = n.point.clone().sub(this.top).normalize();
    if (n.r) {
      n.r.hit(n.name, 16, n.point, dir, 25, { tase: 2.2, daze: 3 });
      n.r.scorch(n.name, 0.2, 4, this.top);
    } else {
      n.pl.hurt(14, this.top);
      n.pl.shake = Math.min(1, (n.pl.shake || 0) + 0.4);
    }
  }

  strike(point) { this.target.copy(point); this.boltT = 0.2; }

  pose(dt) {
    this.boltT -= dt;
    const on = this.boltT > 0;
    this.ringMat.emissiveIntensity = on ? 3 : 0.15 + 0.1 * Math.sin(this.t * 40);
    this.boltMesh.visible = on;
    if (!on) return;
    // a new jagged path every frame it is there: that is what makes it crackle
    const path = new THREE.CurvePath(), n = 12;
    let prev = this.top.clone();
    for (let i = 1; i <= n; i++) {
      const k = i / n, p = this.top.clone().lerp(this.target, k);
      if (i < n) p.add(_v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(0.3 * Math.sin(k * Math.PI)));
      path.add(new THREE.LineCurve3(prev, p));
      prev = p;
    }
    this.boltMesh.geometry.dispose();
    this.boltMesh.geometry = new THREE.TubeGeometry(path, n * 2, 0.02, 5, false);
  }

  remove() {
    super.remove();
    this.ctx.scene.remove(this.boltMesh);
    this.boltMesh.geometry.dispose();
  }
}

// ------------------------------------------------------------------ laser grid
// Two posts 3.2 m apart with five beams between them, sweeping slowly up and down. Anything that crosses a beam is cut
// through where it crossed it (the laser sword's cut: sealed); you are burnt.
const LASER_W = 1.6;
class LaserGrid extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'lasers', pos, yaw);
    for (const x of [-LASER_W - 0.08, LASER_W + 0.08]) {
      this.box(0.16, 2.1, 0.16, x, 1.05, 0, dark);
      this.box(0.03, 1.9, 0.08, x - Math.sign(x) * 0.095, 1.05, 0, steel, null);       // the emitter strip
    }
    this.beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.25, 0.2), toneMapped: false, transparent: true });
    this.beams = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(LASER_W * 2, 0.01, 0.01), this.beamMat);
      this.group.add(m);
      this.beams.push(m);
    }
  }

  get v() { return this.t; }
  set v(t) { this.t = t; }

  height(i) { return 0.2 + i * 0.4 + 0.2 * Math.sin(this.t * 0.9 + i * 1.7); }

  logic() {
    for (const [r, name, p, t] of this.parts()) {
      this.local(t, _v);
      if (Math.abs(_v.x) > LASER_W || Math.abs(_v.z) > 0.11) continue;
      const half = name === 'head' ? 0.12 : name === 'torso' ? 0.22 : name === 'pelvis' ? 0.1 : 0.17;
      for (let i = 0; i < 5; i++) {
        const h = this.height(i);
        if (Math.abs(_v.y - h) > half || !this.ready(p, 0.4)) continue;
        if (r.mode !== 'ragdoll') r.goLimp(2);
        r.hit(name, 30, new THREE.Vector3(t.x, this.pos.y + h, t.z), new THREE.Vector3(0, 0, Math.sign(_v.z) || 1).applyQuaternion(this.rot), 0, { laser: true });
        this.ctx.sfx.sizzle();
        break;
      }
    }
    for (const [r, p, t] of this.pieces()) {
      this.local(t, _v);
      if (Math.abs(_v.x) > LASER_W || Math.abs(_v.z) > 0.11) continue;
      for (let i = 0; i < 5; i++) {
        const h = this.height(i);
        if (Math.abs(_v.y - h) > 0.15 || !this.ready(p, 0.4)) continue;
        r.hitPiece(p, 30, new THREE.Vector3(t.x, this.pos.y + h, t.z), new THREE.Vector3(0, 0, Math.sign(_v.z) || 1).applyQuaternion(this.rot), 0, { laser: true });
        this.ctx.sfx.sizzle();
        break;
      }
    }
    for (const pl of players(this.ctx)) {
      if (pl.dead) continue;
      this.local(pl.pos, _v);
      if (Math.abs(_v.x) > LASER_W || Math.abs(_v.z) > 0.35) continue;
      for (let i = 0; i < 5; i++) {
        const h = this.height(i);
        if (_v.y - 0.95 < h && _v.y + 0.8 > h && this.ready(pl, 0.6)) { pl.hurt(28, null); this.ctx.sfx.sizzle(); break; }
      }
    }
  }

  pose() {
    this.beams.forEach((b, i) => { b.position.y = this.height(i); });
    this.beamMat.opacity = 0.75 + 0.25 * Math.sin(this.t * 60);
  }

  remove() { super.remove(); this.beamMat.dispose(); }
}

// ------------------------------------------------------------------ guillotine
// A frame with a weighted, angled blade that is hauled up, held, and let go every few seconds. What is under it when it
// comes down is cut through there: a neck in the lunette, or anything else in the way. (Put someone on the bench with the
// Grab Gun or the wand, or walk them into it.)
const G_TOP = 2.35, G_LOW = 0.62, G_CYCLE = 5.5;
class Guillotine extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'guillotine', pos, yaw);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 });
    for (const x of [-0.42, 0.42]) this.box(0.14, 2.7, 0.14, x, 1.35, 0, wood);
    this.box(1.0, 0.16, 0.2, 0, 2.75, 0, wood);
    this.box(0.7, 0.12, 0.16, 0, 0.5, 0, wood);                               // the lower half of the lunette
    this.box(0.5, 0.45, 1.5, 0, 0.225, 0.85, wood);                           // the bench, on the side the victim lies
    this.box(1.1, 0.06, 0.6, 0, 0.03, 0, wood);
    this.bladeY = G_TOP;
    this.blade = new THREE.Group();
    const steelBlade = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.03), steel);
    steelBlade.rotation.z = 0.35;                                             // angled, as the real thing is
    const weight = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.08), dark);
    weight.position.y = 0.28;
    this.blade.add(steelBlade, weight);
    for (const m of this.blade.children) m.castShadow = true;
    this.group.add(this.blade);
    this.prevY = G_TOP;
  }

  get v() { return this.bladeY; }
  set v(y) { this.bladeY = y; }

  height(c) {
    if (c < 3) return G_TOP;                                                  // held up
    if (c < 3.18) { const k = (c - 3) / 0.18; return G_TOP - (G_TOP - G_LOW) * k * k; }   // let go
    if (c < 4) return G_LOW;
    return G_LOW + (G_TOP - G_LOW) * (c - 4) / (G_CYCLE - 4);                 // hauled back up
  }

  logic() {
    this.prevY = this.bladeY;
    this.bladeY = this.height(this.t % G_CYCLE);
    if (this.bladeY >= this.prevY - 1e-3) return;
    // coming down: whatever its edge passed through this frame is cut there
    const lo = this.bladeY - 0.17, hi = this.prevY - 0.17;
    for (const [r, name, p, t] of this.parts()) {
      if (p.gone) continue;
      this.local(t, _v);
      if (Math.abs(_v.x) > 0.36 || Math.abs(_v.z) > 0.16 || _v.y > hi + 0.1 || _v.y < lo - 0.1 || !this.ready(p, 1)) continue;
      if (r.mode !== 'ragdoll') r.goLimp(3);
      r.hit(name, 200, new THREE.Vector3(t.x, t.y + 0.05, t.z), new THREE.Vector3(0, -1, 0), 40, { blade: true, chop: true });
      this.ctx.sfx.chop();
    }
    for (const [r, p, t] of this.pieces()) {
      this.local(t, _v);
      if (Math.abs(_v.x) > 0.36 || Math.abs(_v.z) > 0.16 || _v.y > hi + 0.1 || _v.y < lo - 0.1 || !this.ready(p, 1)) continue;
      r.hitPiece(p, 200, new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0, -1, 0), 40, { blade: true });
    }
    for (const pl of players(this.ctx)) {
      this.local(pl.pos, _v);
      if (!pl.dead && Math.abs(_v.x) < 0.4 && Math.abs(_v.z) < 0.3 && _v.y - 0.9 < hi && _v.y + 0.8 > lo && this.ready(pl, 1)) pl.hurt(120, null);
    }
    if (this.bladeY <= G_LOW + 1e-3) { this.ctx.sfx.thud(1.4); this.ctx.sfx.crack(); }
  }

  pose() { this.blade.position.y = this.bladeY; }
}

// ------------------------------------------------------------------ iron maiden
// An upright spiked cabinet, open at the front. Whoever ends up inside (thrown, put there, or walking in) has the doors
// slammed on them: every spike goes in, and it holds them for a few seconds before it opens again and lets them fall out.
class IronMaiden extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'maiden', pos, yaw);
    const iron = new THREE.MeshStandardMaterial({ color: 0x3b3430, roughness: 0.7, metalness: 0.6 });
    this.box(1.1, 0.1, 0.9, 0, 0.05, 0, iron);
    this.box(1.1, 2.2, 0.08, 0, 1.15, -0.41, iron);                            // the back
    for (const x of [-0.53, 0.53]) this.box(0.06, 2.2, 0.9, x, 1.15, 0, iron); // the sides
    this.box(1.1, 0.1, 0.9, 0, 2.3, 0, iron);
    const cone = new THREE.ConeGeometry(0.018, 0.2, 5).rotateX(-Math.PI / 2).translate(0, 0, 0.1);
    const spikes = (n, place) => {
      const m = new THREE.InstancedMesh(cone, steel, n), mt = new THREE.Matrix4(), q = new THREE.Quaternion();
      for (let i = 0; i < n; i++) m.setMatrixAt(i, place(i, mt, q));
      m.castShadow = true;
      return m;
    };
    // on the back, pointing forward
    this.group.add(spikes(20, (i, mt) => mt.makeTranslation(((i % 4) - 1.5) * 0.2, 0.45 + Math.floor(i / 4) * 0.35, -0.37)));
    // the doors, hinged at the front corners, spikes on their inside
    this.doors = [-1, 1].map((s) => {
      const hinge = new THREE.Group();
      hinge.position.set(s * 0.53, 0, 0.43);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.53, 2.2, 0.06), iron);
      door.position.set(-s * 0.265, 1.15, 0);
      door.castShadow = true;
      hinge.add(door);
      hinge.add(spikes(10, (i, mt, q) => mt.compose(_v.set(-s * (0.12 + (i % 2) * 0.26), 0.5 + Math.floor(i / 2) * 0.4, -0.03), q.setFromAxisAngle(UP, Math.PI), new THREE.Vector3(1, 1, 1))));
      this.group.add(hinge);
      return { hinge, s };
    });
    this.shut = 0;           // 0 open .. 1 shut
    this.state = 'open';
    this.timer = 0;
    this.held = [];
  }

  get v() { return this.shut; }
  set v(x) { this.shut = x; }

  inside(t) { this.local(t, _v); return Math.abs(_v.x) < 0.48 && _v.z > -0.38 && _v.z < 0.4 && _v.y > 0.1 && _v.y < 2.1; }

  logic(dt) {
    if (this.state === 'open') {
      if (this.timer > 0) { this.timer -= dt; return; }
      const r = this.ctx.ragdolls.find((x) => !x.removed && !x.parts.pelvis.gone && this.inside(x.parts.pelvis.body.translation()));
      const pl = players(this.ctx).find((x) => !x.dead && this.inside(x.pos));
      if (r || pl) { this.state = 'closing'; this.ctx.sfx.thud(1); }
    } else if (this.state === 'closing') {
      this.shut = Math.min(1, this.shut + dt / 0.3);
      if (this.shut >= 1) {
        // shut: every spike goes in
        this.state = 'shut'; this.timer = 3;
        this.ctx.sfx.chop(); this.ctx.sfx.crack(); this.ctx.sfx.thud(1.6);
        this.held = [];
        for (const [r, name, p, t] of this.parts()) {
          if (!this.inside(t)) continue;
          if (r.mode !== 'ragdoll') r.goLimp(5);
          const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.rot);
          r.hit(name, 45, new THREE.Vector3(t.x, t.y, t.z).addScaledVector(fwd, 0.1), fwd.clone().negate(), 0, { stab: true });
          r.hit(name, 35, new THREE.Vector3(t.x, t.y, t.z).addScaledVector(fwd, -0.1), fwd, 0, { stab: true });
          this.held.push([r, p, new THREE.Vector3(t.x, t.y, t.z)]);
        }
        for (const pl of players(this.ctx)) if (!pl.dead && this.inside(pl.pos)) pl.hurt(80, null);
        this.ctx.gore.gush(this.pos.clone().add(_v.set(0, 1, 0)), UP, 30, 3);
      }
    } else if (this.state === 'shut') {
      // held where they were, bleeding out through the gaps
      for (const [r, p, at] of this.held) {
        if (r.removed || p.gone) continue;
        const t = p.body.translation();
        p.body.setLinvel({ x: (at.x - t.x) * 8, y: (at.y - t.y) * 8, z: (at.z - t.z) * 8 }, true);
      }
      if (Math.random() < dt * 6) this.ctx.gore.drip(this.pos.clone().add(_v.set((Math.random() - 0.5) * 0.9, 0.12, 0.46).applyQuaternion(this.rot)), _w.set(0, -0.2, 0));
      if ((this.timer -= dt) <= 0) { this.state = 'opening'; this.held = []; }
    } else {
      this.shut = Math.max(0, this.shut - dt / 0.7);
      if (this.shut <= 0) { this.state = 'open'; this.timer = 2; }
    }
  }

  pose() { for (const d of this.doors) d.hinge.rotation.y = d.s * (1 - this.shut) * 1.75; }
}

// ------------------------------------------------------------------ electric chair
// A wooden chair with straps and a metal cap. Put someone in it (the Grab Gun, the wand, a launch pad): they are
// strapped in and the current goes through them, a jolt at a time, until they are dead and smoking, then let go.
class ElectricChair extends Trap {
  constructor(ctx, pos, yaw) {
    super(ctx, 'chair', pos, yaw);
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.75 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 0.9 });
    this.box(0.62, 0.08, 0.56, 0, 0.5, 0, wood);
    for (const x of [-0.27, 0.27]) for (const z of [-0.24, 0.24]) this.box(0.07, 0.5, 0.07, x, 0.25, z, wood);
    this.box(0.62, 1.0, 0.07, 0, 1.0, -0.27, wood);                          // the back
    for (const x of [-0.31, 0.31]) this.box(0.07, 0.07, 0.5, x, 0.78, 0, wood);   // the arms
    for (const x of [-0.31, 0.31]) this.box(0.09, 0.03, 0.12, x, 0.83, 0.05, strap, null);
    this.box(0.5, 0.05, 0.03, 0, 1.0, -0.22, strap, null);
    this.box(0.04, 0.4, 0.04, 0, 1.6, -0.26, steel, null);                    // the cap, on its arm
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel);
    cap.position.set(0, 1.62, -0.1);
    cap.castShadow = true;
    this.group.add(cap);
    this.box(0.3, 0.5, 0.2, 0.75, 0.25, -0.2, dark);                          // the switch box
    this.capAt = new THREE.Vector3(0, 1.55, -0.1).applyQuaternion(this.rot).add(this.pos);
    this.seat = new THREE.Vector3(0, 0.75, 0).applyQuaternion(this.rot).add(this.pos);
    this.victim = null;
    this.jolts = 0;
    this.joltT = 0;
    this.after = 0;
    this.rest = 0;
  }

  get v() { return this.jolts; }
  set v(n) { if (n !== this.jolts) { this.jolts = n; this.spark(); } }

  spark() {
    const g = this.ctx.gore;
    g.sparks(this.capAt, UP, 10);
    g.smoke.emit(this.capAt.x, this.capAt.y + 0.05, this.capAt.z, rnd(-0.2, 0.2), rnd(0.4, 0.9), rnd(-0.2, 0.2), rnd(0.06, 0.12), rnd(0.8, 1.6), -0.3, 0.3, 0.3, 0.3, 0, 1.5);
  }

  logic(dt) {
    if (!this.victim) {
      if ((this.rest -= dt) > 0) return;
      // someone dropped on it (lying loose, not walking past): strapped in
      this.victim = this.ctx.ragdolls.find((r) => !r.removed && r.mode === 'ragdoll' && !r.parts.pelvis.gone && !r.parts.torso.gone
        && this.seat.distanceTo(r.parts.pelvis.body.translation()) < 0.65) || null;
      if (this.victim) { this.joltT = 0.6; this.after = 0; this.ctx.sfx.thud(0.8); }
      return;
    }
    const r = this.victim;
    if (r.removed || r.parts.pelvis.gone || r.parts.torso.gone) { this.victim = null; this.rest = 2; return; }
    r.goLimp(1);
    // held in the seat, sitting up against the back, the head under the cap
    const hold = (p, at, k = 10) => { if (p.gone) return; const t = p.body.translation(); p.body.setLinvel({ x: (at.x - t.x) * k, y: (at.y - t.y) * k, z: (at.z - t.z) * k }, true); };
    hold(r.parts.pelvis, this.seat);
    hold(r.parts.torso, _v.set(0, 1.1, -0.12).applyQuaternion(this.rot).add(this.pos), 6);
    // a jolt every so often: every muscle locks, it burns, it smokes, and it kills in the end
    if ((this.joltT -= dt) <= 0) {
      this.joltT = rnd(0.3, 0.55);
      this.jolts++;
      this.spark();
      this.ctx.sfx.zap();
      const names = Object.keys(r.parts).filter((n) => !r.parts[n].gone);
      const n = names[(Math.random() * names.length) | 0];
      if (!r.dead) r.hit('torso', 0, this.capAt.clone(), new THREE.Vector3(0, -1, 0), 0, { tase: 0.5, daze: 2 });   // (no wound: the current does the harm)
      r.scorch(n, 0.12, r.dead ? 0 : 7, this.capAt);
      if (!r.parts.head.gone) r.scorch('head', 0.1, 0, this.capAt);
      for (const k of names) { const p = r.parts[k]; p.body.applyTorqueImpulse({ x: rnd(-1, 1) * p.inertia * 25, y: rnd(-1, 1) * p.inertia * 10, z: rnd(-1, 1) * p.inertia * 25 }, true); }
    }
    if (r.dead && (this.after += dt) > 2.5) { this.victim = null; this.rest = 3; }       // let go
  }
}

const TYPES = { saw: Saw, spikes: Spikes, launcher: Launcher, crusher: Crusher, grinder: Grinder, wrecker: Wrecker, tesla: Tesla, lasers: LaserGrid, guillotine: Guillotine, maiden: IronMaiden, chair: ElectricChair };
export const TRAP_TYPES = {
  saw: { label: 'Saw Blade', icon: '🪚', small: 'cuts what touches it' },
  spikes: { label: 'Spike Trap', icon: '📌', small: 'step on it' },
  launcher: { label: 'Launch Pad', icon: '🚀', small: 'up and away' },
  crusher: { label: 'Crusher', icon: '🔨', small: 'flattens' },
  grinder: { label: 'Meat Grinder', icon: '🥩', small: 'throw someone in' },
  wrecker: { label: 'Wrecking Ball', icon: '⛓️', small: 'swings forever' },
  tesla: { label: 'Tesla Coil', icon: '⚡', small: 'zaps the nearest' },
  lasers: { label: 'Laser Grid', icon: '🟥', small: 'cuts what crosses it' },
  guillotine: { label: 'Guillotine', icon: '🪓', small: 'drops every few seconds' },
  maiden: { label: 'Iron Maiden', icon: '⚰️', small: 'shuts on whoever is inside' },
  chair: { label: 'Electric Chair', icon: '🪑', small: 'put someone in it' },
};
export function makeTrap(ctx, type, pos, yaw) { return new TYPES[type](ctx, pos, yaw); }
