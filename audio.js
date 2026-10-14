// Sound. Most of it is real recordings (assets/sounds, all public domain: see assets/sounds/CREDITS.md):
// gunshots, voices, flesh, footsteps, blades. A few things with no recording are still made from
// noise and oscillators (rocket, chainsaw, flamethrower, crossbow, ricochets), and so is everything
// for the first moment while the recordings load.
//
//   play()             one recording, picked at random from its takes, at a pitch and level
//   noise() / tone()   the synthetic building blocks: a filtered burst of noise, a swept oscillator
//   shot()             a synthetic gunshot (only heard if a recording has not loaded)
//   the echo           one generated impulse response; setSpace() says how much of it a place has
//   the ambience       a quiet bed of wind, room hum or city, per map
let ac = null, master = null, wetIn = null, wetOut = null, noiseBuf = null, ears = null, comp = null;
let deaf = 0, deafAt = 0, micHp = null, micClip = null, micOn = false;
let space = 'yard', bed = null;

// recordings: name -> how many takes there are (files are assets/sounds/<name>_<n>.mp3)
const TAKES = {
  pistol: 2, revolver: 2, smg: 2, uzi: 2, shotgun: 2, dbarrel: 2, rifle: 2, ar15: 2, sniper: 2, minigun: 2,
  grunt: 10, scream: 10, death: 8, step: 8, slice: 2, chop: 1, click: 1, latch: 1, draw: 1,
};
const clips = {};       // name -> decoded takes
let playing = 0;

async function loadClips() {
  await Promise.all(Object.entries(TAKES).flatMap(([name, n]) => Array.from({ length: n }, async (_, i) => {
    try {
      const data = await (await fetch(`assets/sounds/${name}_${i + 1}.mp3`)).arrayBuffer();
      const buf = await ac.decodeAudioData(data);
      (clips[name] || (clips[name] = [])).push(buf);
    } catch (e) { /* that take is missing: the others, or the synthetic sound, cover for it */ }
  })));
}

/**
 * Play a recording. rate = pitch and speed, send = how much goes to the echo, delay in seconds.
 * Returns false if there is nothing loaded under that name (so the caller can fall back).
 */
function play(name, { gain = 1, rate = 1, send = 0, delay = 0, jitter = 0.04 } = {}) {
  const takes = clips[name];
  if (!ac || !takes || !takes.length) return false;
  if (playing > 40 || gain < 0.02) return true;          // a minigun in a crowd: enough is enough
  const src = ac.createBufferSource();
  src.buffer = takes[(Math.random() * takes.length) | 0];
  src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 2 * jitter);
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(g);
  out(g, send);
  playing++;
  src.onended = () => { playing--; };
  src.start(ac.currentTime + delay);
  return true;
}

// how much echo each place has, and what it sounds like when nothing is happening
const SPACES = {
  yard:      { wet: 0.28, bed: 'wind' },
  warehouse: { wet: 0.6,  bed: 'hum', indoor: 1 },
  rooftops:  { wet: 0.16, bed: 'gale' },
  street:    { wet: 0.42, bed: 'city' },
  killhouse: { wet: 0.22, bed: 'wind', indoor: 0.7 },
  house:     { wet: 0.45, bed: 'hum', indoor: 1 },
};

