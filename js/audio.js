import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { BG } from './data.js';
import { rnd } from './util.js';

/* ── 방향: 힐링 캠핑. 모든 소리는 멀리·부드럽게·드물게. 날카로운 고역 없음, 긴 어택, 밤엔 더 뜸하게.
   버스: world(환경·위치음, 실내 필터) / sfx(손·몸 근처) / ui(메뉴·셔터, 컴프레서 우회)
   공간 잔향: world 와 sfx 가 같은 절차적 임펄스 응답을 공유한다 (텐트·차·숲·해변·설원) ── */

let AC = null, master, comp, worldLP, worldGain, sfxBus, uiBus, verb = null;
const bufs = {}, irCache = {};
let bed = null, evTimer = null, sceneKey = null, menuMode = false, indoor = false;
let fire = null, water = null, lamps = null, spark = null, engine = null, engineDone = false;
let windAcc = 0, lastWind = 0, lastGust = -99;
const flockAudio = new Map();
const _f = new THREE.Vector3(), _u = new THREE.Vector3();
const isNight = c => c < 0.22 || c > 0.8;
const sched = (list, fn, ms) => { const id = setTimeout(fn, ms); list.push(id); return id; };
const killT = list => { list.forEach(clearTimeout); list.length = 0; };

export function initAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  for (const k in bufs) delete bufs[k]; for (const k in irCache) delete irCache[k];
  master = gainN(settings.vol); master.connect(AC.destination);
  comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 2.5; comp.attack.value = 0.015; comp.release.value = 0.3; comp.connect(master);
  worldLP = filt('lowpass', 20000); worldGain = gainN(1); worldLP.connect(worldGain); worldGain.connect(comp);
  sfxBus = gainN(1); sfxBus.connect(comp);
  uiBus = gainN(0.8); uiBus.connect(master);
  /* 잔향 입력: world 전부 + sfx 는 조금 덜 (손 근처 소리는 직접음이 더 커야 한다) */
  const vin = gainN(1), sfxSend = gainN(0.7); worldGain.connect(vin); sfxBus.connect(sfxSend); sfxSend.connect(vin);
  verb = { in: vin, slot: null, key: null };
}
export function resumeAudio() { if (AC && AC.state === 'suspended') AC.resume(); }
export function setVolume(v) { if (master) master.gain.setTargetAtTime(v, AC.currentTime, 0.03); }

/* ── 공간 잔향: 감쇠하는 저역통과 노이즈로 임펄스 응답을 만든다. 설원은 먼 산에서 되돌아오는 메아리 두 번 ──
   dur: 길이(초), decay: 감쇠 곡선 지수(클수록 빨리 죽음), lp: 잔향 음색(Hz), wet: 잔향 크기 */
const SPACE = {
  tent:   { dur: 0.35, decay: 4,   lp: 2500, wet: 0.45 },
  car:    { dur: 0.25, decay: 5,   lp: 1800, wet: 0.5 },
  forest: { dur: 1.8,  decay: 3,   lp: 5000, wet: 0.12 },
  beach:  { dur: 1.2,  decay: 3.5, lp: 4000, wet: 0.06 },
  snow:   { dur: 2.5,  decay: 2,   lp: 3000, wet: 0.08, echo: [[0.32, 0.35], [0.74, 0.2]] },
};
const OUTDOOR = { lake: 'forest', beach: 'beach', snow: 'snow' };
function makeIR(sp) {
  const sr = AC.sampleRate, len = Math.floor(sr * sp.dur), b = AC.createBuffer(2, len, sr), k = Math.exp(-2 * Math.PI * sp.lp / sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) { lp = lp * k + (Math.random() * 2 - 1) * (1 - k); d[i] = lp * Math.pow(1 - i / len, sp.decay); }
    /* 메아리: 좌우를 3% 어긋나게 두어 넓게 퍼지게 */
    if (sp.echo) sp.echo.forEach(([at, g]) => {
      const i0 = Math.floor(at * sr * (ch ? 1.03 : 1)), n = Math.floor(0.03 * sr); let e = 0;
      for (let i = 0; i < n && i0 + i < len; i++) { e = e * k + (Math.random() * 2 - 1) * (1 - k); d[i0 + i] += e * g * 2 * (1 - i / n); }
    });
  }
  return b;
}
/* 공간이 바뀌면 새 컨볼버를 만들어 크로스페이드하고, 이전 것은 잔향 꼬리가 끝난 뒤 정리한다 */
function setSpace(key) {
  if (!verb || !key || verb.key === key) return;
  const sp = SPACE[key], t = AC.currentTime, old = verb.slot, oldDur = verb.key ? SPACE[verb.key].dur : 0; verb.key = key;
  const c = AC.createConvolver(); c.buffer = irCache[key] || (irCache[key] = makeIR(sp));
  const w = gainN(0); verb.in.connect(c); c.connect(w); w.connect(comp); w.gain.setTargetAtTime(sp.wet, t, 0.15);
  verb.slot = { c, w };
  if (old) { old.w.gain.cancelScheduledValues(t); old.w.gain.setTargetAtTime(0, t, 0.15); setTimeout(() => kill([old.c, old.w]), (oldDur + 1.5) * 1000); }
}
function applyWorld() {
  if (!AC) return; const t = AC.currentTime;
  worldGain.gain.setTargetAtTime((menuMode ? 0.35 : 1) * (indoor ? 0.5 : 1), t, 0.2);
  worldLP.frequency.setTargetAtTime(indoor ? 1300 : 20000, t, 0.15);
  const out = ctx.W.cfg ? OUTDOOR[ctx.W.cfg.key] : 'forest';
  setSpace(indoor ? (state.seat === 'car' ? 'car' : 'tent') : out || 'forest');
}
export function setIndoor(on) { indoor = !!on; applyWorld(); }

