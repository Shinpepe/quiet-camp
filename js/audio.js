import * as THREE from 'three';
import { ctx, settings } from './state.js';
import { rnd } from './util.js';

let AC = null, master, comp, worldLP, worldGain, sfxBus;
let whiteBuf = null, brownBuf = null;
let bed = null, evTimer = null, sceneKey = null;
let fire = null, water = null, lamps = null, spark = null;
const _f = new THREE.Vector3(), _u = new THREE.Vector3();

export function initAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  whiteBuf = brownBuf = null;
  master = AC.createGain(); master.gain.value = settings.vol; master.connect(AC.destination);
  comp = AC.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25; comp.connect(master);
  worldLP = AC.createBiquadFilter(); worldLP.type = 'lowpass'; worldLP.frequency.value = 20000;
  worldGain = AC.createGain(); worldGain.gain.value = 1; worldLP.connect(worldGain); worldGain.connect(comp);
  sfxBus = AC.createGain(); sfxBus.gain.value = 1; sfxBus.connect(comp);
}
export function resumeAudio() { if (AC && AC.state === 'suspended') AC.resume(); }
export function setVolume(v) { if (master) master.gain.value = v; }
export function setIndoor(on) { if (!AC) return; const t = AC.currentTime; worldLP.frequency.setTargetAtTime(on ? 1100 : 20000, t, 0.15); worldGain.gain.setTargetAtTime(on ? 0.55 : 1, t, 0.15); }

/* ── 재료 ── */
function noiseBuf(brown) {
  if (brown && brownBuf) return brownBuf; if (!brown && whiteBuf) return whiteBuf;
  const len = AC.sampleRate * 3, b = AC.createBuffer(1, len, AC.sampleRate), d = b.getChannelData(0); let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  if (brown) brownBuf = b; else whiteBuf = b; return b;
}
const off = () => Math.random() * 2.4;
const noise = (brown, loop) => { const s = AC.createBufferSource(); s.buffer = noiseBuf(brown); s.loop = !!loop; return s; };
const filt = (type, f, q) => { const n = AC.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q !== undefined) n.Q.value = q; return n; };
const gain = v => { const g = AC.createGain(); g.gain.value = v; return g; };
const osc = (type, f) => { const o = AC.createOscillator(); o.type = type || 'sine'; o.frequency.value = f; return o; };
const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[0]; };
const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
const lfo = (hz, depth, target) => { const o = osc('sine', hz), g = gain(depth); o.connect(g); g.connect(target); o.start(); return [o, g]; };
const spanner = (v) => { const p = AC.createStereoPanner(); p.pan.value = v === undefined ? rnd(-0.8, 0.8) : v; p.connect(worldLP); return p; };
function setPos(n, x, y, z) { if (n.positionX) { n.positionX.value = x; n.positionY.value = y; n.positionZ.value = z; } else n.setPosition(x, y, z); }
function panner(x, y, z, ref, max, roll) { const p = AC.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = roll; setPos(p, x, y, z); p.connect(worldLP); return p; }
function kill(nodes) { nodes.forEach(n => { try { n.stop && n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} }); }
function burst(dest, brown, type, f0, q, a, peak, d, t, f1, sweepT) {
  const s = noise(brown), f = filt(type, f0, q), g = gain(0); if (f1 !== undefined) { f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + (sweepT || d)); }
  env(g, t, a, peak, d); chain(s, f, g, dest); s.start(t, off()); s.stop(t + a + d + 0.05); return s;
}
function tone(dest, f0, f1, a, peak, d, t, type) { const o = osc(type || 'sine', f0), g = gain(0); if (f1) { o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + a + d); } env(g, t, a, peak, d); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + d + 0.05); return o; }

