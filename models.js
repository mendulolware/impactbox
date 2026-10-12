import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

// Models are authored in Blender (models/build_models.py) and exported to one GLB.
// Each top-level node is one model, looked up by its Blender object name.
const library = new Map();

export async function loadModels(url = 'assets/models.glb') {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    for (const node of gltf.scene.children) {
      node.position.set(0, 0, 0); // Blender layout offsets are for viewing only
      library.set(node.name, node);
    }
  } catch (e) {
    console.warn('[impactbox] could not load models, falling back to primitive shapes', e);
  }
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
