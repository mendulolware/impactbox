import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Ragdoll, RAGDOLL_PARTS } from './ragdoll.js';
import { woundHooks, openWound, burn } from './wounds.js';
import { sfx, farAway } from './audio.js';
import { makeTrap } from './traps.js';
import { WEAPONS } from './weapons.js';
import { Link, Lobbies } from './net.js';
import { MAPS } from './maps.js';

// Co-op for two (net.js does the connecting).
//
// The host's game is the real one: it runs every NPC, every prop, every trap and all the physics that matters.
// The other player's game (the guest) builds the same map and keeps a copy of everything in it as a puppet:
// bodies, props and traps that only ever move where the host says (a stream of positions, 20 a second, on
// the unreliable channel), and decide nothing for themselves. What the guest does to them goes to the host
// as a request (a hit, a door, a spawn) and comes back as what happened.
//
// What happened travels as events on the reliable channel, gathered over a frame:
//   - every blood, gore and decal call the host makes (Gore methods, not what they do inside), replayed on the guest
//   - every sound the host plays (sfx), except its own footsteps, clicks and grunts
//   - wounds and burns (wounds.js hooks), and bodies being split, cut and blown apart, so the copies match
//   - glass, lamps, kill feed, messages, being hurt, blasts and flashbangs that reach the guest
// A roster goes out every couple of seconds and whenever something appears or goes: who and what exists, the
// map, night and rain, ropes, the mission panel. It is also how a late joiner catches up.
// Each player sees the other as a soldier with a rifle (an avatar: a ragdoll driven by the other's position).

const SNAP = 1 / 20;
const PARTS = Object.keys(RAGDOLL_PARTS);
const GORE = ['blood', 'drip', 'mist', 'gush', 'gibs', 'sparks', 'debris', 'explosion', 'splat', 'bloodDecal', 'pool', 'run', 'smear',
  'footprint', 'handprint', 'wallSplatter', 'bulletHole', 'chunks'];
const OWN_SFX = new Set(['step', 'tick', 'pop', 'playerHurt']);    // the host's own: not worth hearing on the other side
const OWN_TOAST = /^(INDESTRUCTIBLE|SUPPRESSOR|SEMI|AUTO|EMPTY|JAMMED|DRONE|RAIN|DRY|NIGHT|DAY|GRAPHICS|RECORDING|CLEARED|SANDBOX|SQUAD|LASER|ROPE|WELD|UNTIED|NOTHING TO TIE|YOU DIED|PLAYER 2)/;
const UP = new THREE.Vector3(0, 1, 0);
const OPTS = { night: 'Night', rain: 'Rain', swat: 'Ready or Not', surv: 'Zombie Survival' };   // what a listed game is playing
const V = (o) => new THREE.Vector3(o.x, o.y, o.z);
const P = (v) => (v ? { x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) } : null);
const rnd = (a, b) => a + Math.random() * (b - a);
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3();

// which gun an NPC holds, so the other side can put the same one in its copy's hand
const arm = Ragdoll.prototype.arm;
Ragdoll.prototype.arm = function (model = 'Pistol') { this.gunModel = model; return arm.call(this, model); };

// ------------------------------------------------------------------ a little binary writer/reader for the stream
class Out {
  constructor(n) { this.buf = new ArrayBuffer(n); this.dv = new DataView(this.buf); this.o = 0; }
  u8(v) { this.dv.setUint8(this.o, v); this.o += 1; }
  u16(v) { this.dv.setUint16(this.o, v, true); this.o += 2; }
  f(v) { this.dv.setFloat32(this.o, v, true); this.o += 4; }
  cm(v) { this.dv.setInt16(this.o, Math.max(-32767, Math.min(32767, Math.round(v * 100))), true); this.o += 2; }   // (a position: to the centimetre, +-327 m)
  q(r) { for (const c of [r.x, r.y, r.z, r.w]) { this.dv.setInt16(this.o, Math.round(c * 32767), true); this.o += 2; } }
  done() { return this.buf.slice(0, this.o); }
}
class In {
  constructor(buf) { this.dv = new DataView(buf); this.o = 0; }
  u8() { return this.dv.getUint8(this.o++); }
  u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  f() { const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  cm() { const v = this.dv.getInt16(this.o, true) / 100; this.o += 2; return v; }
  q(out) { const c = []; for (let i = 0; i < 4; i++) { c.push(this.dv.getInt16(this.o, true) / 32767); this.o += 2; } return out.set(c[0], c[1], c[2], c[3]).normalize(); }
}

/** A player's state: where they are, which way they look, what they hold. */
function writePlayer(o, pl, weapons) {
  o.f(pl.pos.x); o.f(pl.pos.y); o.f(pl.pos.z);
  o.f(pl.vel.x); o.f(pl.vel.y); o.f(pl.vel.z);
  o.f(pl.yaw); o.f(pl.pitch);
  o.u8(weapons.index);
  o.u8((pl.dead ? 1 : 0) | (weapons.current.type === 'gun' ? 2 : 0) | (weapons.ads > 0.5 ? 4 : 0));
}
function readPlayer(i) {
  return { x: i.f(), y: i.f(), z: i.f(), vx: i.f(), vy: i.f(), vz: i.f(), yaw: i.f(), pitch: i.f(), weapon: i.u8(), flags: i.u8() };
}

export class Coop {
  constructor(ctx) {
    this.ctx = ctx;
    this.role = null;          // 'host' | 'guest' once a game is set up
    this.link = null;
    this.events = [];          // this frame's events, already JSON
    this.rags = new Map();     // network id -> ragdoll (the host's real ones, or the guest's puppets)
    this.props = new Map();
    this.traps = new Map();
    this.nextId = 1;
    this.partOwner = new WeakMap();
    this.snapT = 0;
    this.rosterT = 0;
    this.dirty = false;
    this.replaying = false;    // guest: playing back what the host sent (so nothing goes back)
    this.goreOK = false;
    this.avatar = null;        // the other player, as a body in this world
    this.remote = null;        // host: the other player, as something NPCs can see and hurt
    this.pending = [];         // guest: props its own weapons made this frame, to hand to the host
    this.linkMeshes = [];
    this.kills = { P1: 0, P2: 0 };   // co-op: who got how many (P1 is the host)
    this.ui();
  }

  // ---------------------------------------------------------------- the start screen's co-op section
  ui() {
    const $ = (id) => document.getElementById(id);
    this.statusEl = $('mp-status');
    this.badge = $('mp-badge');
    this.listEl = $('mp-list');
    this.busy = false;         // hosting or joining under way
    $('mp-host').addEventListener('click', () => this.host().catch((e) => { this.busy = false; this.browse(); this.status(`Could not host: ${e.message}`); }));
    // the open games, kept up to date while the start screen is up and this player is in none
    this.lobbies = new Lobbies(() => this.showLobbies());
    this.startEl = $('start');
    new MutationObserver(() => this.browse()).observe(this.startEl, { attributes: true, attributeFilter: ['class'] });
    this.browse();
  }

