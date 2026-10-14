import { isTouch } from './touch.js';
import { WEAPONS } from './weapons.js';

// Zombie Survival (spawn menu, Modes, or the start screen): waves of the undead, bigger every round.
//
// The map is reset and emptied of people. Wave n sends 4 + 3n zombies, never more than CAP on their feet at
// once (the rest come as those fall), each from somewhere out of sight 12-26 m from the nearest player, on
// the players' own floor. From wave 3 some are runners; every fifth wave brings brutes (armoured, three times
// as hard to put down). Clear a wave and the next comes after a breather. Three lives, shared in co-op: each
// death costs one, and when they are gone it is over. The best wave reached is kept in this browser.
//
// Points: 10 a zombie, 15 for a head shot. You start with a pistol and a knife and buy the rest in the shop
// (Y, any time): weapons (owned by the team: in co-op both players get them), a medkit, a barricade of crates.
// It runs in the host's game; in co-op the panel, the points and what is owned reach the other player with
// the roster, and the other player's purchases are asked of the host (coop.js).

const BREAK = 6;                       // seconds between waves
const LIVES = 3;
const CAP = isTouch ? 8 : 14;          // zombies up at once (phones draw fewer)
const START = ['Pistol', 'Knife'];
export const SHOP = [
  { id: 'katana', label: 'Katana', weapon: 'Katana', cost: 120 },
  { id: 'shotgun', label: 'Shotgun', weapon: 'Shotgun', cost: 150 },
  { id: 'smg', label: 'SMG', weapon: 'SMG', cost: 200 },
  { id: 'dbarrel', label: 'Double Barrel', weapon: 'Double Barrel', cost: 250 },
  { id: 'grenade', label: 'Grenades', weapon: 'Grenade', cost: 250 },
  { id: 'ar15', label: 'AR-15', weapon: 'AR-15', cost: 300 },
  { id: 'sniper', label: 'Sniper', weapon: 'Sniper', cost: 350 },
  { id: 'chainsaw', label: 'Chainsaw', weapon: 'Chainsaw', cost: 400 },
  { id: 'flame', label: 'Flamethrower', weapon: 'Flamethrower', cost: 500 },
  { id: 'rocket', label: 'Rocket Launcher', weapon: 'Rocket', cost: 700 },
  { id: 'minigun', label: 'Minigun', weapon: 'Minigun', cost: 800 },
  { id: 'medkit', label: 'Medkit', small: 'full health', cost: 100 },
  { id: 'barricade', label: 'Barricade', small: 'crates in front of you', cost: 80 },
];
const weaponIndex = (name) => WEAPONS.findIndex((w) => w.name === name);

export class Survival {
  constructor(ctx) {
    this.ctx = ctx;
    this.on = false;
    this.over = false;
    this.points = 0;
    this.owned = new Set(START);
    this.remote = null;            // co-op guest: the host's survival state (points, owned), from the roster
    this.el = document.getElementById('mission');
    try { this.best = +(localStorage.getItem('impactbox.bestWave') || 0); } catch (e) { this.best = 0; }
    this.buildShop();
  }

  start() {
    const ctx = this.ctx;
    ctx.mission.stop();
    ctx.setMap(ctx.map.id);                       // a fresh copy of the map...
    for (const r of ctx.ragdolls) r.destroy();    // ...with nobody in it but what is coming
    this.on = true;
    this.over = false;
    this.wave = 0;
    this.lives = LIVES;
    this.queue = 0;
    this.brutes = 0;
    this.alive = [];
    this.breakT = 3;
    this.spawnT = 0;
    this.hudT = 0;
    this.points = 0;
    this.owned = new Set(START);
    this.dead = new Map();                        // player -> dead last frame (a death costs a life once)
    this.arm(this.owned);
    ctx.toast('ZOMBIE SURVIVAL');
    this.refresh();
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.el.textContent = '';
    this.arm(null);
    this.shop(false);
  }

  /** Only what the team owns can be picked up (null: everything, as in the sandbox). */
  arm(owned) {
    const w = this.ctx.weapons;
    w.allowed = owned ? new Set([...owned].map(weaponIndex).filter((i) => i >= 0)) : null;
    if (w.allowed && !w.allowed.has(w.index)) w.select(weaponIndex('Pistol'));
    w.refreshBar();
  }

