import { PROP_TYPES } from './props.js';
import { clubBeat } from './audio.js';

// The maps. Each one is a description:
//   sky       time of day (SKIES in world.js)
//   spawn     where the player starts; yaw 0 faces -z
//   bounds    the rectangle NPCs keep to
//   killY     fall below this and you die (maps with a long way down)
//   build(b)  the static world, made with the MapBuilder in world.js
//   populate  the people and loose objects it starts with
// Distances are metres, y is up. To add a map, add an entry here: the menus pick it up.

const TAU = Math.PI * 2;

/** Helpers for populate(): put a prop down on its base, and people on their feet. */
function crew(ctx) {
  const at = (type, x, z, yaw = 0, base = 0) => {
    const d = PROP_TYPES[type];
    return ctx.spawnProp(type, { x, y: base + (d.half ? d.half[1] : d.h || d.r) + 0.03, z }, yaw);
  };
  const npc = (x, z, kind, base = 0, yaw = Math.random() * TAU) => ctx.spawnRagdoll({ x, y: base + 0.05, z }, yaw, kind ? { kind } : {});
  const stack = (type, x, z, n, base = 0, yaw = 0) => {
    const d = PROP_TYPES[type], h = (d.half ? d.half[1] : d.h) * 2 + 0.02;
    for (let i = 0; i < n; i++) at(type, x, z, yaw + i * 0.2, base + i * h);
  };
  // someone who stays put (and goes back there once things calm down): staff, a queue, a shopper in an aisle
  const stay = (x, z, kind, yaw = Math.random() * TAU, base = 0, dance = false) => { const r = npc(x, z, kind, base, yaw); if (r) r.spot = { x, z, dance }; return r; };
  return { at, npc, stack, stay };
}

/** Rows of windows on one face of a building. The face runs from a to b along x (or z), at height 0..h. */
function windows(b, axis, a0, a1, fixed, out, h, glass, lit, opts = {}) {
  const { first = 4.2, step = 3.2, every = 2.7, w = 1.3, wh = 1.7, chance = 0.2 } = opts;
  const n = Math.max(1, Math.floor((a1 - a0 - 1.2) / every));
  const pad = (a1 - a0 - (n - 1) * every) / 2;
  for (let y = first; y < h - 1.4; y += step) {
    for (let i = 0; i < n; i++) {
      const a = a0 + pad + i * every;
      const m = b.rnd() < chance ? lit : glass;
      if (axis === 'x') b.box(a, y, fixed + out * 0.03, w, wh, 0.08, m, { solid: false });
      else b.box(fixed + out * 0.03, y, a, 0.08, wh, w, m, { solid: false });
    }
  }
}

/** The club's name in pink neon, for nattklubb's sign() calls: a soft glow round a hot white core. */
function neonName(g, W, H) {
  const text = 'TYRS NATTKLUBB';
  let size = Math.round(H * 0.62);
  g.font = `italic 800 ${size}px "Barlow Condensed", Impact, "Arial Narrow", sans-serif`;
  const fit = (W * 0.94) / g.measureText(text).width;
  if (fit < 1) { size = Math.floor(size * fit); g.font = `italic 800 ${size}px "Barlow Condensed", Impact, "Arial Narrow", sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ff2bd6'; g.shadowBlur = H * 0.22; g.fillStyle = '#ff6ae4';
  g.fillText(text, W / 2, H * 0.52);
  g.shadowBlur = 0; g.fillStyle = '#ffe9fb';
  g.fillText(text, W / 2, H * 0.52);
}

/**
 * A painted sign for sign(): text centred on a colour (or on nothing, with a glow round it), an optional border and a
 * smaller second line under it. Returns the painter.
 */
function textSign({ text, sub = '', fg = '#ffffff', bg = null, glow = null, border = null, italic = false, weight = 800 }) {
  return (g, W, H) => {
    const font = (size) => `${italic ? 'italic ' : ''}${weight} ${size}px "Barlow Condensed", Impact, "Arial Narrow", sans-serif`;
    const fit = (t, size) => { g.font = font(size); const k = (W * 0.88) / g.measureText(t).width; if (k < 1) g.font = font(Math.floor(size * k)); };
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
    if (border) { g.strokeStyle = border; g.lineWidth = Math.max(4, H * 0.05); g.strokeRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const y = sub ? H * 0.4 : H * 0.53;
    fit(text, Math.round(H * (sub ? 0.46 : 0.6)));
    if (glow) { g.shadowColor = glow; g.shadowBlur = H * 0.18; }
    g.fillStyle = fg;
    g.fillText(text, W / 2, y);
    g.shadowBlur = 0;
    if (sub) { fit(sub, Math.round(H * 0.2)); g.fillText(sub, W / 2, H * 0.77); }
  };
}

/** Simons McDonalds' menu board: what there is and what it costs. */
function menuBoard(g, W, H) {
  g.fillStyle = '#1b1b1d'; g.fillRect(0, 0, W, H);
  const items = [['BIG SIMON', '59:-'], ['SIMONBURGARE', '35:-'], ['CHEESE SIMON', '39:-'], ['POMMES FRITES', '25:-'], ['NUGGETS 6 ST', '45:-'], ['MILKSHAKE', '29:-'], ['GLASS', '15:-'], ['LÄSK', '22:-']];
  const rh = H / 5.2, cw = W / 2;
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = '#ffc72c'; g.font = `800 ${Math.round(rh * 0.62)}px "Barlow Condensed", Impact, sans-serif`;
  g.fillText('MENY', W / 2, rh * 0.6);
  items.forEach(([name, price], i) => {
    const c = i % 2, y = rh * (1.6 + Math.floor(i / 2));
    g.font = `700 ${Math.round(rh * 0.44)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.fillText(name, c * cw + cw * 0.07, y);
    g.textAlign = 'right'; g.fillStyle = '#ffc72c'; g.fillText(price, c * cw + cw * 0.93, y);
  });
}

/** A dartboard: the black and cream segments, the red and green rings, the bull. */
function dartboard(g, W, H) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.48;
  g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 20; i++) {
    const a0 = (i - 0.5) * Math.PI / 10 - Math.PI / 2, a1 = a0 + Math.PI / 10;
    for (const [r0, r1, col] of [[0.1, 0.62, i % 2 ? '#e8dcc0' : '#151515'], [0.62, 0.68, i % 2 ? '#1f8a3a' : '#c8202a'], [0.68, 0.92, i % 2 ? '#e8dcc0' : '#151515'], [0.92, 0.98, i % 2 ? '#1f8a3a' : '#c8202a']]) {
      g.fillStyle = col; g.beginPath(); g.arc(cx, cy, R * r1, a0, a1); g.arc(cx, cy, R * r0, a1, a0, true); g.fill();
    }
  }
  g.fillStyle = '#1f8a3a'; g.beginPath(); g.arc(cx, cy, R * 0.1, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c8202a'; g.beginPath(); g.arc(cx, cy, R * 0.045, 0, Math.PI * 2); g.fill();
}

/** The Wall of Fame: a gold-framed board, a star, and the one name on it. */
function wallOfFame(g, W, H) {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2c0a18'); bg.addColorStop(1, '#13040b');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#d4a64a'; g.lineWidth = 16; g.strokeRect(12, 12, W - 24, H - 24);
  g.lineWidth = 3; g.strokeRect(38, 38, W - 76, H - 76);
  const star = (cx, cy, R) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? R * 0.42 : R; g.lineTo(cx + Math.cos(a) * k, cy + Math.sin(a) * k); }
    g.closePath(); g.fill();
  };
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#e8c46a';
  g.font = '700 64px "Barlow Condensed", "Arial Narrow", sans-serif';
  if ('letterSpacing' in g) g.letterSpacing = '14px';
  g.fillText('WALL OF FAME', W / 2, H * 0.16);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.shadowColor = '#ffcf6a'; g.shadowBlur = 26;
  star(W / 2, H * 0.41, H * 0.15);
  for (const s of [-1, 1]) star(W / 2 + s * W * 0.3, H * 0.44, H * 0.06);
  g.font = '900 196px "Barlow Condensed", Impact, sans-serif';
  g.fillStyle = '#f2cf72';
  g.fillText('ANTON', W / 2, H * 0.75);
}