  browse() {
    if (this.startEl.classList.contains('hidden') || this.role || this.busy) this.lobbies.stop(); else this.lobbies.start();
    this.showLobbies();
  }

  showLobbies() {
    const el = this.listEl;
    el.replaceChildren();
    if (this.role || this.busy) return;                    // (in a game, or getting into one: the status line says how it goes)
    const games = this.lobbies.list.filter((g) => Object.hasOwn(MAPS, g.map)).slice(0, 12);   // (a map this build has: anything else is another version, or junk)
    if (!games.length) {
      const p = document.createElement('p');
      p.textContent = 'No open games right now. Host one and it shows up here for everyone.';
      el.append(p);
      return;
    }
    for (const g of games) {        // (what the server says is only ever text here, never markup)
      const m = MAPS[g.map], b = document.createElement('button');
      const ico = document.createElement('span'), name = document.createElement('b'), opts = document.createElement('small'), go = document.createElement('span');
      ico.className = 'ico'; go.className = 'go';
      ico.textContent = m?.icon || '🎮';
      name.textContent = m?.name || 'Unknown map';
      opts.textContent = g.opts.map((o) => OPTS[o]).filter(Boolean).join(' · ') || 'Sandbox';
      go.textContent = 'Join';
      b.append(ico, name, opts, go);
      b.addEventListener('click', () => this.join(g.code).catch((e) => { this.busy = false; this.browse(); this.status(`Could not join: ${e.message}`); }));
      el.append(b);
    }
  }

  /** What the open list shows of this game: the map and what is on. */
  lobbyInfo() {
    const ctx = this.ctx;
    return { map: ctx.map.id, opts: [ctx.night && 'night', ctx.rain && 'rain', ctx.mission?.on && 'swat', ctx.survival?.on && 'surv'].filter(Boolean) };
  }

  status(text = this.statusEl?.textContent || '') {
    if (this.statusEl) this.statusEl.textContent = text;
    if (this.badge) {
      const relay = this.via === 'relay' ? ' · RELAY' : '', score = ` · P1 ${this.kills.P1} · P2 ${this.kills.P2}`;
      this.badge.textContent = !this.role ? '' : this.role === 'host'
        ? (this.link?.open ? `CO-OP${score}${relay}` : 'CO-OP · OPEN · WAITING')
        : `CO-OP${score}${relay}`;
    }
  }

  newLink() {
    return new Link({
      message: (m) => this.onMessage(m),
      state: (b) => this.onState(b),
      open: () => this.onOpen(),
      close: () => this.onClose(),
      error: (e) => this.status(e),
      via: (mode) => { this.via = mode; this.status(this.statusEl?.textContent || ''); },
    });
  }

  /** Queue an event for the other side (host: only while someone is there to get it). */
  q(ev) { if (this.link?.open && !this.replaying) this.events.push(JSON.stringify(ev)); }

  // ================================================================ HOST
  async host() {
    if (this.role || this.busy) return;
    this.busy = true;
    this.browse();
    this.status('Opening your game…');
    this.link = this.newLink();
    await this.link.host(() => this.lobbyInfo());
    this.role = 'host';
    this.busy = false;
    this.setupHost();
    this.status('Your game is open: anyone can join it from their list of open games. Waiting for player 2…');
  }

  setupHost() {
    const ctx = this.ctx, self = this;
    for (const r of ctx.ragdolls) this.tag(r, this.rags);
    for (const p of ctx.props) this.tag(p, this.props);
    for (const t of ctx.traps) this.tag(t, this.traps);
    for (const [fn, map] of [['spawnRagdoll', this.rags], ['spawnProp', this.props], ['spawnTrap', this.traps]]) {
      const f = ctx[fn];
      ctx[fn] = (...a) => { const o = f(...a); if (o) this.tag(o, map); return o; };
    }
    // every gore call from outside gore.js goes over (what it does inside stays: the guest's copy does the same)
    let depth = 0;
    const gore = ctx.gore;
    for (const name of GORE) {
      const f = gore[name].bind(gore);
      gore[name] = (...a) => {
        if (depth) return f(...a);
        depth++;
        try { this.q(['g', name, a]); return f(...a); } finally { depth--; }
      };
    }
    const upd = gore.update.bind(gore);
    gore.update = (dt) => { depth++; try { upd(dt); } finally { depth--; } };
    const clr = gore.clear.bind(gore);
    gore.clear = () => { this.q(['gclear']); clr(); };
    // sounds
    this.sfxOrig = {};                                   // (the host's own, unsent: see the guest's hits below)
    for (const k of Object.keys(sfx)) {
      if (typeof sfx[k] !== 'function' || OWN_SFX.has(k)) continue;
      const f = this.sfxOrig[k] = sfx[k];
      sfx[k] = (...a) => { if (!this.quiet) this.q(['s', k, a, P(ctx.soundAt || ctx.player.pos)]); return f.apply(sfx, a); };     // (some call each other through this)
    }
    // messages, kills
    const toast = ctx.toast;
    ctx.toast = (msg) => { toast(msg); if (!OWN_TOAST.test(msg)) this.q(['toast', msg]); };
    const feed = ctx.feed;
    ctx.feed = (t) => { feed(t); this.q(['feed', t]); };
    const onKill = ctx.onKill;
    ctx.onKill = (rag, cause) => {
      // whose kill: the last of the two players to hit it in the last 2.5 s (neither: a trap, a fall, an NPC)
      const now = performance.now(), mine = now - (rag.shotAt || -1e9) < 2500, theirs = now - (rag.guestShotAt || -1e9) < 2500;
      if (this.link?.open) {
        rag.killedBy = mine && (!theirs || rag.shotAt >= rag.guestShotAt) ? 'P1' : theirs ? 'P2' : null;
        if (rag.killedBy) { this.kills[rag.killedBy]++; this.status(); }
      }
      onKill(rag, cause);
      if (rag.killedBy === 'P2') this.q(['mark', 'kill']);
      this.dirty = true;
    };
    // bodies: wounds, burns, cuts
    woundHooks.open = (part, p, radius, maxR, p2, axis, reach) => {
      const r = this.partOwner.get(part);
      if (r) this.q(['w', r.nid, part.name, P(p), radius, maxR, P(p2), P(axis), reach]);
    };
    woundHooks.burn = (part, amount) => { const r = this.partOwner.get(part); if (r) this.q(['burn', r.nid, part.name, amount]); };
    const proto = Ragdoll.prototype;
    for (const name of ['split', 'sever', 'gib', 'slice']) {
      const f = proto[name];
      proto[name] = function (...a) {
        if (self.role === 'host' && this.nid) self.q([name, this.nid, ...a.map((x) => (x && x.isVector3 ? P(x) : x))]);
        return f.apply(this, a);
      };
    }
    // shots: everyone's tracer is drawn on both sides
    const w = ctx.weapons, tracer = w.tracer.bind(w);
    w.tracer = (from, to) => { tracer(from, to); this.q(['tr', P(from), P(to)]); };
  }