export function initAudio() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      comp = ac.createDynamicsCompressor();          // keeps a minigun from being louder than a pistol
      comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.18;
      comp.connect(ac.destination);
      master = ac.createGain();
      master.gain.value = 0.5;
      ears = ac.createBiquadFilter();                      // everything is heard through these (see deafen)
      ears.type = 'lowpass'; ears.frequency.value = 20000;
      // then through the bodycam's microphone when that view is on (bodycam()): thin, and loud things clip
      micHp = ac.createBiquadFilter(); micHp.type = 'highpass';
      micClip = ac.createWaveShaper();
      ears.connect(micHp); micHp.connect(micClip); micClip.connect(comp);
      bodycam(micOn);
      master.connect(ears);
      const len = ac.sampleRate;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // the echo: decaying noise with a couple of distinct slaps off far walls
      const n = Math.floor(ac.sampleRate * 2.0);
      const ir = ac.createBuffer(2, n, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const o = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < n; i++) {
          const t = i / ac.sampleRate;
          lp += ((Math.random() * 2 - 1) - lp) * (0.5 - 0.42 * Math.min(1, t / 1.2));     // the tail gets duller as it goes
          o[i] = lp * Math.exp(-t * 3.4) * (t < 0.012 ? t / 0.012 : 1);
        }
        for (const [at, amp] of [[0.11, 0.5], [0.19 + ch * 0.02, 0.35], [0.33 - ch * 0.03, 0.22]]) {
          const i0 = Math.floor(at * ac.sampleRate);
          for (let i = 0; i < 300; i++) o[i0 + i] += (Math.random() * 2 - 1) * amp * (1 - i / 300);
        }
      }
      const conv = ac.createConvolver();
      conv.buffer = ir;
      wetIn = ac.createGain();
      wetOut = ac.createGain();
      wetIn.connect(conv); conv.connect(wetOut); wetOut.connect(ears);
      setSpace(space);
      loadClips();
    }
    if (ac.state === 'suspended') ac.resume();
  } catch (e) { /* audio is optional */ }
}

/** The game's sound as a stream, for recording. */
export function audioStream() {
  if (!ac) return null;
  const dest = ac.createMediaStreamDestination();
  comp.connect(dest);
  return { stream: dest.stream, stop: () => comp.disconnect(dest) };
}

/** Hear the world through the bodycam's little microphone (or not). */
export function bodycam(on) {
  micOn = on;
  if (!ac) return;
  micHp.frequency.value = on ? 260 : 10;
  if (on && !CLIP) {
    CLIP = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; CLIP[i] = Math.tanh(x * 3.2) / Math.tanh(3.2); }
  }
  micClip.curve = on ? CLIP : null;
}
let CLIP = null;

/**
 * A blast, or gunfire in a closed room: the world goes dull and the ears ring, then both come back over a few seconds.
 * amount 0..1; it adds up. indoorsOnly = only counts where the walls throw the sound back (shooting).
 */
export function deafen(amount, indoorsOnly = false) {
  if (!ac) return;
  if (indoorsOnly) amount *= (SPACES[space] || SPACES.yard).indoor || 0;
  if (amount < 0.01) return;
  const now = ac.currentTime;
  deaf = Math.min(1, deaf * Math.exp(-(now - deafAt) / 1.5) + amount);
  deafAt = now;
  const back = 1.5 + 4 * deaf;
  ears.frequency.cancelScheduledValues(now);
  ears.frequency.setValueAtTime(20000 * Math.pow(0.02, deaf), now);        // 1 = down to 400 Hz
  ears.frequency.exponentialRampToValueAtTime(20000, now + back);
  if (deaf > 0.3) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 4100;
    g.gain.setValueAtTime(0.07 * deaf, now);
    g.gain.exponentialRampToValueAtTime(0.0005, now + back);
    o.connect(g); g.connect(comp);
    o.start(now); o.stop(now + back);
  }
}

/** Which map we are in: sets the echo and the background. Safe to call before the audio exists. */
export function setSpace(id) {
  space = id;
  if (!ac) return;
  const s = SPACES[id] || SPACES.yard;
  wetOut.gain.setTargetAtTime(s.wet, ac.currentTime, 0.2);
  if (bed) { const old = bed; old.gain.gain.setTargetAtTime(0, ac.currentTime, 0.4); setTimeout(() => old.stop(), 2500); bed = null; }
  bed = ambience(s.bed);
}

