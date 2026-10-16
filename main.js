import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initAudio, setVolume, sfx, setSpace, deafen, bodycam, audioStream, setRain, hum } from './audio.js';
import { Gore } from './gore.js';
import { Ragdoll, selfCollide } from './ragdoll.js';
import { tickWounds, openWound, makeStump } from './wounds.js';
import { Prop, PROP_TYPES } from './props.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { buildWorld, loadMap } from './world.js';
import { MAPS, MAP_LIST } from './maps.js';
import { loadModels, looks } from './models.js';
import { Post } from './post.js';
import { Mission } from './mission.js';
import { Survival } from './survival.js';
import { initTouch, isTouch } from './touch.js';
import { Tools } from './tools.js';
import { makeTrap, TRAP_TYPES } from './traps.js';
import { Coop } from './coop.js';
import { Water } from './water.js';
import { Driving } from './drive.js';

const $ = (id) => document.getElementById(id);
const MAX_RAGDOLLS = isTouch ? 18 : 36;          // (phones: half the people)

await Promise.all([RAPIER.init(), loadModels()]);

// ------------------------------------------------------------------ renderer
const canvas = $('c');
// (phones: no multisampling on the screen itself; the picture is smoothed in post.js's own target anyway)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
const MAX_PR = Math.min(window.devicePixelRatio, isTouch ? 1.25 : 2);   // phones: fewer pixels to fill
renderer.setPixelRatio(MAX_PR);
renderer.shadowMap.enabled = true;                 // (the Graphics setting turns them off: phones start on Low)
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
world.numSolverIterations = isTouch ? 4 : 8;       // (phones: half the solving; ragdolls a touch softer)

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
  surfaces: new Map(), // map collider handle -> 'concrete' | 'planks' | 'metal' | 'brick' | 'asphalt' (world.js)
  ragdolls: [],
  props: [],
  timers: [],
  kills: 0,
  timeScale: 1,
  menuOpen: false,
};
window.__game = ctx; // handy for debugging in the console
ctx.post = post;     // (trailer.js draws its own frames)

ctx.gore = new Gore(ctx);
ctx.water = new Water(ctx);
ctx.driving = new Driving(ctx);
// which map to start on: ?map=street in the address, else the one played last, else the yard
let startMap = new URLSearchParams(location.search).get('map');
try { startMap = startMap || localStorage.getItem('impactbox.map'); } catch (e) { /* no storage */ }
buildWorld(ctx, MAPS[startMap] ? startMap : 'yard');
ctx.player = new Player(ctx, ctx.map.spawn);
ctx.player.yaw = ctx.player.camYaw = ctx.map.yaw;
setSpace(ctx.map.id);
ctx.weapons = new Weapons(ctx);
ctx.tools = new Tools(ctx);
ctx.traps = [];
ctx.post = post;

// ------------------------------------------------------------------ settings (kept in this browser)
const DEFAULTS = { sens: 1, fov: 75, volume: 1, scale: 1, quality: isTouch ? 'low' : 'high', invert: false, stats: true };
ctx.settings = { ...DEFAULTS };
try { Object.assign(ctx.settings, JSON.parse(localStorage.getItem('impactbox.settings') || '{}')); } catch (e) { /* no storage */ }
const SETTINGS_UI = [
  { id: 'sens', label: 'Look sensitivity', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + 'x' },
  { id: 'fov', label: 'Field of view', min: 60, max: 105, step: 1, fmt: (v) => v + '\u00b0' },
  { id: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
  { id: 'scale', label: 'Resolution', min: 0.5, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
  { id: 'quality', label: 'Graphics', options: ['low', 'medium', 'high'] },        // high: occlusion, glow, shadows; medium: shadows; low: none
  { id: 'invert', label: 'Invert look', toggle: true },
  { id: 'stats', label: 'FPS and counters', toggle: true },
];
function applySettings() {
  const s = ctx.settings;
  setVolume(s.volume);
  if (Math.abs(renderer.getPixelRatio() - MAX_PR * s.scale) > 0.01) { renderer.setPixelRatio(MAX_PR * s.scale); resize(); }
  post.lite = s.quality !== 'high';
  post.final.uniforms.uAoAmt.value = post.lite ? 0 : 0.85;
  const shadows = s.quality !== 'low';
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    scene.traverse((o) => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });   // (their shaders change)
  }
  $('stats').style.display = s.stats ? '' : 'none';
  try { localStorage.setItem('impactbox.settings', JSON.stringify(s)); } catch (e) { /* private window */ }
}
function buildSettings() {
  const body = $('settings-body');
  for (const it of SETTINGS_UI) {
    const row = document.createElement('div');
    row.className = 'srow';
    body.appendChild(row);
    if (it.options) {
      row.innerHTML = `<span>${it.label}</span><div class="seg">${it.options.map((o) => `<button data-v="${o}">${o}</button>`).join('')}</div>`;
      const mark = () => row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === ctx.settings[it.id]));
      row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { ctx.settings[it.id] = b.dataset.v; mark(); applySettings(); }));
      mark();
    } else if (it.toggle) {
      row.innerHTML = `<span>${it.label}</span><button class="tog"></button>`;
      const b = row.querySelector('button'), mark = () => b.classList.toggle('on', !!ctx.settings[it.id]);
      b.addEventListener('click', () => { ctx.settings[it.id] = !ctx.settings[it.id]; mark(); applySettings(); });
      mark();
    } else {
      row.innerHTML = `<span>${it.label}</span><input type="range" min="${it.min}" max="${it.max}" step="${it.step}"><output></output>`;
      const inp = row.querySelector('input'), out = row.querySelector('output');
      inp.value = ctx.settings[it.id];
      out.textContent = it.fmt(ctx.settings[it.id]);
      inp.addEventListener('input', () => { ctx.settings[it.id] = +inp.value; out.textContent = it.fmt(+inp.value); applySettings(); });
    }
  }
}
function setSettings(open) { $('settings').classList.toggle('hidden', !open); }
buildSettings();
applySettings();
$('settings-btn').addEventListener('click', () => setSettings(true));
$('set-close').addEventListener('click', () => setSettings(false));

