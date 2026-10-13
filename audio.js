// Every sound in the game is made here from noise and oscillators: there are no audio files.
//
//   noise() / tone()   the two building blocks: a filtered burst of noise, a swept oscillator
//   shot()             a gunshot built from layers: the crack, the body, the thump you feel, the
//                      action cycling, and how much of it goes out into the echo
//   voice()            a throat: a buzzing source through formant filters (screams, grunts, growls)
//   the echo           one generated impulse response; setSpace() says how much of it a place has
//   the ambience       a quiet bed of wind, room hum or city, per map
let ac = null, master = null, wetIn = null, wetOut = null, noiseBuf = null;
let space = 'yard', bed = null, voices = 0;

// how much echo each place has, and what it sounds like when nothing is happening
const SPACES = {
  yard:      { wet: 0.28, bed: 'wind' },
  warehouse: { wet: 0.6,  bed: 'hum' },
  rooftops:  { wet: 0.16, bed: 'gale' },
  street:    { wet: 0.42, bed: 'city' },
  killhouse: { wet: 0.22, bed: 'wind' },
};

export function initAudio() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ac.createDynamicsCompressor();          // keeps a minigun from being louder than a pistol
      comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.18;
      comp.connect(ac.destination);
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(comp);
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
      wetIn.connect(conv); conv.connect(wetOut); wetOut.connect(comp);
      setSpace(space);
    }
    if (ac.state === 'suspended') ac.resume();
  } catch (e) { /* audio is optional */ }
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
  if (kind === 'wind') { loop(420, 0.4, 0.07); loop(1400, 1.2, 0.012, 'bandpass'); }
  else if (kind === 'gale') { loop(520, 0.5, 0.13); loop(1900, 1.5, 0.03, 'bandpass'); }
  else if (kind === 'hum') { hum(60, 0.02); hum(120, 0.012); loop(260, 0.5, 0.03); }
  else if (kind === 'city') { loop(210, 0.5, 0.09); loop(900, 0.8, 0.012, 'bandpass'); hum(100, 0.008); }
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

/**
 * A voice. f = [start, peak, end] pitch in Hz, formants = [[Hz, Q, level], ...] (which vowel it is),
 * breath = how much air is in it, rasp = Hz of roughness (growls), level = loudness (distance).
 */
function voice({ f, dur, formants, breath = 0.1, rasp = 0, vib = 0.02, level = 1 }) {
  if (!ac || level < 0.03 || voices >= 6) return;
  voices++;
  setTimeout(() => voices--, dur * 1000 + 100);
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f[0], t);
  o.frequency.linearRampToValueAtTime(f[1], t + dur * 0.25);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f[2]), t + dur);
  const lfo = ac.createOscillator(), depth = ac.createGain();
  lfo.frequency.value = 5.5 + Math.random() * 3; depth.gain.value = f[1] * vib;
  lfo.connect(depth); depth.connect(o.frequency);
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.5 * level, t + 0.03);
  env.gain.setValueAtTime(0.5 * level, t + dur * 0.6);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  let src = o;
  if (rasp) {                                              // a rattle in the throat
    const am = ac.createGain(), r = ac.createOscillator(), rd = ac.createGain();
    am.gain.value = 0.55; r.frequency.value = rasp; r.type = 'square'; rd.gain.value = 0.45;
    r.connect(rd); rd.connect(am.gain); o.connect(am); r.start(t); r.stop(t + dur + 0.05);
    src = am;
  }
  for (const [hz, q, lv] of formants) {
    const b = ac.createBiquadFilter(), g = ac.createGain();
    b.type = 'bandpass'; b.frequency.value = hz; b.Q.value = q; g.gain.value = lv;
    src.connect(b); b.connect(g); g.connect(env);
  }
  if (breath) {
    const n = ac.createBufferSource(), b = ac.createBiquadFilter(), g = ac.createGain();
    n.buffer = noiseBuf; b.type = 'bandpass'; b.frequency.value = 2400; b.Q.value = 0.8; g.gain.value = breath;
    n.connect(b); b.connect(g); g.connect(env);
    n.start(t, Math.random() * 0.3, dur + 0.05);
  }
  out(env, 0.25);
  o.start(t); lfo.start(t);
  o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}