  players() { return [this.ctx.player, ...(this.ctx.remotes || [])]; }

  /** Somewhere for one to come from: on the players' floor, 12-26 m from the nearest, and if possible out of sight. */
  spot() {
    const ctx = this.ctx, b = ctx.map.def.bounds, pls = this.players().filter((p) => !p.dead);
    const ref = pls[0] || ctx.player, floor = ref.pos.y - 0.87;
    for (let tries = 0; tries < 40; tries++) {
      const x = b.x0 + Math.random() * (b.x1 - b.x0), z = b.z0 + Math.random() * (b.z1 - b.z0);
      const d = Math.min(...pls.map((p) => Math.hypot(p.pos.x - x, p.pos.z - z)));
      if (d < 12 || d > 26) continue;
      const hit = ctx.gore.castFixed(x, floor + 5, z, 0, -1, 0, 8);
      if (!hit) continue;
      const y = floor + 5 - hit.timeOfImpact;
      if (Math.abs(y - floor) > 0.8) continue;     // a roof, a wall top, a pit: not where the players are
      const seen = tries < 25 && pls.some((p) => {
        const dx = x - p.eye.x, dy = y + 1.3 - p.eye.y, dz = z - p.eye.z, l = Math.hypot(dx, dy, dz);
        return !ctx.gore.castFixed(p.eye.x, p.eye.y, p.eye.z, dx / l, dy / l, dz / l, l);
      });
      if (seen) continue;
      return { x, y: y + 0.05, z };
    }
    return null;
  }

  /** A zombie went down (main.js onKill). */
  kill(cause) {
    if (!this.on || this.over) return;
    this.points += cause === 'headshot' || cause === 'decap' ? 15 : 10;
  }

  update(dt) {
    if (!this.on || this.over) return;
    const ctx = this.ctx;
    // every death costs one of the shared lives
    for (const p of this.players()) {
      if (p.dead && !this.dead.get(p)) {
        this.lives--;
        const who = p === ctx.player ? (ctx.remotes?.length ? 'P1' : 'YOU') : 'P2';
        if (this.lives > 0) ctx.toast(`${who} DOWN - ${this.lives} ${this.lives === 1 ? 'LIFE' : 'LIVES'} LEFT`);
      }
      this.dead.set(p, p.dead);
    }
    if (this.lives <= 0) { this.finish(); return; }

    this.alive = this.alive.filter((r) => !r.removed && !r.dead);
    if (this.breakT > 0) {
      if ((this.breakT -= dt) <= 0) {
        this.wave++;
        this.queue = 4 + this.wave * 3;
        this.brutes = this.wave % 5 === 0 ? 1 + this.wave / 5 : 0;
        if (this.wave > this.best) this.save();
        ctx.toast(this.brutes ? `WAVE ${this.wave} - BRUTES` : `WAVE ${this.wave}`);
        ctx.sfx.growl(0.9, 0.7);
      }
    } else {
      if (this.queue > 0 && this.alive.length < CAP && (this.spawnT -= dt) <= 0) {
        this.spawnT = 0.5;
        const p = this.spot();
        if (p) {
          // the odd brute (the armoured soldier, three times as hard to put down), and from wave 3 some that run
          const brute = this.brutes > 0 && Math.random() < 0.3;
          const z = ctx.spawnRagdoll(p, Math.random() * Math.PI * 2, brute ? { kind: 'zombie', model: 'Ch15' } : { kind: 'zombie' });
          if (brute) { z.tough = 3; this.brutes--; } else if (this.wave >= 3 && Math.random() < 0.25) z.brain.runner = true;
          this.alive.push(z);
          this.queue--;
        }
      }
      if (this.queue === 0 && this.alive.length === 0) {
        this.breakT = BREAK;
        ctx.toast(`WAVE ${this.wave} CLEARED - [Y] SHOP`);
      }
    }
    if ((this.hudT -= dt) <= 0) { this.hudT = 0.3; this.refresh(); }
  }

  save() {
    this.best = this.wave;
    try { localStorage.setItem('impactbox.bestWave', String(this.best)); } catch (e) { /* private window */ }
  }

