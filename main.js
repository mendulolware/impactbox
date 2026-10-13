import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initAudio, sfx } from './audio.js';
import { Gore } from './gore.js';
import { Ragdoll, selfCollide } from './ragdoll.js';
import { tickWounds } from './wounds.js';
import { Prop, PROP_TYPES } from './props.js';
import { Player } from './player.js';
import { Weapons, WEAPONS } from './weapons.js';
import { buildWorld } from './world.js';
import { loadModels } from './models.js';
import { Post } from './post.js';

const $ = (id) => document.getElementById(id);
const MAX_RAGDOLLS = 36;

await Promise.all([RAPIER.init(), loadModels()]);

// ------------------------------------------------------------------ renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
scene.add(camera);

// ---- picture pipeline: ambient occlusion, bloom and grading (post.js)
const post = new Post(renderer);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  const pr = renderer.getPixelRatio();
  post.setSize(Math.max(2, Math.floor(w * pr)), Math.max(2, Math.floor(h * pr)));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ physics + context
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.numSolverIterations = 8;

// Parts of the same NPC collide with each other unless they share a joint (ragdoll.js decides),
// so an arm lies on a chest instead of in it and legs do not pass through each other.
const eventQueue = new RAPIER.EventQueue(true); // Rapier only runs hooks when a queue is passed
const physicsHooks = {
  filterContactPair(c1, c2) {
    const a = ctx.owners.get(c1), b = ctx.owners.get(c2);
    if (a && b && a.kind === 'part' && b.kind === 'part' && a.ragdoll === b.ragdoll && !selfCollide(a.name, b.name)) return null;
    return RAPIER.SolverFlags.COMPUTE_IMPULSE;
  },
  filterIntersectionPair() { return true; },
};

const input = { keys: new Set(), left: false, right: false, leftDown: false, rightDown: false, wheel: 0, mx: 0, my: 0 };

const ctx = {
  scene, camera, renderer, world, input, sfx,
  owners: new Map(),   // collider handle -> { kind:'part'|'prop', ... }
  ragdolls: [],
  props: [],
  timers: [],
  kills: 0,
  timeScale: 1,
  menuOpen: false,
};
window.__game = ctx; // handy for debugging in the console

ctx.gore = new Gore(ctx);
buildWorld(ctx);
ctx.player = new Player(ctx, { x: 0, y: 1.0, z: 14 });
ctx.weapons = new Weapons(ctx);

ctx.later = (sec, fn) => ctx.timers.push({ t: sec, fn });

// Tell every living NPC that something happened; each brain decides whether it noticed and cares.
ctx.alert = (type, pos, radius) => {
  for (const r of ctx.ragdolls) if (!r.removed && !r.dead) r.brain.notice(type, pos, radius);
};

ctx.raycast = (origin, dir, maxT = 200) => {
  const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
  return world.castRayAndGetNormal(ray, maxT, true, undefined, undefined, ctx.player.collider);
};

ctx.applyHit = (hit, point, dir, dmg, impulse, opts = {}) => {
  const owner = ctx.owners.get(hit.collider.handle);
  if (owner?.kind === 'part') {
    owner.ragdoll.hit(owner.name, dmg, point, dir, impulse, { ...opts, normal: hit.normal });
  } else if (owner?.kind === 'chunk') {
    owner.body.applyImpulse({ x: dir.x * 2, y: dir.y * 2 + 1, z: dir.z * 2 }, true);
    ctx.gore.blood(point, dir, 5, 3, 0.8);
  } else if (owner?.kind === 'prop') {
    owner.prop.hit(dmg, point, dir, impulse, opts);
  } else {
    const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    ctx.gore.sparks(point, n, 5);
    ctx.gore.bulletHole(point, n);
    sfx.thud(0.5);
  }
};

ctx.spawnRagdoll = (pos, yaw = 0, opts = {}) => {
  // keep the count bounded: drop the oldest (dead ones first)
  const live = ctx.ragdolls.filter((r) => !r.removed);
  if (live.length >= MAX_RAGDOLLS) {
    const victim = live.find((r) => r.dead) || live[0];
    victim.destroy();
  }
  const r = new Ragdoll(ctx, pos, yaw, opts);
  ctx.ragdolls.push(r);
  return r;
};