export const MAPS = {
  // ------------------------------------------------------------------------------------------ yard
  yard: {
    id: 'yard', name: 'The Yard', icon: '🏗️', blurb: 'open concrete yard',
    sky: 'day', spawn: { x: 0, y: 1.0, z: 14 }, yaw: 0, bounds: { x0: -37, x1: 37, z0: -37, z1: 37 },

    build(b) {
      const concrete = [0xffffff, 0xe9ebee, 0xd8dade].map((c) => b.mat('concrete', c));
      let n = 0;
      const con = () => concrete[n++ % 3];
      const wood = b.mat('planks');
      b.ground();

      // worn painted lines: parking bays and a yard boundary
      for (let i = 0; i < 7; i++) b.stripe(-30 + i * 2.7, 31, 5.2);            // bays along the south side
      b.stripe(-21.9, 33.6, 16.4, Math.PI / 2);
      for (let i = 0; i < 5; i++) b.stripe(22 + i * 2.7, 20, 5.2);
      b.stripe(0, 0, 60, 0, 0.11);                                             // centre line across the yard
      b.stripe(0, 0, 60, Math.PI / 2, 0.11);

      // perimeter walls
      const W = 42, H = 7;
      b.box(0, H / 2, -W, W * 2 + 2, H, 1, con());
      b.box(0, H / 2, W, W * 2 + 2, H, 1, con());
      b.box(-W, H / 2, 0, 1, H, W * 2 + 2, con());
      b.box(W, H / 2, 0, 1, H, W * 2 + 2, con());

      // launch ramp
      b.box(14, 1.05, -10, 7, 0.4, 14, wood, { rx: -0.17 });

      // raised platform with stairs, supports and a back rail
      b.box(-18, 2.2, -16, 11, 0.4, 10, wood);
      for (let i = 0; i < 8; i++) {
        const hgt = 0.3 * (i + 1);
        b.box(-18, hgt / 2, -10.5 + (7 - i) * 1.0 + 0.5, 3.2, hgt, 1.0, con());
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(-18 + sx * 5.1, 1.0, -16 + sz * 4.6, 0.35, 2.0, 0.35, con());
      b.box(-18, 2.9, -20.9, 11, 1.0, 0.2, con());

      // cover & pillars
      b.box(6, 0.75, 6, 4, 1.5, 0.6, con());
      b.box(-8, 0.75, 8, 0.6, 1.5, 4, con());
      b.box(20, 0.75, 12, 5, 1.5, 0.6, con(), { ry: 0.5 });
      b.box(0, 2.5, -26, 1.2, 5, 1.2, con());
      b.box(10, 2.5, -26, 1.2, 5, 1.2, con());
      b.box(5, 5.3, -26, 12, 0.6, 1.6, con());

      // a tall block with a ramp up, to throw things off
      b.box(26, 1.5, -22, 8, 3, 8, con());
      b.box(16, 1.3, -22, 12.37, 0.4, 5, con(), { rz: 0.245 });
    },

    populate(ctx) {
      const { at, npc } = crew(ctx);
      for (let i = 0; i < 5; i++) npc(-8 + i * 4, -4 - (i % 2) * 3);
      npc(3, -14, 'thug', 0, 0);
      for (let i = 0; i < 4; i++) ctx.spawnProp('crate', { x: 9 + (i % 2) * 0.65, y: 0.32 + Math.floor(i / 2) * 0.62, z: 4 }, 0);
      at('explosive', -4, 1); at('explosive', 10, -3); at('barrel', -5.2, 1.2);
      ctx.spawnProp('ball', { x: 2, y: 1.0, z: 8 });
      // parked cars, bins, lamps, a sandbag position, pallets and cones
      at('car', -27.3, 31, 0.04); at('car', -19.2, 31, Math.PI - 0.06); at('car', 24.7, 20, 0.02);
      at('dumpster', -38.6, 14, Math.PI / 2); at('dumpster', -38.6, 10.6, Math.PI / 2 + 0.08); at('dumpster', 30, -38.9, 0);
      for (const [x, z] of [[-39.5, 30], [-39.5, -2], [39.5, 30], [39.5, -2], [-12, -40], [18, -40]]) at('lamp', x, z, Math.atan2(-x, -z));
      for (let i = 0; i < 3; i++) at('sandbags', -22 + i * 1.95, 2, 0);
      for (let i = 0; i < 2; i++) at('sandbags', -21 + i * 1.95, 2, 0, 0.55);
      at('pallet', 15, 8, 0.3); at('pallet', 15, 8, 0.25, 0.16); at('pallet', 16.6, 9.2, 1.2);
      at('crate', 15, 8, 0.4, 0.34);
      at('propane', 17.6, 7.4); at('propane', 18.1, 7.8);
      for (const [x, z] of [[-3, 12], [-1.4, 12.6], [0.3, 12.2], [5, -6], [6.2, -7.4]]) at('cone', x, z);
      at('table', -12, 14, 0.2); at('chair', -12.9, 14.3, 1.4); at('chair', -11.2, 13.4, -1.9);
      at('toilet', 37.5, 39.5, Math.PI);
    },
  },

  // ------------------------------------------------------------------------------------- warehouse
  warehouse: {
    id: 'warehouse', name: 'Warehouse', icon: '🏭', blurb: 'racks, containers, a mezzanine',
    sky: 'overcast', spawn: { x: 0, y: 1.0, z: 30 }, yaw: 0, bounds: { x0: -29, x1: 29, z0: -19, z1: 34 },

    build(b) {
      const sheet = b.mat('metal', 0xa9b6bc, { metalness: 0.25 });
      const roofing = b.mat('metal', 0x7d868c, { metalness: 0.25 });
      const steel = b.mat('plain', 0x3a4046, { metalness: 0.6, roughness: 0.5 });
      const orange = b.mat('plain', 0xb8571a, { metalness: 0.3, roughness: 0.55 });
      const floor = b.mat('concrete', 0xb4b8bc, { roughness: 0.62 });
      const con = b.mat('concrete', 0xe4e6e8);
      const wood = b.mat('planks');
      const lampGlow = b.mat('plain', 0x111111, { emissive: 0xffe2b0, emissiveIntensity: 2.5 });
      b.ground();
      b.box(0, 0.04, 0, 62.4, 0.08, 42.4, floor);                        // the slab

      // the shed: walls, a big door in the front, a roof in strips with daylight between them
      const H = 9;
      b.box(0, H / 2, -21, 62.4, H, 0.4, sheet);
      b.box(-31, H / 2, 0, 0.4, H, 42.4, sheet);
      b.box(31, H / 2, 0, 0.4, H, 42.4, sheet);
      b.box(-17.85, H / 2, 21, 26.7, H, 0.4, sheet);
      b.box(17.85, H / 2, 21, 26.7, H, 0.4, sheet);
      b.box(0, 7.25, 21, 9, 3.5, 0.4, sheet);                             // above the door
      for (let i = 0; i < 6; i++) b.box(0, H + 0.2, -18 + i * 7.2, 63, 0.2, 6, roofing);
      for (const z of [-14, 0, 14]) {
        b.box(0, 8.6, z, 62, 0.45, 0.3, steel);                           // roof beams on columns
        for (const x of [-21, -7, 7, 21]) b.box(x, 4.2, z, 0.35, 8.4, 0.35, steel);
      }
      for (const x of [-15, 0, 15]) for (const z of [-7, 7]) {            // lamps hanging from the beams
        b.box(x, 8.0, z, 0.9, 0.12, 0.35, lampGlow, { solid: false });
        b.light(x, 7.6, z, 0xffe2b0, 60, 26);
      }

      // the forecourt, walled in
      b.box(-31, 2, 28.7, 0.5, 4, 15, con);
      b.box(31, 2, 28.7, 0.5, 4, 15, con);
      b.box(0, 2, 36.2, 62.5, 4, 0.5, con);
      for (let i = 0; i < 6; i++) b.stripe(-26 + i * 2.8, 32.5, 5);
      b.stripe(0, 26, 10, 0, 0.11);

      // pallet racking: three runs down the left side
      for (const x of [-27.5, -22.6, -17.7]) {
        for (let z = -18; z <= 6.01; z += 2.4) for (const s of [-0.58, 0.58]) b.box(x + s, 2.7, z, 0.1, 5.4, 0.1, orange);
        b.box(x, 2.7, -6, 0.04, 5.4, 24.2, sheet);                        // back board: goods go in from either aisle
        for (const y of [1.7, 3.35, 5.0]) {
          b.box(x, y, -6, 1.26, 0.07, 24.2, wood);
          for (const s of [-0.6, 0.6]) b.box(x + s, y - 0.1, -6, 0.06, 0.13, 24.2, orange);
        }
      }

      // mezzanine in the back right corner: deck, legs, rails, stairs up from the floor
      b.box(22.9, 3.5, -14.3, 15.8, 0.24, 13, wood);
      for (const x of [15.4, 22.9, 30.4]) for (const z of [-20.4, -8.2]) b.box(x, 1.7, z, 0.3, 3.4, 0.3, steel);
      b.box(24.5, 4.15, -7.85, 12.6, 0.08, 0.08, steel);                  // front rail (the stairs come up at its left end)
      b.box(24.5, 3.85, -7.85, 12.6, 0.06, 0.06, steel);
      for (let x = 18.2; x <= 30.8; x += 2.1) b.box(x, 3.87, -7.85, 0.07, 0.56, 0.07, steel);
      b.box(15.05, 4.15, -14.3, 0.08, 0.08, 13, steel);                   // side rail
      b.box(15.05, 3.85, -14.3, 0.06, 0.06, 13, steel);
      for (let z = -20.6; z <= -7.9; z += 2.1) b.box(15.05, 3.87, z, 0.07, 0.56, 0.07, steel);
      b.stairs(16.6, -4.2, 0, -1, 1.7, 12, 3.62 / 12, 0.3, steel);

      // shipping containers
      b.box(3, 1.34, -17.6, 6.1, 2.6, 2.44, b.mat('metal', 0x8a2f26, { metalness: 0.2 }));
      b.box(3.4, 3.96, -17.5, 6.1, 2.6, 2.44, b.mat('metal', 0x2a6a4a, { metalness: 0.2 }), { ry: 0.06 });
      b.box(-4.6, 1.34, -16.4, 6.1, 2.6, 2.44, b.mat('metal', 0x2b4f86, { metalness: 0.2 }), { ry: -0.35 });

      // the office in the front left corner: plasterboard walls, a door to the floor and one to the forecourt
      const board = b.mat('concrete', 0xd9d4c8, { roughness: 0.8 });
      b.wall(-31, 10, -22, 10, 3, 0.15, board, [[0.5, 1.3]]);
      b.wall(-22, 10, -22, 21, 3, 0.15, board, [[0.5, 1.3]]);
      b.box(-26.5, 3.05, 15.5, 9.2, 0.1, 11.2, board);                    // its ceiling
      b.door(-26.5, 10, 0, { wallH: 3, wallT: 0.15, gap: 1.3 });
      b.door(-22, 15.5, Math.PI / 2, { wallH: 3, wallT: 0.15, gap: 1.3, locked: true });
      b.light(-26.5, 2.8, 15.5, 0xfff1dc, 18, 9);

      // a loading dock along the right wall, with a ramp down
      b.box(27.6, 0.6, 9, 6.4, 1.04, 12, con);
      b.box(27.6, 0.56, 0.9, 6.4, 0.2, 4.5, con, { rx: -0.235 });
    },

    populate(ctx) {
      const { at, npc, stack } = crew(ctx);
      for (const [x, z] of [[-4, 6], [5, 2], [-10, -4], [9, -8], [0, 12], [-13, 10]]) npc(x, z);
      npc(22, -14, 'thug', 3.62); npc(-2, -12, 'thug');
      // goods on the racks, and on the floor
      for (const [x, z, y] of [[-27.5, -14, 1.74], [-27.5, -11, 1.74], [-27.5, -2, 3.39], [-22.6, -16, 1.74], [-22.6, -7, 1.74],
        [-22.6, 2, 3.39], [-17.7, -12, 1.74], [-17.7, 0, 1.74], [-17.7, -5, 3.39], [-27.5, 3, 0.08], [-22.6, -1, 0.08], [-17.7, -16, 0.08]]) {
        at('crate', x + (z % 2 ? 0.33 : -0.33), z, 0, y);
      }
      for (const [x, z] of [[-6, -2], [-5, 3.5], [8, 8], [12, -3]]) { at('pallet', x, z, 0.3, 0.08); stack('crate', x, z, 2, 0.24, 0.2); }
      at('pallet', 14, 12, 1.2, 0.08); at('pallet', 14.3, 12.2, 1.3, 0.24); at('pallet', 14.1, 12, 1.1, 0.4);
      for (const [x, z] of [[8.5, -15], [9.4, -15.6], [9.2, -14.2]]) at('barrel', x, z, 0, 0.08);
      at('explosive', 10.2, -14.9, 0, 0.08); at('explosive', -9, -14, 0, 0.08); at('explosive', 26, 12, 0, 1.12);
      at('propane', 20, -18, 0, 3.62); at('propane', 20.5, -18.3, 0, 3.62);
      at('table', 26, -16, 0.1, 3.62); at('chair', 25, -15.5, 1.5, 3.62); at('chair', 27, -16.6, -1.6, 3.62);
      at('crate', 28.5, 6, 0.3, 1.12); at('crate', 27.8, 7, 0.5, 1.12); at('barrel', 29, 11, 0, 1.12);
      at('car', -12, 30, 0.1); at('dumpster', 22, 34.6, 0); at('cone', 5.4, 22.5); at('cone', -5.4, 22.5);
      at('table', -27, 16, 0.1); at('chair', -28, 16.6, 1.6); at('chair', -26, 15.2, -1.5); npc(-25, 13, 'thug'); npc(-28.5, 18.5);
      ctx.spawnProp('ball', { x: 3, y: 1.0, z: 16 });
    },
  },

  // -------------------------------------------------------------------------------------- rooftops
  rooftops: {
    id: 'rooftops', name: 'Rooftops', icon: '🌇', blurb: 'five roofs, a long way down',
    sky: 'golden', spawn: { x: 0, y: 21.2, z: 15 }, yaw: 0, killY: 12, bounds: { x0: -30, x1: 28, z0: -23, z1: 19 },

    build(b) {
      const glass = b.mat('plain', 0x1a2532, { metalness: 0.3, roughness: 0.12 });
      const lit = b.mat('plain', 0x2a2014, { emissive: 0xffb866, emissiveIntensity: 1.1 });
      const roof = b.mat('asphalt', 0xe6e0d6);
      const con = b.mat('concrete', 0xdcdad4);
      const wood = b.mat('planks');
      const sheet = b.mat('metal', 0xb9c2c6, { metalness: 0.35 });
      const steel = b.mat('plain', 0x3a4046, { metalness: 0.6, roughness: 0.5 });
      b.ground();
      for (let i = -3; i <= 3; i++) b.stripe(i * 14, 22.5, 4, Math.PI / 2, 0.14);     // the street below

      // a block: brick body, roof skin on top, a low wall round the edge with gaps where the bridges land
      const block = (cx, cz, w, d, h, color, gaps) => {
        const brick = b.mat('brick', color);
        b.box(cx, (h - 0.08) / 2, cz, w, h - 0.08, d, brick);
        b.box(cx, h - 0.04, cz, w, 0.08, d, roof);
        const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
        b.wall(x0, z0 + 0.15, x1, z0 + 0.15, 0.8, 0.3, brick, gaps.n || [], h);
        b.wall(x0, z1 - 0.15, x1, z1 - 0.15, 0.8, 0.3, brick, gaps.s || [], h);
        b.wall(x0 + 0.15, z0, x0 + 0.15, z1, 0.8, 0.3, brick, gaps.w || [], h);
        b.wall(x1 - 0.15, z0, x1 - 0.15, z1, 0.8, 0.3, brick, gaps.e || [], h);
        windows(b, 'x', x0, x1, z1, 1, h, glass, lit);
        windows(b, 'x', x0, x1, z0, -1, h, glass, lit);
        windows(b, 'z', z0, z1, x1, 1, h, glass, lit);
        windows(b, 'z', z0, z1, x0, -1, h, glass, lit);
      };
      block(0, 10, 22, 18, 20, 0xffffff, { n: [[0.68, 2.2]], w: [[0.28, 2], [0.72, 2]], e: [[0.5, 2.2]] });   // A: where you start
      block(0, -9, 18, 14, 18, 0xd9c8b4, { s: [[0.72, 2.2]] });                                               // B: north, lower
      block(21, 4, 14, 22, 22, 0xc9b0a0, { w: [[0.77, 2.2]], n: [[0.5, 2.2]] });                              // C: east, higher
      block(-22, 8, 16, 26, 20, 0xe8d8cc, { e: [[0.42, 2], [0.73, 2]] });                                      // D: west, level
      block(21, -17, 14, 12, 19, 0xb9a898, { s: [[0.5, 2.2]] });                                              // E: far corner

      // the ways across
      b.box(-12.5, 20.02, 6, 3.9, 0.1, 1.3, wood);
      b.box(-12.5, 20.02, 14, 3.9, 0.1, 1.1, wood, { ry: 0.05 });
      b.box(4, 19.0, -0.5, 1.5, 0.12, 4.3, wood, { rx: -0.507 });          // A down to B
      b.box(12.5, 21.0, 10, 4.3, 0.12, 1.5, wood, { rz: 0.507 });          // A up to C
      b.box(21, 20.5, -9, 1.5, 0.12, 5.7, wood, { rx: -0.578 });           // C down to E

      // what lives on roofs
      b.box(-6.5, 21.3, 16, 3.2, 2.6, 3.2, con);                           // stair head on A
      b.box(-6.5, 21.05, 14.37, 1.0, 2.1, 0.08, steel, { solid: false });
      for (const [x, y, z, w] of [[6, 20, 15, 1.8], [8.3, 20, 15.2, 1.4], [-3, 18, -12, 1.8], [24, 22, 10, 2.0], [-25, 20, 16, 1.8], [-25, 20, -1, 1.5]]) {
        b.box(x, y + 0.6, z, w, 1.2, 1.1, sheet);                          // air handlers
        b.box(x, y + 1.24, z, w * 0.7, 0.08, 0.8, steel, { solid: false });
      }
      for (const [x, z] of [[19.6, -2.4], [22.4, -2.4], [19.6, 0.4], [22.4, 0.4]]) b.box(x, 22.7, z, 0.18, 1.4, 0.18, steel);
      b.cyl(21, 24.9, -1, 1.7, 3.0, wood, { sides: 18 });                  // water tank on legs, on C
      b.cyl(21, 26.5, -1, 1.8, 0.2, steel, { sides: 18 });
      for (const [x, y, z] of [[3, 18, -5], [-5, 18, -6], [-18, 20, 4], [-27, 20, 8], [17, 19, -20]]) b.cyl(x, y + 0.5, z, 0.22, 1.0, steel);
      b.box(-22, 23.2, -4.2, 9, 3.4, 0.25, b.mat('plain', 0x8a2a22, { roughness: 0.7 }));     // hoarding on D
      for (const x of [-25.5, -18.5]) b.box(x, 21.2, -4.2, 0.2, 2.4, 0.2, steel);
      b.box(3, 18.35, -10, 3, 0.7, 2, glass);                              // skylight on B
      b.cyl(25, 23, -20, 0.06, 8, steel, { solid: false });                // mast on E
      b.box(25, 25.5, -20, 1.6, 0.05, 0.05, steel, { solid: false });

      // the rest of the city: scenery only
      for (let i = 0; i < 26; i++) {
        const a = i / 26 * TAU + b.rnd(-0.1, 0.1), r = b.rnd(58, 105);
        const w = b.rnd(14, 26), d = b.rnd(14, 26), h = b.rnd(10, 46);
        const kind = b.rnd() < 0.55 ? 'brick' : 'concrete';
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        b.box(cx, h / 2, cz, w, h, d, b.mat(kind, [0xd8c6b4, 0xbfb3a8, 0xe6e2da, 0xa99a8e][i % 4]), { solid: false });
        // windows only on the two faces that look back at the roofs
        const o = { every: 3.4, step: 3.6, w: 1.6, wh: 1.9, chance: 0.3 };
        windows(b, 'x', cx - w / 2, cx + w / 2, cz - Math.sign(cz) * d / 2, -Math.sign(cz), h, glass, lit, o);
        windows(b, 'z', cz - d / 2, cz + d / 2, cx - Math.sign(cx) * w / 2, -Math.sign(cx), h, glass, lit, o);
      }
    },

    populate(ctx) {
      const { at, npc, stack } = crew(ctx);
      npc(-4, 8, null, 20); npc(6, 6, null, 20); npc(2, 12, null, 20);
      npc(-22, 4, null, 20); npc(-20, 14, 'thug', 20);
      npc(2, -10, null, 18); npc(-5, -8, null, 18);
      npc(21, 8, 'thug', 22); npc(22, -17, null, 19);
      stack('crate', 8, 4, 2, 20); at('crate', 8.7, 4.4, 0.4, 20);
      at('explosive', -8, 5, 0, 20); at('barrel', -8.8, 5.6, 0, 20);
      at('pallet', -24, 2, 0.2, 20); at('explosive', -19, 18, 0, 20); at('chair', -26, 12, 1, 20); at('table', -26, 13.2, 0, 20);
      at('propane', -6, -13, 0, 18); at('crate', 5, -13, 0.2, 18);
      at('explosive', 18, 12, 0, 22); at('barrel', 25, 2, 0, 22);
      at('crate', 18, -15, 0.3, 19); at('explosive', 25, -14, 0, 19);
      ctx.spawnProp('ball', { x: 3, y: 21, z: 9 });
      at('car', -8, 24.5, Math.PI / 2); at('car', 9, 26, -Math.PI / 2 + 0.05);     // down in the street
    },
  },

  // ---------------------------------------------------------------------------------------- street
  street: {
    id: 'street', name: 'Night Street', icon: '🌃', blurb: 'shopfronts, an alley, street lamps',
    sky: 'dusk', spawn: { x: -34, y: 1.0, z: 1.5 }, yaw: -Math.PI / 2, bounds: { x0: -40, x1: 40, z0: -19, z1: 8 },

    build(b) {
      const glass = b.mat('plain', 0x141c26, { metalness: 0.3, roughness: 0.1 });
      const lit = b.mat('plain', 0x2a2014, { emissive: 0xffb866, emissiveIntensity: 0.75 });
      const shop = b.mat('plain', 0x1c2226, { emissive: 0xa9cdf0, emissiveIntensity: 0.4 });
      const pave = b.mat('concrete', 0xc9cbcc);
      const con = b.mat('concrete', 0xdadbdc);
      const wood = b.mat('planks');
      const steel = b.mat('plain', 0x2c3136, { metalness: 0.6, roughness: 0.45 });
      const lamp = b.mat('plain', 0x111111, { emissive: 0xffc98a, emissiveIntensity: 3 });
      const door = b.mat('plain', 0x3a2a1c, { roughness: 0.6 });
      b.ground();

      // pavements either side of a nine-metre road, and its markings
      b.box(0, 0.075, 6.5, 86, 0.15, 4, pave);
      b.box(0, 0.075, -6.5, 86, 0.15, 4, pave);
      for (let x = -39; x <= 39; x += 6) b.stripe(x, 0, 3, Math.PI / 2, 0.13);
      for (let z = -3.6; z <= 3.61; z += 1.2) b.stripe(-18, z, 3.2, Math.PI / 2, 0.55);     // a crossing

      // one building: a block with a shopfront at street level and windows above
      const building = (x0, x1, side, h, kind, color) => {
        const depth = 12, zf = side * 8.5, zc = side * (8.5 + depth / 2);
        b.box((x0 + x1) / 2, h / 2, zc, x1 - x0, h, depth, b.mat(kind, color));
        windows(b, 'x', x0, x1, zf, -side, h, glass, lit, { first: 5, chance: 0.38 });
        // street level: a door and wide panes, some with the lights left on
        const n = Math.max(1, Math.floor((x1 - x0 - 3) / 3.4));
        const pad = (x1 - x0 - (n - 1) * 3.4) / 2;
        for (let i = 0; i < n; i++) {
          const x = x0 + pad + i * 3.4;
          if (i === Math.floor(n / 2)) b.box(x, 1.2, zf - side * 0.03, 1.1, 2.2, 0.08, door, { solid: false });
          else b.pane(x, 1.65, zf - side * 0.03, 2.5, 2.1, 0.08, b.rnd() < 0.45 ? shop : glass);
        }
        b.box((x0 + x1) / 2, 3.1, zf - side * 0.25, x1 - x0 - 0.6, 0.18, 0.5, steel, { solid: false });      // sign band
      };
      // north side, with an alley between two of them
      building(-43, -27, -1, 12, 'brick', 0xffffff);
      building(-27, -12, -1, 9, 'concrete', 0xe8dcc4);
      building(-12, 6, -1, 14, 'brick', 0xbfa894);
      building(10, 26, -1, 10, 'brick', 0xd8b8a0);
      building(26, 43, -1, 13, 'concrete', 0xcfd3d6);
      b.box(8, 2.6, -20.3, 4, 5.2, 0.4, b.mat('brick', 0xbfa894));        // the alley is a dead end
      // south side
      building(-43, -21, 1, 11, 'concrete', 0xd8d2c8);
      building(-21, -3, 1, 15, 'brick', 0xe6d2c0);
      building(-3, 13, 1, 8, 'brick', 0xffffff);
      building(13, 43, 1, 12, 'brick', 0xc8b0a0);
      b.box(5, 2.75, 7.4, 13, 0.1, 2.2, b.mat('plain', 0x7a1f1f, { roughness: 0.8 }), { rx: 0.14, solid: false });   // awning

      // the street is closed off at both ends
      for (const x of [-42.5, 42.5]) {
        b.box(x, 1.5, 0, 0.3, 3, 17, wood);
        for (const z of [-3.4, 0, 3.4]) b.box(x - Math.sign(x) * 1.2, 0.45, z, 0.6, 0.9, 3.0, con);
      }

      // street lamps: a post, an arm out over the road, and the light itself
      for (const [x, side] of [[-30, -1], [-6, -1], [20, -1], [-18, 1], [6, 1], [32, 1]]) {
        const z = side * 4.9;
        b.cyl(x, 2.6, z, 0.07, 5.2, steel, { sides: 8 });
        b.box(x, 5.15, z - side * 0.7, 0.07, 0.07, 1.5, steel, { solid: false });
        b.box(x, 5.08, z - side * 1.3, 0.3, 0.1, 0.55, lamp, { solid: false });
        b.light(x, 4.9, z - side * 1.3, 0xffc98a, 46, 19);
      }
      b.light(8, 3.2, -11, 0xbfd8ff, 14, 11);                              // one cold lamp down the alley
      b.box(8.0, 3.4, -8.62, 0.4, 0.1, 0.2, shop, { solid: false });

      // a bus shelter
      for (const x of [18.2, 21.8]) b.box(x, 1.3, 7.9, 0.08, 2.3, 0.08, steel);
      b.pane(20, 1.35, 8.05, 3.6, 2.0, 0.05, glass);
      b.box(20, 2.5, 7.4, 4.0, 0.08, 1.5, steel);
      b.box(20, 0.6, 7.75, 2.6, 0.08, 0.4, wood);
    },

    populate(ctx) {
      const { at, npc, stack } = crew(ctx);
      for (const [x, z] of [[-24, 6], [-10, 6.4], [2, 5.6], [15, 6.2], [-20, -6], [-2, -6.4], [18, -6], [30, -5.8]]) npc(x, z, null, 0.15);
      npc(8, -14, 'thug'); npc(-28, 0.5);
      at('car', -24, 3.3, Math.PI / 2 + 0.02); at('car', -4, 3.4, Math.PI / 2); at('car', 28, 3.3, Math.PI / 2 - 0.03);
      at('car', 12, -3.3, -Math.PI / 2 + 0.04); at('car', -32, -3.4, -Math.PI / 2);
      at('dumpster', 7.1, -16, 0.04); at('dumpster', 8.9, -12.4, Math.PI);
      stack('crate', 9, -18.6, 2); at('barrel', 6.8, -18.8); at('explosive', 7.2, -10);
      at('table', 3, 6.6, 0, 0.15); at('chair', 2, 6.4, 1.5, 0.15); at('chair', 4, 6.9, -1.5, 0.15);
      at('cone', 38, 1.5); at('cone', 38.4, -1.2); at('cone', -38.5, -2); at('propane', 33, -6.6, 0, 0.15);
      at('pallet', 36, 6.4, 0.3, 0.15); at('crate', 36, 6.4, 0.4, 0.31);
    },
  },

  // ----------------------------------------------------------------------------------------- house
  house: {
    id: 'house', name: 'The House', icon: '🏠', blurb: 'two floors, eight rooms, after dark', night: true,
    sky: 'night', spawn: { x: -4.5, y: 1.0, z: 10 }, yaw: 0, bounds: { x0: -10, x1: 10, z0: -10, z1: 15 },

    build(b) {
      const brick = b.mat('brick', 0xb98a6e);
      const plaster = b.mat('concrete', 0xe8e2d6, { roughness: 0.85 });
      const tiles = b.mat('concrete', 0x9a948a, { roughness: 0.5 });
      const boards = b.mat('planks', 0xc9a066);
      const trim = b.mat('planks', 0x6b4a2a);
      const glass = b.mat('plain', 0x9fc4d8, { transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.4 });
      const cloth = b.mat('plain', 0x3b4a6a, { roughness: 0.9 });
      const white = b.mat('plain', 0xe6e6e0, { roughness: 0.7 });
      const dark = b.mat('plain', 0x2a2a2e, { roughness: 0.6 });
      const lawn = b.mat('plain', 0x2f4a22, { roughness: 1 });
      const F = 2.7, T = 0.15, D = 1.3, Y1 = F + 0.15;        // a floor's height, a wall's thickness, a doorway, the upstairs floor
      b.ground();
      b.box(0, 0.02, 8.5, 22, 0.04, 7, lawn);                              // front garden
      b.box(0, 0.02, -8, 22, 0.04, 6, lawn);                               // back garden
      b.box(-4.5, 0.03, 8.5, 1.4, 0.06, 7, tiles);                         // the path to the door
      for (const z of [12]) b.wall(-11, z, 11, z, 1.1, 0.25, brick, [[0.3, 1.6]]);    // garden wall, with the gate
      b.wall(-11, -11, -11, 12, 1.1, 0.25, brick); b.wall(11, -11, 11, 12, 1.1, 0.25, brick); b.wall(-11, -11, 11, -11, 1.1, 0.25, brick);
      b.box(0, 0.1, 0, 14.3, 0.2, 10.3, tiles);                            // the ground floor
      b.light(-4.5, 4.4, 14, 0xffd9a0, 36, 18);                            // the street lamp outside the gate
      b.light(-4.5, 2.5, 5.7, 0xffc080, 7, 5);                             // the porch light

      /** A window in a wall at (x, z): sill below, header above, a pane of glass nothing can touch. */
      const win = (x, z, yaw, y0 = 0) => {
        const o = { ry: yaw };
        b.box(x, y0 + 0.5, z, 1.2, 1.0, T, brick, o);
        b.box(x, y0 + 2.45, z, 1.2, 0.5, T, brick, o);
        b.pane(x, y0 + 1.6, z, 1.1, 1.2, 0.02, glass, o);
      };
      const H2 = Math.PI / 2;
      for (const y0 of [0, Y1]) {                                          // the outside walls, both floors
        const up = y0 > 0;
        b.wall(-7, 5, 7, 5, F, T, brick, up ? [[0.3, 1.2], [0.7, 1.2]] : [[0.1786, D], [0.5, 1.2], [0.857, 1.2]], y0);
        b.wall(-7, -5, 7, -5, F, T, brick, up ? [[0.3, 1.2], [0.75, 1.2]] : [[0.1786, D], [0.6, 1.2]], y0);
        b.wall(-7, -5, -7, 5, F, T, brick, [[0.75, 1.2]], y0);
        b.wall(7, -5, 7, 5, F, T, brick, up ? [[0.5, 1.2]] : [[0.3, 1.2], [0.75, 1.2]], y0);
        if (up) { win(-2.8, 5, 0, y0); win(2.8, 5, 0, y0); win(-2.8, -5, 0, y0); win(3.5, -5, 0, y0); win(7, 0, H2, y0); }
        else { win(0, 5, 0); win(5, 5, 0); win(1.4, -5, 0); win(7, -2, H2); win(7, 2.5, H2); }
        win(-7, 2.5, H2, y0);
      }
      // downstairs: a hall with the stairs, a living room and a kitchen off it, and a den across the back
      b.wall(-3.5, -5, -3.5, 5, F, T, plaster, [[0.25, D], [0.75, D]]);
      b.wall(-3.5, 0, 3, 0, F, T, plaster);
      b.wall(3, -5, 3, 5, F, T, plaster, [[0.25, D], [0.75, D]]);
      const dr = (x, z, yaw, locked = false, y0 = 0) => b.door(x, z, yaw, { wallH: F, wallT: T, gap: D, locked, y0 });
      dr(-4.5, 5, 0); dr(-4.5, -5, 0, true); dr(-3.5, 2.5, H2); dr(-3.5, -2.5, H2); dr(3, 2.5, H2); dr(3, -2.5, H2, true);
      b.stairs(-6.4, 3.08, 0, -1, 1.2, 12, F / 12, 0.34, trim);           // (the top step meets the upstairs floor at z = -1)
      b.box(-0.2, 0.35, 4.2, 2.2, 0.7, 0.9, cloth);                        // sofa
      b.box(0, 0.3, 0.55, 1.4, 0.6, 0.4, dark);                            // tv stand
      b.box(-0.5, 0.45, -4.5, 5.5, 0.9, 0.6, white);                       // kitchen counter
      b.box(2.4, 0.9, -4.4, 0.7, 1.8, 0.7, white);                         // fridge
      b.box(5, 0.37, -3.5, 1.4, 0.74, 0.7, trim);                          // desk
      b.box(6.75, 1.0, 1, 0.35, 2.0, 2.0, trim);                           // bookshelf
      b.light(-5.2, 2.55, 2, 0xffe2b0, 12, 7);                             // hall
      b.light(-0.3, 2.55, -2.5, 0xeef2ff, 9, 6);                           // kitchen, a cold tube
      // the upstairs floor, with the stairwell open, and a rail round it
      b.box(0, F + 0.075, 4.1, 14, 0.15, 1.8, boards);
      b.box(0, F + 0.075, -3, 14, 0.15, 4, boards);
      b.box(0.7, F + 0.075, 1.1, 12.6, 0.15, 4.2, boards);
      b.box(-5.6, Y1 + 0.5, 1.1, 0.05, 1.0, 4.2, trim);
      b.box(-6.3, Y1 + 0.5, 3.2, 1.4, 1.0, 0.05, trim);
      // upstairs: a landing, two bedrooms, a bathroom and a third bedroom
      b.wall(-3.5, -5, -3.5, 5, F, T, plaster, [[0.25, D], [0.75, D]], Y1);
      b.wall(-3.5, 0, 3, 0, F, T, plaster, [], Y1);
      b.wall(3, -5, 3, 5, F, T, plaster, [[0.35, D], [0.85, D]], Y1);
      b.wall(3, 2, 7, 2, F, T, plaster, [], Y1);
      dr(-3.5, 2.5, H2, false, Y1); dr(-3.5, -2.5, H2, false, Y1); dr(3, 3.5, H2, false, Y1); dr(3, -1.5, H2, true, Y1);
      b.box(0, Y1 + 0.3, 3.6, 1.6, 0.6, 2.0, cloth); b.box(0, Y1 + 0.3, -3.6, 1.6, 0.6, 2.0, cloth); b.box(5.5, Y1 + 0.3, -3.5, 1.6, 0.6, 2.0, cloth);   // beds
      b.box(2.5, Y1 + 1.0, 1.0, 0.6, 2.0, 1.4, trim); b.box(-2.9, Y1 + 1.0, -1.0, 0.6, 2.0, 1.4, trim);    // wardrobes
      b.box(5.5, Y1 + 0.3, 4.4, 1.7, 0.6, 0.8, white);                     // bath
      b.light(-5.2, Y1 + 2.55, -3, 0xffe2b0, 8, 6);                        // landing
      b.box(0, F * 2 + 0.3, 0, 14.3, 0.15, 10.3, dark);                    // the roof
    },

    populate(ctx) {
      const { at, npc } = crew(ctx);
      const Y1 = 2.85;
      npc(5, -2, 'thug'); npc(0.5, 2.2, 'thug'); npc(5.5, -1, 'thug', Y1);
      npc(-1, -2); npc(-0.8, 1.6, null, Y1); npc(-5.2, -3.5, null, Y1); npc(5, 3.6, null, Y1);
      at('table', -0.5, -2.2, 0); at('chair', -1.4, -1.6, 1.4); at('chair', 0.4, -2.8, -1.6);
      at('toilet', 6.4, 3.3, Math.PI / 2, Y1); at('crate', 4.2, 4.2, 0.3); at('crate', 5.8, 0.6, 0.2); at('propane', 2.4, -3.5);
      at('car', 3, 14.6, 0.05); at('car', -8.5, 14.6, Math.PI + 0.04); at('lamp', -4.5, 13.4, 0);
      at('cone', -6.5, 13); at('dumpster', 9.5, 10.5, 0);
    },
  },

  // ------------------------------------------------------------------------------------- killhouse
  killhouse: {
    id: 'killhouse', name: 'Kill House', icon: '🚪', blurb: 'plywood rooms and a catwalk',
    sky: 'noon', spawn: { x: 0, y: 1.0, z: 17 }, yaw: 0, bounds: { x0: -19, x1: 19, z0: -19, z1: 19 },

    build(b) {
      const con = b.mat('concrete', 0xe6e7e8);
      const ply = b.mat('planks', 0xf2dcb4);
      const wood = b.mat('planks');
      const steel = b.mat('plain', 0x3a4046, { metalness: 0.6, roughness: 0.5 });
      b.ground();
      b.box(0, 0.03, 0, 26, 0.06, 20, b.mat('concrete', 0xb9bcbf));       // the slab the house stands on

      // the compound
      const W = 22, H = 4.5;
      b.box(0, H / 2, -W, W * 2 + 1, H, 1, con);
      b.box(0, H / 2, W, W * 2 + 1, H, 1, con);
      b.box(-W, H / 2, 0, 1, H, W * 2 + 1, con);
      b.box(W, H / 2, 0, 1, H, W * 2 + 1, con);

      // the house: four rooms by three, plywood walls with doorways, no roof
      const T = 0.12, WH = 2.6, D = 1.3;
      const xs = [-12, -6, 0, 6, 12], zs = [-9, -3, 3, 9];
      const gap = (f) => (f === null ? [] : f === 'open' ? [[0.5, 5.6]] : [[f, D]]);
      // outside walls: two ways in from the south, one each from the other sides
      const south = [0.5, null, 0.5, null], north = [null, 0.3, null, null];
      for (let i = 0; i < 4; i++) {
        b.wall(xs[i], 9, xs[i + 1], 9, WH, T, ply, gap(south[i]));
        b.wall(xs[i], -9, xs[i + 1], -9, WH, T, ply, gap(north[i]));
      }
      const west = [null, 0.5, null], east = [0.6, null, null];
      for (let j = 0; j < 3; j++) {
        b.wall(-12, zs[j], -12, zs[j + 1], WH, T, ply, gap(west[j]));
        b.wall(12, zs[j], 12, zs[j + 1], WH, T, ply, gap(east[j]));
      }
      // inside walls
      const across = [[0.5, null, 0.3], ['open', 0.7, 0.5], [0.3, 0.5, null]];      // at x = -6, 0, 6
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) b.wall(xs[i + 1], zs[j], xs[i + 1], zs[j + 1], WH, T, ply, gap(across[i][j]));
      const along = [[0.5, 0.3, null, 0.7], [null, 0.6, 0.4, 0.5]];                 // at z = -3, 3
      for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) b.wall(xs[i], zs[j + 1], xs[i + 1], zs[j + 1], WH, T, ply, gap(along[j][i]));
      for (const x of xs) for (const z of zs) b.box(x, WH / 2, z, 0.16, WH, 0.16, wood);     // posts at the corners
      // doors in the doorways (the big opening in the middle wall stays open); some are locked
      const H2 = Math.PI / 2, o = { wallH: WH, wallT: T, gap: D }, lk = { ...o, locked: true };
      for (const [x, z, yaw, opt] of [
        [-9, 9, 0, o], [3, 9, 0, o], [-4.2, -9, 0, lk], [-12, 0, H2, o], [12, -5.4, H2, lk],            // the ways in
        [-6, -6, H2, o], [-6, 4.8, H2, o], [0, 1.2, H2, lk], [0, 6, H2, o], [6, -7.2, H2, o], [6, 0, H2, lk],
        [-9, -3, 0, o], [-4.2, -3, 0, o], [10.2, -3, 0, o], [-2.4, 3, 0, o], [2.4, 3, 0, lk], [9, 3, 0, o],
      ]) b.door(x, z, yaw, opt);

      // the instructors' catwalk: along the back, and out over the middle of the house
      b.box(0, 3.0, -10.9, 27, 0.14, 2.6, wood);
      for (let x = -13; x <= 13.01; x += 6.5) for (const z of [-12.0, -9.75]) b.box(x, 1.47, z, 0.16, 2.94, 0.16, wood);
      b.box(0, 3.0, -0.6, 1.8, 0.14, 18, wood);
      b.box(0, 1.47, 8.2, 0.16, 2.94, 0.16, wood);
      b.box(0, 3.62, -12.15, 27, 0.07, 0.07, steel);                      // back rail
      for (let x = -13.4; x <= 13.41; x += 2.68) b.box(x, 3.34, -12.15, 0.06, 0.55, 0.06, steel);
      b.stairs(-17.2, -10.9, 1, 0, 2.0, 10, 0.3, 0.37, wood);             // up from the west end

      // cover outside
      b.box(-8, 0.6, 14, 3.2, 1.2, 0.4, con);
      b.box(8, 0.6, 14, 3.2, 1.2, 0.4, con);
      b.box(16.6, 1.34, 4, 2.44, 2.6, 6.1, b.mat('metal', 0x4a5a3a, { metalness: 0.2 }));
    },

    populate(ctx) {
      const { at, npc, stack } = crew(ctx);
      for (const [x, z] of [[-9, 6], [3, 6], [9, 0], [-3, -6]]) npc(x, z, 'thug');
      for (const [x, z] of [[-3, 0], [9, 6], [-9, -6], [3, -6], [-9, 0]]) npc(x, z);
      at('table', -9, -1, 0.2); at('chair', -10, -0.6, 1.4); at('chair', -8.2, -1.6, -1.6);
      at('barrel', 10.8, 4.2); at('explosive', 10.2, -7.6); at('explosive', -4.8, 7.6);
      stack('crate', 1.2, -7.8, 2); at('crate', 2, -7.7, 0.3); at('crate', -10.8, 7.6, 0.2);
      at('table', 3, 0.5, 1.2); at('toilet', 10.9, 0.8, -Math.PI / 2); at('propane', -1.1, 4.2);
      for (let i = 0; i < 3; i++) at('sandbags', -3 + i * 1.95, 12.2, 0);
      for (let i = 0; i < 2; i++) at('sandbags', -2 + i * 1.95, 12.2, 0, 0.55);
      at('pallet', 16.5, -6, 0.2); stack('crate', 16.5, -6, 2, 0.16);
      at('cone', -4, 15.5); at('cone', 4, 15.5); at('dumpster', -19.5, 8, Math.PI / 2);
      ctx.spawnProp('ball', { x: 5, y: 1.0, z: 15 });
    },
  },

  // ----------------------------------------------------------------------------------------- pool
  pool: {
    id: 'pool', name: 'The Pool', icon: '🏊', blurb: 'an outdoor pool: bodies float, blood spreads in the water',
    sky: 'day', spawn: { x: 0, y: 1.0, z: 12 }, yaw: 0, bounds: { x0: -27, x1: 27, z0: -17, z1: 15 },

    build(b) {
      const deck = b.mat('concrete', 0xe2ddd2, { roughness: 0.8 });
      const tile = b.mat('concrete', 0x86cfe2, { roughness: 0.35 });
      const rim = b.mat('concrete', 0xf2efe8, { roughness: 0.6 });
      const brick = b.mat('brick', 0xc29a7e);
      const plaster = b.mat('concrete', 0xe8e2d6, { roughness: 0.85 });
      const steel = b.mat('metal', 0xa8afb6, { metalness: 0.7, roughness: 0.35 });
      const white = b.mat('plain', 0xf4f4f0, { roughness: 0.6 });
      const blue = b.mat('plain', 0x2e7fb8, { roughness: 0.7 });
      const red = b.mat('plain', 0xc8322a, { roughness: 0.7 });
      const wood = b.mat('planks', 0xb38a5a);
      const lawn = b.mat('plain', 0x4f7a34, { roughness: 1 });
      // the pool: 25 x 12 m, 2.6 m deep, the water a hand below the rim; steps up out at the east end
      const X = 12.5, Z = 6, D = 2.6, W = -0.25;
      // the deck round it (there is no ground under a pool), and grass beyond the wall
      b.box(0, -0.2, -15.5, 60, 0.4, 19, deck); b.box(0, -0.2, 15.5, 60, 0.4, 19, deck);
      b.box(-21.25, -0.2, 0, 17.5, 0.4, 12, deck); b.box(21.25, -0.2, 0, 17.5, 0.4, 12, deck);
      b.box(0, -0.3, -45, 120, 0.4, 40, lawn); b.box(0, -0.3, 45, 120, 0.4, 40, lawn);
      b.box(-60, -0.3, 0, 40, 0.4, 50, lawn); b.box(60, -0.3, 0, 40, 0.4, 50, lawn);
      // the basin: floor, walls, a white lip round the top, a lane line painted on the bottom
      b.box(0, -D - 0.2, 0, 2 * X, 0.4, 2 * Z, tile);
      b.box(-X - 0.15, -D / 2, 0, 0.3, D, 2 * Z + 0.6, tile); b.box(X + 0.15, -D / 2, 0, 0.3, D, 2 * Z + 0.6, tile);
      b.box(0, -D / 2, -Z - 0.15, 2 * X, D, 0.3, tile); b.box(0, -D / 2, Z + 0.15, 2 * X, D, 0.3, tile);
      for (const z of [-Z - 0.3, Z + 0.3]) b.box(0, 0.03, z, 2 * X + 1.2, 0.06, 0.6, rim);
      for (const x of [-X - 0.3, X + 0.3]) b.box(x, 0.03, 0, 0.6, 0.06, 2 * Z, rim);
      for (const z of [-3, 0, 3]) b.box(0, -D + 0.005, z, 2 * X - 3, 0.01, 0.25, blue, { solid: false });
      b.stairs(X - 8 * 0.35, 0, 1, 0, 2.6, 8, D / 8, 0.35, tile, -D);
      b.water(-X, X, -Z, Z, W, -D);
      // a diving board over the deep (west) end
      b.box(-X - 0.9, 0.35, 0, 0.7, 0.7, 0.7, steel);
      b.box(-X + 0.6, 0.78, 0, 3.0, 0.08, 0.55, white);
      // a wall all round, open to the street on the south side
      b.wall(-30, -26, 30, -26, 2.6, 0.3, brick); b.wall(-30, -26, -30, 26, 2.6, 0.3, brick); b.wall(30, -26, 30, 26, 2.6, 0.3, brick);
      b.wall(-30, 26, 30, 26, 2.6, 0.3, brick, [[0.5, 6]]);
      // changing rooms along the north wall: two doors, benches inside, a flat roof
      b.wall(-12, -18, 12, -18, 3, 0.25, plaster, [[0.25, 1.3], [0.75, 1.3]]);
      b.wall(-12, -26, -12, -18, 3, 0.25, plaster); b.wall(12, -26, 12, -18, 3, 0.25, plaster);
      b.wall(0, -26, 0, -18, 3, 0.2, plaster);
      b.box(0, 3.1, -22, 24.6, 0.2, 8.4, plaster);
      b.door(-6, -18, 0, { wallH: 3, wallT: 0.25 }); b.door(6, -18, 0, { wallH: 3, wallT: 0.25 });
      for (const x of [-9, -3, 3, 9]) b.box(x, 0.23, -25, 2.4, 0.45, 0.6, wood);
      b.light(-6, 2.8, -22, 0xfff2dd, 25, 9); b.light(6, 2.8, -22, 0xfff2dd, 25, 9);
      // bleachers on the south side
      for (let i = 0; i < 4; i++) b.box(0, 0.225 + i * 0.45, 17.6 + i * 1.1, 20, 0.45 + i * 0.9, 1.1, i % 2 ? white : blue);
      // a lifeguard's chair, sun loungers and umbrellas
      for (const x of [-8.5, -7.5]) for (const z of [7.2, 8.2]) b.box(x, 0.8, z, 0.08, 1.6, 0.08, white);
      b.box(-8, 1.65, 7.7, 1.1, 0.1, 1.1, white); b.box(-8, 2.1, 8.2, 1.1, 0.8, 0.08, red);
      for (let i = 0; i < 6; i++) {
        const x = -15 + i * 6;
        b.box(x, 0.18, -9.4, 0.65, 0.36, 1.9, i % 2 ? white : blue);
        b.cyl(x + 2.6, 1.1, -9.4, 0.03, 2.2, steel);
        b.box(x + 2.6, 2.2, -9.4, 2.2, 0.06, 2.2, i % 2 ? red : white, { solid: false });
      }
    },

    populate(ctx) {
      const { at, npc, stack } = crew(ctx);
      for (const [x, z] of [[-16, -10], [-8, 9], [5, 9.5], [16, -12], [20, 4], [-20, 3], [9, -11]]) npc(x, z);
      npc(-22, -12, 'thug'); npc(22, 12, 'thug');
      for (const [x, z] of [[-5, -2], [2, 3.5], [8, -3]]) ctx.spawnProp('ball', { x, y: 0.3, z });
      ctx.spawnProp('crate', { x: -9, y: 0.3, z: 1 }, 0.4);
      stack('crate', 24, -20, 2); at('crate', 25.2, -20, 0.3); at('explosive', 26, -15); at('barrel', 26.6, -16.2);
      at('table', -20, 10, 0.2); at('chair', -21, 10.4, 1.4); at('chair', -19, 9.6, -1.6);
      at('cone', -3, 24); at('cone', 3, 24);
    },
  },

  // --------------------------------------------------------------------------------------- office
  office: {
    id: 'office', name: 'The Office', icon: '🏢', blurb: 'an open-plan office floor: cubicles, glass meeting rooms, a server room',
    sky: 'overcast', spawn: { x: 0, y: 1.0, z: 17 }, yaw: 0, bounds: { x0: -17, x1: 17, z0: -11, z1: 15 },

    build(b) {
      const con = b.mat('concrete', 0x9fa1a3);
      const plaster = b.mat('concrete', 0xe9e7e2, { roughness: 0.85 });
      const carpet = b.mat('plain', 0x4a535e, { roughness: 1 });
      const tiles = b.mat('concrete', 0xc9c6bf, { roughness: 0.4 });
      const ceiling = b.mat('plain', 0xdddbd5, { roughness: 0.95 });
      const desk = b.mat('planks', 0xd9c6a2);
      const felt = b.mat('plain', 0x66788a, { roughness: 1 });
      const black = b.mat('plain', 0x1c1d20, { roughness: 0.35, metalness: 0.3 });
      const screen = b.mat('plain', 0x0d1a26, { roughness: 0.15, emissive: 0x2a5578, emissiveIntensity: 0.5 });
      const white = b.mat('plain', 0xeeeeea, { roughness: 0.6 });
      const sofa = b.mat('plain', 0x8a3a32, { roughness: 0.9 });
      const leaf = b.mat('plain', 0x3f6b35, { roughness: 0.9 });
      const glass = b.mat('plain', 0x9fc4d8, { transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.4 });
      const steel = b.mat('metal', 0xa8afb6, { metalness: 0.7, roughness: 0.35 });
      const road = b.mat('asphalt', 0x55575a);
      const F = 3.2, T = 0.2, D = 1.3, H2 = Math.PI / 2;
      const dr = (x, z, yaw, locked = false) => b.door(x, z, yaw, { wallH: F, wallT: T, gap: D, locked });
      b.ground();
      b.box(0, 0.01, 0, 36, 0.02, 24, carpet);                              // the floor: carpet, tiles in the lobby
      b.box(0, 0.012, 8, 20, 0.02, 8, tiles);
      b.box(0, F + 0.1, 0, 36.4, 0.2, 24.4, ceiling);                       // the ceiling, and the roof over it
      b.box(0, F + 0.4, 0, 37, 0.4, 25, con);
      b.box(0, 0.01, 24, 80, 0.02, 9, road, { solid: false });              // the street out front
      b.box(0, 0.06, 18.2, 80, 0.12, 2.4, con);                             // pavement

      // outside walls: glass all along the north and east sides, the way in on the south, the west side blank
      const ribbon = (a, e, c, alongX) => {
        const n = Math.round((e - a) / 3), w = (e - a) / n, o = alongX ? {} : { ry: H2 };
        const put = (s, y, ww, h, m, pane) => {
          const x = alongX ? s : c, z = alongX ? c : s;
          if (pane) b.pane(x, y, z, ww, h, 0.02, m, o); else b.box(x, y, z, ww, h, T, m, o);
        };
        put((a + e) / 2, 0.45, e - a, 0.9, con); put((a + e) / 2, 2.85, e - a, 0.7, con);   // sill, and the band above
        for (let i = 0; i <= n; i++) put(a + i * w, 1.7, 0.16, 1.6, con);                  // mullions
        for (let i = 0; i < n; i++) put(a + (i + 0.5) * w, 1.7, w - 0.16, 1.6, glass, true);
      };
      ribbon(-18, 18, -12, true);
      ribbon(-12, 12, 18, false);
      b.wall(-18, -12, -18, 12, F, T, con);
      b.wall(-18, 12, 18, 12, F, T, con, [[0.5, 2.6], [0.25, 3], [0.75, 3]]);
      for (const x of [-9, 9]) { b.box(x, 0.45, 12, 3, 0.9, T, con); b.box(x, 2.85, 12, 3, 0.7, T, con); b.pane(x, 1.7, 12, 2.9, 1.6, 0.02, glass); }
      dr(-0.65, 12, 0); dr(0.65, 12, 0);

      // the server room (south-west): racks in rows, cold light, a locked door
      b.wall(-18, 4, -10, 4, F, T, plaster);
      b.wall(-10, 4, -10, 12, F, T, plaster, [[0.5, D]]);
      dr(-10, 8, H2, true);
      for (const z of [6, 9]) for (let i = 0; i < 4; i++) {
        b.box(-16.2 + i * 1.3, 1.0, z, 0.62, 2.0, 1.05, black);
        for (let k = 0; k < 6; k++) b.box(-16.2 + i * 1.3, 0.3 + k * 0.3, z + 0.53, 0.5, 0.04, 0.01, screen, { solid: false });   // the lights on their fronts
      }
      b.light(-14, 2.9, 7.5, 0x9fc8ff, 10, 8);

      // the break room (south-east): a counter, a fridge, a table
      b.wall(10, 4, 18, 4, F, T, plaster);
      b.wall(10, 4, 10, 12, F, T, plaster, [[0.5, D]]);
      dr(10, 8, H2);
      b.box(17.4, 0.45, 8, 0.8, 0.9, 6, white); b.box(17.4, 0.92, 8, 0.84, 0.04, 6.04, black);
      b.box(17.3, 0.95, 4.8, 0.9, 1.9, 0.8, steel);
      b.light(14, 2.9, 8, 0xfff1dc, 10, 8);

      // the lobby: reception desk, sofas, plants
      b.box(0, 0.55, 7.6, 4.4, 1.1, 0.8, desk); b.box(0, 1.12, 7.6, 4.5, 0.05, 0.9, black);
      b.box(0, 0.5, 5.6, 6, 1.0, 0.25, desk);
      for (const x of [-7, 7]) { b.box(x, 0.3, 10.6, 2.4, 0.6, 0.9, sofa); b.box(x, 0.65, 11.1, 2.4, 0.7, 0.25, sofa); }
      for (const [x, z] of [[-3.6, 11.3], [3.6, 11.3], [-9.4, 4.7], [9.4, 4.7], [-1, -11.3], [5, -11.3]]) { b.cyl(x, 0.25, z, 0.25, 0.5, black); b.box(x, 0.85, z, 0.6, 0.8, 0.6, leaf, { solid: false }); }
      b.light(0, 2.9, 9, 0xfff1dc, 14, 10);

      // meeting rooms along the north wall: glass fronts, a table each
      for (let i = 0; i < 3; i++) {
        const x0 = -18 + i * 5.4, x1 = x0 + 5.4, cx = (x0 + x1) / 2;
        b.wall(x1, -12, x1, -6, F, T, plaster);
        const dx = x1 - 1.0;                                                 // the door, at the right of the front
        b.pane((x0 + dx - D / 2) / 2, 1.3, -6, dx - D / 2 - x0 - 0.1, 2.6, 0.04, glass);
        b.box((x0 + dx - D / 2) / 2, 2.9, -6, dx - D / 2 - x0, 0.6, 0.12, steel);
        b.box(x1 - 0.19, F / 2, -6, 0.38, F, 0.12, steel);
        dr(dx, -6, 0);
        b.box(cx, 0.72, -9, 3.2, 0.06, 1.3, desk); b.box(cx, 0.36, -9, 0.3, 0.7, 0.3, steel);
        b.box(x0 + 0.12, 1.6, -9, 0.05, 0.9, 1.6, screen, { solid: false });
      }
      // the manager's office (north-east)
      b.wall(8, -12, 8, -5, F, T, plaster);
      b.wall(8, -5, 18, -5, F, T, plaster, [[0.2, D]]);
      dr(10, -5, 0);
      b.box(14, 0.38, -9.5, 2.4, 0.76, 1.1, desk); b.box(14, 0.95, -9.9, 0.6, 0.38, 0.05, screen);
      b.box(17.6, 1.0, -8, 0.5, 2.0, 2.4, desk);
      // printers and a water cooler between them
      b.box(2, 0.55, -11.2, 1.2, 1.1, 0.8, white); b.box(4, 0.55, -11.2, 1.0, 1.1, 0.7, white);
      b.cyl(6.6, 0.55, -11.3, 0.18, 1.1, white); b.cyl(6.6, 1.3, -11.3, 0.15, 0.4, b.mat('plain', 0x7ab8e0, { transparent: true, opacity: 0.6 }));

      // the open plan: pods of four desks, back to back, with felt partitions between
      for (const cz of [-2.6, 1.4]) for (const cx of [-14, -8.5, -3, 2.5, 8, 13.5]) {
        b.box(cx, 0.65, cz, 3.4, 1.3, 0.06, felt);                          // the spine
        b.box(cx, 0.65, cz, 0.06, 1.3, 2.0, felt);                          // and across it
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const x = cx + sx * 0.86, z = cz + sz * 0.52;
          b.box(x, 0.73, z, 1.6, 0.04, 0.9, desk);
          b.box(x + sx * 0.75, 0.36, z, 0.04, 0.72, 0.85, steel, { solid: false });
          b.box(x, 1.0, cz + sz * 0.16, 0.56, 0.34, 0.03, screen);
          b.box(x, 0.8, cz + sz * 0.14, 0.12, 0.14, 0.12, black, { solid: false });
        }
      }
      for (const z of [-4, 2]) for (const x of [-11, 0, 11]) b.light(x, 2.95, z, 0xf4f6ff, 12, 11);
      for (const z of [-4, 2]) for (const x of [-15, -5, 5, 15]) b.box(x, F - 0.01, z, 1.2, 0.02, 0.6, white, { solid: false });   // ceiling panels
    },

    populate(ctx) {
      const { at, npc } = crew(ctx);
      for (const [x, z] of [[-11.5, -0.6], [-5.5, -0.5], [0, 3.2], [5.5, -0.4], [11, 3.3], [-13, -4.6], [-1.5, 9.5], [14, 7], [-4.5, -10.8]]) npc(x, z);
      npc(15.5, -7.5, 'thug'); npc(-0.5, -9, 'thug'); npc(3, 7.5, 'thug');
      for (const cz of [-2.6, 1.4]) for (const cx of [-14, -8.5, -3, 2.5, 8, 13.5]) {
        if (Math.random() < 0.6) at('chair', cx + (Math.random() < 0.5 ? -0.86 : 0.86), cz + 1.15, Math.PI);
        if (Math.random() < 0.6) at('chair', cx + (Math.random() < 0.5 ? -0.86 : 0.86), cz - 1.15, 0);
      }
      at('table', 14.5, 9, 0); at('chair', 13.6, 9.4, 1.4); at('chair', 15.4, 8.6, -1.6);
      at('chair', 14, -8.6, Math.PI); at('crate', -12, 5, 0.2); at('crate', -12.6, 5.2, 0.6); at('propane', 16.9, 6);
      at('car', -12, 21.5, Math.PI / 2); at('car', 9, 26, -Math.PI / 2); at('cone', 3, 19.8); at('cone', -3, 19.8);
    },
  },
  // ------------------------------------------------------------------------------------ nightclub
  nattklubb: {
    id: 'nattklubb', name: 'Tyrs Nattklubb', icon: '🪩', blurb: 'a nightclub: dance floor, bar, DJ, VIP balcony, the Wall of Fame',
    sky: 'night', spawn: { x: 0, y: 1.0, z: 15 }, yaw: 0, bounds: { x0: -15, x1: 15, z0: -11, z1: 13 },     // (a night sky, but not night mode: the club has its own lights, no flashlight needed)

    build(b) {
      const H = 5, T = 0.3, H2 = Math.PI / 2, D = 1.3, V = 2.4;            // V: the VIP balcony's floor
      const wall = b.mat('concrete', 0x23212b, { roughness: 0.9 });
      const floor = b.mat('plain', 0x111115, { roughness: 0.3, metalness: 0.2 });
      const black = b.mat('plain', 0x131317, { roughness: 0.5 });
      const ceil = b.mat('plain', 0x0a0a0d, { roughness: 1 });
      const velvet = b.mat('plain', 0x6a0e28, { roughness: 1 });
      const wood = b.mat('planks', 0x4a2c18);
      const top = b.mat('plain', 0x18181d, { roughness: 0.12, metalness: 0.6 });
      const brass = b.mat('metal', 0xc9a25a, { metalness: 0.9, roughness: 0.3 });
      const chrome = b.mat('plain', 0xe0e0e0, { metalness: 1, roughness: 0.04 });
      const tilew = b.mat('concrete', 0xe6e6e2, { roughness: 0.6 });
      const mirror = b.mat('plain', 0x9aa8b2, { metalness: 1, roughness: 0.05 });
      const glass = b.mat('plain', 0xa8c8ff, { transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.4 });
      const con = b.mat('concrete', 0x8c8e90);
      const road = b.mat('asphalt', 0x4a4c50);
      const neon = (c, k = 2.5) => b.mat('plain', 0x111111, { emissive: c, emissiveIntensity: k, roughness: 0.4 });
      const PINK = 0xff2bd6, CYAN = 0x2be8ff, VIOLET = 0x8a4dff, GOLD = 0xffb030;
      const bottles = [0x2f7a3a, 0x8a5a1a, 0xa8c8d8, 0x6a1a2a].map((c) => b.mat('plain', c, { emissive: c, emissiveIntensity: 0.6, roughness: 0.1, transparent: true, opacity: 0.85 }));
      const dr = (x, z, yaw, locked = false) => b.door(x, z, yaw, { wallH: H, wallT: T, gap: D, locked });

      b.ground();
      b.box(0, 0.01, -1, 32, 0.02, 22, floor);
      b.box(0, H + 0.1, -1, 32.6, 0.2, 22.6, ceil);                         // the ceiling, and the roof over it
      b.box(0, H + 0.4, -1, 33, 0.4, 23, con);
      b.box(0, 0.01, 18, 70, 0.02, 8, road, { solid: false });             // the street out front, and its pavement
      b.box(0, 0.06, 12.1, 70, 0.12, 3.8, con);

      // the shell: one way in, from the street, through a short hall past the cloakroom
      b.wall(-16, -12, 16, -12, H, T, wall);
      b.wall(-16, -12, -16, 10, H, T, wall);
      b.wall(16, -12, 16, 10, H, T, wall);
      b.wall(-16, 10, 16, 10, H, T, wall, [[0.5, 2.6]]);
      dr(-0.65, 10, 0); dr(0.65, 10, 0);
      b.box(0, 3.0, 10.9, 4.2, 0.12, 1.5, black);                           // the canopy over the door
      for (let x = 3.2; x <= 9.2; x += 1.5) b.cyl(x, 0.6, 11.2, 0.05, 0.96, brass);   // the queue, behind a rope
      b.box(6.2, 0.95, 11.2, 6, 0.05, 0.05, velvet, { solid: false });
      b.wall(-2.6, 6, -2.6, 10, H, 0.2, wall);
      b.wall(2.6, 6, 2.6, 10, H, 0.2, wall);
      b.box(2.0, 0.55, 8.2, 0.7, 1.1, 2.4, wood); b.box(2.0, 1.12, 8.2, 0.8, 0.05, 2.5, top);
      b.light(0, 3.4, 8, 0xff5ab0, 7, 7);
      b.light(0, 4.4, 13, 0xffc070, 10, 12);                                // the street lamp

      // the toilets (south-west): three stalls, a row of sinks under a mirror
      b.wall(-16, 5, -9, 5, H, 0.2, tilew, [[5 / 7, D]]);
      dr(-11, 5, 0);
      b.wall(-9, 5, -9, 10, H, 0.2, tilew);
      for (const z of [6.75, 8.35]) b.box(-15.1, 1.0, z, 1.8, 2.0, 0.06, black);
      b.box(-9.45, 0.85, 7.6, 0.55, 0.12, 3.0, tilew); b.box(-9.13, 1.75, 7.6, 0.03, 1.0, 3.0, mirror, { solid: false });
      b.light(-12.5, 3.2, 7.5, 0xdfe8ff, 6, 8);

      // the manager's office (south-east): locked
      b.wall(9, 5, 16, 5, H, 0.2, wall, [[2 / 7, D]]);
      dr(11, 5, 0, true);
      b.wall(9, 5, 9, 10, H, 0.2, wall);
      b.box(13.5, 0.38, 8.6, 2.0, 0.76, 0.9, wood); b.box(15.4, 0.6, 6.2, 0.8, 1.2, 0.8, black);   // a desk, the safe
      b.light(12.5, 3.2, 7.5, 0xffe2b0, 5, 7);

      // the bar (west): the counter, the back bar with its shelves of bottles in front of a mirror, stools
      b.box(-11.8, 0.55, -2, 0.7, 1.1, 9, wood); b.box(-11.8, 1.12, -2, 0.9, 0.05, 9.2, top);
      b.box(-11.44, 0.08, -2, 0.02, 0.06, 9, neon(GOLD, 1.5), { solid: false });
      b.box(-15.45, 0.5, -2, 0.8, 1.0, 10, wood); b.box(-15.45, 1.02, -2, 0.85, 0.04, 10, top);
      b.box(-15.83, 2.1, -2, 0.02, 1.6, 10, mirror, { solid: false });
      for (const y of [1.5, 2.05, 2.6]) {
        b.box(-15.6, y, -2, 0.4, 0.03, 10, chrome, { solid: false });
        for (let z = -6.7; z <= 2.7; z += 0.4) b.cyl(-15.6, y + 0.15, z + b.rnd(-0.08, 0.08), 0.035, 0.26 + b.rnd(-0.04, 0.06), bottles[(b.rnd() * 4) | 0], { solid: false, sides: 8 });
      }
      for (let z = -6; z <= 2; z += 1.15) { b.cyl(-10.9, 0.38, z, 0.05, 0.76, brass); b.cyl(-10.9, 0.78, z, 0.2, 0.06, velvet); }
      b.light(-13.6, 4.2, -2, 0xffa850, 20, 11);

      // the DJ (north): a stage with a lit edge and steps up, the booth, speaker stacks, and the club's name in neon
      b.box(0, 0.4, -10.25, 12, 0.8, 3.5, black);
      b.box(0, 0.79, -8.49, 12, 0.03, 0.06, neon(VIOLET, 2), { solid: false });
      b.stairs(-4.5, -7.5, 0, -1, 1.6, 3, 0.8 / 3, 0.33, black);
      b.box(0, 1.35, -9.6, 3.4, 1.1, 0.8, black); b.box(0, 1.92, -9.6, 3.5, 0.04, 0.9, top);
      for (const x of [-1, 1]) b.cyl(x, 1.96, -9.6, 0.17, 0.03, chrome, { solid: false });
      b.box(0, 1.96, -9.6, 0.5, 0.04, 0.35, neon(CYAN, 1.2), { solid: false });
      b.box(0, 1.35, -9.19, 3.3, 0.05, 0.02, neon(PINK, 2.2), { solid: false });
      for (const x of [-7.6, 7.6]) {
        b.box(x, 1.5, -10.6, 1.4, 3.0, 1.2, black);
        for (const y of [0.7, 1.6, 2.5]) b.cyl(x, y, -9.99, 0.38, 0.04, chrome, { rx: H2, solid: false });
      }
      b.sign(0, 3.6, -11.83, 9, 1.6, neonName, { glow: 2.2 });
      b.sign(0, 3.9, 10.17, 7.5, 1.35, neonName, { glow: 2.4 });                    // and outside, over the door

      // the dance floor: lit tiles in four colours, a mirror ball over it on a truss
      const tiles = [PINK, CYAN, VIOLET, GOLD].map((c) => b.mat('plain', 0x0c0c10, { emissive: c, emissiveIntensity: 0.4, roughness: 0.15 }));
      for (let i = 0; i < 12; i++) for (let j = 0; j < 9; j++) b.box(-5.5 + i, 0.025, -7 + j, 0.94, 0.03, 0.94, tiles[(i + 2 * j + ((i * j) % 3)) % 4], { solid: false });
      b.ball(0, 4.1, -3, 0.45, chrome);
      b.box(0, 4.78, -3, 0.03, 0.45, 0.03, chrome, { solid: false });
      b.box(0, 4.6, -3, 12, 0.12, 0.12, chrome, { solid: false }); b.box(0, 4.6, -3, 0.12, 0.12, 9, chrome, { solid: false });
      for (const z of [-6.5, 1.5]) { b.cyl(-8.5, H / 2, z, 0.3, H, black); b.cyl(-8.5, 2.6, z, 0.32, 0.06, neon(PINK, 2), { solid: false }); }
      const lamps = [b.light(-3.5, 4.3, -5, PINK, 26, 12), b.light(3.5, 4.3, -5, CYAN, 26, 12), b.light(0, 4.3, 0.5, VIOLET, 26, 12), b.light(0, 3.8, -10.6, 0x4060ff, 12, 8)];
      for (const l of lamps) l.base = l.light.intensity;

      // the VIP balcony (east), up its own stairs, behind glass: sofas, a lounge under it, and the Wall of Fame
      b.box(13, V - 0.125, -6, 6, 0.25, 12, floor);
      for (const z of [-11.5, -6, -0.6]) b.box(10.3, (V - 0.25) / 2, z, 0.35, V - 0.25, 0.35, black);
      b.stairs(10.8, 3.4, 0, -1, 1.4, 8, V / 8, 3.4 / 8, black);
      for (let i = 0; i < 6; i++) b.pane(10.1, V + 0.5, -11 + 2 * i, 1.9, 1.0, 0.03, glass, { ry: H2 });
      for (let i = 0; i <= 6; i++) b.box(10.1, V + 0.55, -12 + 2 * i, 0.06, 1.1, 0.06, brass);
      b.box(10.1, V + 1.08, -6, 0.07, 0.05, 12, brass, { solid: false });
      for (const x of [12.7, 14.9]) b.pane(x, V + 0.5, 0.05, 2.1, 1.0, 0.03, glass);
      for (const x of [11.6, 13.8, 15.9]) b.box(x, V + 0.55, 0.05, 0.06, 1.1, 0.06, brass);
      b.box(13.75, V + 1.08, 0.05, 4.3, 0.05, 0.07, brass, { solid: false });
      for (const [y, z] of [[0, -9], [0, -3], [V, -10], [V, -2.2]]) {                // sofas along the east wall, down and up
        b.box(15.45, y + 0.25, z, 0.8, 0.5, 2.6, velvet); b.box(15.8, y + 0.7, z, 0.2, 0.9, 2.6, velvet);
      }
      b.light(13, 1.9, -6, 0xff4060, 5, 6);
      b.light(12.5, 4.5, -6, 0xff3a70, 10, 9);
      b.box(15.86, V + 1.55, -6.1, 0.04, 2.2, 4.0, brass, { solid: false });          // the Wall of Fame: gold frame...
      b.sign(15.83, V + 1.55, -6.1, 3.8, 2.0, wallOfFame, { ry: -H2, glow: 0.3 });   // ...and what is on it (kept clear: nobody stands in front of it)

      // the lights keep time with the music: each beat the next colour of tiles flares, and the lights over the floor pulse
      b.tick = () => {
        const bt = clubBeat(), n = Math.floor(bt), flash = Math.exp(-(bt - n) * 4);
        b.ctx.beat = bt;                                                    // (the dancers: ragdoll.js)
        tiles.forEach((m, i) => { m.emissiveIntensity = 0.3 + (i === ((n % 4) + 4) % 4 ? 1.5 * flash : 0.1); });
        lamps.forEach((l, i) => { if (!l.off) l.light.intensity = l.base * (0.45 + ((n + i) % 3 === 0 ? 1.1 * flash : 0.25)); });
      };
    },

    populate(ctx) {
      const { at, npc } = crew(ctx);
      const put = (x, z, kind, dance, base = 0, yaw = Math.random() * TAU) => { const r = npc(x, z, kind, base, yaw); if (r) r.spot = { x, z, dance }; return r; };
      // (phones keep the last 18 made: the dance floor goes last, so it is never the one left empty)
      put(-1.6, 7.4, 'thug', false, 0, Math.PI); put(9.6, 2.6, 'thug', false, 0, Math.PI);   // the door, and the VIP stairs
      put(-13.5, -2, null, false, 0, -Math.PI / 2);                                        // behind the bar
      for (const z of [-5.4, -2.6, 0.6]) put(-10.4, z, null, false, 0, Math.PI / 2);         // at it
      put(12.2, -9.6, 'thug', false, 2.4); put(12.0, -10.9, null, true, 2.4); put(12.2, -3.2, null, false, 2.4);
      put(14.2, -6, null, false);                                                          // in the lounge under the balcony
      put(-12.4, 7.6, null, false);                                                        // in the toilets
      put(0, -10.3, null, true, 0.8, Math.PI);                                             // the DJ
      for (let i = 0; i < 11; i++) put(-5 + Math.random() * 10, -6.5 + Math.random() * 7.5, null, true, 0, (Math.random() - 0.5) * 1.2);
      at('table', 13.6, -9, 0); at('table', 13.6, -3, 0); at('table', 13.4, -10, 0, 2.4); at('table', 13.4, -2.2, 0, 2.4);
      for (const z of [5.9, 7.55, 9.2]) at('toilet', -15.55, z, Math.PI / 2);
      at('barrel', 14.6, 9.2); at('barrel', 15.3, 9.2); at('crate', 10, 9.3); at('crate', 10.1, 9.3, 0.3, 0.62);
      at('car', -9, 16.6, Math.PI / 2); at('car', 10, 20.2, -Math.PI / 2); at('cone', -3.4, 14.2); at('cone', 3.4, 14.2);
    },
  },
  // ---------------------------------------------------------------------------------- simons
  simons: {
    id: 'simons', name: 'Simons McDonalds', icon: '🍔', blurb: 'a burger place: the counter, the kitchen, booths, a ball pit, the car park',
    sky: 'day', spawn: { x: 0, y: 1.0, z: 17 }, yaw: 0, bounds: { x0: -14, x1: 14, z0: -8, z1: 20 },

    build(b) {
      const H = 4, T = 0.25, D = 1.3, H2 = Math.PI / 2;
      const red = b.mat('plain', 0xc8102e, { roughness: 0.5 });
      const yellow = b.mat('plain', 0xffc72c, { roughness: 0.45 });
      const white = b.mat('concrete', 0xf1efe9, { roughness: 0.7 });
      const tileA = b.mat('plain', 0xeee9df, { roughness: 0.3 }), tileB = b.mat('plain', 0xb3222b, { roughness: 0.3 });
      const kfloor = b.mat('concrete', 0x8e9296, { roughness: 0.5 });
      const steel = b.mat('metal', 0xb8bec4, { metalness: 0.8, roughness: 0.3 });
      const black = b.mat('plain', 0x1d1d20, { roughness: 0.4 });
      const glass = b.mat('plain', 0xbfdcec, { transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.3 });
      const screen = b.mat('plain', 0x101418, { emissive: 0x3a6a9a, emissiveIntensity: 0.6 });
      const hot = b.mat('plain', 0x2a1408, { emissive: 0xff7a1a, emissiveIntensity: 0.8, roughness: 0.2 });
      const oil = b.mat('plain', 0x8a5a10, { emissive: 0xffa020, emissiveIntensity: 0.35, roughness: 0.1 });
      const road = b.mat('asphalt', 0x55575a), con = b.mat('concrete', 0x9a9c9e);
      const pit = [0xe8322e, 0x2e7de8, 0xf2c41a, 0x38b24a].map((c) => b.mat('plain', c, { roughness: 0.35 }));
      const dr = (x, z, yaw, locked = false) => b.door(x, z, yaw, { wallH: H, wallT: T, gap: D, locked });

      b.ground();
      b.box(0, 0.006, 0, 20, 0.012, 14, kfloor);
      for (let i = 0; i < 20; i++) for (let j = 0; j < 8; j++) b.box(-9.5 + i, 0.016, -0.5 + j, 1, 0.01, 1, (i + j) % 2 ? tileA : tileB, { solid: false });
      b.box(0, H + 0.1, 0, 20.4, 0.2, 14.4, white);
      b.box(0, H + 0.45, 0, 21, 0.5, 15, red);

      // outside: the car park, the pole sign, the drive-through
      b.box(0, 0.01, 14.5, 44, 0.02, 15, road, { solid: false });
      b.box(0, 0.06, 7.85, 22, 0.12, 1.4, con);
      for (let x = -12; x <= 8; x += 3) b.stripe(x, 15, 4.5);
      b.cyl(9.5, 3.6, 13, 0.18, 7.2, steel);
      b.box(9.5, 7.8, 13, 3.4, 1.7, 0.3, red);
      const pole = textSign({ text: 'SIMONS', sub: 'ÖPPET DYGNET RUNT', fg: '#ffc72c', bg: '#c8102e' });
      b.sign(9.5, 7.8, 13.16, 3.2, 1.5, pole, { glow: 0.5 });
      b.sign(9.5, 7.8, 12.84, 3.2, 1.5, pole, { ry: Math.PI, glow: 0.5 });
      for (let z = 10; z >= -6; z -= 4) b.stripe(12.5, z, 2, 0, 0.3);
      b.box(13.2, 1.1, 2.5, 0.15, 2.2, 1.2, black);
      b.sign(13.11, 1.35, 2.5, 1.1, 1.4, menuBoard, { ry: -H2, glow: 0.6 });

      // the front: glass either side of the doors, the yellow band and the name over it
      const front = (x0, x1, z) => {
        const n = Math.round((x1 - x0) / 2.5), w = (x1 - x0) / n;
        b.box((x0 + x1) / 2, 0.4, z, x1 - x0, 0.8, T, white);
        b.box((x0 + x1) / 2, H - 0.6, z, x1 - x0, 1.2, T, yellow);
        for (let i = 0; i <= n; i++) b.box(x0 + i * w, H / 2, z, 0.12, H, T, black);
        for (let i = 0; i < n; i++) b.pane(x0 + (i + 0.5) * w, 1.8, z, w - 0.12, 2.0, 0.02, glass);
      };
      front(-10, -1.3, 7); front(1.3, 10, 7);
      dr(-0.65, 7, 0); dr(0.65, 7, 0);
      b.sign(0, H + 1.25, 7.56, 9, 1.3, textSign({ text: 'SIMONS MCDONALDS', fg: '#ffc72c', bg: '#c8102e', border: '#ffc72c' }), { glow: 0.5 });
      b.wall(-10, -7, 10, -7, H, T, white);
      b.wall(-10, -7, -10, 7, H, T, white, [[2 / 14, D]]);
      dr(-10, -5, H2);                                                         // the back door, out of the kitchen
      b.wall(10, -7, 10, 7, H, T, white, [[5 / 14, 1.4]]);
      b.box(10, 0.5, -2, T, 1.0, 1.4, white); b.box(10, (H + 2.2) / 2, -2, T, H - 2.2, 1.4, white);   // the drive-through window
      b.box(10.3, 1.0, -2, 0.5, 0.06, 1.4, steel);

      // the counter with its tills, the menu over it; behind it the drinks machine and the fries
      b.box(-1, 0.55, -0.6, 10, 1.1, 0.7, red); b.box(-1, 1.12, -0.6, 10.2, 0.05, 0.85, steel);
      b.box(-1, 0.1, -0.24, 10, 0.2, 0.02, yellow, { solid: false });
      for (const x of [-4.5, -2, 0.5, 3]) { b.box(x, 1.28, -0.75, 0.42, 0.26, 0.36, black); b.box(x, 1.44, -0.57, 0.36, 0.22, 0.02, screen, { solid: false }); }
      b.wall(-10, -3, 10, -3, H, T, white, [[0.75, D]]);
      dr(5, -3, 0);
      b.sign(-1, 2.95, -2.86, 9, 1.5, menuBoard, { glow: 0.8 });
      b.box(-6.5, 1.0, -2.55, 1.2, 2.0, 0.6, steel); b.box(-6.5, 1.3, -2.24, 1.0, 0.5, 0.02, screen, { solid: false });
      b.box(2.5, 0.5, -2.55, 2.0, 1.0, 0.6, steel); b.box(2.5, 1.02, -2.55, 1.8, 0.04, 0.5, oil, { solid: false });

      // the kitchen: grill, fryers, prep tables, and the walk-in freezer (locked)
      b.box(-6.5, 0.45, -6.3, 3, 0.9, 1.1, black); b.box(-6.5, 0.92, -6.3, 2.9, 0.04, 1.0, hot, { solid: false });
      for (const x of [-3.5, -2.3]) { b.box(x, 0.45, -6.4, 1.0, 0.9, 0.9, steel); b.box(x, 0.92, -6.4, 0.8, 0.04, 0.7, oil, { solid: false }); }
      for (const x of [-1, 2]) b.box(x, 0.45, -4.8, 2.2, 0.9, 1.0, steel);
      b.wall(6, -7, 6, -4, H, T, steel);
      b.wall(6, -4, 10, -4, H, T, white, [[0.5, D]]);
      dr(8, -4, 0, true);

      // the dining room: booths down the west wall, a ball pit in the south-east corner
      for (const z of [0.6, 3.2, 5.8]) {
        b.box(-9.3, 0.25, z - 0.75, 1.0, 0.5, 0.5, red); b.box(-9.3, 0.25, z + 0.75, 1.0, 0.5, 0.5, red);
        b.box(-9.3, 0.8, z - 1.04, 1.0, 0.7, 0.1, red); b.box(-9.3, 0.8, z + 1.04, 1.0, 0.7, 0.1, red);
        b.box(-9.35, 0.74, z, 0.9, 0.05, 0.8, white); b.cyl(-9.35, 0.36, z, 0.05, 0.72, steel);
      }
      b.box(7.9, 0.3, 3.6, 3.9, 0.6, 0.12, yellow); b.box(6.0, 0.3, 5.25, 0.12, 0.6, 3.4, yellow);
      for (let i = 0; i < 260; i++) b.ball(b.rnd(6.2, 9.7), b.rnd(0.08, 0.38), b.rnd(3.75, 6.75), 0.07, pit[(b.rnd() * 4) | 0], 7);
      b.box(-3.2, 0.55, 6.5, 1.2, 1.1, 0.5, black);                            // the bins by the door

      for (const [x, z] of [[-5, 1.5], [0, 3.5], [5, 1.5], [-1, -1.6], [-3, -5]]) b.light(x, 3.75, z, 0xfff4e0, 13, 10);
      b.light(8, 3.5, -5.5, 0xbfe6ff, 4, 5);
    },

    populate(ctx) {
      const { at, npc, stay } = crew(ctx);
      for (const x of [-4.5, -2, 0.5]) stay(x, -1.5, null, Math.PI);              // at the tills
      stay(-6.4, -5.4, null, 0); stay(-2.9, -5.5, null, Math.PI);                 // in the kitchen
      for (let i = 0; i < 4; i++) stay(-2.1 + (i % 2) * 0.25, 0.6 + i * 0.85, null, 0);   // the queue
      stay(0.4, 0.6, null, 0);
      stay(-8.3, 0.6, null, -Math.PI / 2); stay(-8.3, 3.2, null, -Math.PI / 2);   // eating in the booths
      stay(7.8, 5.2, null);                                                        // a child in the ball pit
      npc(3, 5, 'thug'); npc(-6, 12, 'thug');
      for (const [x, z] of [[-4.5, 3.6], [-1, 5.2], [3, 3.2]]) { at('table', x, z, 0); at('chair', x - 0.95, z, Math.PI / 2); at('chair', x + 0.95, z, -Math.PI / 2); }
      at('car', -9, 15.2, 0); at('car', -3, 15.2, 0); at('car', 6, 15.5, Math.PI); at('car', 12.5, -4, 0);
      at('cone', 12.5, 9); at('cone', 11.6, 9);
    },
  },

  // ------------------------------------------------------------------------------------- viggos
  viggos: {
    id: 'viggos', name: 'Viggos Bar', icon: '🍺', blurb: 'a pub at night: the bar and its taps, booths, a pool table, darts, the cellar door',
    sky: 'night', spawn: { x: 0, y: 1.0, z: 13 }, yaw: 0, bounds: { x0: -12, x1: 12, z0: -8, z1: 15 },

    build(b) {
      const H = 3.6, T = 0.3, D = 1.3, H2 = Math.PI / 2;
      const brick = b.mat('brick', 0x8a4a34);
      const planks = b.mat('planks', 0x7a5232);
      const dark = b.mat('planks', 0x4e3220);
      const brass = b.mat('metal', 0xc9a25a, { metalness: 0.9, roughness: 0.3 });
      const felt = b.mat('plain', 0x1d6a3a, { roughness: 1 });
      const leather = b.mat('plain', 0x5a1a14, { roughness: 0.7 });
      const black = b.mat('plain', 0x151517, { roughness: 0.4 });
      const ceil = b.mat('planks', 0x2a1a10);
      const glass = b.mat('plain', 0x9fb8c8, { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3 });
      const bottles = [0x2f7a3a, 0x8a5a1a, 0xa8c8d8, 0x6a1a2a].map((c) => b.mat('plain', c, { emissive: c, emissiveIntensity: 0.4, roughness: 0.1, transparent: true, opacity: 0.85 }));
      const balls = [0xf2f2ee, 0xf2c41a, 0x2a4ad2, 0xd22a2a, 0x7a2ad2, 0xf28a1a, 0x111111].map((c) => b.mat('plain', c, { roughness: 0.15 }));
      const road = b.mat('asphalt', 0x4a4c50), con = b.mat('concrete', 0x8c8e90);
      const dr = (x, z, yaw, locked = false) => b.door(x, z, yaw, { wallH: H, wallT: T, gap: D, locked });

      b.ground();
      b.box(0, 0.01, 0, 18, 0.02, 14, planks);
      b.box(0, H + 0.1, 0, 18.6, 0.2, 14.6, ceil); b.box(0, H + 0.4, 0, 19, 0.4, 15, con);
      for (const z of [-5, -2, 1, 4]) b.box(0, H - 0.08, z, 18, 0.16, 0.22, dark, { solid: false });
      b.box(0, 0.01, 17, 60, 0.02, 9, road, { solid: false }); b.box(0, 0.06, 9.8, 60, 0.12, 5.2, con);

      // the shell: brick, a door in the middle of the front between two windows, the cellar door at the back (locked)
      b.wall(-9, -7, 9, -7, H, T, brick, [[16.5 / 18, D]]);
      dr(7.5, -7, 0, true);
      b.wall(-9, -7, -9, 7, H, T, brick); b.wall(9, -7, 9, 7, H, T, brick);
      b.wall(-9, 7, 9, 7, H, T, brick, [[0.5, D], [0.22, 3], [0.78, 3]]);
      for (const x of [-5.04, 5.04]) { b.box(x, 0.45, 7, 3, 0.9, T, brick); b.box(x, (H + 2.4) / 2, 7, 3, H - 2.4, T, brick); b.pane(x, 1.65, 7, 2.9, 1.5, 0.02, glass); }
      dr(0, 7, 0);
      b.sign(0, 2.95, 7.17, 4.6, 0.9, textSign({ text: 'VIGGOS BAR', fg: '#f5d58a', bg: '#2a170c', border: '#c9a25a' }), { glow: 0.45 });
      b.sign(-5.04, 1.75, 6.75, 2.4, 0.7, textSign({ text: 'VIGGOS', fg: '#ffb04a', glow: '#ff6a00', italic: true }), { glow: 2.2 });     // neon in the windows
      b.sign(5.04, 1.75, 6.75, 2.0, 0.6, textSign({ text: 'ÖPPET', fg: '#ff4a4a', glow: '#ff0000' }), { glow: 2.2 });
      for (const x of [-8.83, 8.83]) b.box(x, 0.55, 0, 0.04, 1.1, 14, dark, { solid: false });   // wood panelling round the walls
      b.box(0, 0.55, -6.83, 18, 1.1, 0.04, dark, { solid: false });

      // the bar along the back: counter, brass foot rail, taps, the back bar of bottles, stools
      b.box(-1, 0.55, -4.3, 10, 1.1, 0.7, dark); b.box(-1, 1.12, -4.3, 10.2, 0.06, 0.9, planks);
      b.box(-1, 0.25, -3.9, 10, 0.04, 0.04, brass, { solid: false });
      for (const x of [-4, -3.5, -3, -1.5, -1]) { b.cyl(x, 1.36, -4.45, 0.025, 0.42, brass); b.box(x, 1.6, -4.4, 0.05, 0.14, 0.05, black, { solid: false }); }
      b.box(-1, 0.5, -6.55, 12, 1.0, 0.6, dark); b.box(-1, 1.02, -6.55, 12.1, 0.04, 0.65, planks);
      for (const y of [1.55, 2.1, 2.65]) {
        b.box(-1, y, -6.65, 11, 0.03, 0.35, dark, { solid: false });
        for (let x = -6.3; x <= 4.3; x += 0.3) b.cyl(x + b.rnd(-0.06, 0.06), y + 0.15, -6.65, 0.035, 0.26 + b.rnd(-0.04, 0.06), bottles[(b.rnd() * 4) | 0], { solid: false, sides: 8 });
      }
      for (let x = -5.5; x <= 3.5; x += 1.1) { b.cyl(x, 0.38, -3.45, 0.05, 0.76, brass); b.cyl(x, 0.78, -3.45, 0.2, 0.06, leather); }
      b.box(6.5, 2.6, -6.8, 1.8, 1.0, 0.08, black);
      b.sign(6.5, 2.6, -6.75, 1.66, 0.88, textSign({ text: 'SVERIGE 2 - 1', sub: 'LIVE', fg: '#ffffff', bg: '#1a5a2a' }), { glow: 0.5 });

      // booths down the west side
      for (const z of [-1.4, 1.4, 4.2]) {
        b.box(-8.3, 0.25, z - 0.8, 1.1, 0.5, 0.5, leather); b.box(-8.3, 0.25, z + 0.8, 1.1, 0.5, 0.5, leather);
        b.box(-8.3, 0.85, z - 1.08, 1.1, 0.75, 0.1, leather); b.box(-8.3, 0.85, z + 1.08, 1.1, 0.75, 0.1, leather);
        b.box(-8.35, 0.74, z, 1.0, 0.05, 0.85, dark); b.cyl(-8.35, 0.36, z, 0.05, 0.72, black);
      }
      // the pool table, its lamp, the cues on the wall; darts on the east wall
      b.box(3.5, 0.41, 1.5, 1.5, 0.82, 2.7, dark);
      b.box(3.5, 0.825, 1.5, 1.27, 0.01, 2.47, felt, { solid: false });
      for (const s of [-1, 1]) { b.box(3.5 + s * 0.69, 0.87, 1.5, 0.12, 0.08, 2.7, dark, { solid: false }); b.box(3.5, 0.87, 1.5 + s * 1.29, 1.5, 0.08, 0.12, dark, { solid: false }); }
      let k = 0;
      for (let row = 0; row < 3; row++) for (let i = 0; i <= row; i++) b.ball(3.5 + (i - row / 2) * 0.06, 0.858, 0.9 - row * 0.052, 0.028, balls[1 + (k++ % 6)], 10);
      b.ball(3.5, 0.858, 2.2, 0.028, balls[0], 10);
      b.box(3.5, 2.55, 1.5, 0.5, 0.12, 1.6, black, { solid: false });
      b.box(8.8, 1.5, 3.8, 0.06, 1.4, 0.7, dark);
      for (let i = 0; i < 4; i++) b.box(8.74, 1.45, 3.55 + i * 0.16, 0.025, 1.45, 0.025, planks, { solid: false });
      b.box(8.83, 1.73, -1.5, 0.04, 0.8, 0.8, black);
      b.sign(8.8, 1.73, -1.5, 0.48, 0.48, dartboard, { ry: -H2 });

      b.light(-3, 3.2, -4, 0xffb060, 22, 9); b.light(2, 3.2, -4, 0xffb060, 22, 9);
      b.light(-7.4, 3.0, 1.4, 0xffa050, 14, 8); b.light(3.5, 2.56, 1.5, 0xfff0c8, 12, 6);       // (the bulb inside the shade: lamps cast no shadow, so the light still gets out)
      b.light(-1.5, 3.3, 1.5, 0xffc080, 16, 10); b.light(0, 3.2, 5, 0xffc080, 12, 8); b.light(-4, 4.4, 11, 0xffc070, 10, 12);
    },

    populate(ctx) {
      const { at, npc, stay } = crew(ctx);
      stay(-1, -5.4, null, Math.PI);                                               // the bartender
      for (const x of [-5.5, -3.3, -1.1, 2.2]) stay(x, -3.0, null, 0);            // at the bar
      stay(2.4, 0.4, null, -Math.PI / 2); stay(4.6, 2.9, null, Math.PI / 2);      // round the pool table
      stay(-7.6, -1.4, null, -Math.PI / 2); stay(-7.6, 4.2, null, -Math.PI / 2);  // in the booths
      stay(7.6, -1.5, null, -Math.PI / 2);                                         // at the darts
      stay(1.6, 8.4, 'thug', 0);                                                   // the doorman
      npc(-2, 3, 'thug'); npc(5.5, -2.5);
      at('barrel', 7.6, -5.6); at('chair', -4, 2.6, 0.4); at('chair', 0.5, 4.5, -0.6); at('table', -2.2, 2.5, 0);
      at('car', 6, 15, -Math.PI / 2); at('lamp', -4, 11.6);
    },
  },

  // --------------------------------------------------------------------------------------- leos
  leos: {
    id: 'leos', name: 'Leos Livs', icon: '🛒', blurb: 'a corner shop: aisles, fridges, the pick-and-mix wall, the till, the stock room',
    sky: 'overcast', spawn: { x: -5, y: 1.0, z: 12 }, yaw: 0, bounds: { x0: -11, x1: 11, z0: -9, z1: 14 },

    build(b) {
      const H = 3.4, T = 0.25, D = 1.3, H2 = Math.PI / 2;
      const white = b.mat('concrete', 0xf3f2ee, { roughness: 0.8 });
      const lino = b.mat('plain', 0xb9c2b2, { roughness: 0.45 });
      const green = b.mat('plain', 0x1f7a3e, { roughness: 0.5 });
      const shelf = b.mat('metal', 0xd8dade, { metalness: 0.4, roughness: 0.5 });
      const black = b.mat('plain', 0x1c1d20, { roughness: 0.4 });
      const glass = b.mat('plain', 0xcfe4f0, { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3 });
      const lit = b.mat('plain', 0xe8f4ff, { emissive: 0xcfe6ff, emissiveIntensity: 0.7 });
      const tube = b.mat('plain', 0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.6 });
      const wood = b.mat('planks', 0xb08a5a);
      const screen = b.mat('plain', 0x101418, { emissive: 0x3a6a9a, emissiveIntensity: 0.6 });
      const prod = [0xd23a2a, 0x2a6ad2, 0xf2c21a, 0x2aa04a, 0xf28a1a, 0x8a2ad2, 0xeeeeee, 0x6a4a2a].map((c) => b.mat('plain', c, { roughness: 0.6 }));
      const sweet = [0xff4a8a, 0x4ad2ff, 0xffe04a, 0x6aff4a, 0xff8a2a, 0xffffff].map((c) => b.mat('plain', c, { roughness: 0.25 }));
      const fruit = [0xd22a1a, 0xf28a1a, 0xf2d21a, 0x6ab22a].map((c) => b.mat('plain', c, { roughness: 0.45 }));
      const road = b.mat('asphalt', 0x55575a), con = b.mat('concrete', 0x9a9c9e);
      const dr = (x, z, yaw, locked = false) => b.door(x, z, yaw, { wallH: H, wallT: T, gap: D, locked });

      b.ground();
      b.box(0, 0.01, -1.5, 16, 0.02, 15, lino);
      b.box(0, H + 0.1, -1.5, 16.4, 0.2, 15.4, white); b.box(0, H + 0.4, -1.5, 16.8, 0.4, 15.8, con);
      b.box(0, 0.01, 13, 50, 0.02, 8, road, { solid: false }); b.box(0, 0.06, 7.6, 50, 0.12, 2.8, con);
      for (const x of [-4.5, 0, 4.5]) for (const z of [-3.5, 0.5, 4]) b.box(x, H - 0.03, z, 0.12, 0.04, 1.6, tube, { solid: false });

      // walls: the shop (z -6..6), the stock room behind it (z -9..-6); a glass front with the door on the left
      b.wall(-8, -9, 8, -9, H, T, white);
      b.wall(-8, -9, -8, 6, H, T, white);
      b.wall(8, -9, 8, 6, H, T, white, [[1.5 / 15, D]]);
      dr(8, -7.5, H2, true);                                                   // the back door, locked
      b.wall(-8, -6, 8, -6, H, T, white, [[13 / 16, D]]);
      dr(5, -6, 0);
      b.box(-6.84, H / 2, 6, 2.32, H, T, white);
      dr(-5, 6, 0);
      const n = 5, w = (8 - -4.35) / n;
      b.box(1.825, 0.4, 6, 12.35, 0.8, T, white); b.box(1.825, H - 0.45, 6, 12.35, 0.9, T, white);
      for (let i = 0; i <= n; i++) b.box(-4.35 + i * w, H / 2, 6, 0.1, H, T, black);
      for (let i = 0; i < n; i++) b.pane(-4.35 + (i + 0.5) * w, 1.83, 6, w - 0.1, 2.06, 0.02, glass);
      b.box(0, H + 0.65, 6.2, 16.2, 1.0, 0.25, green);
      b.sign(0, H + 0.65, 6.34, 9, 0.9, textSign({ text: 'LEOS LIVS', fg: '#ffffff', bg: '#1f7a3e' }), { glow: 0.3 });
      b.sign(-1.4, 1.95, 6.05, 1.5, 1.0, textSign({ text: 'ERBJUDANDE!', sub: 'KAFFE 29:-', fg: '#ffffff', bg: '#d2222a' }));
      b.sign(3.6, 1.95, 6.05, 1.5, 1.0, textSign({ text: 'ÖPPET', sub: 'ALLA DAGAR 7-23', fg: '#1f7a3e', bg: '#ffffff', border: '#1f7a3e' }));

      // the till by the door, the cigarette shelf behind it
      b.box(-6, 0.5, 3, 0.8, 1.0, 2.6, wood); b.box(-6, 1.02, 3, 0.9, 0.04, 2.7, black);
      b.box(-6, 1.15, 2.4, 0.4, 0.22, 0.32, black); b.box(-5.82, 1.3, 2.4, 0.02, 0.2, 0.3, screen, { solid: false });
      b.box(-7.7, 1.6, 3, 0.35, 1.6, 2.4, black);
      for (let y = 1.0; y < 2.3; y += 0.2) for (let z = 1.95; z < 4.1; z += 0.12) b.box(-7.5, y, z, 0.03, 0.12, 0.08, prod[(z * 7 + y * 3) % 2 < 1 ? 6 : 0], { solid: false });

      // three runs of shelving, stocked both sides
      const shelves = (x, z0, z1) => {
        const len = z1 - z0, cz = (z0 + z1) / 2;
        b.box(x, 0.08, cz, 1.0, 0.16, len, shelf); b.box(x, 1.0, cz, 0.06, 2.0, len, shelf);
        for (const y of [0.5, 0.95, 1.4, 1.85]) {
          b.box(x, y, cz, 1.0, 0.03, len, shelf);
          for (const s of [-1, 1]) for (let z = z0 + 0.14; z < z1 - 0.1; z += 0.21) {
            const h = b.rnd(0.12, 0.3);
            b.box(x + s * b.rnd(0.2, 0.32), y + 0.015 + h / 2, z, b.rnd(0.1, 0.16), h, 0.17, prod[(b.rnd() * prod.length) | 0], { solid: false });
          }
        }
      };
      shelves(-3.2, -4.6, 2.2); shelves(0, -4.6, 2.2); shelves(3.2, -4.6, 2.2);

      // fridges along the back wall: lit inside, glass doors that can be shot out, bottles
      for (let i = 0; i < 8; i++) {
        const x = -7.25 + i * 1.2;
        b.box(x, 1.05, -5.82, 1.15, 2.1, 0.06, lit);
        b.box(x - 0.58, 1.05, -5.5, 0.04, 2.1, 0.7, white); b.box(x, 2.12, -5.5, 1.2, 0.06, 0.7, white); b.box(x, 0.06, -5.5, 1.2, 0.12, 0.7, white);
        for (const y of [0.15, 0.75, 1.35]) {
          b.box(x, y, -5.5, 1.1, 0.02, 0.6, glass, { solid: false });
          for (let k = 0; k < 4; k++) b.cyl(x - 0.39 + k * 0.26, y + 0.15, -5.42, 0.04, 0.28, prod[(i + k + Math.round(y * 3)) % prod.length], { solid: false, sides: 8 });
        }
        b.pane(x, 1.05, -5.13, 1.1, 1.9, 0.02, glass);
      }
      b.box(-7.8, 0.06, -5.5, 0.2, 0.12, 0.7, white);
      // the pick-and-mix wall (west): bins of every colour
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
        const y = 0.55 + r * 0.42, z = -4.2 + c * 0.75;
        b.box(-7.62, y, z, 0.45, 0.04, 0.6, glass);
        for (let k = 0; k < 7; k++) b.ball(-7.62 + b.rnd(-0.15, 0.15), y + 0.06 + b.rnd(0, 0.06), z + b.rnd(-0.22, 0.22), 0.035, sweet[(r * 6 + c) % sweet.length], 6);
      }
      b.sign(-7.86, 2.45, -2.3, 3.2, 0.55, textSign({ text: 'LÖSGODIS', fg: '#ff4a8a', bg: '#fff3f8' }), { ry: H2 });
      b.box(1.5, 0.45, 4.3, 2.0, 0.9, 0.9, white); b.box(1.5, 0.91, 4.3, 1.9, 0.02, 0.8, lit, { solid: false });   // the freezer chest
      // outside: fruit under the window
      for (let i = 0; i < 4; i++) {
        const x = -0.5 + i * 1.5;
        b.box(x, 0.35, 6.85, 1.2, 0.7, 0.6, wood);
        for (let k = 0; k < 12; k++) b.ball(x + b.rnd(-0.5, 0.5), 0.74 + b.rnd(0, 0.06), 6.85 + b.rnd(-0.22, 0.22), 0.045, fruit[i], 8);
      }

      for (const [x, z] of [[-4, -1], [2, -1], [-1, 3.5]]) b.light(x, 3.1, z, 0xf4f8ff, 12, 9);
      b.light(2, 3.1, -7.5, 0xfff0d8, 5, 6);
    },

    populate(ctx) {
      const { at, npc, stay } = crew(ctx);
      stay(-6.9, 3, null, -Math.PI / 2);                                           // behind the till
      stay(-5, 1.4, null, Math.PI / 2);                                            // paying
      stay(-1.6, -1, null); stay(1.6, 1.2, null); stay(4.8, -2.5, null); stay(-4.8, -3, null);   // shopping
      stay(-3, -4.6, null, 0); stay(-6.8, -1.2, null, Math.PI / 2);               // at the fridges, at the sweets
      stay(1.6, -3.5, 'thug');                                                     // filling his pockets
      stay(2, 8.4, null);
      at('crate', -4, -8, 0.2); at('crate', -3.4, -8.2, 0.5); at('crate', -3.7, -8.1, 0, 0.62); at('pallet', 0, -7.5, 0); at('crate', 0.1, -7.5, 0.1, 0.17);
      at('car', -8, 13, Math.PI / 2);
    },
  },

  // ------------------------------------------------------------------------------------ gustavs
  gustavs: {
    id: 'gustavs', name: 'Gustavs Goonställe', icon: '🎮', blurb: 'a den out the back: three screens, a gaming chair, energy drinks, pizza boxes, LED strips',
    sky: 'night', spawn: { x: 0, y: 1.0, z: 9 }, yaw: 0, bounds: { x0: -8.5, x1: 8.5, z0: -5, z1: 11.5 },

    build(b) {
      const H = 2.7, T = 0.25, D = 1.2, H2 = Math.PI / 2;
      const blockw = b.mat('concrete', 0x6e6e6a, { roughness: 0.95 });
      const floor = b.mat('concrete', 0x4a4844);
      const rug = b.mat('plain', 0x2a2440, { roughness: 1 });
      const desk = b.mat('plain', 0x141416, { roughness: 0.35 });
      const chairR = b.mat('plain', 0xb01a2a, { roughness: 0.6 }), chairB = b.mat('plain', 0x111113, { roughness: 0.6 });
      const sofa = b.mat('plain', 0x3a3a44, { roughness: 1 });
      const sheet = b.mat('plain', 0xd8d4cc, { roughness: 1 });
      const curtain = b.mat('plain', 0x1a1530, { roughness: 1 });
      const card = b.mat('plain', 0xb98a52, { roughness: 0.9 });
      const cans = [b.mat('metal', 0x161616, { metalness: 0.7, roughness: 0.3 }), b.mat('metal', 0x2a5ad2, { metalness: 0.7, roughness: 0.3 }), b.mat('metal', 0x8ad21a, { metalness: 0.6, roughness: 0.35 }), b.mat('metal', 0xd8d8d8, { metalness: 0.8, roughness: 0.25 })];
      const led = (c) => b.mat('plain', 0x111111, { emissive: c, emissiveIntensity: 2.2 });
      const grass = b.mat('plain', 0x34502a, { roughness: 1 }), fence = b.mat('planks', 0x6a5236), con = b.mat('concrete', 0x8a8a86);
      const roof = b.mat('plain', 0x2a2a2c, { roughness: 0.9 });
      const dr = (x, z, yaw, locked = false) => b.door(x, z, yaw, { wallH: H, wallT: T, gap: D, locked });

      b.ground();
      b.box(0, 0.005, 3.5, 30, 0.01, 24, grass, { solid: false });
      b.box(0, 0.015, 0, 12, 0.03, 10, floor); b.box(-0.6, 0.035, 0.6, 6, 0.01, 4.5, rug, { solid: false });
      b.box(0, H + 0.1, 0, 12.4, 0.2, 10.4, blockw); b.box(0, H + 0.3, 0, 12.8, 0.2, 10.8, roof);
      // the den: breeze-block walls, one door, the windows curtained over
      b.wall(-6, -5, 6, -5, H, T, blockw); b.wall(-6, -5, -6, 5, H, T, blockw); b.wall(6, -5, 6, 5, H, T, blockw);
      b.wall(-6, 5, 6, 5, H, T, blockw, [[0.5, D]]);
      dr(0, 5, 0);
      b.box(0, 2.35, 5.17, 3.8, 0.5, 0.06, fence);
      b.sign(0, 2.35, 5.21, 3.6, 0.44, textSign({ text: 'GUSTAVS GOONSTÄLLE', fg: '#f2f2f2', bg: '#5a4028' }));
      for (const [x, z, ry] of [[-5.86, -1, H2], [5.86, -2.6, -H2], [-3, 4.86, Math.PI]]) b.box(x, 1.6, z, ry === Math.PI ? 1.6 : 0.06, 1.2, ry === Math.PI ? 0.06 : 1.6, curtain, { solid: false });

      // the battle station: the desk, three screens, the keyboard glowing, the tower, the chair
      b.box(0, 0.74, -4.45, 3.4, 0.05, 0.85, desk);
      for (const x of [-1.6, 1.6]) b.box(x, 0.36, -4.45, 0.06, 0.72, 0.8, desk);
      const screens = [
        textSign({ text: 'VICTORY', sub: 'GG WP', fg: '#7df9ff', bg: '#0a1030', glow: '#2be8ff' }),
        textSign({ text: 'LIVE', sub: '1 337 TITTARE', fg: '#ff3b6b', bg: '#14081a', glow: '#ff3b6b' }),
        textSign({ text: 'IMPACTBOX', sub: 'SPELAR NU', fg: '#ffffff', bg: '#101820' }),
      ];
      [[-1.1, 0.3], [0, 0], [1.1, -0.3]].forEach(([x, ry], i) => {
        b.box(x, 1.22, -4.72 + Math.abs(x) * 0.12, 1.0, 0.62, 0.04, desk, { ry });
        b.sign(x + Math.sin(ry) * 0.03, 1.22, -4.69 + Math.abs(x) * 0.12, 0.94, 0.56, screens[i], { ry, glow: 1.1 });
        b.box(x, 0.86, -4.66 + Math.abs(x) * 0.12, 0.06, 0.24, 0.06, desk, { solid: false });
      });
      b.box(0, 0.78, -4.12, 0.62, 0.03, 0.2, desk, { solid: false }); b.box(0, 0.797, -4.12, 0.6, 0.005, 0.18, led(0x8a4dff), { solid: false });
      b.box(0.55, 0.77, -4.12, 0.12, 0.02, 0.18, desk, { solid: false });
      b.box(1.9, 0.3, -4.5, 0.25, 0.58, 0.5, desk); b.box(1.77, 0.3, -4.5, 0.01, 0.46, 0.4, led(0x2be8ff), { solid: false });
      b.box(0, 0.5, -3.3, 0.62, 0.12, 0.6, chairB); b.box(0, 1.08, -3.02, 0.58, 1.05, 0.12, chairB);
      for (const s of [-1, 1]) b.box(s * 0.17, 1.08, -2.95, 0.08, 1.0, 0.02, chairR, { solid: false });
      b.cyl(0, 0.27, -3.3, 0.04, 0.46, chairB); b.box(0, 0.05, -3.3, 0.72, 0.05, 0.08, chairB); b.box(0, 0.05, -3.3, 0.08, 0.05, 0.72, chairB);
      // LED strips round the top of the walls
      b.box(0, H - 0.06, -4.84, 11.5, 0.03, 0.03, led(0x8a4dff), { solid: false });
      b.box(-5.84, H - 0.06, 0, 0.03, 0.03, 9.5, led(0x2be8ff), { solid: false });
      b.box(5.84, H - 0.06, 0, 0.03, 0.03, 9.5, led(0xff2bd6), { solid: false });
      // the TV and the console, the couch facing it, a beanbag
      b.box(5.8, 1.4, 1.5, 0.08, 0.78, 1.36, desk);
      b.sign(5.75, 1.4, 1.5, 1.24, 0.68, textSign({ text: 'PAUSAT', fg: '#ffffff', bg: '#101826' }), { ry: -H2, glow: 0.8 });
      b.box(5.55, 0.3, 1.5, 0.5, 0.6, 1.6, desk); b.box(5.55, 0.64, 1.5, 0.3, 0.08, 0.42, sheet, { solid: false });
      b.box(2.6, 0.25, 1.5, 0.95, 0.5, 2.5, sofa); b.box(2.2, 0.68, 1.5, 0.22, 0.85, 2.5, sofa);
      for (const s of [-1, 1]) b.box(2.6, 0.45, 1.5 + s * 1.2, 0.95, 0.4, 0.2, sofa);
      b.ball(-1.6, 0.3, 2.6, 0.48, chairR, 14);
      // the mattress in the corner, the mini fridge, the pizza boxes, the bin bag
      b.box(-4.6, 0.12, 3.3, 1.5, 0.24, 2.1, sheet); b.box(-4.6, 0.29, 2.5, 0.65, 0.12, 0.38, sheet, { solid: false });
      b.box(-4.5, 0.27, 3.75, 1.35, 0.07, 1.25, curtain, { solid: false });
      b.box(-5.4, 0.45, -4.35, 0.6, 0.9, 0.6, sheet); b.box(-5.08, 0.6, -4.35, 0.02, 0.5, 0.5, led(0x6aff8a), { solid: false });
      for (let i = 0; i < 7; i++) b.box(-3.1 + b.rnd(-0.04, 0.04), 0.03 + i * 0.05, -3.3 + b.rnd(-0.04, 0.04), 0.42, 0.045, 0.42, card, { ry: b.rnd(-0.3, 0.3) });
      for (let i = 0; i < 3; i++) b.box(0.9 + i * 0.5, 0.03, 3.6 + b.rnd(-0.2, 0.2), 0.42, 0.045, 0.42, card, { ry: b.rnd(-0.6, 0.6) });
      b.ball(5.2, 0.32, -4.3, 0.38, chairB, 10);
      // energy drinks: on the desk, round the chair, by the couch and the mattress, standing and lying about
      const can = (x, y, z, down) => b.cyl(x, down ? y + 0.033 : y + 0.07, z, 0.033, 0.14, cans[(b.rnd() * cans.length) | 0], { solid: false, sides: 10, ...(down ? { rz: H2, ry: b.rnd(0, 3) } : {}) });
      for (let i = 0; i < 6; i++) can(b.rnd(-1.5, 1.5), 0.765, b.rnd(-4.7, -4.15), false);
      for (let i = 0; i < 14; i++) can(b.rnd(-1.4, 1.4), 0.03, b.rnd(-3.9, -2.2), b.rnd() < 0.6);
      for (let i = 0; i < 8; i++) can(b.rnd(3.2, 4.6), 0.03, b.rnd(0.2, 2.8), b.rnd() < 0.5);
      for (let i = 0; i < 6; i++) can(b.rnd(-3.6, -3.0), 0.03, b.rnd(2.4, 4.2), b.rnd() < 0.5);
      // posters
      b.sign(-5.86, 1.5, -3.2, 1.3, 0.9, textSign({ text: 'GAMER ZONE', fg: '#ff2bd6', bg: '#120018', border: '#2be8ff', glow: '#ff2bd6' }), { ry: H2, glow: 0.6 });
      b.sign(-2.6, 1.6, -4.86, 1.0, 0.7, textSign({ text: 'NO SLEEP', sub: 'BARA SPEL', fg: '#2be8ff', bg: '#0a1020' }), { glow: 0.4 });
      b.sign(2.9, 1.6, -4.86, 0.8, 0.8, textSign({ text: 'GG', sub: 'EZ', fg: '#ffd23a', bg: '#1a1408' }), { glow: 0.4 });
      // the garden: a fence round it, stepping stones to the door
      b.box(0, 0.75, 12, 18, 1.5, 0.08, fence); b.box(-9, 0.75, 3.5, 0.08, 1.5, 17, fence); b.box(9, 0.75, 3.5, 0.08, 1.5, 17, fence);
      for (let k = 0; k < 5; k++) b.box(b.rnd(-0.15, 0.15), 0.025, 6 + k * 1.1, 0.6, 0.04, 0.6, con, { solid: false });

      b.light(0, 2.3, -3.6, 0x6a7aff, 11, 7); b.light(-3, 2.4, 1.2, 0x8a4dff, 15, 8); b.light(3.8, 2.4, 1.5, 0xff2bd6, 13, 7);
      b.light(-3.6, 2.45, -2.4, 0xffd8a0, 7, 6);
      b.light(0, 2.55, 5.6, 0xffd090, 5, 7);
    },

    populate(ctx) {
      const { at, npc, stay } = crew(ctx);
      stay(0, -3.55, null, 0);                                                     // Gustav, at his screens
      stay(3.4, 0.9, 'thug', -Math.PI / 2); stay(3.4, 2.1, 'thug', -Math.PI / 2); // the goons, on the couch side
      stay(-1.9, 0.4, 'thug'); stay(-4.2, 2.4, null);
      npc(4, 8, 'thug');
      at('ball', -5, 8); at('car', 5.5, 9, Math.PI / 2);
    },
  },
};

export const MAP_LIST = Object.values(MAPS);
