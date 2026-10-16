import * as THREE from 'three';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';

// Real holes in bodies, Gorebox style.
//
// A wound is a short line in the body part's local space with a radius: a point for a bullet hole,
// a longer line for a slash. It also remembers which way the bullet or blade was going, and bores
// straight in along that for a few centimetres, so the hole opens cleanly wherever the skin actually is.
// The part's skin materials are swapped for copies whose shader throws away every pixel inside a
// wound, so the surface genuinely opens. Around each wound the same shader
// soaks the skin and clothes with blood, which spreads and runs down the body as the wound ages,
// and it chars whatever an explosion burned.
// What you see through an opening:
//   - the far wall of the cavity: the skin's own back faces, painted as dark flesh near a wound
//   - a meat layer: the same mesh pulled in under the skin, with narrower holes, so the wound has depth
//   - innards: ribs, spine, lungs, heart, gut, brain, limb bones (one mesh per body part)
// The meat and the innards are only built the first time a part is actually holed.
// Hits that land on an existing hole make it bigger instead of adding a new one.
// This file also builds the torn ends left where a limb comes off (makeStump).

export const MAX_WOUNDS = 12;
/** Co-op (coop.js): the host hears about every wound and burn so the other player's copy of the body gets the same. */
export const woundHooks = { open: null, burn: null };
const CORE_SCALE = 0.82;
const SKIN_DEPTH = 0.011;    // skinned bodies: how far under the surface the meat starts

/** Game time, for ageing wounds. main.js advances it. */
export const woundClock = { value: 0 };
export function tickWounds(dt) { woundClock.value += dt; }

const WOUND_GLSL = `
uniform vec4 uWoundA[${MAX_WOUNDS}];   // one end of the wound, radius
uniform vec4 uWoundB[${MAX_WOUNDS}];   // the other end, time it was made
uniform vec4 uWoundC[${MAX_WOUNDS}];   // the way it went in, how deep it bores
uniform vec3 uOrigin;
uniform int uWoundCount;
uniform float uPosScale;     // mesh-local -> part-local (the rigid meat core is a shrunk copy)
uniform float uHoleScale;    // deeper layers get narrower holes
uniform float uTime;
uniform float uBurn;
varying vec3 vWPos;
float wHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float wNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// x: distance to the nearest wound, in wound radii (< 1 means inside the hole)
// y: how soaked in blood this spot is, 0..1
vec2 woundField(vec3 p) {
  float best = 1e9, wet = 0.0;
  float rag = wNoise(p * 90.0) * 0.5 + wNoise(p * 230.0) * 0.25;      // torn, uneven edges
  for (int i = 0; i < ${MAX_WOUNDS}; i++) {
    if (i >= uWoundCount) break;
    vec3 a = uWoundA[i].xyz, ab = uWoundB[i].xyz - a;
    float r = uWoundA[i].w;
    vec3 q = p - a - ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    float deep = dot(q, uWoundC[i].xyz);
    q -= uWoundC[i].xyz * deep * step(abs(deep), uWoundC[i].w);
    float d = length(q) / r;
    best = min(best, d / uHoleScale);
    float age = uTime - uWoundB[i].w;
    // the stain soaks outward fast for a few seconds, then on through the cloth for a minute...
    float reach = 1.5 + 2.4 * (1.0 - exp(-age * 0.3)) + 3.5 * (1.0 - exp(-age * 0.025));
    wet = max(wet, 1.0 - smoothstep(reach * 0.45, reach, d + rag));
    // ...and a trickle runs down the body from the hole (the model's rest pose stands upright)
    float len = r * (3.0 + 17.0 * (1.0 - exp(-age * 0.1)));
    float side = length(q.xz) / r + (wNoise(vec3(p.y * 55.0, float(i) * 7.0, 0.5)) - 0.5);
    wet = max(wet, step(0.0, -q.y) * (1.0 - smoothstep(len * 0.6, len, -q.y)) * (1.0 - smoothstep(0.4, 0.85, side)));
  }
  return vec2(best + (rag - 0.37) * 0.5, wet);
}`;

/**
 * Copy of a material whose shader cuts wound holes.
 * look: 'skin' also stains and burns the surface; 'meat' paints muscle and fat.
 * inside: draw the back faces too, as the far wall of the wound (only near a wound: elsewhere they stay hidden).
 */
