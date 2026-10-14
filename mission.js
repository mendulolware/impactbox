import { WEAPONS } from './weapons.js';
import { getMaterial } from './models.js';
import * as THREE from 'three';

// "Ready or Not" mode: you are a SWAT officer sent in to bring order to chaos.
//
// The map's people are split into armed suspects and civilians. The job is to account for every
// one of them: suspects arrested (best) or neutralised, civilians secured. F does the talking and
// the handcuffs: aimed at someone who has given up (or is down) within reach, it arrests them;
// otherwise it shouts for compliance. Civilians obey. Suspects might, more so if hurt, shouted at
// again, or looking down your barrel, and a few of those are only pretending.
// Rules of engagement are what the grade is made of: shooting someone who is a threat costs some,
// shooting someone who has surrendered (or is stunned), or a civilian, costs a lot. The taser, the
// beanbag gun, pepper spray and flashbangs stun instead of kill: a stunned suspect can be cuffed.

const LINES = ['Police! Hands up!', 'Drop the weapon!', 'Get on the ground!', 'Police! Do not move!'];
const REACH = 2.4, EARSHOT = 14;
const SWAT_SLEEVE = 0x10141c;
const _v = new THREE.Vector3(), _c = new THREE.Vector3();

export class Mission {
  constructor(ctx) {
    this.ctx = ctx;
    this.on = false;
    this.over = false;
    this.el = document.getElementById('mission');
    this.shoutT = 0;
    this.hudT = 0;
    this.log = [];             // [points, why] for the debrief
  }

  /** Reset the current map and start a mission on it. */
  start() {
    const ctx = this.ctx;
    this.on = false;                       // (so resetting the map does not count as casualties)
    ctx.setMap(ctx.map.id);
    const people = ctx.ragdolls.filter((r) => r.kind !== 'zombie' && r.kind !== 'swat');
    const suspects = people.filter((r) => r.kind === 'thug');
    const rest = people.filter((r) => r.kind !== 'thug').sort(() => Math.random() - 0.5);
    while (suspects.length < Math.max(3, Math.floor(people.length * 0.45)) && rest.length > 2) suspects.push(rest.pop());
    for (const r of suspects) { r.role = 'suspect'; r.arm(); }
    for (const r of rest) r.role = 'civilian';
    // one of them grabs the nearest civilian as a shield, if there is one close enough
    for (const t of suspects.slice().sort(() => Math.random() - 0.5)) {
      const c = rest.find((r) => r.center(_v).distanceTo(t.center(_c)) < 5 && t.brain.los(r.center(_v)));
      if (!c) continue;
      t.hostage = c; c.heldBy = t;
      break;
    }
    this.people = people;
    // your squad: two officers at your back
    const sp = ctx.map.spawn, yaw = ctx.map.yaw;
    const bx = Math.sin(yaw), bz = Math.cos(yaw);                        // behind you
    for (let i = 0; i < 2; i++) {
      const s = ctx.spawnRagdoll({ x: sp.x + bx * 1.4 - bz * (i ? 1.1 : -1.1), y: sp.y - 0.95, z: sp.z + bz * 1.4 + bx * (i ? 1.1 : -1.1) }, yaw, { kind: 'swat', model: 'Ch15' });   // (sp is where your capsule sits; they stand on the floor)
      s.arm('Rifle');
      s.slot = i;
    }
    this.log = [];
    this.over = false;
    this.on = true;
    const sleeve = getMaterial('Sleeve');
    if (sleeve) { this.sleeve0 ??= sleeve.color.getHex(); sleeve.color.setHex(SWAT_SLEEVE); }
    ctx.weapons.select(WEAPONS.findIndex((w) => w.name === 'AR-15'));
    ctx.toast('BRING ORDER TO CHAOS');
    this.refresh();
  }

  /** Back to the sandbox. */
  stop() {
    if (!this.on) return;
    this.on = false;
    this.el.textContent = '';
    const sleeve = getMaterial('Sleeve');
    if (sleeve && this.sleeve0 !== undefined) sleeve.color.setHex(this.sleeve0);
  }

  /** F: cuff whoever is in front of you if they have given up or are down; otherwise shout. */
  act() {
    if (!this.on || this.over) return;
    const ctx = this.ctx;
    const cam = ctx.camera.getWorldPosition(ctx.camera.position.clone());
    const dir = ctx.camera.getWorldDirection(cam.clone());
    const hit = ctx.raycast(cam, dir, REACH);
    const owner = hit && ctx.owners.get(hit.collider.handle);
    const r = owner?.kind === 'part' ? owner.ragdoll : null;
    if (r && !r.dead && !r.arrested && r.role && (r.brain.gaveUp || r.brain.comply || r.brain.flashed > 0 || r.mode === 'ragdoll')) this.arrest(r);   // (a flashbanged suspect can be cuffed before they recover)
    else this.shout();
  }