/* ── 위치 음원 ── */
function makeFireSrc() {
  const pan = panner(0.3, 0.6, -1.4, 1.6, 45, 1.1), g = gain(0); g.connect(pan);
  const rum = noise(true, true), rl = filt('lowpass', 180), rg = gain(0.55); chain(rum, rl, rg, g); rum.start(0, off());
  const hs = noise(false, true), hf = filt('bandpass', 900, 0.7), hg = gain(0.04); chain(hs, hf, hg, g); hs.start(0, off());
  const [lo, lg] = lfo(0.6, 0.025, hg.gain);
  const src = { pan, gain: g, nodes: [rum, rl, rg, hs, hf, hg, lo, lg, g, pan], popT: null };
  const pop = big => {
    const t = AC.currentTime;
    if (big) {
      burst(g, false, 'lowpass', rnd(350, 650), 1, 0.003, rnd(0.22, 0.34), 0.13, t);
      const n = 2 + Math.floor(Math.random() * 2); for (let i = 0; i < n; i++) burst(g, false, 'highpass', rnd(2500, 4500), 1, 0.002, rnd(0.03, 0.06), 0.03, t + 0.03 + Math.random() * 0.12);
    } else burst(g, false, 'bandpass', rnd(1400, 3600), 1.8, 0.003, rnd(0.06, 0.13), 0.045, t);
  };
  const loop = () => { if (!fire) return; if (ctx.W.fireLit) pop(Math.random() < 0.09); src.popT = setTimeout(loop, rnd(50, 360)); }; loop();
  fire = src;
}
function makeWaterSrc(type, z) {
  const pan = panner(0, 0, z, 5, 160, 0.9), nodes = [pan];
  if (type === 'waves') {
    const s = noise(true, true), f = filt('lowpass', 700), g = gain(0.5); chain(s, f, g, pan); s.start(0, off()); nodes.push(s, f, g, ...lfo(0.085, 0.3, g.gain));
    const w = noise(false, true), wf = filt('bandpass', 1800, 0.5), wg = gain(0.05); chain(w, wf, wg, pan); w.start(0, off()); nodes.push(w, wf, wg, ...lfo(0.07, 0.04, wg.gain));
  } else {
    const s = noise(true, true), f = filt('lowpass', 450), g = gain(0.13); chain(s, f, g, pan); s.start(0, off()); nodes.push(s, f, g, ...lfo(0.2, 0.06, g.gain));
    const w = noise(false, true), wf = filt('bandpass', 2500, 0.6), wg = gain(0.012); chain(w, wf, wg, pan); w.start(0, off()); nodes.push(w, wf, wg, ...lfo(0.3, 0.01, wg.gain));
  }
  water = { pan, z, nodes };
}
function makeHiss(x, y, z) {
  const pan = panner(x, y, z, 0.5, 8, 2.2), g = gain(0), s = noise(false, true), f = filt('highpass', 5000), ig = gain(0.012);
  chain(s, f, ig, g, pan); s.start(0, off()); return { gain: g, nodes: [s, f, ig, g, pan] };
}
function buildSpatial() {
  const cfg = ctx.W.cfg; killSpatial();
  makeFireSrc();
  if (cfg.water) makeWaterSrc(cfg.key === 'beach' ? 'waves' : 'lake', cfg.water.z - 3);
  lamps = { lantern: makeHiss(0.65, 0.75, 0.5), tentLamp: makeHiss(-2.35, 0.4, 2.1) };
  sceneKey = cfg.key;
}
function killSpatial() {
  if (fire) { clearTimeout(fire.popT); kill(fire.nodes); } if (water) kill(water.nodes); if (lamps) { kill(lamps.lantern.nodes); kill(lamps.tentLamp.nodes); }
  fire = water = lamps = null; sceneKey = null;
}

/* ── 불꽃놀이 스틱: 치익거리는 고음 노이즈 + 잦은 미세 탁탁. 손에 든 것이라 효과음 버스로 ── */
export function setSparkler(on) {
  if (!AC) return;
  if (on && !spark) {
    const g = gain(0), s = noise(false, true), f = filt('highpass', 4200), ig = gain(0.055); chain(s, f, ig, g, sfxBus); s.start(0, off());
    g.gain.setTargetAtTime(1, AC.currentTime, 0.1);
    const st = { gain: g, nodes: [s, f, ig, g], t: null };
    const crack = () => { if (!spark) return; burst(g, false, 'bandpass', rnd(5000, 9000), 2, 0.002, rnd(0.03, 0.08), 0.02, AC.currentTime); st.t = setTimeout(crack, rnd(15, 70)); }; crack();
    spark = st;
  } else if (!on && spark) {
    const st = spark; spark = null; clearTimeout(st.t);
    st.gain.gain.setTargetAtTime(0, AC.currentTime, 0.25); setTimeout(() => kill(st.nodes), 900);
  }
}