/* ── 재료: 노이즈 버퍼 세 종류 ──
   white: 날카로운 쉭 / pink: 자연음 대부분(잎·물거품·불) / brown: 먹먹한 바람·럼블
   예전 호출과 호환: true = brown, false·생략 = white */
const kindOf = k => k === true ? 'brown' : typeof k === 'string' ? k : 'white';
function noiseBuf(kind) {
  kind = kindOf(kind); if (bufs[kind]) return bufs[kind];
  const len = AC.sampleRate * 8, b = AC.createBuffer(1, len, AC.sampleRate), d = b.getChannelData(0);
  if (kind === 'white') for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  else if (kind === 'pink') {
    /* Paul Kellet 필터 */
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
  } else { let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } }
  if (kind !== 'white') { /* 루프 이음새 제거 + DC 제거 */ const drift = d[len - 1] - d[0]; let mean = 0; for (let i = 0; i < len; i++) { d[i] -= drift * i / len; mean += d[i]; } mean /= len; for (let i = 0; i < len; i++) d[i] -= mean; }
  if (kind === 'pink') { /* 화이트와 같은 RMS 로 맞춰 게인 감각을 유지 (2~4kHz 대역에서 거의 같은 크기) */ let s = 0; for (let i = 0; i < len; i++) s += d[i] * d[i]; const g = 0.577 / Math.sqrt(s / len); for (let i = 0; i < len; i++) d[i] *= g; }
  return bufs[kind] = b;
}
const off = () => Math.random() * 6;
const noise = (kind, loop) => { const s = AC.createBufferSource(); s.buffer = noiseBuf(kind); s.loop = !!loop; return s; };
const filt = (type, f, q) => { const n = AC.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q !== undefined) n.Q.value = q; return n; };
const gainN = v => { const g = AC.createGain(); g.gain.value = v; return g; };
const osc = (type, f) => { const o = AC.createOscillator(); o.type = type || 'sine'; o.frequency.value = f; return o; };
const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[0]; };
const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
const lfo = (hz, depth, target) => { const o = osc('sine', hz), g = gainN(depth); o.connect(g); g.connect(target); o.start(); return [o, g]; };
const spanner = v => { const p = AC.createStereoPanner(); p.pan.value = v === undefined ? rnd(-0.7, 0.7) : v; p.connect(worldLP); return p; };
function setPos(n, x, y, z) { if (n.positionX) { n.positionX.value = x; n.positionY.value = y; n.positionZ.value = z; } else n.setPosition(x, y, z); }
/* HRTF: 헤드폰에서 앞뒤·위아래까지 구분된다 */
function panner(x, y, z, ref, max, roll) { const p = AC.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = roll; setPos(p, x, y, z); p.connect(worldLP); return p; }
function kill(nodes) { nodes.forEach(n => { try { n.stop && n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} }); }
/* 먼 곳의 일회성 음원: 카메라 주변 dist 미터 랜덤 방향, 거리만큼 고역이 깎임. dur 뒤 자동 정리 */
function farSrc(dist, dur, y) {
  const a = rnd(0, 6.283), p = panner(ctx.camera.position.x + Math.cos(a) * dist, y === undefined ? 5 : y, ctx.camera.position.z + Math.sin(a) * dist, 10, 400, 1.0);
  const lp = filt('lowpass', Math.max(1600, 8000 - dist * 90)); lp.connect(p);
  setTimeout(() => kill([lp, p]), (dur + 1) * 1000); return lp;
}
function burst(dest, kind, type, f0, q, a, peak, d, t, f1, sweepT) {
  const s = noise(kind), f = filt(type, f0, q), g = gainN(0); if (f1 !== undefined) { f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + (sweepT || d)); }
  env(g, t, a, peak, d); chain(s, f, g, dest); s.start(t, off()); s.stop(t + a + d + 0.05); return s;
}
function tone(dest, f0, f1, a, peak, d, t, type) { const o = osc(type || 'sine', f0), g = gainN(0); if (f1) { o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + a + d); } env(g, t, a, peak, d); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + d + 0.05); return o; }

