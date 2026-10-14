import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { engine } from './audio.js';

// Driving: F beside a car gets in, F again gets out. Arcade handling: W/S drive and brake (and reverse),
// A/D steer (harder the slower you go), Space is the handbrake and lets the back step out. The view sits behind
// and above, swinging round after the car. The car stays an ordinary prop the whole time (it can be shot, set
// alight, blown up: that throws you out first); only its tilt is locked while someone drives it.
// People in its path are knocked down just before the bumper arrives (Ragdoll.knockBy): an NPC on its feet is
// kinematic, and a kinematic body would stop 1.5 tonnes dead. The driver's own collider is off while inside.

const TOP = 24, BACK = 9;                  // m/s, forward and in reverse
const HALF = [0.92, 0.66, 2.14];           // the car's collider (props.js)
const _v = new THREE.Vector3();

const yawOf = (q) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Driving {
  constructor(ctx) {
    this.ctx = ctx;
    this.car = null;
    this.camYaw = 0;
    this.cam = new THREE.Vector3();
  }

  /** F pressed with no door ahead: get into a car within a step of you. False if there is none. */
  tryEnter() {
    const p = this.ctx.player.pos;
    for (const pr of this.ctx.props) {
      if (pr.type !== 'car' || pr.removed || pr.removeSoon) continue;
      const t = pr.body.translation(), yaw = yawOf(pr.body.rotation());
      // how far outside its box you stand
      const dx = p.x - t.x, dz = p.z - t.z, c = Math.cos(yaw), s = Math.sin(yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.hypot(Math.max(0, Math.abs(lx) - HALF[0]), Math.max(0, Math.abs(lz) - HALF[2])) > 1.1 || Math.abs(p.y - t.y) > 2) continue;
      if (pr.puppet) { this.ctx.toast?.('ONLY THE HOST CAN DRIVE'); return true; }     // (co-op guest: the host's world moves the cars)
      this.enter(pr);
      return true;
    }
    return false;
  }

  enter(car) {
    const pl = this.ctx.player, b = car.body, t = b.translation(), yaw = yawOf(b.rotation());
    this.car = this.ctx.car = car;
    document.body.classList.add('driving');
    // back on its wheels if it was over, and only turning about the vertical while driven
    b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    b.setTranslation({ x: t.x, y: t.y + 0.3, z: t.z }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.setEnabledRotations(false, true, false, true);
    // it is a box on the ground, not four wheels: no friction while driven (update() does the tyres' grip)
    car.collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    car.collider.setFriction(0);
    pl.collider.setEnabled(false);
    this.camYaw = yaw;
    this.cam.set(t.x + Math.sin(yaw) * 6.5, t.y + 2.6, t.z + Math.cos(yaw) * 6.5);
    this.ctx.sfx.door?.();
    this.ctx.toast?.('W/S DRIVE · A/D STEER · SPACE HANDBRAKE · F GET OUT');
  }

  exit() {
    const car = this.car, pl = this.ctx.player;
    this.car = this.ctx.car = null;
    document.body.classList.remove('driving');
    engine(null);
    if (!car.removed) {
      car.body.setEnabledRotations(true, true, true, true);
      car.collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average);
      car.collider.setFriction(0.8);
      // out of the driver's door (the left), or the other one, or behind, or in front: wherever there is room
      const t = car.body.translation(), yaw = yawOf(car.body.rotation());
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
      const feet = t.y - HALF[1];
      for (const [a, b] of [[-1.75, 0], [1.75, 0], [0, -3.2], [0, 3.2], [-1.75, 1.5], [1.75, -1.5]]) {
        const x = t.x + rx * a + fx * b, z = t.z + rz * a + fz * b;
        if (!this.fits(x, feet, z, car.body)) continue;
        pl.pos.set(x, feet + 0.9, z);
        break;
      }
      pl.yaw = yaw; pl.pitch = 0;
    }
    pl.body.setTranslation(pl.pos, true);
    pl.body.setNextKinematicTranslation(pl.pos);
    pl.vel.set(0, 0, 0);
    pl.collider.setEnabled(true);
  }

  /** Room for someone standing at (x, feet, z)? */
  fits(x, feet, z, not) {
    let inside = false;
    this.ctx.world.intersectionsWithShape({ x, y: feet + 0.95, z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(0.6, 0.3),
      () => { inside = true; return false; }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, not);
    return !inside;
  }

  /** Before the physics step: the wheels. */
  update(dt, input, active) {
    const car = this.car;
    if (!car) return;
    if (car.removed || car.removeSoon || this.ctx.player.dead) { this.exit(); return; }
    if (dt <= 0) return;
    const k = input.keys, b = car.body;
    const thr = active ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0;
    const steer = active ? (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0) : 0;
    const hand = active && k.has('Space');
    const t = b.translation(), yaw = yawOf(b.rotation());
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;      // forward, right
    const v = b.linvel();
    let vf = v.x * fx + v.z * fz, vs = v.x * rx + v.z * rz;
    const ground = this.ctx.world.castRay(new RAPIER.Ray(t, { x: 0, y: -1, z: 0 }), HALF[1] + 0.35, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, b);
    if (ground) {                                                           // (in the air it just flies)
      if (thr * vf < -0.5) vf += thr * 16 * dt;                             // braking against the way it rolls
      else if (thr > 0) vf += 9 * dt * Math.max(0, 1 - vf / TOP);
      else if (thr < 0) vf -= 6 * dt * Math.max(0, 1 + vf / BACK);
      else vf *= 1 - 0.5 * dt;                                              // rolling to a stop
      if (hand) vf *= 1 - 2.5 * dt;
      vs *= Math.max(0, 1 - (hand ? 1.2 : 9) * dt);                         // the tyres hold it sideways (unless the handbrake is on)
      const turn = steer * 2.0 * THREE.MathUtils.clamp(vf / 5, -1, 1) * (1 - 0.4 * Math.min(1, Math.abs(vf) / TOP));
      b.setLinvel({ x: fx * vf + rx * vs, y: v.y, z: fz * vf + rz * vs }, true);
      b.setAngvel({ x: 0, y: turn * (hand ? 1.6 : 1), z: 0 }, true);
    }
    engine(Math.min(1, Math.abs(vf) / TOP * 0.8 + Math.abs(thr) * 0.2));
    // whoever is in the way goes down
    const sp = Math.abs(vf);
    if (sp < 3) return;
    const dir = Math.sign(vf), reach = HALF[2] + 0.5 + sp * dt * 2, m = Math.min(b.mass(), 25 * sp);
    _v.set(fx * vf, 0, fz * vf);
    for (const r of this.ctx.ragdolls) {
      if (r.removed || r.mode !== 'anim' || r.parts.pelvis.gone) continue;
      const c = r.parts.pelvis.body.translation(), dx = c.x - t.x, dz = c.z - t.z;
      const along = (dx * fx + dz * fz) * dir, across = Math.abs(dx * rx + dz * rz);
      if (along > 0 && along < reach && across < HALF[0] + 0.35 && Math.abs(c.y - t.y) < 1.5) r.knockBy('pelvis', _v, sp, m);
    }
  }

  /** After the physics step: the view behind the car, and the driver riding along inside it. */
  view(dt) {
    const car = this.car;
    if (!car || car.removed) return;
    const t = car.body.translation(), yaw = yawOf(car.body.rotation()), pl = this.ctx.player, cam = this.ctx.camera;
    this.camYaw += wrap(yaw - this.camYaw) * Math.min(1, 3.5 * dt);
    const sx = Math.sin(this.camYaw), sz = Math.cos(this.camYaw);
    // pulled in short of any wall behind
    const hit = this.ctx.gore.castFixed(t.x, t.y + 1, t.z, sx * 0.93, 0.37, sz * 0.93, 7);
    const back = hit ? Math.max(1.5, hit.timeOfImpact - 0.4) : 7;
    this.cam.lerp(_v.set(t.x + sx * back * 0.93, t.y + 1 + back * 0.37, t.z + sz * back * 0.93), Math.min(1, 12 * dt));
    cam.position.copy(this.cam);
    cam.lookAt(t.x - sx * 3, t.y + 0.5, t.z - sz * 3);
    pl.pos.set(t.x, t.y - 0.35, t.z);                // (low: in co-op the other player sees your head at the windows, not through the roof)
    pl.body.setTranslation(pl.pos, true);
    pl.body.setNextKinematicTranslation(pl.pos);
    pl.vel.set(0, 0, 0);
  }
}
