import { PROP_TYPES } from './props.js';

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
  return { at, npc, stack };
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
          else b.box(x, 1.65, zf - side * 0.03, 2.5, 2.1, 0.08, b.rnd() < 0.45 ? shop : glass, { solid: false });
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
      b.box(20, 1.35, 8.05, 3.6, 2.0, 0.05, glass);
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
        b.box(x, y0 + 1.6, z, 1.1, 1.2, 0.02, glass, { ...o, solid: false });
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
};

export const MAP_LIST = Object.values(MAPS);
