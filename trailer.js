import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

// The launch trailer: about 45 seconds of IMPACTBOX filmed by IMPACTBOX.
//   ?trailer          watch it in the browser (click to start: browsers only play sound after a click)
//   ?trailer=render   render it frame by frame, 1920x1080 at 30 fps, to trailer_render.py, which makes the video
// Every shot is the real game (ragdolls, wounds, blood, water, cars, blasts); only the setups, the camera and the cuts
// are scripted. The music and the sound effects are made here in code, from the same cue list as the pictures.

const STEP = 1 / 60;                       // one game tick of the timeline
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const RED = '#ff3b2f';
const FAR = { x: 0, y: 300, z: 0 };       // where the player waits out of every shot (people react to someone standing near them)
const SINK = 'http://127.0.0.1:8125';     // trailer_render.py
const W = (name) => WEAPONS.find((w) => w.name === name);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (u) => u * u * (3 - 2 * u);
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** A camera that glides from one framing to another: [from, at, fov] each. */
const glide = (a, b) => (u) => { const k = ease(u); return [mix(a[0], b[0], k), mix(a[1], b[1], k), a[2] + (b[2] - a[2]) * k]; };

/** Someone to film: a civilian without a vest unless told otherwise (rounds spark off the soldier model's). */
function person(ctx, x, z, yaw = 0, kind = 'civilian', y = 0) {
  let r;
  for (let i = 0; i < 10; i++) {
    r = ctx.spawnRagdoll({ x, y: y + 0.05, z }, yaw, { kind });
    if (!r.armour || kind === 'swat') return r;
    r.destroy();
    ctx.ragdolls = ctx.ragdolls.filter((q) => q !== r);
  }
  return r;
}

/** A round (or a shotgun's load) from `from` at `to`: tracers, hits, and glass on the way breaks and lets it through. */
function fire(ctx, from, to, name) {
  const w = W(name), n = w.pellets || 1, aim = to.clone().sub(from).normalize();
  for (let k = 0; k < n; k++) {
    const d = aim.clone();
    if (n > 1) d.add(V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(0.035)).normalize();
    let o = from.clone(), end = null;
    for (let leg = 0; leg < 3; leg++) {
      const hit = ctx.raycast(o, d, 80);
      if (!hit) { end = o.clone().addScaledVector(d, 40); break; }
      end = o.clone().addScaledVector(d, hit.timeOfImpact);
      const glass = ctx.owners.get(hit.collider.handle)?.kind === 'glass';
      ctx.applyHit(hit, end, d, w.dmg, w.impulse, { hole: w.hole, pen: n > 1 ? 0.03 : 0.1 });
      if (!glass) break;
      o = end.clone().addScaledVector(d, 0.05);
    }
    ctx.weapons.tracer(from, end);
  }
  ctx.weapons.fireFlash(from, aim, 0.3);
}
const centre = (r, part = 'torso') => { const t = r.parts[part].body.translation(); return V(t.x, t.y, t.z); };

