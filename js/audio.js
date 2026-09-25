import { ctx, settings } from './state.js';
import { rnd } from './util.js';

let AC = null, master, ambNodes = [], chirpTimer = null, crackleTimer = null;
let whiteBuf = null, brownBuf = null;

export function initAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  whiteBuf = brownBuf = null;
  master = AC.createGain(); master.gain.value = settings.vol; master.connect(AC.destination);
}
export function resumeAudio() { if (AC && AC.state === 'suspended') AC.resume(); }
export function setVolume(v) { if (master) master.gain.value = v; }

/* 노이즈 버퍼는 종류별로 한 번만 만들고 재사용한다. 재생 시작 오프셋을 랜덤으로 줘서 매번 다른 구간이 들린다. */
function noiseBuf(brown) {
  if (brown && brownBuf) return brownBuf;
  if (!brown && whiteBuf) return whiteBuf;
  const len = AC.sampleRate * 3, b = AC.createBuffer(1, len, AC.sampleRate), d = b.getChannelData(0); let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  if (brown) brownBuf = b; else whiteBuf = b;
  return b;
}
const off = () => Math.random() * 2.4;

export function stopAmbience() { ambNodes.forEach(n => { try { n.stop && n.stop(); n.disconnect(); } catch (e) {} }); ambNodes = []; clearTimeout(chirpTimer); clearTimeout(crackleTimer); }
export function startAmbience(type, timeKey) {
  if (!AC) return; stopAmbience();
  const src = AC.createBufferSource(); src.buffer = noiseBuf(true); src.loop = true;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; const g = AC.createGain(); src.connect(f); f.connect(g); g.connect(master);
  const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.connect(lg);
  if (type === 'waves') { f.frequency.value = 700; g.gain.value = 0.32; lfo.frequency.value = 0.085; lg.gain.value = 0.2; lg.connect(g.gain); }
  else if (type === 'wind') { f.frequency.value = 420; g.gain.value = 0.28; lfo.frequency.value = 0.045; lg.gain.value = 260; lg.connect(f.frequency); const l2 = AC.createOscillator(), g2 = AC.createGain(); l2.frequency.value = 0.11; g2.gain.value = 0.12; l2.connect(g2); g2.connect(g.gain); l2.start(); ambNodes.push(l2); }
  else { f.frequency.value = 900; g.gain.value = 0.07; lfo.frequency.value = 0.07; lg.gain.value = 0.03; lg.connect(g.gain); }
  src.start(0, off()); lfo.start(); ambNodes.push(src, lfo, f, g, lg);
  if (type === 'forest') {
    if (timeKey === 'night') { const o = AC.createOscillator(), og = AC.createGain(), pl = AC.createOscillator(), pg = AC.createGain(); o.frequency.value = 4300; og.gain.value = 0.012; pl.frequency.value = 18; pg.gain.value = 0.012; pl.connect(pg); pg.connect(og.gain); o.connect(og); og.connect(master); o.start(); pl.start(); ambNodes.push(o, pl, og, pg); }
    else { const loop = () => { chirp(); chirpTimer = setTimeout(loop, rnd(1800, 6000)); }; chirpTimer = setTimeout(loop, 1500); }
  }
  if (ctx.W.fireLit) startCrackle();
}
export function startCrackle() { if (!AC) return; clearTimeout(crackleTimer); const loop = () => { if (!ctx.W.fireLit) return; pop(); crackleTimer = setTimeout(loop, rnd(60, 420)); }; loop(); }
function pop() { const t = AC.currentTime, s = AC.createBufferSource(); s.buffer = noiseBuf(false); const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rnd(1200, 3200); f.Q.value = 1.5; const g = AC.createGain(); g.gain.setValueAtTime(rnd(0.015, 0.05), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); s.connect(f); f.connect(g); g.connect(master); s.start(t, off()); s.stop(t + 0.08); }
function chirp() { if (!AC) return; const n = 2 + Math.floor(Math.random() * 3), t0 = AC.currentTime, base = rnd(2200, 3400); for (let i = 0; i < n; i++) { const o = AC.createOscillator(), g = AC.createGain(), t = t0 + i * 0.16; o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * 1.4, t + 0.08); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.15); } }
export function sfx(type) {
  if (!AC) return; const t = AC.currentTime;
  if (type === 'clink') { [2400, 3150].forEach((fq, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = fq; g.gain.setValueAtTime(0.08 - i * 0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4); }); return; }
  const s = AC.createBufferSource(); s.buffer = noiseBuf(false); const f = AC.createBiquadFilter(), g = AC.createGain();
  const cfgs = { step: ['lowpass', ctx.W.cfg.snow ? 900 : 500, 0.05, 0.12], sip: ['bandpass', 1100, 0.06, 0.32], lighter: ['highpass', 3000, 0.12, 0.14], trunk: ['lowpass', 300, 0.15, 0.3], sit: ['lowpass', 400, 0.06, 0.25] }[type];
  f.type = cfgs[0]; f.frequency.value = cfgs[1]; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(cfgs[2], t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + cfgs[3]);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, off()); s.stop(t + 0.5);
}