/* ── 위치 음원 ── */
function makeFireSrc() {
  const pan = panner(0.3, 0.6, -1.4, 1.6, 45, 1.1), g = gainN(0), t = []; g.connect(pan);
  const rum = noise('brown', true), rl = filt('lowpass', 160), rg = gainN(0.2); chain(rum, rl, rg, g); rum.start(0, off());
  const fl = noise('pink', true), ff = filt('bandpass', 420, 0.9), fg = gainN(0.012); chain(fl, ff, fg, g); fl.start(0, off());   // 불꽃 펄럭임
  const hs = noise('pink', true), hf = filt('bandpass', 1400, 0.6), hg = gainN(0.013); chain(hs, hf, hg, g); hs.start(0, off());  // 잔잔한 쉭
  const src = { pan, gain: g, t, nodes: [rum, rl, rg, fl, ff, fg, hs, hf, hg, ...lfo(4.3, 0.007, fg.gain), ...lfo(0.37, 0.004, fg.gain), ...lfo(0.6, 0.005, hg.gain), g, pan] };
  fire = src;
  /* 파칙: 소리를 내는 순간 화면에도 알린다 → main.js 가 불빛을 번쩍이고, 큰 파칙이면 불티를 솟게 한다 */
  const pop = big => {
    const now = AC.currentTime, W = ctx.W;
    W.firePop = Math.max(W.firePop || 0, big ? 1 : rnd(0.12, 0.3)); if (big) W.fireBurst = true;
    if (big) { burst(g, false, 'lowpass', rnd(320, 600), 1, 0.004, rnd(0.12, 0.2), 0.14, now); for (let i = 0; i < 2; i++) burst(g, false, 'highpass', rnd(2200, 3800), 1, 0.002, rnd(0.02, 0.04), 0.03, now + 0.04 + Math.random() * 0.12); }
    else burst(g, false, 'bandpass', rnd(1300, 3200), 1.6, 0.003, rnd(0.04, 0.09), 0.05, now);
  };
  const loop = () => { if (fire !== src) return; if (ctx.W.fireLit) pop(Math.random() < 0.08); sched(t, loop, rnd(90, 520)); }; loop();
}
/* 파도: 밀려오고(저역 상승) → 부서지고 → 빠지는(hiss 감쇠) 이벤트 두 줄이 엇갈려 반복. 호수: 잔잔한 찰랑임 */
function makeWaterSrc(type, z) {
  const pan = panner(0, 0, z, 6, 160, 0.9), t = [], nodes = [pan];
  const bs = noise('brown', true), bf = filt('lowpass', type === 'waves' ? 420 : 340), bg = gainN(type === 'waves' ? 0.12 : 0.08); chain(bs, bf, bg, pan); bs.start(0, off()); nodes.push(bs, bf, bg, ...lfo(0.07, type === 'waves' ? 0.05 : 0.03, bg.gain));
  const src = { pan, z, t, nodes }; water = src;
  if (type === 'waves') {
    const wave = () => {
      const now = AC.currentTime, d = rnd(1.8, 2.6);
      const s = noise('brown'), f = filt('lowpass', 220), g = gainN(0); chain(s, f, g, pan);
      f.frequency.setValueAtTime(220, now); f.frequency.exponentialRampToValueAtTime(1100, now + d); f.frequency.exponentialRampToValueAtTime(300, now + d + 3);
      g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(rnd(0.2, 0.3), now + d); g.gain.exponentialRampToValueAtTime(0.0001, now + d + 3.5);
      s.start(now, off()); s.stop(now + d + 3.6);
      const h = noise('pink'), hf = filt('bandpass', 2400, 0.5), hg = gainN(0); chain(h, hf, hg, pan);
      hg.gain.setValueAtTime(0.0001, now + d - 0.3); hg.gain.exponentialRampToValueAtTime(rnd(0.035, 0.055), now + d + 0.2); hg.gain.exponentialRampToValueAtTime(0.0001, now + d + 5);
      h.start(now + d - 0.3, off()); h.stop(now + d + 5.1);
    };
    const loopA = () => { if (water !== src) return; wave(); sched(t, loopA, rnd(6500, 11500)); };
    const loopB = () => { if (water !== src) return; wave(); sched(t, loopB, rnd(7000, 12000)); };
    loopA(); sched(t, loopB, 4200);
  } else {
    const lap = () => { if (water !== src) return; burst(pan, 'brown', 'lowpass', rnd(500, 900), 1, 0.08, rnd(0.03, 0.06), 0.5, AC.currentTime, rnd(250, 400), 0.5); sched(t, lap, rnd(1800, 5200)); }; lap();
  }
}
function makeHiss(x, y, z) {
  const pan = panner(x, y, z, 0.5, 8, 2.2), g = gainN(0), s = noise('white', true), f = filt('bandpass', 3000, 1.5), ig = gainN(0.006);
  chain(s, f, ig, g, pan); s.start(0, off()); return { gain: g, nodes: [s, f, ig, g, pan, ...lfo(8, 0.0015, ig.gain)] };
}
/* 방금 도착한 차: 2분 남짓 엔진이 식으며 틱틱 */
function startEngine() {
  if (engine || engineDone) return;
  const pan = panner(0, 0.5, 7.2, 1.5, 30, 1.2), t = [], t0 = AC.currentTime, src = { pan, t, nodes: [pan] }; engine = src;
  const tick = () => { if (engine !== src) return; const el = AC.currentTime - t0; if (el > 140) { killEngine(); engineDone = true; return; }
    const now = AC.currentTime; burst(pan, false, 'bandpass', rnd(1800, 3200), 4, 0.002, rnd(0.02, 0.04), 0.04, now); tone(pan, rnd(1400, 2200), 900, 0.002, 0.01, 0.05, now);
    sched(t, tick, rnd(900, 4000) * (1 + el / 50)); };
  sched(t, tick, rnd(1500, 3000));
}
function killEngine() { if (!engine) return; killT(engine.t); kill(engine.nodes); engine = null; }
function buildSpatial() {
  const cfg = ctx.W.cfg; killSpatial();
  makeFireSrc();
  if (cfg.water) makeWaterSrc(cfg.key === 'beach' ? 'waves' : 'lake', cfg.water.z - 3);
  lamps = { lantern: makeHiss(0.65, 0.75, 0.5), tentLamp: makeHiss(-2.35, 0.4, 2.1) };
  sceneKey = cfg.key; engineDone = false;
}
function killSpatial() {
  if (fire) { killT(fire.t); kill(fire.nodes); } if (water) { killT(water.t); kill(water.nodes); } if (lamps) { kill(lamps.lantern.nodes); kill(lamps.tentLamp.nodes); }
  killEngine(); flockAudio.forEach(a => { killT(a.t); kill(a.nodes); }); flockAudio.clear();
  fire = water = lamps = null; sceneKey = null;
}

/* ── 불꽃놀이 스틱: 부드러운 치익 + 잔 크랙 ── */
export function setSparkler(on) {
  if (!AC) return;
  if (on && !spark) {
    const g = gainN(0), s = noise('white', true), f = filt('bandpass', 5000, 0.8), ig = gainN(0.03); chain(s, f, ig, g, sfxBus); s.start(0, off());
    g.gain.setTargetAtTime(1, AC.currentTime, 0.1);
    const st = { gain: g, nodes: [s, f, ig, g], t: [] };
    const crack = () => { if (spark !== st) return; burst(g, false, 'bandpass', rnd(4500, 8000), 2, 0.002, rnd(0.02, 0.05), 0.02, AC.currentTime); sched(st.t, crack, rnd(20, 80)); }; crack();
    spark = st;
  } else if (!on && spark) {
    const st = spark; spark = null; killT(st.t);
    st.gain.gain.setTargetAtTime(0, AC.currentTime, 0.25); setTimeout(() => kill(st.nodes), 900);
  }
}
export function sparklerLevel(v) { if (spark) spark.gain.gain.setTargetAtTime(v, AC.currentTime, 0.1); }