  refresh() {
    if (!this.on || this.over) return;
    const left = this.breakT > 0 ? (this.wave ? `cleared - next in ${Math.ceil(this.breakT)}` : `starts in ${Math.ceil(this.breakT)}`) : `${this.alive.length + this.queue} left`;
    this.el.textContent = `ZOMBIE SURVIVAL\nWave ${this.wave}   ${left}\nLives ${'♥ '.repeat(this.lives).trim()}\nPoints ${this.points}   [Y] shop\nBest  wave ${this.best}`;
    if (this.shopEl && !this.shopEl.classList.contains('hidden')) this.fillShop();
  }

  finish() {
    this.over = true;
    this.shop(false);
    this.ctx.toast(`OVERRUN - WAVE ${this.wave}`);
    this.el.textContent = `ZOMBIE SURVIVAL\nOverrun on wave ${this.wave}\nBest  wave ${this.best}\n[Enter] go again`;
  }

  // ---------------------------------------------------------------- the shop
  /** What the shop shows: this game's survival, or (co-op guest) the host's. */
  state() { return this.remote || (this.on && !this.over ? { points: this.points, owned: [...this.owned] } : null); }

  /**
   * Buy something (on the host: for `who`, the local player or the co-op proxy of the other one).
   * Weapons go to the whole team; a medkit heals the buyer; a barricade goes up in front of them.
   */
  buy(id, who = this.ctx.player) {
    const ctx = this.ctx, it = SHOP.find((s) => s.id === id);
    if (!it || !this.on || this.over) return false;
    if (it.weapon && this.owned.has(it.weapon)) return false;
    if (this.points < it.cost) { if (who === ctx.player) ctx.toast('NOT ENOUGH POINTS'); return false; }
    this.points -= it.cost;
    if (it.weapon) { this.owned.add(it.weapon); this.arm(this.owned); }
    else if (id === 'medkit') { if (who === ctx.player) ctx.player.health = 100; else who.heal?.(); }
    else if (id === 'barricade') {
      // three crates wide, two high, a couple of metres in front of the buyer, across their path
      const yaw = who.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const c = { x: who.pos.x + fx * 2.2, y: who.pos.y - 0.87, z: who.pos.z + fz * 2.2 };
      for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
        const off = (col - 1) * 0.62;
        ctx.spawnProp('crate', { x: c.x + rx * off, y: c.y + 0.32 + row * 0.62, z: c.z + rz * off }, yaw);
      }
    }
    ctx.sfx.reload();
    ctx.toast(`${it.label.toUpperCase()} BOUGHT`);
    this.refresh();
    return true;
  }

  buildShop() {
    const el = this.shopEl = document.createElement('div');
    el.id = 'shop';
    el.className = 'hidden';
    el.innerHTML = `<div class="panel"><h2>Shop <span class="sub" id="shop-points"></span><button id="shop-close">Done</button></h2><div class="grid" id="shop-grid"></div></div>`;
    document.body.appendChild(el);
    el.querySelector('#shop-close').addEventListener('click', () => this.shop(false));
    el.addEventListener('click', (e) => { if (e.target === el) this.shop(false); });
  }

  fillShop() {
    const st = this.state() || { points: 0, owned: [] };
    this.shopEl.querySelector('#shop-points').textContent = `${st.points} points`;
    const grid = this.shopEl.querySelector('#shop-grid');
    grid.replaceChildren(...SHOP.map((it) => {
      const own = it.weapon && st.owned.includes(it.weapon), poor = !own && st.points < it.cost;
      const b = document.createElement('div');
      b.className = `item${own ? ' owned' : ''}${poor ? ' poor' : ''}`;
      b.innerHTML = `${it.label}<small>${own ? 'owned' : `${it.cost} points${it.small ? ' - ' + it.small : ''}`}</small>`;
      if (!own) b.addEventListener('click', () => this.buy(it.id));
      return b;
    }));
  }

  /** Open or close the shop (Y). Only while there is a survival game to shop in. */
  shop(open = this.shopEl.classList.contains('hidden')) {
    if (open && !this.state()) return;
    this.shopEl.classList.toggle('hidden', !open);
    this.ctx.setOverlay(open);
    if (open) this.fillShop();
  }
}