function woundMaterial(base, uniforms, { posScale = 1, holeScale = 1, look = 'skin', shrink = 0, inside = false } = {}) {
  const m = base.clone();
  if (inside) m.side = THREE.DoubleSide;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWoundA = uniforms.a;
    shader.uniforms.uWoundB = uniforms.b;
    shader.uniforms.uWoundC = uniforms.c;
    shader.uniforms.uWoundCount = uniforms.count;
    shader.uniforms.uTime = woundClock;
    shader.uniforms.uBurn = uniforms.burn;
    shader.uniforms.uPosScale = { value: posScale };
    shader.uniforms.uHoleScale = { value: holeScale };
    shader.uniforms.uOrigin = uniforms.origin;       // where the part sits in the body's rest pose
    shader.uniforms.uShrink = { value: shrink };     // the meat layer is the same skin pulled in along its normals
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform vec3 uOrigin;\nuniform float uShrink;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position - uOrigin;\ntransformed -= normal * uShrink;');
    const paint = look === 'skin' ? `
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.003, 0.003), wf.y * 0.92);     // soaked: near black-red, as blood in cloth is
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.01, 0.01), 1.0 - smoothstep(1.0, 1.25, wf.x));   // raw edge
        float charK = 0.0;
        if (uBurn > 0.0) {
          vec3 rp = wp + uOrigin;             // whole-body coordinates, so the scorching runs across the joints
          float cn = wNoise(rp * 9.0) * 0.55 + wNoise(rp * 24.0) * 0.3 + wNoise(rp * 70.0) * 0.15;   // big patches, ragged edges
          diffuseColor.rgb *= 1.0 - 0.45 * uBurn;                                                    // soot over everything
          charK = smoothstep(1.0, 1.22, cn + uBurn * 1.3) * 0.94;
          vec3 burnt = mix(vec3(0.016, 0.013, 0.012), vec3(0.075, 0.03, 0.02), wNoise(rp * 34.0) * wNoise(rp * 11.0));   // black, cracked to raw in places
          diffuseColor.rgb = mix(diffuseColor.rgb, burnt, charK);
        }
        #ifdef DOUBLE_SIDED
          if (!gl_FrontFacing) {
            if (wf.x > 7.0) discard;
            diffuseColor.rgb = vec3(0.1, 0.008, 0.008) * (0.5 + wNoise(wp * 80.0));
            charK = 0.0;
          }
        #endif`
      : look === 'meat' ? `
        float fibre = wNoise(vec3(wp.x * 260.0, wp.y * 26.0, wp.z * 260.0));
        diffuseColor.rgb = mix(vec3(0.2, 0.01, 0.012), vec3(0.5, 0.035, 0.03), fibre);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.5, 0.33), smoothstep(0.62, 0.8, wNoise(wp * 70.0)) * 0.55);`
      : '';
    const gloss = look === 'skin' ? 'roughnessFactor = mix(mix(roughnessFactor, 0.24, wf.y), 0.95, charK);' : '';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WOUND_GLSL)
      .replace('#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nvec3 wp = vWPos * uPosScale;\nvec2 wf = woundField(wp);\n' + (look === 'innards' ? 'if (wf.x > 3.5) discard;' : 'if (wf.x < 1.0) discard;'))
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + paint)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + gloss);
  };
  m.customProgramCacheKey = () => 'wound:' + look + inside;
  m.name = base.name;
  return m;
}

// ---- shared innards -------------------------------------------------------------------------
const meatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26 });
const boneMat = new THREE.MeshStandardMaterial({ color: 0xc4b596, roughness: 0.5 });
const lungMat = new THREE.MeshStandardMaterial({ color: 0x8a3438, roughness: 0.28 });
const heartMat = new THREE.MeshStandardMaterial({ color: 0x5a0a10, roughness: 0.22 });
const liverMat = new THREE.MeshStandardMaterial({ color: 0x4a1210, roughness: 0.22 });
const gutMat = new THREE.MeshStandardMaterial({ color: 0xa8584a, roughness: 0.26 });
const brainMat = new THREE.MeshStandardMaterial({ color: 0xc08a86, roughness: 0.3 });

const ballGeo = new THREE.SphereGeometry(1, 14, 10);
const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const ribGeo = new THREE.TorusGeometry(1, 0.09, 5, 18);
const coilGeo = new THREE.TorusGeometry(1, 0.34, 6, 14);

