import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildWorld } from './world.js';
import { loadModels, getModel, modelNames } from './models.js';
import { Post } from './post.js';

// A turntable for looking at the models under the game's own sky, sun and post-processing.
// Open viewer.html, click a model, drag to orbit, wheel to zoom. Not part of the game.

const params = new URLSearchParams(location.search);
await Promise.all([RAPIER.init(), loadModels(params.get('glb') || undefined)]);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 400);
const post = new Post(renderer);
const ctx = { scene, renderer, world: new RAPIER.World({ x: 0, y: -9.81, z: 0 }) };
buildWorld(ctx);

const AT = new THREE.Vector3(4, 0, 9);          // a clear patch of the yard
const holder = new THREE.Group();
holder.position.copy(AT);
scene.add(holder);

const view = { az: 0.7, el: 0.35, dist: 1, target: new THREE.Vector3(), names: [] };

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  const pr = renderer.getPixelRatio();
  post.setSize(Math.max(2, Math.floor(w * pr)), Math.max(2, Math.floor(h * pr)));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function render() {
  const { az, el, dist, target } = view;
  camera.position.set(
    target.x + dist * Math.cos(el) * Math.sin(az),
    target.y + dist * Math.sin(el),
    target.z + dist * Math.cos(el) * Math.cos(az));
  camera.lookAt(target);
  ctx.sun.target.position.copy(target);
  ctx.sun.position.copy(target).add(ctx.sunOffset);
  ctx.sun.target.updateMatrixWorld();
  post.render(scene, camera, false);
}

/** Put one or more models on show. opts: az, el (radians), dist (metres), lift (height off the ground), gap. */
function show(names, opts = {}) {
  if (typeof names === 'string') names = [names];
  holder.clear();
  let x = 0;
  const box = new THREE.Box3();
  const all = new THREE.Box3();
  for (const n of names) {
    const m = getModel(n);
    if (!m) continue;
    box.setFromObject(m);
    const w = box.max.x - box.min.x;
    m.position.set(x - box.min.x, opts.lift !== undefined ? opts.lift : -box.min.y, 0);
    x += w + (opts.gap ?? 0.1);
    holder.add(m);
  }
  holder.updateMatrixWorld(true);
  all.setFromObject(holder);
  all.getCenter(view.target);
  const size = all.getSize(new THREE.Vector3()).length();
  view.dist = opts.dist ?? size * 1.5;
  view.az = opts.az ?? view.az;
  view.el = opts.el ?? view.el;
  if (opts.fov) { camera.fov = opts.fov; camera.updateProjectionMatrix(); }
  view.names = names;
  for (const b of document.querySelectorAll('#bar button')) b.classList.toggle('on', names.includes(b.textContent));
  render();
  return { shown: holder.children.length, size: +size.toFixed(3) };
}

// ---- controls
const bar = document.getElementById('bar');
for (const n of modelNames().sort()) {
  const b = document.createElement('button');
  b.textContent = n;
  b.onclick = () => show(n);
  bar.appendChild(b);
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.az -= (e.clientX - drag[0]) * 0.008;
  view.el = Math.min(1.5, Math.max(-1.2, view.el + (e.clientY - drag[1]) * 0.008));
  drag = [e.clientX, e.clientY];
  render();
});
canvas.addEventListener('wheel', (e) => { view.dist *= Math.exp(e.deltaY * 0.001); render(); });
window.addEventListener('resize', () => { resize(); render(); });

resize();
window.__view = { show, render, view, scene, camera, renderer, post, names: modelNames };
show(params.get('m') || modelNames()[0] || 'Pistol');