  /** Give something a network id. */
  tag(o, map) {
    if (o.nid) return;
    o.nid = this.nextId++;
    map.set(o.nid, o);
    if (o.parts) for (const n in o.parts) this.partOwner.set(o.parts[n], o);
    this.dirty = true;
  }

  /** The guest's link opened: they are in. */
  onOpen() {
    if (this.role !== 'host') return;
    const ctx = this.ctx;
    this.avatar = this.makeAvatar();
    const remote = this.remote = {
      isPlayer: true, pos: new THREE.Vector3(0, -50, 0), eye: new THREE.Vector3(0, -50, 0), vel: new THREE.Vector3(), aimQuat: new THREE.Quaternion(),
      yaw: 0, pitch: 0, dead: false, gun: false, ads: 0, suppress: 0, health: 100,
      hurt: (amount, from) => { if (!remote.dead) this.q(['hurt', amount, P(from)]); },
      blast: (center, radius, power) => this.q(['blast', P(center), radius, power]),
      launch: (v) => this.q(['launch', P(v)]),
      heal: () => this.q(['heal']),
      flash: (p) => this.q(['fb', P(p)]),
    };
    ctx.remotes = [remote];
    this.dirty = true;
    this.link.send(['hello', this.roster()]);
    ctx.toast('PLAYER 2 JOINED');
    this.status('Player 2 is in - press Play');
  }

  onClose() {
    const ctx = this.ctx;
    if (this.role === 'guest') {
      ctx.toast('THE HOST LEFT');
      setTimeout(() => location.reload(), 2000);       // back to a game of your own
      return;
    }
    if (this.avatar) { this.avatar._destroy(); this.ctx.scene.remove(this.avatar.tag); this.avatar = null; }
    ctx.remotes = [];
    this.remote = null;
    ctx.toast('PLAYER 2 LEFT');
    this.status('Player 2 left. Your game is open again: waiting for player 2…');
  }

  /** Who and what exists, and the state of the world: sent every couple of seconds and on every change. */
  roster() {
    const ctx = this.ctx;
    const rags = [], props = [], traps = [];
    for (const [nid, r] of this.rags) {
      if (r.removed) { this.rags.delete(nid); continue; }
      const gone = [], sev = [];
      for (const n of PARTS) { if (r.parts[n].gone) gone.push(n); else if (r.severed.has(n)) sev.push(n); }
      rags.push([nid, r.kind, r.model, r.gunModel || '', r.dead ? 1 : 0, P(r.root), sev, gone]);
    }
    for (const [nid, p] of this.props) {
      if (p.removed) { this.props.delete(nid); continue; }
      props.push([nid, p.type, P(p.body.translation())]);
    }
    for (const [nid, t] of this.traps) {
      if (t.removed) { this.traps.delete(nid); continue; }
      traps.push([nid, t.type, P(t.pos), t.yaw]);
    }
    const links = ctx.tools.links.map((l) => [l.kind, this.end(l.a), this.end(l.b)]);
    return {
      map: ctx.map.id, night: !!ctx.night, rain: !!ctx.rain, rags, props, traps, links,
      panes: (ctx.panes || []).map((p, i) => (p.broken ? i : -1)).filter((i) => i >= 0),
      lamps: (ctx.lamps || []).map((l, i) => (l.off ? i : -1)).filter((i) => i >= 0),
      mission: document.getElementById('mission').textContent,
      kills: this.kills,
      survival: ctx.survival.on && !ctx.survival.over ? { points: ctx.survival.points, owned: [...ctx.survival.owned] } : null,
    };
  }

  /** One end of a rope or weld, in terms the guest can find: a body part, a prop, or a point in the world. */
  end(e) {
    const c = e.body.numColliders() ? e.body.collider(0) : null;
    const o = c && this.ctx.owners.get(c.handle);
    if (o?.kind === 'part' && o.ragdoll.nid) return { r: o.ragdoll.nid, n: o.name, l: P(e.local) };
    if (o?.kind === 'prop' && o.prop.nid) return { p: o.prop.nid, l: P(e.local) };
    return { w: P(this.ctx.tools.toWorld(e.body, e.local, new THREE.Vector3())) };
  }

  /** Where everything is, packed small. Bodies at rest go out once a second; moving ones every time. */
  snapshot() {
    const ctx = this.ctx, now = performance.now() / 1000;
    const odd = (this.snapN = (this.snapN || 0) + 1) % 2;
    const rags = [...this.rags.values()].filter((r) => !r.removed && (now - (r.sentAt || 0) > 1 || (!(odd && r.mode === 'anim') && PARTS.some((n) => {
      const b = r.parts[n].body;
      return !r.parts[n].gone && (!b.isDynamic() || !b.isSleeping());
    }))));
    const props = [...this.props.values()].filter((p) => !p.removed && (now - (p.sentAt || 0) > 1 || !p.body.isSleeping()));
    const traps = [...this.traps.values()].filter((t) => !t.removed);
    const doors = ctx.doors || [];
    // (in pieces of 20 bodies, so one lost packet costs little)
    for (let start = 0, first = true; first || start < rags.length; start += 20, first = false) {
      const part = rags.slice(start, start + 20), ps = first ? props : [];
      const o = new Out(64 + doors.length * 4 + traps.length * 6 + part.length * 230 + ps.length * 22);
      o.u8(1);
      o.u8(first ? 1 : 0);
      if (first) {
        writePlayer(o, ctx.player, ctx.weapons);
        o.u16(doors.length); for (const d of doors) o.f(d.angle);
        o.u16(traps.length); for (const t of traps) { o.u16(t.nid); o.f(t.v); }
      }
      o.u16(part.length);
      for (const r of part) {
        r.sentAt = now;
        let mask = 0;
        PARTS.forEach((n, i) => { if (!r.parts[n].gone) mask |= 1 << i; });
        o.u16(r.nid);
        o.u8((r.dead ? 1 : 0) | (r.burnT > 0 ? 2 : 0));
        o.u16(mask);
        for (const n of PARTS) {
          const p = r.parts[n];
          if (p.gone) continue;
          const t = p.body.translation();
          o.cm(t.x); o.cm(t.y); o.cm(t.z);
          o.q(p.body.rotation());
        }
      }
      o.u16(ps.length);
      for (const p of ps) {
        p.sentAt = now;
        const t = p.body.translation();
        o.u16(p.nid); o.cm(t.x); o.cm(t.y); o.cm(t.z); o.q(p.body.rotation());
      }
      this.link.stream(o.done());
    }
  }

