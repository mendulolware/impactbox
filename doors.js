import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// A door: a slab on a hinge in a doorway. It swings away from whoever opens it, slowly (F); a kick (H) throws it
// open and puts anyone behind it on the floor; a locked one takes a few kicks, or a round through the lock.
// Rounds go through it like any thin wall (pen in weapons.js). NPCs open doors they walk up to; the armed and
// the undead kick locked ones. Hold the mirror (M) to look under one.
//
// The body is fixed and moved by hand each frame: a fixed body is what everything that looks for walls (lines
// of sight, decals, the character controller) already sees, and a kinematic one would be invisible to them.

const OPEN = 1.9;            // radians: how far it swings
const SLOW = 2.4, FAST = 16; // radians per second: by hand, and kicked
const _v = new THREE.Vector3(), _c = new THREE.Vector3();
const yawQ = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

export class Door {
  /** Centred on (x, z), hung in a wall running along `yaw` (0 = along x). The hinge is the local -x end. */
  constructor(ctx, x, z, yaw, { w = 1.2, h = 2.1, t = 0.045, y0 = 0, locked = false, material, handleMat } = {}) {
    this.ctx = ctx;
    this.w = w; this.h = h; this.t = t; this.yaw = yaw;
    this.locked = locked;
    this.hp = locked ? 3 : 0;             // kicks the lock takes
    this.angle = 0; this.target = 0; this.speed = SLOW;
    this.removed = false;
    this.x = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));     // across the doorway
    this.n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));      // out of the doorway; it swings along this
    this.hinge = new THREE.Vector3(x, y0, z).addScaledVector(this.x, -w / 2);    // (y0: the floor it stands on)

    this.body = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.hinge.x, y0, this.hinge.z).setRotation(yawQ(yaw)));
    this.collider = ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, t / 2).setTranslation(w / 2, h / 2, 0).setFriction(0.7), this.body);
    ctx.owners.set(this.collider.handle, { kind: 'door', door: this });

    this.group = new THREE.Group();
    this.group.position.copy(this.hinge);
    this.group.rotation.y = yaw;
    this.geo = new THREE.BoxGeometry(w, h, t);
    const slab = new THREE.Mesh(this.geo, material);
    slab.position.set(w / 2, h / 2, 0);
    slab.castShadow = slab.receiveShadow = true;
    this.group.add(slab);
    this.handleGeo = new THREE.BoxGeometry(0.03, 0.03, 0.12);
    for (const s of [-1, 1]) {
      const k = new THREE.Mesh(this.handleGeo, handleMat);
      k.position.set(w - 0.12, 1.0, s * (t / 2 + 0.05));
      k.rotation.y = Math.PI / 2;
      this.group.add(k);
    }
    ctx.scene.add(this.group);
  }

  /** Which side of the doorway a point is on: +1 along n, -1 against it. */
  side(p) { return _v.set(p.x - this.hinge.x, 0, p.z - this.hinge.z).dot(this.n) < 0 ? -1 : 1; }
  /** Open enough to walk through. */
  passable() { return Math.abs(this.angle) > 1.15; }
  /** Where the handle is now. */
  handle(out) { return out.set(this.w - 0.12, 1.0, 0).applyAxisAngle(_v.set(0, 1, 0), this.yaw + this.angle).add(this.hinge); }

  /** Swing it open, away from whoever is at `from`. False if the lock stops them. */
  open(from) {
    if (this.locked) return false;
    if (this.target === 0) { this.target = this.side(from) * OPEN; this.speed = SLOW; this.ctx.sfx.door(); }
    return true;
  }
  /** F: open it, or close it again. */
  toggle(from) {
    if (this.target !== 0) { this.target = 0; this.speed = SLOW; this.ctx.sfx.door(); return; }
    if (!this.open(from)) { this.ctx.sfx.tick(); this.ctx.toast('LOCKED - kick it (H) or shoot the lock'); }
  }

  /** A boot (or a blast) against it. */
  kick(from, blast = false) {
    const side = this.side(from);
    if (this.locked) {
      this.hp -= blast ? 3 : 1;
      if (this.hp > 0) {                     // it holds: a shudder against the frame
        this.angle = side * 0.05;
        this.ctx.sfx.thud(1.6);
        return;
      }
      this.locked = false;
      this.ctx.sfx.crack();
      if (!blast) this.ctx.toast('DOOR BROKEN OPEN');
    }
    this.target = side * OPEN;
    this.speed = FAST;
    this.ctx.sfx.thud(1.8);
    this.ctx.alert('violence', this.hinge, 20);
    // anyone standing in its way goes down
    for (const r of this.ctx.ragdolls) {
      if (r.removed || r.dead) continue;
      r.center(_c).sub(this.hinge);
      const lx = _c.dot(this.x), lz = _c.dot(this.n) * -side;    // along the door, and out the way it swings
      if (lx < -0.3 || lx > this.w + 0.4 || lz < 0.02 || lz > this.w + 0.3) continue;
      r.goLimp(1.6);
      const tor = r.parts.torso;
      if (!tor.gone) tor.body.applyImpulse({ x: -side * this.n.x * 120, y: 30, z: -side * this.n.z * 120 }, true);
    }
  }

  /** A round (or a blade) into it near the lock breaks the lock. */
  shot(point, dmg) {
    this.ctx.gore.debris(point, 0xb08a5a, 4);
    if (this.locked && dmg >= 20 && this.handle(_v).distanceTo(point) < 0.22) {
      this.locked = false;
      this.hp = 0;
      this.ctx.sfx.crack();
      this.ctx.toast('LOCK SHOT OUT');
    }
  }

  update(dt) {
    if (this.angle === this.target) return;
    const d = this.target - this.angle, step = this.speed * dt;
    this.angle = Math.abs(d) <= step ? this.target : this.angle + Math.sign(d) * step;
    if (this.angle === this.target && this.speed === FAST) this.speed = SLOW;
    this.body.setRotation(yawQ(this.yaw + this.angle), true);
    this.group.rotation.y = this.yaw + this.angle;
  }

  dispose() {
    this.removed = true;
    this.ctx.owners.delete(this.collider.handle);
    this.ctx.world.removeRigidBody(this.body);
    this.ctx.scene.remove(this.group);
    this.geo.dispose();
    this.handleGeo.dispose();
  }
}