/* ── 배경 베드 ── */
function cricketVoice(out, nodes, timers) {
  const f = rnd(3700, 4500), o = osc('sine', f), o2 = osc('sine', f * 2), g2 = gainN(0.2), gate = gainN(0), lp = filt('lowpass', 6500), p = AC.createStereoPanner(); p.pan.value = rnd(-0.9, 0.9);
  o.connect(gate); o2.connect(g2); g2.connect(gate); chain(gate, lp, p, out); o.start(); o2.start(); nodes.push(o, o2, g2, gate, lp, p);
  const vol = rnd(0.004, 0.008), per = rnd(0.55, 1.1), pulses = 3 + Math.floor(Math.random() * 3);
  const chirp = () => { const now = AC.currentTime; gate.gain.cancelScheduledValues(now); gate.gain.setValueAtTime(0, now);
    for (let i = 0; i < pulses; i++) { const tp = now + 0.02 + i * 0.045; gate.gain.setTargetAtTime(vol, tp, 0.005); gate.gain.setTargetAtTime(0, tp + 0.022, 0.008); }
    sched(timers, chirp, (Math.random() < 0.12 ? rnd(3, 8) : per * rnd(0.9, 1.1)) * 1000); };
  sched(timers, chirp, rnd(0, 1500));
}
/* 바람 베드의 크기·음색과 잎 스침은 updateAudio 가 W.wind 를 따라 움직인다 (예전의 고정 LFO 대신) */
function makeBed(type, timeKey) {
  const out = gainN(0.0001), nodes = [out], timers = []; out.connect(worldLP);
  const bed = { out, nodes, timers, type, timeKey, wind: null, leaves: null };
  const wind = (f, g0, l1) => { const s = noise('brown', true), f1 = filt('lowpass', f), g = gainN(g0); chain(s, f1, g, out); s.start(0, off()); const [a, ag] = lfo(0.045, l1, f1.frequency); nodes.push(s, f1, g, a, ag); return { g, f: f1, g0, f0: f }; };
  if (type === 'wind') bed.wind = wind(380, 0.16, 220);
  else if (type === 'waves') bed.wind = wind(280, 0.035, 60);
  else {
    bed.wind = wind(340, 0.045, 90);
    const lv = noise('pink', true), lf = filt('bandpass', 3000, 0.7), lg = gainN(0.006); chain(lv, lf, lg, out); lv.start(0, off()); nodes.push(lv, lf, lg); bed.leaves = lg.gain;
    if (timeKey === 'night') for (let i = 0; i < 5; i++) cricketVoice(out, nodes, timers);
    else { const s = noise('brown', true), f = filt('lowpass', 900), g = gainN(0.015); chain(s, f, g, out); s.start(0, off()); nodes.push(s, f, g, ...lfo(0.17, 0.008, g.gain)); }
  }
  return bed;
}
const killBed = b => { if (!b) return; killT(b.timers); kill(b.nodes); };
function startAmb(type, timeKey) {
  if (sceneKey !== ctx.W.cfg.key) buildSpatial();
  const old = bed, t = AC.currentTime;
  bed = makeBed(type, timeKey); bed.out.gain.setValueAtTime(0.0001, t); bed.out.gain.exponentialRampToValueAtTime(1, t + 5);
  if (old) { old.out.gain.cancelScheduledValues(t); old.out.gain.setValueAtTime(Math.max(0.0001, old.out.gain.value), t); old.out.gain.exponentialRampToValueAtTime(0.0001, t + 5); setTimeout(() => killBed(old), 5600); }
  if (old && old.timeKey === 'night' && timeKey === 'day' && type === 'forest') dawnChorus();
  startEvents(type, timeKey);
}
export function startAmbience(type, timeKey) { if (!AC) return; menuMode = false; applyWorld(); startAmb(type, timeKey); startEngine(); }
/* 메뉴 프리뷰용: 같은 베드를 작게 */
export function menuAmbience(bgKey) { if (!AC || !ctx.W.cfg) return; menuMode = true; indoor = false; applyWorld(); startAmb(BG[bgKey].ambience, isNight(state.clock) ? 'night' : 'day'); }
export function stopAmbience() { clearTimeout(evTimer); killBed(bed); bed = null; killSpatial(); setSparkler(false); }

/* ── 간헐 이벤트: 낮 9~26초, 밤 14~40초. 일부 확률은 일부러 비워 둔다(침묵도 소리).
   돌풍은 여기서 빠지고 바람 값(W.wind)이 솟을 때 updateAudio 가 낸다 ── */