ctx.later = (sec, fn) => ctx.timers.push({ t: sec, fn });

// Tell every living NPC that something happened; each brain decides whether it noticed and cares.
ctx.alert = (type, pos, radius) => {
  for (const r of ctx.ragdolls) if (!r.removed && !r.dead) r.brain.notice(type, pos, radius);
};

ctx.raycast = (origin, dir, maxT = 200) => {
  const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
  return world.castRayAndGetNormal(ray, maxT, true, undefined, undefined, ctx.player.collider);
};

/** A round has gone into `collider` at `point`: where it comes out the far side, or null if there is more than `pen` metres of it. */
ctx.exitPoint = (collider, point, dir, pen) => {
  const reach = pen + 0.02;
  const o = { x: point.x + dir.x * reach, y: point.y + dir.y * reach, z: point.z + dir.z * reach };
  const toi = collider.castRay(new RAPIER.Ray(o, { x: -dir.x, y: -dir.y, z: -dir.z }), reach, true);   // 0 = that far in is still inside it
  if (!(toi > 0) || reach - toi < 0.01) return null;
  return new THREE.Vector3(o.x - dir.x * (toi - 0.01), o.y - dir.y * (toi - 0.01), o.z - dir.z * (toi - 0.01));
};

ctx.applyHit = (hit, point, dir, dmg, impulse, opts = {}) => {
  ctx.soundAt = point;
  const owner = ctx.owners.get(hit.collider.handle);
  if (owner?.kind === 'part') {
    marker('hit');                       // (before the hit: a kill it causes turns it red)
    owner.ragdoll.shotAt = performance.now();
    owner.ragdoll.hit(owner.name, dmg, point, dir, impulse, { ...opts, normal: hit.normal });
  } else if (owner?.kind === 'chunk') {
    owner.body.applyImpulse({ x: dir.x * 2, y: dir.y * 2 + 1, z: dir.z * 2 }, true);
    ctx.gore.blood(point, dir, 5, 3, 0.8);
  } else if (owner?.kind === 'prop') {
    owner.prop.hit(dmg, point, dir, impulse, opts);
  } else if (owner?.kind === 'glass') {
    owner.pane.break(point);
  } else if (owner?.kind === 'lamp') {
    owner.lamp.out(point);
  } else if (owner?.kind === 'trap') {          // (no hole: a trap moves, or goes)
    ctx.gore.sparks(point, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), 6);
    sfx.impact('metal');
  } else if (owner?.kind === 'door') {
    ctx.gore.bulletHole(point, new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z));
    owner.door.shot(point, dmg);
    sfx.impact('planks');
  } else {
    const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    const kind = ctx.surfaces.get(hit.collider.handle) || 'concrete';
    if (kind === 'planks') ctx.gore.debris(point, 0xb08a5a, 4);          // splinters
    else ctx.gore.sparks(point, n, kind === 'metal' ? 8 : 5);
    ctx.gore.bulletHole(point, n);
    sfx.impact(kind);
  }
};

/**
 * Somewhere a person fits. A spawn aimed at a wall lands half inside it, and a body that goes limp inside a
 * wall is shoved out of it by the physics hard enough to explode: back the spot out toward the player until clear.
 */