// ------------------------------------------------------------------------------------------------- the shots
// card: black with words. Otherwise: map (and populate), setup() returns what the shot needs, cam(u) frames it
// (u: 0..1 through the shot), each() runs every tick, events fire at their second and put their sound on the track,
// slow is [from, to, timeScale], text is laid over the picture.
const SHOTS = [
  {
    dur: 3.6, map: 'street', populate: true, text: ['EVERY BODY', 'HAS WEIGHT'],
    cam: glide([[-37, 1.5, -1.2], [-12, 2.6, 0.6], 48], [[-31, 1.9, -0.8], [-10, 2.4, 0.6], 46]),
  },
  {
    dur: 3.2, map: 'office', populate: true, text: ['EVERY ROUND', 'LEAVES A MARK'],
    cam: glide([[4.5, 2.3, 10.8], [-3, 1.0, -3], 58], [[2.5, 2.0, 9.4], [-2.5, 1.0, -4], 56]),
  },
  {
    dur: 3.0, map: 'pool', populate: true, text: ['NOTHING', 'STAYS CLEAN'],
    setup: (ctx) => {                        // someone face down out there, the water going red round them
      const r = person(ctx, -3, 0.6, 1.2, 'civilian', -1.2);
      r.goLimp(8); r.die('torso');
      r.hit('torso', 40, centre(r), V(0, -1, 0), 0, { hole: 0.04 });
      return { r };
    },
    cam: glide([[10.5, 0.2, 5.2], [-6, 0.2, -1.5], 50], [[5, 0.3, 4.6], [-8, 0.3, -2.5], 50]),
  },
  { dur: 2.4, card: ['A PHYSICS SANDBOX', 'IN YOUR BROWSER'], cue: 'braam' },
  {
    // a round in the leg: down on one knee; the next one puts him down for good
    dur: 2.8, map: 'killhouse', setup: (ctx) => ({ r: person(ctx, 0, 15, 0) }),
    cam: glide([[1.9, 1.35, 12.6], [0, 1.0, 15], 42], [[1.5, 1.2, 13.0], [0, 0.9, 15], 40]),
    events: [
      [0.6, (ctx, s) => { fire(ctx, V(-7, 1.0, 13.5), centre(s.r, 'thighL'), 'Pistol'); s.r.react = { kind: 'knee', t: 0, len: 1.8, side: 'L' }; s.r.flinchT = 0; }, 'shot'],
      [1.75, (ctx, s) => fire(ctx, V(-7, 1.3, 13.5), centre(s.r), 'Revolver'), 'shot'],
    ],
  },
  {
    // a shotgun blast, in slow motion, back into a stack of crates
    dur: 2.6, map: 'yard', setup: (ctx) => {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ctx.spawnProp('crate', { x: -0.65 + i * 0.65, y: 0.31 + j * 0.62, z: 4.35 }, 0);
      return { r: person(ctx, 0, 5.35, Math.PI, 'thug') };
    },
    cam: glide([[3.3, 1.25, 6.4], [-0.2, 1.0, 5.0], 46], [[3.0, 1.1, 6.1], [-0.2, 0.8, 4.9], 44]),
    events: [[0.45, (ctx, s) => fire(ctx, V(0.2, 1.3, 11), centre(s.r), 'Double Barrel'), 'shotgun']],
    slow: [0.5, 2.0, 0.3],
  },
  {
    // through the meeting-room glass
    dur: 2.4, map: 'office', setup: (ctx) => ({ r: person(ctx, -10.5, -7.6, Math.PI) }),
    cam: glide([[-8.4, 1.5, -3.2], [-10.4, 1.25, -7.2], 46], [[-8.7, 1.45, -3.6], [-10.5, 1.05, -7.4], 44]),
    events: [[0.5, (ctx, s) => fire(ctx, V(-11.4, 1.45, -1.5), centre(s.r), 'Revolver'), 'glass']],
  },
  {
    // a car does not stop for anyone
    dur: 3.0, map: 'street', player: true, setup: (ctx) => {
      const car = ctx.spawnProp('car', { x: -34, y: 0.7, z: 1.6 }, -Math.PI / 2);
      ctx.driving.enter(car);
      car.body.setLinvel({ x: 16, y: 0, z: 0 }, true);
      return { car, r: person(ctx, -16, 1.4, -Math.PI / 2) };
    },
    each: (ctx, s) => { if (!s.car.removed) ctx.driving.update(STEP, { keys: new Set(['KeyW']) }, true); },
    cam: (u, s) => {                         // from the kerb, then round after him
      const v = centre(s.r, 'pelvis'), k = ease(clamp01((u - 0.38) / 0.4));
      return [[-12.4, 0.75, 6.9], mix([-17, 1.0, 1.4], [v.x, Math.max(0.7, v.y), v.z], k), 46];
    },
    events: [[1.15, () => {}, 'crash']],
  },
  {
    // two bodies into the deep end
    dur: 2.8, map: 'pool', setup: (ctx) => {
      ctx.spawnProp('ball', { x: -3, y: 0.3, z: 2 }); ctx.spawnProp('ball', { x: 3.5, y: 0.3, z: -2.5 });
      const a = person(ctx, 0.8, 0.8, 0.4, 'civilian', 4.4); a.goLimp(5); a.die('torso');
      return { a };
    },
    events: [
      [0.5, (ctx, s) => { s.b = person(ctx, -1.4, -0.6, 2.2, 'thug', 4.8); s.b.goLimp(5); s.b.die('torso'); }],
      [0.95, () => {}, 'splash'], [1.55, () => {}, 'splash'],
    ],
    cam: glide([[5.6, 0.35, 5.0], [0.2, 0.9, 0.2], 54], [[4.6, 0.3, 4.2], [0, 0.0, 0.2], 52]),
  },
  {
    // a long way down
    // (stood on the parapet; the camera hangs out past the edge and watches him all the way down)
    dur: 3.2, map: 'rooftops', setup: (ctx) => ({ r: person(ctx, 1.5, 18.85, Math.PI, 'civilian', 20.8) }),
    events: [
      [0.5, (ctx, s) => {
        fire(ctx, V(1.5, 22, 11), centre(s.r), 'Revolver');
        s.r.goLimp(6);
        s.r.parts.torso.body.applyImpulse({ x: 0, y: 40, z: 120 }, true);
      }, 'shot'],
    ],
    cam: (u, s) => { const v = centre(s.r, 'pelvis'); return [[3.9, 23.2, 20.6], [v.x, v.y - 0.5, v.z], 56]; },
  },
  { dur: 1.3, card: ['ZOMBIE SURVIVAL'], cue: 'braam' },
  { dur: 1.3, card: ['CO-OP WITH A FRIEND'], cue: 'braam' },
  {
    // they run
    dur: 3.4, map: 'warehouse', player: true, setup: (ctx) => {
      ctx.player.teleport({ x: 0.4, y: 1, z: 17 }, 0);          // (what they are running at: just behind the camera)
      const z = [];
      for (let i = 0; i < 8; i++) { const r = person(ctx, -3.6 + (i % 4) * 2.4 + rnd(-0.4, 0.4), 4 + Math.floor(i / 4) * 2.4, 0, 'zombie'); r.brain.runner = true; z.push(r); }
      return { z };
    },
    cam: glide([[0.6, 1.3, 11.8], [0, 1.2, 3], 52], [[0.6, 1.35, 12.6], [0, 1.15, 7], 54]),
    events: [1.5, 1.95, 2.4, 2.8].map((t, i) => [t, (ctx, s) => {
      const r = s.z.filter((q) => !q.dead).sort((a, b) => centre(b).z - centre(a).z)[0];
      if (r) fire(ctx, V(1.3, 1.45, 14 + t * 0.6), centre(r, i % 2 ? 'torso' : 'head'), 'AR-15');
    }, 'shot']),
  },
  {
    // the finale: a ring of explosive barrels, people among them, in slow motion
    dur: 4.6, map: 'yard', setup: (ctx) => {
      const c = V(0, 0, 15);                 // (clear of the yard's concrete cover)
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.spawnProp('explosive', { x: c.x + Math.cos(a) * 2.3, y: 0.5, z: c.z + Math.sin(a) * 2.3 }); }
      ctx.spawnProp('car', { x: 4.6, y: 0.7, z: 16.5 }, 0.3);
      const rs = [[0, 0], [1.2, 1.1], [-1.3, 0.6], [0.4, -1.4], [-0.9, -1.0]].map(([x, z], i) => person(ctx, c.x + x, c.z + z, rnd(0, 6.28), i % 2 ? 'thug' : 'civilian'));
      return { c, rs };
    },
    events: [
      [1.0, (ctx, s) => ctx.explode({ x: s.c.x + 2.3, y: 0.5, z: s.c.z }, 7, 1.1), 'blast'],
      [1.7, () => {}, 'blast'], [2.5, () => {}, 'blast'],
    ],
    slow: [1.05, 3.6, 0.3],
    cam: (u) => { const a = 0.35 + 0.9 * ease(u), R = 10.5 - 2 * u; return [[Math.sin(a) * R, 2.4 + u, 15 + Math.cos(a) * R], [0, 1.3, 15], 50]; },
  },
  { dur: 5.6, logo: true, cue: 'logo' },
];

