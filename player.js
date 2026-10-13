import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const EYE = 0.7;          // eye offset above capsule centre
const HELMET_UP = 0.1;    // the helmet camera sits a little above the eyes
const FOV = 75, FOV_HELMET = 98;

const _e = new THREE.Euler();

export class Player {
  constructor(ctx, pos) {
    this.ctx = ctx;
    const { world } = ctx;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z)
    );
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.35), this.body);

    this.cc = world.createCharacterController(0.02);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.setSlideEnabled(true);
    this.cc.enableAutostep(0.45, 0.15, false);
    this.cc.enableSnapToGround(0.25);
    this.cc.setMaxSlopeClimbAngle(55 * Math.PI / 180);
    this.cc.setMinSlopeSlideAngle(65 * Math.PI / 180);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(60);

    this.pos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;             // where the player is aiming
    this.pitch = 0;
    this.camYaw = 0;          // where the camera is looking (lags behind in helmet cam)
    this.camPitch = 0;
    this.aimOff = { yaw: 0, pitch: 0 };       // aim minus camera: the weapon rig turns by this
    this.aimQuat = new THREE.Quaternion();    // true aim direction, used for shooting
    this.kickPitch = 0;
    this.shake = 0;
    this.sens = 1;
    this.fov = FOV;
    this.grounded = false;
    this.bob = 0;
    this.spawn = pos;
    this.eye = new THREE.Vector3(pos.x, pos.y + EYE, pos.z);   // what NPCs look at
    this.health = 100;
    this.dead = false;
    this.deadT = 0;
    this.sinceHurt = 99;
    this.hurtFlash = 0;
  }

  /** Put the player somewhere else (a new map), facing `yaw`. That becomes where they come back to life. */
  teleport(pos, yaw = 0) {
    this.spawn = { x: pos.x, y: pos.y, z: pos.z };
    this.pos.set(pos.x, pos.y, pos.z);
    this.body.setTranslation(this.spawn, true);
    this.body.setNextKinematicTranslation(this.spawn);
    this.vel.set(0, 0, 0);
    this.yaw = this.camYaw = yaw;
    this.pitch = this.camPitch = 0;
    this.health = 100;
    this.dead = false;
  }

  /** Something hit the player. `from` is where it came from. */
  hurt(amount, from) {
    if (this.dead) return;
    this.health -= amount;
    this.sinceHurt = 0;
    this.hurtFlash = 1;
    this.shake = Math.min(1, this.shake + 0.7);
    if (from) { // shoved away from the attacker
      const dx = this.pos.x - from.x, dz = this.pos.z - from.z, l = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / l) * 3; this.vel.z += (dz / l) * 3;
    }
    if (this.health <= 0) { this.health = 0; this.dead = true; this.deadT = 0; }
  }

  look(dx, dy) {
    const s = 0.0022 * this.sens;
    this.yaw -= dx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * s, -1.5, 1.5);
  }

  recoil(k) {
    this.kickPitch += k;
    this.shake = Math.min(1, this.shake + k * 4);
  }

  /** dt is game time (slow-mo scaled); rdt is real time, used for camera smoothing. */
  update(dt, input, enabled, rdt = dt) {
    const k = input.keys;
    // health: recovers after a few quiet seconds; death is a short lie-down, then back to the start
    this.sinceHurt += rdt;
    this.hurtFlash = Math.max(0, this.hurtFlash - rdt * 2.5);
    if (this.dead) {
      enabled = false;
      this.deadT += rdt;
      if (this.deadT > 3.5) {
        this.dead = false;
        this.health = 100;
        this.pos.set(this.spawn.x, this.spawn.y, this.spawn.z);
        this.body.setTranslation(this.spawn, true);
        this.vel.set(0, 0, 0);
      }
    } else if (this.sinceHurt > 5) {
      this.health = Math.min(100, this.health + 9 * rdt);
    }
    const helmet = !!this.ctx.helmet;
    const ads = this.ctx.weapons ? this.ctx.weapons.ads : 0;
    const zoom = this.ctx.weapons ? this.ctx.weapons.zoom : 0.3;
    this.sens = 1 - (zoom > 0.5 ? 0.86 : 0.45) * ads;   // scopes need a much slower hand

    const f = enabled ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0;
    const s = enabled ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : 0;
    const sprint = enabled && ads < 0.3 && (k.has('ShiftLeft') || k.has('ShiftRight'));
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * f + cos * s;
    let wz = -cos * f - sin * s;
    const l = Math.hypot(wx, wz);
    if (l > 0) { wx /= l; wz /= l; }
    const speed = (sprint ? 9 : 5.2) * (1 - 0.45 * ads);
    const accel = this.grounded ? 14 : 3.5;
    const a = Math.min(1, accel * dt);
    this.vel.x += (wx * speed - this.vel.x) * a;
    this.vel.z += (wz * speed - this.vel.z) * a;
    this.vel.y -= 24 * dt;
    if (this.grounded && enabled && k.has('Space')) { this.vel.y = 8.2; this.grounded = false; }

    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.cc.computeColliderMovement(this.collider, desired);
    const mv = this.cc.computedMovement();
    const t = this.body.translation();
    this.pos.set(t.x + mv.x, t.y + mv.y, t.z + mv.z);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });

    this.grounded = this.cc.computedGrounded();
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    if (mv.y < desired.y - 1e-4 && this.vel.y > 0) this.vel.y = 0; // bumped head
    if (this.pos.y < -25) {
      this.pos.set(this.spawn.x, this.spawn.y, this.spawn.z);
      this.body.setTranslation(this.spawn, true);
      this.body.setNextKinematicTranslation(this.spawn);
      this.vel.set(0, 0, 0);
    }

    const moving = this.grounded && l > 0;
    if (moving) this.bob += dt * speed * 1.6;
    this.kickPitch *= Math.max(0, 1 - dt * 9);
    this.shake *= Math.max(0, 1 - rdt * 7);

    // ---- camera
    const aimPitch = this.pitch + this.kickPitch;
    if (helmet) {
      // a head-mounted camera follows the aim with a slight delay; the weapon leads it
      const c = 1 - Math.exp(-rdt * 15);
      let dy = this.yaw - this.camYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.camYaw += dy * c;
      this.camPitch += (aimPitch - this.camPitch) * c;
      let off = this.yaw - this.camYaw;
      this.aimOff.yaw = Math.atan2(Math.sin(off), Math.cos(off));
      this.aimOff.pitch = aimPitch - this.camPitch;
    } else {
      this.camYaw = this.yaw;
      this.camPitch = aimPitch;
      this.aimOff.yaw = 0;
      this.aimOff.pitch = 0;
    }
    this.aimQuat.setFromEuler(_e.set(aimPitch, this.yaw, 0, 'YXZ'));

    const steady = 1 - 0.7 * ads;
    const bobAmp = (helmet ? 0.05 : 0.025) * steady * (this.grounded ? 1 : 0);
    // helmet cam: head sways with each step, and tips toward the stock when the weapon is shouldered
    const roll = helmet ? Math.sin(this.bob) * 0.014 * steady * (moving ? 1 : 0) - 0.05 * ads : 0;
    const sh = helmet ? this.shake * 0.02 : this.shake * 0.004;

    // dead: the view slumps to the floor and tips over
    const slump = this.dead ? Math.min(1, this.deadT / 0.7) : 0;
    const fall = slump * slump * (3 - 2 * slump);

    const cam = this.ctx.camera;
    cam.position.set(
      this.pos.x,
      this.pos.y + (EYE + (helmet ? HELMET_UP : 0)) * (1 - fall) - 0.6 * fall + Math.sin(this.bob * 2) * bobAmp,
      this.pos.z
    );
    cam.rotation.set(
      this.camPitch * (1 - fall) + 0.25 * fall + (Math.random() - 0.5) * sh,
      this.camYaw + (Math.random() - 0.5) * sh,
      roll + 1.25 * fall + (Math.random() - 0.5) * sh,
      'YXZ'
    );
    this.eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);

    // eyes narrow in on the sights; a helmet camera has a fixed lens, so it barely changes
    const fov = (helmet ? FOV_HELMET : FOV) * (1 - (helmet && zoom < 0.5 ? 0.05 : zoom) * ads);
    this.fov += (fov - this.fov) * Math.min(1, rdt * 14);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
