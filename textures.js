import * as THREE from 'three';

// Surface materials generated in code: each one gets a colour map, a normal map (so light
// catches the bumps, cracks and seams) and a roughness map (so stains and wet patches shine
// differently). Everything tiles seamlessly. No image files are loaded.

// ---- tileable value noise -------------------------------------------------------------------
export function hash(ix, iy, seed) {
  const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period, x1 = (x0 + 1) % period;
  const y0 = ((iy % period) + period) % period, y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** Fractal noise over the unit square, tiling with `period` cells at the coarsest octave. */
export function fbm(u, v, period, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const p = period << o;
    sum += amp * noise(u * p, v * p, p, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// ---- helpers --------------------------------------------------------------------------------
function canvasOf(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Run a per-pixel function and build colour / normal / roughness textures from what it returns. */
export function bake(size, strength, fn) {
  const height = new Float32Array(size * size);
  const col = canvasOf(size), nrm = canvasOf(size), rgh = canvasOf(size);
  const cctx = col.getContext('2d'), nctx = nrm.getContext('2d'), rctx = rgh.getContext('2d');
  const cimg = cctx.createImageData(size, size), nimg = nctx.createImageData(size, size), rimg = rctx.createImageData(size, size);
  const out = { r: 0, g: 0, b: 0, h: 0, rough: 1 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      fn(x / size, y / size, x, y, out);
      height[i] = out.h;
      cimg.data[i * 4] = out.r * 255; cimg.data[i * 4 + 1] = out.g * 255; cimg.data[i * 4 + 2] = out.b * 255; cimg.data[i * 4 + 3] = 255;
      const r = out.rough * 255;
      rimg.data[i * 4] = r; rimg.data[i * 4 + 1] = r; rimg.data[i * 4 + 2] = r; rimg.data[i * 4 + 3] = 255;
    }
  }
  // normals from the height field (wrapping, so the tile edges match)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x + size - 1) % size, xr = (x + 1) % size, yu = (y + size - 1) % size, yd = (y + 1) % size;
      const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
      const dy = (height[yd * size + x] - height[yu * size + x]) * strength;
      const l = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nimg.data[i] = (-dx * l * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = (dy * l * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = (l * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0); nctx.putImageData(nimg, 0, 0); rctx.putImageData(rimg, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(col, true), normalMap: tex(nrm, false), roughnessMap: tex(rgh, false) };
}

/** A black-on-clear drawing (cracks, seams) read back as a 0..1 mask. */
export function lineMask(size, draw) {
  const c = canvasOf(size);
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
  draw(g, size);
  const d = g.getImageData(0, 0, size, size).data;
  const m = new Float32Array(size * size);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] / 255;
  return m;
}

// ---- asphalt ---------------------------------------------------------------------------------
function asphalt() {
  const size = 1024;
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // wandering cracks, drawn nine times offset by one tile so they wrap
  const cracks = lineMask(size, (g, s) => {
    for (let k = 0; k < 9; k++) {
      let x = rand() * s, y = rand() * s, a = rand() * 6.28;
      const pts = [[x, y]];
      const len = 30 + rand() * 60;
      for (let i = 0; i < len; i++) {
        a += (rand() - 0.5) * 0.9;
        x += Math.cos(a) * 9; y += Math.sin(a) * 9;
        pts.push([x, y]);
      }
      g.lineWidth = 1.2 + rand() * 1.6;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        g.beginPath();
        pts.forEach(([px, py], i) => (i ? g.lineTo(px + ox * s, py + oy * s) : g.moveTo(px + ox * s, py + oy * s)));
        g.stroke();
      }
    }
  });
  return bake(size, 2.6, (u, v, x, y, o) => {
    const grain = hash(x, y, 3);                          // individual stones
    const lumps = fbm(u, v, 48, 3, 11);                    // aggregate
    const blotch = fbm(u, v, 5, 4, 23);                    // worn / patched areas
    const stain = Math.max(0, fbm(u, v, 4, 3, 41) - 0.58) * 4; // oil
    const crack = cracks[y * size + x];
    let c = 0.235 + 0.075 * (blotch - 0.5) * 2 + 0.07 * (grain - 0.5) + 0.05 * (lumps - 0.5);
    if (grain > 0.975) c += 0.12;                          // pale chips
    c *= 1 - 0.45 * Math.min(1, stain) - 0.6 * crack;
    o.r = c * 1.0; o.g = c * 1.0; o.b = c * 1.04;
    o.h = 0.55 * lumps + 0.45 * grain - 1.6 * crack;
    o.rough = Math.min(1, 0.93 - 0.45 * Math.min(1, stain) + 0.05 * grain);
  });
}

// ---- cast concrete ---------------------------------------------------------------------------
function concrete() {
  const size = 1024;
  return bake(size, 2.0, (u, v, x, y, o) => {
    const big = fbm(u, v, 3, 4, 5);
    const fine = fbm(u, v, 64, 2, 9);
    const pores = hash(x, y, 17) > 0.992 ? 1 : 0;
    // weathering runs down the wall (v is up-down on a wall face)
    const streak = Math.max(0, fbm(u, v * 0.12, 24, 3, 31) - 0.5) * 2;
    // formwork seams on the tile border, and four tie holes
    const eu = Math.min(u, 1 - u), ev = Math.min(v, 1 - v);
    const seam = Math.max(0, 1 - Math.min(eu, ev) * size / 3);
    let tie = 0;
    for (const tx of [0.25, 0.75]) for (const ty of [0.25, 0.75]) {
      tie = Math.max(tie, 1 - Math.hypot(u - tx, v - ty) * size / 9);
    }
    tie = Math.max(0, tie);
    let c = 0.56 + 0.1 * (big - 0.5) * 2 + 0.035 * (fine - 0.5) * 2;
    c *= 1 - 0.22 * streak - 0.35 * seam - 0.4 * tie - 0.3 * pores;
    o.r = c * 1.0; o.g = c * 0.99; o.b = c * 0.96;
    o.h = 0.5 * fine + 0.2 * big - 1.2 * seam - 1.5 * tie - 0.8 * pores;
    o.rough = 0.88 - 0.12 * streak;
  });
}

// ---- timber planks -----------------------------------------------------------------------------
function planks() {
  const size = 512;
  const PLANKS = 6;
  return bake(size, 2.2, (u, v, x, y, o) => {
    const p = Math.floor(v * PLANKS);
    const within = v * PLANKS - p;
    const tone = 0.75 + 0.5 * hash(p, 1, 3);                      // each board a different shade
    const shift = hash(p, 2, 3);
    const grain = fbm(u + shift, v * 14, 6, 4, 19 + p);           // long streaks along the board
    const fibre = hash(x, y * 7, 5);
    const gap = Math.max(0, 1 - Math.min(within, 1 - within) * (size / PLANKS) / 2.5);
    // butt joint somewhere along each board
    const joint = Math.max(0, 1 - Math.abs(((u + shift) % 1) - 0.5) * size / 2.5);
    let c = (0.33 + 0.16 * (grain - 0.5) * 2 + 0.03 * (fibre - 0.5)) * tone;
    c *= 1 - 0.7 * gap - 0.6 * joint;
    o.r = c * 1.0; o.g = c * 0.66; o.b = c * 0.38;
    o.h = 0.5 * grain + 0.1 * fibre - 1.5 * gap - 1.2 * joint;
    o.rough = 0.8 + 0.12 * grain;
  });
}

// ---- brickwork ---------------------------------------------------------------------------------
/** One tile is 1.2 m: four bricks across, sixteen courses up, every other course shifted half a brick. */
function brick() {
  const size = 512, ROWS = 16, COLS = 4;
  return bake(size, 2.6, (u, v, x, y, o) => {
    const row = Math.floor(v * ROWS);
    const uu = u * COLS + (row % 2) * 0.5;
    const col = Math.floor(uu);
    const fu = uu - col, fv = v * ROWS - row;
    const joint = Math.max(1 - Math.min(fu, 1 - fu) * (size / COLS) / 3.5, 1 - Math.min(fv, 1 - fv) * (size / ROWS) / 3.0);
    const m = Math.min(1, Math.max(0, joint));                    // 1 in the mortar
    const tone = hash(col % COLS, row, 7);                        // every brick fired a little differently
    const grit = fbm(u, v, 64, 2, 13);
    const soot = Math.max(0, fbm(u, v * 0.3, 6, 3, 29) - 0.5) * 2;
    const k = (tone > 0.86 ? 0.66 : 1) * (1 - 0.3 * soot);
    const r = (0.6 + 0.2 * (tone - 0.5) + 0.07 * (grit - 0.5)) * k;
    const g = (0.4 + 0.12 * (tone - 0.5) + 0.05 * (grit - 0.5)) * k;
    const b = (0.33 + 0.1 * (tone - 0.5) + 0.05 * (grit - 0.5)) * k;
    const mo = 0.62 + 0.08 * (grit - 0.5) - 0.15 * soot;
    o.r = r + (mo - r) * m; o.g = g + (mo * 0.97 - g) * m; o.b = b + (mo * 0.92 - b) * m;
    o.h = (1 - m) * (0.7 + 0.3 * grit);
    o.rough = 0.9 - 0.06 * tone + 0.05 * m;
  });
}

// ---- corrugated sheet metal ----------------------------------------------------------------------
/** One tile is 2 m: sixteen ribs across, a sheet joint along the edge, rust running down from it. */
function metal() {
  const size = 512, RIBS = 16;
  return bake(size, 3.0, (u, v, x, y, o) => {
    const wave = 0.5 + 0.5 * Math.cos(u * RIBS * Math.PI * 2);
    const rust = Math.min(1, Math.max(0, fbm(u, v * 0.25, 8, 4, 51) - 0.64) * 3.2) * 0.8;
    const dirt = fbm(u, v, 8, 3, 61);
    const seam = Math.max(0, 1 - Math.min(v, 1 - v) * size / 2.5);
    const c = 0.7 + 0.1 * (wave - 0.5) + 0.08 * (dirt - 0.5);
    o.r = c + (0.36 - c) * rust; o.g = c + (0.2 - c) * rust; o.b = c + (0.11 - c) * rust;
    o.r *= 1 - 0.5 * seam; o.g *= 1 - 0.5 * seam; o.b *= 1 - 0.5 * seam;
    o.h = wave * 0.9 - seam;
    o.rough = 0.5 + 0.38 * rust + 0.1 * (dirt - 0.5);
  });
}

/** Low-frequency blotches, used to break up the repetition of the ground over long distances. */
function macro() {
  const size = 256;
  const c = canvasOf(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(x / size, y / size, 4, 5, 77) * 255;
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Worn white road paint, as an alpha mask. */
function paint() {
  const size = 256;
  const c = canvasOf(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wear = fbm(x / size, y / size, 8, 4, 91) + 0.25 * (hash(x, y, 5) - 0.5);
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 235;
    img.data[i + 3] = wear > 0.42 ? 225 : wear > 0.36 ? 110 : 0;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let surfaces = null;
/** Every surface, made once. `tile` on each is how many metres one copy of it covers. */
export function makeSurfaces() {
  if (!surfaces) {
    surfaces = { asphalt: asphalt(), concrete: concrete(), planks: planks(), brick: brick(), metal: metal(), macro: macro(), paint: paint() };
    Object.assign(surfaces, { tile: { asphalt: 6, concrete: 4, planks: 2.4, brick: 1.2, metal: 2 } });
  }
  return surfaces;
}

/**
 * Box geometry whose texture coordinates are in metres, so a material looks the same scale on
 * a 1 m crate-sized block and a 80 m wall. `tile` is how many metres one copy of the texture covers.
 */
export function boxWithWorldUVs(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z, four vertices each
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return g;
}
