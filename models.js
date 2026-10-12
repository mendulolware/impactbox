import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { detail } from './detail.js';

// Models are authored in Blender (models/build_models.py) and exported to one GLB.
// Each top-level node is one model, looked up by its Blender object name.
//
// The GLB carries shape, colour and three things baked into the vertices:
//   colour RGB  - shading: creases and contact lines are darker (ambient occlusion) plus grime
//   colour A    - wear: 1 = intact, lower = the finish has rubbed off (edges and corners)
//   uv          - texture coordinates in metres
// On top of that this file lays a fine tiling surface (detail.js) chosen by each material in
// Blender, and teaches the shader to show bare metal or raw wood where the finish is worn.
const library = new Map();
const materials = new Map();

/** Worn edges: where vertex alpha is low, swap the finish for what is underneath it. */
function addWear(m, w) {
  const u = { color: { value: new THREE.Color(w[0], w[1], w[2]) }, metal: { value: w[3] }, rough: { value: w[4] } };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWearColor = u.color;
    shader.uniforms.uWearMetal = u.metal;
    shader.uniforms.uWearRough = u.rough;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uWearColor; uniform float uWearMetal; uniform float uWearRough;')
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        #ifdef USE_COLOR_ALPHA
          float wearRaw = 1.0 - vColor.a;
          #ifdef USE_ROUGHNESSMAP
            wearRaw *= 0.55 + 1.5 * (texelRoughness.g - 0.5);                  // break the edge up at texture resolution
          #endif
          float wearK = smoothstep(0.25, 0.6, wearRaw);
          diffuseColor.rgb = mix(diffuseColor.rgb, uWearColor * (0.55 + 0.45 * vColor.rgb), wearK);
          metalnessFactor = mix(metalnessFactor, uWearMetal, wearK);
          roughnessFactor = mix(roughnessFactor, uWearRough, wearK);
        #endif`);
  };
  m.customProgramCacheKey = () => 'wear';
}

/** The body models carry `_skin` = (bone A, bone B, weight of A) per vertex; turn it into three.js skinning data. */
function addSkin(geo) {
  const a = geo.getAttribute('_skin');
  if (!a || geo.getAttribute('skinIndex')) return;
  const n = a.count, idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const wa = a.getZ(i);
    idx[i * 4] = Math.round(a.getX(i));
    idx[i * 4 + 1] = Math.round(a.getY(i));
    w[i * 4] = wa;
    w[i * 4 + 1] = 1 - wa;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
}

function enhance(m) {
  const ud = m.userData || {};
  const set = ud.detail && detail(ud.detail, ud.tile || 0.1);
  if (set) {
    m.map = set.map;
    m.normalMap = set.normalMap;
    m.roughnessMap = set.roughnessMap;
    m.normalScale = new THREE.Vector2(ud.bump ?? 1, ud.bump ?? 1);
  }
  if (ud.wear) addWear(m, ud.wear);
  m.needsUpdate = true;
}

export async function loadModels(url = 'assets/models.glb') {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      addSkin(o.geometry);
      if (materials.has(o.material.name)) return;
      enhance(o.material);
      materials.set(o.material.name, o.material);
    });
    for (const node of gltf.scene.children) {
      node.position.set(0, 0, 0); // Blender layout offsets are for viewing only
      library.set(node.name, node);
    }
  } catch (e) {
    console.warn('[impactbox] could not load models, falling back to primitive shapes', e);
  }
}

export const modelNames = () => [...library.keys()];

/**
 * The skinned pieces of one ragdoll body ('torso', 'uarmL', ...): [{ geometry, material }].
 * Their vertices are in the character's rest pose, feet at the origin; the caller binds them to bones.
 */
export function bodyPieces(part) {
  const src = library.get('Body_' + part);
  if (!src) return null;
  const out = [];
  src.traverse((o) => { if (o.isMesh) out.push({ geometry: o.geometry, material: o.material }); });
  return out;
}

/** The shared material with this Blender name (clone it before changing it). */
export const getMaterial = (name) => materials.get(name) || null;

const tinted = new Map();
/** A copy of a model material in another colour, keeping its surface detail. Cached. */
export function tintedMaterial(name, color) {
  const key = `${name}:${color}`;
  let m = tinted.get(key);
  if (!m) {
    const base = materials.get(name);
    m = base ? base.clone() : new THREE.MeshStandardMaterial({ roughness: 0.75 });
    m.color.set(color);
    m.name = name;
    tinted.set(key, m);
  }
  return m;
}

/**
 * Clone a model (geometry is shared). `tint` maps a Blender material name to a
 * replacement material, e.g. { Skin: someMaterial }. Returns null if missing.
 */
export function getModel(name, tint, shadows = true) {
  const src = library.get(name);
  if (!src) return null;
  const obj = src.clone(true);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = shadows;
    o.receiveShadow = shadows;
    if (tint && tint[o.material.name]) o.material = tint[o.material.name];
  });
  return obj;
}