function lump(mat, x, y, z, sx, sy, sz) {
  const m = new THREE.Mesh(ballGeo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
function rod(mat, x, y, z, r, len) {
  const m = new THREE.Mesh(rodGeo, mat);
  m.position.set(x, y, z);
  m.scale.set(r, len, r);
  return m;
}

const innardMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 });
const innardCache = new Map();
/** What is inside a given body part, as one mesh. */
function innards(name) {
  let geo = innardCache.get(name);
  if (!geo) {
    // bake every organ into one geometry, its colour into the vertices
    const parts = [];
    const group = innardGroup(name);
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      g.deleteAttribute('uv');
      const c = o.material.color, n = g.attributes.position.count, col = new Float32Array(n * 3);
      // darker than in daylight: this is the inside of a body, and everything in there is bloody
      const pos = g.attributes.position;
      for (let i = 0; i < n; i++) {
        const k = 0.5 + 0.35 * Math.abs(Math.sin(pos.getX(i) * 90 + pos.getY(i) * 70 + pos.getZ(i) * 110));
        col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k * 0.8; col[i * 3 + 2] = c.b * k * 0.8;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(g);
    });
    geo = mergeGeometries(parts);
    innardCache.set(name, geo);
  }
  return new THREE.Mesh(geo, innardMat);
}

/** The organs of a body part as separate shapes. Character faces -Z, so +Z is the back. */
function innardGroup(name) {
  const g = new THREE.Group();
  if (name === 'torso') {
    g.add(rod(boneMat, 0, 0, 0.05, 0.016, 0.42));                               // spine...
    for (let i = 0; i < 8; i++) g.add(lump(boneMat, 0, 0.19 - i * 0.052, 0.05, 0.024, 0.016, 0.024));   // ...and its vertebrae
    for (let i = 0; i < 6; i++) {                                               // rib cage
      const rib = new THREE.Mesh(ribGeo, boneMat);
      rib.rotation.x = Math.PI / 2 + 0.12;
      rib.position.set(0, 0.17 - i * 0.045, 0.0);
      rib.scale.set(0.118 - i * 0.004, 0.07, 0.1);
      g.add(rib);
    }
    g.add(lump(lungMat, 0.055, 0.08, -0.005, 0.045, 0.075, 0.045));
    g.add(lump(lungMat, -0.055, 0.08, -0.005, 0.045, 0.075, 0.045));
    g.add(lump(heartMat, 0.015, 0.06, -0.03, 0.03, 0.036, 0.028));
    g.add(lump(liverMat, -0.045, -0.045, -0.015, 0.06, 0.035, 0.045));
    g.add(lump(gutMat, 0.04, -0.05, -0.02, 0.04, 0.03, 0.035));                 // stomach
    for (let i = 0; i < 7; i++) {                                               // coils of gut
      const coil = new THREE.Mesh(coilGeo, gutMat);
      coil.position.set(((i * 37) % 9 - 4) * 0.012, -0.1 - (i % 4) * 0.024, -0.012 + ((i * 53) % 5 - 2) * 0.008);
      coil.rotation.set(i * 1.3, i * 2.1, i * 0.7);
      coil.scale.setScalar(0.03 + (i % 3) * 0.006);
      g.add(coil);
    }
  } else if (name === 'pelvis') {
    g.add(lump(boneMat, 0, 0, 0.01, 0.11, 0.04, 0.05));                        // hip bone
    for (let i = 0; i < 5; i++) {
      const coil = new THREE.Mesh(coilGeo, gutMat);
      coil.position.set((i - 2) * 0.03, 0.03 + (i % 2) * 0.016, -0.03);
      coil.rotation.set(i * 1.7, i * 0.9, i * 2.3);
      coil.scale.setScalar(0.03);
      g.add(coil);
    }
  } else if (name === 'head') {
    g.add(lump(brainMat, 0.027, 0.035, 0.005, 0.03, 0.045, 0.062));            // two halves
    g.add(lump(brainMat, -0.027, 0.035, 0.005, 0.03, 0.045, 0.062));
    g.add(lump(brainMat, 0, -0.005, 0.045, 0.036, 0.022, 0.026));              // cerebellum
    g.add(lump(boneMat, 0, -0.06, -0.03, 0.04, 0.02, 0.04));                   // jaw
    g.add(rod(boneMat, 0, -0.09, 0.02, 0.014, 0.08));                           // top of the spine
  } else {
    const thick = name.startsWith('thigh') ? 0.017 : name.startsWith('shin') ? 0.014 : 0.011;
    const len = name.startsWith('thigh') || name.startsWith('shin') ? 0.44 : 0.3;
    g.add(rod(boneMat, 0, 0, 0, thick, len));                                   // limb bone
  }
  return g;
}