function startEvents(type, timeKey) {
  clearTimeout(evTimer);
  const night = timeKey === 'night';
  const loop = () => { playEvent(type, timeKey); evTimer = setTimeout(loop, night ? rnd(14000, 40000) : rnd(9000, 26000)); };
  evTimer = setTimeout(loop, rnd(3000, 9000));
}
function playEvent(type, timeKey) {
  if (!AC || ctx.paused) return; const r = Math.random(), night = timeKey === 'night';
  if (state.seat === 'dock' && Math.random() < 0.4) ropeCreak();
  if (type === 'waves') { if (!night && r < 0.5) gull(); else if (night && r >= 0.8 && r < 0.92) foghorn(); }
  else if (type === 'forest') {
    if (!night) { if (r < 0.55) chirp(); else if (r < 0.68) woodpecker(); }
    else { if (r < 0.35) owl(); else if (r < 0.45) loon(); else if (r >= 0.75 && r < 0.85) creak(); }
  } else { if (r >= 0.55 && r < 0.75) snowSlide(); else if (r >= 0.75 && r < 0.85) creak(); }
}
function dawnChorus() { for (let i = 0; i < 10; i++) setTimeout(() => { if (bed && bed.timeKey === 'day') chirp(rnd(10, 40)); }, 1500 + i * rnd(1800, 3200)); }
function chirp(dist) {
  const n = 3 + Math.floor(Math.random() * 3), t0 = AC.currentTime, out = farSrc(dist || rnd(12, 45), n * 0.25 + 0.5, 6), base = rnd(2200, 3600);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * rnd(0.12, 0.22), f0 = base * rnd(0.9, 1.4);
    const o = osc('sine', f0), o2 = osc('sine', f0 * 2), g2 = gainN(0.18), g = gainN(0); o.connect(g); o2.connect(g2); g2.connect(g); g.connect(out);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.35, t + 0.05); o.frequency.exponentialRampToValueAtTime(f0 * 0.95, t + 0.11);
    o2.frequency.setValueAtTime(f0 * 2, t); o2.frequency.exponentialRampToValueAtTime(f0 * 2.7, t + 0.05); o2.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 0.11);
    env(g, t, 0.015, 0.05, 0.11); o.start(t); o2.start(t); o.stop(t + 0.15); o2.stop(t + 0.15);
    burst(out, false, 'bandpass', 4000, 1, 0.01, 0.006, 0.05, t);
  }
}
function gull() {
  const n = 2 + Math.floor(Math.random() * 3), t0 = AC.currentTime, out = farSrc(rnd(25, 70), n * 0.55 + 0.5, 12), base = rnd(1100, 1500);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * rnd(0.35, 0.55), o = osc('sawtooth', base), f = filt('bandpass', base, 6), g = gainN(0);
    o.frequency.setValueAtTime(base * 1.15, t); o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.32);
    const v = osc('sine', 28), vg = gainN(40); v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 0.4);
    env(g, t, 0.05, 0.05, 0.3); chain(o, f, g, out); o.start(t); o.stop(t + 0.4);
  }
}
function woodpecker() { const n = 7 + Math.floor(Math.random() * 4), t0 = AC.currentTime, out = farSrc(rnd(20, 50), 1, 5); for (let i = 0; i < n; i++) burst(out, false, 'lowpass', 1200, 1, 0.003, 0.05, 0.02, t0 + i * 0.07); }
function owl() { const t0 = AC.currentTime, out = farSrc(rnd(20, 60), 1.4, 6); [0, 0.55].forEach((d, i) => { const t = t0 + d, o = osc('sine', 400), o2 = osc('sine', 800), g2 = gainN(0.1), f = filt('lowpass', 800), g = gainN(0); o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(340, t + 0.4); o2.frequency.setValueAtTime(800, t); o2.frequency.exponentialRampToValueAtTime(680, t + 0.4); o.connect(g); o2.connect(g2); g2.connect(g); env(g, t, 0.1, i ? 0.06 : 0.07, 0.4); chain(g, f, out); o.start(t); o2.start(t); o.stop(t + 0.55); o2.stop(t + 0.55); }); }
function loon() { const t = AC.currentTime, out = farSrc(rnd(40, 90), 2, 2), o = osc('sine', 620), g = gainN(0); o.frequency.setValueAtTime(620, t); o.frequency.exponentialRampToValueAtTime(980, t + 0.6); o.frequency.exponentialRampToValueAtTime(600, t + 1.5); const v = osc('sine', 5), vg = gainN(15); v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 1.7); env(g, t, 0.35, 0.05, 1.2); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.7); }
function gust(k, type) {
  const t = AC.currentTime, pan = spanner(), s = noise('brown'), f = filt('bandpass', 250, 0.8), g = gainN(0);
  f.frequency.setValueAtTime(250, t); f.frequency.linearRampToValueAtTime(900, t + 1.8); f.frequency.linearRampToValueAtTime(300, t + 4.0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * k, t + 1.7); g.gain.linearRampToValueAtTime(0, t + 4.2); chain(s, f, g, pan); s.start(t, off()); s.stop(t + 4.4);
  if (type === 'forest') { const l = noise('pink'), lf = filt('bandpass', 3200, 0.7), lg = gainN(0); lg.gain.setValueAtTime(0, t + 0.4); lg.gain.linearRampToValueAtTime(0.012 * k, t + 2.0); lg.gain.linearRampToValueAtTime(0, t + 4.2); chain(l, lf, lg, pan); l.start(t, off()); l.stop(t + 4.4); }
  if (type === 'wind') { /* 텐트 천 펄럭임 */ const p = panner(-1.6, 1.0, 1.2, 1.5, 20, 1.2), fl = noise('white'), ff = filt('lowpass', 700), fg = gainN(0), am = gainN(0); fg.gain.setValueAtTime(0, t + 0.6); fg.gain.linearRampToValueAtTime(0.04 * k, t + 1.8); fg.gain.linearRampToValueAtTime(0, t + 4.0); const [lo, lg2] = lfo(rnd(6, 9), 0.02 * k, fg.gain); chain(fl, ff, fg, p); fl.start(t, off()); fl.stop(t + 4.2); setTimeout(() => kill([lo, lg2, p, am]), 4500); }
}
function foghorn() { const t = AC.currentTime, p = panner(-160, 15, -70, 60, 800, 0.6), lp = filt('lowpass', 500); lp.connect(p); const o = osc('sine', 95), o2 = osc('sine', 190), g2 = gainN(0.25), g = gainN(0); o.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp); env(g, t, 0.6, 0.06, 2.6); o.start(t); o2.start(t); o.stop(t + 3.4); o2.stop(t + 3.4); setTimeout(() => kill([lp, p]), 4000); }
function snowSlide() { const t = AC.currentTime, out = farSrc(rnd(40, 120), 1.5, 20); burst(out, false, 'lowpass', 900, 1, 0.25, 0.14, 0.8, t, 300, 0.9); }
function creak() { const t = AC.currentTime, pan = spanner(rnd(-0.4, 0.4)); burst(pan, false, 'lowpass', 350, 1, 0.08, 0.035, 0.3, t); tone(pan, 95, 70, 0.08, 0.02, 0.3, t); }
function ropeCreak() { const t = AC.currentTime, p = panner(5.2, 0.4, -18.6, 1, 12, 1.5); tone(p, rnd(150, 200), rnd(110, 140), 0.12, 0.025, 0.35, t); burst(p, 'brown', 'lowpass', 600, 1, 0.1, 0.03, 0.4, t); setTimeout(() => kill([p]), 1200); }