function clearSpot(pos) {
  const shape = new RAPIER.Capsule(0.6, 0.28);
  const fits = (x, z) => {
    let inside = false;
    world.intersectionsWithShape({ x, y: pos.y + 0.95, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, () => { inside = true; return false; }, RAPIER.QueryFilterFlags.ONLY_FIXED);
    return !inside;
  };
  if (fits(pos.x, pos.z)) return pos;
  // toward the player first, then round the compass, a little further each time
  const a0 = Math.atan2(ctx.player.pos.x - pos.x, ctx.player.pos.z - pos.z);
  for (let d = 0.1; d <= 2; d += 0.1) {
    for (let k = 0; k < 8; k++) {
      const a = a0 + k * Math.PI / 4, x = pos.x + Math.sin(a) * d, z = pos.z + Math.cos(a) * d;
      if (fits(x, z)) return new THREE.Vector3(x, pos.y, z);
    }
  }
  return pos;                                     // nowhere clear within 2 m: as asked
}

ctx.spawnRagdoll = (pos, yaw = 0, opts = {}) => {
  pos = clearSpot(pos);
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

ctx.spawnTrap = (type, pos, yaw = 0) => {
  const t = makeTrap(ctx, type, pos, yaw);
  ctx.traps.push(t);
  return t;
};

ctx.spawnProp = (type, pos, rotY = 0) => {
  const p = new Prop(ctx, type, pos, rotY);
  ctx.props.push(p);
  return p;
};

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

/** A flashbang going off: a white-out and ringing for whoever looks at it, and anyone near it stops fighting for a while. */
ctx.flashbang = (p) => {
  ctx.soundAt = p;
  sfx.revolver(); sfx.crack();
  const g = ctx.gore;
  g.flash.position.set(p.x, p.y + 0.3, p.z); g.flash.intensity = 700; g.flashT = 0.35;
  for (let i = 0; i < 10; i++) g.smoke.emit(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2, 0.25 + Math.random() * 0.2, 2 + Math.random() * 2, -0.1, 0.8, 0.8, 0.8, 0, 1.5);
  ctx.flashPlayer(p);
  for (const rp of ctx.remotes || []) rp.flash(p);
  for (const r of ctx.ragdolls) {
    if (r.removed || r.dead) continue;
    const d = r.center(_v).distanceTo(p);
    if (d < 13 && r.brain.los(p)) r.brain.flashed = Math.max(r.brain.flashed || 0, 2 + 4 * (1 - d / 13));
  }
  ctx.alert('shot', p, 30);
};

/** A flashbang at p, as you see and hear it. */
ctx.flashPlayer = (p) => {
  const pl = ctx.player, eye = pl.eye, dist = eye.distanceTo(p);
  const to = new THREE.Vector3(p.x - eye.x, p.y - eye.y, p.z - eye.z).normalize();
  const seen = dist < 1.5 || !ctx.gore.castFixed(eye.x, eye.y, eye.z, to.x, to.y, to.z, dist - 0.2);
  const facing = to.dot(new THREE.Vector3(0, 0, -1).applyQuaternion(pl.aimQuat));
  const k = Math.max(0, 1 - dist / 18) * (seen ? 0.35 + 0.65 * Math.max(0, facing) : 0.15);
  pl.flash = Math.max(pl.flash || 0, k * 5);           // seconds; the first 1.5 of them fully white
  deafen(Math.min(1, k * 1.4 + (dist < 7 ? 0.3 : 0)));
};

ctx.explode = (p, radius = 7, power = 1) => {
  ctx.soundAt = p;
  ctx.gore.explosion(p, radius);
  sfx.explosion();
  ctx.alert('explosion', p, 45);
  const center = new THREE.Vector3(p.x, p.y, p.z);
  for (const d of ctx.doors) if (d.hinge.distanceTo(center) < radius * 0.6) d.kick(center, true);   // blown open
  for (const p of ctx.panes) if (!p.broken && p.pos.distanceTo(center) < radius * 0.9) p.break();
  for (const l of ctx.lamps) if (!l.off && l.pos.distanceTo(center) < radius * 0.7) l.out();

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

  ctx.blastPlayer(center, radius, power);
  for (const rp of ctx.remotes || []) rp.blast(center, radius, power);
};

/** What a blast does to you: rings your ears, and throws and hurts you if you were close. */
ctx.blastPlayer = (center, radius, power) => {
  const pl = ctx.player;
  deafen(1.1 - pl.eye.distanceTo(center) / (radius * 3));
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
  bled: 'BLED OUT', impact: 'SKULL CRACKED', burned: 'BURNED', beaten: 'BEATEN TO DEATH',
};
ctx.onKill = (rag, cause) => {
  ctx.kills++;
  ctx.feed((rag.killedBy ? rag.killedBy + ' · ' : '') + (KILL_TEXT[cause] || 'KILLED'));     // (killedBy: P1 or P2, in co-op)
  if (rag.kind === 'zombie') ctx.survival?.kill(cause);
  if (performance.now() - (rag.shotAt || -1e9) < 2500) {
    ctx.marker('kill');                                       // (red only for your own kills)
    if (!ctx.net?.role) ctx.hitstop = cause === 'headshot' || cause === 'gib' ? 0.09 : 0.055;   // the world holds its breath for a moment (not in co-op: it is the other player's world too)
  }
  ctx.mission.onKill(rag);
};

ctx.toast = (msg) => toast(msg);
let toastT = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('show');
  void el.offsetWidth;                  // (restart its pop-in)
  el.classList.add('show');
  toastT = 1.1;
}

/** The kill feed down the right: newest on top, five at most, each gone after a few seconds. */
function feed(text) {
  const box = $('feed'), e = document.createElement('div');
  e.textContent = text;
  box.prepend(e);
  while (box.childElementCount > 5) box.lastChild.remove();
  setTimeout(() => e.remove(), 4000);
}

/** The crosshair's X: white for a hit, red for a kill. */
function marker(kind) {
  const m = $('hitmark');
  m.className = '';
  void m.offsetWidth;
  m.className = kind;
}
ctx.feed = feed;
/**
 * Die on purpose and come back at the start: with a real gun in hand it goes to the head and off (weapons.selfShot);
 * otherwise (a knife, a taser, from the menu, driving) just the ordinary death. Then the ordinary respawn.
 */
ctx.suicide = () => {
  if (ctx.player.dead || ctx.weapons.selfT > 0) return;
  const w = ctx.weapons.current;
  if (w.type === 'gun' && w.dmg >= 9 && gameActive() && !ctx.car && !ctx.drone) ctx.weapons.selfShot();
  else { ctx.player.hurt(1e3); feed('SUICIDE'); }
};
ctx.marker = marker;

// ------------------------------------------------------------------ spawning helpers
/** Run a spawn menu item (in co-op the other player's clicks run in the host's game, except the ones about their own screen). */
function runItem(it) {
  if (ctx.spawnMenu && !it.local) { ctx.spawnMenu(SPAWN_ITEMS.indexOf(it)); if (it.cat === 'Maps' || it.cat === 'Modes') setMenu(false); }
  else it.run();
  sfx.pop();
}
/** Middle click (SPAWN on a phone, or Z): another of the last thing taken from the spawn menu, where you are looking. */
let lastSpawn = null;
function quickSpawn() {
  if (lastSpawn) runItem(lastSpawn);
  else toast('PICK SOMETHING IN THE SPAWN MENU (TAB) - THEN MIDDLE CLICK SPAWNS MORE');
}

function spawnPoint() {
  if (ctx.spawnAt) return ctx.spawnAt.clone();        // (co-op: the other player's menu click, from where they look)
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

const FACE_PLAYER = () => (ctx.spawnYaw ?? ctx.player.yaw) + Math.PI;
ctx.spawnPoint = spawnPoint;

function clearAll() {
  ctx.weapons.releaseGrab();
  ctx.weapons.clearBolts();
  for (const r of ctx.ragdolls) r.destroy();
  for (const p of ctx.props) p.remove();
  ctx.tools.clear();
  for (const t of ctx.traps) t.remove();
  ctx.ragdolls.length = 0;
  ctx.props.length = 0;
  ctx.traps.length = 0;
  ctx.gore.clear();
}

/** The door in front of you, within reach: { door, point } or null. */
function doorAhead(reach = 2.2) {
  camera.getWorldPosition(_v);
  camera.getWorldDirection(_d);
  const hit = ctx.raycast(_v, _d, reach);
  const owner = hit && ctx.owners.get(hit.collider.handle);
  if (owner?.kind === 'door') return { door: owner.door, point: _v.clone().addScaledVector(_d, hit.timeOfImpact) };
  // an open door has swung out of the way: the doorway you are facing still counts
  for (const d of ctx.doors) {
    if (d.target === 0) continue;
    const c = d.hinge.clone().addScaledVector(d.x, d.w / 2);
    c.y = _v.y;
    if (c.distanceTo(_v) < reach && c.sub(_v).normalize().dot(_d) > 0.5) return { door: d, point: c };
  }
  return null;
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
  else if (owner?.kind === 'trap') owner.trap.remove();
  else return;
  sfx.pop();
}

const SPAWN_ITEMS = [
  { cat: 'Modes', label: 'Ready or Not', icon: '🚨', small: 'SWAT: arrest, do not execute', run: () => { ctx.mission.start(); setMenu(false); } },
  { cat: 'Modes', label: 'Zombie Survival', icon: '🧟', small: 'waves, 3 lives', run: () => { ctx.survival.start(); setMenu(false); } },
  { cat: 'Modes', label: 'Sandbox', icon: '🧪', small: 'no rules', run: () => { ctx.mission.stop(); ctx.survival.stop(); toast('SANDBOX'); setMenu(false); } },
  ...MAP_LIST.map((m) => ({ cat: 'Maps', label: m.name, icon: m.icon, small: m.blurb, run: () => { ctx.mission.stop(); ctx.setMap(m.id); setMenu(false); } })),
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
    cat: 'NPCs', label: 'SWAT Officer', icon: '👮', small: 'follows you, stacks on doors', run: () => { const s = ctx.spawnRagdoll(spawnPoint(), 0, { kind: 'swat', model: 'Ch15' }); s.arm('Rifle'); s.slot = ctx.ragdolls.filter((r) => r.kind === 'swat').length - 1; },
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
  ...Object.keys(TRAP_TYPES).map((t) => ({
    cat: 'Traps', label: TRAP_TYPES[t].label, icon: TRAP_TYPES[t].icon, small: TRAP_TYPES[t].small,
    run: () => { const p = spawnPoint(); p.y -= 0.05; ctx.spawnTrap(t, p, ctx.spawnYaw ?? ctx.player.yaw); },     // (facing the way you look)
  })),
  { cat: 'World', label: 'Explosion', icon: '☄️', small: 'at crosshair', run: () => ctx.explode(spawnPoint(), 8, 1.3) },
  { cat: 'World', label: 'Kill All', icon: '☠️', small: 'every NPC', run: () => { for (const r of ctx.ragdolls) r.damage(1000); } },
  { cat: 'World', label: 'Clean Blood', icon: '🧽', small: 'decals + particles', local: true, run: () => ctx.gore.clear() },
  { cat: 'World', label: 'Clear All', icon: '🗑️', small: 'wipe the sandbox', run: () => ctx.clearAll() },
  { cat: 'World', label: 'Slow-mo', icon: '⏳', small: 'toggle (T)', local: true, run: () => toggleSlowmo() },
  { cat: 'World', label: 'Helmet Cam', icon: '📹', small: 'toggle (V)', local: true, run: () => toggleHelmet() },
  { cat: 'World', label: 'Graphics', icon: '✨', small: 'high / fast (G)', local: true, run: () => toggleGraphics() },
  { cat: 'World', label: 'Settings', icon: '⚙️', small: 'look, FOV, volume, graphics', local: true, run: () => setSettings(true) },
  { cat: 'World', label: 'Suicide', icon: '💀', small: 'die and respawn (Backspace)', local: true, run: () => ctx.suicide() },
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
    // (in co-op the other player's clicks run in the host's game, except the ones about their own screen)
    el.addEventListener('click', () => {
      runItem(it);
      if (!['World', 'Maps', 'Modes'].includes(it.cat)) lastSpawn = it;      // (what middle click spawns again)
    });
    grid.appendChild(el);
  }
  // the controls from the start screen, so they are a Tab away in game
  const h = document.createElement('div');
  h.className = 'cat keys-h'; h.textContent = 'Controls';
  const keys = $('keys').cloneNode(true);
  keys.removeAttribute('id');
  body.append(h, keys);
}
buildMenu();
ctx.spawnItems = SPAWN_ITEMS;            // (co-op runs the other player's clicks by their place in this list)

const crosshairEl = $('crosshair');
const healthEl = $('health-fill'), healthBox = $('health'), healthNum = $('health-num');
const hurtEl = $('hurt'), dmgEl = $('dmgdir');
let shownHealth = 100, shownGap = 0;
let wasDead = false;
const camTimeEl = $('cam-time');
const lastRot = new THREE.Euler();
let camClock = 0;
ctx.helmet = false;
function toggleHelmet() {
  ctx.helmet = !ctx.helmet;
  document.body.classList.toggle('helmet', ctx.helmet);
  camClock = 0;
  bodycam(ctx.helmet);
  sfx.tick();
}

// Bodycam: where the nearest faces are on the picture, for the lens shader to block out.
const _face = new THREE.Vector3();
function blockFaces() {
  const faces = post.final.uniforms.uFaces.value;
  let n = 0;
  if (ctx.helmet) {
    camera.updateMatrixWorld();
    const near = ctx.ragdolls.filter((r) => !r.removed && !r.parts.head.gone)
      .map((r) => [r, camera.position.distanceTo(r.parts.head.mesh.getWorldPosition(_face))])
      .filter((e) => e[1] < 40).sort((a, b) => a[1] - b[1]);
    for (const [r, dist] of near) {
      if (n === faces.length) break;
      if (!r.brain.los(camera.position)) continue;          // behind a wall: nothing to hide
      r.parts.head.mesh.getWorldPosition(_face).project(camera);
      if (_face.z > 1 || Math.abs(_face.x) > 1.2 || Math.abs(_face.y) > 1.2) continue;
      faces[n++].set(_face.x * 0.5 + 0.5, _face.y * 0.5 + 0.5, 0.17 * camera.projectionMatrix.elements[5] / dist * 0.5);
    }
  }
  for (; n < faces.length; n++) faces[n].z = 0;
}

// N: any map after dark. L: the flashlight (it comes on by itself when night falls).
const torch = new THREE.SpotLight(0xfff1dc, 380, 50, 0.4, 0.6, 1.6);
torch.position.set(0.08, -0.08, -0.6);     // out by the muzzle, so it does not light up your own hands
torch.target.position.set(0.08, -0.08, -1.6);
torch.castShadow = true;
torch.shadow.mapSize.set(1024, 1024);
torch.shadow.camera.near = 0.4;
torch.shadow.bias = -0.0008;
torch.visible = false;
camera.add(torch, torch.target);
ctx.torch = torch;
ctx.night = false;
function toggleNight() {
  ctx.nightByMap = false;              // (setMap marks it when a night-only map switched it on)
  ctx.night = !ctx.night;
  ctx.setSky(ctx.night ? 'night' : ctx.rain ? 'overcast' : ctx.map.sky);
  torch.visible = ctx.night;
  $('night').classList.toggle('on', ctx.night);
  toast(ctx.night ? 'NIGHT - L flashlight' : 'DAY');
}

// P: record what you see (and hear) to a video file. Each frame is copied onto a 2D canvas with the camera's
// timestamp burned in (the HTML overlay is not part of the picture).
let rec = null;
function toggleRecording() {
  if (rec) { rec.media.stop(); return; }
  if (!window.MediaRecorder) { toast('RECORDING NOT SUPPORTED'); return; }
  const c = document.createElement('canvas');
  const sound = audioStream();
  const stream = c.captureStream(30);
  if (sound) for (const t of sound.stream.getAudioTracks()) stream.addTrack(t);
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const media = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : {});
  const parts = [];
  media.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  media.onstop = () => {
    sound?.stop();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }));
    a.download = `impactbox-bodycam-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    rec = null;
    toast('RECORDING SAVED');
  };
  rec = { media, c, g: c.getContext('2d'), t0: performance.now() };
  media.start(1000);
  toast('RECORDING - P to stop');
}
function recordFrame() {
  if (!rec) return;
  const W = canvas.width, H = canvas.height;
  const w = W;
  if (rec.c.width !== w || rec.c.height !== H) { rec.c.width = w; rec.c.height = H; }
  const g = rec.g;
  g.drawImage(canvas, 0, 0);                        // straight after drawing, while the frame is still there
  g.font = `600 ${Math.round(H / 40)}px Consolas, monospace`;
  g.fillStyle = '#f2f2f2'; g.shadowColor = '#000'; g.shadowBlur = 4; g.textAlign = 'right';
  g.fillText(camTimeEl.textContent || new Date().toISOString().slice(0, 19) + 'Z', w * 0.95, H * 0.08);
  g.fillText('BWC 07 \u00b7 X60A31F2', w * 0.95, H * 0.08 + H / 32);
  g.shadowBlur = 0;
}

// O: rain. The ground goes wet, the sky overcast (unless it is night), drops on the lens, and the sound of it.
ctx.rain = false;
let rainLensT = 0;
function toggleRain() {
  ctx.rain = !ctx.rain;
  ctx.map.builder.wet(ctx.rain);
  setRain(ctx.rain);
  ctx.setSky(ctx.night ? 'night' : ctx.rain ? 'overcast' : ctx.map.sky);
  $('rain').classList.toggle('on', ctx.rain);
  if (!ctx.rain) ctx.gore.rain.n = 0;
  toast(ctx.rain ? 'RAIN' : 'DRY');
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
  if (ctx.remoteRun) return;            // (the other player's menu click, run here: not this player's menu)
  if (!open) setSettings(false);
  $('menu').classList.toggle('hidden', !open);
  setOverlay(open);
}

/** Something over the game that wants the mouse (the spawn menu, the survival shop): the game stops taking input. */
function setOverlay(open) {
  ctx.menuOpen = open;
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    input.left = input.right = false;
  } else {
    canvas.requestPointerLock?.();
  }
}
ctx.setOverlay = setOverlay;

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
    $('play').textContent = 'Resume';
    started = false;
    input.keys.clear();
    input.left = input.right = false;
  }
});
document.addEventListener('pointerlockerror', () => { lockFallback = true; });

document.addEventListener('mousemove', (e) => {
  if (!gameActive()) return;
  if (document.pointerLockElement === canvas || lockFallback) {
    ctx.player.look(e.movementX, e.movementY);
    input.mx += e.movementX;
    input.my += e.movementY;
  }
});

document.addEventListener('mousedown', (e) => {
  if (!gameActive()) return;
  if (e.button === 0) { input.left = true; input.leftDown = true; }
  if (e.button === 2) { input.right = true; input.rightDown = true; }
  if (e.button === 1) { e.preventDefault(); quickSpawn(); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.left = false;
  if (e.button === 2) input.right = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => { if (gameActive()) input.wheel += Math.sign(e.deltaY); }, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Tab') {
    if (started || ctx.menuOpen) { e.preventDefault(); setMenu(!ctx.menuOpen); }
    return;
  }
  if (e.code === 'Escape' && !$('settings').classList.contains('hidden')) { setSettings(false); return; }
  if (e.code === 'Escape' && !$('shop').classList.contains('hidden')) { ctx.survival.shop(false); return; }
  if (e.code === 'KeyY' && !$('shop').classList.contains('hidden')) { ctx.survival.shop(false); return; }
  if (e.code === 'Escape' && ctx.menuOpen) { setMenu(false); return; }
  if (!gameActive()) return;
  input.keys.add(e.code);
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1) ctx.weapons.selectSlot(n - 1);  // a group of weapons; press again for the next one in it
  }
  if (e.code === 'KeyT') toggleSlowmo();
  if (e.code === 'KeyY') ctx.survival.shop(true);
  if (e.code === 'KeyV') toggleHelmet();
  if (e.code === 'KeyG') toggleGraphics();
  if (e.code === 'KeyN') toggleNight();
  if (e.code === 'KeyO') toggleRain();
  if (e.code === 'KeyP') toggleRecording();
  if (e.code === 'KeyL') { torch.visible = !torch.visible; sfx.tick(); }
  if (e.code === 'Enter' && ctx.mission.over) ctx.mission.start();
  if (e.code === 'Enter' && ctx.survival.over) ctx.survival.start();
  if (e.code === 'KeyR') ctx.weapons.reload();
  if (e.code === 'KeyZ') quickSpawn();
  if (e.code === 'Backspace') ctx.suicide();
  if (e.code === 'KeyF') {
    if (ctx.car) ctx.driving.exit();
    else { const d = doorAhead(); if (d) d.door.toggle(ctx.player.pos); else if (!ctx.driving.tryEnter()) { ctx.weapons.unjam(); ctx.mission.act(); } }
  }
  if (e.code === 'KeyH') { const d = doorAhead(1.9); if (d) d.door.kick(ctx.player.pos); }
  if (e.code === 'KeyM') { ctx.mirrorOn = !ctx.mirrorOn; sfx.tick(); }
  if (e.code === 'KeyU') {
    // the squad: go where you are pointing and hold there, or (again) back to you
    if (ctx.squadGo) { ctx.squadGo = null; toast('SQUAD: ON ME'); }
    else {
      camera.getWorldPosition(_v); camera.getWorldDirection(_d);
      const hit = ctx.raycast(_v, _d, 16);
      const pos = _v.clone().addScaledVector(_d, hit ? Math.max(0.5, hit.timeOfImpact - 0.8) : 16);
      pos.y = ctx.player.pos.y;
      const dir = new THREE.Vector3(_d.x, 0, _d.z).normalize();
      ctx.squadGo = { pos, dir, right: new THREE.Vector3(-dir.z, 0, dir.x) };
      toast('SQUAD: MOVE UP');
    }
    sfx.tick();
  }
  if (e.code === 'KeyB') ctx.weapons.toggleMode();
  if (e.code === 'KeyJ') ctx.weapons.toggleCan();
  if (e.code === 'KeyK') { ctx.weapons.laser = !ctx.weapons.laser; sfx.tick(); }
  if (e.code === 'KeyX') deleteTarget();
  if (e.code === 'KeyC') { ctx.clearAll(); toast('CLEARED'); }
});
document.addEventListener('keyup', (e) => input.keys.delete(e.code));
initTouch(ctx, input);
window.addEventListener('blur', () => { input.keys.clear(); input.left = input.right = false; });

// ------------------------------------------------------------------ maps
/** Wipe the sandbox and move to another map. */
function setMap(id, populate = true) {
  clearAll();
  loadMap(ctx, id);
  ctx.player.teleport(ctx.map.spawn, ctx.map.yaw);
  if (populate) ctx.map.populate();            // (a co-op guest's world is the host's: it brings its own people)
  setSpace(ctx.map.id);
  try { localStorage.setItem('impactbox.map', ctx.map.id); } catch (e) { /* private window: just don't remember */ }
  for (const el of document.querySelectorAll('#maps button')) el.classList.toggle('on', el.dataset.map === ctx.map.id);
  // some maps are only ever visited after dark; leaving one brings the day back (unless you put the night on yourself)
  if (ctx.map.def.night && !ctx.night) { toggleNight(); ctx.nightByMap = true; }
  else if (!ctx.map.def.night && ctx.night && ctx.nightByMap) toggleNight();
  toast(ctx.map.name.toUpperCase());
}
ctx.setMap = setMap;
ctx.clearAll = clearAll;
ctx.toggleNight = toggleNight;
ctx.toggleRain = toggleRain;

// the map can be chosen before starting, as well as from the spawn menu
for (const m of MAP_LIST) {
  const el = document.createElement('button');
  el.dataset.map = m.id;
  el.innerHTML = `<span class="ico">${m.icon}</span><b>${m.name}</b><small>${m.blurb}</small>`;
  el.title = m.blurb;
  el.classList.toggle('on', m.id === ctx.map.id);
  el.addEventListener('click', () => { if (m.id !== ctx.map.id) { ctx.mission.stop(); ctx.setMap(m.id); } });
  $('maps').appendChild(el);
}
ctx.map.populate();
ctx.mission = new Mission(ctx);
ctx.survival = new Survival(ctx);
$('surv').addEventListener('click', () => { ctx.survival.start(); $('surv').classList.add('on'); });
$('swat').addEventListener('click', () => { ctx.mission.start(); $('swat').classList.add('on'); });
$('night').addEventListener('click', toggleNight);
$('rain').addEventListener('click', toggleRain);
ctx.net = new Coop(ctx);                                          // co-op (coop.js): idle until someone hosts or joins
if (ctx.map.def.night) { toggleNight(); ctx.nightByMap = true; }  // (a night map asked for by ?map= or remembered from last time)

// ------------------------------------------------------------------ main loop
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fps = 60;
const statsEl = $('stats');
let statsT = 0;

let crashed = false;
let lastStep = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (crashed) return;
  if (ctx.frozen) {                       // debugging: time stands still, the free camera keeps drawing
    if (ctx.view === 'fp') { cullPeople(camera); post.render(scene, camera, ctx.helmet); }     // the player's own view, held still
    else if (ctx.view) ctx.debugView(...ctx.view);
    return;
  }
  try { tick(now); } catch (e) {
    // a wasm panic leaves the physics world unusable, so stop instead of spamming the console
    crashed = true;
    console.error('[impactbox] fatal error, simulation stopped:', e);
    toast('SIMULATION CRASHED - restarting');
    setTimeout(() => location.reload(), 2500);     // the physics cannot be trusted after a panic: start clean (the map is remembered)
    toastT = 1e9;
  }
}

// debugging aid: advance the game n frames from the console (works even when the tab is throttled)
ctx.debugStep = (n = 1) => { for (let i = 0; i < n; i++) tick(last + 1000 / 60); last = performance.now(); };
/** Before a picture: hide the people out of view, and let only the near ones cast shadows (Ragdoll.cull says why). */
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4();
function cullPeople(cam) {
  cam.updateMatrixWorld();
  _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  for (const r of ctx.ragdolls) r.cull(_frustum, cam.position);
  if (ctx.net.avatar) ctx.net.avatar.cull(_frustum, cam.position);
}

/** Debugging: draw one frame from a free camera (no weapon in view) without advancing the game. */
ctx.debugView = (from, at, fov = 40) => {
  ctx.view = [from, at, fov];
  const keep = camera.fov;
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.position.set(from[0], from[1], from[2]);
  camera.lookAt(at[0], at[1], at[2]);
  ctx.weapons.pivot.visible = false;
  cullPeople(camera);
  post.render(scene, camera, false);
  ctx.weapons.pivot.visible = true;
  camera.fov = keep;
  camera.updateProjectionMatrix();
};

/** A launched drone: the view rides on it, it goes where you look (Shift = faster), and it blows up on what it meets. */
function flyDrone(now) {
  const d = ctx.drone;
  if (!d) return;
  if (d.removed || ctx.player.dead) { if (!d.removed) d.life = 0; ctx.drone = null; return; }
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.player.aimQuat);
  const sp = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? 26 : 13;
  d.body.setLinvel({ x: dir.x * sp, y: dir.y * sp, z: dir.z * sp }, true);
  const t = d.body.translation();
  camera.position.set(t.x, t.y, t.z);
  camera.quaternion.copy(ctx.player.aimQuat);
  camera.rotateZ(Math.sin(now * 0.031) * 0.004);            // rotor buzz
}

// Phones: the picture's resolution follows the frame rate, down when it drops under 42, back up when there is room.
let prT = 3;
function adaptResolution(dt) {
  if (!gameActive() || (prT -= dt) > 0) return;
  prT = 2;
  const pr = renderer.getPixelRatio();
  const next = THREE.MathUtils.clamp(fps < 42 ? pr - 0.15 : fps > 56 ? pr + 0.1 : pr, 0.6, MAX_PR * ctx.settings.scale);
  if (Math.abs(next - pr) > 0.01) { renderer.setPixelRatio(next); resize(); }
}

function tick(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  if (ctx.hitstop > 0) ctx.hitstop -= dt;
  const sdt = dt * ctx.timeScale * (ctx.hitstop > 0 ? 0.08 : 1);

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (isTouch) adaptResolution(dt);

  const active = gameActive() && !ctx.player.dead;
  ctx.player.update(sdt, input, active, dt);
  // the squad stacks on a closed door you are standing at
  const sd = ctx.ragdolls.some((r) => r.kind === 'swat' && !r.dead) ? doorAhead(2.4) : null;
  ctx.squadDoor = sd && sd.door.target === 0 ? sd.door : null;
  if (ctx.squadGo && ctx.squadGo.pos.distanceTo(ctx.player.pos) > 18) ctx.squadGo = null;     // too far behind you: they come
  // the mirror: your eye goes to the floor on the far side of the door in front of you
  const mirror = ctx.mirrorOn && !ctx.drone ? doorAhead(2.2) : null;
  if (ctx.mirrorOn && !mirror) ctx.mirrorOn = false;          // walked away from it
  document.body.classList.toggle('mirror', !!mirror);
  if (mirror) {
    const d = mirror.door, side = d.side(ctx.player.pos);
    camera.position.copy(d.hinge).addScaledVector(d.x, d.w / 2).addScaledVector(d.n, -side * 0.3);
    camera.position.y = d.hinge.y + 0.08;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + 0.35, 0.1, 0.6);
    input.left = input.leftDown = false;
  }
  ctx.weapons.pivot.visible = !mirror && !ctx.drone && !ctx.car;
  if (active && !ctx.car) ctx.weapons.update(dt, input);
  else ctx.weapons.fade(dt);
  hum(active && !ctx.car && ctx.weapons.current.laser ? Math.min(1, ctx.weapons.swing * 3.5) : null);   // (the laser sword, while it is out)
  flyDrone(now);
  for (const d of ctx.doors) d.update(sdt);
  // footsteps: one for every half turn of the walk cycle
  const stepN = Math.floor(ctx.player.bob / Math.PI);
  if (stepN !== lastStep) {
    lastStep = stepN;
    if (active && ctx.player.grounded) {
      const pl = ctx.player, under = ctx.raycast({ x: pl.pos.x, y: pl.pos.y - 0.5, z: pl.pos.z }, { x: 0, y: -1, z: 0 }, 1.2);
      sfx.step(input.keys.has('ShiftLeft') || input.keys.has('ShiftRight'), under ? ctx.surfaces.get(under.collider.handle) : null);
      // your own boots track blood too
      const feet = { x: pl.pos.x, y: pl.pos.y - 0.85, z: pl.pos.z };
      if (ctx.gore.wetAt(feet)) pl.bloody = 9;
      else if (pl.bloody > 0) {
        const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw), side = stepN % 2 ? 0.1 : -0.1;
        feet.x -= fz * side; feet.z += fx * side;
        ctx.gore.footprint(feet, { x: fx, y: 0, z: fz }, pl.bloody-- / 9);
      }
    }
  }

  // timers (run in sim time so slow-mo stretches fuses and chain reactions)
  for (let i = ctx.timers.length - 1; i >= 0; i--) {
    const t = ctx.timers[i];
    t.t -= sdt;
    if (t.t <= 0) { ctx.timers.splice(i, 1); t.fn(); }
  }

  for (const r of ctx.ragdolls) r.update(sdt);
  for (const p of ctx.props) p.update(sdt);
  for (const t of ctx.traps) if (!t.removed) t.update(sdt);     // (moves their kinematic parts for the step below; a deleted one has no bodies left)
  ctx.water.update(sdt);                                          // (floats things for the step below)
  ctx.driving.update(sdt, input, active);                         // (drives the car you are in)
  ctx.net.pre(sdt);

  if (sdt > 0) {
    for (const r of ctx.ragdolls) r.preStep();
    const steps = Math.max(1, Math.ceil(sdt / (1 / 60)));
    world.timestep = sdt / steps;
    for (let i = 0; i < steps; i++) world.step(eventQueue, physicsHooks);
  }

  for (const r of ctx.ragdolls) r.sync();
  for (const p of ctx.props) p.sync();
  ctx.driving.view(dt);
  ctx.tools.update();
  ctx.net.post(dt);
  if (ctx.traps.some((t) => t.removed)) ctx.traps = ctx.traps.filter((t) => !t.removed);
  if (ctx.ragdolls.some((r) => r.removed)) ctx.ragdolls = ctx.ragdolls.filter((r) => !r.removed);
  if (ctx.props.some((p) => p.removed)) ctx.props = ctx.props.filter((p) => !p.removed);

  ctx.gore.update(sdt);
  if (ctx.rain) {
    const c = camera.position, covered = !!ctx.gore.castFixed(c.x, c.y, c.z, 0, 1, 0, 14);
    ctx.gore.rainStep(sdt, c, covered);
    if (!covered && camera.rotation.x > -0.35 && (rainLensT -= dt) <= 0) { rainLensT = 0.3; ctx.gore.lens(1, 'rain'); }
  }
  ctx.mission.update(dt);
  ctx.survival.update(dt);
  tickWounds(sdt);

  // shadow camera follows the player (or whatever the trailer is filming)
  const sun = ctx.sun, sp = ctx.shadowAt || ctx.player.pos;
  sun.target.position.set(Math.round(sp.x), Math.round(sp.y - 1), Math.round(sp.z));
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
  if (!pl.dead && pl.pos.y < ctx.map.killY) pl.hurt(1000, null);      // fell off the map
  healthEl.style.width = pl.health + '%';
  healthBox.classList.toggle('low', pl.health < 35);
  if (Math.ceil(pl.health) !== shownHealth) healthNum.textContent = shownHealth = Math.ceil(pl.health);
  // the crosshair opens up while you move, jump or fire
  const gap = Math.round((3 + Math.min(12, Math.hypot(pl.vel.x, pl.vel.z) * 1.4) + pl.shake * 16 + (pl.grounded ? 0 : 6)) * 2) / 2;
  if (gap !== shownGap) crosshairEl.style.setProperty('--gap', `${shownGap = gap}px`);
  // and an arc on the side the last hit came from
  const hf = pl.hurtFrom;
  if (hf && pl.hurtFlash > 0.02 && !pl.dead) {
    const dx = hf.x - pl.pos.x, dz = hf.z - pl.pos.z, fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
    dmgEl.style.transform = `rotate(${Math.atan2(-dx * fz + dz * fx, dx * fx + dz * fz)}rad)`;
    dmgEl.style.opacity = Math.min(1, pl.hurtFlash * 1.4);
  } else if (dmgEl.style.opacity !== '0') dmgEl.style.opacity = '0';
  hurtEl.style.opacity = Math.min(0.85, pl.hurtFlash * 0.55 + (1 - pl.health / 100) * 0.4 + (pl.dead ? 0.5 : 0));
  if (pl.dead !== wasDead) { wasDead = pl.dead; if (pl.dead) { toast('YOU DIED'); toastT = 3; ctx.weapons.releaseGrab(); ctx.weapons.selfT = 0; } }

  // crosshair is hidden while looking down the sights, and always in helmet cam
  crosshairEl.classList.toggle('hide', ctx.helmet || ctx.weapons.ads > 0.4 || !!mirror);

  if (ctx.helmet) {
    camClock -= dt;
    if (camClock <= 0) {
      camClock = 0.5;
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      camTimeEl.textContent = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}Z`;
    }
  }
  ctx.sky.material.uniforms.uTime.value = now / 1000;   // clouds drift
  blockFaces();
  post.final.uniforms.uSupp.value = ctx.player.suppress;
  ctx.player.flash = Math.max(0, (ctx.player.flash || 0) - dt);
  post.final.uniforms.uFlash.value = Math.min(1, ctx.player.flash / 1.5);
  // bodycam motion blur: how far the picture slid since the last frame
  const pm = camera.projectionMatrix.elements, rot = camera.rotation;
  const dyaw = Math.atan2(Math.sin(rot.y - lastRot.y), Math.cos(rot.y - lastRot.y)), dpitch = rot.x - lastRot.x;
  post.final.uniforms.uBlur.value.set(THREE.MathUtils.clamp(dyaw * pm[0] * 0.3, -0.05, 0.05), THREE.MathUtils.clamp(dpitch * pm[5] * 0.3, -0.05, 0.05));
  lastRot.copy(rot);
  if (ctx.frozen) return;                 // (stepped from outside, by the trailer or a debugger, which draws its own view)
  cullPeople(camera);
  post.render(scene, camera, ctx.helmet);
  recordFrame();
}