ctx.spawnProp = (type, pos, rotY = 0) => {
  const p = new Prop(ctx, type, pos, rotY);
  ctx.props.push(p);
  return p;
};

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

ctx.explode = (p, radius = 7, power = 1) => {
  ctx.gore.explosion(p, radius);
  sfx.explosion();
  ctx.alert('explosion', p, 45);
  const center = new THREE.Vector3(p.x, p.y, p.z);

  for (const r of ctx.ragdolls) {
    if (r.removed) continue;
    for (const name in r.parts) {
      const part = r.parts[name];
      if (part.gone) continue;
      const t = part.body.translation();
      _v.set(t.x, t.y, t.z);
      const dist = _v.distanceTo(center);
      if (dist > radius) continue;
      const f = 1 - dist / radius;
      _d.copy(_v).sub(center);
      _d.y += 0.5;
      _d.normalize();
      r.goLimp(2.5); // animated NPCs must become physical before they can be thrown
      const m = part.body.mass();
      // thrown metres, not out of the arena: what a blast does to a body is tear it, not launch it
      part.body.applyImpulse({ x: _d.x * m * 7.5 * f * power, y: _d.y * m * 7.5 * f * power, z: _d.z * m * 7.5 * f * power }, true);
      r.hit(name, 105 * f * power, _v.clone(), _d.clone(), 0, { explosion: true, heat: f });
    }
  }

  for (const pr of ctx.props) {
    if (pr.removed) continue;
    const t = pr.body.translation();
    _v.set(t.x, t.y, t.z);
    const dist = _v.distanceTo(center);
    if (dist > radius || dist < 0.01) continue;
    const f = 1 - dist / radius;
    _d.copy(_v).sub(center);
    _d.y += 0.4;
    _d.normalize();
    const m = pr.body.mass();
    pr.body.applyImpulse({ x: _d.x * m * 20 * f * power, y: _d.y * m * 20 * f * power, z: _d.z * m * 20 * f * power }, true);
    if (pr.hp !== Infinity) {
      pr.hp -= 90 * f * power;
      if (pr.hp <= 0) pr.destroyed();
    }
  }

  const pl = ctx.player;
  const pd = pl.pos.distanceTo(center);
  if (pd < radius) {
    const f = 1 - pd / radius;
    _d.copy(pl.pos).sub(center);
    _d.y += 0.5;
    _d.normalize();
    pl.vel.addScaledVector(_d, 16 * f);
    pl.grounded = false;
    pl.hurt(70 * f * power, null);
  }
};

const KILL_TEXT = {
  headshot: 'HEADSHOT', decap: 'DECAPITATED', bisect: 'BISECTED', gib: 'OBLITERATED', torso: 'TORSO SHOT', pelvis: 'GUT SHOT',
  bled: 'BLED OUT', impact: 'SKULL CRACKED',
};
ctx.onKill = (rag, cause) => {
  ctx.kills++;
  toast(KILL_TEXT[cause] || 'KILLED');
};

ctx.toast = (msg) => toast(msg);
let toastT = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  toastT = 1.1;
}

// ------------------------------------------------------------------ spawning helpers
function spawnPoint() {
  camera.getWorldPosition(_v);
  camera.getWorldDirection(_d);
  const hit = ctx.raycast(_v, _d, 40);
  if (hit) {
    const p = _v.clone().addScaledVector(_d, hit.timeOfImpact);
    p.y += 0.05;
    return p;
  }
  const p = _v.clone().addScaledVector(_d, 8);
  p.y = Math.max(p.y, 0.5);
  return p;
}

const FACE_PLAYER = () => ctx.player.yaw + Math.PI;

function clearAll() {
  ctx.weapons.releaseGrab();
  for (const r of ctx.ragdolls) r.destroy();
  for (const p of ctx.props) p.remove();
  ctx.ragdolls.length = 0;
  ctx.props.length = 0;
  ctx.gore.clear();
}