  /** The guest's position and aim, 20 times a second. */
  onStateHost(i) {
    const s = readPlayer(i), rp = this.remote;
    if (!rp) return;
    rp.pos.set(s.x, s.y, s.z);
    rp.eye.set(s.x, s.y + 0.7, s.z);
    rp.vel.set(s.vx, s.vy, s.vz);
    rp.yaw = s.yaw; rp.pitch = s.pitch;
    rp.aimQuat.setFromEuler(_e.set(s.pitch, s.yaw, 0));
    rp.dead = !!(s.flags & 1); rp.gun = !!(s.flags & 2); rp.ads = s.flags & 4 ? 1 : 0;
    if (this.avatar) this.avatar.net = s;
  }

  /** What the guest asks for. */
  onRequest(m) {
    const ctx = this.ctx;
    const [type] = m;
    if (type === 'hit') {
      const [, target, point, dir, dmg, impulse, opts, normal] = m;
      const p = V(point), d = V(dir);
      if (target?.[0] === 'r') {
        const r = this.rags.get(target[1]);
        if (r && !r.removed) {
          r.guestShotAt = performance.now();
          const relayed = sfx.flesh;
          sfx.flesh = this.sfxOrig.flesh || relayed;      // (the guest played its own the moment it fired)
          try { r.hit(target[2], dmg, p, d, impulse, { ...opts, normal }); } finally { sfx.flesh = relayed; }
        }
      } else if (target?.[0] === 'p') {
        const pr = this.props.get(target[1]);
        if (pr && !pr.removed) pr.hit(dmg, p, d, impulse, opts);
      } else if (target?.[0] === 'pl') {
        ctx.player.hurt(dmg * 0.5, this.remote?.pos);          // friendly fire, at half
      } else {
        // the world, a door, a window, a lamp: whatever is at that spot here
        const hit = ctx.raycast(p.clone().addScaledVector(d, -0.12), d, 0.4);
        const k = hit && ctx.owners.get(hit.collider.handle)?.kind;
        if (hit && k !== 'part' && k !== 'prop' && k !== 'chunk') ctx.applyHit(hit, p, d, dmg, impulse, opts);
      }
    } else if (type === 'hitR') {
      const [, nid, name, dmg, point, dir, impulse, opts] = m;
      const r = this.rags.get(nid);
      if (r && !r.removed) { r.guestShotAt = performance.now(); r.hit(name, dmg, V(point), V(dir), impulse, opts); }
    } else if (type === 'scorch') {
      const [, nid, name, heat, dmg, from] = m;
      const r = this.rags.get(nid);
      if (r && !r.removed) r.scorch(name, heat, dmg, from && V(from));
    } else if (type === 'dmg') {
      const r = this.rags.get(m[1]);
      if (r && !r.removed) r.damage(m[2], m[3]);
    } else if (type === 'del') this.rags.get(m[1])?.destroy();
    else if (type === 'delP') this.props.get(m[1])?.remove();
    else if (type === 'delT') this.traps.get(m[1])?.remove();
    else if (type === 'alert') ctx.alert(m[1], V(m[2]), m[3]);
    else if (type === 'spawnP') {
      const [, kind, pos, rot, lin, ang, rocket] = m;
      const pr = ctx.spawnProp(kind, V(pos));
      pr.body.setRotation(rot, true);
      if (rocket) {
        const dir = V(lin), speed = dir.length();
        pr.launch(dir.normalize(), speed);
        pr.ignore = this.avatar?.colHandles;
      } else {
        pr.body.setLinvel(lin, true);
        pr.body.setAngvel(ang, true);
      }
    } else if (type === 'menu') {
      // a spawn-menu item, run here as if from where the guest is looking
      const it = ctx.spawnItems[m[1]];
      if (!it) return;
      ctx.spawnAt = V(m[2]); ctx.spawnYaw = m[3]; ctx.remoteRun = true;
      try { it.run(); } finally { ctx.spawnAt = ctx.spawnYaw = null; ctx.remoteRun = false; }
    } else if (type === 'map') ctx.setMap(m[1]);
    else if (type === 'clear') ctx.clearAll();
    else if (type === 'act') ctx.mission.act(m[1] ? this.rags.get(m[1]) || null : null, this.remote || ctx.player);
    else if (type === 'door') {
      const [, i, action, arg, dmg] = m;
      const d = ctx.doors?.[i];
      if (!d) return;
      if (action === 'shot') d.shot(V(arg), dmg); else d[action](V(arg));
    } else if (type === 'tool') ctx.tools.use(m[1], V(m[2]), V(m[3]), 1);
    else if (type === 'untool') ctx.tools.unlink(V(m[1]), V(m[2]), 1);
    else if (type === 'buy') { if (this.remote) ctx.survival.buy(m[1], this.remote); }
    else if (type === 'tr') {
      // the guest fired: the tracer, and the sound of it
      ctx.weapons.tracer(V(m[1]), V(m[2]));
      const w = WEAPONS[m[3]];
      if (w) { this.quiet = true; try { farAway(this.far(m[1]), () => (m[4] ? sfx.suppressed : sfx[w.sound])?.()); } finally { this.quiet = false; } }
    }
  }

  // ================================================================ GUEST
  async join(code) {
    if (this.role || this.busy) return;
    this.busy = true;
    this.browse();
    this.status('Connecting…');
    this.link = this.newLink();
    this.early = [];                      // (through the relay, the host's first message is what tells us we are in)
    await this.link.join(code, (t) => this.status(t));
    this.role = 'guest';
    this.busy = false;
    this.setupGuest();
    for (const m of this.early) this.onMessage(m);
    this.early = null;
    this.status(this.via === 'relay' ? 'Connected through a relay - press Play' : 'Connected - press Play');
  }