/** A looping background. Returns { gain, stop }. */
function ambience(kind) {
  const g = ac.createGain();
  g.gain.value = 0;
  g.connect(master);
  const nodes = [];
  const loop = (freq, q, level, type = 'lowpass') => {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    src.playbackRate.value = 0.6 + Math.random() * 0.3;
    const f = ac.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const lv = ac.createGain();
    lv.gain.value = level;
    const lfo = ac.createOscillator(), depth = ac.createGain();       // it breathes: gusts, passing traffic
    lfo.frequency.value = 0.07 + Math.random() * 0.1; depth.gain.value = level * 0.6;
    lfo.connect(depth); depth.connect(lv.gain);
    src.connect(f); f.connect(lv); lv.connect(g);
    src.start(); lfo.start();
    nodes.push(src, lfo);
  };
  const hum = (freq, level) => {
    const o = ac.createOscillator(), lv = ac.createGain();
    o.frequency.value = freq; lv.gain.value = level;
    o.connect(lv); lv.connect(g); o.start();
    nodes.push(o);
  };
  if (kind === 'wind') { loop(420, 0.4, 0.035); }
  else if (kind === 'gale') { loop(520, 0.5, 0.07); }
  else if (kind === 'hum') { hum(60, 0.01); loop(260, 0.5, 0.02); }
  else if (kind === 'city') { loop(210, 0.5, 0.045); }
  g.gain.setTargetAtTime(1, ac.currentTime, 0.8);
  return { gain: g, stop: () => { for (const n of nodes) { try { n.stop(); } catch (e) { /* already stopped */ } } g.disconnect(); } };
}

/** Connect a sound to the output, and `send` (0..1) of it to the echo. */
function out(node, send) {
  node.connect(master);
  if (send > 0) {
    const s = ac.createGain();
    s.gain.value = send;
    node.connect(s);
    s.connect(wetIn);
  }
}

function noise({ dur = 0.2, f0 = 2000, f1 = 200, q = 0.7, gain = 0.6, type = 'lowpass', send = 0, delay = 0 }) {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ac.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g);
  out(g, send);
  src.start(t, Math.random() * 0.4, dur + 0.05);
}

function tone({ f0 = 120, f1 = 40, dur = 0.3, gain = 0.6, type = 'sine', send = 0, delay = 0 }) {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  out(g, send);
  o.start(t); o.stop(t + dur + 0.05);
}

/**
 * A gunshot. crack = the supersonic snap, body = the blast, thump = the low end, tail = how much echo,
 * mech = the action cycling just after, ping = the ring some guns have (an AR's buffer spring).
 */
function shot({ crack = 1, crackHz = 4500, body = 0.8, bodyHz = [2600, 220], bodyDur = 0.16, thump = 0.6, thumpHz = [170, 45],
  thumpDur = 0.14, tail = 0.35, mech = 0, ping = 0, jitter = 0.06 }) {
  const j = 1 + (Math.random() - 0.5) * 2 * jitter;        // no two shots quite alike
  noise({ dur: 0.03, f0: crackHz * j, f1: crackHz * 0.55 * j, type: 'highpass', gain: crack, send: tail * 0.5 });
  noise({ dur: bodyDur, f0: bodyHz[0] * j, f1: bodyHz[1], gain: body, send: tail });
  tone({ f0: thumpHz[0] * j, f1: thumpHz[1], dur: thumpDur, gain: thump, send: tail * 0.4 });
  if (mech) noise({ delay: 0.035, dur: 0.022, f0: 3200, f1: 1700, q: 4, type: 'bandpass', gain: mech });
  if (ping) tone({ delay: 0.018, f0: 870 * j, f1: 830 * j, dur: 0.1, gain: ping, type: 'triangle' });
}

const rnd = (a, b) => a + Math.random() * (b - a);

// whose throat: the NPC's pitch (0.7..1.3) becomes a modest change of speed
const throat = (pitch) => 0.92 + (pitch - 0.8) * 0.4;