/* ── 매 프레임: 리스너, 불·랜턴 게인, 물 위치, 바람, 새떼 ── */
const GUST_K = { waves: 0.35, forest: 0.3, wind: 0.7 };
export function updateAudio(dt) {
  if (!AC || !ctx.camera) return; const cam = ctx.camera, L = AC.listener, W = ctx.W, t = AC.currentTime;
  cam.getWorldDirection(_f); _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
  if (L.positionX) { L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z; L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z; L.upX.value = _u.x; L.upY.value = _u.y; L.upZ.value = _u.z; }
  else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
  /* 불소리는 화면의 불꽃 크기(fireK)를 그대로 따라 커지고 작아진다 */
  if (fire) fire.gain.gain.setTargetAtTime(W.fireK || 0, t, 0.1);
  if (water) setPos(water.pan, cam.position.x, 0, water.z);
  if (lamps) { lamps.lantern.gain.gain.setTargetAtTime(W.lanternLit ? 1 : 0, t, 0.4); lamps.tentLamp.gain.gain.setTargetAtTime(W.tentLampLit ? 1 : 0, t, 0.4); }
  /* 바람: 0.1초마다 베드를 갱신하고, 바람이 0.7 을 위로 넘는 순간 돌풍 소리를 낸다 (최소 8초 간격) */
  if (bed && W.wind) {
    windAcc += dt;
    if (windAcc >= 0.1) {
      windAcc = 0; const w = W.wind.value, bw = bed.wind;
      if (bw) { bw.g.gain.setTargetAtTime(bw.g0 * (0.45 + 1.1 * w), t, 0.5); bw.f.frequency.setTargetAtTime(bw.f0 * (0.75 + 0.5 * w), t, 0.5); }
      if (bed.leaves) bed.leaves.setTargetAtTime(0.003 + 0.009 * w, t, 0.4);
      if (!ctx.paused && w > 0.7 && lastWind <= 0.7 && t - lastGust > 8) {
        lastGust = t;
        const nightK = bed.type === 'forest' && bed.timeKey === 'night' ? 0.85 : 1;
        gust((GUST_K[bed.type] || 0.3) * nightK * (0.8 + (w - 0.7)), bed.type);
      }
      lastWind = w;
    }
  }
  /* 새떼: 무리 위치를 따라가는 먼 기러기 울음 */
  if (W.flocks) {
    for (const g of W.flocks) {
      let a = flockAudio.get(g);
      if (!a) {
        const pan = panner(g.position.x, g.position.y, g.position.z, 14, 500, 1.0), lp = filt('lowpass', 1500); lp.connect(pan);
        a = { pan, lp, t: [], nodes: [lp, pan] }; flockAudio.set(g, a);
        const honk = () => { if (!flockAudio.has(g)) return; const now = AC.currentTime, n = 1 + Math.floor(Math.random() * 2); for (let i = 0; i < n; i++) { const f0 = rnd(330, 420); tone(lp, f0, f0 * 0.8, 0.03, 0.045, 0.22, now + i * 0.32, 'triangle'); } sched(a.t, honk, rnd(3000, 9000)); };
        sched(a.t, honk, rnd(800, 3000));
      }
      setPos(a.pan, g.position.x, g.position.y, g.position.z);
    }
    flockAudio.forEach((a, g) => { if (!W.flocks.includes(g)) { killT(a.t); kill(a.nodes); flockAudio.delete(g); } });
  }
}