function deleteTarget() {
  const w = ctx.weapons;
  if (w.grab) {
    const h = w.grab.body.collider(0)?.handle;
    const owner = ctx.owners.get(h);
    w.releaseGrab();
    if (owner?.kind === 'part') owner.ragdoll.destroy();
    else if (owner?.kind === 'prop') owner.prop.remove();
    return;
  }
  camera.getWorldPosition(_v);
  camera.getWorldDirection(_d);
  const hit = ctx.raycast(_v, _d, 60);
  if (!hit) return;
  const owner = ctx.owners.get(hit.collider.handle);
  if (owner?.kind === 'part') owner.ragdoll.destroy();
  else if (owner?.kind === 'prop') owner.prop.remove();
  else return;
  sfx.pop();
}

const SPAWN_ITEMS = [
  { cat: 'NPCs', label: 'Civilian', icon: '🧍', small: 'flees, surrenders', run: () => ctx.spawnRagdoll(spawnPoint(), FACE_PLAYER()) },
  { cat: 'NPCs', label: 'Thug', icon: '🥊', small: 'fights back', run: () => ctx.spawnRagdoll(spawnPoint(), FACE_PLAYER(), { kind: 'thug' }) },
  { cat: 'NPCs', label: 'Zombie', icon: '🧟', small: 'hunts and infects', run: () => ctx.spawnRagdoll(spawnPoint(), FACE_PLAYER(), { kind: 'zombie' }) },
  {
    cat: 'NPCs', label: 'Crowd x8', icon: '👥', small: 'ring of humans', run: () => {
      const c = spawnPoint();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.spawnRagdoll({ x: c.x + Math.cos(a) * 2.5, y: c.y, z: c.z + Math.sin(a) * 2.5 }, a + Math.PI / 2);
      }
    },
  },
  {
    cat: 'NPCs', label: 'Drop 5', icon: '🪂', small: 'rain from above', run: () => {
      const c = spawnPoint();
      for (let i = 0; i < 5; i++) {
        ctx.spawnRagdoll({ x: c.x + (Math.random() - 0.5) * 3, y: c.y + 6 + i * 2.2, z: c.z + (Math.random() - 0.5) * 3 }, Math.random() * 6, { limp: 3 });
      }
    },
  },
  ...['crate', 'barrel', 'explosive', 'propane', 'ball', 'block', 'plank', 'pallet', 'chair', 'table', 'toilet',
    'cone', 'sandbags', 'dumpster', 'lamp', 'car'].map((t) => ({
    cat: 'Props', label: PROP_TYPES[t].label, icon: PROP_TYPES[t].icon, small: PROP_TYPES[t].explosive ? 'explodes' : '',
    run: () => {
      // set it down on its base, facing the way the player faces
      const d = PROP_TYPES[t];
      const p = spawnPoint();
      p.y += (d.half ? d.half[1] : d.h || d.r) + 0.08;
      ctx.spawnProp(t, p, d.shape === 'box' ? ctx.player.yaw : Math.random() * 6);
    },
  })),
  {
    cat: 'Props', label: 'Crate Wall', icon: '🧱', small: 'knock it down', run: () => {
      const c = spawnPoint();
      const yaw = ctx.player.yaw;
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) {
        const off = (col - 2.5) * 0.62;
        ctx.spawnProp('crate', { x: c.x + rx * off, y: c.y + 0.32 + row * 0.62, z: c.z + rz * off }, yaw);
      }
    },
  },
  {
    cat: 'Props', label: 'Barrel Pile', icon: '🛢️', small: 'mixed, some explode', run: () => {
      const c = spawnPoint();
      for (let i = 0; i < 7; i++) {
        ctx.spawnProp(i % 3 === 0 ? 'explosive' : 'barrel', { x: c.x + (Math.random() - 0.5) * 2, y: c.y + 0.5 + i * 0.9, z: c.z + (Math.random() - 0.5) * 2 }, Math.random() * 6);
      }
    },
  },
  { cat: 'World', label: 'Explosion', icon: '☄️', small: 'at crosshair', run: () => ctx.explode(spawnPoint(), 8, 1.3) },
  { cat: 'World', label: 'Kill All', icon: '☠️', small: 'every NPC', run: () => { for (const r of ctx.ragdolls) r.damage(1000); } },
  { cat: 'World', label: 'Clean Blood', icon: '🧽', small: 'decals + particles', run: () => ctx.gore.clear() },
  { cat: 'World', label: 'Clear All', icon: '🗑️', small: 'wipe the sandbox', run: clearAll },
  { cat: 'World', label: 'Slow-mo', icon: '⏳', small: 'toggle (T)', run: () => toggleSlowmo() },
  { cat: 'World', label: 'Helmet Cam', icon: '📹', small: 'toggle (V)', run: () => toggleHelmet() },
  { cat: 'World', label: 'Graphics', icon: '✨', small: 'high / fast (G)', run: () => toggleGraphics() },
];