// --------------------------------------------------------------------------------------------- the timeline
class Timeline {
  constructor(ctx) {
    this.ctx = ctx;
    this.t = 0;
    this.i = -1;
    let t = 0;
    this.cues = [];
    for (const s of SHOTS) {
      s.start = t;
      if (s.cue) this.cues.push({ t, kind: s.cue });
      for (const [et, , cue] of s.events || []) if (cue) this.cues.push({ t: t + et, kind: cue });
      t += s.dur;
    }
    this.total = t;
    // the score: a pulse under the action, a riser into the finale
    const act2 = SHOTS[4].start, fin = SHOTS[SHOTS.length - 2].start;
    this.cues.push({ t: act2, kind: 'pulse', len: SHOTS[10].start - act2 }, { t: fin - 2.6, kind: 'riser', len: 3.6 }, { t: 0, kind: 'drone', len: SHOTS[SHOTS.length - 1].start });
  }

  get shot() { return SHOTS[this.i]; }

  /** One tick of the timeline: cut if it is time, run the shot's events, step the game. */
  tick() {
    const ctx = this.ctx;
    let i = this.i;
    while (i + 1 < SHOTS.length && this.t >= SHOTS[i + 1].start) i++;
    if (i !== this.i) this.begin(i);
    const s = this.shot, lt = this.t - s.start;
    if (s.map) {
      for (const e of s.events || []) if (!e.done && lt >= e[0]) { e.done = true; e[1](ctx, this.state); }
      ctx.timeScale = s.slow && lt >= s.slow[0] && lt < s.slow[1] ? s.slow[2] : 1;
      s.each?.(ctx, this.state, lt);
      if (!s.player) { const pl = ctx.player; pl.body.setTranslation(FAR, true); pl.body.setNextKinematicTranslation(FAR); pl.vel.set(0, 0, 0); }
      ctx.debugStep(1);
    }
    this.t += STEP;
  }