/* 치익 소리 크기 (손에 들면 1, 땅에 꽂고 멀어질수록 작게) */
export function sparklerLevel(v) { if (spark) spark.gain.gain.setTargetAtTime(v, AC.currentTime, 0.1); }

/* ── 배경 베드 ── */
function makeBed(type, timeKey) {
  const out = gain(0.0001), nodes = [out], timers = []; out.connect(worldLP);
  const wind = (f, g0, l1, l2) => { const s = noise(true, true), f1 = filt('lowpass', f), g = gain(g0); chain(s, f1, g, out); s.start(0, off()); nodes.push(s, f1, g, ...lfo(0.045, l1, f1.frequency), ...lfo(0.11, l2, g.gain)); };
  if (type === 'wind') wind(420, 0.28, 260, 0.12);
  else if (type === 'waves') wind(300, 0.06, 80, 0.02);
  else {
    wind(360, 0.05, 100, 0.02);
    if (timeKey === 'night') {
      [[4300, 18, -0.55, 0.011], [3900, 23, 0.6, 0.008]].forEach(([f, am, pn, g0]) => {
        const o = osc('sine', f), amg = gain(0), eg = gain(0), p = AC.createStereoPanner(); p.pan.value = pn;
        const [a, ag] = lfo(am, g0, amg.gain); chain(o, amg, eg, p, out); o.start(); nodes.push(o, amg, eg, p, a, ag);
        const alive = { on: true }; nodes.push({ stop() { alive.on = false; }, disconnect() {} });
        const trill = () => { if (!alive.on) return; const t = AC.currentTime, dur = rnd(0.5, 2.2); eg.gain.setTargetAtTime(1, t, 0.05); eg.gain.setTargetAtTime(0, t + dur, 0.08); timers.push(setTimeout(trill, (dur + rnd(1.2, 5)) * 1000)); };
        timers.push(setTimeout(trill, rnd(300, 3000)));
      });
    } else { const s = noise(true, true), f = filt('lowpass', 900), g = gain(0.03); chain(s, f, g, out); s.start(0, off()); nodes.push(s, f, g, ...lfo(0.17, 0.015, g.gain)); }
  }
  return { out, nodes, timers };
}
const killBed = b => { if (!b) return; b.timers.forEach(clearTimeout); kill(b.nodes); };
export function stopAmbience() { clearTimeout(evTimer); killBed(bed); bed = null; killSpatial(); setSparkler(false); }
export function startAmbience(type, timeKey) {
  if (!AC) return;
  if (sceneKey !== ctx.W.cfg.key) buildSpatial();
  const old = bed, t = AC.currentTime;
  bed = makeBed(type, timeKey); bed.out.gain.setValueAtTime(0.0001, t); bed.out.gain.exponentialRampToValueAtTime(1, t + 4);
  if (old) { old.out.gain.cancelScheduledValues(t); old.out.gain.setValueAtTime(Math.max(0.0001, old.out.gain.value), t); old.out.gain.exponentialRampToValueAtTime(0.0001, t + 4); setTimeout(() => killBed(old), 4600); }
  startEvents(type, timeKey);
}

