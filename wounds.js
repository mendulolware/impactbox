import * as THREE from 'three';

// Real holes in bodies, Gorebox style.
//
// A wound is a sphere in the body part's local space. The part's skin materials are swapped for
// copies whose shader throws away every pixel inside a wound sphere, so the surface genuinely
// opens. What you then see through the opening is built the first time a part is hit:
//   - an inner wall: the same mesh drawn inside-out in dark flesh (the far side of the cavity)
//   - a meat core: the same mesh shrunk, with slightly narrower holes, so the wound has depth
//   - innards: ribs, spine, lungs, heart, gut, brain, limb bones
// Hits that land on an existing wound make it bigger instead of adding a new one.

export const MAX_WOUNDS = 12;
const CORE_SCALE = 0.82;

const WOUND_GLSL = `
uniform vec4 uWounds[${MAX_WOUNDS}];
uniform int uWoundCount;
uniform float uPosScale;     // mesh-local -> part-local (the meat core is a shrunk copy)
uniform float uHoleScale;    // deeper layers get narrower holes
varying vec3 vWPos;
// distance to the nearest wound, in wound radii (< 1 means inside the hole)
float woundDist() {
  vec3 p = vWPos * uPosScale;
  float best = 1e9;
  for (int i = 0; i < ${MAX_WOUNDS}; i++) {
    if (i >= uWoundCount) break;
    best = min(best, length(p - uWounds[i].xyz) / (uWounds[i].w * uHoleScale));
  }
  // torn, uneven edge instead of a perfect circle
  return best + 0.2 * sin(p.x * 173.0 + p.y * 61.0) * sin(p.y * 149.0 + 1.7) * sin(p.z * 157.0 + 0.6);
}`;

/** Copy of a material whose shader cuts wound holes and bloodies the skin around them. */
function woundMaterial(base, uniforms, { posScale = 1, holeScale = 1, rim = true } = {}) {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWounds = uniforms.wounds;
    shader.uniforms.uWoundCount = uniforms.count;
    shader.uniforms.uPosScale = { value: posScale };
    shader.uniforms.uHoleScale = { value: holeScale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WOUND_GLSL)
      .replace('#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nfloat wd = woundDist();\nif (wd < 1.0) discard;')
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n' + (rim
          ? 'diffuseColor.rgb = mix(vec3(0.17, 0.0, 0.0), diffuseColor.rgb, smoothstep(1.0, 2.0, wd));'
          : ''));
  };
  m.customProgramCacheKey = () => 'wound' + (rim ? 1 : 0);
  return m;
}

// ---- shared innards -------------------------------------------------------------------------
const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.35, side: THREE.BackSide });
const meatMat = new THREE.MeshStandardMaterial({ color: 0x7c0d0d, roughness: 0.28 });
const boneMat = new THREE.MeshStandardMaterial({ color: 0xded6c0, roughness: 0.55 });
const lungMat = new THREE.MeshStandardMaterial({ color: 0xa8494a, roughness: 0.3 });
const heartMat = new THREE.MeshStandardMaterial({ color: 0x5a0a10, roughness: 0.25 });
const gutMat = new THREE.MeshStandardMaterial({ color: 0x9a4a3c, roughness: 0.3 });
const brainMat = new THREE.MeshStandardMaterial({ color: 0xc08a86, roughness: 0.35 });

const ballGeo = new THREE.IcosahedronGeometry(1, 1);
const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const ribGeo = new THREE.TorusGeometry(1, 0.09, 5, 16);

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

/** What is inside a given body part. Character faces -Z, so +Z is the back. */
function innards(name) {
  const g = new THREE.Group();
  if (name === 'torso') {
    g.add(rod(boneMat, 0, 0, 0.05, 0.02, 0.42));                               // spine
    for (let i = 0; i < 6; i++) {                                               // rib cage
      const rib = new THREE.Mesh(ribGeo, boneMat);
      rib.rotation.x = Math.PI / 2;
      rib.position.set(0, 0.17 - i * 0.045, 0.0);
      rib.scale.set(0.118 - i * 0.004, 0.07, 0.1);
      g.add(rib);
    }
    g.add(lump(lungMat, 0.055, 0.08, -0.005, 0.045, 0.075, 0.045));
    g.add(lump(lungMat, -0.055, 0.08, -0.005, 0.045, 0.075, 0.045));
    g.add(lump(heartMat, 0.015, 0.06, -0.03, 0.03, 0.036, 0.028));
    g.add(lump(gutMat, 0, -0.12, -0.005, 0.085, 0.07, 0.055));
  } else if (name === 'pelvis') {
    g.add(lump(boneMat, 0, 0, 0.01, 0.11, 0.04, 0.05));                        // hip bone
    g.add(lump(gutMat, 0, 0.02, -0.02, 0.09, 0.05, 0.05));
  } else if (name === 'head') {
    g.add(lump(brainMat, 0, 0.03, 0.005, 0.055, 0.05, 0.068));
    g.add(lump(boneMat, 0, -0.06, -0.03, 0.04, 0.02, 0.04));                   // jaw
  } else {
    const thick = name.startsWith('thigh') ? 0.017 : name.startsWith('shin') ? 0.014 : 0.011;
    const len = name.startsWith('thigh') || name.startsWith('shin') ? 0.44 : 0.3;
    g.add(rod(boneMat, 0, 0, 0, thick, len));                                   // limb bone
  }
  return g;
}

/** Swap in the hole-cutting materials and build the inside of a part. Runs once per part. */
function prepare(part) {
  const uniforms = {
    wounds: { value: Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4(0, 0, 0, 1)) },
    count: { value: 0 },
  };
  part.wounds = { uniforms, list: [] };
  for (const s of part.skin) {
    const base = s.mesh.material;
    s.mesh.material = woundMaterial(base, uniforms);
    if (!s.body) continue; // hair, eyes, shoes: holes only, nothing behind them
    const wall = new THREE.Mesh(s.mesh.geometry, woundMaterial(wallMat, uniforms, { rim: false }));
    const core = new THREE.Mesh(s.mesh.geometry,
      woundMaterial(meatMat, uniforms, { posScale: CORE_SCALE, holeScale: 0.72, rim: false }));
    core.scale.setScalar(CORE_SCALE);
    part.mesh.add(wall, core);
  }
  part.mesh.add(innards(part.name));
}

/**
 * Open (or widen) a hole in a body part.
 * @param part    ragdoll part: { name, mesh, skin: [{ mesh, body }] }
 * @param p       wound centre in the part's local space
 * @param radius  hole radius in metres
 * @param maxR    how big repeated hits may make one hole
 */
export function openWound(part, p, radius, maxR = 0.1) {
  if (!part.wounds) prepare(part);
  const { uniforms, list } = part.wounds;

  // a hit on an existing wound tears it wider
  for (const w of list) {
    const d = Math.hypot(w.x - p.x, w.y - p.y, w.z - p.z);
    if (d < (w.w + radius) * 0.8) {
      const grown = Math.min(maxR, Math.sqrt(w.w * w.w + radius * radius * 0.9));
      const k = 0.3 * (radius / grown);
      w.set(w.x + (p.x - w.x) * k, w.y + (p.y - w.y) * k, w.z + (p.z - w.z) * k, grown);
      return w;
    }
  }
  let w;
  if (list.length < MAX_WOUNDS) {
    w = uniforms.wounds.value[list.length];
    list.push(w);
  } else {
    w = list.shift(); // out of slots: the oldest wound closes
    list.push(w);
  }
  w.set(p.x, p.y, p.z, Math.min(radius, maxR));
  uniforms.count.value = list.length;
  return w;
}
