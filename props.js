import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { getModel, tintedMaterial } from './models.js';

const TYPES = {
  crate:     { label: 'Crate',            icon: '📦', shape: 'box', half: [0.3, 0.3, 0.3], color: 0xb5833a, density: 350, hp: 70, rest: 0.1, debris: 0x9a6a2a },
  barrel:    { label: 'Barrel',           icon: '🛢️', shape: 'cyl', r: 0.3, h: 0.45, color: 0x3d6ea8, density: 250, hp: 140, rest: 0.1, debris: 0x3d6ea8 },
  explosive: { label: 'Explosive Barrel', icon: '💥', shape: 'cyl', r: 0.3, h: 0.45, color: 0xc62828, density: 250, hp: 45, rest: 0.1, explosive: true, debris: 0xc62828 },
  ball:      { label: 'Ball',             icon: '🏀', shape: 'ball', r: 0.38, color: 0xf08a24, density: 80, hp: Infinity, rest: 0.85 },
  // half extents are (x, up, forward); models come from assets/models.glb
  chair:     { label: 'Chair',            icon: '🪑', shape: 'box', half: [0.23, 0.45, 0.22], color: 0x7a4a22, density: 60, hp: 60, rest: 0.1, debris: 0x7a4a22 },
  table:     { label: 'Table',            icon: '🍽️', shape: 'box', half: [0.6, 0.38, 0.4], color: 0x7a4a22, density: 40, hp: 120, rest: 0.1, debris: 0x7a4a22 },
  cone:      { label: 'Traffic Cone',     icon: '🚧', shape: 'cyl', r: 0.17, h: 0.35, color: 0xf2441a, density: 30, hp: Infinity, rest: 0.3 },
  propane:   { label: 'Propane Tank',     icon: '🔥', shape: 'cyl', r: 0.155, h: 0.26, color: 0xdddddd, density: 300, hp: 30, rest: 0.1, explosive: true, blast: [6, 0.9] },
  pallet:    { label: 'Pallet',           icon: '🟫', shape: 'box', half: [0.6, 0.072, 0.4], color: 0xc9a066, density: 200, hp: Infinity, rest: 0.1 },
  dumpster:  { label: 'Dumpster',         icon: '🗑️', shape: 'box', half: [0.9, 0.74, 0.52], color: 0x55663c, density: 120, hp: Infinity, rest: 0.05 },
  lamp:      { label: 'Street Lamp',      icon: '💡', shape: 'box', half: [0.12, 2.1, 0.12], color: 0x333a42, density: 600, hp: Infinity, rest: 0.05 },
  sandbags:  { label: 'Sandbags',         icon: '🧱', shape: 'box', half: [0.95, 0.267, 0.18], color: 0x8a744a, density: 900, hp: Infinity, rest: 0.0 },
  toilet:    { label: 'Toilet',           icon: '🚽', shape: 'box', half: [0.2, 0.4, 0.31], color: 0xe6e6e0, density: 250, hp: 60, rest: 0.05, debris: 0xe6e6e0 },
  car:       { label: 'Car',              icon: '🚗', shape: 'box', half: [0.92, 0.66, 2.14], color: 0x2a5a9a, density: 145, hp: 380, rest: 0.05, explosive: true, blast: [9, 1.5] },
  block:     { label: 'Heavy Block',      icon: '🧱', shape: 'box', half: [0.5, 0.5, 0.5], color: 0x6f7378, density: 1600, hp: Infinity, rest: 0.05 },
  plank:     { label: 'Plank',            icon: '🪵', shape: 'box', half: [1.1, 0.05, 0.14], color: 0xc9a066, density: 300, hp: Infinity, rest: 0.1 },
  rocket:    { label: 'Rocket',           icon: '🚀', shape: 'ball', r: 0.06, color: 0x4a5a3a, density: 400, hp: Infinity, rest: 0 },
  grenade:   { label: 'Grenade',          icon: '💣', shape: 'ball', r: 0.07, color: 0x2e4a2e, density: 5200, hp: Infinity, rest: 0.3, fuse: 2.4 },
};