/* ── 간헐 이벤트 ── */
function startEvents(type, timeKey) {
  clearTimeout(evTimer);
  const loop = () => { playEvent(type, timeKey); evTimer = setTimeout(loop, rnd(7000, 24000)); };
  evTimer = setTimeout(loop, rnd(3000, 9000));
}
function playEvent(type, timeKey) {
  if (!AC || ctx.paused) return; const r = Math.random(), night = timeKey === 'night';
  if (type === 'waves') { if (!night && r < 0.55) gull(); else if (r < 0.8) gust(0.5); else swell(); }
  else if (type === 'forest') {
    if (!night) { if (r < 0.6) chirp(); else if (r < 0.75) woodpecker(); else gust(0.35); }
    else { if (r < 0.45) owl(); else if (r < 0.6) loon(); else if (r < 0.85) gust(0.3); else creak(); }
  } else { if (r < 0.6) gust(1.0); else if (r < 0.85) snowSlide(); else creak(); }
}
function gull() {
  const n = 2 + Math.floor(Math.random() * 3), t0 = AC.currentTime, pan = spanner(), base = rnd(1100, 1500);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * rnd(0.35, 0.55), o = osc('sawtooth', base), f = filt('bandpass', base, 6), g = gain(0);
    o.frequency.setValueAtTime(base * 1.15, t); o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.32);
    const v = osc('sine', 28), vg = gain(40); v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 0.4);
    env(g, t, 0.04, 0.035, 0.3); chain(o, f, g, pan); o.start(t); o.stop(t + 0.4);
  }
}
function chirp() {
  const n = 3 + Math.floor(Math.random() * 3), t0 = AC.currentTime, pan = spanner(), base = rnd(2200, 3600);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * rnd(0.12, 0.2), f0 = base * rnd(0.9, 1.4), o = osc('sine', f0), g = gain(0);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.35, t + 0.05); o.frequency.exponentialRampToValueAtTime(f0 * 0.95, t + 0.1);
    env(g, t, 0.015, 0.03, 0.1); o.connect(g); g.connect(pan); o.start(t); o.stop(t + 0.14);
  }
}
function woodpecker() { const n = 7 + Math.floor(Math.random() * 4), t0 = AC.currentTime, pan = spanner(); for (let i = 0; i < n; i++) burst(pan, false, 'lowpass', 1200, 1, 0.003, 0.05, 0.02, t0 + i * 0.07); }
function owl() { const t0 = AC.currentTime, pan = spanner(); [0, 0.55].forEach((d, i) => { const t = t0 + d, o = osc('sine', 390), f = filt('lowpass', 800), g = gain(0); o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(340, t + 0.4); env(g, t, 0.08, i ? 0.05 : 0.06, 0.4); chain(o, f, g, pan); o.start(t); o.stop(t + 0.55); }); }
function loon() { const t = AC.currentTime, pan = spanner(), o = osc('sine', 620), g = gain(0); o.frequency.setValueAtTime(620, t); o.frequency.exponentialRampToValueAtTime(980, t + 0.6); o.frequency.exponentialRampToValueAtTime(600, t + 1.5); const v = osc('sine', 5), vg = gain(15); v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 1.7); env(g, t, 0.3, 0.028, 1.2); o.connect(g); g.connect(pan); o.start(t); o.stop(t + 1.7); }
function gust(k) { const t = AC.currentTime, pan = spanner(), s = noise(true), f = filt('bandpass', 250, 0.8), g = gain(0); f.frequency.setValueAtTime(250, t); f.frequency.linearRampToValueAtTime(900, t + 1.6); f.frequency.linearRampToValueAtTime(300, t + 3.6); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22 * k, t + 1.5); g.gain.linearRampToValueAtTime(0, t + 3.8); chain(s, f, g, pan); s.start(t, off()); s.stop(t + 4); }
function swell() { const t = AC.currentTime, pan = spanner(), s = noise(true), f = filt('lowpass', 500), g = gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 2); g.gain.linearRampToValueAtTime(0, t + 5); chain(s, f, g, pan); s.start(t, off()); s.stop(t + 5.2); }
function snowSlide() { const t = AC.currentTime, pan = spanner(); burst(pan, false, 'lowpass', 900, 1, 0.15, 0.12, 0.6, t, 300, 0.7); }
function creak() { const t = AC.currentTime, pan = spanner(); burst(pan, false, 'lowpass', 350, 1, 0.05, 0.05, 0.25, t); tone(pan, 95, 70, 0.05, 0.03, 0.25, t); }