function buildMenu() {
  const body = $('menu-body');
  let cat = null, grid = null;
  for (const it of SPAWN_ITEMS) {
    if (it.cat !== cat) {
      cat = it.cat;
      const h = document.createElement('div');
      h.className = 'cat'; h.textContent = cat;
      grid = document.createElement('div');
      grid.className = 'grid';
      body.append(h, grid);
    }
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<span class="ico">${it.icon}</span>${it.label}<small>${it.small || '&nbsp;'}</small>`;
    el.addEventListener('click', () => { it.run(); sfx.pop(); });
    grid.appendChild(el);
  }
}
buildMenu();

const crosshairEl = $('crosshair');
const healthEl = $('health-fill');
const hurtEl = $('hurt');
let wasDead = false;
const camTimeEl = $('cam-time');
let camClock = 0;
ctx.helmet = false;
function toggleHelmet() {
  ctx.helmet = !ctx.helmet;
  document.body.classList.toggle('helmet', ctx.helmet);
  camClock = 0;
  sfx.tick();
}

// G: switch the effects pipeline off on slow machines (plain rendering, no occlusion or bloom)
function toggleGraphics() {
  post.enabled = !post.enabled;
  toast(post.enabled ? 'GRAPHICS: HIGH' : 'GRAPHICS: FAST');
}

function toggleSlowmo() {
  ctx.timeScale = ctx.timeScale === 1 ? 0.2 : 1;
  $('slowmo').classList.toggle('on', ctx.timeScale !== 1);
}

function setMenu(open) {
  ctx.menuOpen = open;
  $('menu').classList.toggle('hidden', !open);
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    input.left = input.right = false;
  } else {
    canvas.requestPointerLock?.();
  }
}

// ------------------------------------------------------------------ input / pointer lock
let started = false;
let lockFallback = false;

function gameActive() { return started && !ctx.menuOpen; }

$('play').addEventListener('click', () => {
  initAudio();
  started = true;
  $('start').classList.add('hidden');
  const p = canvas.requestPointerLock?.();
  if (p && p.catch) p.catch(() => { lockFallback = true; });
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && started && !ctx.menuOpen && !lockFallback) {
    $('start').classList.remove('hidden');
    $('play').textContent = 'Click to resume';
    started = false;
    input.keys.clear();
    input.left = input.right = false;
  }
});
document.addEventListener('pointerlockerror', () => { lockFallback = true; });

document.addEventListener('mousemove', (e) => {
  if (!gameActive()) return;
  if (document.pointerLockElement === canvas || lockFallback) {
    // knife out with a button held: the mouse is your arm, not your head
    if (ctx.weapons.handMode) ctx.weapons.handMove(e.movementX, e.movementY);
    else ctx.player.look(e.movementX, e.movementY);
    input.mx += e.movementX;
    input.my += e.movementY;
  }
});

document.addEventListener('mousedown', (e) => {
  if (!gameActive()) return;
  if (e.button === 0) { input.left = true; input.leftDown = true; }
  if (e.button === 2) { input.right = true; input.rightDown = true; }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.left = false;
  if (e.button === 2) input.right = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => { if (gameActive()) input.wheel += Math.sign(e.deltaY); }, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyQ' || e.code === 'Tab') {
    if (started || ctx.menuOpen) { e.preventDefault(); setMenu(!ctx.menuOpen); }
    return;
  }
  if (e.code === 'Escape' && ctx.menuOpen) { setMenu(false); return; }
  if (!gameActive()) return;
  input.keys.add(e.code);
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    const slot = n === 0 ? 9 : n - 1;           // 1-9, then 0 is the tenth
    if (slot < WEAPONS.length) ctx.weapons.select(slot);
  }
  if (e.code === 'Minus' && WEAPONS.length > 10) ctx.weapons.select(10);
  if (e.code === 'KeyT') toggleSlowmo();
  if (e.code === 'KeyV') toggleHelmet();
  if (e.code === 'KeyG') toggleGraphics();
  if (e.code === 'KeyX') deleteTarget();
  if (e.code === 'KeyC') { clearAll(); toast('CLEARED'); }
});
document.addEventListener('keyup', (e) => input.keys.delete(e.code));
window.addEventListener('blur', () => { input.keys.clear(); input.left = input.right = false; });

// ------------------------------------------------------------------ starting scene
function populate() {
  for (let i = 0; i < 5; i++) {
    ctx.spawnRagdoll({ x: -8 + i * 4, y: 0.05, z: -4 - (i % 2) * 3 }, Math.random() * 6);
  }
  ctx.spawnRagdoll({ x: 3, y: 0.05, z: -14 }, 0, { kind: 'thug' });
  for (let i = 0; i < 4; i++) ctx.spawnProp('crate', { x: 9 + (i % 2) * 0.65, y: 0.32 + Math.floor(i / 2) * 0.62, z: 4 }, 0);
  ctx.spawnProp('explosive', { x: -4, y: 0.5, z: 1 });
  ctx.spawnProp('explosive', { x: 10, y: 0.5, z: -3 });
  ctx.spawnProp('barrel', { x: -5.2, y: 0.5, z: 1.2 });
  ctx.spawnProp('ball', { x: 2, y: 1.0, z: 8 });

  // the yard: parked cars, bins, lamps, a sandbag position, pallets and cones
  const at = (type, x, z, yaw = 0, lift = 0) => {
    const d = PROP_TYPES[type];
    return ctx.spawnProp(type, { x, y: (d.half ? d.half[1] : d.h || d.r) + 0.03 + lift, z }, yaw);
  };
  at('car', -27.3, 31, 0.04);
  at('car', -19.2, 31, Math.PI - 0.06);
  at('car', 24.7, 20, 0.02);
  at('dumpster', -38.6, 14, Math.PI / 2);
  at('dumpster', -38.6, 10.6, Math.PI / 2 + 0.08);
  at('dumpster', 30, -38.9, 0);
  for (const [x, z] of [[-39.5, 30], [-39.5, -2], [39.5, 30], [39.5, -2], [-12, -40], [18, -40]]) at('lamp', x, z, Math.atan2(-x, -z));
  for (let i = 0; i < 3; i++) at('sandbags', -22 + i * 1.95, 2, 0);
  for (let i = 0; i < 2; i++) at('sandbags', -21 + i * 1.95, 2, 0, 0.55);
  at('pallet', 15, 8, 0.3); at('pallet', 15, 8, 0.25, 0.16); at('pallet', 16.6, 9.2, 1.2);
  at('crate', 15, 8, 0.4, 0.34);
  at('propane', 17.6, 7.4); at('propane', 18.1, 7.8);
  for (const [x, z] of [[-3, 12], [-1.4, 12.6], [0.3, 12.2], [5, -6], [6.2, -7.4]]) at('cone', x, z);
  at('table', -12, 14, 0.2); at('chair', -12.9, 14.3, 1.4); at('chair', -11.2, 13.4, -1.9);
  at('toilet', 37.5, 39.5, Math.PI);
}
populate();

// ------------------------------------------------------------------ main loop
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fps = 60;
const statsEl = $('stats');
let statsT = 0;

let crashed = false;
function frame(now) {
  requestAnimationFrame(frame);
  if (crashed) return;
  if (ctx.frozen) {                       // debugging: time stands still, the free camera keeps drawing
    if (ctx.view === 'fp') post.render(scene, camera, ctx.helmet);     // the player's own view, held still
    else if (ctx.view) ctx.debugView(...ctx.view);
    return;
  }
  try { tick(now); } catch (e) {
    // a wasm panic leaves the physics world unusable, so stop instead of spamming the console
    crashed = true;
    console.error('[impactbox] fatal error, simulation stopped:', e);
    toast('SIMULATION CRASHED - reload the page');
    toastT = 1e9;
  }
}

// debugging aid: advance the game n frames from the console (works even when the tab is throttled)
ctx.debugStep = (n = 1) => { for (let i = 0; i < n; i++) tick(last + 1000 / 60); last = performance.now(); };
/** Debugging: draw one frame from a free camera (no weapon in view) without advancing the game. */
ctx.debugView = (from, at, fov = 40) => {
  ctx.view = [from, at, fov];
  const keep = camera.fov;
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.position.set(from[0], from[1], from[2]);
  camera.lookAt(at[0], at[1], at[2]);
  ctx.weapons.pivot.visible = false;
  post.render(scene, camera, false);
  ctx.weapons.pivot.visible = true;
  camera.fov = keep;
  camera.updateProjectionMatrix();
};

function tick(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  const sdt = dt * ctx.timeScale;

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  const active = gameActive() && !ctx.player.dead;
  ctx.player.update(sdt, input, active, dt);
  if (active) ctx.weapons.update(dt, input);

  // timers (run in sim time so slow-mo stretches fuses and chain reactions)
  for (let i = ctx.timers.length - 1; i >= 0; i--) {
    const t = ctx.timers[i];
    t.t -= sdt;
    if (t.t <= 0) { ctx.timers.splice(i, 1); t.fn(); }
  }

  for (const r of ctx.ragdolls) r.update(sdt);
  for (const p of ctx.props) p.update(sdt);

  if (sdt > 0) {
    for (const r of ctx.ragdolls) r.preStep();
    const steps = Math.max(1, Math.ceil(sdt / (1 / 60)));
    world.timestep = sdt / steps;
    for (let i = 0; i < steps; i++) world.step(eventQueue, physicsHooks);
  }

  for (const r of ctx.ragdolls) r.sync();
  for (const p of ctx.props) p.sync();
  if (ctx.ragdolls.some((r) => r.removed)) ctx.ragdolls = ctx.ragdolls.filter((r) => !r.removed);
  if (ctx.props.some((p) => p.removed)) ctx.props = ctx.props.filter((p) => !p.removed);

  ctx.gore.update(sdt);
  tickWounds(sdt);

  // shadow camera follows the player
  const sun = ctx.sun;
  sun.target.position.set(Math.round(ctx.player.pos.x), 0, Math.round(ctx.player.pos.z));
  sun.position.copy(sun.target.position).add(ctx.sunOffset);

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }

  statsT -= dt;
  if (statsT <= 0) {
    statsT = 0.25;
    const alive = ctx.ragdolls.filter((r) => !r.dead).length;
    statsEl.textContent = `FPS ${fps}\nAlive ${alive}   Bodies ${ctx.ragdolls.length - alive}\nKills ${ctx.kills}`;
  }

  input.leftDown = false;
  input.rightDown = false;
  input.wheel = 0;
  input.mx = 0;
  input.my = 0;

  // health bar, red flash when hurt, and the death notice
  const pl = ctx.player;
  healthEl.style.width = pl.health + '%';
  healthEl.parentElement.classList.toggle('low', pl.health < 35);
  hurtEl.style.opacity = Math.min(0.85, pl.hurtFlash * 0.55 + (1 - pl.health / 100) * 0.4 + (pl.dead ? 0.5 : 0));
  if (pl.dead !== wasDead) { wasDead = pl.dead; if (pl.dead) { toast('YOU DIED'); toastT = 3; ctx.weapons.releaseGrab(); } }

  // crosshair is hidden while looking down the sights, and always in helmet cam
  crosshairEl.classList.toggle('hide', ctx.helmet || ctx.weapons.ads > 0.4);

  if (ctx.helmet) {
    camClock -= dt;
    if (camClock <= 0) {
      camClock = 0.5;
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      camTimeEl.textContent = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}  ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    }
  }
  ctx.sky.material.uniforms.uTime.value = now / 1000;   // clouds drift
  post.render(scene, camera, ctx.helmet);
}

$('loading').remove();
$('play').disabled = false;
requestAnimationFrame(frame);