const AH = [[800, 5, 1.0], [1250, 7, 0.6], [2700, 8, 0.3]];       // open mouth
const UH = [[520, 5, 1.0], [1050, 6, 0.5], [2400, 8, 0.15]];      // closed, from the chest
const rnd = (a, b) => a + Math.random() * (b - a);

export const sfx = {
  // ---- guns
  pistol()    { shot({ crack: 0.8, crackHz: 5200, body: 0.7, bodyHz: [3200, 320], bodyDur: 0.11, thump: 0.45, thumpHz: [210, 60], thumpDur: 0.09, tail: 0.3, mech: 0.12 }); },
  revolver()  { shot({ crack: 1.0, crackHz: 4200, body: 1.0, bodyHz: [2400, 150], bodyDur: 0.24, thump: 0.9, thumpHz: [160, 38], thumpDur: 0.2, tail: 0.5 }); },
  smg()       { shot({ crack: 0.6, crackHz: 6000, body: 0.5, bodyHz: [3600, 500], bodyDur: 0.07, thump: 0.3, thumpHz: [260, 90], thumpDur: 0.05, tail: 0.2, mech: 0.1 }); },
  uzi()       { shot({ crack: 0.55, crackHz: 5200, body: 0.55, bodyHz: [2900, 420], bodyDur: 0.065, thump: 0.36, thumpHz: [230, 80], thumpDur: 0.05, tail: 0.2, mech: 0.16 }); },
  shotgun()   { shot({ crack: 0.9, crackHz: 3200, body: 1.1, bodyHz: [2200, 110], bodyDur: 0.34, thump: 1.0, thumpHz: [130, 32], thumpDur: 0.28, tail: 0.55 }); },
  rifle()     { shot({ crack: 0.9, crackHz: 4000, body: 0.75, bodyHz: [2300, 260], bodyDur: 0.12, thump: 0.6, thumpHz: [180, 55], thumpDur: 0.1, tail: 0.38, mech: 0.14 }); },
  ar15()      { shot({ crack: 1.0, crackHz: 6400, body: 0.6, bodyHz: [3800, 380], bodyDur: 0.09, thump: 0.42, thumpHz: [230, 70], thumpDur: 0.07, tail: 0.42, mech: 0.1, ping: 0.07 }); },
  minigun()   { shot({ crack: 0.6, crackHz: 5000, body: 0.55, bodyHz: [3000, 400], bodyDur: 0.05, thump: 0.4, thumpHz: [200, 80], thumpDur: 0.04, tail: 0.16 }); },
  sniper()    { shot({ crack: 1.3, crackHz: 3600, body: 1.3, bodyHz: [2600, 90], bodyDur: 0.5, thump: 1.1, thumpHz: [150, 26], thumpDur: 0.45, tail: 0.8 }); },
  rocket()    { noise({ dur: 1.1, f0: 500, f1: 3500, q: 0.8, gain: 0.8, type: 'bandpass', send: 0.3 }); tone({ f0: 80, f1: 40, dur: 0.4, gain: 0.7 }); },
  twang()     { tone({ f0: 520, f1: 140, dur: 0.16, gain: 0.3, type: 'triangle' }); noise({ dur: 0.06, f0: 3000, f1: 800, gain: 0.25 }); },
  /** A spent case hitting the ground a moment after the shot. */
  shell()     { const d = rnd(0.42, 0.6); for (const [k, g] of [[0, 0.06], [0.07, 0.035], [0.12, 0.02]]) tone({ delay: d + k, f0: rnd(3600, 4600), f1: 3300, dur: 0.05, gain: g, type: 'triangle' }); },
  /** Breaking a gun open, or racking it. */
  reload()    { noise({ dur: 0.04, f0: 2600, f1: 900, q: 3, type: 'bandpass', gain: 0.4 }); noise({ delay: 0.22, dur: 0.05, f0: 1800, f1: 700, q: 3, type: 'bandpass', gain: 0.45 }); tone({ delay: 0.22, f0: 300, f1: 140, dur: 0.05, gain: 0.2, type: 'square' }); },
  whirr(v = 0) { tone({ f0: 140 + v * 420, f1: 180 + v * 460, dur: 0.12, gain: 0.14, type: 'sawtooth' }); },
  flame()     { noise({ dur: 0.16, f0: 900, f1: 500, q: 0.6, gain: 0.3, type: 'bandpass' }); },

  // ---- hand weapons
  slash()     { noise({ dur: 0.18, f0: 700, f1: 4500, q: 1.2, gain: 0.3, type: 'bandpass' }); },
  chop()      { noise({ dur: 0.14, f0: 2500, f1: 200, gain: 0.7 }); tone({ f0: 150, f1: 50, dur: 0.12, gain: 0.5 }); },
  saw()       { tone({ f0: 95 + Math.random() * 25, f1: 70, dur: 0.1, gain: 0.3, type: 'sawtooth' }); noise({ dur: 0.09, f0: 2600, f1: 1200, q: 3, gain: 0.22, type: 'bandpass' }); },

  // ---- what hits do
  squish()    { noise({ dur: 0.14, f0: 900, f1: 150, gain: 0.45 }); tone({ f0: 120, f1: 60, dur: 0.07, gain: 0.25 }); },
  crack()     { noise({ dur: 0.07, f0: 3200, f1: 900, q: 2.5, gain: 0.6, type: 'bandpass' }); tone({ f0: 260, f1: 80, dur: 0.05, gain: 0.3, type: 'square' }); },
  thud(v = 1) { tone({ f0: 100, f1: 40, dur: 0.1, gain: 0.3 * v }); noise({ dur: 0.06, f0: 500, f1: 120, gain: 0.18 * v }); },
  /** A round into concrete or steel; now and then it whines off. */
  impact()    {
    noise({ dur: 0.05, f0: 5200, f1: 1200, type: 'highpass', gain: 0.28, send: 0.15 });
    tone({ f0: 180, f1: 70, dur: 0.06, gain: 0.16 });
    if (Math.random() < 0.22) tone({ delay: 0.01, f0: rnd(2400, 3600), f1: rnd(700, 1100), dur: rnd(0.25, 0.45), gain: 0.07, type: 'triangle', send: 0.4 });
  },
  explosion() {
    noise({ dur: 1.6, f0: 1600, f1: 50, gain: 1.3, send: 0.7 });
    tone({ f0: 95, f1: 22, dur: 1.0, gain: 1.0, send: 0.3 });
    noise({ dur: 0.05, f0: 7000, f1: 2500, type: 'highpass', gain: 0.9 });
    for (let i = 0; i < 5; i++) noise({ delay: rnd(0.25, 1.1), dur: 0.05, f0: rnd(1500, 4000), f1: 500, q: 2, type: 'bandpass', gain: 0.1 });   // bits coming down
  },

  // ---- people. level = how near the listener is (1 = beside them), pitch = whose voice it is
  grunt(level = 1, pitch = 1)   { voice({ f: [190 * pitch, 210 * pitch, 120 * pitch], dur: rnd(0.14, 0.24), formants: UH, breath: 0.2, level }); },
  scream(level = 1, pitch = 1)  { voice({ f: [420 * pitch, 640 * pitch, 380 * pitch], dur: rnd(0.5, 0.95), formants: AH, breath: 0.12, vib: 0.035, level }); },
  deathcry(level = 1, pitch = 1) { voice({ f: [330 * pitch, 360 * pitch, 110 * pitch], dur: rnd(0.55, 0.9), formants: UH, breath: 0.3, vib: 0.05, level: level * 0.9 }); },
  growl(level = 1, pitch = 1)   { voice({ f: [80 * pitch, 95 * pitch, 60 * pitch], dur: rnd(0.45, 0.8), formants: [[420, 3, 1], [950, 4, 0.5]], breath: 0.25, rasp: 27, vib: 0.01, level }); },
  playerHurt() { voice({ f: [150, 165, 95], dur: 0.2, formants: UH, breath: 0.25, level: 0.8 }); tone({ f0: 90, f1: 45, dur: 0.12, gain: 0.3 }); },
  /** One footfall. */
  step(run = false) { noise({ dur: 0.07, f0: run ? 900 : 650, f1: 140, gain: run ? 0.2 : 0.13 }); tone({ f0: 85, f1: 50, dur: 0.05, gain: run ? 0.14 : 0.09 }); },

  // ---- interface
  pop()       { tone({ f0: 380, f1: 820, dur: 0.07, gain: 0.15, type: 'triangle' }); },
  tick()      { tone({ f0: 1200, f1: 900, dur: 0.04, gain: 0.12, type: 'square' }); },
};
