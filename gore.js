import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries, mergeVertices } from './vendor/utils/BufferGeometryUtils.js';
import { woundClock } from './wounds.js';
import { isTouch } from './touch.js';

// Everything wet. Three layers:
//   particles - blood droplets (lit, glossy, drawn out along their flight), a fine red mist,
//               fire and smoke
//   decals    - what the blood leaves behind: impact splats, fine directional spatter, drips that
//               run down walls, pools that spread, drag smears. Every shape is drawn once at start-up
//               and carries its own relief, so pools and runs catch the light like liquid.
//               Every mark dries: wet red and glossy at first, dull brown-black a couple of minutes on.
//   chunks    - physical pieces: meat, fat, bone, skull, ribs, gut, organs, eyes. One that slaps into a wall
//               or a ceiling sticks there, slides down its own streak, drips, and lets go.
// Nothing here knows about NPCs; ragdoll.js and wounds.js decide when to call it.

// drop kinds
const BLOOD = 0, BIT = 1, DEBRIS = 2, SICK = 3;

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
const _t = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[(Math.random() * list.length) | 0];

// ---------------------------------------------------------------- particles
/** Soft, unlit puff: opaque where you look straight at it, fading to nothing at its outline. */
function softMaterial(opacity, blending = THREE.NormalBlending) {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: opacity } },
    transparent: true, depthWrite: false, blending,
    vertexShader: `
      attribute float aFade;
      varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vF;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalMatrix * mat3(instanceMatrix) * normal;
        vV = -mv.xyz; vC = instanceColor; vF = aFade;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vF;
      void main() {
        float facing = max(dot(normalize(vN), normalize(vV)), 0.0);
        gl_FragColor = vec4(vC, facing * facing * vF * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

class ParticleSet {
  /**
   * stretch: draw out along velocity (droplets).  scaleFn / fadeFn(lifeLeft01) -> size / opacity.
   * A set with fadeFn must use softMaterial().
   */
  constructor(scene, max, geometry, material, { stretch = false, scaleFn = null, fadeFn = null } = {}) {
    this.max = max;
    this.stretch = stretch;
    this.scaleFn = scaleFn;
    this.fadeFn = fadeFn;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(0xffffff));
    if (fadeFn) {
      this.fade = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
      this.fade.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aFade', this.fade);
    }
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
    this.skip = new Uint8Array(max);   // frames until the next collision check
  }

  emit(x, y, z, vx, vy, vz, size, life, grav, r, g, b, kind = 0, drag = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grav[i] = grav; this.kind[i] = kind; this.drag[i] = drag;
    this.skip[i] = 0;
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
        // look two steps ahead every second frame: half the ray casts for the same result
        if (collide && (this.skip[i] ? (this.skip[i]--, false) : (this.skip[i] = 1, collide(i, dt * 2)))) dead = true;
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
          this.kind[i] = this.kind[l]; this.drag[i] = this.drag[l]; this.skip[i] = this.skip[l];
        }
        continue;
      }
      const f = this.life[i] / this.maxLife[i];
      let s = this.size[i];
      if (this.scaleFn) s *= this.scaleFn(f);
      if (this.fade) this.fade.array[i] = this.fadeFn(f);
      _p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      if (this.stretch) {
        _d.set(this.vel[i3], this.vel[i3 + 1], this.vel[i3 + 2]);
        const sp = _d.length();
        if (sp > 0.3) _q.setFromUnitVectors(_z, _d.multiplyScalar(1 / sp)); else _q.identity();
        const len = 1 + Math.min(sp, 16) * 0.3;          // a fast drop is a streak...
        const thin = Math.pow(len, -0.3);                  // ...and thinner for it
        _s.set(s * thin, s * thin, s * len);
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
    if (this.fade) this.fade.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- decal shapes
function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function boxBlur(src, w, h, r, passes = 2) {
  const a = Float32Array.from(src), b = new Float32Array(w * h);
  const k = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = sum * k;
        sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum * k;
        sum += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

/**
 * Turn a rough white drawing into a blood decal: the outline is melted so blobs run together the way
 * liquid does, thick parts come out darker, and the edge gets a raised lip (a normal map) to shine.
 */
function bakeDecal(w, h, draw, { melt = 2, body = 8, lip = 3, relief = 5 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  draw(g, (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); });
  const img = g.getImageData(0, 0, w, h);
  const n = w * h;
  let a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = img.data[i * 4 + 3] / 255;
  a = boxBlur(a, w, h, melt);
  for (let i = 0; i < n; i++) a[i] = smooth(0.36, 0.6, a[i]);
  const thick = boxBlur(a, w, h, body);
  const height = boxBlur(a, w, h, lip);
  for (let i = 0; i < n; i++) {
    const v = 255 * (1 - 0.42 * thick[i] * thick[i]);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255 * a[i] * (0.74 + 0.26 * thick[i]);
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;

  const nc = document.createElement('canvas');
  nc.width = w; nc.height = h;
  const ng = nc.getContext('2d');
  const nimg = ng.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const dx = (height[y * w + Math.min(w - 1, x + 1)] - height[y * w + Math.max(0, x - 1)]) * relief;
    const dy = (height[Math.min(h - 1, y + 1) * w + x] - height[Math.max(0, y - 1) * w + x]) * relief;
    const l = 1 / Math.hypot(dx, dy, 1);
    nimg.data[i * 4] = (-dx * l * 0.5 + 0.5) * 255;
    nimg.data[i * 4 + 1] = (dy * l * 0.5 + 0.5) * 255;
    nimg.data[i * 4 + 2] = (l * 0.5 + 0.5) * 255;
    nimg.data[i * 4 + 3] = 255;
  }
  ng.putImageData(nimg, 0, 0);
  return { map, normalMap: new THREE.CanvasTexture(nc) };
}

// What gets drawn. Up in the picture is +Y on the decal.
const SHAPES = {
  // something wet hit this surface: a lumpy middle, fingers thrown outward, satellite drops
  splat: (seed) => bakeDecal(256, 256, (g, dot) => {
    const r = rng(seed);
    for (let k = 0; k < 14; k++) {
      const a = r() * 6.283, d = r() * 26;
      dot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 15 + r() * 24);
    }
    const fingers = 6 + Math.floor(r() * 7);
    for (let k = 0; k < fingers; k++) {
      const a = r() * 6.283, len = 30 + r() * 46;
      for (let t = 0; t < 1; t += 0.06) {
        const d = 30 + t * len;
        dot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, Math.max(2.4, (1 - t) * (7 + r() * 5)));
      }
      if (r() > 0.45) dot(128 + Math.cos(a) * (len + 40), 128 + Math.sin(a) * (len + 40), 3 + r() * 4.5);
    }
    for (let k = 0; k < 26; k++) {
      const a = r() * 6.283, d = 58 + r() * 56;
      dot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2.2 + r() * 3.2);
    }
  }),
  // fine drops thrown one way (upward here): small, many, longer the further they flew
  spatter: (seed) => bakeDecal(256, 256, (g, dot) => {
    const r = rng(seed);
    for (let k = 0; k < 120; k++) {
      const u = r(), dist = 12 + Math.pow(u, 0.7) * 200;
      const ang = (r() - 0.5) * (1.0 - 0.45 * u);
      const size = (1 - u * 0.7) * (2.6 + r() * 5.5);
      g.beginPath();
      g.ellipse(128 + Math.sin(ang) * dist, 232 - Math.cos(ang) * dist, size, size * (1 + u * 2.4), ang, 0, 6.283);
      g.fill();
    }
    for (let k = 0; k < 5; k++) dot(128 + (r() - 0.5) * 40, 214 - r() * 46, 7 + r() * 10);
  }),
  // blood that has had time to collect: one smooth, lobed puddle
  pool: (seed) => bakeDecal(256, 256, (g, dot) => {
    const r = rng(seed);
    for (let k = 0; k < 18; k++) {
      const a = r() * 6.283, d = r() * 50;
      dot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d * 0.9, 24 + r() * 30);
    }
  }, { melt: 7, body: 16, lip: 5, relief: 3 }),
  // a run down a wall: fed from the top, a bead at the bottom
  drip: (seed) => bakeDecal(64, 256, (g, dot) => {
    const r = rng(seed);
    dot(32, 14, 10 + r() * 3);
    let x = 32, wd = 6.5 + r() * 3;
    for (let y = 16; y < 234; y += 2) {
      x = Math.min(42, Math.max(22, x + (r() - 0.5) * 1.3));
      wd = Math.max(3.2, wd * 0.994 + (r() - 0.5) * 0.5);
      dot(x, y, wd);
    }
    dot(x, 236, wd + 2.5 + r() * 2);
  }, { melt: 1, body: 4, lip: 2, relief: 6 }),
  // a bloody hand put against a wall: palm, four fingers up, the thumb out to one side (odd seed: the other hand)
  hand: (seed) => bakeDecal(128, 128, (g, dot) => {
    const r = rng(seed), s = seed % 2 ? 1 : -1;
    for (let k = 0; k < 9; k++) dot(64 + (r() - 0.5) * 22, 86 + (r() - 0.5) * 24, 13 + r() * 5);
    for (const [x, len] of [[-17, 30], [-6, 36], [5, 34], [15, 26]]) {
      for (let t = 0; t <= 1; t += 0.1) dot(64 + x * (1 + t * 0.15), 66 - t * len, 5.2 - t * 0.8);
    }
    for (let t = 0; t <= 1; t += 0.1) dot(64 + s * (22 + t * 16), 88 - t * 16, 6 - t);
  }, { melt: 1, body: 4, lip: 2, relief: 4 }),
  // something bleeding was dragged along here
  smear: (seed) => bakeDecal(128, 256, (g, dot) => {
    const r = rng(seed);
    for (let s = 0; s < 10; s++) {
      let x = 22 + r() * 84;
      const y0 = 14 + r() * 44, y1 = 196 + r() * 44, wd = 3 + r() * 7;
      for (let y = y0; y < y1; y += 3) {
        x += (r() - 0.5) * 1.6;
        if (r() < 0.07) y += 10 + r() * 18;        // the drag skipped
        dot(x, y, wd * (0.55 + 0.45 * Math.sin(Math.PI * (y - y0) / (y1 - y0))));
      }
    }
  }, { melt: 2, body: 6 }),
};

/** Blood dries: over a couple of minutes a mark goes from wet red to dull brown-black (game time, so slow-mo slows it). */
function dries(s) {
  s.uniforms.uTime = woundClock;
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aBirth;\nuniform float uTime;\nvarying float vAge;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAge = uTime - aBirth;');
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vAge;\nfloat dry;')
    .replace('#include <color_fragment>', '#include <color_fragment>\ndry = smoothstep(20.0, 150.0, vAge);\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.r * vec3(0.36, 0.07, 0.045), dry);')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.65, dry);');
}

/** Matte black burn left by an explosion. */
function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = rng(7);
  for (let k = 0; k < 60; k++) {
    const a = r() * 6.283, d = Math.pow(r(), 0.8) * 44, rad = 8 + r() * 16;
    const gr = g.createRadialGradient(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

class DecalSet {
  constructor(scene, max, material) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.birth = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);    // when each mark was made (it dries)
    geo.setAttribute('aBirth', this.birth);
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(0xffffff));
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
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
    this.birth.array[i] = woundClock.value;
    this.birth.needsUpdate = true;
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

// ---------------------------------------------------------------- chunk shapes
function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), L(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    L(L(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), L(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}

/** Give a geometry vertex colours from fn(x, y, z) -> [r, g, b] (linear). Drops what merging can't use. */
function paint(geo, fn) {
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

const MEAT = [0.3, 0.02, 0.02], MEAT_DARK = [0.15, 0.008, 0.01], FAT = [0.6, 0.36, 0.22], BONE = [0.82, 0.77, 0.63];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A smooth lumpy blob: an icosphere pushed in and out by noise. */
function lump(seed, amp, sx = 1, sy = 1, sz = 1, detail = 2) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + amp * (vnoise(x * 1.6 + seed, y * 1.6, z * 1.6 - seed) + 0.5 * vnoise(x * 3.7, y * 3.7 + seed, z * 3.7) - 0.75) * 1.4;
    pos.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

function chunkGeometries() {
  const meat = (seed, sy) => paint(lump(seed, 0.45, 1, sy, 0.85), (x, y, z) => {
    const f = vnoise(x * 2.2 + seed, y * 7, z * 2.2);                       // fibres run one way
    const fat = smooth(0.72, 0.86, vnoise(x * 2.6 - seed, y * 2.6, z * 2.6 + 3));
    return mix3(mix3(MEAT_DARK, MEAT, f), FAT, fat * 0.8);
  });
  const fat = paint(lump(9.1, 0.5, 1, 0.6, 0.9), (x, y, z) => mix3(FAT, MEAT, smooth(0.5, 0.8, vnoise(x * 3, y * 3, z * 3))));
  const organ = paint(lump(4.4, 0.18, 1.25, 0.8, 0.85), (x, y, z) => mix3([0.22, 0.015, 0.03], [0.34, 0.03, 0.05], vnoise(x * 2, y * 2, z * 2)));
  const brain = paint(lump(6.2, 0.2, 1, 0.8, 1.15), (x, y, z) => {
    const fold = Math.abs(Math.sin(x * 9 + Math.sin(z * 7) * 2) * Math.sin(y * 8 + z * 5));
    return mix3([0.42, 0.14, 0.15], [0.78, 0.52, 0.5], smooth(0.1, 0.5, fold));
  });

  // a length of bone, snapped: one end is splinters
  const bone = (seed) => {
    const g = new THREE.CylinderGeometry(0.2, 0.27, 2, 7, 3);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 0.9) pos.setY(i, y + (hash3(pos.getX(i) * 9 + seed, 0, pos.getZ(i) * 9) - 0.3) * 0.7);
      else if (y < -0.9) pos.setXYZ(i, pos.getX(i) * 1.35, y, pos.getZ(i) * 1.35);   // the knuckle end
    }
    g.computeVertexNormals();
    return paint(g, (x, y) => mix3(BONE, MEAT, Math.max(smooth(0.6, 1.1, y), smooth(-0.5, -1.0, y) * 0.6)));
  };

  // a piece of skull: bone outside, red inside
  const skull = (phiLen) => {
    const outer = new THREE.SphereGeometry(1, 7, 4, 0, phiLen, 0.12, 0.85);
    const pos = outer.attributes.position;
    for (let i = 0; i < pos.count; i++) {                 // broken, not sawn
      const k = 1 + (hash3(pos.getX(i) * 5, pos.getY(i) * 5, pos.getZ(i) * 5) - 0.5) * 0.1;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i), pos.getZ(i) * k);
    }
    const inner = outer.clone();
    inner.scale(0.9, 0.9, 0.9);
    const idx = inner.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 1]; idx[i + 1] = t; }
    outer.computeVertexNormals();
    inner.computeVertexNormals();
    paint(outer, (x, y, z) => mix3(BONE, MEAT, smooth(0.55, 0.8, vnoise(x * 3, y * 3, z * 3)) * 0.8));
    paint(inner, () => MEAT_DARK);
    const g = mergeGeometries([outer, inner]);
    g.center();
    return g;
  };

  const rib = paint(new THREE.TorusGeometry(1, 0.075, 5, 10, 1.9), (x, y) => mix3(BONE, MEAT, smooth(0.7, 1.0, Math.abs(Math.atan2(y, x) / 0.95 - 1))));
  rib.center();

  const gut = (seed) => {
    const r = rng(seed);
    const pts = [];
    for (let i = 0; i < 6; i++) pts.push(new THREE.Vector3((r() - 0.5) * 1.1, i * 0.55 - 1.4, (r() - 0.5) * 1.1));
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.24, 6, false);
    return paint(g, (x, y, z) => mix3([0.52, 0.24, 0.21], [0.34, 0.07, 0.07], vnoise(x * 4, y * 4, z * 4)));
  };

  const ball = paint(new THREE.SphereGeometry(1, 12, 9), (x, y, z) => {
    if (z > 0.9) return [0.01, 0.01, 0.01];                                  // pupil
    if (z > 0.68) return [0.16, 0.24, 0.3];                                  // iris
    return mix3([0.86, 0.84, 0.8], [0.7, 0.12, 0.1], smooth(0.62, 0.8, vnoise(x * 6, y * 6, z * 6)) * 0.7);
  });
  const nerve = paint(new THREE.CylinderGeometry(0.2, 0.1, 1.1, 5).rotateX(Math.PI / 2).translate(0, 0, -1.4), () => MEAT);
  const eye = mergeGeometries([ball, nerve]);

  return {
    meat: [meat(1.3, 0.8), meat(2.1, 0.55), meat(3.7, 0.7)], fat: [fat], organ: [organ], brain: [brain],
    bone: [bone(1), bone(5)], skull: [skull(2.2), skull(3.4), skull(4.6)], rib: [rib], gut: [gut(3), gut(8)], eye: [eye],
  };
}

// collider shape and size range for each kind of chunk (radius in metres)
const CHUNK = {
  meat:  { r: [0.02, 0.045], shape: 'ball', drip: 1.6 },
  fat:   { r: [0.018, 0.03], shape: 'ball', drip: 0.6 },
  organ: { r: [0.035, 0.05], shape: 'ball', drip: 1.8 },
  brain: { r: [0.03, 0.048], shape: 'ball', drip: 1.0 },
  bone:  { r: [0.035, 0.05], shape: 'rod', drip: 0.4 },
  gut:   { r: [0.04, 0.06], shape: 'rod', drip: 1.2 },
  skull: { r: [0.04, 0.06], shape: 'plate', drip: 0.5 },
  rib:   { r: [0.05, 0.07], shape: 'slab', drip: 0.4 },
  eye:   { r: [0.013, 0.014], shape: 'ball', drip: 0.2 },
};
// what comes out of what
const CHUNK_MIX = {
  any:   ['meat', 'meat', 'meat', 'bone', 'fat'],
  limb:  ['meat', 'meat', 'bone', 'meat', 'fat', 'meat'],
  head:  ['skull', 'brain', 'skull', 'eye', 'brain', 'skull', 'eye', 'meat', 'brain'],
  torso: ['rib', 'gut', 'organ', 'rib', 'meat', 'gut', 'rib', 'organ', 'meat', 'bone', 'fat'],
};

// ---------------------------------------------------------------- gore system
export class Gore {
  constructor(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;

    // phones: fewer drops and pieces, and rounder-enough spheres
    this.lite = isTouch;
    const ball = () => this.lite ? new THREE.SphereGeometry(0.5, 6, 4) : new THREE.SphereGeometry(0.5, 10, 8);
    // wet blood drops: lit, glossy, drawn out along their flight
    this.drops = new ParticleSet(scene, this.lite ? 1600 : 3600, ball(),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.16, metalness: 0 }), { stretch: true });
    // the red haze a hit throws up: there for half a second, then gone
    this.mists = new ParticleSet(scene, 320, ball(), softMaterial(0.32),
      { scaleFn: (f) => 0.3 + 0.7 * (1 - f * f), fadeFn: (f) => f });
    this.fire = new ParticleSet(scene, 500, ball(), softMaterial(1, THREE.AdditiveBlending),
      { scaleFn: (f) => 0.25 + 0.75 * f, fadeFn: (f) => Math.min(1, f * 2.5) });
    // rain: thin grey streaks, no collisions (they fall through the ground and die), only emitted under open sky
    this.rain = new ParticleSet(scene, 2600, new THREE.SphereGeometry(0.5, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), { stretch: true });
    // blood in water: a slow red cloud that spreads and fades instead of a drop (water.js says where water is)
    this.clouds = new ParticleSet(scene, this.lite ? 120 : 260, ball(), softMaterial(0.55),
      { scaleFn: (f) => 0.25 + 2.6 * (1 - f), fadeFn: (f) => Math.min(1, f * 2) });
    this.smoke = new ParticleSet(scene, 300, ball(), softMaterial(0.75),
      { scaleFn: (f) => Math.min(1, f * 3) * (1.6 - 0.6 * f), fadeFn: (f) => Math.min(1, f * 2.2) });

    // decals: glossy so they catch the light the way wet blood does
    const decalMat = (tex, offset = -4) => Object.assign(new THREE.MeshStandardMaterial({
      map: tex.map, normalMap: tex.normalMap, color: 0xffffff, transparent: true, depthWrite: false,
      roughness: 0.1, metalness: 0, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
    }), { onBeforeCompile: dries });
    const sets = (shape, seeds, max, offset) => seeds.map((s) => new DecalSet(scene, max, decalMat(SHAPES[shape](s), offset)));
    this.sets = {
      splat: sets('splat', [1, 2, 3], 900),
      spatter: sets('spatter', [4, 5], 200),
      pool: sets('pool', [6, 7], 48, -5),
      drip: sets('drip', [8, 9], 110),
      smear: sets('smear', [10], 180),
      hand: sets('hand', [11, 12], 40),
    };
    this.scorch = new DecalSet(scene, 24, new THREE.MeshStandardMaterial({
      map: scorchTexture(), color: 0x050505, transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    this.holes = new DecalSet(scene, 300, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      map: (() => { // soft dark dot
        const c = document.createElement('canvas'); c.width = c.height = 32;
        const g = c.getContext('2d');
        const gr = g.createRadialGradient(16, 16, 2, 16, 16, 15);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
        return new THREE.CanvasTexture(c);
      })(),
    }));
    this.growing = []; // pools still spreading, drips still running
    this.drippers = []; // blood on a ceiling, coming back down a drop at a time
    this.pools = [];   // where there is blood to step in (the newest forty)
    this.lensEl = document.getElementById('lens');

    // physical pieces
    this.chunkGeo = chunkGeometries();
    this.chunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42 });
    this.chunkList = [];
    this.maxChunks = this.lite ? 60 : 150;

    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

    this.flash = new THREE.PointLight(0xffa24a, 0, 40, 2);
    scene.add(this.flash);
    this.flashT = 0;

    this._collideDrop = this._collideDrop.bind(this);
  }

  // ------------------------------------------------------------ emitters
  /** Spray of blood. dir = general direction of travel. */
  blood(p, dir, count = 12, speed = 4, spread = 0.9) {
    // a hit this close puts some of it on the camera
    const cam = this.ctx.camera.position, near = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
    if (near < 2.4 && count >= 4) this.lens(Math.ceil((2.4 - near) * 2.5));
    count = Math.ceil(count * (this.lite ? 0.8 : 1.5));
    for (let k = 0; k < count; k++) {
      const s = speed * rnd(0.25, 1.15);
      const j = spread * speed * 0.5;
      const big = Math.random() < 0.1;
      this.drops.emit(p.x, p.y, p.z,
        dir.x * s + rnd(-1, 1) * j, dir.y * s + rnd(-0.4, 1) * j, dir.z * s + rnd(-1, 1) * j,
        big ? rnd(0.012, 0.02) : rnd(0.004, 0.011), rnd(1.5, 2.6), 9.8,
        rnd(0.09, 0.17), 0.003, 0.003, BLOOD);
    }
  }

  /** Someone being sick: a gush out of the mouth along dir, yellow-brown, that splashes where it lands. */
  vomit(p, dir) {
    const n = this.lite ? 8 : 16;
    for (let k = 0; k < n; k++) {
      const s = rnd(1.2, 2.6), c = rnd(0.7, 1);
      this.drops.emit(p.x, p.y, p.z, dir.x * s + rnd(-0.3, 0.3), dir.y * s + rnd(-0.2, 0.3), dir.z * s + rnd(-0.3, 0.3),
        rnd(0.006, 0.016), rnd(1.2, 2), 9.8, 0.36 * c, 0.27 * c, 0.06 * c, SICK);
    }
  }

  /** Rain, for a frame: fresh drops over the camera unless something is overhead, and all of them falling. */
  rainStep(dt, cam, covered) {
    if (!covered) for (let k = Math.ceil(dt * (this.lite ? 500 : 1100)); k > 0; k--) {
      this.rain.emit(cam.x + rnd(-15, 15), cam.y + rnd(3, 9), cam.z + rnd(-15, 15), 0.6, -13, 0.4, 0.017, 1.0, 0, 0.78, 0.86, 0.96, 0, 0);
    }
    this.rain.update(dt);
  }

  /** Blood on the lens: drops that hang there, run down the glass and fade. (kind 'rain': clear water instead.) */
  lens(n, kind = '') {
    const el = this.lensEl;
    if (!el) return;
    for (let k = 0; k < Math.min(n, 3) && el.childElementCount < 14; k++) {
      const d = document.createElement('i');
      d.className = kind;
      const size = rnd(5, 15) * (Math.random() < 0.15 ? 2.5 : 1);
      d.style.cssText = `left:${rnd(0, 96)}%;top:${rnd(0, 90)}%;width:${size}px;height:${size * rnd(1, 1.5)}px;animation-duration:${rnd(5, 10)}s`;
      d.addEventListener('animationend', () => d.remove());
      el.appendChild(d);
    }
  }

  /** Is this spot in a pool of blood? */
  wetAt(p) {
    return this.pools.some((o) => Math.abs(o.y - p.y) < 1.3 && Math.hypot(o.x - p.x, o.z - p.z) < o.r);
  }

  /** One bloody footprint under p, pointing along dir. k = how much is left on the sole, 1..0. */
  footprint(p, dir, k) {
    const hit = this.castFixed(p.x, p.y + 0.3, p.z, 0, -1, 0, 1.6);
    if (hit) this.smear({ x: p.x, y: p.y + 0.3 - hit.timeOfImpact, z: p.z }, hit.normal, dir, 0.1 * (0.5 + 0.5 * k), 0.24);
  }

  /** One slow drop falling from a wound. v = how the wound itself is moving. */
  drip(p, v) {
    this.drops.emit(p.x, p.y, p.z, v.x + rnd(-0.15, 0.15), v.y - rnd(0, 0.3), v.z + rnd(-0.15, 0.15),
      rnd(0.009, 0.016), 2.5, 9.8, rnd(0.09, 0.16), 0.003, 0.003, BLOOD);
  }

  /** Fine red haze hanging where a round went through. puff: the brighter burst a hit throws back at the shooter. */
  mist(p, dir, count = 5, size = 1, puff = false) {
    for (let k = 0; k < count; k++) {
      const s = rnd(0.3, 1.7) * (puff ? 1.4 : 1);
      this.mists.emit(p.x + dir.x * 0.05 + rnd(-0.03, 0.03), p.y + dir.y * 0.05 + rnd(-0.03, 0.03), p.z + dir.z * 0.05 + rnd(-0.03, 0.03),
        dir.x * s + rnd(-0.5, 0.5), dir.y * s + rnd(-0.2, 0.6), dir.z * s + rnd(-0.5, 0.5),
        rnd(0.1, 0.24) * size, puff ? rnd(0.18, 0.32) : rnd(0.3, 0.7), 0.7, puff ? rnd(0.3, 0.42) : rnd(0.14, 0.2), puff ? 0.018 : 0.008, puff ? 0.015 : 0.008, 0, 3.5);
    }
  }

  /** Heavy burst with meat bits: limbs coming off. */
  gush(p, dir, count = 40, speed = 6) {
    this.blood(p, dir, count, speed, 1.1);
    this.blood(p, UP, Math.floor(count * 0.4), speed * 0.6, 1.4);
    this.mist(p, dir, 5, 1.2);
    for (let k = 0; k < count * 0.2; k++) {
      const s = speed * rnd(0.2, 0.7);
      this.drops.emit(p.x, p.y, p.z, rnd(-1, 1) * s, rnd(0.3, 1.3) * s, rnd(-1, 1) * s,
        rnd(0.02, 0.034), rnd(1.5, 2.5), 10.5, rnd(0.15, 0.2), 0.012, 0.012, BIT);
    }
  }

  gibs(p, count = 50) {
    this.mist(p, UP, 10, 2.2);
    count = Math.ceil(count * (this.lite ? 0.8 : 1.5));
    // the room gets painted: a burst onto whatever is around, every way at once
    for (let k = 0; k < 4; k++) {
      const a = k * 1.571 + rnd(0, 1.2);
      this.wallSplatter(p, _d.set(Math.cos(a), rnd(-0.4, 0.5), Math.sin(a)), 3.5);
    }
    for (let k = 0; k < count; k++) {
      const s = rnd(2, 9), a = rnd(0, Math.PI * 2), e = rnd(-0.2, 1.1);
      const vx = Math.cos(a) * Math.cos(e) * s, vy = Math.sin(e) * s + 2, vz = Math.sin(a) * Math.cos(e) * s;
      if (k % 5 === 0) this.drops.emit(p.x, p.y, p.z, vx, vy, vz, rnd(0.022, 0.038), rnd(2, 3.5), 10.5, 0.17, 0.012, 0.012, BIT);
      else this.drops.emit(p.x, p.y, p.z, vx, vy, vz, rnd(0.007, 0.024), rnd(1.5, 2.6), 9.8, rnd(0.09, 0.17), 0.003, 0.003, BLOOD);
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
    const hit = this.castFixed(p.x, p.y + 0.3, p.z, 0, -1, 0, 2.5);
    if (hit) {
      this._orient({ x: p.x, y: p.y + 0.3 - hit.timeOfImpact, z: p.z }, hit.normal, 0.01);
      const k = this._fit(radius * 0.6, radius * 0.6);
      this.scorch.add(_p, _q, radius * 0.6 * k, radius * 0.6 * k, 1, 1, 1);
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

  /**
   * Lay a decal on a surface: fills _p (lifted just clear of it) and _q. Its +Y follows `along` if
   * given; otherwise it points down a wall (so marks hang) or any which way on a floor.
   * Returns true for walls.
   */
  _orient(p, normal, lift, along = null) {
    _n.set(normal.x, normal.y, normal.z).normalize();
    const wall = Math.abs(_n.y) < 0.55;
    if (along) _y.set(along.x, along.y, along.z);
    else if (wall) _y.set(0, -1, 0);
    if (along || wall) _y.addScaledVector(_n, -_y.dot(_n));
    if ((along || wall) && _y.lengthSq() > 1e-6) {
      _y.normalize();
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

  /**
   * Keep a big decal (already placed by _orient) from hanging off the edge of what it is on:
   * slide it back onto the surface, or shrink it. Returns the scale to draw it at.
   */
  _fit(sx, sy) {
    let k = 1;
    for (let axis = 0; axis < 2; axis++) {
      const ax = (axis ? _y.set(0, 1, 0) : _x.set(1, 0, 0)).applyQuaternion(_q);
      const half = (axis ? sy : sx) * 0.42;
      const pos = this._backed(ax, half), neg = this._backed(ax, -half);
      if (pos && neg) continue;
      if (pos || neg) { _p.addScaledVector(ax, (pos ? 1 : -1) * half * 0.6); k = Math.min(k, 0.7); }
      else k = 0.4;
    }
    return k;
  }

  /** Is there surface under the decal, d metres along one of its axes? */
  _backed(ax, d) {
    return !!this.castFixed(_p.x + _n.x * 0.06 + ax.x * d, _p.y + _n.y * 0.06 + ax.y * d, _p.z + _n.z * 0.06 + ax.z * d, -_n.x, -_n.y, -_n.z, 0.16);
  }

  /** opts: r,g,b colour; drip = hang down walls; along = direction it was travelling; stretch; kind = shape. */
  splat(p, normal, size, { r = rnd(0.12, 0.21), g = 0.004, b = 0.004, drip = true, along = null, stretch = 1, kind = 'splat' } = {}) {
    const wall = this._orient(p, normal, 0.012, along);
    const set = pick(this.sets[kind]);
    let sx = size * rnd(0.8, 1.25), sy = size * rnd(0.8, 1.25) * stretch;
    if (!along && wall && drip) { sy *= rnd(1.2, 1.7); _p.y -= sy * 0.15; }
    if (size > 0.16) { const k = this._fit(sx, sy); sx *= k; sy *= k; }
    return { set, i: set.add(_p, _q, sx, sy, r, g, b) };
  }

  bloodDecal(p, normal, size = 0.25) { this.splat(p, normal, size); }

  /** A pool that spreads out, fast at first and then creeping on for half a minute, as blood does. */
  pool(p, normal, size = 0.9) {
    this._orient(p, normal, 0.014);
    size *= this._fit(size, size);
    const set = pick(this.sets.pool);
    const i = set.add(_p, _q, size * 0.12, size * 0.12, rnd(0.06, 0.09), 0.002, 0.002);     // collected blood is deep, nearly black red
    this.growing.push({ set, i, pos: _p.clone(), quat: _q.clone(), from: size * 0.12, to: size, t: 0, dur: rnd(20, 40) });
    this.pools.push({ x: _p.x, y: _p.y, z: _p.z, r: size * 0.42 });
    if (this.pools.length > 40) this.pools.shift();
  }

  /** Blood starts running down a wall from p. */
  run(p, normal) {
    _n.set(normal.x, normal.y, normal.z).normalize();
    if (Math.abs(_n.y) > 0.55) return;
    const down = new THREE.Vector3(0, -1, 0).addScaledVector(_n, _n.y).normalize();
    // it stops where the wall does
    const floor = this.castFixed(p.x + _n.x * 0.03, p.y + _n.y * 0.03, p.z + _n.z * 0.03, down.x, down.y, down.z, 2);
    const len = Math.min(rnd(0.2, 0.95), floor ? floor.timeOfImpact - 0.01 : 2);
    if (len < 0.06) return;
    this._orient(p, normal, 0.013, _t.copy(down).negate());
    const set = pick(this.sets.drip);
    const w = rnd(0.028, 0.05);
    const i = set.add(_p, _q, w, 0.03, rnd(0.2, 0.3), 0.004, 0.004);
    const g = { set, i, pos: _p.clone(), quat: _q.clone(), down, w, from: 0.03, to: len, t: 0, dur: rnd(2.5, 7) * (0.5 + len) };
    this.growing.push(g);
    return g;
  }

  /** A streak left by something bloody dragged over the ground. */
  smear(p, normal, dir, width = 0.2, length = 0.45) {
    this._orient(p, normal, 0.011, dir);
    const k = this._fit(width, length);
    pick(this.sets.smear).add(_p, _q, width * rnd(0.8, 1.2) * k, length * rnd(0.9, 1.3) * k, rnd(0.17, 0.26), 0.004, 0.004);
  }

  /** A bloody hand pressed on a wall, fingers up and a little tilted; sometimes it slid. */
  handprint(p, normal) {
    this.splat(p, normal, rnd(0.2, 0.26), { kind: 'hand', along: _t.set(rnd(-0.4, 0.4), 1, rnd(-0.4, 0.4)), r: rnd(0.16, 0.26) });
    if (Math.random() < 0.3) this.run(p, normal);
  }

  /** Blood on a ceiling comes back down: a drop every so often from the same spot, slower as it runs dry. */
  dripFrom(p, t) {
    this.drippers.push({ x: p.x, y: p.y - 0.015, z: p.z, t, next: rnd(0.2, 0.8) });
    if (this.drippers.length > 30) this.drippers.shift();
  }

  bulletHole(p, normal) {
    this._orient(p, normal, 0.008);
    this.holes.add(_p, _q, 0.09, 0.09, 0.03, 0.03, 0.03);
  }

  /** Blood thrown onto whatever is behind the victim (matter: a head shot, so pink-grey brain goes with it). */
  wallSplatter(point, dir, range = 4, matter = false) {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / l, dy = dir.y / l, dz = dir.z / l;
    const hit = this.castFixed(point.x, point.y, point.z, dx, dy, dz, range);
    if (!hit) return;
    const t = hit.timeOfImpact;
    const k = 1 - t / range;
    const base = { x: point.x + dx * t, y: point.y + dy * t, z: point.z + dz * t };
    const n = { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z };
    this.splat(base, n, rnd(0.3, 0.55) * (0.5 + k), { drip: false });
    if (matter) {
      for (let j = 0; j < 3; j++) {
        _t.set(dx + rnd(-0.6, 0.6), dy + rnd(-0.6, 0.3), dz + rnd(-0.6, 0.6));
        this.splat({ x: base.x + rnd(-0.08, 0.08), y: base.y + rnd(-0.08, 0.08), z: base.z + rnd(-0.08, 0.08) }, n, rnd(0.07, 0.15),
          { r: rnd(0.4, 0.55), g: rnd(0.16, 0.22), b: rnd(0.14, 0.19), along: _t, drip: false });
      }
      _t.set(dx, dy, dz);
      this.splat(base, n, rnd(0.4, 0.6), { along: _t, kind: 'spatter', r: 0.42, g: 0.16, b: 0.14 });
    }
    // fine spatter fanning out around it: mostly onward along the shot, sagging under gravity
    for (let j = 0; j < 3; j++) {
      _t.set(dx + rnd(-0.9, 0.9), dy + rnd(-0.9, 0.5), dz + rnd(-0.9, 0.9));
      this.splat(base, n, rnd(0.35, 0.7) * (0.5 + k), { along: _t, kind: 'spatter' });
    }
    if (Math.abs(n.y) < 0.55) {
      const runs = 1 + ((Math.random() * 3) | 0);
      for (let j = 0; j < runs; j++) {
        this.run({ x: base.x + rnd(-0.12, 0.12) * (1 - Math.abs(n.x)), y: base.y + rnd(-0.1, 0.06), z: base.z + rnd(-0.12, 0.12) * (1 - Math.abs(n.z)) }, n);
      }
    }
  }

  // ------------------------------------------------------------ physical chunks
  /** Throw out pieces. mix: 'limb' | 'head' | 'torso' | 'any' decides what they are. */
  chunks(p, count = 5, speed = 5, base = null, mix = 'any') {
    const { world, scene, owners } = this.ctx;
    const list = CHUNK_MIX[mix] || CHUNK_MIX.any;
    for (let k = 0; k < count; k++) {
      while (this.chunkList.length >= this.maxChunks) this._removeChunk(0);
      let kind = k < list.length ? list[k] : pick(list);
      if (kind === 'eye' && k >= list.length) kind = 'meat';      // two eyes at most
      const def = CHUNK[kind];
      const r = rnd(def.r[0], def.r[1]);
      const a = rnd(0, Math.PI * 2), e = rnd(0.1, 1.2), s = rnd(0.3, 1) * speed;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x + rnd(-0.08, 0.08), p.y + rnd(-0.05, 0.1), p.z + rnd(-0.08, 0.08))
        .setRotation(_q.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize())
        .setLinvel((base ? base.x : 0) + Math.cos(a) * Math.cos(e) * s, (base ? base.y : 0) + Math.sin(e) * s, (base ? base.z : 0) + Math.sin(a) * Math.cos(e) * s)
        .setAngvel({ x: rnd(-12, 12), y: rnd(-12, 12), z: rnd(-12, 12) })
        .setLinearDamping(0.25).setAngularDamping(1.6));
      const cd = def.shape === 'rod' ? RAPIER.ColliderDesc.capsule(r * 0.9, r * 0.32)
        : def.shape === 'plate' ? RAPIER.ColliderDesc.cuboid(r, r * 0.3, r)
        : def.shape === 'slab' ? RAPIER.ColliderDesc.cuboid(r * 0.75, r * 0.6, r * 0.2)
        : RAPIER.ColliderDesc.ball(r);
      const col = world.createCollider(cd.setDensity(900).setFriction(1.0).setRestitution(0.1), body);
      const mesh = new THREE.Mesh(pick(this.chunkGeo[kind]), this.chunkMat);
      mesh.scale.setScalar(r * 1.2);
      mesh.castShadow = true;
      scene.add(mesh);
      owners.set(col.handle, { kind: 'chunk', body });
      this.chunkList.push({ body, col, mesh, life: rnd(70, 120), drip: def.drip, size: mesh.scale.x, r, vy: 0, marks: 3, stick: 2.5, stuck: null, smears: 5, sx: p.x, sz: p.z });
    }
  }

  /** A flying piece slaps into a wall or a ceiling and stays there for a while. */
  _stick(c, t, v, sp, hit) {
    const n = hit.normal, d = hit.timeOfImpact;
    const at = { x: t.x + v.x / sp * d, y: t.y + v.y / sp * d, z: t.z + v.z / sp * d };
    const pos = new THREE.Vector3(at.x + n.x * c.r * 0.6, at.y + n.y * c.r * 0.6, at.z + n.z * c.r * 0.6);
    c.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    c.body.setTranslation(pos, true);
    this.splat(at, n, c.size * rnd(5, 8), { r: rnd(0.2, 0.3), drip: false });
    const ceiling = n.y < -0.5;
    c.stuck = { pos, run: ceiling ? null : this.run(at, n), t: ceiling ? rnd(0.8, 3.5) : rnd(4, 10) };
    if (ceiling) this.dripFrom(at, c.stuck.t + 6);
    c.drip = Math.max(c.drip, c.stuck.t);            // (slowly: see update)
    c.stick = 0;
  }

  /** A stuck piece rides down the bottom of its own streak, then lets go. */
  _slide(c, dt) {
    const s = c.stuck, g = s.run;
    if (g) {
      const k = Math.min(1, g.t / g.dur);
      c.body.setTranslation(_p.copy(s.pos).addScaledVector(g.down, (g.to - g.from) * (1 - (1 - k) * (1 - k))), true);
    }
    if ((s.t -= dt) > 0) return;
    c.stuck = null;
    c.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    c.body.setLinvel({ x: 0, y: -0.5, z: 0 }, true);
    c.marks = Math.max(c.marks, 1);
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
    this.drops.n = 0; this.fire.n = 0; this.smoke.n = 0; this.mists.n = 0; this.rain.n = 0; this.clouds.n = 0;
    for (const k in this.sets) for (const s of this.sets[k]) s.clear();
    this.holes.clear();
    this.scorch.clear();
    this.growing.length = 0;
    this.drippers.length = 0;
    this.pools.length = 0;
    this.lensEl?.replaceChildren();
    while (this.chunkList.length) this._removeChunk(0);
  }

  /** Blood drops and meat bits stick to the world where they land (or, in water, cloud). */
  _collideDrop(i, dt) {
    const d = this.drops, i3 = i * 3;
    const w = this.ctx.water;
    if (w?.pools.length && w.under(d.pos[i3], d.pos[i3 + 1], d.pos[i3 + 2])) {
      if (d.kind[i] !== DEBRIS && Math.random() < 0.5) {
        this.clouds.emit(d.pos[i3], d.pos[i3 + 1], d.pos[i3 + 2], rnd(-0.08, 0.08), rnd(0.02, 0.1), rnd(-0.08, 0.08),
          rnd(0.12, 0.22), rnd(5, 9), -0.03, rnd(0.2, 0.3), 0.008, 0.008, 0, 0.6);
      }
      return true;
    }
    const vx = d.vel[i3], vy = d.vel[i3 + 1], vz = d.vel[i3 + 2];
    const sp = Math.hypot(vx, vy, vz);
    if (sp < 0.05) return false;
    const hit = this.castFixed(d.pos[i3], d.pos[i3 + 1], d.pos[i3 + 2], vx / sp, vy / sp, vz / sp, sp * dt + 0.02);
    if (!hit) return false;
    const kind = d.kind[i];
    if (kind === DEBRIS) return true;
    if (kind === SICK) {           // a sour yellow-brown mess where it lands, not blood
      if (Math.random() < 0.45) this.splat({ x: d.pos[i3], y: d.pos[i3 + 1], z: d.pos[i3 + 2] }, hit.normal, d.size[i] * rnd(6, 10), { r: d.col[i3], g: d.col[i3 + 1], b: d.col[i3 + 2], drip: false });
      return true;
    }
    const t = hit.timeOfImpact;
    const size = d.size[i];
    const big = size > 0.0155;
    if (!big && kind !== BIT && Math.random() < 0.5) return true;        // the finest spray leaves no mark
    const at = { x: d.pos[i3] + vx / sp * t, y: d.pos[i3 + 1] + vy / sp * t, z: d.pos[i3 + 2] + vz / sp * t };
    const n = hit.normal;
    const vn = vx * n.x + vy * n.y + vz * n.z;
    const slide = Math.sqrt(Math.max(0, sp * sp - vn * vn));
    const r = d.col[i3] * 1.25;
    if (slide > 2.5 && slide > -vn * 0.7) {
      // came in at an angle: a long mark pointing the way it was going
      this.splat(at, n, size * rnd(5, 8), { r, along: _t.set(vx, vy, vz), stretch: 1 + Math.min(2.6, slide * 0.3) });
    } else {
      this.splat(at, n, size * (big ? rnd(7, 11) : rnd(5, 9)), { r, drip: big });
      if (big && Math.random() < 0.4) this.run(at, n);
      if (big && n.y < -0.55 && Math.random() < 0.5) this.dripFrom(at, rnd(6, 18));
    }
    return true;
  }

  update(dt) {
    this.drops.update(dt, this._collideDrop);
    this.mists.update(dt);
    this.clouds.update(dt);
    this.fire.update(dt);
    this.smoke.update(dt);

    for (let i = this.growing.length - 1; i >= 0; i--) {
      const g = this.growing[i];
      g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      const s = g.from + (g.to - g.from) * (1 - (1 - k) * (1 - k));
      if (g.down) g.set.set(g.i, _p.copy(g.pos).addScaledVector(g.down, s * 0.5), g.quat, g.w, s);   // fed from the top
      else g.set.set(g.i, g.pos, g.quat, s, s);
      if (k >= 1) this.growing.splice(i, 1);
    }

    for (let i = this.drippers.length - 1; i >= 0; i--) {
      const d = this.drippers[i];
      if ((d.t -= dt) <= 0) { this.drippers.splice(i, 1); continue; }
      if ((d.next -= dt) <= 0) {
        d.next = rnd(0.3, 0.9) / Math.min(1, 0.25 + d.t / 8);
        this.drops.emit(d.x + rnd(-0.01, 0.01), d.y, d.z + rnd(-0.01, 0.01), 0, -0.3, 0, rnd(0.009, 0.015), 3, 9.8, rnd(0.1, 0.16), 0.003, 0.003, BLOOD);
      }
    }

    for (let i = this.chunkList.length - 1; i >= 0; i--) {
      const c = this.chunkList[i];
      c.life -= dt;
      if (c.life <= 0) { this._removeChunk(i); continue; }
      if (c.stuck) this._slide(c, dt);
      const t = c.body.translation(), r = c.body.rotation();
      if (t.y < -20) { this._removeChunk(i); continue; }
      c.mesh.position.set(t.x, t.y, t.z);
      c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (c.life < 1) c.mesh.scale.setScalar(c.size * c.life);
      const v = c.body.linvel();
      // fresh off the body and flying: a wall or a ceiling it slaps into, it sticks to (not doors or glass: they move or go)
      if (c.stick > 0 && !c.stuck) {
        c.stick -= dt;
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 3) {
          const hit = this.castFixed(t.x, t.y, t.z, v.x / sp, v.y / sp, v.z / sp, sp * dt * 1.5 + c.r);
          if (hit && hit.normal.y < 0.5 && !this.ctx.owners.has(hit.collider.handle)) { this._stick(c, t, v, sp, hit); continue; }
        }
      }
      // landed (it was falling, now it is not): a wet mark where it hit, and a splash if that was a pool
      if (!c.stuck && c.marks > 0 && c.vy < -1.5 && v.y > c.vy + 1.2) {
        c.marks--;
        const hit = this.castFixed(t.x, t.y + 0.05, t.z, 0, -1, 0, 0.3);
        if (hit) this.splat({ x: t.x, y: t.y + 0.05 - hit.timeOfImpact, z: t.z }, hit.normal, c.size * rnd(2.5, 4.5) * (0.5 + c.marks * 0.25));
        if (this.wetAt(t)) this.blood(t, UP, 5, 1.6, 1.5);
      }
      c.vy = v.y;
      // sliding or rolling over the floor: it smears
      const hs = Math.hypot(v.x, v.z);
      if (!c.stuck && c.smears > 0 && hs > 1.2 && Math.abs(v.y) < 1 && (t.x - c.sx) ** 2 + (t.z - c.sz) ** 2 > 0.04) {
        c.sx = t.x; c.sz = t.z;
        const hit = this.castFixed(t.x, t.y + 0.02, t.z, 0, -1, 0, c.size + 0.08);
        if (hit) {
          c.smears--;
          this.smear({ x: t.x, y: t.y + 0.02 - hit.timeOfImpact, z: t.z }, hit.normal, { x: v.x, y: 0, z: v.z }, c.size * 2.2, Math.min(0.5, hs * 0.12));
        }
      }
      // as good as still (one pinned under a body can spin on the spot for ever): asleep, and no longer keeping that body awake
      if (!c.stuck && hs < 0.15 && Math.abs(v.y) < 0.15) { if ((c.rest = (c.rest || 0) + dt) > 1 && !c.body.isSleeping()) c.body.sleep(); } else c.rest = 0;
      if (c.drip > 0) { // freshly torn: leaves a trail
        c.drip -= dt;
        if (Math.random() < dt * (c.stuck ? 3 : 30)) {
          this.drops.emit(t.x, t.y, t.z, v.x * 0.4 + rnd(-0.5, 0.5), v.y * 0.4, v.z * 0.4 + rnd(-0.5, 0.5),
            rnd(0.007, 0.015), 1.5, 9.8, rnd(0.09, 0.16), 0.003, 0.003, BLOOD);
        }
      }
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity = Math.max(0, this.flashT / 0.35) * 700;
    }
  }
}