  setupGuest() {
    const ctx = this.ctx, send = (m) => { if (!this.replaying && this.link.open) this.link.send(m); };
    this.send = send;
    this.local = { spawnRagdoll: ctx.spawnRagdoll, spawnProp: ctx.spawnProp, setMap: ctx.setMap, clearAll: ctx.clearAll };
    this.clearLocal();
    // what this player does goes to the host
    ctx.applyHit = (hit, point, dir, dmg, impulse, opts = {}) => {
      const o = ctx.owners.get(hit.collider.handle);
      if (o?.kind === 'chunk') { o.body.applyImpulse({ x: dir.x * 2, y: dir.y * 2 + 1, z: dir.z * 2 }, true); return; }
      if (o?.kind === 'piece') { o.piece.body.applyImpulse({ x: dir.x * 2, y: dir.y * 2 + 1, z: dir.z * 2 }, true); return; }   // (a cut-off piece: the other player's is their own)
      let target = null;
      if (o?.kind === 'part') {
        target = o.ragdoll === this.avatar ? ['pl'] : o.ragdoll.nid ? ['r', o.ragdoll.nid, o.name] : null;
        if (target?.[0] === 'r') {
          ctx.marker('hit');
          if (!opts.blade && !opts.blunt) {               // (no waiting for the host to see a hit land)
            this.goreOK = true;
            try { ctx.gore.mist(point, V({ x: -dir.x, y: 0.15 - dir.y, z: -dir.z }), 4, 2.3, true); } finally { this.goreOK = false; }
            sfx.flesh(o.name === 'head');
          }
        }
      }
      else if (o?.kind === 'prop') target = o.prop.nid ? ['p', o.prop.nid] : null;
      send(['hit', target, P(point), P(dir), dmg, impulse, opts, P(hit.normal)]);
    };
    ctx.alert = (type, pos, radius) => send(['alert', type, P(pos), radius]);
    ctx.explode = () => {};                           // (only the host's world blows up)
    ctx.flashbang = () => {};
    ctx.spawnProp = (type, pos, rotY = 0) => {        // a grenade, rocket or magazine from this player's hands: the host makes the real one
      const p = this.local.spawnProp(type, pos, rotY);
      this.pending.push(p);
      return p;
    };
    ctx.setMap = (id) => send(['map', id]);
    ctx.clearAll = () => send(['clear']);
    ctx.spawnMenu = (i) => { const sp = ctx.spawnPoint(); send(['menu', i, P(sp), ctx.player.yaw]); };
    ctx.mission.act = () => {
      const cam = ctx.camera.getWorldPosition(new THREE.Vector3()), dir = ctx.camera.getWorldDirection(new THREE.Vector3());
      const hit = ctx.raycast(cam, dir, 4);
      const o = hit && ctx.owners.get(hit.collider.handle);
      send(['act', o?.kind === 'part' ? o.ragdoll.nid || 0 : 0]);
    };
    ctx.mission.start = () => send(['menu', ctx.spawnItems.findIndex((it) => it.label === 'Ready or Not'), P(ctx.player.pos), 0]);
    ctx.survival.start = () => send(['menu', ctx.spawnItems.findIndex((it) => it.label === 'Zombie Survival'), P(ctx.player.pos), 0]);
    ctx.survival.buy = (id) => send(['buy', id]);
    ctx.tools.use = (kind, o, d) => send(['tool', kind, P(o), P(d)]);
    ctx.tools.unlink = (o, d) => send(['untool', P(o), P(d)]);
    ctx.weapons.launchDrone = () => ctx.toast('THE DRONE IS THE HOST\'S ONLY IN CO-OP');
    const w = ctx.weapons, tracer = w.tracer.bind(w);
    w.tracer = (from, to) => { tracer(from, to); if (!this.replaying && to) send(['tr', P(from), P(to), w.index, w.can[w.index] ? 1 : 0]); };
    // gore only comes from the host (what gore.js does inside, and its own particles, still happen here)
    let depth = 0;
    const gore = ctx.gore;
    for (const name of GORE) {
      const f = gore[name].bind(gore);
      gore[name] = (...a) => {
        if (depth) return f(...a);
        if (!this.goreOK && name !== 'footprint') return undefined;      // (your own bloody footprints are yours)
        depth++;
        try { return f(...a); } finally { depth--; }
      };
    }
    const upd = gore.update.bind(gore);
    gore.update = (dt) => { depth++; try { upd(dt); } finally { depth--; } };
    // sounds made while copying the host's events are the host's to make (they arrive as their own events)
    this.sfxOrig = {};
    for (const k of Object.keys(sfx)) {
      if (typeof sfx[k] !== 'function') continue;
      const f = this.sfxOrig[k] = sfx[k];
      sfx[k] = (...a) => (this.replaying ? undefined : f.apply(sfx, a));
    }
    this.avatar = this.makeAvatar();
    this.wrapDoors();
    this.aside = true;
  }

  /** Throw away everything this world had: from now on it is the host's world. */
  clearLocal() {
    const ctx = this.ctx;
    for (const r of ctx.ragdolls) (r._destroy || r.destroy).call(r);
    for (const p of ctx.props) (p._remove || p.remove).call(p);
    for (const t of ctx.traps) (t._remove || t.remove).call(t);
    ctx.ragdolls.length = 0; ctx.props.length = 0; ctx.traps.length = 0;
    this.rags.clear(); this.props.clear(); this.traps.clear();
    ctx.tools.clear();
    ctx.gore.clear();
  }

  /** A guest copy of an NPC: moves where it is told, and whatever is done to it is asked of the host. */
  puppetRagdoll(nid, kind, model, pos) {
    const ctx = this.ctx, send = this.send;
    const r = this.local.spawnRagdoll(V(pos), 0, { kind, model });
    r.nid = nid;
    r.puppet = true;
    for (const n of PARTS) r.parts[n].body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    r._destroy = r.destroy;
    r.destroy = () => send(['del', nid]);
    r.hit = (name, dmg, point, dir, impulse = 0, opts = {}) => send(['hitR', nid, name, dmg, P(point), P(dir), impulse, opts]);
    r.scorch = (name, heat, dmg, from) => send(['scorch', nid, name, heat, dmg, P(from)]);
    r.damage = (n, cause) => send(['dmg', nid, n, cause]);
    r.goLimp = r.setMode = r.bitten = r.cry = () => {};
    r.die = () => { r.dead = true; };
    this.rags.set(nid, r);
    return r;
  }

  puppetProp(nid, type, pos) {
    const send = this.send;
    const p = this.local.spawnProp(type, V(pos));
    p.nid = nid;
    p.puppet = true;
    p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    p._remove = p.remove;
    p.remove = () => send(['delP', nid]);
    p.hit = (dmg, point, dir, impulse = 0, opts = {}) => send(['hit', ['p', nid], P(point), P(dir), dmg, impulse, opts, null]);
    this.props.set(nid, p);
    return p;
  }

