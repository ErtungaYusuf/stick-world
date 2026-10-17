// Sound, all synthesised with WebAudio (no files): blows, blocks, axes, falling trees, fire, thunder,
// plus a living background — wind, rain, birds by day, crickets and the odd wolf howl at night.
// Everything is placed in space: louder the nearer it is to the middle of the screen, panned left / right.
import { clamp } from '/shared/core.js';
import { G } from './state.js';

let A = null, master = null, noiseBuf = null, muted = false;
try { muted = localStorage.getItem('sw-mute') === '1'; } catch { /* storage blocked */ }

// browsers only allow sound after the first click / key press
function start() {
  if (A) { if (A.state === 'suspended') A.resume(); return; }
  try { A = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  master = A.createGain(); master.gain.value = muted ? 0 : .7; master.connect(A.destination);
  noiseBuf = A.createBuffer(1, A.sampleRate * 2, A.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startAmbience();
}
addEventListener('pointerdown', start);
addEventListener('keydown', start);

export const audioState = () => (A ? A.state : 'not started');
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('sw-mute', muted ? '1' : '0'); } catch { /* fine */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : .7, A.currentTime, .05);
  return muted;
}

// how loud and where: a source a screen-width away is barely audible
function place(x, z) {
  const Z = G.cam.zoom, dx = (x - G.cam.x) * Z, dz = (z - G.cam.z) * Z;
  const d = Math.hypot(dx, dz * 1.3), r = Math.max(G.W, 600) * .75;
  return { vol: clamp(1 - d / r, 0, 1) ** 1.6 * clamp(Z / .8, .35, 1), pan: clamp(dx / (G.W * .6 || 600), -1, 1) };
}
function out(x, z, vol = 1) {
  if (!A || muted || A.state !== 'running') return null;
  const p = x == null ? { vol: 1, pan: 0 } : place(x, z);
  if (p.vol * vol < .02) return null;
  const g = A.createGain(); g.gain.value = p.vol * vol;
  const pan = A.createStereoPanner ? A.createStereoPanner() : null;
  if (pan) { pan.pan.value = p.pan; g.connect(pan); pan.connect(master); } else g.connect(master);
  return g;
}
const now = () => A.currentTime;
function env(g, t0, a, peak, dec) {   // attack → exponential decay
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
}
function noise(dest, t0, dur, type, freq, q = 1, peak = 1, a = .003) {
  const s = A.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = A.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = A.createGain(); env(g, t0, a, peak, dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t0, Math.random() * 1.5); s.stop(t0 + a + dur + .05);
  return f;
}
function tone(dest, t0, dur, type, f0, f1, peak = 1, a = .005) {
  const o = A.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + a + dur);
  const g = A.createGain(); env(g, t0, a, peak, dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + a + dur + .05);
  return o;
}
const jit = (v, k = .15) => v * (1 + (Math.random() - .5) * 2 * k);

// ───────── one-off sounds ─────────
const SFX = {
  hit(d, big) {   // a dull thud into a body, a smack on top
    const t = now();
    tone(d, t, big ? .22 : .14, 'sine', jit(big ? 110 : 150), 45, .9);
    noise(d, t, .06, 'bandpass', jit(1400, .3), 1.2, big ? .7 : .45);
  },
  block(d) {   // wood / bone knocking on wood
    const t = now();
    noise(d, t, .05, 'bandpass', jit(2600, .2), 6, .7);
    tone(d, t, .06, 'triangle', jit(720), 520, .25);
  },
  knockdown(d) {
    const t = now();
    tone(d, t, .35, 'sine', 90, 38, 1);
    noise(d, t, .3, 'lowpass', 500, .7, .6);
  },
  chop(d, mine) {
    const t = now();
    if (mine) { noise(d, t, .08, 'bandpass', jit(3200), 4, .6); tone(d, t, .1, 'square', jit(900), 700, .08); }
    else { noise(d, t, .09, 'bandpass', jit(850), 3, .9); tone(d, t, .1, 'sine', jit(210), 140, .5); }
  },
  fell(d) {   // creaking as it tips, then the crash of trunk and branches
    const t = now();
    const o = A.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(48, t + 1.5);
    const lfo = A.createOscillator(); lfo.frequency.value = 13; const lg = A.createGain(); lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency);
    const f = A.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 3;
    const g = A.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(.18, t + .6); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(f); f.connect(g); g.connect(d); o.start(t); lfo.start(t); o.stop(t + 1.7); lfo.stop(t + 1.7);
    noise(d, t + 1.6, .9, 'lowpass', 600, .8, 1, .01);
    noise(d, t + 1.62, .5, 'bandpass', 2400, 1, .35, .01);   // twigs snapping
    tone(d, t + 1.6, .5, 'sine', 70, 30, .9);
  },
  death(d) {   // a last breath, falling away
    const t = now();
    noise(d, t, .7, 'bandpass', 700, 2, .25, .05).frequency.exponentialRampToValueAtTime(260, t + .7);
    tone(d, t + .55, .3, 'sine', 80, 40, .6);
  },
  explosion(d) {
    const t = now();
    noise(d, t, 2.2, 'lowpass', 900, .7, 1, .005).frequency.exponentialRampToValueAtTime(120, t + 2);
    tone(d, t, 1, 'sine', 70, 25, 1);
  },
  thunder(d) {
    const t = now();
    noise(d, t, .25, 'highpass', 1800, .7, .6);
    noise(d, t + .1, 3.2, 'lowpass', 300, .8, 1, .25).frequency.exponentialRampToValueAtTime(90, t + 3);
  },
  kindle(d) {   // a few crackles as the fire catches
    const t = now();
    for (let k = 0; k < 7; k++) noise(d, t + k * .07 + Math.random() * .05, .025, 'bandpass', jit(3000, .4), 3, .5);
    noise(d, t, .6, 'lowpass', 400, .5, .25, .1);
  },
  chime(d) {   // learning / an idea: two soft bell notes
    const t = now(), b = jit(660, .05);
    tone(d, t, .5, 'sine', b, b, .25, .01); tone(d, t + .12, .7, 'sine', b * 1.5, b * 1.5, .2, .01);
  },
  drum(d) {   // a few hide-drum beats
    const t = now();
    for (let k = 0; k < 4; k++) { tone(d, t + k * .22, .18, 'sine', k % 2 ? 95 : 120, 60, .8, .004); noise(d, t + k * .22, .05, 'lowpass', 900, .7, .25); }
  },
  flute(d) {   // a short bone-flute phrase
    const t = now(), scale = [523, 587, 659, 784, 880];
    for (let k = 0; k < 5; k++) { const f = scale[Math.floor(Math.random() * scale.length)]; tone(d, t + k * .2, .22, 'triangle', f, f * 1.01, .22, .03); }
  },
  bite(d) {   // a snarl
    const t = now();
    const f = noise(d, t, .25, 'bandpass', 500, 4, .6, .02); f.frequency.linearRampToValueAtTime(900, t + .2);
    tone(d, t, .2, 'sawtooth', jit(140), 90, .12, .02);
  },
};
export function sfx(kind, x, z, opt, vol = 1) {
  const d = out(x, z, vol);
  if (d) SFX[kind](d, opt);
}

