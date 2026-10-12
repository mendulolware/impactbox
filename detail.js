import { bake, fbm, hash, lineMask } from './textures.js';

// Fine surface detail for the models: brushed steel, moulded plastic, wood grain, woven cloth,
// skin and so on. Each is a small tile (colour + normal + roughness) that repeats every few
// centimetres, so it stays sharp with a gun right in front of the camera. The colour maps are
// close to white: they vary the model's own colour rather than replace it.
// Everything is generated here; no image files are loaded.

/** Noise with a different period along each axis (long streaks one way, fine the other). */
function fbm2(u, v, px, py, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const ax = px << o, ay = py << o;
    const x = u * ax, y = v * ay;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ix % ax, x1 = (x0 + 1) % ax, y0 = iy % ay, y1 = (y0 + 1) % ay;
    const s = seed + o * 17;
    const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
    sum += amp * (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Scattered points, one per grid cell. Returns the distances to the nearest two, in cells. */
const _cell = [0, 0];
function cells(u, v, n, seed) {
  const x = u * n, y = v * n;
  const ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = ix + ox, cy = iy + oy;
    const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const px = cx + 0.15 + 0.7 * hash(wx, wy, seed), py = cy + 0.15 + 0.7 * hash(wx, wy, seed + 31);
    const d = Math.hypot(x - px, y - py);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  _cell[0] = d1; _cell[1] = d2;
  return _cell;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const grey = (o, c) => { o.r = o.g = o.b = c; };

/** A few straight scratches, wrapped so the tile repeats. */
function scratches(size, count, seed) {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return lineMask(size, (g, n) => {
    for (let k = 0; k < count; k++) {
      const x = rand() * n, y = rand() * n, a = (rand() - 0.5) * 0.9, len = (0.1 + rand() * 0.5) * n;
      g.lineWidth = 0.6 + rand() * 0.8;
      g.globalAlpha = 0.35 + rand() * 0.65;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        g.beginPath();
        g.moveTo(x + ox * n, y + oy * n);
        g.lineTo(x + ox * n + Math.cos(a) * len, y + oy * n + Math.sin(a) * len);
        g.stroke();
      }
    }
  });
}

const MAKERS = {
  // machined / blued steel: fine brushing along U, the odd scratch
  steel() {
    const size = 256, sc = scratches(size, 9, 11);
    return bake(size, 0.55, (u, v, x, y, o) => {
      const streak = fbm2(u, v, 2, 96, 3, 5), fine = hash(x, y, 3), s = sc[y * size + x];
      grey(o, 0.95 + 0.07 * (streak - 0.5) + 0.08 * s);
      o.h = 0.5 * streak + 0.1 * fine - 0.2 * s;
      o.rough = Math.min(1, Math.max(0.3, 0.84 + 0.26 * (streak - 0.5) + 0.08 * (fine - 0.5) - 0.1 * s));
    });
  },
  // cast, parkerised or sand-blasted metal: an even fine grain
  cast() {
    return bake(128, 0.9, (u, v, x, y, o) => {
      const g = hash(x, y, 7), lump = fbm(u, v, 24, 3, 3);
      grey(o, 0.93 + 0.1 * (lump - 0.5));
      o.h = 0.55 * lump + 0.45 * g;
      o.rough = 0.86 + 0.22 * (lump - 0.5);
    });
  },
  // painted sheet metal: slight orange peel, scuffs
  paint() {
    const size = 256, sc = scratches(size, 14, 5);
    return bake(size, 0.9, (u, v, x, y, o) => {
      const peel = fbm(u, v, 40, 2, 9), blotch = fbm(u, v, 5, 3, 21), s = sc[y * size + x];
      grey(o, 0.96 + 0.07 * (blotch - 0.5) - 0.18 * s);
      o.h = 0.45 * peel - 0.6 * s;
      o.rough = Math.min(1, 0.8 + 0.3 * (blotch - 0.5) + 0.35 * s);
    });
  },
  // moulded plastic
  polymer() {
    return bake(128, 0.5, (u, v, x, y, o) => {
      const lump = fbm(u, v, 40, 2, 9), g = hash(x, y, 2);
      grey(o, 0.96 + 0.05 * (g - 0.5));
      o.h = lump;
      o.rough = 0.88 + 0.18 * (lump - 0.5);
    });
  },
  // grip texture: raised dots
  stipple() {
    return bake(128, 2.6, (u, v, x, y, o) => {
      const d = cells(u, v, 22, 4)[0];
      const bump = 1 - sstep(0.12, 0.48, d);
      grey(o, 0.86 + 0.14 * bump);
      o.h = bump;
      o.rough = 0.95 - 0.1 * bump;
    });
  },
  rubber() {
    return bake(128, 1.2, (u, v, x, y, o) => {
      const n = fbm(u, v, 48, 2, 13);
      grey(o, 0.95 + 0.08 * (n - 0.5));
      o.h = n;
      o.rough = 0.95;
    });
  },
  // varnished hardwood: growth rings stretched along U
  wood() {
    return bake(512, 1.5, (u, v, x, y, o) => {
      const t = v * 11 + 2.6 * fbm2(u, v, 2, 5, 3, 11);
      const ring = Math.pow(0.5 + 0.5 * Math.sin(TAU * t), 3);
      const fibre = fbm2(u, v, 4, 200, 2, 23);
      const c = 1.0 - 0.34 * ring - 0.12 * (fibre - 0.5) + 0.12 * (fbm2(u, v, 2, 3, 2, 7) - 0.5);
      o.r = c; o.g = c * 0.965; o.b = c * 0.9;
      o.h = 0.4 * fibre - 0.45 * ring;
      o.rough = 0.82 + 0.18 * ring + 0.1 * (fibre - 0.5);
    });
  },
  // rough sawn softwood for crates and pallets
  plank() {
    return bake(512, 2.2, (u, v, x, y, o) => {
      const t = v * 7 + 3.2 * fbm2(u, v, 2, 4, 3, 31);
      const ring = Math.pow(0.5 + 0.5 * Math.sin(TAU * t), 2);
      const fibre = fbm2(u, v, 3, 170, 3, 43), saw = fbm2(u, v, 70, 2, 2, 5);
      const stain = fbm(u, v, 4, 3, 77);
      const c = 1.02 - 0.3 * ring - 0.2 * (fibre - 0.5) - 0.22 * Math.max(0, stain - 0.5) * 2;
      o.r = c; o.g = c * 0.97; o.b = c * 0.92;
      o.h = 0.55 * fibre - 0.3 * ring + 0.2 * saw;
      o.rough = 0.95;
    });
  },
  // plain woven fabric
  cloth() {
    const N = 48;
    return bake(256, 1.5, (u, v, x, y, o) => {
      const a = Math.sin(TAU * u * N), b = Math.sin(TAU * v * N);
      const weave = 0.5 + 0.5 * a * b, fuzz = hash(x, y, 9), slub = fbm2(u, v, 3, 40, 2, 15);
      grey(o, 0.86 + 0.1 * weave + 0.06 * (slub - 0.5) + 0.04 * (fuzz - 0.5));
      o.h = 0.7 * weave + 0.2 * slub + 0.1 * fuzz;
      o.rough = 0.97;
    });
  },
  // twill with pale cross threads showing through
  denim() {
    const N = 40;
    return bake(256, 1.7, (u, v, x, y, o) => {
      const diag = 0.5 + 0.5 * Math.sin(TAU * (u + v) * N);
      const cross = 0.5 + 0.5 * Math.sin(TAU * (u - v) * N * 0.5);
      const slub = fbm2(u, v, 60, 3, 2, 21), fuzz = hash(x, y, 5);
      const c = 0.78 + 0.22 * diag * (0.6 + 0.4 * cross) + 0.12 * (slub - 0.5) + 0.05 * (fuzz - 0.5);
      o.r = c * 0.97; o.g = c * 0.99; o.b = c * 1.03;
      o.h = 0.75 * diag + 0.25 * slub;
      o.rough = 0.96;
    });
  },
  // heavy coarse weave: webbing, sandbags, jacket sleeves
  canvas() {
    const N = 26;
    return bake(256, 2.3, (u, v, x, y, o) => {
      const a = Math.abs(Math.sin(Math.PI * u * N)), b = Math.abs(Math.sin(Math.PI * v * N));
      const over = (Math.floor(u * N) + Math.floor(v * N)) % 2 ? a : b;
      const slub = fbm(u, v, 9, 3, 33), fuzz = hash(x, y, 1);
      grey(o, 0.8 + 0.16 * over + 0.1 * (slub - 0.5) + 0.05 * (fuzz - 0.5));
      o.h = 0.8 * over + 0.2 * slub;
      o.rough = 1;
    });
  },
  // rib knit: columns of little V stitches
  knit() {
    const N = 18;
    return bake(256, 2.6, (u, v, x, y, o) => {
      const col = u * N, f = col - Math.floor(col);
      const vee = 0.5 + 0.5 * Math.cos(TAU * (v * N * 1.5 - Math.abs(f - 0.5) * 1.4));
      const rib = Math.sin(Math.PI * f);
      const fuzz = hash(x, y, 8);
      grey(o, 0.82 + 0.14 * vee * rib + 0.05 * (fuzz - 0.5));
      o.h = 0.6 * rib + 0.4 * vee * rib;
      o.rough = 1;
    });
  },
  // leather: plates divided by a network of creases
  leather() {
    return bake(256, 2.0, (u, v, x, y, o) => {
      const c = cells(u, v, 30, 6);
      const plate = sstep(0.0, 0.22, c[1] - c[0]);
      const fine = fbm(u, v, 64, 2, 12), blotch = fbm(u, v, 5, 3, 3);
      grey(o, 0.88 + 0.1 * plate + 0.08 * (blotch - 0.5));
      o.h = 0.75 * plate + 0.25 * fine;
      o.rough = 0.78 + 0.22 * (1 - plate) + 0.15 * (blotch - 0.5);
    });
  },
  // skin: the same crease network, much finer and softer, with blotchy colour
  skin() {
    return bake(256, 1.0, (u, v, x, y, o) => {
      const c = cells(u, v, 46, 2);
      const plate = sstep(0.0, 0.3, c[1] - c[0]);
      const blotch = fbm(u, v, 6, 3, 19), fine = fbm(u, v, 40, 2, 5);
      const k = 0.94 + 0.05 * plate + 0.05 * (fine - 0.5);
      o.r = k * (1.0 + 0.03 * (blotch - 0.5));
      o.g = k * (0.985 - 0.07 * (blotch - 0.5));
      o.b = k * (0.975 - 0.09 * (blotch - 0.5));
      o.h = 0.7 * plate + 0.3 * fine;
      o.rough = 0.82 + 0.22 * (blotch - 0.5) + 0.1 * (1 - plate);
    });
  },
  // cropped hair: strands running along U
  hair() {
    return bake(256, 2.4, (u, v, x, y, o) => {
      const strand = fbm2(u, v, 4, 110, 3, 3), clump = fbm2(u, v, 3, 14, 2, 8);
      grey(o, 0.55 + 0.6 * strand * (0.6 + 0.4 * clump));
      o.h = 0.7 * strand + 0.3 * clump;
      o.rough = 0.7 + 0.3 * strand;
    });
  },
  // small cast-concrete tile for props (the yard walls have their own big one)
  concrete() {
    return bake(256, 1.8, (u, v, x, y, o) => {
      const big = fbm(u, v, 4, 4, 5), fine = fbm(u, v, 48, 2, 9);
      const pore = hash(x, y, 17) > 0.985 ? 1 : 0;
      const c = 0.92 + 0.14 * (big - 0.5) + 0.06 * (fine - 0.5) - 0.3 * pore;
      o.r = c; o.g = c * 0.995; o.b = c * 0.98;
      o.h = 0.5 * fine + 0.25 * big - 0.9 * pore;
      o.rough = 0.95;
    });
  },
};

const made = new Map();     // kind -> { map, normalMap, roughnessMap }
const scaled = new Map();   // kind@tile -> the same, repeating every `tile` metres

/** The detail set for a surface kind, sized so one tile covers `tile` metres (model UVs are in metres). */
export function detail(kind, tile = 0.1) {
  if (!MAKERS[kind]) return null;
  const key = `${kind}@${tile}`;
  let set = scaled.get(key);
  if (set) return set;
  let base = made.get(kind);
  if (!base) { base = MAKERS[kind](); made.set(kind, base); }
  set = {};
  for (const k in base) {
    const t = base[k].clone();
    t.repeat.set(1 / tile, 1 / tile);
    t.needsUpdate = true;
    set[k] = t;
  }
  scaled.set(key, set);
  return set;
}