/* ── 발소리 (위스키를 들었으면 두 걸음에 한 번 얼음이 부딪힌다) ── */
let stepIdx = 0;
function footstep(surface) {
  const t0 = AC.currentTime, side = (stepIdx++ % 2) ? 0.12 : -0.12, v = rnd(0.72, 0.98);
  const pan = AC.createStereoPanner(); pan.pan.value = side; pan.connect(sfxBus);
  const grains = (n, span, kind, type, f0, q, peak, d, t, f1) => { for (let i = 0; i < n; i++) { const k = rnd(0.45, 1); burst(pan, kind, type, f0 * rnd(0.8, 1.25), q, 0.002, peak * k * v, d * rnd(0.7, 1.3), t + Math.random() * span, f1 ? f1 * rnd(0.8, 1.2) : undefined, d); } };
  if (surface === 'snow') {
    tone(pan, 65, 45, 0.004, 0.11 * v, 0.08, t0); burst(pan, true, 'lowpass', 220, 1, 0.005, 0.06 * v, 0.15, t0);
    grains(14, 0.12, false, 'highpass', 2400, 1, 0.04, 0.02, t0); burst(pan, false, 'bandpass', 3000, 8, 0.02, 0.02 * v, 0.13, t0 + 0.02, 2200); grains(8, 0.08, false, 'highpass', 2800, 1, 0.025, 0.018, t0 + 0.11);
  } else if (surface === 'wood') {
    tone(pan, 110, 75, 0.004, 0.16 * v, 0.16, t0); burst(pan, false, 'bandpass', 240, 6, 0.003, 0.08 * v, 0.12, t0); tone(pan, 330, 300, 0.004, 0.03 * v, 0.1, t0);
    burst(pan, false, 'lowpass', 1200, 1, 0.002, 0.05 * v, 0.03, t0); tone(pan, 95, 70, 0.004, 0.06 * v, 0.1, t0 + 0.09);
    if (Math.random() < 0.25) { const o = tone(pan, 190, 150, 0.05, 0.02 * v, 0.25, t0 + 0.04); const w = osc('sine', 11), wg = gainN(9); w.connect(wg); wg.connect(o.frequency); w.start(t0); w.stop(t0 + 0.4); }
  } else if (surface === 'wet') {
    burst(pan, false, 'bandpass', 2800, 0.8, 0.008, 0.07 * v, 0.14, t0, 1400, 0.14); burst(pan, true, 'lowpass', 350, 1, 0.006, 0.06 * v, 0.1, t0);
    grains(5, 0.25, false, 'bandpass', 4200, 2, 0.02, 0.03, t0 + 0.05); burst(pan, false, 'bandpass', 500, 3, 0.03, 0.03 * v, 0.12, t0 + 0.12, 900, 0.12);
  } else if (surface === 'sand') {
    tone(pan, 60, 42, 0.008, 0.06 * v, 0.1, t0); burst(pan, true, 'lowpass', 420, 1, 0.012, 0.09 * v, 0.24, t0, 220, 0.24);
    grains(16, 0.2, false, 'bandpass', 2600, 1.2, 0.028, 0.035, t0); grains(6, 0.1, false, 'bandpass', 3400, 1.5, 0.018, 0.03, t0 + 0.14);
  } else {
    tone(pan, 75, 50, 0.004, 0.08 * v, 0.07, t0); burst(pan, true, 'lowpass', 600, 1, 0.005, 0.06 * v, 0.09, t0); burst(pan, false, 'bandpass', 900, 1.0, 0.006, 0.05 * v, 0.07, t0);
    grains(10, 0.14, false, 'bandpass', 3600, 1.2, 0.03, 0.03, t0); burst(pan, true, 'lowpass', 700, 1, 0.005, 0.04 * v, 0.07, t0 + 0.1); grains(4, 0.06, false, 'bandpass', 3000, 1.2, 0.02, 0.025, t0 + 0.11);
  }
  if (state.item === 'whisky' && Math.random() < 0.5) ice(0.45, t0 + rnd(0.05, 0.15));
}