  begin(i) {
    const ctx = this.ctx, s = SHOTS[i];
    this.i = i;
    for (const e of s.events || []) e.done = false;
    if (!s.map) return;
    ctx.timeScale = 1;
    ctx.setMap(s.map, !!s.populate);
    this.state = s.setup ? s.setup(ctx) : {};
    ctx.debugStep(2);                        // (people find their feet before the first frame)
  }

  /** Draw the current moment. composite: copy the 3D picture into g too (rendering to a file). */
  draw(g, w, h, composite) {
    const ctx = this.ctx, s = this.shot, lt = this.t - s.start, u = clamp01(lt / s.dur);
    g.clearRect(0, 0, w, h);
    if (s.map) {
      const [from, at, fov] = s.cam(u, this.state);
      ctx.shadowAt = { x: at[0], y: at[1], z: at[2] };
      ctx.post.final.uniforms.uBlur.value.set(0, 0);
      ctx.debugView(from, at, fov);
      ctx.view = null;                       // (main.js draws nothing of its own while the trailer runs)
      if (composite) g.drawImage(ctx.renderer.domElement, 0, 0, w, h);
      // a breath of black at every cut
      const cut = Math.min(lt / 0.12, (s.dur - lt) / 0.12);
      if (cut < 1) { g.fillStyle = `rgba(0,0,0,${1 - clamp01(cut)})`; g.fillRect(0, 0, w, h); }
      if (s.text) words(g, w, h, s.text, clamp01(Math.min((lt - 0.35) / 0.4, (s.dur - 0.25 - lt) / 0.3)), 0.12, lt);
    } else {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      if (s.card) words(g, w, h, s.card, clamp01(Math.min(lt / 0.25, (s.dur - lt) / 0.25)), 0.16, lt);
      else logo(g, w, h, lt);
    }
  }
}

