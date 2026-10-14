import * as THREE from 'three';

// Water: flat pools (axis-aligned boxes of it, each with a surface height) that a map asks for with
// MapBuilder.water(). What it does:
//   - things float: every frame, before the physics step, each dynamic body in it is pushed up by how far
//     under it is (bodies float low, crates and balls ride high, meat sinks) and slowed down (water drag)
//   - things splash: a body or a prop going in fast, and every round that crosses the surface
//   - rounds slow down: damage falls off with every metre a round travels under water (through())
//   - blood clouds instead of dripping: gore.js asks under() for each drop and turns those under water into
//     slow red clouds that spread and fade
//   - the player swims (player.js asks depth()), and the picture goes blue with the camera under water
// Nothing here is called from inside the physics step.

const SPLASH_SPEED = 2.5;      // m/s downward at the surface to make a splash
const _v = new THREE.Vector3();

/** A tiling normal map of soft ripples, drawn once. */
function rippleNormals() {
  const n = 128, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n);
  const h = (x, y) => {
    let v = 0;
    for (const [fx, fy, a, p] of [[1, 2, 0.5, 0.3], [3, 1, 0.35, 1.7], [2, 5, 0.2, 2.9], [5, 3, 0.15, 0.8], [7, 6, 0.08, 4.1]]) {
      v += a * Math.sin(((x * fx + y * fy) / n) * Math.PI * 2 + p);
    }
    return v;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), l = Math.hypot(dx * 2, dy * 2, 1);
    const i = (y * n + x) * 4;
    img.data[i] = (-dx * 2 / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (-dy * 2 / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export class Water {
  constructor(ctx) {
    this.ctx = ctx;
    this.pools = [];                        // { x0, x1, z0, z1, y, bottom }
    this.normals = rippleNormals();
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x1d6f8c, transparent: true, opacity: 0.62, roughness: 0.06, metalness: 0.15,
      normalMap: this.normals, normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: false, side: THREE.DoubleSide,   // (a ceiling from under it)
    });
    this.was = new WeakMap();               // body -> its height last frame (for splashes)
    this.t = 0;
    this.heard = -1;                        // when the last splash sound played
    this.underwater = false;
  }

  /** A pool from x0..x1, z0..z1, its surface at y (bottom: how deep it goes, for nothing but the record). Its surface goes into `group`. */
  add(group, x0, x1, z0, z1, y, bottom = y - 2) {
    this.pools.push({ x0, x1, z0, z1, y, bottom });
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    mesh.renderOrder = 2;
    group.add(mesh);
    this.normals.repeat.set((x1 - x0) / 4, (z1 - z0) / 4);
  }

  clear() { this.pools.length = 0; this.setUnder(false); }

  pool(x, z) { for (const p of this.pools) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return p; return null; }

  /** How far under the surface this point is (negative: above it; null: no water here). */
  depth(x, y, z) { const p = this.pool(x, z); return p ? p.y - y : null; }

  under(x, y, z) { const d = this.depth(x, y, z); return d !== null && d > 0; }

  /** White water thrown up at (x, y, z). */
  splash(x, y, z, size = 1) {
    const g = this.ctx.gore;
    const n = Math.round(10 * size);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * 1.6 * Math.sqrt(size);
      g.drops.emit(x, y + 0.02, z, Math.cos(a) * s, 2 + Math.random() * 3.5 * Math.sqrt(size), Math.sin(a) * s,
        0.025 + Math.random() * 0.03 * size, 0.6 + Math.random() * 0.5, 11, 0.8, 0.88, 0.95, 2);     // (kind 2: leaves no mark)
    }
    if (this.t - this.heard < 0.15) return;          // (a body going in is a dozen parts: one sound)
    this.heard = this.t;
    this.ctx.soundAt = { x, y, z };
    this.ctx.sfx.splash?.(Math.min(1, 0.35 + size * 0.3));
  }

  /**
   * A round going from a to b: splashes where it enters, and returns what is left of its force at b
   * (each metre under water takes a good share of it away).
   */
  through(a, b) {
    const p = this.pool(b.x, b.z) || this.pool(a.x, a.z);
    if (!p) return 1;
    const da = p.y - a.y, db = p.y - b.y;
    if (db <= 0) return 1;                                  // ends above the surface
    if (da <= 0) {                                          // goes in on the way
      const k = da / (da - db), x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
      if (this.pool(x, z)) this.splash(x, p.y, z, 0.35);
      const len = _v.set(b.x - x, b.y - p.y, b.z - z).length();
      return Math.exp(-len / 1.2);
    }
    return Math.exp(-_v.set(b.x - a.x, b.y - a.y, b.z - a.z).length() / 1.2);
  }

  /** Before the physics step: float, drag and splash everything in the water. */
  update(dt) {
    this.t += dt;
    this.normals.offset.set(this.t * 0.012, this.t * 0.008);
    if (!this.pools.length || dt <= 0) { this.setUnder(false); return; }
    const ctx = this.ctx;
    for (const r of ctx.ragdolls) {
      if (r.removed) continue;
      for (const n in r.parts) { const p = r.parts[n]; if (!p.gone) this.soak(p.body, 0.12, 1.12, dt); }
    }
    for (const pr of ctx.props) if (!pr.removed) this.soak(pr.body, pr.def.half ? pr.def.half[1] : pr.def.r || 0.25, FLOAT[pr.type] ?? 1.2, dt);
    for (const c of ctx.gore.chunkList) if (!c.stuck) this.soak(c.body, c.r, 0.85, dt);
    const cam = ctx.camera.getWorldPosition(_v);
    this.setUnder(this.under(cam.x, cam.y, cam.z));
  }

  /** One body: buoyancy by how deep it is (r: about half its height; k: how strongly it floats; 1 = just), and drag. */
  soak(body, r, k, dt) {
    if (!body.isDynamic()) return;
    const t = body.translation(), p = this.pool(t.x, t.z);
    const was = this.was.get(body);
    this.was.set(body, t.y);
    if (!p) return;
    const sub = Math.min(1, Math.max(0, (p.y - t.y) / (2 * r) + 0.5));
    if (sub <= 0) return;
    const v = body.linvel();
    if (was !== undefined && was >= p.y && t.y < p.y && v.y < -SPLASH_SPEED) this.splash(t.x, p.y, t.z, Math.min(2.5, body.mass() / 30 * -v.y / 4));
    const drag = Math.max(0, 1 - 2.6 * dt * sub), w = body.angvel(), spin = Math.max(0, 1 - 2 * dt * sub);
    body.setLinvel({ x: v.x * drag, y: v.y * drag + 9.81 * k * sub * dt, z: v.z * drag }, true);
    body.setAngvel({ x: w.x * spin, y: w.y * spin, z: w.z * spin }, true);
  }

  /** The camera went under (or came up): everything goes blue and close. */
  setUnder(on) {
    if (on === this.underwater) return;
    this.underwater = on;
    document.body.classList.toggle('underwater', on);
    const fog = this.ctx.scene.fog;
    if (on) { this.fogWas = [fog.color.getHex(), fog.density]; fog.color.set(0x0e4a5e); fog.density = 0.18; }
    else if (this.fogWas) { fog.color.setHex(this.fogWas[0]); fog.density = this.fogWas[1]; }
  }
}

// how strongly each kind of prop floats (1 = neutral; more rides higher, less sinks)
const FLOAT = { crate: 2.2, ball: 4, barrel: 1.6, explosive: 1.4, propane: 1.3, plank: 2.5, pallet: 2.4, chair: 1.6, table: 1.5, cone: 1.3, mag: 0.5, grenade: 0.4, flashbang: 0.5, rocket: 0.6, car: 0.3, dumpster: 0.4, block: 0.5, sandbags: 0.6, lamp: 0.6 };