/* ── 매 프레임 ── */
export function updateAudio(dt) {
  if (!AC || !ctx.camera) return; const cam = ctx.camera, L = AC.listener, W = ctx.W;
  cam.getWorldDirection(_f); _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
  if (L.positionX) { L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z; L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z; L.upX.value = _u.x; L.upY.value = _u.y; L.upZ.value = _u.z; }
  else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
  const k = Math.min(1, dt * 2.5);
  if (fire) fire.gain.gain.value += ((W.fireLit ? 1 : 0) - fire.gain.gain.value) * k;
  if (water) setPos(water.pan, cam.position.x, 0, water.z);
  if (lamps) { lamps.lantern.gain.gain.value += ((W.lanternLit ? 1 : 0) - lamps.lantern.gain.gain.value) * k; lamps.tentLamp.gain.gain.value += ((W.tentLampLit ? 1 : 0) - lamps.tentLamp.gain.gain.value) * k; }
}

/* ── 발소리 ── */
let stepIdx = 0;
function footstep(surface) {
  const t0 = AC.currentTime, side = (stepIdx++ % 2) ? 0.12 : -0.12, v = rnd(0.85, 1.15);
  const pan = AC.createStereoPanner(); pan.pan.value = side; pan.connect(sfxBus);
  const grains = (n, span, brown, type, f0, q, peak, d, t, f1) => { for (let i = 0; i < n; i++) { const k = rnd(0.45, 1); burst(pan, brown, type, f0 * rnd(0.8, 1.25), q, 0.002, peak * k * v, d * rnd(0.7, 1.3), t + Math.random() * span, f1 ? f1 * rnd(0.8, 1.2) : undefined, d); } };
  if (surface === 'snow') {
    tone(pan, 65, 45, 0.004, 0.11 * v, 0.08, t0);
    burst(pan, true, 'lowpass', 220, 1, 0.005, 0.06 * v, 0.15, t0);
    grains(14, 0.12, false, 'highpass', 2400, 1, 0.045, 0.02, t0);
    burst(pan, false, 'bandpass', 3000, 8, 0.02, 0.02 * v, 0.13, t0 + 0.02, 2200);
    grains(8, 0.08, false, 'highpass', 2800, 1, 0.03, 0.018, t0 + 0.11);
  } else if (surface === 'wood') {
    tone(pan, 110, 75, 0.004, 0.16 * v, 0.16, t0);
    burst(pan, false, 'bandpass', 240, 6, 0.003, 0.08 * v, 0.12, t0);
    tone(pan, 330, 300, 0.004, 0.03 * v, 0.1, t0);
    burst(pan, false, 'lowpass', 1200, 1, 0.002, 0.05 * v, 0.03, t0);
    tone(pan, 95, 70, 0.004, 0.06 * v, 0.1, t0 + 0.09);
    if (Math.random() < 0.25) { const o = tone(pan, 190, 150, 0.05, 0.02 * v, 0.25, t0 + 0.04); const w = osc('sine', 11), wg = gain(9); w.connect(wg); wg.connect(o.frequency); w.start(t0); w.stop(t0 + 0.4); }
  } else if (surface === 'wet') {
    burst(pan, false, 'bandpass', 2800, 0.8, 0.008, 0.07 * v, 0.14, t0, 1400, 0.14);
    burst(pan, true, 'lowpass', 350, 1, 0.006, 0.06 * v, 0.1, t0);
    grains(5, 0.25, false, 'bandpass', 4200, 2, 0.02, 0.03, t0 + 0.05);
    burst(pan, false, 'bandpass', 500, 3, 0.03, 0.03 * v, 0.12, t0 + 0.12, 900, 0.12);
  } else if (surface === 'sand') {
    tone(pan, 60, 42, 0.008, 0.06 * v, 0.1, t0);
    burst(pan, true, 'lowpass', 420, 1, 0.012, 0.09 * v, 0.24, t0, 220, 0.24);
    grains(16, 0.2, false, 'bandpass', 2600, 1.2, 0.028, 0.035, t0);
    grains(6, 0.1, false, 'bandpass', 3400, 1.5, 0.018, 0.03, t0 + 0.14);
  } else {
    tone(pan, 75, 50, 0.004, 0.08 * v, 0.07, t0);
    burst(pan, true, 'lowpass', 600, 1, 0.005, 0.06 * v, 0.09, t0);
    burst(pan, false, 'bandpass', 900, 1.0, 0.006, 0.05 * v, 0.07, t0);
    grains(10, 0.14, false, 'bandpass', 3600, 1.2, 0.03, 0.03, t0);
    burst(pan, true, 'lowpass', 700, 1, 0.005, 0.04 * v, 0.07, t0 + 0.1);
    grains(4, 0.06, false, 'bandpass', 3000, 1.2, 0.02, 0.025, t0 + 0.11);
  }
}

