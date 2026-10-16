import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// NPC decision making. A Brain never moves anything itself: each frame it looks at the world and
// tells its body what it wants (heading, speed, gesture, where to look). ragdoll.js does the rest.
//
//   civilian  calm -> alert -> flee, hide behind cover or freeze;  surrenders when a gun is aimed at them;  cowers when cornered;
//             once calm again, goes to look at the dead and drags the wounded away
//   suspect   (armed, mission.js) fights from cover when there is some: out to shoot, back in
//   thug      calm until provoked, then runs the player down and punches;  flees when badly hurt
//   zombie    hunts the nearest living thing, bites, and infects (the bitten rise again)

export const WALK = 1.3, RUN = 3.9;

const rnd = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const headingTo = (dx, dz) => Math.atan2(-dx, -dz); // forward is (-sin h, -cos h)

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Brain {
  constructor(npc, kind) {
    this.npc = npc;
    this.ctx = npc.ctx;
    this.kind = kind;
    this.state = 'calm';
    this.t = rnd(1, 4);          // general-purpose state timer
    this.walking = false;
    this.wanderHeading = npc.heading;
    this.threat = new THREE.Vector3();
    this.fear = 0;
    this.anger = 0;
    this.aimed = false;          // is the player pointing a gun at me?
    this.target = null;          // zombie prey: the player object or another NPC
    this.attackT = rnd(0.2, 0.8);
    this.strikeT = 0;            // time until a started attack lands
    this.scanT = rnd(0, 0.25);
    this.probeT = rnd(0, 0.1);
    this.avoid = 0;              // steering offset to get around obstacles
    this.blockedT = 0;
    // what the body should do this frame
    this.goal = { mode: 'wander', pos: new THREE.Vector3(), speed: 0, face: false };
    this.lookV = new THREE.Vector3();
  }

  // ------------------------------------------------------------ senses
  eye(out) {
    const r = this.npc.root;
    return out.set(r.x, r.y + 1.6, r.z);
  }

  /** Nothing solid between my eyes and that point? */
  los(p) {
    this.eye(_v);
    _d.set(p.x - _v.x, p.y - _v.y, p.z - _v.z);
    const dist = _d.length();
    if (dist < 0.3) return true;
    _d.multiplyScalar(1 / dist);
    return !this.ctx.gore.castFixed(_v.x, _v.y, _v.z, _d.x, _d.y, _d.z, dist - 0.2);
  }

  /** In front of me (or right next to me), within range, and not behind a wall. */
  canSee(p, range = 40) {
    const r = this.npc.root;
    const dx = p.x - r.x, dz = p.z - r.z;
    const dist = Math.hypot(dx, dz);
    if (this.ctx.night) range *= 0.45;          // nobody sees far in the dark
    if (dist > range) return false;
    if (dist > 4 && Math.abs(wrap(headingTo(dx, dz) - this.npc.heading)) > 1.9) return false;
    return this.los(p);
  }

  distTo(p) {
    const r = this.npc.root;
    return Math.hypot(p.x - r.x, p.z - r.z);
  }

  /** Whichever player (you, or a friend in co-op: ctx.remotes) is nearest and still alive. */
  nearest() {
    let best = this.ctx.player;
    if (!this.ctx.remotes?.length) return best;
    let bd = best.dead ? 1e9 : this.distTo(best.pos);
    for (const p of this.ctx.remotes) {
      if (p.dead) continue;
      const d = this.distTo(p.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Is the player holding a gun on me? Aiming down the sights counts from further away. */
  playerAimingAtMe() {
    const player = this.pl || this.ctx.player, mine = player === this.ctx.player;
    const gun = mine ? this.ctx.weapons.current.type === 'gun' : player.gun, ads = mine ? this.ctx.weapons.ads : player.ads;
    if (player.dead || !gun) return false;
    const r = this.npc.root;
    _d.set(r.x - player.pos.x, r.y + 1.2 - (player.pos.y + 0.7), r.z - player.pos.z);
    const dist = _d.length();
    if (dist > (ads > 0.5 ? 16 : 9)) return false;
    _d.multiplyScalar(1 / dist);
    _v.set(0, 0, -1).applyQuaternion(player.aimQuat);
    if (_v.dot(_d) < Math.cos(ads > 0.5 ? 0.1 : 0.07 + 0.5 / dist)) return false;
    return this.los({ x: player.pos.x, y: player.pos.y + 0.7, z: player.pos.z });
  }

  /** The world telling me something happened. */
  notice(type, pos, radius = 30) {
    const n = this.npc;
    const dist = this.distTo(pos);
    if (type !== 'hurt') {
      if (dist > radius) return;
      // gunfire and blasts are heard through walls; a death has to be witnessed
      if ((type === 'death' || type === 'violence') && dist > 6 && !this.canSee(pos, radius)) return;
    }
    if (this.kind === 'zombie' || this.kind === 'swat') return; // zombies do not care, and the squad is here for this
    this.threat.set(pos.x, pos.y, pos.z);
    if (this.kind === 'thug' && n.health > 35) {
      // deaths nearby make a thug wary, but only being shot at (or hit) starts a fight
      if (type === 'shot' && dist > 14) return;
      if (type === 'death' && dist > 8) return;
      this.anger = 25;
      if (this.state !== 'attack') { this.state = 'attack'; this.attackT = rnd(0.3, 0.7); }
      return;
    }
    this.fear = 1;
    if (this.state === 'calm') {
      this.state = 'alert';                       // freeze and look before running
      this.t = type === 'hurt' ? 0.05 : rnd(0.25, 0.8);
    } else if (this.state === 'surrender' && (type === 'shot' || type === 'explosion') && dist < 12) {
      if (Math.random() < 0.5) { this.state = 'cower'; this.t = rnd(3, 6); }
    } else if ((this.state === 'cower' || this.state === 'surrender' || this.state === 'hide' || this.state === 'check' || this.state === 'help') && type === 'hurt') {
      this.state = 'flee';   // being hit ends any thought of standing still
    }
  }

  /** The body could not go where I pointed it (ledge, step too high). */
  bump() {
    this.avoid = (this.avoid >= 0 ? 1 : -1) * rnd(1.8, 2.8);
    this.wanderHeading = this.npc.heading + rnd(1.5, 3) * (Math.random() < 0.5 ? -1 : 1);
    this.blockedT += 0.3;
  }

  // ------------------------------------------------------------ cover
  /** Nothing fixed between two points? */
  clear(a, b) {
    _d.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const dist = _d.length();
    if (dist < 0.3) return true;
    _d.multiplyScalar(1 / dist);
    return !this.ctx.gore.castFixed(a.x, a.y, a.z, _d.x, _d.y, _d.z, dist - 0.2);
  }

  /** Standing room at (x, z) near my own level: the ground height there, or null. */
  floorAt(x, z) {
    const r = this.npc.root, b = this.ctx.map.bounds;
    if (x < b.x0 + 1 || x > b.x1 - 1 || z < b.z0 + 1 || z > b.z1 - 1) return null;
    const gy = this.npc.groundBelow(x, r.y + 0.8, z, 2.2);
    return gy === null || Math.abs(gy - r.y) > 0.5 ? null : gy;
  }

  /**
   * Somewhere close I can walk straight to where a crouching person cannot be seen from `threat`.
   * A handful of random tries, nearest wins; null if this is open ground.
   */
  findCover(threat, range = 11) {
    const r = this.npc.root;
    const from = { x: threat.x, y: threat.y + 1.5, z: threat.z };
    let best = null, bd = Infinity;
    for (let i = 0; i < 18; i++) {
      const a = rnd(0, Math.PI * 2), d = rnd(1.5, range);
      if (d >= bd) continue;
      const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
      const gy = this.floorAt(x, z);
      if (gy === null) continue;
      const p = { x, y: gy + 0.9, z };
      if (this.clear(p, from) || !this.clear({ x: r.x, y: r.y + 0.9, z: r.z }, p)) continue;
      best = new THREE.Vector3(x, gy, z); bd = d;
    }
    return best;
  }

  /** Cover to fight from: a place to hide and, a step to one side of it, a place to shoot from. */
  findPost(threat) {
    const hide = this.findCover(threat, 9);
    if (!hide) return null;
    const dx = threat.x - hide.x, dz = threat.z - hide.z, l = Math.hypot(dx, dz) || 1;
    for (const k of [1, -1, 1.7, -1.7]) {
      const x = hide.x - dz / l * k, z = hide.z + dx / l * k;
      const gy = this.floorAt(x, z);
      if (gy === null) continue;
      if (this.clear({ x, y: gy + 1.5, z }, { x: threat.x, y: threat.y + 1.5, z: threat.z })
        && this.clear({ x: hide.x, y: hide.y + 0.9, z: hide.z }, { x, y: gy + 0.9, z })) return { hide, peek: new THREE.Vector3(x, gy, z) };
    }
    return null;
  }

  // ------------------------------------------------------------ behaviours
  wander(dt) {
    this.t -= dt;
    if (this.t <= 0) {
      this.walking = !this.walking;
      this.t = this.walking ? rnd(3, 7) : rnd(1.5, 4);
      if (this.walking) this.wanderHeading = this.npc.heading + rnd(-2.2, 2.2);
    }
    const r = this.npc.root;
    const spot = this.npc.spot;          // somewhere they belong (a clubber on the dance floor, someone at the bar): they stay, or go back
    if (spot) {
      this.walking = Math.hypot(spot.x - r.x, spot.z - r.z) > 1.2;
      if (this.walking) this.wanderHeading = headingTo(spot.x - r.x, spot.z - r.z);
    }
    const b = this.ctx.map.bounds;       // strayed off the map: head back in
    if (r.x < b.x0 || r.x > b.x1 || r.z < b.z0 || r.z > b.z1) this.wanderHeading = headingTo((b.x0 + b.x1) / 2 - r.x, (b.z0 + b.z1) / 2 - r.z);
    this.goal.mode = 'wander';
    this.goal.speed = this.walking ? (this.kind === 'zombie' ? 0.7 : WALK) : 0;
  }

  /** The player has ordered everyone to give up (mission.js). People do; armed suspects might. */
  shouted() {
    const n = this.npc;
    if (this.kind === 'zombie' || this.kind === 'swat' || n.arrested || this.gaveUp) return;
    if (!n.armed) { this.comply = true; return; }
    this.pleas = (this.pleas || 0) + 1;      // every shout wears them down a little
    const chance = (0.25 + 0.12 * this.pleas + (n.health < 60 ? 0.3 : 0) + (this.playerAimingAtMe() ? 0.15 : 0) + (this.flashed > 0 ? 0.5 : 0)) * (n.hostage ? 0.5 : 1);   // (a hostage-taker holds out longer)
    if (Math.random() < chance) {
      this.gaveUp = true;
      this.fake = Math.random() < 0.15;      // some only pretend, and go for the gun when you look away
      this.fakeT = rnd(3, 6);
    }
  }

  /** An armed suspect: shoots at the player on sight, unless talked (or frightened) into giving up. */
  suspect(dt, scan) {
    const n = this.npc, g = this.goal, pl = this.pl;
    g.mode = 'stop';
    if (n.hostage) {
      const h = n.hostage;
      if (h.dead || h.removed || h.mode !== 'anim' || this.gaveUp) { n.hostage = null; if (h.heldBy === n) h.heldBy = null; }
      else return this.holdHostage(dt, scan, h);
    }
    if (this.gaveUp) {
      n.gesture = 'handsUp'; g.face = true; g.pos.copy(pl.pos); n.look = pl.eye;
      if (this.fake && (this.fakeT -= dt) <= 0 && !this.playerAimingAtMe()) { this.gaveUp = this.fake = false; this.attackT = 0.4; }
      return;
    }
    if (scan) this.sees = !pl.dead && this.canSee(pl.pos, 30);
    this.unseenT = this.sees ? 0 : (this.unseenT ?? 99) + dt;
    if (this.unseenT > 10 || pl.dead) { this.post = null; this.wander(dt); this.attackT = rnd(0.5, 1.1); return; }   // has not noticed you (or lost you)

    // in a fight. From behind something if there is something: out to shoot, back in, out again
    if (!this.post && (this.postT = (this.postT || 0) - dt) <= 0) {
      this.postT = 3;
      this.post = this.findPost(pl.pos);
      this.out = true; this.cycleT = rnd(2, 3.5);
    }
    const P = this.post, r = n.root;
    if (P) {
      if (scan && !this.out && this.clear({ x: P.hide.x, y: P.hide.y + 0.9, z: P.hide.z }, pl.eye)) { this.post = null; this.postT = 0.5; }   // flanked: this is no cover any more
      const spot = this.out ? P.peek : P.hide;
      n.look = pl.eye;
      if (Math.hypot(spot.x - r.x, spot.z - r.z) > 0.45 && this.blockedT < 1.5) {
        g.mode = 'to'; g.pos.copy(spot); g.speed = 2.6;
        return;
      }
      this.blockedT = 0;
      g.face = true; g.pos.copy(pl.pos);
      n.gesture = this.out ? 'aim' : 'kneel';
      if (this.out && this.sees && (this.attackT -= dt) <= 0) { this.attackT = rnd(0.45, 0.95); n.shoot(this.hostile()); }
      if ((this.cycleT -= dt) <= 0) { this.out = !this.out; this.cycleT = this.out ? rnd(1.5, 3) : rnd(1.5, 3.5); this.attackT = rnd(0.3, 0.6); }
      return;
    }
    if (!this.sees) return;
    g.face = true; g.pos.copy(pl.pos); n.look = pl.eye; n.gesture = 'aim';
    if ((this.attackT -= dt) <= 0) { this.attackT = rnd(0.45, 0.95); n.shoot(this.hostile()); }
  }

  /** Who a suspect shoots at: you, unless one of your squad is nearer and in view. */
  hostile() {
    const pl = this.pl;
    let best = pl, bd = pl.dead ? 1e9 : this.distTo(pl.pos);
    for (const r of this.ctx.ragdolls) {
      if (r.kind !== 'swat' || r.dead || r.removed) continue;
      const d = this.distTo(r.root);
      if (d < bd && this.los(r.center(_v))) { bd = d; best = r; }
    }
    return best;
  }

  /** The nearest thing the squad should shoot: an armed suspect still fighting, a thug on the attack, or a zombie. (threat is taken: the civilians' "where the danger is" vector.) */
  findThreat() {
    let best = null, bd = 28;
    for (const r of this.ctx.ragdolls) {
      if (r === this.npc || r.dead || r.removed || r.kind === 'swat') continue;
      const hostile = r.kind === 'zombie' || (r.kind === 'thug' && r.brain.state === 'attack')
        || (r.armed && !r.arrested && !r.brain.gaveUp && !(r.brain.flashed > 0) && !r.hostage);   // (a hostage-taker is your shot, not theirs)
      if (!hostile) continue;
      const d = this.distTo(r.root);
      if (d < bd && this.los(r.center(_v))) { bd = d; best = r; }
    }
    return best;
  }

  /**
   * One of your squad: follows in formation (the second covers the rear), stacks beside a closed door you are
   * facing and goes through when you open or kick it, goes where you point (U) and holds that angle, and shoots
   * what threat() finds on the way.
   */
  swat(dt, scan) {
    const n = this.npc, g = this.goal, pl = this.ctx.player, ctx = this.ctx;
    const side = n.slot % 2 ? 1 : -1;
    if (scan) this.target = this.findThreat();
    const th = this.target && !this.target.dead && !this.target.removed ? this.target : null;
    if (th) {
      n.look = th.center(this.lookV);
      n.gesture = 'aim';
      if ((this.attackT -= dt) <= 0) { this.attackT = rnd(0.5, 0.9); n.shoot(th); }
    }

    let spot = null, face = null, speed = WALK * 1.4;
    const door = ctx.squadDoor;
    if (this.breach && n.t - this.breach.t > 3.5) this.breach = null;
    if (this.breach) {
      spot = this.breach.pos; face = this.breach.face; speed = RUN;
    } else if (door && this.distTo(door.hinge) < 9) {
      // stack up beside the door, on your side of it, facing it
      const s = door.side(pl.pos);
      spot = door.hinge.clone().addScaledVector(door.x, side > 0 ? door.w + 0.5 : -0.5).addScaledVector(door.n, s * 0.7);
      face = door.hinge.clone().addScaledVector(door.x, door.w / 2);
      this.stacked = door;
    } else if (this.stacked) {
      // the door you were stacked on has gone: through it, one to each side of the room
      const d = this.stacked;
      this.stacked = null;
      if (d.target !== 0 || d.passable()) {
        const s = d.side(pl.pos);
        const mid = d.hinge.clone().addScaledVector(d.x, d.w / 2);
        this.breach = { t: n.t, pos: mid.clone().addScaledVector(d.x, side * 0.8).addScaledVector(d.n, -s * 1.8), face: mid.clone().addScaledVector(d.n, -s * 6) };
        spot = this.breach.pos; face = this.breach.face; speed = RUN;
      }
    }
    const go = ctx.squadGo;
    if (!spot && go) {
      spot = go.pos.clone().addScaledVector(go.right, side * 0.8);
      face = go.pos.clone().addScaledVector(go.dir, 8);
      speed = RUN;
    }
    if (!spot) {
      // formation: behind you, one each side; the second looks back the way you came
      const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
      spot = new THREE.Vector3(pl.pos.x - fx * 1.8 - fz * side * 1.0, pl.pos.y, pl.pos.z - fz * 1.8 + fx * side * 1.0);
      face = new THREE.Vector3(pl.pos.x + fx * (side > 0 ? -8 : 10), pl.pos.y, pl.pos.z + fz * (side > 0 ? -8 : 10));
      speed = this.distTo(spot) > 6 ? RUN : WALK * 1.4;
    }
    if (this.distTo(spot) > (this.breach ? 0.5 : 0.7) && this.blockedT < 2) { g.mode = 'to'; g.pos.copy(spot); g.speed = speed; }
    else {
      g.mode = 'stop'; this.blockedT = 0;
      g.face = true; g.pos.copy(th ? th.root : face);
      if (!th) n.look = this.lookV.set(face.x, face.y + 1.5, face.z);
    }
  }

  /** Holding someone in front of you: they go where you go, and the pistol rests over their shoulder. */
  holdHostage(dt, scan, h) {
    const n = this.npc, g = this.goal, pl = this.pl;
    if (scan) this.sees = !pl.dead && this.canSee(pl.pos, 30);
    if (this.sees) { g.face = true; g.pos.copy(pl.pos); n.look = pl.eye; }
    n.gesture = 'hold';
    // on the left arm, so the gun hand is free and the head shows over their right shoulder
    const fx = -Math.sin(n.heading), fz = -Math.cos(n.heading);
    h.root.set(n.root.x + fx * 0.5 + fz * 0.22, n.root.y, n.root.z + fz * 0.5 - fx * 0.22);
    h.heading = h.targetHeading = n.heading;
    if (!this.sees) return;
    const d = this.distTo(pl.pos);
    if ((this.warnT = (this.warnT ?? 0) - dt) <= 0 && d < 14) { this.warnT = 7; this.ctx.toast('BACK OFF OR I SHOOT!'); }
    if (d < 9 && (this.attackT -= dt) <= 0) { this.attackT = rnd(1.4, 2.4); n.shoot(this.hostile()); }    // the odd shot to keep you back
  }

  civilian(dt, scan) {
    const n = this.npc, g = this.goal, pl = this.pl;
    if (n.heldBy) {
      // in someone's arm with a gun at their head: they stand there until the taker is down, cuffed, stunned or gives up
      const t = n.heldBy;
      if (t.dead || t.removed || t.mode !== 'anim' || t.arrested || t.brain.gaveUp || t.brain.flashed > 0 || t.hostage !== n) {
        n.heldBy = null;
        if (t.hostage === n) t.hostage = null;
        this.comply = true;
        this.ctx.mission.freed(n, t);
      } else { g.mode = 'stop'; n.gesture = 'handsUp'; n.look = pl.eye; return; }
    }
    if (this.comply) {                       // told to stay put with their hands up, and doing it
      g.mode = 'stop'; g.face = true; g.pos.copy(pl.pos);
      n.gesture = 'handsUp'; n.look = pl.eye;
      return;
    }
    if (scan) {
      this.aimed = this.playerAimingAtMe();
      if (this.fear > 0 && !pl.dead && this.canSee(pl.pos, 25)) this.threat.copy(pl.pos);     // keeps an eye on where the danger is now
      if (this.state === 'calm' && this.fear <= 0) this.lookForCasualties();
      // the undead are terrifying
      for (const o of this.ctx.ragdolls) {
        if (o.kind !== 'zombie' || o.dead || o.removed) continue;
        if (this.distTo(o.root) < 11 && this.canSee({ x: o.root.x, y: o.root.y + 1, z: o.root.z }, 11)) {
          this.threat.copy(o.root);
          this.fear = 1;
          if (this.state === 'calm' || this.state === 'surrender') this.state = 'flee';
        }
      }
    }

    switch (this.state) {
      case 'calm':
        this.decided = false;
        this.wander(dt);
        if (this.aimed) { this.state = 'surrender'; this.t = 0; }
        else if (!pl.dead && this.distTo(pl.pos) < 7 && this.canSee(pl.pos, 7)) n.look = pl.eye; // glance at the player
        break;

      case 'alert':
        g.mode = 'stop'; g.face = true; g.pos.copy(this.threat);
        n.look = this.threat;
        this.t -= dt;
        if (this.t <= 0) this.state = 'flee';
        break;

      case 'surrender':
        g.mode = 'stop'; g.face = true; g.pos.copy(pl.pos);
        n.gesture = 'handsUp';
        n.look = pl.eye;
        // keeps their hands up while covered, bolts shortly after you look away
        this.t = this.aimed ? 0 : this.t + dt;
        if (this.t > 1.6) { this.state = 'flee'; this.fear = 1; this.threat.copy(pl.pos); }
        break;

      case 'hide': {
        // behind something, crouched, with the odd look round the corner
        const c = this.cover, r = n.root;
        if (Math.hypot(c.x - r.x, c.z - r.z) > 0.6) {
          g.mode = 'to'; g.pos.copy(c); g.speed = RUN;
          if (this.blockedT > 1.2) this.state = 'flee';
          break;
        }
        g.mode = 'stop'; g.face = true; g.pos.copy(this.threat);
        if ((this.peekT = (this.peekT ?? 2) - dt) < -0.9) this.peekT = rnd(2.5, 5);
        if (this.peekT < 0) n.look = this.threat; else n.gesture = 'cower';
        this.t -= dt;
        if (scan && this.distTo(this.threat) < 14 && this.clear({ x: r.x, y: r.y + 0.9, z: r.z }, { x: this.threat.x, y: this.threat.y + 1.5, z: this.threat.z })) {
          this.cover = this.findCover(this.threat);          // it has come round: move, or run
          if (!this.cover) this.state = 'flee';
        } else if (this.t <= 0) { this.state = 'calm'; this.fear = 0; this.walking = false; this.t = rnd(2, 5); }
        break;
      }

      case 'check': {
        // someone is lying there: go and look, crouch over them, and then it sinks in
        const o = this.subject;
        if (o.removed || this.blockedT > 2) { this.state = 'calm'; break; }
        const p = o.center(_v);
        n.look = this.lookV.copy(p);
        if (this.distTo(p) > 1.3) { g.mode = 'to'; g.pos.copy(p); g.speed = WALK * 1.5; break; }
        g.mode = 'stop'; g.face = true; g.pos.copy(p);
        n.gesture = 'kneel';
        if ((this.t -= dt) <= 0) { this.state = 'flee'; this.decided = true; this.fear = 0.5; this.threat.copy(p); }
        break;
      }

      case 'help': {
        // someone is hurt and cannot walk: get hold of them and pull them away from where it happened
        const o = this.subject, tor = o.parts.torso;
        const stop = () => { o.helper = null; this.state = 'calm'; this.t = rnd(1, 3); };
        if (o.removed || o.dead || o.mode !== 'ragdoll' || tor.gone || this.blockedT > 2 || (this.t -= dt) <= 0) { stop(); break; }
        const p = o.center(_v), dist = this.distTo(p);
        n.look = this.lookV.copy(p);
        if (!this.holding) {
          if (dist > 1.1) { g.mode = 'to'; g.pos.copy(p); g.speed = RUN * 0.8; break; }
          this.holding = true;
        }
        if (dist > 2.5) { stop(); break; }             // lost my grip
        g.mode = 'from'; g.pos.copy(this.threat); g.speed = 0.9;
        const r = n.root, t = tor.body.translation();
        const dx = r.x - t.x, dz = r.z - t.z, l = Math.hypot(dx, dz) || 1, pull = Math.min(1.6, Math.max(0, l - 0.6) * 4);
        const v = tor.body.linvel();
        tor.body.setLinvel({ x: dx / l * pull, y: v.y, z: dz / l * pull }, true);
        break;
      }

      case 'flee': {
        if (!this.decided) {
          // not everyone runs: some freeze where they are, most get behind something if there is something
          this.decided = true;
          const roll = Math.random();
          if (roll < 0.15) { this.state = 'cower'; this.t = rnd(4, 8); break; }
          if (roll < 0.8 && (this.cover = this.findCover(this.threat))) { this.state = 'hide'; this.t = rnd(9, 18); this.blockedT = 0; break; }
        }
        g.mode = 'from'; g.pos.copy(this.threat); g.speed = RUN;
        const far = this.distTo(this.threat) > 20;
        this.fear -= dt * (far ? 0.22 : 0.05);
        if (this.fear <= 0) { this.state = 'calm'; this.walking = false; this.t = rnd(2, 5); }
        else if (this.blockedT > 1.0) { this.state = 'cower'; this.t = rnd(3.5, 6.5); this.blockedT = 0; }
        else if (this.aimed && this.distTo(pl.pos) < 6 && Math.random() < dt * 1.2) { this.state = 'surrender'; this.t = 0; }
        break;
      }

      case 'cower':
        g.mode = 'stop'; g.face = false;
        n.gesture = 'cower';
        this.t -= dt;
        if (this.t <= 0) {
          if (this.distTo(this.threat) < 12 && this.fear > 0.2) { this.state = 'flee'; this.blockedT = 0; }
          else { this.state = 'calm'; this.walking = false; this.t = rnd(2, 4); }
        }
        break;
    }
  }

  /** Calm, and something is wrong over there: a body to go and look at, or someone down who needs pulling clear. */
  lookForCasualties() {
    const n = this.npc;
    this.seen ??= new Set();
    for (const o of this.ctx.ragdolls) {
      if (o === n || o.removed || o.kind === 'zombie' || this.seen.has(o) || o.parts.torso.gone) continue;
      const down = !o.dead && o.mode === 'ragdoll' && (o.crawling || o.crippled);
      if (!o.dead && !down) continue;
      const p = o.center(_v);
      if (this.distTo(p) > 12 || !this.canSee({ x: p.x, y: p.y + 0.3, z: p.z }, 12)) continue;
      this.seen.add(o);
      if (down && !o.helper) {
        o.helper = n; this.subject = o; this.holding = false;
        this.state = 'help'; this.t = rnd(9, 14); this.blockedT = 0;
        if (this.threat.lengthSq() === 0) this.threat.copy(this.pl.pos);
        return;
      }
      if (o.dead && Math.random() < 0.6) { this.subject = o; this.state = 'check'; this.t = rnd(2.5, 4.5); this.blockedT = 0; return; }
    }
  }

  thug(dt, scan) {
    const n = this.npc, g = this.goal, pl = this.pl;
    if ((n.health <= 35 || n.crawling) && this.state === 'attack') { this.state = 'flee'; this.fear = 1; this.threat.copy(pl.pos); }
    if (this.state !== 'attack') { this.civilian(dt, scan); return; }

    if (pl.dead) { this.state = 'calm'; this.anger = 0; return; }
    const dist = this.distTo(pl.pos);
    this.anger -= dt * (dist > 25 ? 3 : 0.4);
    if (scan && this.canSee(pl.pos, 30)) this.anger = Math.max(this.anger, 12);
    if (this.anger <= 0) { this.state = 'calm'; this.t = rnd(1, 3); this.walking = false; return; }

    n.look = pl.eye;
    if (dist > 1.2) {
      g.mode = 'to'; g.pos.copy(pl.pos); g.speed = dist > 3 ? RUN + 0.3 : 2.2;
      n.gesture = dist < 4 ? 'fight' : 'none';
    } else {
      g.mode = 'stop'; g.face = true; g.pos.copy(pl.pos);
      n.gesture = 'fight';
      this.attackT -= dt;
      if (this.attackT <= 0) { this.attackT = rnd(0.7, 1.0); n.punchT = n.PUNCH; this.strikeT = 0.16; }
    }
    if (this.strikeT > 0) {
      this.strikeT -= dt;
      if (this.strikeT <= 0 && this.distTo(pl.pos) < 1.6) pl.hurt(11, n.root);
    }
  }

  zombie(dt, scan) {
    const n = this.npc, g = this.goal, pl = this.pl;
    if (scan) {
      // nearest living thing: the player or any uninfected NPC
      let best = null, bd = 28;
      if (!pl.dead) { const d = this.distTo(pl.pos); if (d < bd) { bd = d; best = pl; } }
      for (const o of this.ctx.ragdolls) {
        if (o === n || o.kind === 'zombie' || o.dead || o.removed) continue;
        const d = this.distTo(o.center(_v));
        if (d < bd) { bd = d; best = o; }
      }
      this.target = best;
    }
    const tg = this.target;
    if (!tg || tg.dead || tg.removed || tg.kind === 'zombie') { this.target = null; this.wander(dt); return; }

    const p = tg.isPlayer ? tg.pos : tg.center(_v);       // (a player: you, or the other one in co-op)
    const dist = this.distTo(p);
    n.look = tg.isPlayer ? tg.eye : this.lookV.copy(p).setY(p.y + 0.3);
    if (dist > 1.05) {
      g.mode = 'to'; g.pos.copy(p); g.speed = (dist < 5 ? 1.9 : 0.9) * (this.runner ? 2.2 : 1); // shambles, then lunges (a survival runner: runs)
    } else {
      g.mode = 'stop'; g.face = true; g.pos.copy(p);
      this.attackT -= dt;
      if (this.attackT <= 0) { this.attackT = rnd(0.9, 1.3); n.lungeT = n.LUNGE; this.strikeT = 0.22; }
    }
    if (this.strikeT > 0) {
      this.strikeT -= dt;
      if (this.strikeT <= 0 && this.distTo(tg.isPlayer ? tg.pos : tg.center(_v)) < 1.5) {
        if (tg.isPlayer) tg.hurt(14, n.root);
        else tg.bitten(n);
      }
    }
  }

  // ------------------------------------------------------------ steering
  /** Turn the goal into a heading and speed, going around whatever is in the way. */
  steer(dt) {
    const n = this.npc, g = this.goal, r = n.root;
    let heading = n.targetHeading, speed = g.speed;

    if (g.mode === 'stop') {
      speed = 0;
      if (g.face) heading = headingTo(g.pos.x - r.x, g.pos.z - r.z);
    } else if (g.mode === 'wander') {
      heading = this.wanderHeading;
    } else if (g.mode === 'to') {
      heading = headingTo(g.pos.x - r.x, g.pos.z - r.z);
    } else if (g.mode === 'from') {
      let dx = r.x - g.pos.x, dz = r.z - g.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // near the edge of the map, running straight away is a dead end: bend back toward open ground
      const b = this.ctx.map.bounds;
      const room = Math.min(r.x - b.x0, b.x1 - r.x, r.z - b.z0, b.z1 - r.z);
      if (room < 6) {
        const k = Math.min(1, (6 - room) / 6) * 1.6;
        const cx = (b.x0 + b.x1) / 2 - r.x, cz = (b.z0 + b.z1) / 2 - r.z, cl = Math.hypot(cx, cz) || 1;
        dx += (cx / cl) * k; dz += (cz / cl) * k;
      }
      heading = headingTo(dx, dz);
    }

    if (speed > 0.05) {
      this.probeT -= dt;
      if (this.probeT <= 0) {
        this.probeT = 0.1;
        const reach = 0.9 + speed * 0.4;
        let c = this.feel(heading, reach);
        let l = this.feel(heading + 0.65, reach * 0.9);
        let rt = this.feel(heading - 0.65, reach * 0.9);
        if (c && c.kind === 'door') {
          // a door in the way opens as they reach it; a locked one is kicked by anyone who would, and a wall to the rest
          const d = c.door;
          if (this.kind === 'swat' && this.ctx.squadDoor === d && !d.passable()) { /* stacked on it: your call */ }
          else if (d.passable() || d.open(r)) c = l = rt = false;
          else if (this.kind !== 'civilian' || n.armed) {
            // a kicker: straight up to it, then stand and boot it until it gives
            c = l = rt = false;
            if (Math.abs((r.x - d.hinge.x) * d.n.x + (r.z - d.hinge.z) * d.n.z) < 0.8) {
              this.wait = 0.3;
              if (n.t >= (this.kickAt ?? 0)) { this.kickAt = n.t + (this.kind === 'zombie' ? 2.2 : 1.2); d.kick(r); }
            }
          }
        }
        if (!c && !l && !rt) {
          this.avoid *= 0.6;
          this.blockedT = Math.max(0, this.blockedT - 0.05);
        } else if (c) {
          if (!l) this.avoid = 1.15;
          else if (!rt) this.avoid = -1.15;
          else { this.avoid = (this.avoid >= 0 ? 1 : -1) * 2.5; this.blockedT += 0.2; }
          if (g.mode === 'wander') this.wanderHeading = heading + this.avoid;
        } else {
          this.avoid = l ? -0.55 : 0.55;
        }
      }
    } else {
      this.avoid = 0;
    }

    if ((this.wait = Math.max(0, (this.wait || 0) - dt)) > 0) speed = 0;     // standing at a door
    n.targetHeading = heading + (speed > 0.05 ? this.avoid : 0);
    n.wantSpeed = speed;
  }

  /** Ray out from chest height: true if something is in the way. */
  feel(heading, len) {
    const n = this.npc, r = n.root;
    const own = n.colHandles;
    const owners = this.ctx.owners;
    const chasing = this.goal.mode === 'to';
    const tg = this.kind === 'zombie' ? this.target : null;
    const playerCol = this.ctx.player.collider.handle;
    const ray = new RAPIER.Ray({ x: r.x, y: r.y + 0.8, z: r.z }, { x: -Math.sin(heading), y: 0, z: -Math.cos(heading) });
    const hit = this.ctx.world.castRay(ray, len, true, undefined, undefined, undefined, undefined, (col) => {
      const h = col.handle;
      if (own.has(h)) return false;
      if (chasing) { // whatever I am running at is not an obstacle
        if (h === playerCol) return false;
        const o = owners.get(h);
        if (tg && o && o.kind === 'part' && o.ragdoll === tg) return false;
      }
      return owners.get(h)?.kind !== 'chunk';
    });
    return hit ? owners.get(hit.collider.handle) || true : false;      // (so a door can be told from a wall)
  }

  update(dt) {
    const n = this.npc;
    this.pl = this.nearest();
    n.gesture = 'none';
    n.look = null;
    this.scanT -= dt;
    const scan = this.scanT <= 0;
    if (scan) this.scanT = 0.2;
    this.goal.face = false;
    this.goal.speed = 0;

    if (n.gun) n.gun.visible = !this.gaveUp && !n.arrested;
    if (this.flashed > 0 && this.kind !== 'zombie' && !n.arrested) {
      // blinded and deafened by a flashbang: doubled over, hands to the face, no fight in them
      this.flashed -= dt;
      this.goal.mode = 'stop';
      n.gesture = 'cower';
      if (this.kind !== 'thug' && !n.armed && this.flashed <= 0) { this.state = 'cower'; this.t = rnd(2, 4); }
    } else if (this.kind === 'zombie') this.zombie(dt, scan);
    else if (n.arrested) { this.goal.mode = 'stop'; n.gesture = 'cower'; }      // cuffed: stays down
    else if (this.kind === 'swat') this.swat(dt, scan);
    else if (n.armed) this.suspect(dt, scan);
    else if (this.kind === 'thug') this.thug(dt, scan);
    else this.civilian(dt, scan);

    this.steer(dt);
  }
}