/* ── 손·몸 효과음 ── */
function ice(k, t) { const B = sfxBus, pv = rnd(0.93, 1.07); [2400, 3150].forEach((fq, i) => tone(B, fq * pv, 0, 0.003, (0.06 - i * 0.02) * k, 0.3, t + i * 0.02)); burst(B, false, 'bandpass', 900, 1.5, 0.03, 0.02 * k, 0.2, t + 0.02); }
function zipper(open) {
  const t0 = AC.currentTime, B = sfxBus, dur = rnd(0.6, 0.85), n = Math.round(dur * 70), f0 = open ? 2200 : 3600, f1 = open ? 3600 : 2200;
  for (let i = 0; i < n; i++) { const p = i / n, t = t0 + dur * (p + 0.12 * Math.sin(p * 6.283)), k = 0.4 + 0.6 * Math.sin(Math.PI * p); burst(B, false, 'bandpass', (f0 + (f1 - f0) * p) * rnd(0.95, 1.05), 4, 0.001, 0.03 * k * rnd(0.6, 1), 0.012, t); }
  burst(B, true, 'lowpass', 500, 1, 0.05, 0.025, dur, t0);
}
function pour() {
  const t = AC.currentTime, B = sfxBus;
  burst(B, false, 'highpass', 2500, 1, 0.003, 0.04, 0.05, t);
  const s = noise('white'), f = filt('bandpass', 600, 1.4), g = gainN(0); chain(s, f, g, B);
  f.frequency.setValueAtTime(600, t + 0.25); f.frequency.exponentialRampToValueAtTime(1500, t + 1.6);
  g.gain.setValueAtTime(0.0001, t + 0.25); g.gain.linearRampToValueAtTime(0.04, t + 0.5); g.gain.setValueAtTime(0.04, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.75);
  s.start(t + 0.25, off()); s.stop(t + 1.8);
  [0.45, 0.8, 1.15].forEach((d, i) => tone(B, 170 + i * 40, 260 + i * 50, 0.03, 0.03, 0.12, t + d));
}
function fabric(dest, t, peak, d) { burst(dest, true, 'lowpass', 600, 1, 0.05, peak, d, t); burst(dest, false, 'bandpass', 1800, 0.8, 0.03, peak * 0.35, d * 0.7, t + 0.02); }
export function sfx(type, arg) {
  if (!AC) return; const t = AC.currentTime, B = sfxBus, U = uiBus, pv = rnd(0.94, 1.06);
  switch (type) {
    case 'step': footstep(arg); return;
    /* 자세·장비 */
    case 'sit': fabric(B, t, 0.06, 0.35); tone(B, 420 * pv, 380, 0.004, 0.015, 0.08, t + 0.05); return;
    case 'stand': fabric(B, t, 0.045, 0.28); tone(B, 180 * pv, 160, 0.03, 0.015, 0.15, t); return;
    case 'bag': for (let i = 0; i < 5; i++) burst(B, false, 'bandpass', rnd(1500, 2200), 0.8, 0.03, rnd(0.02, 0.035), 0.16, t + i * rnd(0.15, 0.28)); burst(B, true, 'lowpass', 500, 1, 0.1, 0.04, 1.2, t); return;
    case 'zipper': zipper(arg !== 'close'); return;
    case 'plant': if (arg === 'snow') { burst(B, true, 'lowpass', 220, 1, 0.005, 0.05, 0.12, t); for (let i = 0; i < 6; i++) burst(B, false, 'highpass', 2400 * rnd(0.8, 1.2), 1, 0.002, 0.02, 0.02, t + Math.random() * 0.08); }
      else if (arg === 'sand') { for (let i = 0; i < 8; i++) burst(B, false, 'bandpass', 2600 * rnd(0.8, 1.2), 1.2, 0.002, 0.018, 0.03, t + Math.random() * 0.12); burst(B, true, 'lowpass', 400, 1, 0.01, 0.05, 0.18, t); }
      else { burst(B, true, 'lowpass', 500, 1, 0.005, 0.06, 0.14, t); burst(B, false, 'bandpass', 900, 1, 0.004, 0.03, 0.06, t); } return;
    case 'trunkOpen': burst(B, false, 'highpass', 4000 * pv, 1, 0.002, 0.1, 0.03, t); burst(B, true, 'lowpass', 300, 1, 0.05, 0.05, 0.3, t + 0.04, 900, 0.35); return;
    case 'trunkClose': tone(B, 95 * pv, 60, 0.004, 0.22, 0.22, t); burst(B, false, 'lowpass', 500, 1, 0.003, 0.15, 0.12, t); burst(B, false, 'bandpass', 2500 * pv, 2, 0.003, 0.025, 0.06, t + 0.02); return;
    case 'doorOpen': burst(B, false, 'highpass', 3500 * pv, 1, 0.002, 0.08, 0.04, t); { const o = tone(B, 220 * pv, 170, 0.06, 0.02, 0.25, t + 0.05); const v = osc('sine', 9), vg = gainN(12); v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 0.4); } burst(B, true, 'lowpass', 700, 1, 0.08, 0.02, 0.3, t + 0.05, 1400, 0.3); return;
    case 'doorClose': tone(B, 70 * pv, 45, 0.004, 0.28, 0.28, t); burst(B, false, 'lowpass', 400, 1, 0.003, 0.2, 0.15, t); burst(B, false, 'highpass', 3000 * pv, 1, 0.002, 0.06, 0.04, t + 0.03); burst(B, false, 'bandpass', 180, 4, 0.01, 0.05, 0.35, t); return;
    /* 아이템 */
    case 'pick': if (arg === 'coffee') pour(); else if (arg === 'whisky') { ice(1, t); ice(0.7, t + 0.13); } else if (arg === 'sparkler') { for (let i = 0; i < 3; i++) burst(B, false, 'bandpass', 2000 * rnd(0.9, 1.1), 0.8, 0.01, 0.03, 0.08, t + i * 0.09); } else sfx('lighter'); return;
    case 'sip': burst(B, false, 'bandpass', 700 * pv, 1.2, 0.06, 0.045, 0.25, t, 1900 * pv, 0.25); return;
    case 'gulp': tone(B, 110 * pv, 70, 0.01, 0.07, 0.14, t); burst(B, false, 'lowpass', 500, 1, 0.01, 0.025, 0.1, t); return;
    case 'clink': ice(1, t); return;
    case 'inhale': burst(B, false, 'highpass', 1200 * pv, 1, 0.35, 0.035, 0.25, t, 2500, 0.6); return;
    case 'exhale': burst(B, false, 'bandpass', 900 * pv, 0.6, 0.06, 0.035, 0.7, t, 450, 0.7); return;
    case 'lighter': burst(B, false, 'highpass', 3000 * pv, 1, 0.003, 0.1, 0.14, t); return;
    /* 불·랜턴 */
    case 'fireOn': sfx('lighter'); burst(B, true, 'lowpass', 300, 1, 0.06, 0.16, 0.7, t + 0.25, 140, 0.7); return;
    case 'fireOff': burst(B, true, 'lowpass', 700, 1, 0.02, 0.1, 0.25, t); burst(B, false, 'bandpass', 3000, 0.8, 0.1, 0.045, 1.4, t + 0.1, 1500, 1.4); for (let i = 0; i < 3; i++) burst(B, false, 'highpass', 2500 * rnd(0.9, 1.2), 1, 0.002, 0.02, 0.03, t + 0.3 + Math.random() * 0.6); return;
    case 'lampOn': tone(B, 1600 * pv, 1200, 0.002, 0.03, 0.04, t); sfx('lighter'); return;
    case 'lampOff': tone(B, 1600 * pv, 1200, 0.002, 0.03, 0.04, t); burst(B, false, 'bandpass', 3000, 1.5, 0.02, 0.02, 0.5, t, 1800, 0.5); return;
    case 'sparkOn': burst(B, false, 'bandpass', 5000, 0.8, 0.03, 0.14, 0.45, t); for (let i = 0; i < 6; i++) burst(B, false, 'bandpass', rnd(4500, 8000), 2, 0.002, rnd(0.04, 0.08), 0.02, t + Math.random() * 0.3); return;
    case 'sparkOff': burst(B, false, 'bandpass', 4500, 0.8, 0.02, 0.04, 0.5, t, 2500, 0.5); return;
    /* UI (컴프레서 우회, 실내 필터 무관) */
    case 'ui': tone(U, 880 * pv, 0, 0.004, 0.025, 0.08, t); tone(U, 1320 * pv, 0, 0.004, 0.01, 0.06, t); return;
    case 'uiGo': tone(U, 392, 0, 0.01, 0.035, 0.3, t); tone(U, 523, 0, 0.01, 0.035, 0.4, t + 0.16); return;
    case 'uiOpen': tone(U, 520, 660, 0.01, 0.03, 0.12, t); return;
    case 'uiClose': tone(U, 660, 520, 0.01, 0.03, 0.12, t); return;
    case 'shutter': burst(U, false, 'highpass', 5000, 1, 0.001, 0.1, 0.012, t); tone(U, 1400, 900, 0.002, 0.035, 0.03, t); burst(U, false, 'lowpass', 900, 1, 0.002, 0.09, 0.03, t + 0.06); tone(U, 260, 180, 0.003, 0.045, 0.05, t + 0.06); return;
  }
}