/* ── 효과음 ── */
export function sfx(type, surface) {
  if (!AC) return; const t = AC.currentTime, B = sfxBus;
  switch (type) {
    case 'step': footstep(surface); return;
    case 'trunkOpen': burst(B, false, 'highpass', 4000, 1, 0.002, 0.12, 0.03, t); burst(B, true, 'lowpass', 300, 1, 0.05, 0.05, 0.3, t + 0.04, 900, 0.35); return;
    case 'trunkClose': tone(B, 95, 60, 0.004, 0.25, 0.22, t); burst(B, false, 'lowpass', 500, 1, 0.003, 0.18, 0.12, t); burst(B, false, 'bandpass', 2500, 2, 0.003, 0.03, 0.06, t + 0.02); return;
    case 'doorOpen': burst(B, false, 'highpass', 3500, 1, 0.002, 0.1, 0.04, t); { const o = tone(B, 220, 170, 0.06, 0.02, 0.25, t + 0.05); const v = osc('sine', 9), vg = gain(12); v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 0.4); } burst(B, true, 'lowpass', 700, 1, 0.08, 0.02, 0.3, t + 0.05, 1400, 0.3); return;
    case 'doorClose': tone(B, 70, 45, 0.004, 0.32, 0.28, t); burst(B, false, 'lowpass', 400, 1, 0.003, 0.22, 0.15, t); burst(B, false, 'highpass', 3000, 1, 0.002, 0.08, 0.04, t + 0.03); burst(B, false, 'bandpass', 180, 4, 0.01, 0.06, 0.35, t); return;
    case 'sip': burst(B, false, 'bandpass', 700, 1.2, 0.06, 0.05, 0.25, t, 1900, 0.25); return;
    case 'gulp': tone(B, 110, 70, 0.01, 0.08, 0.14, t); burst(B, false, 'lowpass', 500, 1, 0.01, 0.03, 0.1, t); return;
    case 'clink': [2400, 3150].forEach((fq, i) => tone(B, fq, 0, 0.003, 0.08 - i * 0.03, 0.35, t)); return;
    case 'inhale': burst(B, false, 'highpass', 1200, 1, 0.35, 0.04, 0.25, t, 2500, 0.6); return;
    case 'exhale': burst(B, false, 'bandpass', 900, 0.6, 0.05, 0.04, 0.7, t, 450, 0.7); return;
    case 'lighter': burst(B, false, 'highpass', 3000, 1, 0.003, 0.12, 0.14, t); return;
    case 'sit': burst(B, false, 'highpass', 1500, 1, 0.03, 0.035, 0.18, t); return;
    case 'sparkOn': burst(B, false, 'highpass', 5000, 1, 0.01, 0.22, 0.45, t); for (let i = 0; i < 8; i++) burst(B, false, 'bandpass', rnd(5000, 9000), 2, 0.002, rnd(0.06, 0.12), 0.02, t + Math.random() * 0.3); return;   // 점화: 치직!
    case 'sparkOff': burst(B, false, 'highpass', 4500, 1, 0.02, 0.05, 0.5, t, 2500, 0.5); return;   // 꺼짐: 잦아드는 치익
  }
}