export const PROP_TYPES = TYPES;

// prop type -> model name in assets/models.glb
const CAR_PAINT = [0x0d2350, 0x5a0d0d, 0x1a1a1c, 0xb9bcc0, 0x0f3a24, 0xd9d6cc, 0x6a5a1a, 0x3a3f46];
const MODEL_OF = {
  ball: 'Ball', crate: 'Crate', barrel: 'Barrel', explosive: 'ExplosiveBarrel',
  block: 'Block', plank: 'Plank', grenade: 'Grenade', rocket: 'Rocket',
  chair: 'Chair', table: 'Table', cone: 'TrafficCone', propane: 'PropaneTank', pallet: 'WoodenPallet',
  dumpster: 'Dumpster', lamp: 'StreetLamp', sandbags: 'SandbagWall', toilet: 'Toilet', car: 'Car',
};

const geoCache = new Map();
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3(0, 0, -1);
const rnd = (a, b) => a + Math.random() * (b - a);

export class Prop {
  constructor(ctx, type, pos, rotY = 0) {
    const d = TYPES[type];
    this.ctx = ctx;
    this.type = type;
    this.def = d;
    this.hp = d.hp;
    this.removed = false;
    this.fuse = d.fuse || 0;
    this.exploded = false;

    const { world, scene } = ctx;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) })
        .setLinearDamping(0.05).setAngularDamping(0.3)
        .setCcdEnabled(type === 'grenade' || type === 'ball' || type === 'rocket')
    );
    let cd, g;
    if (d.shape === 'box') {
      cd = RAPIER.ColliderDesc.cuboid(...d.half);
      g = geo(`b${d.half}`, () => new THREE.BoxGeometry(d.half[0] * 2, d.half[1] * 2, d.half[2] * 2));
    } else if (d.shape === 'cyl') {
      cd = RAPIER.ColliderDesc.cylinder(d.h, d.r);
      g = geo(`c${d.h},${d.r}`, () => new THREE.CylinderGeometry(d.r, d.r, d.h * 2, 16));
    } else {
      cd = RAPIER.ColliderDesc.ball(d.r);
      g = geo(`s${d.r}`, () => new THREE.SphereGeometry(d.r, 18, 14));
    }
    cd.setDensity(d.density).setFriction(0.8).setRestitution(d.rest);
    this.collider = world.createCollider(cd, this.body);

    this.mat = null; // per-instance material (only when we need to animate or dispose it)
    this.mesh = getModel(MODEL_OF[type]);
    if (this.mesh) {
      if (type === 'grenade') {
        this.mesh.scale.setScalar(2.0); // the viewmodel-sized grenade, scaled up to its collider
        this.mesh.traverse((o) => {
          if (o.isMesh && o.material.name === 'GrenadeBody') {
            this.mat = this.mat || o.material.clone();
            o.material = this.mat;
          }
        });
      }
      if (type === 'car') {             // every car gets its own paint
        const paint = tintedMaterial('CarPaint', CAR_PAINT[Math.floor(Math.random() * CAR_PAINT.length)]);
        this.mesh.traverse((o) => { if (o.isMesh && o.material.name === 'CarPaint') o.material = paint; });
      }
    } else {
      // no Blender model for this type: draw the collider shape
      this.mat = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.7 });
      this.mesh = new THREE.Mesh(g, this.mat);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
      if (type === 'explosive') {
        const band = new THREE.Mesh(geo('band', () => new THREE.CylinderGeometry(0.305, 0.305, 0.16, 16)),
          new THREE.MeshStandardMaterial({ color: 0xffd400, roughness: 0.6 }));
        this.mesh.add(band);
      }
    }
    scene.add(this.mesh);
    ctx.owners.set(this.collider.handle, { kind: 'prop', prop: this });
  }

  /** Send a rocket on its way. */
  launch(dir, speed) {
    this.body.setGravityScale(0.12, true);
    this.body.setLinvel({ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, true);
    this.life = 5;
  }

  /** Rockets fly nose-first, trail smoke, and go off on whatever is in front of them. */
  flyRocket(dt) {
    const { world, gore, player } = this.ctx;
    const t = this.body.translation(), v = this.body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z) || 1;
    const d = { x: v.x / sp, y: v.y / sp, z: v.z / sp };
    this.life -= dt;
    const mine = this.collider.handle, pc = player.collider.handle;
    const hit = world.castRay(new RAPIER.Ray(t, d), sp * dt + 0.3, true, undefined, undefined, undefined, undefined,
      (c) => c.handle !== mine && c.handle !== pc);
    if (hit || this.life <= 0) {
      const k = hit ? hit.timeOfImpact : 0;
      this.exploded = true;
      this.ctx.explode({ x: t.x + d.x * k, y: t.y + d.y * k, z: t.z + d.z * k }, 7, 1.15);
      this.remove();
      return true;
    }
    if (this.drone) return false;
    for (let i = 0; i < 2; i++) {
      const g = rnd(0.3, 0.5);
      gore.smoke.emit(t.x - d.x * 0.2, t.y - d.y * 0.2, t.z - d.z * 0.2, rnd(-0.4, 0.4), rnd(0, 0.6), rnd(-0.4, 0.4),
        rnd(0.25, 0.45), rnd(0.7, 1.4), -0.25, g, g, g, 0, 1);
    }
    gore.fire.emit(t.x - d.x * 0.25, t.y - d.y * 0.25, t.z - d.z * 0.25, -d.x * 4, -d.y * 4, -d.z * 4, 0.22, 0.12, 0, 1, 0.6, 0.15, 0, 0);
    return false;
  }

  hit(dmg, point, dir, impulse, opts = {}) {
    if (this.removed) return;
    if (impulse > 0) {
      this.body.applyImpulseAtPoint({ x: dir.x * impulse, y: dir.y * impulse, z: dir.z * impulse }, point, true);
    }
    this.ctx.gore.sparks(point, dir.clone().multiplyScalar(-1), 4);
    this.hp -= dmg;
    if (this.hp <= 0) this.destroyed();
  }

  destroyed() {
    if (this.removed) return;
    const t = this.body.translation();
    const p = { x: t.x, y: t.y, z: t.z };
    if (this.def.explosive) {
      // slight delay so chain reactions ripple instead of recursing
      this.removeSoon = true;
      const [radius, power] = this.def.blast || [7, 1];
      this.ctx.later(0.08, () => { this.ctx.explode(p, radius, power); this.remove(); });
      this.hp = Infinity;
      return;
    }
    if (this.def.debris) this.ctx.gore.debris(p, this.def.debris, 18);
    this.remove();
  }

  update(dt) {
    if (this.removed) return;
    if (this.life !== undefined && this.flyRocket(dt)) return; // exploded: the body is gone
    if (this.fuse > 0) {
      this.fuse -= dt;
      const blink = Math.sin(this.fuse * 28) > 0;
      if (this.mat) this.mat.emissive.setHex(blink ? 0xff2200 : 0x000000);
      if (this.fuse <= 0 && !this.exploded) {
        this.exploded = true;
        const t = this.body.translation();
        this.ctx.explode({ x: t.x, y: t.y, z: t.z }, 6.5, 1);
        this.remove();
        return; // the body is gone: touching it again would panic the wasm world
      }
    }
    const t = this.body.translation();
    if (t.y < -30) this.remove();
  }

  sync() {
    if (this.removed) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    if (this.life !== undefined) {
      const v = this.body.linvel(); // rockets point where they are going
      if (_v.set(v.x, v.y, v.z).lengthSq() > 1) this.mesh.quaternion.setFromUnitVectors(_fwd, _v.normalize());
    } else {
      this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.ctx.owners.delete(this.collider.handle);
    this.ctx.world.removeRigidBody(this.body);
    this.ctx.scene.remove(this.mesh);
    if (this.mat) this.mat.dispose();
  }
}