// ───────── the background ─────────
let amb = null;
function loopNoise(type, freq, q) {
  const s = A.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = A.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = A.createGain(); g.gain.value = 0;
  s.connect(f); f.connect(g); g.connect(master); s.start();
  return { g, f };
}
function startAmbience() {
  amb = { wind: loopNoise('lowpass', 380, .6), rain: loopNoise('highpass', 1400, .4), fire: loopNoise('lowpass', 900, .5), birdT: 2, crickT: 0, howlT: 20, crackT: 0 };
}
function chirp(x, z) {   // a short bird phrase: two to five quick rising-falling whistles
  const d = out(x, z, .22); if (!d) return;
  const t = now(), base = jit(2600, .3), n = 2 + Math.floor(Math.random() * 4);
  for (let k = 0; k < n; k++) {
    const o = tone(d, t + k * .11, .07, 'sine', base, base * jit(1.35, .1), .5, .01);
    o.frequency.exponentialRampToValueAtTime(base * .9, t + k * .11 + .09);
  }
}
function cricket() {
  const d = out(null, null, .05); if (!d) return;
  const t = now(), f = jit(4300, .05);
  for (let k = 0; k < 3; k++) tone(d, t + k * .055, .03, 'sine', f, f, .6, .004);
}
function howl(x, z) {
  const d = out(x, z, .5); if (!d) return;
  const t = now(), f = jit(380, .1);
  const o = A.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f * .8, t); o.frequency.exponentialRampToValueAtTime(f * 1.25, t + .6); o.frequency.exponentialRampToValueAtTime(f * 1.15, t + 1.8); o.frequency.exponentialRampToValueAtTime(f * .7, t + 2.6);
  const vib = A.createOscillator(); vib.frequency.value = 5.5; const vg = A.createGain(); vg.gain.value = 6; vib.connect(vg); vg.connect(o.frequency);
  const g = A.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(.5, t + .4); g.gain.setValueAtTime(.5, t + 2); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
  o.connect(g); g.connect(d); o.start(t); vib.start(t); o.stop(t + 2.8); vib.stop(t + 2.8);
}

export function updateSound(dt, night) {
  if (!amb || muted || A.state !== 'running') return;
  const t = now(), Z = G.cam.zoom;
  amb.wind.g.gain.setTargetAtTime(.05 + G.rain * .08 + (G.storm ? .12 : 0) + (G.season === 3 ? .04 : 0), t, .8);
  amb.wind.f.frequency.setTargetAtTime(300 + (G.storm ? 300 : 0) + Math.sin(G.time * .3) * 80, t, 1);
  amb.rain.g.gain.setTargetAtTime(G.rain > .2 ? G.rain * .09 : 0, t, .8);
  // fires near the middle of the screen roar and crackle
  let fire = 0, fx = 0, fz = 0;
  for (const f of G.fires) { const p = place(f.x, f.z).vol * (f.wild ? 1.6 : .6); if (p > fire) { fire = p; fx = f.x; fz = f.z; } }
  amb.fire.g.gain.setTargetAtTime(Math.min(.2, fire * .12), t, .3);
  if (fire > .05 && (amb.crackT -= dt) <= 0) { amb.crackT = .05 + Math.random() * .25; sfx('kindle', fx, fz, null, .2 * Math.min(1, fire)); }
  // living things, picked from what's actually around the camera
  if (!night && G.season !== 3 && !G.storm && (amb.birdT -= dt) <= 0) {
    amb.birdT = 1 + Math.random() * 4 / (1 + Z);
    chirp(G.cam.x + (Math.random() - .5) * 600 / Z, G.cam.z + (Math.random() - .5) * 400 / Z);
  }
  if (night && G.season !== 3 && (amb.crickT -= dt) <= 0) { amb.crickT = .25 + Math.random() * .6; cricket(); }
  if (night && (amb.howlT -= dt) <= 0) {
    amb.howlT = 25 + Math.random() * 50;
    let best = null, bd = 1e9;
    for (const v of G.animals.values()) if (v.net.k === 'wolf') { const d = Math.hypot(v.x - G.cam.x, v.z - G.cam.z); if (d < bd) { bd = d; best = v; } }
    if (best && bd < 1400) howl(best.x, best.z);
  }
}