  puppetTrap(nid, type, pos, yaw) {
    const send = this.send;
    const t = makeTrap(this.ctx, type, V(pos), yaw);
    t.nid = nid;
    t.puppet = true;
    t._remove = t.remove;
    t.remove = () => send(['delT', nid]);
    this.ctx.traps.push(t);
    this.traps.set(nid, t);
    return t;
  }

  /** Make this world look like the host's list of what exists. */
  applyRoster(R) {
    const ctx = this.ctx;
    this.replaying = true;
    try {
      if (R.map !== ctx.map.id) {
        this.clearLocal();
        this.local.setMap(R.map, false);
        this.wrapDoors();
        this.aside = true;                    // (after the next physics step: a new map's floor is not there for rays until then)
      }
      if (!!ctx.night !== R.night) ctx.toggleNight();
      if (!!ctx.rain !== R.rain) ctx.toggleRain();
      // bodies
      const seen = new Set();
      for (const [nid, kind, model, gun, dead, pos, sev, gone] of R.rags) {
        seen.add(nid);
        let r = this.rags.get(nid);
        if (r && (r.kind !== kind || r.model !== model)) { r._destroy(); this.rags.delete(nid); r = null; }     // (turned into a zombie)
        if (!r) {
          r = this.puppetRagdoll(nid, kind, model, pos);
          if (sev.length || gone.length) r.split();
          for (const n of sev) r.sever(n, null);
          for (const n of gone) r.gib(n);
        }
        if (gun && r.gunModel !== gun) r.arm(gun);
        r.dead = !!dead;
      }
      for (const [nid, r] of this.rags) if (!seen.has(nid)) { r._destroy(); this.rags.delete(nid); }
      ctx.ragdolls = ctx.ragdolls.filter((r) => !r.removed);
      // props
      seen.clear();
      for (const [nid, type, pos] of R.props) { seen.add(nid); if (!this.props.has(nid)) this.puppetProp(nid, type, pos); }
      for (const [nid, p] of this.props) if (!seen.has(nid)) { p._remove(); this.props.delete(nid); }
      ctx.props = ctx.props.filter((p) => !p.removed);
      // traps
      seen.clear();
      for (const [nid, type, pos, yaw] of R.traps) { seen.add(nid); if (!this.traps.has(nid)) this.puppetTrap(nid, type, pos, yaw); }
      for (const [nid, t] of this.traps) if (!seen.has(nid)) { t._remove(); this.traps.delete(nid); }
      ctx.traps = ctx.traps.filter((t) => !t.removed);
      // glass and lamps already gone, ropes, the mission
      for (const i of R.panes) { const p = ctx.panes?.[i]; if (p && !p.broken) p.break(); }
      for (const i of R.lamps) { const l = ctx.lamps?.[i]; if (l && !l.off) l.out(); }
      this.links = R.links;
      document.getElementById('mission').textContent = R.mission;
      if (R.kills && (R.kills.P1 !== this.kills.P1 || R.kills.P2 !== this.kills.P2)) { this.kills = R.kills; this.status(); }
      // survival: the team's weapons and points (the shop and what can be picked up follow them)
      const sv = ctx.survival, was = JSON.stringify(sv.remote);
      if (was !== JSON.stringify(R.survival)) {
        sv.remote = R.survival;
        sv.arm(R.survival ? new Set(R.survival.owned) : null);
        if (!sv.shopEl.classList.contains('hidden')) { if (R.survival) sv.fillShop(); else sv.shop(false); }
      }
    } finally { this.replaying = false; }
  }

  /** Guest: start a map a step to the side of where the host starts, if there is floor there and no wall between. */
  stepAside() {
    const ctx = this.ctx, sp = ctx.map.spawn, yaw = ctx.map.yaw;
    for (const side of [1.4, -1.4]) {
      const dx = Math.cos(yaw) * side, dz = -Math.sin(yaw) * side;
      const wall = ctx.gore.castFixed(sp.x, sp.y, sp.z, dx / Math.abs(side), 0, dz / Math.abs(side), Math.abs(side) + 0.4);
      const floor = ctx.gore.castFixed(sp.x + dx, sp.y, sp.z + dz, 0, -1, 0, 1.6);
      if (!wall && floor) { ctx.player.teleport({ x: sp.x + dx, y: sp.y, z: sp.z + dz }, yaw); return; }
    }
  }

  /** Doors here are asked of the host's doors; theirs swing, ours copy the angle. */
  wrapDoors() {
    const doors = this.ctx.doors || [];
    doors.forEach((d, i) => {
      for (const action of ['toggle', 'open', 'kick']) d[action] = (from) => { this.send(['door', i, action, P(from)]); return true; };
      d.shot = (point, dmg) => this.send(['door', i, 'shot', P(point), dmg]);
      d.update = () => {};
    });
  }

  /** What the host says happened. */
  onEvents(list) {
    const ctx = this.ctx;
    this.replaying = true;
    try {
      for (const s of list) {
        const e = JSON.parse(s);
        try { this.play(e); } catch (err) { console.warn('[coop] event', e[0], err); }
      }
    } finally { this.replaying = false; this.goreOK = false; }
  }

  play(e) {
    const ctx = this.ctx;
    const t = e[0];
    if (t === 'g') { this.goreOK = true; ctx.gore[e[1]](...e[2]); this.goreOK = false; }
    else if (t === 's') farAway(this.far(e[3]), () => this.sfxOrig[e[1]]?.apply(sfx, e[2]));
    else if (t === 'w') {
      const [, nid, name, p, radius, maxR, p2, axis, reach] = e;
      const part = this.rags.get(nid)?.parts[name];
      if (part && !part.gone) openWound(part, V(p), radius, maxR, p2 && V(p2), axis && V(axis), reach);
    } else if (t === 'burn') {
      const part = this.rags.get(e[1])?.parts[e[2]];
      if (part && !part.gone) burn(part, e[3]);
    } else if (t === 'split') this.rags.get(e[1])?.split();
    else if (t === 'sever') { const r = this.rags.get(e[1]); if (r && !r.removed) r.sever(e[2], e[3] && V(e[3])); }
    else if (t === 'gib') { const r = this.rags.get(e[1]); if (r && !r.removed && !r.parts[e[2]].gone) r.gib(e[2]); }
    else if (t === 'slice') { const r = this.rags.get(e[1]); if (r && !r.removed) r.slice(e[2], e[3], e[4] && V(e[4]), e[5]); }
    else if (t === 'gclear') ctx.gore.clear();
    else if (t === 'toast') ctx.toast(e[1]);
    else if (t === 'feed') ctx.feed(e[1]);
    else if (t === 'mark') ctx.marker(e[1]);
    else if (t === 'tr') ctx.weapons.tracer(V(e[1]), V(e[2]));
    else if (t === 'hurt') ctx.player.hurt(e[1], e[2]);
    else if (t === 'blast') ctx.blastPlayer(V(e[1]), e[2], e[3]);
    else if (t === 'launch') { ctx.player.vel.set(e[1].x, e[1].y, e[1].z); ctx.player.grounded = false; }
    else if (t === 'heal') ctx.player.health = 100;
    else if (t === 'fb') {
      const p = e[1], g = ctx.gore;
      g.flash.position.set(p.x, p.y + 0.3, p.z); g.flash.intensity = 700; g.flashT = 0.35;
      for (let i = 0; i < 10; i++) g.smoke.emit(p.x, p.y + 0.1, p.z, rnd(-1, 1), rnd(0, 1.2), rnd(-1, 1), rnd(0.25, 0.45), rnd(2, 4), -0.1, 0.8, 0.8, 0.8, 0, 1.5);
      ctx.flashPlayer(p);
    } else if (t === 'pane') ctx.panes?.[e[1]]?.break();
    else if (t === 'lamp') ctx.lamps?.[e[1]]?.out();
  }