/** Swap in the hole-cutting materials. Runs once per part. */
function prepare(part) {
  const uniforms = {
    a: { value: Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4(0, 0, 0, 1)) },
    b: { value: Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    c: { value: Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    count: { value: 0 },
    burn: { value: 0 },
    origin: { value: part.rest || new THREE.Vector3() },
  };
  part.wounds = { uniforms, list: [], inside: false };
  for (const s of part.skin) s.mesh.material = woundMaterial(s.mesh.material, uniforms, { inside: s.body });
}

/** Build what shows through a hole. Runs the first time a part is actually opened. */
function buildInside(part) {
  const { uniforms } = part.wounds;
  part.wounds.inside = true;
  for (const s of [...part.skin]) {
    if (!s.body) continue; // hair, eyes, shoes: holes only, nothing behind them
    if (s.mesh.isSkinnedMesh) {
      // skinned body: the meat is one more skin on the same bones
      const core = new THREE.SkinnedMesh(s.mesh.geometry,
        woundMaterial(meatMat, uniforms, { shrink: SKIN_DEPTH, holeScale: 0.72, look: 'meat' }));
      core.bind(s.mesh.skeleton, s.mesh.bindMatrix);
      core.frustumCulled = false;
      core.userData.inside = true;                  // (only drawn up close: Ragdoll.cull)
      s.mesh.parent.add(core);
      part.skinned.push(core);
      continue;
    }
    const core = new THREE.Mesh(s.mesh.geometry,
      woundMaterial(meatMat, uniforms, { posScale: CORE_SCALE, holeScale: 0.72, look: 'meat' }));
    core.scale.setScalar(CORE_SCALE);
    core.userData.inside = true;
    part.mesh.add(core);
  }
  // a downloaded (skinned) body's arms and legs do not line up exactly with their physics capsules, so a bone rod
  // there can show beside the limb: those show meat through a hole, and no bone
  const limb = !['torso', 'pelvis', 'head'].includes(part.name);
  if (!(limb && part.skin.some((s) => s.mesh.isSkinnedMesh))) {
    // and they are only drawn near a hole: that is the only place they can be seen, and elsewhere a downloaded body's own
    // shape can leave a rib or the spine poking out through its skin (their mesh is in the part's own space: no origin)
    const inn = innards(part.name);
    inn.material = woundMaterial(innardMat, { ...uniforms, origin: { value: new THREE.Vector3() } }, { look: 'innards' });
    inn.userData.inside = true;
    part.mesh.add(inn);
  }
}

/**
 * Open (or widen) a hole in a body part.
 * @param part    ragdoll part: { name, mesh, skin: [{ mesh, body }] }
 * @param p       wound centre in the part's local space
 * @param radius  hole radius in metres
 * @param maxR    how big repeated hits may make one hole
 * @param p2      other end of the wound, for a slash; null for a round hole
 * @param axis    unit vector: the way the bullet or blade was travelling (part-local), if it had one
 * @param reach   how far along that it bores, in metres
 */
export function openWound(part, p, radius, maxR = 0.1, p2 = null, axis = null, reach = 0.05) {
  woundHooks.open?.(part, p, radius, maxR, p2, axis, reach);
  if (!part.wounds) prepare(part);
  if (!part.wounds.inside) buildInside(part);
  const { uniforms, list } = part.wounds;

  // a hit on an existing hole tears it wider
  if (!p2) {
    for (const w of list) {
      if (w.slash) continue;
      const a = w.a;
      const d = Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z);
      if (d < (a.w + radius) * 0.8) {
        const grown = Math.min(maxR, Math.sqrt(a.w * a.w + radius * radius * 0.9));
        const k = 0.3 * (radius / grown);
        a.set(a.x + (p.x - a.x) * k, a.y + (p.y - a.y) * k, a.z + (p.z - a.z) * k, grown);
        w.b.set(a.x, a.y, a.z, w.b.w);
        return w;
      }
    }
  }
  let w;
  if (list.length < MAX_WOUNDS) {
    w = { a: uniforms.a.value[list.length], b: uniforms.b.value[list.length], c: uniforms.c.value[list.length] };
  } else {
    w = list.shift(); // out of slots: the oldest wound closes
  }
  list.push(w);
  w.slash = !!p2;
  w.a.set(p.x, p.y, p.z, Math.min(radius, maxR));
  const e = p2 || p;
  w.b.set(e.x, e.y, e.z, woundClock.value);
  if (axis) w.c.set(axis.x, axis.y, axis.z, reach); else w.c.set(0, 0, 0, 0);
  uniforms.count.value = list.length;
  return w;
}