/** Big spaced capitals, centred, with a slow push in. */
function words(g, w, h, lines, a, size, lt) {
  if (a <= 0) return;
  const px = Math.round(h * size * (1 + lt * 0.015));
  g.save();
  g.globalAlpha = a;
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${px}px ${FONT}`;
  g.letterSpacing = `${Math.round(px * 0.08)}px`;
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = px * 0.25;
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * px * 1.05));
  g.restore();
}

function logo(g, w, h, lt) {
  const at = (t0, d = 0.5) => clamp01((lt - t0) / d);
  g.save();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const px = Math.round(h * 0.2 * (1.06 - 0.06 * ease(at(0.1, 1.2))));
  g.globalAlpha = at(0.1, 0.35);
  g.font = `700 ${px}px ${FONT}`;
  g.letterSpacing = `${Math.round(px * 0.06)}px`;
  const a = 'IMPACT', b = 'BOX', wa = g.measureText(a).width, wb = g.measureText(b).width, x0 = w / 2 - (wa + wb) / 2;
  g.textAlign = 'left';
  g.fillStyle = '#fff'; g.fillText(a, x0, h * 0.42);
  g.fillStyle = RED; g.fillText(b, x0 + wa, h * 0.42);
  g.textAlign = 'center';
  const line = (text, y, t0, size, color = '#fff') => {
    g.globalAlpha = at(t0);
    g.fillStyle = color;
    g.font = `600 ${Math.round(h * size)}px ${FONT}`;
    g.letterSpacing = `${Math.round(h * size * 0.18)}px`;
    g.fillText(text, w / 2, y);
  };
  line('RAGDOLLS  ·  GORE  ·  CARS  ·  ZOMBIES  ·  CO-OP', h * 0.58, 1.0, 0.032, 'rgba(255,255,255,0.75)');
  line('PLAY FREE IN YOUR BROWSER', h * 0.7, 1.9, 0.05);
  line('mendulolware.github.io/impactbox', h * 0.78, 2.3, 0.034, RED);
  g.restore();
  g.globalAlpha = 1;
}

// -------------------------------------------------------------------------------------------- the soundtrack
/** Every sound in the trailer, scheduled on an audio context (a live one, or an offline one for the video). */
function score(ac, out, cues) {
  const master = ac.createGain();
  master.gain.value = 0.5;                   // (headroom: the blasts stack up; trailer_render.py brings the whole up to streaming loudness)
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
  master.connect(comp); comp.connect(out);
  // a big hall
  const verb = ac.createConvolver();
  const n = Math.floor(ac.sampleRate * 3.2), ir = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / ac.sampleRate * 2.1); }
  verb.buffer = ir;
  const wet = ac.createGain(); wet.gain.value = 0.3;
  verb.connect(wet); wet.connect(master);
  const noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  const send = (node, amount) => { node.connect(master); if (amount) { const s = ac.createGain(); s.gain.value = amount; node.connect(s); s.connect(verb); } };
  const env = (param, t, peak, attack, decay) => {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const tone = (t, type, f0, f1, dur, gain, verbAmt = 0.2, attack = 0.005) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g.gain, t, gain, attack, dur);
    o.connect(g); send(g, verbAmt);
    o.start(t); o.stop(t + attack + dur + 0.05);
  };
  const noise = (t, dur, f0, f1, gain, type = 'lowpass', q = 0.7, verbAmt = 0.25, attack = 0.002) => {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
    env(g.gain, t, gain, attack, dur);
    src.connect(f); f.connect(g); send(g, verbAmt);
    src.start(t, Math.random()); src.stop(t + attack + dur + 0.05);
  };
  // the trailer "braam": a stack of saws in A minor through a filter that flares and closes, and a sub drop
  const braam = (t, k = 1) => {
    const f = ac.createBiquadFilter(), g = ac.createGain(), shape = ac.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = i / 255.5 - 1; curve[i] = Math.tanh(x * 2.5); }
    shape.curve = curve;
    f.type = 'lowpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.12); f.frequency.exponentialRampToValueAtTime(260, t + 2.6);
    env(g.gain, t, 0.32 * k, 0.03, 3.0);
    for (const fr of [55, 110, 130.8, 164.8, 220]) for (const det of [-6, 6]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
      o.connect(shape); o.start(t); o.stop(t + 3.2);
    }
    shape.connect(f); f.connect(g); send(g, 0.45);
    tone(t, 'sine', 70, 32, 1.8, 0.7 * k, 0.1);
    noise(t, 1.4, 1400, 60, 0.45 * k, 'lowpass', 0.7, 0.5);
  };
  const KINDS = {
    braam: (c) => braam(c.t),
    logo: (c) => { braam(c.t + 0.1, 1.2); tone(c.t + 1.9, 'sine', 880, 870, 4, 0.05, 0.8, 0.4); tone(c.t + 1.9, 'sine', 1318, 1310, 4, 0.03, 0.8, 0.4); },
    shot: (c) => { noise(c.t, 0.22, 7000, 700, 0.9, 'lowpass', 0.7, 0.35); tone(c.t, 'sine', 150, 45, 0.16, 0.8, 0.1); },
    shotgun: (c) => { noise(c.t, 0.4, 5000, 300, 1.1, 'lowpass', 0.7, 0.45); tone(c.t, 'sine', 110, 35, 0.3, 1.0, 0.1); },
    glass: (c) => { KINDS.shot(c); noise(c.t + 0.01, 0.5, 6000, 3000, 0.35, 'highpass', 1.2, 0.4); for (let i = 0; i < 9; i++) tone(c.t + 0.02 + i * 0.03, 'triangle', rnd(2500, 5000), rnd(2000, 4000), 0.08, 0.06, 0.4); },
    crash: (c) => { noise(c.t, 0.5, 3000, 150, 1.0, 'lowpass', 0.8, 0.3); tone(c.t, 'sine', 95, 38, 0.3, 0.9, 0.1); tone(c.t, 'square', 420, 360, 0.18, 0.08, 0.3); },
    splash: (c) => { noise(c.t, 0.55, 2400, 300, 0.6, 'bandpass', 0.8, 0.35); noise(c.t + 0.12, 0.4, 1600, 400, 0.3, 'bandpass', 0.8, 0.35); },
    thud: (c) => { tone(c.t, 'sine', 90, 38, 0.22, 0.7, 0.2); noise(c.t, 0.18, 500, 80, 0.4, 'lowpass', 0.7, 0.2); },
    blast: (c) => { noise(c.t, 2.4, 2600, 45, 1.3, 'lowpass', 0.7, 0.5); tone(c.t, 'sine', 72, 24, 1.9, 1.1, 0.2); noise(c.t + 0.05, 0.9, 5000, 1500, 0.25, 'highpass', 0.7, 0.4); },
    riser: (c) => { noise(c.t, c.len, 250, 7000, 0.35, 'bandpass', 2, 0.4, c.len * 0.9); tone(c.t, 'sawtooth', 110, 440, c.len, 0.05, 0.4, c.len * 0.9); },
    pulse: (c) => {                         // 132 bpm: a low drum on the beat, a tick on the eighths, louder as it goes
      const beat = 60 / 132;
      for (let b = 0; b * beat < c.len; b++) {
        const t = c.t + b * beat, k = 0.55 + 0.45 * (b * beat / c.len);
        tone(t, 'sine', 120, 42, 0.2, 0.55 * k, 0.15);
        noise(t + beat / 2, 0.04, 9000, 6000, 0.1 * k, 'highpass', 0.7, 0.1);
        if (b % 4 === 3) noise(t + beat * 0.75, 0.04, 9000, 6000, 0.07 * k, 'highpass', 0.7, 0.1);
      }
    },
    drone: (c) => {                         // two slightly apart saws on low A, and a sub under them, opening up as it goes
      const f = ac.createBiquadFilter(), g = ac.createGain();
      f.type = 'lowpass'; f.Q.value = 1;
      f.frequency.setValueAtTime(160, c.t); f.frequency.linearRampToValueAtTime(900, c.t + c.len);
      g.gain.setValueAtTime(0.0001, c.t); g.gain.exponentialRampToValueAtTime(0.06, c.t + 2.5);
      g.gain.setValueAtTime(0.06, c.t + c.len - 1); g.gain.exponentialRampToValueAtTime(0.0001, c.t + c.len);
      for (const [fr, type] of [[55, 'sawtooth'], [55.35, 'sawtooth'], [27.5, 'sine']]) {
        const o = ac.createOscillator();
        o.type = type; o.frequency.value = fr;
        o.connect(f); o.start(c.t); o.stop(c.t + c.len + 0.1);
      }
      f.connect(g); send(g, 0.3);
    },
  };
  for (const c of cues) KINDS[c.kind]?.(c);
}

/** 16-bit stereo WAV of an audio buffer. */
function wav(buf) {
  const n = buf.length, ch = buf.numberOfChannels, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  return out.buffer;
}

// ---------------------------------------------------------------------------------------------- playing it
export async function start(ctx) {
  document.body.classList.add('trailer');
  if (ctx.rain) ctx.toggleRain();            // (dry weather unless a shot asks for it)
  ctx.frozen = true;
  ctx.view = null;
  await document.fonts.load(`700 100px ${FONT}`).catch(() => {});
  const tl = new Timeline(ctx);
  tl.tick();                                 // (the first shot set up: something to draw from the first frame)
  const render = new URLSearchParams(location.search).get('trailer') === 'render';
  window.__trailer = tl;
  if (render) return renderToFile(ctx, tl);

  // in the browser: a canvas over the game for the words and the cards, and a button (sound needs a click)
  const c = document.createElement('canvas');
  c.id = 'trailer';
  document.body.appendChild(c);
  const g = c.getContext('2d');
  const fit = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; };
  fit(); addEventListener('resize', fit);
  const btn = document.createElement('button');
  btn.id = 'trailer-play';
  btn.textContent = '▶  WATCH THE TRAILER';
  document.body.appendChild(btn);
  await new Promise((res) => btn.addEventListener('click', res, { once: true }));
  btn.remove();
  const ac = new AudioContext();
  const t0 = ac.currentTime + 0.15;
  score(ac, ac.destination, tl.cues.map((q) => ({ ...q, t: q.t + t0 })));
  const loop = () => {
    const want = Math.min(tl.total, ac.currentTime - t0);
    for (let k = 0; k < 4 && tl.t < want; k++) tl.tick();           // (the music keeps time; a slow frame catches up)
    tl.draw(g, c.width, c.height, false);
    if (tl.t < tl.total) requestAnimationFrame(loop);
    else {
      const a = document.createElement('a');
      a.id = 'trailer-play';
      a.href = location.pathname;
      a.textContent = 'PLAY IT NOW';
      document.body.appendChild(a);
    }
  };
  requestAnimationFrame(loop);
}

/** Frame by frame at 1920x1080, 30 fps, to trailer_render.py; the sound goes first, rendered offline. */
async function renderToFile(ctx, tl) {
  const Wd = 1920, Ht = 1080, FPS = 30;
  const status = (s) => { document.title = s; window.__trailerStatus = s; };
  status('rendering the sound');
  const off = new OfflineAudioContext(2, Math.ceil((tl.total + 1) * 48000), 48000);
  score(off, off.destination, tl.cues);
  await fetch(`${SINK}/audio`, { method: 'POST', body: wav(await off.startRendering()) });
  ctx.renderer.setPixelRatio(1);
  ctx.renderer.setSize(Wd, Ht, false);
  ctx.post.setSize(Wd, Ht);
  ctx.camera.aspect = Wd / Ht;
  ctx.camera.updateProjectionMatrix();
  const out = document.createElement('canvas');
  out.width = Wd; out.height = Ht;
  const g = out.getContext('2d');
  const frames = Math.ceil(tl.total * FPS);
  for (let f = 0; f < frames; f++) {
    while (tl.t < f / FPS - 1e-6) tl.tick();
    tl.draw(g, Wd, Ht, true);
    // (toDataURL: toBlob took a second a frame here, this takes 50 ms)
    await fetch(`${SINK}/frame/${f}`, { method: 'POST', body: out.toDataURL('image/jpeg', 0.92) });
    status(`frame ${f + 1} / ${frames}`);
  }
  await fetch(`${SINK}/done`, { method: 'POST', body: String(FPS) });
  status('done');
}
