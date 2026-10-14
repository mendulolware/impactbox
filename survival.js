import { isTouch } from './touch.js';

// Zombie Survival (spawn menu, Modes, or the start screen): waves of the undead, bigger every round.
//
// The map is reset and emptied of people. Wave n sends 4 + 3n zombies, never more than CAP on their feet at
// once (the rest come as those fall), each from somewhere out of sight 12-26 m from the nearest player, on
// the players' own floor. Clear a wave and the next comes after a breather. Three lives, shared in co-op:
// each death costs one, and when they are gone it is over. The best wave reached is kept in this browser.
// It runs in the host's game; in co-op the panel and the messages reach the other player like the mission's.

const BREAK = 6;                       // seconds between waves
const LIVES = 3;
const CAP = isTouch ? 8 : 14;          // zombies up at once (phones draw fewer)

export class Survival {
  constructor(ctx) {
    this.ctx = ctx;
    this.on = false;
    this.over = false;
    this.el = document.getElementById('mission');
    try { this.best = +(localStorage.getItem('impactbox.bestWave') || 0); } catch (e) { this.best = 0; }
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
    this.alive = [];
    this.breakT = 3;
    this.spawnT = 0;
    this.hudT = 0;
    this.dead = new Map();                        // player -> dead last frame (a death costs a life once)
    ctx.toast('ZOMBIE SURVIVAL');
    this.refresh();
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.el.textContent = '';
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
        if (this.wave > this.best) this.save();
        ctx.toast(`WAVE ${this.wave}`);
        ctx.sfx.growl(0.9, 0.7);
      }
    } else {
      if (this.queue > 0 && this.alive.length < CAP && (this.spawnT -= dt) <= 0) {
        this.spawnT = 0.5;
        const p = this.spot();
        if (p) { this.alive.push(ctx.spawnRagdoll(p, Math.random() * Math.PI * 2, { kind: 'zombie' })); this.queue--; }
      }
      if (this.queue === 0 && this.alive.length === 0) {
        this.breakT = BREAK;
        ctx.toast(`WAVE ${this.wave} CLEARED`);
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
    this.el.textContent = `ZOMBIE SURVIVAL\nWave ${this.wave}   ${left}\nLives ${'♥ '.repeat(this.lives).trim()}\nBest  wave ${this.best}`;
  }

  finish() {
    this.over = true;
    this.ctx.toast(`OVERRUN - WAVE ${this.wave}`);
    this.el.textContent = `ZOMBIE SURVIVAL\nOverrun on wave ${this.wave}\nBest  wave ${this.best}\n[Enter] go again`;
  }
}