/** Char a part's surface. amount 0..1; it only ever gets worse. */
export function burn(part, amount) {
  woundHooks.burn?.(part, amount);
  if (!part.wounds) prepare(part);
  const u = part.wounds.uniforms.burn;
  u.value = Math.min(1, Math.max(u.value, amount));
}

// ---- stumps -----------------------------------------------------------------------------------
const stumpMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.27 });
const charMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x2e1a14, roughness: 0.95 });   // a cut burnt shut (the laser sword)
const MEAT = [0.4, 0.028, 0.026], MEAT_DARK = [0.17, 0.008, 0.01], FAT = [0.74, 0.5, 0.33], BONE = [0.68, 0.61, 0.48];
const MARROW = [0.3, 0.03, 0.03], GUT = [0.5, 0.22, 0.2];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clampN = (x, a, b) => Math.min(b, Math.max(a, x));

function seeded(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function coloured(geo, fn) {
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

/**
 * The torn end of a limb, in a unit circle with +Y out of the wound:
 * a mound of muscle ringed with fat, snapped bone standing out of it, and ragged skin around the edge.
 */
function stumpGeometry(kind, seed) {
  const r = seeded(seed);
  const pieces = [];

  // --- the meat: a lumpy mound, pitted, fat at the rim
  const RINGS = 6, SEG = 16;
  const pos = [0, 0.3 + r() * 0.15, 0], col = [...MEAT_DARK], idx = [];
  const lobes = Array.from({ length: 5 }, () => [r() * 6.283, 0.25 + r() * 0.55, 0.5 + r() * 0.7]);   // angle, distance, height
  for (let j = 1; j <= RINGS; j++) {
    const rr = j / RINGS;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * 6.283;
      const edge = 1.03 + (j === RINGS ? (r() - 0.5) * 0.1 : 0);
      const x = Math.cos(a) * rr * edge, z = Math.sin(a) * rr * edge;
      let h = 0.16 * (1 - rr * rr);
      for (const [la, ld, lh] of lobes) {            // bunched muscle
        const d = Math.hypot(x - Math.cos(la) * ld, z - Math.sin(la) * ld);
        h += lh * 0.34 * Math.max(0, 1 - d / 0.42) * (1 - rr * rr * rr);
      }
      h += (r() - 0.5) * 0.07 * (1 - rr);
      if (j === RINGS) h = -0.04;                    // tucked in behind the skin
      pos.push(x, h, z);
      const fat = j >= RINGS - 1 ? 0.85 : 0;
      col.push(...mix3(mix3(MEAT_DARK, MEAT, 0.25 + r() * 0.75), FAT, fat * (0.6 + r() * 0.4)));
    }
  }
  for (let i = 0; i < SEG; i++) idx.push(0, 1 + (i + 1) % SEG, 1 + i);
  for (let j = 1; j < RINGS; j++) for (let i = 0; i < SEG; i++) {
    const a = 1 + (j - 1) * SEG + i, b = 1 + (j - 1) * SEG + (i + 1) % SEG, c = a + SEG, d = b + SEG;
    idx.push(a, b, d, a, d, c);
  }
  const mound = new THREE.BufferGeometry();
  mound.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mound.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  mound.setIndex(idx);
  mound.computeVertexNormals();
  if (mound.attributes.normal.getY(0) < 0) {         // wound the wrong way round: face it outward
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 1]; idx[i + 1] = t; }
    mound.setIndex(idx);
    mound.computeVertexNormals();
  }
  pieces.push(mound);

  // --- bone: snapped off, splintered, marrow in the middle
  const bone = (x, z, rad, h) => {
    const g = new THREE.CylinderGeometry(rad * 0.9, rad, h, 8, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0 && Math.hypot(p.getX(i), p.getZ(i)) > rad * 0.5) p.setY(i, p.getY(i) + (r() - 0.35) * h * 0.7);
    }
    g.translate(x, h * 0.5 - 0.05, z);
    g.computeVertexNormals();
    return coloured(g, (vx, vy, vz) => (Math.hypot(vx - x, vz - z) < rad * 0.5 && vy > 0.1 ? MARROW
      : mix3(BONE, MEAT, clampN(0.9 - vy * 1.6 + (r() - 0.5) * 0.5, 0.25, 1))));
  };
  if (kind === 'limb2') {
    pieces.push(bone(-0.18 + r() * 0.1, 0.05, 0.25, 0.4 + r() * 0.35), bone(0.34, -0.12 + r() * 0.1, 0.16, 0.3 + r() * 0.35));
  } else if (kind === 'neck' || kind === 'gut') {
    pieces.push(bone(0, 0.42, kind === 'gut' ? 0.2 : 0.3, 0.5 + r() * 0.3));               // the spine sits at the back
    if (kind === 'neck') {                                                                 // windpipe
      const pipe = new THREE.CylinderGeometry(0.17, 0.17, 0.45, 8, 1).translate(0.05, 0.2, -0.3);
      pieces.push(coloured(pipe, (vx, vy, vz) => (Math.hypot(vx - 0.05, vz + 0.3) < 0.1 ? MEAT_DARK : mix3(FAT, MEAT, 0.45))));
    }
  } else {
    pieces.push(bone((r() - 0.5) * 0.2, (r() - 0.5) * 0.2, 0.3, 0.45 + r() * 0.45));
  }

  // --- gut hanging out of a body cut in half
  if (kind === 'gut') {
    for (let k = 0; k < 4; k++) {
      const a = r() * 6.283, d = 0.2 + r() * 0.35;
      const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.6 - 0.1;
      const pts = [new THREE.Vector3(x, -0.05, z), new THREE.Vector3(x * 1.2, 0.5 + r() * 0.5, z * 1.2 - 0.1),
        new THREE.Vector3(x * 1.9 + (r() - 0.5) * 0.4, 0.75 + r() * 0.5, z * 1.9 - 0.2 - r() * 0.3),
        new THREE.Vector3(x * 2.3 + (r() - 0.5) * 0.6, 0.3 + r() * 0.3, z * 2.2 - 0.5 - r() * 0.4),
        new THREE.Vector3(x * 2.0 + (r() - 0.5) * 0.8, 0.02, z * 2.0 - 0.8 - r() * 0.5)];
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.14 + r() * 0.04, 6, false);
      pieces.push(coloured(tube, (vx, vy, vz) => mix3(GUT, MEAT, r() * 0.5)));
    }
  }

  // --- skin torn rather than cut: ragged flaps standing off the rim (both faces, so they show from any side)
  const fp = [], fc = [], fi = [];
  const flaps = 7 + Math.floor(r() * 4);
  for (let k = 0; k < flaps; k++) {
    // each flap is a wide strip with two uneven corners, flopping a little outward
    const a = (k + r() * 0.6) / flaps * 6.283, w = 0.22 + r() * 0.2, len = 0.12 + r() * 0.42, lean = (r() - 0.2) * 0.35;
    const at = (ang, rad, y) => [Math.cos(ang) * rad, y, Math.sin(ang) * rad];
    const b0 = at(a - w, 1.03, -0.03), b1 = at(a + w, 1.03, -0.03);
    const t0 = at(a - w * (0.2 + r() * 0.6), 1.03 + lean, len * (0.5 + r() * 0.5)), t1 = at(a + w * (0.2 + r() * 0.6), 1.03 + lean, len * (0.5 + r() * 0.5));
    for (const tri of [[b0, b1, t1], [b0, t1, t0], [b1, b0, t1], [t1, b0, t0]]) {
      const n = fp.length / 3;
      for (const v of tri) { fp.push(...v); fc.push(...mix3(MEAT_DARK, MEAT, r() * 0.5)); }
      fi.push(n, n + 1, n + 2);
    }
  }
  const flapGeo = new THREE.BufferGeometry();
  flapGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  flapGeo.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
  flapGeo.setIndex(fi);
  flapGeo.computeVertexNormals();
  pieces.push(flapGeo);

  return mergeGeometries(pieces);
}