  /** Where everything is now (the host's stream). */
  onStateGuest(i) {
    const ctx = this.ctx;
    if (i.u8() === 1) {
      const s = readPlayer(i);
      if (this.avatar) this.avatar.net = s;
      const nd = i.u16();
      for (let k = 0; k < nd; k++) {
        const a = i.f(), d = ctx.doors?.[k];
        if (d && Math.abs(d.angle - a) > 1e-4) {
          d.angle = d.target = a;
          d.body.setRotation(_q.setFromAxisAngle(UP, d.yaw + a), true);
          d.group.rotation.y = d.yaw + a;
        }
      }
      const nt = i.u16();
      for (let k = 0; k < nt; k++) { const nid = i.u16(), v = i.f(), tr = this.traps.get(nid); if (tr) tr.v = v; }
    }
    const nr = i.u16();
    for (let k = 0; k < nr; k++) {
      const nid = i.u16(), flags = i.u8(), mask = i.u16(), r = this.rags.get(nid);
      PARTS.forEach((n, b) => {
        if (!(mask & (1 << b))) return;
        const x = i.cm(), y = i.cm(), z = i.cm();
        const q = i.q(new THREE.Quaternion());
        const p = r?.parts[n];
        if (!p || p.gone) return;
        if (!p.net) p.net = { p: new THREE.Vector3(x, y, z), q, cp: new THREE.Vector3(x, y, z), cq: q.clone() };
        else { p.net.p.set(x, y, z); p.net.q.copy(q); }
      });
      if (r) { r.burning = !!(flags & 2); r.dead = !!(flags & 1); }
    }
    const np = i.u16();
    for (let k = 0; k < np; k++) {
      const nid = i.u16(), x = i.cm(), y = i.cm(), z = i.cm();
      const q = i.q(new THREE.Quaternion()), p = this.props.get(nid);
      if (!p || p.removed) continue;
      if (!p.net) p.net = { p: new THREE.Vector3(x, y, z), q, cp: new THREE.Vector3(x, y, z), cq: q.clone() };
      else { p.net.p.set(x, y, z); p.net.q.copy(q); }
    }
  }

  /** Ease a puppet body toward where the host last put it. */
  follow(body, net, k) {
    if (net.cp.distanceToSquared(net.p) > 9) { net.cp.copy(net.p); net.cq.copy(net.q); }   // (a jump: go straight there)
    net.cp.lerp(net.p, k);
    net.cq.slerp(net.q, k);
    body.setNextKinematicTranslation(net.cp);
    body.setNextKinematicRotation(net.cq);
  }

  /** Ropes and welds as the host has them (drawn only: the host's are the ones that pull). */
  drawLinks() {
    const ctx = this.ctx, tools = ctx.tools, list = this.links || [];
    const at = (e, out) => {
      if (e.w) return out.set(e.w.x, e.w.y, e.w.z);
      const body = e.r ? this.rags.get(e.r)?.parts[e.n]?.body : this.props.get(e.p)?.body;
      if (!body || ctx.world.getRigidBody(body.handle) !== body) return null;
      return tools.toWorld(body, V(e.l), out);
    };
    while (this.linkMeshes.length < list.length) {
      const m = new THREE.Mesh(tools.ropeGeo, tools.ropeMat);
      ctx.scene.add(m);
      this.linkMeshes.push(m);
    }
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.linkMeshes.forEach((m, k) => {
      const l = list[k];
      m.visible = !!l && !!at(l[1], a) && !!at(l[2], b);
      if (!m.visible) return;
      if (l[0] === 'rope') { m.geometry = tools.ropeGeo; m.material = tools.ropeMat; m.position.copy(a); m.lookAt(b); m.scale.set(1, 1, Math.max(0.01, a.distanceTo(b))); }
      else { m.geometry = tools.weldGeo; m.material = tools.weldMat; m.position.copy(b); m.scale.set(1, 1, 1); }
    });
  }

  // ================================================================ both
  /** The other player as a body here: a soldier with a rifle, walking where they walk, looking where they look. */
  makeAvatar() {
    const ctx = this.ctx;
    const av = new Ragdoll(ctx, { x: 0, y: -50, z: 0 }, 0, { kind: 'swat', model: 'Ch15' });
    av.arm('Rifle');
    // a body you can see and shoot (rays still find sensors) but not one you get stuck in: you both start a map on the same spot
    for (const n in av.parts) for (const c of av.parts[n].colliders) c.setSensor(true);
    av.avatar = true;
    av.net = null;
    av.brain.update = () => {};
    av.cry = av.die = av.damage = av.goLimp = av.checkKnocks = av.bitten = () => {};
    av._destroy = av.destroy;
    av.destroy = () => {};                 // (X, or a clear: the other player is not yours to delete)
    av.look = new THREE.Vector3();
    // a tag over their head, seen through walls, the same size however far: P1 is the host, P2 the one who joined
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0, 0, 0, 0.55)';
    g.beginPath(); g.roundRect(14, 8, 100, 48, 10); g.fill();
    g.fillStyle = '#3ddc84';
    g.font = '700 38px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(this.role === 'host' ? 'P2' : 'P1', 64, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    av.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false }));
    av.tag.scale.set(0.095, 0.0475, 1);
    av.tag.renderOrder = 10;
    av.tag.visible = false;
    ctx.scene.add(av.tag);
    av.move = (dt) => {
      const n = av.net;
      if (!n) return;
      const k = Math.min(1, dt * 14);
      if (Math.hypot(n.x - av.root.x, n.z - av.root.z) > 4) av.root.set(n.x, n.y - 0.87, n.z);
      av.root.x += (n.x - av.root.x) * k;
      av.root.z += (n.z - av.root.z) * k;
      av.root.y += (n.y - 0.87 - av.root.y) * k;          // (the capsule: 0.5 + 0.35 radius below its middle, and the controller's skin)
      av.heading = av.targetHeading = n.yaw;
      av.speed = Math.min(9, Math.hypot(n.vx, n.vz));
      const run = Math.min(1, Math.max(0, (av.speed - 1.7) / 2));
      av.phase += av.speed * dt * Math.PI * 2 / (1.9 + 1.4 * run);
      av.gesture = n.flags & 1 ? 'none' : 'aim';
      const c = Math.cos(n.pitch);
      av.look.set(n.x - Math.sin(n.yaw) * c * 5, n.y + 0.7 + Math.sin(n.pitch) * 5, n.z - Math.cos(n.yaw) * c * 5);
    };
    // hit by this side: on the host it hurts the other player (friendly fire, at half); the guest's go through applyHit
    av.hit = (name, dmg, point, dir) => {
      ctx.gore.blood(point, dir, 8, 3, 0.8);
      if (this.role === 'host') this.remote?.hurt(dmg * (name === 'head' ? 1 : 0.5), ctx.player.pos);
    };
    return av;
  }

