import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const EYE = 0.7; // eye offset above capsule centre

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
    this.yaw = 0;
    this.pitch = 0;
    this.kickPitch = 0;
    this.grounded = false;
    this.bob = 0;
    this.spawn = pos;
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.5, 1.5);
  }

  recoil(k) { this.kickPitch += k; }

  update(dt, input, enabled) {
    const k = input.keys;
    const f = enabled ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0;
    const s = enabled ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : 0;
    const sprint = enabled && (k.has('ShiftLeft') || k.has('ShiftRight'));
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * f + cos * s;
    let wz = -cos * f - sin * s;
    const l = Math.hypot(wx, wz);
    if (l > 0) { wx /= l; wz /= l; }
    const speed = sprint ? 9 : 5.2;
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

    if (this.grounded && l > 0) this.bob += dt * speed * 1.6;
    this.kickPitch *= Math.max(0, 1 - dt * 9);

    const cam = this.ctx.camera;
    cam.position.set(this.pos.x, this.pos.y + EYE + Math.sin(this.bob * 2) * 0.025 * (this.grounded ? 1 : 0), this.pos.z);
    cam.rotation.set(this.pitch + this.kickPitch, this.yaw, 0, 'YXZ');
  }
}