const stumpCache = new Map();
/**
 * Mesh for the wound left where a limb came off. +Y points out of the wound.
 * rx, rz = half-widths of the cut; kind = 'limb' (one bone), 'limb2' (two), 'neck', 'gut' (torso cut in half).
 */
/** A broken bone's jagged end, standing up out of a wound along +y (the base sits under the skin). */
export function boneShard() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.07, 6).translate(0, 0.012, 0), boneMat);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.026, 5).translate(0, 0.058, 0).rotateZ(0.35), boneMat);
  const meat = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6).scale(1, 0.5, 1), new THREE.MeshStandardMaterial({ color: 0x5a0a0c, roughness: 0.25 }));
  for (const m of [shaft, tip, meat]) { m.castShadow = true; g.add(m); }
  return g;
}

export function makeStump(rx, rz, kind = 'limb', sealed = false) {
  const key = kind + ((Math.random() * 4) | 0);
  let g = stumpCache.get(key);
  if (!g) { g = stumpGeometry(kind, key.charCodeAt(key.length - 1) + kind.length * 7); stumpCache.set(key, g); }
  const m = new THREE.Mesh(g, sealed ? charMat : stumpMat);
  m.scale.set(rx, Math.min(rx, rz), rz);
  m.castShadow = true;
  return m;
}