  shout() {
    if (this.shoutT > 0) return;
    this.shoutT = 1.2;
    const ctx = this.ctx, line = LINES[(Math.random() * LINES.length) | 0];
    ctx.toast(line.toUpperCase());
    if ('speechSynthesis' in window) {         // the browser's own voice: no recording needed
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(line);
      u.rate = 1.3; u.pitch = 0.6;
      speechSynthesis.speak(u);
    }
    for (const r of ctx.ragdolls) {
      if (r.dead || r.removed || !r.role) continue;
      const c = r.center(ctx.camera.position.clone());
      if (c.distanceTo(ctx.player.pos) < EARSHOT && r.brain.los(ctx.player.eye)) r.brain.shouted();
    }
  }

  arrest(r) {
    r.arrested = true;
    if (r.gun) r.gun.visible = false;
    this.ctx.sfx.reload();                     // the ratchet of the cuffs
    if (r.role === 'suspect' && r.lessLethal) this.log.push([0, 'Suspect subdued less-lethally']);
    this.ctx.toast(r.role === 'suspect' ? 'SUSPECT ARRESTED' : 'CIVILIAN SECURED');
    this.refresh();
  }

  /** A hostage is out of the taker's arm: because the taker went down, was stunned or cuffed, or gave up. */
  freed(h, t) {
    this.ctx.toast('HOSTAGE FREED');
    if (!this.on || this.over) return;
    this.log.push([0, t.dead ? 'Hostage rescued' : 'Hostage released']);
    this.refresh();
  }

  /** Someone died. Was it within the rules? */
  onKill(r) {
    if (!this.on) return;
    if (r.kind === 'swat') { this.log.push([-20, 'Officer down']); this.ctx.toast('OFFICER DOWN'); this.refresh(); return; }
    if (!r.role) return;
    const gaveUp = r.arrested || r.brain.gaveUp || r.brain.comply || r.brain.flashed > 0;    // (shooting someone you have already stunned counts too)
    if (r.heldBy) this.log.push([-40, 'Hostage killed']);
    else if (r.role === 'civilian') this.log.push([-30, 'Civilian killed']);
    else if (gaveUp || !r.armed) this.log.push([-25, 'Unauthorized use of deadly force']);
    else this.log.push([-10, 'Suspect neutralised']);
    this.ctx.toast(this.log[this.log.length - 1][1].toUpperCase());
    this.refresh();
  }

  update(dt) {
    if (!this.on) return;
    this.shoutT -= dt;
    if (this.over) return;
    if (this.ctx.player.dead) return this.finish('OFFICER DOWN');
    if ((this.hudT -= dt) <= 0) { this.hudT = 0.3; this.refresh(); }
  }

  refresh() {
    if (!this.on || this.over) return;
    const done = (r) => r.dead || r.removed || r.arrested;
    const S = this.people.filter((r) => r.role === 'suspect'), C = this.people.filter((r) => r.role === 'civilian');
    const count = (list) => `${list.filter((r) => r.arrested && !r.dead).length} in custody, ${list.filter((r) => r.dead || r.removed).length} dead, ${list.filter((r) => !done(r)).length} left`;
    const held = this.people.some((r) => r.heldBy && !r.dead);
    this.el.textContent = `READY OR NOT\nSuspects   ${count(S)}\nCivilians  ${count(C)}${held ? '\nHOSTAGE TAKEN - talk him down, or make the shot' : ''}\n[F] shout / arrest`;
    if (this.people.every(done)) this.finish('MISSION COMPLETE');
  }

  finish(title) {
    this.over = true;
    const failed = title !== 'MISSION COMPLETE';
    let score = failed ? 0 : 100;
    for (const [pts] of this.log) score += pts;
    score = Math.max(0, score);
    const grade = failed ? 'F' : score >= 95 ? 'S' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
    const tally = {};
    for (const [, why] of this.log) tally[why] = (tally[why] || 0) + 1;
    const lines = Object.entries(tally).map(([why, n]) => `  ${n} x ${why}`);
    this.el.textContent = `${title}\nGrade ${grade}   (${score} / 100)\n${lines.join('\n') || '  No shots that needed explaining'}\n[Enter] go again`;
    this.ctx.toast(`${title} - GRADE ${grade}`);
  }
}