export const sfx = {
  // ---- guns: a recording of the real thing, or (until it has loaded) a synthetic stand-in
  /** A suppressed round: a hard cough and the action cycling, not silence. */
  suppressed() { noise({ dur: 0.06, f0: 3200, f1: 500, gain: 0.38, type: 'bandpass' }); tone({ f0: 170, f1: 60, dur: 0.06, gain: 0.22 }); play('click', { gain: 0.35, rate: 0.75 }); },
  pistol()    { play('pistol', { gain: 0.8, send: 0.12 }) || shot({ crack: 0.8, crackHz: 5200, body: 0.7, bodyHz: [3200, 320], bodyDur: 0.11, thump: 0.45, thumpHz: [210, 60], thumpDur: 0.09, tail: 0.3 }); },
  revolver()  { play('revolver', { gain: 0.95, send: 0.15 }) || shot({ crack: 1.0, crackHz: 4200, body: 1.0, bodyHz: [2400, 150], bodyDur: 0.24, thump: 0.9, thumpHz: [160, 38], thumpDur: 0.2, tail: 0.5 }); },
  smg()       { play('smg', { gain: 0.6, send: 0.08 }) || shot({ crack: 0.6, crackHz: 6000, body: 0.5, bodyHz: [3600, 500], bodyDur: 0.07, thump: 0.3, thumpHz: [260, 90], thumpDur: 0.05, tail: 0.2 }); },
  uzi()       { play('uzi', { gain: 0.6, send: 0.08, rate: 1.06 }) || shot({ crack: 0.55, crackHz: 5200, body: 0.55, bodyHz: [2900, 420], bodyDur: 0.065, thump: 0.36, thumpHz: [230, 80], thumpDur: 0.05, tail: 0.2 }); },
  shotgun()   { play('shotgun', { gain: 1.0, send: 0.2 }) || shot({ crack: 0.9, crackHz: 3200, body: 1.1, bodyHz: [2200, 110], bodyDur: 0.34, thump: 1.0, thumpHz: [130, 32], thumpDur: 0.28, tail: 0.55 }); },
  dbarrel()   { play('dbarrel', { gain: 1.0, send: 0.22, rate: 0.94 }) || this.shotgun(); },
  rifle()     { play('rifle', { gain: 0.8, send: 0.1 }) || shot({ crack: 0.9, crackHz: 4000, body: 0.75, bodyHz: [2300, 260], bodyDur: 0.12, thump: 0.6, thumpHz: [180, 55], thumpDur: 0.1, tail: 0.38 }); },
  ar15()      { play('ar15', { gain: 0.8, send: 0.1 }) || shot({ crack: 1.0, crackHz: 6400, body: 0.6, bodyHz: [3800, 380], bodyDur: 0.09, thump: 0.42, thumpHz: [230, 70], thumpDur: 0.07, tail: 0.42 }); },
  minigun()   { play('minigun', { gain: 0.5, send: 0.05, rate: 1.12 }) || shot({ crack: 0.6, crackHz: 5000, body: 0.55, bodyHz: [3000, 400], bodyDur: 0.05, thump: 0.4, thumpHz: [200, 80], thumpDur: 0.04, tail: 0.16 }); },
  sniper()    { play('sniper', { gain: 1.1, send: 0.3 }) || shot({ crack: 1.3, crackHz: 3600, body: 1.3, bodyHz: [2600, 90], bodyDur: 0.5, thump: 1.1, thumpHz: [150, 26], thumpDur: 0.45, tail: 0.8 }); },
  rocket()    { noise({ dur: 1.1, f0: 500, f1: 3500, q: 0.8, gain: 0.8, type: 'bandpass', send: 0.3 }); tone({ f0: 80, f1: 40, dur: 0.4, gain: 0.7 }); },
  twang()     { tone({ f0: 520, f1: 140, dur: 0.16, gain: 0.3, type: 'triangle' }); noise({ dur: 0.06, f0: 3000, f1: 800, gain: 0.25 }); },
  /** A spent case hitting the ground a moment after the shot. */
  shell()     { const d = rnd(0.42, 0.6); play('click', { delay: d, gain: 0.1, rate: 2.3, jitter: 0.12 }); play('click', { delay: d + 0.09, gain: 0.05, rate: 2.6, jitter: 0.12 }); },
  /** Breaking a gun open, or racking it. */
  reload()    { play('latch', { gain: 0.7 }) || noise({ dur: 0.05, f0: 1800, f1: 700, q: 3, type: 'bandpass', gain: 0.45 }); },
  whirr(v = 0) { tone({ f0: 140 + v * 420, f1: 180 + v * 460, dur: 0.12, gain: 0.1, type: 'sawtooth' }); },
  flame()     { noise({ dur: 0.16, f0: 900, f1: 500, q: 0.6, gain: 0.3, type: 'bandpass' }); },

  // ---- hand weapons
  slash()     { play('slice', { gain: 0.5 }) || noise({ dur: 0.18, f0: 700, f1: 4500, q: 1.2, gain: 0.3, type: 'bandpass' }); },
  chop()      { play('chop', { gain: 0.8 }) || noise({ dur: 0.14, f0: 2500, f1: 200, gain: 0.7 }); },
  saw()       { tone({ f0: 95 + Math.random() * 25, f1: 70, dur: 0.1, gain: 0.3, type: 'sawtooth' }); noise({ dur: 0.09, f0: 2600, f1: 1200, q: 3, gain: 0.22, type: 'bandpass' }); },

  // ---- what hits do
  crack()     { noise({ dur: 0.07, f0: 3200, f1: 900, q: 2.5, gain: 0.6, type: 'bandpass' }); tone({ f0: 260, f1: 80, dur: 0.05, gain: 0.3, type: 'square' }); },
  thud(v = 1) { play('step', { gain: 0.6 * v, rate: 0.55 }); tone({ f0: 100, f1: 40, dur: 0.1, gain: 0.3 * v }); },
  /** The taser's crackle, and a beanbag's dull thump out of the barrel, and the spray's hiss. */
  taser()     { for (let i = 0; i < 6; i++) tone({ f0: 60, f1: 50, dur: 0.05, gain: 0.3, type: 'square', delay: i * 0.08 }); noise({ dur: 0.5, f0: 6000, f1: 4000, type: 'highpass', gain: 0.18 }); },
  beanbag()   { play('shotgun', { gain: 0.45, rate: 0.7 }) || shot({ crack: 0.3, crackHz: 2500, body: 0.6, bodyHz: [1400, 200], bodyDur: 0.12, thump: 0.6, thumpHz: [150, 50], thumpDur: 0.1, tail: 0.2 }); },
  spray()     { noise({ dur: 0.1, f0: 7000, f1: 6000, type: 'highpass', gain: 0.16 }); },
  /** A door on its hinges. */
  door()      { play('latch', { gain: 0.5, rate: 0.8 }); tone({ f0: 160, f1: 95, dur: 0.5, gain: 0.08, type: 'sawtooth' }); },
  /** A round into concrete or steel. */
  impact()    { noise({ dur: 0.05, f0: 5200, f1: 1200, type: 'highpass', gain: 0.22, send: 0.1 }); tone({ f0: 180, f1: 70, dur: 0.06, gain: 0.14 }); },
  explosion() {
    play('dbarrel', { gain: 1.3, rate: 0.42, send: 0.6 });               // a 12 gauge slowed right down is a very good bang
    play('sniper', { gain: 1.0, rate: 0.3, send: 0.4 });
    tone({ f0: 95, f1: 22, dur: 1.0, gain: 1.0, send: 0.3 });
    if (!clips.dbarrel) noise({ dur: 1.6, f0: 1600, f1: 50, gain: 1.3, send: 0.7 });
  },

  // ---- people. level = how near the listener is (1 = beside them), pitch = whose voice it is
  grunt(level = 1, pitch = 1)    { play('grunt', { gain: 0.9 * level, rate: throat(pitch), send: 0.1 }); },
  scream(level = 1, pitch = 1)   { play('scream', { gain: 0.9 * level, rate: throat(pitch), send: 0.15 }); },
  deathcry(level = 1, pitch = 1) { play('death', { gain: 0.9 * level, rate: throat(pitch), send: 0.15 }); },
  growl(level = 1, pitch = 1)    { play('death', { gain: 0.9 * level, rate: 0.5 + (pitch - 0.7) * 0.25, send: 0.15 }); },   // a man, slowed to something that is not
  playerHurt() { play('grunt', { gain: 0.7, rate: 0.9 }); },
  /** One footfall. */
  step(run = false) { play('step', { gain: run ? 0.5 : 0.32, rate: run ? 1.1 : 1, jitter: 0.08 }); },

  // ---- interface
  pop()       { tone({ f0: 380, f1: 820, dur: 0.07, gain: 0.1, type: 'triangle' }); },
  tick()      { play('click', { gain: 0.5 }) || tone({ f0: 1200, f1: 900, dur: 0.04, gain: 0.12, type: 'square' }); },
};