// ---- clean cuts -------------------------------------------------------------------------------
const sectionMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, side: THREE.DoubleSide });
const charSectionMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x2e1a14, roughness: 0.95, side: THREE.DoubleSide });
const DERMIS = [0.66, 0.42, 0.36], YELLOW_FAT = [0.78, 0.6, 0.26], CAVITY = [0.1, 0.012, 0.018], BRAIN = [0.66, 0.5, 0.48], CORTEX = [0.42, 0.3, 0.3];
const RINGS = [0, 0.15, 0.3, 0.45, 0.56, 0.64, 0.7, 0.76, 0.82, 0.87, 0.91, 0.95, 0.98, 1];

/**
 * The face of a clean cut (a blade's; a laser's comes out burnt black): flat, filling the outline the cut left in the skin, with
 * what is in there in its place: skin at the edge, a band of fat, muscle (in bundles), and the bone with marrow in it (two in a
 * forearm or a shin; in the trunk the spine at the back, the body cavity in front of it and ribs round that; in a head the
 * skull round the brain). rim: points on that outline, c: its middle, n: square to it (all in the frame it goes in), r: the
 * half-widths to fall back on if the outline is too thin to go by. One face does for both sides of the cut (it is two-sided).
 */
export function makeSection(rim, c, n, kind, r, sealed = false) {
  const rnd = seeded((Math.random() * 9973) | 0);
  // a frame in the face: u as near the part's own x as the cut allows, v toward the back (the body faces -z)
  const u = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize(), v = new THREE.Vector3().crossVectors(u, n);
  // the outline, as a distance from the middle every 7.5°
  const B = 48, rad = new Array(B).fill(0), d = new THREE.Vector3();
  for (const p of rim) {
    d.copy(p).sub(c);
    const x = d.dot(u), z = d.dot(v), i = ((Math.round(Math.atan2(z, x) / (Math.PI * 2) * B) % B) + B) % B;
    rad[i] = Math.max(rad[i], Math.hypot(x, z));
  }
  const got = rad.filter((x) => x > 0).sort((a, b) => a - b);
  if (got.length < B / 4) for (let i = 0; i < B; i++) { const a = i / B * Math.PI * 2; rad[i] = r[0] * r[1] / Math.hypot(r[1] * Math.cos(a), r[0] * Math.sin(a)); }
  else {
    const most = got[got.length >> 1] * 1.5;          // (the cut also crossing a bit of something further out: not the outline)
    for (let i = 0; i < B; i++) rad[i] = Math.min(rad[i], most);
    for (let i = 0; i < B; i++) {                      // gaps: between the nearest on either side
      if (rad[i]) continue;
      let a = 1, b = 1;
      while (!rad[(i - a + B) % B]) a++;
      while (!rad[(i + b) % B]) b++;
      rad[i] = (rad[(i - a + B) % B] * b + rad[(i + b) % B] * a) / (a + b);
    }
  }
  const mean = rad.reduce((s, x) => s + x, 0) / B;
  const pos = [], col = [], idx = [];
  const at = (x, z, e = 0) => { pos.push(c.x + u.x * x + v.x * z + n.x * e, c.y + u.y * x + v.y * z + n.y * e, c.z + u.z * x + v.z * z + n.z * e); };
  // muscle comes in bundles, each a slightly different red, with pale sheets of fascia between them
  const s1 = rnd() * 6.3, s2 = rnd() * 6.3;
  const meat = (f, a) => {
    const g = Math.sin(a * 3 + s1 + f * 4.5) * Math.cos(a * 2 - s2 - f * 3.5);
    return Math.abs(g) < 0.05 && f > 0.25 ? mix3(MEAT, FAT, 0.22) : mix3(MEAT_DARK, MEAT, 0.3 + 0.32 * g + 0.08 * rnd());
  };
  const organ = (f, a) => {          // the body cavity: gut, liver, the dark between them
    const g = Math.sin(a * 2 + s2 + f * 7) * Math.cos(a * 3 - s1 - f * 5);
    return g > 0.25 ? mix3(GUT, MEAT, 0.3 + g * 0.4) : g < -0.3 ? mix3(MEAT_DARK, [0.25, 0.05, 0.08], -g) : mix3(CAVITY, MEAT_DARK, 0.5 + g);
  };
  // what each ring of the face is, by how far out it is (f, 0..1 of the outline) and which way (x, z: -1..1)
  const layer = (f, x, z, i, a) => {
    if (f >= 1) return kind === 'head' ? mix3(DERMIS, MEAT, 0.3) : DERMIS;
    if (kind === 'head') {
      if (f >= 0.87) return mix3(MEAT, DERMIS, 0.4);                         // scalp
      if (f >= 0.76) return mix3(BONE, [0.85, 0.8, 0.7], rnd() * 0.5);      // skull
      if (f >= 0.7) return MEAT;                                            // the lining
      if (f >= 0.56) return mix3(CORTEX, MEAT_DARK, rnd() * 0.3);           // grey matter, folded
      return mix3(BRAIN, CORTEX, Math.max(0, Math.sin(a * 9 + s1 + f * 14) * Math.cos(a * 4 - f * 9)) * 0.8);   // white matter, the folds running into it
    }
    if (f >= 0.98) return mix3(YELLOW_FAT, DERMIS, 0.6);
    if (f >= 0.87) return mix3(YELLOW_FAT, FAT, rnd() * 0.4);
    if (f >= 0.82) return mix3(YELLOW_FAT, MEAT, 0.6);
    if (kind === 'gut') {
      if (f >= 0.7 && f < 0.82 && i % 6 === 0 && z < 0.4) return BONE;     // ribs, cut across
      if (f < 0.64 && z < 0.35) return organ(f, a);                        // what is in the body
    }
    return meat(f, a);
  };
  pos.push(c.x, c.y, c.z); col.push(...layer(0, 0, 0, 0, 0));
  for (let k = 1; k < RINGS.length; k++) {
    for (let i = 0; i < B; i++) {
      const a = i / B * Math.PI * 2, R = rad[i] * 0.99 * RINGS[k];
      at(Math.cos(a) * R, Math.sin(a) * R);
      col.push(...layer(RINGS[k], Math.cos(a), Math.sin(a), i, a));
    }
  }
  for (let i = 0; i < B; i++) idx.push(0, 1 + i, 1 + (i + 1) % B);
  for (let k = 1; k < RINGS.length - 1; k++) for (let i = 0; i < B; i++) {
    const a = 1 + (k - 1) * B + i, b = 1 + (k - 1) * B + (i + 1) % B;
    idx.push(a, a + B, b + B, a, b + B, b);
  }
  // bones, a hair proud of the face on both sides of it: a ring of hard bone, spongy toward the marrow in the middle
  const bone = (x, z, br, spine = false) => {
    for (const e of [0.0012, -0.0012]) {
      const o = pos.length / 3, S = 14;
      at(x, z, e); col.push(...(spine ? mix3(MARROW, BONE, 0.45) : MARROW));
      for (const [f, cc] of [[0.5, spine ? mix3(MARROW, BONE, 0.55) : MARROW], [0.62, mix3(MARROW, BONE, 0.6)], [1, BONE]]) {
        for (let i = 0; i < S; i++) { const a = i / S * Math.PI * 2, wob = 1 + (rnd() - 0.5) * 0.12; at(x + Math.cos(a) * br * f * wob, z + Math.sin(a) * br * f * wob, e); col.push(...cc); }
      }
      for (let i = 0; i < S; i++) idx.push(o, o + 1 + i, o + 1 + (i + 1) % S);
      for (let k = 0; k < 2; k++) for (let i = 0; i < S; i++) {
        const a = o + 1 + k * S + i, b = o + 1 + k * S + (i + 1) % S;
        idx.push(a, a + S, b + S, a, b + S, b);
      }
    }
  };
  if (kind === 'limb') bone((rnd() - 0.5) * 0.1 * mean, (rnd() - 0.5) * 0.1 * mean, 0.21 * mean);
  else if (kind === 'limb2') { bone(-0.3 * mean, -0.08 * mean, 0.21 * mean); bone(0.33 * mean, 0.14 * mean, 0.15 * mean); }
  else if (kind === 'gut') bone(0, rad[B / 4] * 0.62, 0.2 * mean, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [n.x, n.y, n.z]), 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // wound so that the front of it faces along n (two-sided, the back then shows the other way, lit from that side)
  const p0 = new THREE.Vector3().fromArray(pos, idx[0] * 3), p1 = new THREE.Vector3().fromArray(pos, idx[1] * 3), p2 = new THREE.Vector3().fromArray(pos, idx[2] * 3);
  if (p1.sub(p0).cross(p2.sub(p0)).dot(n) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, sealed ? charSectionMat : sectionMat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
