import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// drop kinds
const BLOOD = 0, BIT = 1, DEBRIS = 2;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _z = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- particles
class ParticleSet {
  /** stretch: elongate along velocity (droplets). scaleFn(lifeLeft01) -> size multiplier. */
  constructor(scene, max, material, { stretch = false, scaleFn = null, detail = 1 } = {}) {
    this.max = max;
    this.stretch = stretch;
    this.scaleFn = scaleFn;
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, detail), material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(0xffffff));
    scene.add(this.mesh);
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.kind = new Uint8Array(max);
  }

  emit(x, y, z, vx, vy, vz, size, life, grav, r, g, b, kind = 0, drag = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grav[i] = grav; this.kind[i] = kind; this.drag[i] = drag;
  }

  /** collide(i, dt) may return true to kill the particle (called before it moves). */
  update(dt, collide) {
    let i = 0;
    while (i < this.n) {
      const i3 = i * 3;
      this.life[i] -= dt;
      let dead = this.life[i] <= 0 || this.pos[i3 + 1] < -20;
      if (!dead) {
        this.vel[i3 + 1] -= this.grav[i] * dt;
        if (this.drag[i] > 0) {
          const k = Math.max(0, 1 - this.drag[i] * dt);
          this.vel[i3] *= k; this.vel[i3 + 1] *= k; this.vel[i3 + 2] *= k;
        }
        if (collide && collide(i, dt)) dead = true;
        else {
          this.pos[i3] += this.vel[i3] * dt;
          this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
          this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        }
      }
      if (dead) {
        const l = --this.n;
        if (i !== l) {
          const l3 = l * 3;
          for (let k = 0; k < 3; k++) {
            this.pos[i3 + k] = this.pos[l3 + k];
            this.vel[i3 + k] = this.vel[l3 + k];
            this.col[i3 + k] = this.col[l3 + k];
          }
          this.life[i] = this.life[l]; this.maxLife[i] = this.maxLife[l];
          this.size[i] = this.size[l]; this.grav[i] = this.grav[l];
          this.kind[i] = this.kind[l]; this.drag[i] = this.drag[l];
        }
        continue;
      }
      let s = this.size[i];
      if (this.scaleFn) s *= this.scaleFn(this.life[i] / this.maxLife[i]);
      _p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      if (this.stretch) {
        _d.set(this.vel[i3], this.vel[i3 + 1], this.vel[i3 + 2]);
        const sp = _d.length();
        if (sp > 0.3) _q.setFromUnitVectors(_z, _d.multiplyScalar(1 / sp)); else _q.identity();
        _s.set(s, s, s * (1 + Math.min(sp, 14) * 0.22));
      } else {
        _q.identity();
        _s.set(s, s, s);
      }
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(this.col[i3], this.col[i3 + 1], this.col[i3 + 2]));
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- decals
/** Procedural splatter alpha shapes so decals aren't plain circles. */
function splatTexture(seed) {
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.filter = 'blur(1.2px)';
  g.fillStyle = '#fff';
  const dot = (x, y, rad) => { g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); };
  // lumpy core
  for (let k = 0; k < 16; k++) {
    const a = r() * Math.PI * 2, d = r() * 17;
    dot(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 9 + r() * 13);
  }
  // fingers radiating out, each ending in droplets
  const fingers = 7 + Math.floor(r() * 6);
  for (let k = 0; k < fingers; k++) {
    const a = r() * Math.PI * 2, len = 26 + r() * 30;
    for (let t = 0; t < 1; t += 0.08) {
      const d = 14 + t * len;
      dot(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, Math.max(0.8, (1 - t) * (3 + r() * 3)));
    }
    if (r() > 0.4) dot(64 + Math.cos(a) * (len + 18), 64 + Math.sin(a) * (len + 18), 1 + r() * 2.5);
  }
  // stray specks
  for (let k = 0; k < 22; k++) {
    const a = r() * Math.PI * 2, d = 30 + r() * 30;
    dot(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0.6 + r() * 2.2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class DecalSet {
  constructor(scene, max, material) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(0xffffff));
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.head = 0;
    this.count = 0;
  }

  add(pos, quat, sx, sy, r, g, b) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.count = Math.min(this.count + 1, this.max);
    this.mesh.count = this.count;
    this.set(i, pos, quat, sx, sy);
    this.mesh.setColorAt(i, _c.setRGB(r, g, b));
    this.mesh.instanceColor.needsUpdate = true;
    return i;
  }

  set(i, pos, quat, sx, sy) {
    _m.compose(pos, quat, _s.set(sx, sy, 1));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.head = 0; this.count = 0; this.mesh.count = 0; }
}