$('loading').remove();
$('play').disabled = false;
requestAnimationFrame(frame);
prewarm();

/**
 * What a first wound needs on the GPU (the cut skin, the meat under it, what is inside, a stump, a burnt stump) used to be
 * built at the moment of the first hit on each look of person, which stalled the game for a moment (a long one on a phone,
 * and in co-op on both screens). So while the start screen is up, each look is spawned out of sight, opened up once and
 * taken away again, and the GPU builds all of it in the background (compileAsync).
 */
async function prewarm() {
  // (20 m under the player: out of sight, but inside the sun's shadow camera, so their shadow versions get built too)
  const o = new THREE.Vector3(), at = { x: ctx.player.pos.x, y: ctx.player.pos.y - 20, z: ctx.player.pos.z };
  const stumps = [makeStump(0.05, 0.05), makeStump(0.05, 0.05, 'limb', true)];
  for (const s of stumps) { s.position.set(at.x, at.y, at.z); scene.add(s); }
  for (const model of looks()) {
    const r = new Ragdoll(ctx, at, 0, { kind: 'civilian', model });
    r.split();
    for (const n in r.parts) openWound(r.parts[n], o, 0.001);
    r.sever('farmL', null, true);                 // (the cut faces too)
    // built for where the picture is really drawn: post.js's target (its colour space and tone mapping differ from the screen's)
    renderer.setRenderTarget(post.enabled ? post.target : null);
    const ready = renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);               // (one real draw: the shadow pass has its own versions)
    renderer.setRenderTarget(null);
    try { await ready; } catch (e) { /* (only ever a head start) */ }
    r.destroy();
  }
  for (const s of stumps) scene.remove(s);
}
if (new URLSearchParams(location.search).has('trailer')) import('./trailer.js').then((m) => m.start(ctx));   // the launch trailer (trailer.js)
