// Tiny procedural sound effects (no asset files needed).
let ac = null, master = null, noiseBuf = null;

export function initAudio() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.45;
      master.connect(ac.destination);
      const len = ac.sampleRate;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  } catch (e) { /* audio is optional */ }
}

function noise({ dur = 0.2, f0 = 2000, f1 = 200, q = 0.7, gain = 0.6, type = 'lowpass' }) {
  if (!ac) return;
  const t = ac.currentTime;
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
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.4, dur + 0.05);
}

function tone({ f0 = 120, f1 = 40, dur = 0.3, gain = 0.6, type = 'sine' }) {
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  pistol()    { noise({ dur: 0.18, f0: 5000, f1: 300, gain: 0.7 }); tone({ f0: 220, f1: 50, dur: 0.12, gain: 0.5 }); },
  shotgun()   { noise({ dur: 0.45, f0: 4000, f1: 120, gain: 1.0 }); tone({ f0: 130, f1: 35, dur: 0.3, gain: 0.8 }); },
  revolver()  { noise({ dur: 0.3, f0: 4500, f1: 180, gain: 1.0 }); tone({ f0: 170, f1: 40, dur: 0.22, gain: 0.8 }); },
  smg()       { noise({ dur: 0.09, f0: 6500, f1: 700, gain: 0.5 }); tone({ f0: 320, f1: 90, dur: 0.06, gain: 0.3 }); },
  sniper()    { noise({ dur: 0.7, f0: 7000, f1: 90, gain: 1.3 }); tone({ f0: 150, f1: 28, dur: 0.5, gain: 1.0 }); },
  rocket()    { noise({ dur: 1.1, f0: 500, f1: 3500, q: 0.8, gain: 0.8, type: 'bandpass' }); tone({ f0: 80, f1: 40, dur: 0.4, gain: 0.7 }); },
  rifle()     { noise({ dur: 0.12, f0: 6000, f1: 500, gain: 0.6 }); tone({ f0: 280, f1: 70, dur: 0.08, gain: 0.4 }); },
  slash()     { noise({ dur: 0.18, f0: 700, f1: 4500, q: 1.2, gain: 0.3, type: 'bandpass' }); },
  chop()      { noise({ dur: 0.14, f0: 2500, f1: 200, gain: 0.7 }); tone({ f0: 150, f1: 50, dur: 0.12, gain: 0.5 }); },
  squish()    { noise({ dur: 0.14, f0: 900, f1: 150, gain: 0.45 }); },
  explosion() { noise({ dur: 1.5, f0: 1600, f1: 50, gain: 1.3 }); tone({ f0: 95, f1: 22, dur: 1.0, gain: 1.0 }); },
  crack()     { noise({ dur: 0.07, f0: 3200, f1: 900, q: 2.5, gain: 0.6, type: 'bandpass' }); tone({ f0: 260, f1: 80, dur: 0.05, gain: 0.3, type: 'square' }); },
  twang()     { tone({ f0: 520, f1: 140, dur: 0.16, gain: 0.3, type: 'triangle' }); noise({ dur: 0.06, f0: 3000, f1: 800, gain: 0.25 }); },
  saw()       { tone({ f0: 95 + Math.random() * 25, f1: 70, dur: 0.1, gain: 0.3, type: 'sawtooth' }); noise({ dur: 0.09, f0: 2600, f1: 1200, q: 3, gain: 0.22, type: 'bandpass' }); },
  flame()     { noise({ dur: 0.16, f0: 900, f1: 500, q: 0.6, gain: 0.3, type: 'bandpass' }); },
  whirr(v = 0) { tone({ f0: 140 + v * 420, f1: 180 + v * 460, dur: 0.12, gain: 0.14, type: 'sawtooth' }); },
  thud(v = 1) { tone({ f0: 100, f1: 40, dur: 0.1, gain: 0.3 * v }); },
  pop()       { tone({ f0: 380, f1: 820, dur: 0.07, gain: 0.15, type: 'triangle' }); },
  tick()      { tone({ f0: 1200, f1: 900, dur: 0.04, gain: 0.12, type: 'square' }); },
};