function lumpyGeometry(seed, flat = 1) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // hash on position so duplicated verts move together
    const h = Math.sin(x * 12.9898 * seed + y * 78.233 + z * 37.719 * seed) * 43758.5453;
    const k = 0.7 + (h - Math.floor(h)) * 0.6;
    pos.setXYZ(i, x * k, y * k * flat, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- gore system
export class Gore {
  constructor(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;

    // wet-looking blood drops (lit, glossy, stretched along their velocity)
    this.drops = new ParticleSet(scene, 2600,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0 }),
      { stretch: true, detail: 0 });
    this.fire = new ParticleSet(scene, 500,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      { scaleFn: (f) => 0.25 + 0.75 * f });
    this.smoke = new ParticleSet(scene, 300,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
      { scaleFn: (f) => Math.min(1, f * 3) * (1.6 - 0.6 * f) });

    // splatter decals: 4 shapes, glossy so pools catch the light
    this.splatTex = [1, 2, 3, 4].map(splatTexture);
    const decalMat = (map) => new THREE.MeshStandardMaterial({
      map, color: 0xffffff, transparent: true, depthWrite: false, roughness: 0.12, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.splats = this.splatTex.map((t) => new DecalSet(scene, 420, decalMat(t)));
    this.holes = new DecalSet(scene, 300, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
      map: (() => { // soft dark dot
        const c = document.createElement('canvas'); c.width = c.height = 32;
        const g = c.getContext('2d');
        const gr = g.createRadialGradient(16, 16, 2, 16, 16, 15);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
        return new THREE.CanvasTexture(c);
      })(),
    }));
    this.growing = []; // pools still spreading

    // wounds stuck onto body parts
    this.woundGeo = new THREE.PlaneGeometry(1, 1);
    this.woundMats = this.splatTex.map((map) => new THREE.MeshStandardMaterial({
      map, color: 0x4a0303, transparent: true, depthWrite: false, roughness: 0.25,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    this.holeGeo = new THREE.CircleGeometry(0.5, 10);
    this.holeMat = new THREE.MeshBasicMaterial({ color: 0x140000, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });

    // physical meat chunks
    this.chunkGeos = [lumpyGeometry(1.3), lumpyGeometry(2.1, 0.6), lumpyGeometry(3.7, 0.8)];
    this.boneGeo = new THREE.CylinderGeometry(0.25, 0.32, 2.2, 6);
    this.meatMat = new THREE.MeshStandardMaterial({ color: 0x6a0c0c, roughness: 0.3 });
    this.fatMat = new THREE.MeshStandardMaterial({ color: 0x9a3a32, roughness: 0.35 });
    this.boneMat = new THREE.MeshStandardMaterial({ color: 0xd9d2bd, roughness: 0.6 });
    this.chunkList = [];
    this.maxChunks = 70;

    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

    this.flash = new THREE.PointLight(0xffa24a, 0, 40, 2);
    scene.add(this.flash);
    this.flashT = 0;

    this._collideDrop = this._collideDrop.bind(this);
  }

  // ------------------------------------------------------------ emitters
  /** Spray of blood. dir = general direction of travel. */
  blood(p, dir, count = 12, speed = 4, spread = 0.9) {
    for (let k = 0; k < count; k++) {
      const s = speed * rnd(0.25, 1.15);
      const j = spread * speed * 0.5;
      const big = Math.random() < 0.18;
      this.drops.emit(p.x, p.y, p.z,
        dir.x * s + rnd(-1, 1) * j, dir.y * s + rnd(-0.4, 1) * j, dir.z * s + rnd(-1, 1) * j,
        big ? rnd(0.045, 0.075) : rnd(0.018, 0.04), rnd(1.5, 2.6), 9.8,
        rnd(0.17, 0.34), 0.0, 0.0, BLOOD);
    }
  }

  /** Heavy burst with meat bits: limbs coming off. */
  gush(p, dir, count = 40, speed = 6) {
    this.blood(p, dir, count, speed, 1.1);
    this.blood(p, UP, Math.floor(count * 0.4), speed * 0.6, 1.4);
    for (let k = 0; k < count * 0.2; k++) {
      const s = speed * rnd(0.2, 0.7);
      this.drops.emit(p.x, p.y, p.z, rnd(-1, 1) * s, rnd(0.3, 1.3) * s, rnd(-1, 1) * s,
        rnd(0.04, 0.08), rnd(1.5, 2.5), 10.5, rnd(0.2, 0.3), 0.02, 0.02, BIT);
    }
  }

  gibs(p, count = 50) {
    for (let k = 0; k < count; k++) {
      const s = rnd(2, 9), a = rnd(0, Math.PI * 2), e = rnd(-0.2, 1.1);
      const vx = Math.cos(a) * Math.cos(e) * s, vy = Math.sin(e) * s + 2, vz = Math.sin(a) * Math.cos(e) * s;
      if (k % 4 === 0) this.drops.emit(p.x, p.y, p.z, vx, vy, vz, rnd(0.05, 0.09), rnd(2, 3.5), 10.5, 0.25, 0.02, 0.02, BIT);
      else this.drops.emit(p.x, p.y, p.z, vx, vy, vz, rnd(0.02, 0.06), rnd(1.5, 2.6), 9.8, rnd(0.17, 0.34), 0, 0, BLOOD);
    }
  }

  sparks(p, normal, count = 6) {
    for (let k = 0; k < count; k++) {
      const s = rnd(2, 6);
      this.fire.emit(p.x, p.y, p.z,
        normal.x * s + rnd(-2, 2), normal.y * s + rnd(-1, 2), normal.z * s + rnd(-2, 2),
        rnd(0.02, 0.045), rnd(0.15, 0.4), 9.8, 1, rnd(0.6, 0.9), 0.25);
    }
  }

  debris(p, color, count = 14) {
    _c.set(color);
    for (let k = 0; k < count; k++) {
      const s = rnd(1.5, 5);
      this.drops.emit(p.x, p.y, p.z, rnd(-1, 1) * s, rnd(0.5, 1.4) * s, rnd(-1, 1) * s,
        rnd(0.05, 0.11), rnd(0.8, 1.6), 11, _c.r * rnd(0.7, 1.1), _c.g * rnd(0.7, 1.1), _c.b * rnd(0.7, 1.1), DEBRIS);
    }
  }

  explosion(p, radius = 7) {
    for (let k = 0; k < 110; k++) {
      const a = rnd(0, Math.PI * 2), e = rnd(-0.3, 1.3), s = rnd(1, radius * 1.7);
      const hot = Math.random();
      this.fire.emit(p.x, p.y + 0.3, p.z,
        Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s,
        rnd(0.35, 1.1), rnd(0.25, 0.75), -1, 0.9, 0.25 + hot * 0.4, hot * 0.08, 0, 3);
    }
    for (let k = 0; k < 45; k++) {
      const a = rnd(0, Math.PI * 2), s = rnd(0.5, 3.5);
      const g = rnd(0.1, 0.24);
      this.smoke.emit(p.x + rnd(-0.5, 0.5), p.y + 0.6, p.z + rnd(-0.5, 0.5), Math.cos(a) * s, rnd(1, 4.5), Math.sin(a) * s,
        rnd(0.8, 1.7), rnd(1.6, 3.2), -0.4, g, g, g, 0, 1.3);
    }
    this.sparks(p, UP, 30);
    // scorch mark
    const hit = this.castFixed(p.x, p.y + 0.3, p.z, 0, -1, 0, 2.5);
    if (hit) {
      _p.set(p.x, p.y + 0.3 - hit.timeOfImpact, p.z);
      this.splat(_p, hit.normal, radius * 0.55, { r: 0.02, g: 0.02, b: 0.02 });
    }
    this.flash.position.copy(p).y += 1;
    this.flash.intensity = 700;
    this.flashT = 0.35;
  }

  // ------------------------------------------------------------ decals
  castFixed(ox, oy, oz, dx, dy, dz, max) {
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz;
    r.dir.x = dx; r.dir.y = dy; r.dir.z = dz;
    return this.ctx.world.castRayAndGetNormal(r, max, false, RAPIER.QueryFilterFlags.ONLY_FIXED);
  }

  /** Orient a decal on a surface; on walls it is stretched downward so it reads as a drip. */
  _orient(p, normal, lift) {
    _n.set(normal.x, normal.y, normal.z).normalize();
    const wall = Math.abs(_n.y) < 0.55;
    if (wall) {
      _y.set(0, -1, 0).addScaledVector(_n, _n.y).normalize(); // "down" within the surface
      _x.crossVectors(_y, _n);
      _m.makeBasis(_x, _y, _n);
      _q.setFromRotationMatrix(_m);
    } else {
      _q.setFromUnitVectors(_z, _n);
      _qr.setFromAxisAngle(_z, rnd(0, Math.PI * 2));
      _q.multiply(_qr);
    }
    _p.set(p.x, p.y, p.z).addScaledVector(_n, lift + Math.random() * 0.006);
    return wall;
  }

  splat(p, normal, size, { r = rnd(0.13, 0.24), g = 0, b = 0, drip = true } = {}) {
    const wall = this._orient(p, normal, 0.012);
    const set = this.splats[(Math.random() * this.splats.length) | 0];
    let sx = size * rnd(0.8, 1.25), sy = size * rnd(0.8, 1.25);
    if (wall && drip) { sy *= rnd(1.4, 2.3); _p.y -= sy * 0.2; }
    return { set, i: set.add(_p, _q, sx, sy, r, g, b) };
  }

  bloodDecal(p, normal, size = 0.25) { this.splat(p, normal, size); }

  /** A pool that spreads out over a few seconds. */
  pool(p, normal, size = 0.9) {
    this._orient(p, normal, 0.014);
    const set = this.splats[(Math.random() * this.splats.length) | 0];
    const i = set.add(_p, _q, size * 0.12, size * 0.12, rnd(0.11, 0.17), 0, 0);
    this.growing.push({ set, i, pos: _p.clone(), quat: _q.clone(), from: size * 0.12, to: size, t: 0, dur: rnd(5, 9) });
  }

  bulletHole(p, normal) {
    this._orient(p, normal, 0.008);
    this.holes.add(_p, _q, 0.09, 0.09, 0.03, 0.03, 0.03);
  }

  /** Blood thrown onto whatever is behind the victim. */
  wallSplatter(point, dir, range = 4) {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / l, dy = dir.y / l, dz = dir.z / l;
    const hit = this.castFixed(point.x, point.y, point.z, dx, dy, dz, range);
    if (!hit) return;
    const t = hit.timeOfImpact;
    const k = 1 - t / range;
    const base = { x: point.x + dx * t, y: point.y + dy * t, z: point.z + dz * t };
    this.splat(base, hit.normal, rnd(0.35, 0.65) * (0.5 + k));
    for (let j = 0; j < 3; j++) {
      // scatter a few smaller marks around the main one
      const o = { x: base.x + rnd(-0.35, 0.35), y: base.y + rnd(-0.3, 0.35), z: base.z + rnd(-0.35, 0.35) };
      const h2 = this.castFixed(o.x - dx * 0.4, o.y - dy * 0.4, o.z - dz * 0.4, dx, dy, dz, 0.9);
      if (h2) this.splat({ x: o.x - dx * 0.4 + dx * h2.timeOfImpact, y: o.y - dy * 0.4 + dy * h2.timeOfImpact, z: o.z - dz * 0.4 + dz * h2.timeOfImpact }, h2.normal, rnd(0.1, 0.22));
    }
  }

  // ------------------------------------------------------------ wounds on bodies
  /** Stick a wound on a body part mesh. lp / ln are in the part's local space. */
  wound(mesh, lp, ln, { size = 0.09, slash = false } = {}) {
    const list = mesh.userData.wounds || (mesh.userData.wounds = []);
    if (list.length >= 7) mesh.remove(list.shift());
    const g = new THREE.Group();
    _n.copy(ln).normalize();
    g.quaternion.setFromUnitVectors(_z, _n);
    g.position.copy(lp).addScaledVector(_n, 0.006);
    g.rotateZ(rnd(0, Math.PI * 2));
    const stain = new THREE.Mesh(this.woundGeo, this.woundMats[(Math.random() * 4) | 0]);
    stain.scale.set(slash ? size * 0.55 : size, slash ? size * 2.6 : size, 1);
    stain.renderOrder = 2;
    g.add(stain);
    const hole = new THREE.Mesh(this.holeGeo, this.holeMat);
    hole.scale.set(slash ? 0.012 : 0.022, slash ? size * 1.6 : 0.022, 1);
    hole.position.z = 0.002;
    hole.renderOrder = 3;
    g.add(hole);
    mesh.add(g);
    list.push(g);
  }

  // ------------------------------------------------------------ physical chunks
  chunks(p, count = 5, speed = 5, base = null) {
    const { world, scene, owners } = this.ctx;
    for (let k = 0; k < count; k++) {
      while (this.chunkList.length >= this.maxChunks) this._removeChunk(0);
      const bone = Math.random() < 0.22;
      const r = bone ? rnd(0.03, 0.045) : rnd(0.035, 0.07);
      const a = rnd(0, Math.PI * 2), e = rnd(0.1, 1.2), s = rnd(0.3, 1) * speed;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x + rnd(-0.08, 0.08), p.y + rnd(-0.05, 0.1), p.z + rnd(-0.08, 0.08))
        .setLinvel((base ? base.x : 0) + Math.cos(a) * Math.cos(e) * s, (base ? base.y : 0) + Math.sin(e) * s, (base ? base.z : 0) + Math.sin(a) * Math.cos(e) * s)
        .setAngvel({ x: rnd(-12, 12), y: rnd(-12, 12), z: rnd(-12, 12) })
        .setLinearDamping(0.25).setAngularDamping(1.6));
      const col = world.createCollider(RAPIER.ColliderDesc.ball(r).setDensity(900).setFriction(1.0).setRestitution(0.12), body);
      const mesh = bone
        ? new THREE.Mesh(this.boneGeo, this.boneMat)
        : new THREE.Mesh(this.chunkGeos[(Math.random() * 3) | 0], Math.random() < 0.25 ? this.fatMat : this.meatMat);
      mesh.scale.setScalar(bone ? r * 1.3 : r * 1.25);
      mesh.castShadow = true;
      scene.add(mesh);
      owners.set(col.handle, { kind: 'chunk', body });
      this.chunkList.push({ body, col, mesh, life: rnd(14, 22), drip: bone ? 0.4 : 1.4, size: mesh.scale.x });
    }
  }

  _removeChunk(i) {
    const c = this.chunkList[i];
    this.ctx.owners.delete(c.col.handle);
    this.ctx.world.removeRigidBody(c.body);
    this.ctx.scene.remove(c.mesh);
    this.chunkList.splice(i, 1);
  }

  // ------------------------------------------------------------ housekeeping
  clear() {
    this.drops.n = 0; this.fire.n = 0; this.smoke.n = 0;
    for (const s of this.splats) s.clear();
    this.holes.clear();
    this.growing.length = 0;
    while (this.chunkList.length) this._removeChunk(0);
  }

  /** Blood drops and meat bits stick to the world where they land. */
  _collideDrop(i, dt) {
    const d = this.drops, i3 = i * 3;
    const vx = d.vel[i3], vy = d.vel[i3 + 1], vz = d.vel[i3 + 2];
    const sp = Math.hypot(vx, vy, vz);
    if (sp < 0.05) return false;
    const hit = this.castFixed(d.pos[i3], d.pos[i3 + 1], d.pos[i3 + 2], vx / sp, vy / sp, vz / sp, sp * dt + 0.02);
    if (!hit) return false;
    const kind = d.kind[i];
    if (kind === DEBRIS) return true;
    const t = hit.timeOfImpact;
    const big = d.size[i] > 0.043;
    if (big || kind === BIT || Math.random() < 0.5) {
      this.splat({ x: d.pos[i3] + vx / sp * t, y: d.pos[i3 + 1] + vy / sp * t, z: d.pos[i3 + 2] + vz / sp * t },
        hit.normal, d.size[i] * (big ? rnd(4, 7) : rnd(2.5, 5)), { r: d.col[i3] * 0.75 });
    }
    return true;
  }

  update(dt) {
    this.drops.update(dt, this._collideDrop);
    this.fire.update(dt);
    this.smoke.update(dt);

    for (let i = this.growing.length - 1; i >= 0; i--) {
      const g = this.growing[i];
      g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      const s = g.from + (g.to - g.from) * (1 - (1 - k) * (1 - k));
      g.set.set(g.i, g.pos, g.quat, s, s);
      if (k >= 1) this.growing.splice(i, 1);
    }

    for (let i = this.chunkList.length - 1; i >= 0; i--) {
      const c = this.chunkList[i];
      c.life -= dt;
      if (c.life <= 0) { this._removeChunk(i); continue; }
      const t = c.body.translation(), r = c.body.rotation();
      if (t.y < -20) { this._removeChunk(i); continue; }
      c.mesh.position.set(t.x, t.y, t.z);
      c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (c.life < 1) c.mesh.scale.setScalar(c.size * c.life);
      if (c.drip > 0) { // freshly torn: leaves a trail
        c.drip -= dt;
        if (Math.random() < dt * 30) {
          const v = c.body.linvel();
          this.drops.emit(t.x, t.y, t.z, v.x * 0.4 + rnd(-0.5, 0.5), v.y * 0.4, v.z * 0.4 + rnd(-0.5, 0.5),
            rnd(0.02, 0.04), 1.5, 9.8, rnd(0.17, 0.3), 0, 0, BLOOD);
        }
      }
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity = Math.max(0, this.flashT / 0.35) * 700;
    }
  }
}