  /** How loud a sound from p is for this player: full up close, half at 20 m, a whisper across the map. */
  far(p) {
    if (!p) return 1;
    const me = this.ctx.player.pos, d2 = (p.x - me.x) ** 2 + (p.y - me.y) ** 2 + (p.z - me.z) ** 2;
    return Math.max(0.06, 1 / (1 + d2 / 400));
  }

  /** Before the physics step. */
  pre(dt) {
    if (!this.role) return;
    const av = this.avatar;
    if (av && !av.removed) { av.update(dt); av.preStep(); }
    if (this.role !== 'guest') return;
    const k = 1 - Math.exp(-dt * 18);
    for (const r of this.rags.values()) {
      if (r.removed) continue;
      for (const n of PARTS) { const p = r.parts[n]; if (!p.gone && p.net) this.follow(p.body, p.net, k); }
      if (r.burning && Math.random() < 0.7) {
        const p = r.parts[PARTS[(Math.random() * PARTS.length) | 0]];
        if (!p.gone) {
          const t = p.body.translation(), hot = Math.random();
          this.ctx.gore.fire.emit(t.x + rnd(-0.08, 0.08), t.y + rnd(-0.1, 0.1), t.z + rnd(-0.08, 0.08), rnd(-0.4, 0.4), rnd(1.2, 2.6), rnd(-0.4, 0.4),
            rnd(0.18, 0.4), rnd(0.3, 0.6), -1.5, 1, 0.35 + hot * 0.4, hot * 0.1, 0, 1);
        }
      }
    }
    for (const p of this.props.values()) if (!p.removed && p.net) this.follow(p.body, p.net, k);
  }

  /** After the physics step: send what the other side needs. */
  post(dt) {
    if (!this.role) return;
    const ctx = this.ctx;
    const av = this.avatar;
    if (av && !av.removed) {
      av.sync();
      const head = av.parts.head;
      av.tag.visible = !!av.net && !ctx.helmet && !head.gone;        // (none in bodycam footage)
      if (av.tag.visible) { const h = head.body.translation(); av.tag.position.set(h.x, h.y + 0.45, h.z); }
    }
    if (!this.link?.open) return;
    if (this.role === 'host') {
      // anything gone since last time changes the roster
      for (const map of [this.rags, this.props, this.traps]) for (const [nid, o] of map) if (o.removed) { map.delete(nid); this.dirty = true; }
      const sig = `${ctx.map.id}|${!!ctx.night}|${!!ctx.rain}|${ctx.tools.links.length}|${ctx.tools.links.at(-1)?.joint.handle}|${document.getElementById('mission').textContent}`;     // (the mission or survival panel too)
      if (sig !== this.sig) { this.sig = sig; this.dirty = true; }
      if (this.watchedPanes !== ctx.panes) this.watchMap();
      this.rosterT -= dt;
      if ((this.dirty && this.rosterT < 1.8) || this.rosterT <= 0) { this.rosterT = 2; this.dirty = false; this.link.send(['roster', this.roster()]); }
      if (this.events.length) { this.link.send(['ev', this.events]); this.events = []; }
      if ((this.snapT -= dt) <= 0) { this.snapT = this.via === 'relay' ? SNAP * 2 : SNAP; this.snapshot(); }
    } else {
      // props this player's weapons made: the host makes the real ones
      for (const p of this.pending) {
        if (p.removed) continue;
        const t = p.body.translation(), r = p.body.rotation();
        this.send(['spawnP', p.type, P(t), { x: r.x, y: r.y, z: r.z, w: r.w }, P(p.body.linvel()), P(p.body.angvel()), p.life !== undefined ? 1 : 0]);
        p.remove();
      }
      this.pending.length = 0;
      if (this.aside) { this.aside = false; this.stepAside(); }
      ctx.props = ctx.props.filter((p) => !p.removed);
      if ((this.snapT -= dt) <= 0) {
        this.snapT = SNAP;
        const o = new Out(64);
        o.u8(2);
        writePlayer(o, ctx.player, ctx.weapons);
        this.link.stream(o.done());
      }
      this.drawLinks();
    }
  }

  /** Host: glass and lamps on a freshly built map tell the other side when they go. */
  watchMap() {
    const ctx = this.ctx;
    this.watchedPanes = ctx.panes;
    (ctx.panes || []).forEach((p, i) => { const f = p.break.bind(p); p.break = (pt) => { if (!p.broken) this.q(['pane', i]); return f(pt); }; });
    (ctx.lamps || []).forEach((l, i) => { const f = l.out.bind(l); l.out = (pt) => { if (!l.off) this.q(['lamp', i]); return f(pt); }; });
  }

  onMessage(m) {
    if (!Array.isArray(m)) return;
    if (!this.role && this.early) { this.early.push(m); return; }
    if (this.role === 'host') { try { this.onRequest(m); } catch (e) { console.warn('[coop] request', m[0], e); } return; }
    if (m[0] === 'hello' || m[0] === 'roster') this.applyRoster(m[1]);
    else if (m[0] === 'ev') this.onEvents(m[1]);
  }

  onState(buf) {
    if (!(buf instanceof ArrayBuffer)) return;
    const i = new In(buf);
    const kind = i.u8();
    if (kind === 2 && this.role === 'host') this.onStateHost(i);
    else if (kind === 1 && this.role === 'guest') this.onStateGuest(i);
  }
}
