import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { BG } from './data.js';
import { rnd } from './util.js';

/* ── 방향: 힐링 캠핑. 모든 소리는 멀리·부드럽게·드물게. 날카로운 고역 없음, 긴 어택, 밤엔 더 뜸하게.
   버스: world(환경·위치음, 실내 필터) / bed(world 안의 배경 베드 — 한 모금 하는 동안 살짝 물러난다)
         sfx(손·몸 근처) / dry(입 근처, 잔향 없음) / ui(메뉴·셔터, 컴프레서 우회)
   공간 잔향: world 와 sfx 가 같은 절차적 임펄스 응답을 공유한다 (텐트·차·숲·해변·설원) ── */

/* ── 녹음 샘플로 바꾸고 싶을 때: 파일 경로를 넣으면 합성 버퍼 대신 이 파일들을 돌아가며 쓴다.
   예) sand: ['sounds/sand_1.ogg', 'sounds/sand_2.ogg', ...]
   녹음본은 크기가 제각각이라 FOLEY_GAIN 으로 맞춘다.
   gulpCoffee: 커피 한 모금 넘김 / gulpWhisky: 위스키 한 모금 넘김
   crackle: 장작 타닥 / firePop: 큰 탁 / cricketChirp: 끊어 우는 귀뚜라미 / cricketTrill: 길게 떠는 귀뚜라미 (먼 합창도 이 샘플로 다시 구워진다) ── */
export const FOLEY_FILES = {
  sand: [], dirt: [], gulpCoffee: [], gulpWhisky: [],
  crackle: [], firePop: [], cricketChirp: [], cricketTrill: [],
  chopHit: [], chopSplit: [], chopKnot: [], logPlace: [], woodLand: [],
};
const FOLEY_GAIN = {
  sand: 0.12, dirt: 0.13, gulpCoffee: 0.05, gulpWhisky: 0.06,
  crackle: 0.09, firePop: 0.17, cricketChirp: 0.022, cricketTrill: 0.016,
  chopHit: 0.32, chopSplit: 0.4, chopKnot: 0.3, logPlace: 0.2, woodLand: 0.17,
};
/* 한 모금 하는 동안 배경 베드가 물러나는 정도 (0 = 끔). 0.3 이면 베드 -3dB, 고역 6kHz 위가 부드럽게 깎인다 */
const SIP_FOCUS = 0.3;

let AC = null, master, comp, worldLP, worldGain, bedBus, bedLP, sfxBus, dryBus, uiBus, verb = null;
const bufs = {}, irCache = {};
let bed = null, evTimer = null, sceneKey = null, menuMode = false, indoor = false, focusOn = false;
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
  for (const k in bufs) delete bufs[k]; for (const k in irCache) delete irCache[k]; for (const k in bank) delete bank[k];
  master = gainN(settings.vol); master.connect(AC.destination);
  comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 2.5; comp.attack.value = 0.015; comp.release.value = 0.3; comp.connect(master);
  worldLP = filt('lowpass', 20000); worldGain = gainN(1); worldLP.connect(worldGain); worldGain.connect(comp);
  bedLP = filt('lowpass', 20000); bedBus = gainN(1); chain(bedBus, bedLP, worldLP);   // 배경 베드 전용 (한 모금 포커스)
  sfxBus = gainN(1); sfxBus.connect(comp);
  dryBus = gainN(1); dryBus.connect(comp);   // 입 근처 소리(마시기): 공간 잔향을 타지 않는다
  uiBus = gainN(0.8); uiBus.connect(master);
  /* 잔향 입력: world 전부 + sfx 는 조금 덜 (손 근처 소리는 직접음이 더 커야 한다) */
  const vin = gainN(1), sfxSend = gainN(0.7); worldGain.connect(vin); sfxBus.connect(sfxSend); sfxSend.connect(vin);
  verb = { in: vin, slot: null, key: null };
  /* 폴리 뱅크는 첫 사용에서 멈칫하지 않도록 미리 굽는다. 종류마다 한 틱씩 나눠 한 번에 오래 멈추지 않게.
     다 구운 뒤 벌레 합창을 굽고, 녹음 파일이 지정돼 있으면 불러와 덮어쓴다 */
  const keys = Object.keys(GEN);
  keys.forEach((k, i) => setTimeout(() => getBank(k), i * 25));
  setTimeout(() => { getChorus(); loadFoley(); }, keys.length * 25 + 25);
}
export function resumeAudio() { if (AC && AC.state === 'suspended') AC.resume(); }
export function setVolume(v) { if (master) master.gain.setTargetAtTime(v, AC.currentTime, 0.03); }
/* 한 모금 포커스: 잔이 입에 닿으면 0.6초에 걸쳐 배경이 살짝 물러나고, 떨어지면 1.5초에 걸쳐 숨을 내쉬듯 돌아온다.
   새 소리를 더하지 않고 믹스만 바꾼다. 같은 상태로 다시 불러도 아무 일도 하지 않으므로 매 프레임 불러도 된다 */
export function setSipFocus(on) {
  on = !!on; if (!AC || !bedBus || on === focusOn) return; focusOn = on;
  const t = AC.currentTime, tc = on ? 0.6 : 1.5, k = on ? SIP_FOCUS : 0;
  bedBus.gain.setTargetAtTime(1 - k, t, tc);
  bedLP.frequency.setTargetAtTime(20000 * Math.pow(0.3, k / 0.3), t, tc);
}

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
/* 진행 중인 램프를 그 자리에서 멈춘다. cancelAndHoldAtTime 이 없는 브라우저(Firefox)는 현재 값을 다시 박아 넣는다
   — cancelScheduledValues 만 쓰면 램프 도중 값이 이전 이벤트로 튀어 '틱' 소리가 난다 */
function holdParam(p, t) {
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else { const v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); }
}

/* ══ 절차적 폴리 뱅크 ══
   게임 발소리처럼 "녹음본 여러 개를 돌려 쓰는" 구조를 합성으로 흉내 낸다.
   소리를 샘플 단위로 직접 그려 AudioBuffer 로 구워 두고(종류마다 변형 여러 개), 재생할 때 변형을 고르고 피치·크기를 흔든다.
   층별로 먼저 정규화한 뒤 섞기 때문에 amp 값이 곧 층 사이의 비율이다 */
const bank = {}, lastIdx = {};
function lowpass(d, sr, fc) { const k = Math.exp(-2 * Math.PI * fc / sr); let y = 0; for (let i = 0; i < d.length; i++) { y = d[i] * (1 - k) + y * k; d[i] = y; } }
function highpass(d, sr, fc) { const k = Math.exp(-2 * Math.PI * fc / sr); let y = 0, px = 0; for (let i = 0; i < d.length; i++) { const x = d[i]; y = k * (y + x - px); px = x; d[i] = y; } }
/* 2차 필터(RBJ): 'bp' 대역통과(정점 0dB) / 'lp' 저역 / 'hp' 고역 — 벌레 소리의 공명처럼 좁은 대역이 필요할 때 */
function bq(d, sr, type, f, q) {
  const w = 2 * Math.PI * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; }
  else if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
  else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
  const a0 = 1 + al, a1 = -2 * cs / a0, a2 = (1 - al) / a0; b0 /= a0; b1 /= a0; b2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) { const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; }
}
function mixIn(d, L, amp) { let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i])); if (pk < 1e-9) return; const g = amp / pk; for (let i = 0; i < d.length; i++) d[i] += L[i] * g; }
function makeBuf(dur, fill) {
  const sr = AC.sampleRate, n = Math.floor(sr * dur), b = AC.createBuffer(1, n, sr), d = b.getChannelData(0);
  fill(d, sr);
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i]));
  const g = pk > 0 ? 0.9 / pk : 1, fo = Math.floor(0.008 * sr);
  for (let i = 0; i < n; i++) d[i] *= g * (i > n - fo ? (n - i) / fo : 1);
  return b;
}
/* 충격: 저역 노이즈를 짧게 — 음정이 없어 "뿡" 하지 않고 "툭/퍽" 하게 들린다 */
function thud(d, sr, t0, fc, tau, amp, atk) {
  const L = new Float32Array(d.length), i0 = Math.floor(t0 * sr), a = Math.max(1, (atk || 0.002) * sr), T = tau * sr;
  for (let i = i0; i < L.length; i++) { const t = i - i0; const e = t < a ? t / a : Math.exp(-(t - a) / T); if (t > a && e < 1e-4) break; L[i] = (Math.random() * 2 - 1) * e; }
  lowpass(L, sr, fc); lowpass(L, sr, fc * 1.4); mixIn(d, L, amp);
}
/* 알갱이: 0.2~4ms 짜리 아주 짧은 노이즈 조각을 수십~수백 개. skew 가 클수록 앞쪽에 몰린다 → 모래 '사각', 흙·잔돌 '바삭' */
function grainLayer(d, sr, t0, span, n, len0, len1, skew, amp, lo, hi) {
  const L = new Float32Array(d.length);
  for (let g = 0; g < n; g++) {
    const u = Math.pow(Math.random(), skew), s = Math.floor((t0 + u * span) * sr), len = Math.max(2, Math.floor(rnd(len0, len1) * sr)), a = (0.3 + 0.7 * Math.random()) * Math.pow(1 - u, 1.2);
    for (let i = 0; i < len && s + i < L.length; i++) L[s + i] += (Math.random() * 2 - 1) * a * Math.exp(-4 * i / len);
  }
  highpass(L, sr, lo); lowpass(L, sr, hi); lowpass(L, sr, hi * 1.3); mixIn(d, L, amp);
}
/* 스침: 대역 제한 노이즈를 부드럽게 — 모래가 밀리거나 풀이 쓸리는 '쉭' */
function hissLayer(d, sr, t0, atk, tau, amp, lo, hi) {
  const L = new Float32Array(d.length), i0 = Math.floor(t0 * sr), a = Math.max(1, atk * sr), T = tau * sr;
  for (let i = i0; i < L.length; i++) { const t = i - i0; const e = t < a ? t / a : Math.exp(-(t - a) / T); if (t > a && e < 1e-4) break; L[i] = (Math.random() * 2 - 1) * e; }
  highpass(L, sr, lo); highpass(L, sr, lo); lowpass(L, sr, hi); mixIn(d, L, amp);
}
/* 모래: 부드러운 뒤꿈치 → 촘촘한 '사각사각' + 밀리는 '쉭' → 앞꿈치에서 한 번 더 */
function sandStep() {
  return makeBuf(0.42, (d, sr) => {
    const v = rnd(0.85, 1.15);
    thud(d, sr, 0, 220 * v, 0.035, 0.55, 0.006);
    grainLayer(d, sr, 0.004, 0.16, Math.round(rnd(260, 360)), 0.0002, 0.0009, 1.8, 0.8, 1400, 6500);
    hissLayer(d, sr, 0, 0.012, 0.06, 0.25, 900, 3500);
    const t1 = rnd(0.085, 0.12);
    thud(d, sr, t1, 260 * v, 0.025, 0.3, 0.004);
    grainLayer(d, sr, t1, 0.14, Math.round(rnd(150, 220)), 0.0002, 0.0008, 1.5, 0.45, 1800, 7000);
  });
}
/* 흙·숲 바닥: 단단한 '툭' + 흙·잔돌 '바삭' (+ 낙엽 '바스락') → 앞꿈치 */
function dirtStep(leaves) {
  return makeBuf(0.36, (d, sr) => {
    const v = rnd(0.85, 1.15);
    thud(d, sr, 0, 300 * v, 0.022, 0.75, 0.002);
    grainLayer(d, sr, 0.002, 0.07, Math.round(rnd(60, 100)), 0.0005, 0.0025, 2.2, 0.55, 900, 5000);
    if (leaves) grainLayer(d, sr, 0.005, 0.14, Math.round(rnd(80, 130)), 0.0008, 0.004, 1.4, 0.35, 1800, 7000);
    hissLayer(d, sr, 0, 0.01, 0.05, 0.12, 1500, 5000);
    const t1 = rnd(0.07, 0.1);
    thud(d, sr, t1, 360 * v, 0.016, 0.35, 0.002);
    grainLayer(d, sr, t1, 0.06, Math.round(rnd(30, 50)), 0.0005, 0.002, 2, 0.3, 1000, 5000);
  });
}

/* ── 마시기: 한 모금을 넘기는 '꿀꺽' 하나만 쓴다 ──
   음정 없는 저역 충격은 발소리처럼 들리고, 매끈한 사인은 '뽕' 하고 튄다.
   그 중간 — 좁은 노이즈 공명이 아래로 미끄러지는 소리 — 가 목 안에서 나는 소리로 들린다.
   커피: 조금 높고 짧고 가볍게 / 위스키: 조금 낮고 길고 묵직하게 (천천히 머금었다 넘기는 느낌) */
function sweepRes(d, sr, t0, dur, f0, f1, q, amp, atk) {
  const L = new Float32Array(d.length), i0 = Math.floor(t0 * sr), n = Math.floor(dur * sr); let y1 = 0, y2 = 0;
  for (let i = 0; i < n && i0 + i < L.length; i++) {
    const u = i / n, f = f0 * Math.pow(f1 / f0, u), w = 2 * Math.PI * f / sr, r = Math.exp(-Math.PI * f / (q * sr));
    const e = Math.min(1, u / atk) * Math.pow(1 - u, 1.5);
    const y = (Math.random() * 2 - 1) * e + 2 * r * Math.cos(w) * y1 - r * r * y2; y2 = y1; y1 = y; L[i0 + i] = y;
  }
  mixIn(d, L, amp);
}
function gulpBuf(heavy) {
  return makeBuf(heavy ? 0.34 : 0.28, (d, sr) => {
    grainLayer(d, sr, 0, 0.015, 4, 0.0006, 0.0018, 1.2, heavy ? 0.08 : 0.12, 1500, 3500);   // 혀가 떨어지는 젖은 딸깍 (아주 작게)
    const t1 = rnd(0.02, 0.035);
    /* '꿀': 좁은 공명이 아래로 미끄러진다 */
    sweepRes(d, sr, t1, heavy ? rnd(0.065, 0.085) : rnd(0.045, 0.06), heavy ? rnd(380, 450) : rnd(470, 560), heavy ? rnd(200, 240) : rnd(260, 320), heavy ? 6 : 7.5, 0.8, 0.2);
    /* '꺽': 목이 닫히는 짧은 두 번째 공명 + 몸 안쪽의 둔한 울림 */
    const t2 = t1 + (heavy ? rnd(0.09, 0.12) : rnd(0.065, 0.085));
    sweepRes(d, sr, t2, rnd(0.03, 0.045), heavy ? rnd(270, 320) : rnd(320, 380), heavy ? rnd(180, 210) : rnd(220, 260), 6, 0.4, 0.15);
    thud(d, sr, t2, heavy ? 120 : 150, 0.03, heavy ? 0.22 : 0.12, 0.006);
  });
}

/* ── 모닥불: 나무 속 수분이 터지는 아주 짧은 딸깍(0.3~2.5ms)이 30~70ms 안에 2~6개 뭉친 '타닥'.
   big: 딸깍 8~14개 + 몸통 '탁' + 짧은 쉭 → 불티가 솟는 큰 '탁!' ── */
function crackleBuf(big) {
  return makeBuf(big ? 0.25 : 0.12, (d, sr) => {
    const n = big ? Math.round(rnd(8, 14)) : Math.round(rnd(2, 6)), span = big ? rnd(0.06, 0.12) : rnd(0.02, 0.07), L = new Float32Array(d.length);
    for (let k = 0; k < n; k++) {
      const s = Math.floor((k === 0 ? 0 : Math.pow(Math.random(), 1.3) * span) * sr), len = Math.max(2, Math.floor(rnd(0.0003, k === 0 ? 0.0025 : 0.0015) * sr)), a = k === 0 ? 1 : rnd(0.25, 0.9);
      for (let i = 0; i < len && s + i < L.length; i++) L[s + i] += (Math.random() * 2 - 1) * a * Math.exp(-5 * i / len);
    }
    highpass(L, sr, big ? 900 : 1500); lowpass(L, sr, 9000); mixIn(d, L, 0.9);
    thud(d, sr, 0, big ? rnd(500, 800) : rnd(900, 1400), big ? 0.012 : 0.004, big ? 0.55 : 0.25, 0.0005);
    if (big) hissLayer(d, sr, 0.01, 0.005, 0.08, 0.12, 1500, 5000);
  });
}

/* ── 귀뚜라미: 날개 톱니가 부딪히는 펄스열이 3~5kHz 공명을 두드린다 → 음정은 있지만 결이 거칠고, 음절 안에서 음정이 살짝 내려간다 ── */
function cricketSyll(L, sr, s0, f, dur, amp, tooth) {
  const n = Math.floor(dur * sr), dk = Math.exp(-1 / (sr * 0.0012)); let ph = 0, pk = 0, next = 0;
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / sr;
    if (t >= next) { pk = rnd(0.6, 1); next = t + rnd(0.85, 1.15) / tooth; }   // 톱니 하나
    pk *= dk;
    ph += 2 * Math.PI * f * (1 - 0.03 * t / dur) / sr;
    const e = Math.min(1, t / 0.0015) * Math.min(1, (dur - t) / 0.004);
    L[s0 + i] += ((Math.sin(ph) + 0.12 * Math.sin(2 * ph + 0.7)) * (0.45 + 0.55 * pk) + (Math.random() * 2 - 1) * 0.35 * pk) * e * amp;
  }
}
/* trill=false: '귀뚤' 끊어 우는 종(3~5음절) / trill=true: '르르르' 1.4~2.6초 떨며 우는 종 */
function cricketBuf(trill) {
  const f = trill ? rnd(3300, 3900) : rnd(4000, 4700), tooth = rnd(180, 320);
  if (!trill) {
    const nS = 3 + Math.floor(Math.random() * 3), per = rnd(0.038, 0.05), sd = rnd(0.014, 0.02);
    return makeBuf(nS * per + 0.03, (d, sr) => {
      const L = new Float32Array(d.length);
      for (let k = 0; k < nS; k++) cricketSyll(L, sr, Math.floor((0.004 + k * per + rnd(0, 0.003)) * sr), f * rnd(0.992, 1.008), sd * rnd(0.9, 1.1), rnd(0.75, 1) * (k === nS - 1 ? 0.8 : 1), tooth);
      bq(L, sr, 'bp', f, 2.2); mixIn(d, L, 1);
    });
  }
  const T = rnd(1.4, 2.6), per = rnd(0.02, 0.026), sd = per * 0.55;
  return makeBuf(T, (d, sr) => {
    const L = new Float32Array(d.length);
    for (let t = 0.01; t < T - 0.03; t += per * rnd(0.95, 1.05)) { const u = t / T, sw = Math.min(1, u / 0.15) * Math.min(1, (1 - u) / 0.2); cricketSyll(L, sr, Math.floor(t * sr), f, sd, sw * rnd(0.8, 1), tooth); }
    bq(L, sr, 'bp', f, 2.2); mixIn(d, L, 1);
  });
}

/* 나무가 울리는 짧은 공명: 40~70ms 안에 사라져 음정보다 '통·탁' 하는 몸통 소리로 들린다. 노이즈를 곱해 매끈한 사인 느낌을 없앤다 */
function resonance(d, sr, t0, f, tau, amp, glide) {
  const L = new Float32Array(d.length), i0 = Math.floor(t0 * sr); let ph = 0;
  for (let i = i0; i < L.length; i++) {
    const t = (i - i0) / sr; if (t > tau * 7) break;
    ph += 2 * Math.PI * f * (1 + (glide || 0) * Math.exp(-t / 0.012)) / sr;
    L[i] = Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0015) * (0.75 + 0.5 * Math.random());
  }
  lowpass(L, sr, f * 3); mixIn(d, L, amp);
}
/* 도끼질: 박힘 '퍽 통' / 쪼개짐 '퍽 쩍 쿵'(두 쪽이 따로 울린다) / 옹이 '탁'(단단해서 튕긴다) */
function chopBuf(kind) {
  return makeBuf(kind === 'split' ? 0.6 : 0.4, (d, sr) => {
    const v = rnd(0.9, 1.1);
    if (kind === 'knot') { thud(d, sr, 0, 750 * v, 0.012, 0.7, 0.001); resonance(d, sr, 0, rnd(420, 520), 0.045, 0.6, 0.15); grainLayer(d, sr, 0, 0.02, 20, 0.0003, 0.001, 2, 0.25, 1500, 6000); return; }
    thud(d, sr, 0, 520 * v, 0.03, 0.85, 0.001);
    resonance(d, sr, 0, rnd(170, 240), 0.06, 0.5, 0.2);
    grainLayer(d, sr, 0.001, 0.05, 50, 0.0003, 0.0015, 2.5, 0.35, 1200, 6000);
    if (kind === 'split') {
      grainLayer(d, sr, 0.008, 0.09, 160, 0.0002, 0.0012, 1.6, 0.7, 1500, 7500);
      resonance(d, sr, 0.012, rnd(300, 380), 0.07, 0.35, 0.1);
      resonance(d, sr, 0.016, rnd(420, 520), 0.05, 0.22, 0.1);
      thud(d, sr, 0.02, 260, 0.06, 0.45, 0.004);
    }
  });
}
/* 나무끼리, 나무와 땅이 부딪히는 짧은 '툭' */
function knockBuf(fc, rf, tau, grains) {
  return makeBuf(0.3, (d, sr) => { thud(d, sr, 0, fc * rnd(0.9, 1.1), tau, 0.8, 0.002); resonance(d, sr, 0, rf * rnd(0.85, 1.15), 0.04, 0.4, 0.1); if (grains) grainLayer(d, sr, 0.002, 0.05, grains, 0.0005, 0.002, 2, 0.25, 800, 4500); });
}
const GEN = {
  sand: [sandStep, 8], dirt: [() => dirtStep(false), 8], dirtLeaf: [() => dirtStep(true), 8],
  gulpCoffee: [() => gulpBuf(false), 6], gulpWhisky: [() => gulpBuf(true), 6],
  crackle: [() => crackleBuf(false), 12], firePop: [() => crackleBuf(true), 5],
  cricketChirp: [() => cricketBuf(false), 6], cricketTrill: [() => cricketBuf(true), 3],
  chopHit: [() => chopBuf('hit'), 5], chopSplit: [() => chopBuf('split'), 5], chopKnot: [() => chopBuf('knot'), 4],
  logPlace: [() => knockBuf(380, 150, 0.03, 25), 4], woodLand: [() => knockBuf(650, 300, 0.02, 40), 5],
};
function getBank(k) { return bank[k] || (bank[k] = Array.from({ length: GEN[k][1] }, GEN[k][0])); }
function loadFoley() {
  for (const k in FOLEY_FILES) {
    const urls = FOLEY_FILES[k]; if (!urls.length) continue;
    Promise.all(urls.map(u => fetch(u).then(r => r.arrayBuffer()).then(b => AC.decodeAudioData(b))))
      .then(list => { bank[k] = list; if (k === 'dirt') bank.dirtLeaf = list; })
      .catch(e => console.warn('foley load failed:', k, e));
  }
}
/* 버퍼 하나를 재생하고 끝나면 노드를 정리한다 */
function playBuf(buf, dest, gain, rate, t, pan) {
  const s = AC.createBufferSource(), g = gainN(gain); s.buffer = buf; s.playbackRate.value = rate;
  const nodes = [s, g]; s.connect(g);
  if (pan) { const p = AC.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest); nodes.push(p); } else g.connect(dest);
  s.onended = () => nodes.forEach(n => { try { n.disconnect(); } catch (e) {} });
  s.start(t);
}
/* 뱅크에서 하나를 골라 재생: 직전과 같은 변형은 피하고, 피치·크기·좌우를 살짝 흔든다 */
function playBank(key, dest, gain, rate, t, pan) {
  const list = getBank(key); let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastIdx[key]) i = (i + 1) % list.length; lastIdx[key] = i;
  playBuf(list[i], dest, gain, rate, t, pan);
}
/* 먼 귀뚜라미 합창: 개체 14마리(4마리 중 1마리는 떨며 우는 종)가 저마다 일정한 음색·주기로 우는 8초 스테레오 루프.
   멀수록 작고 고역이 깎인다. 귀뚜라미 뱅크가 녹음본으로 바뀌면 다음 밤에 그 샘플로 다시 굽는다 */
let chorus = null, chorusKey = null;
function getChorus() {
  const cb = getBank('cricketChirp'), tb = getBank('cricketTrill');
  if (chorus && chorusKey === cb[0]) return chorus;
  const sr = AC.sampleRate, len = sr * 8, out = AC.createBuffer(2, len, sr), Lc = out.getChannelData(0), Rc = out.getChannelData(1);
  const add = (buf, at, rate, gl, gr, k) => {
    const src = buf.getChannelData(0), n = Math.floor((src.length - 1) / rate); let y = 0;
    for (let i = 0; i < n; i++) { const p = i * rate, i0 = p | 0, x = src[i0] + (src[i0 + 1] - src[i0]) * (p - i0); y = x * (1 - k) + y * k; const j = (at + i) % len; Lc[j] += y * gl; Rc[j] += y * gr; }
  };
  for (let v = 0; v < 14; v++) {
    const trill = v % 4 === 3, list = trill ? tb : cb, buf = list[Math.floor(Math.random() * list.length)];
    const dist = rnd(0.2, 1), g = (0.3 + 0.7 * (1 - dist)) * rnd(0.6, 1), pan = rnd(-0.95, 0.95);
    const gl = g * Math.cos((pan + 1) * Math.PI / 4), gr = g * Math.sin((pan + 1) * Math.PI / 4);
    const k = Math.exp(-2 * Math.PI * (2200 + 3800 * (1 - dist)) / sr), rate = rnd(0.94, 1.06), per = trill ? rnd(3, 6) : rnd(0.7, 1.4);
    for (let t = rnd(0, per); t < 8; t += per * rnd(0.9, 1.1)) if (Math.random() > 0.08) add(buf, Math.floor(t * sr), rate, gl, gr, k);
  }
  let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(Lc[i]), Math.abs(Rc[i]));
  const s = pk > 0 ? 0.9 / pk : 1; for (let i = 0; i < len; i++) { Lc[i] *= s; Rc[i] *= s; }
  chorusKey = cb[0]; return chorus = out;
}

/* ── 위치 음원 ── */
/* 모닥불: 연속층은 아주 작게(파도·바람과 헷갈리지 않게 — 낮은 웅웅거림은 예전의 1/5, 1.4kHz 쉭은 제거),
   대신 '타닥'이 불의 크기를 따라 촘촘해진다. 4번에 1번은 바로 뒤에 한 번 더 겹친다 */
function makeFireSrc() {
  const pan = panner(0.3, 0.6, -1.4, 1.6, 45, 1.1), g = gainN(0), t = []; g.connect(pan);
  const rum = noise('brown', true), rl = filt('lowpass', 120), rg = gainN(0.04); chain(rum, rl, rg, g); rum.start(0, off());
  const fl = noise('pink', true), ff = filt('bandpass', 380, 0.8), fg = gainN(0.005); chain(fl, ff, fg, g); fl.start(0, off());   // 불꽃이 빠르게 펄럭이는 숨결
  const src = { pan, gain: g, t, nodes: [rum, rl, rg, fl, ff, fg, ...lfo(6.1, 0.003, fg.gain), ...lfo(3.7, 0.002, fg.gain), g, pan] };
  fire = src;
  /* 타닥: 소리를 내는 순간 화면에도 알린다 → main.js 가 불빛을 번쩍이고, 큰 탁이면 불티를 솟게 한다 */
  const pop = big => {
    const now = AC.currentTime, W = ctx.W;
    W.firePop = Math.max(W.firePop || 0, big ? 1 : rnd(0.12, 0.3)); if (big) W.fireBurst = true;
    if (big) playBank('firePop', g, FOLEY_GAIN.firePop * rnd(0.8, 1), rnd(0.85, 1.1), now);
    else {
      playBank('crackle', g, FOLEY_GAIN.crackle * rnd(0.35, 1), rnd(0.8, 1.3), now);
      if (Math.random() < 0.25) playBank('crackle', g, FOLEY_GAIN.crackle * rnd(0.25, 0.7), rnd(0.8, 1.3), now + rnd(0.03, 0.12));
    }
  };
  const loop = () => { if (fire !== src) return; const k = ctx.W.fireK || 0; if (ctx.W.fireLit) pop(Math.random() < 0.06); sched(t, loop, rnd(70, 420) / (0.5 + 0.5 * k)); }; loop();
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

/* ── 스파클라: 부드러운 치익 + 잔 크랙 ── */
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
/* 가까운 귀뚜라미 한 마리: 캠프 주변 풀숲(4~9m)에 자리를 잡고, 자기 음색·주기로 운다.
   플레이어가 3m 안으로 다가오면 6~12초 동안 울음을 멈춘다 */
function cricketNear(nodes, timers) {
  const a = rnd(0, 6.283), r = rnd(4, 9), x = Math.cos(a) * r, z = 0.3 + Math.sin(a) * r;
  const p = panner(x, 0.15, z, 1.5, 40, 1.0), lp = filt('lowpass', 7500); lp.connect(p); nodes.push(lp, p);
  const trill = Math.random() < 0.3, key = trill ? 'cricketTrill' : 'cricketChirp', voice = Math.floor(Math.random() * 8);
  const rate = rnd(0.94, 1.06), per = trill ? rnd(3, 6) : rnd(0.75, 1.3), gain = FOLEY_GAIN[key] * rnd(0.8, 1.1);
  let hush = 0;
  const sing = () => {
    const now = AC.currentTime, cam = ctx.camera.position;
    if (Math.hypot(cam.x - x, cam.z - z) < 3) hush = now + rnd(6, 12);
    if (now >= hush) { const list = getBank(key); playBuf(list[voice % list.length], lp, gain, rate, now); }
    sched(timers, sing, (Math.random() < 0.1 ? rnd(3, 8) : per * rnd(0.92, 1.08)) * 1000);
  };
  sched(timers, sing, rnd(300, 3000));
}
/* 바람 베드의 크기·음색과 잎 스침은 updateAudio 가 W.wind 를 따라 움직인다 (예전의 고정 LFO 대신).
   베드는 bedBus 로 나간다 — 한 모금 하는 동안 이 버스만 살짝 물러난다 */
function makeBed(type, timeKey) {
  const out = gainN(0.0001), nodes = [out], timers = []; out.connect(bedBus);
  const bed = { out, nodes, timers, type, timeKey, wind: null, leaves: null };
  const wind = (f, g0, l1) => { const s = noise('brown', true), f1 = filt('lowpass', f), g = gainN(g0); chain(s, f1, g, out); s.start(0, off()); const [a, ag] = lfo(0.045, l1, f1.frequency); nodes.push(s, f1, g, a, ag); return { g, f: f1, g0, f0: f }; };
  if (type === 'wind') bed.wind = wind(380, 0.16, 220);
  else if (type === 'waves') bed.wind = wind(280, 0.035, 60);
  else {
    bed.wind = wind(340, 0.045, 90);
    const lv = noise('pink', true), lf = filt('bandpass', 3000, 0.7), lg = gainN(0.006); chain(lv, lf, lg, out); lv.start(0, off()); nodes.push(lv, lf, lg); bed.leaves = lg.gain;
    if (timeKey === 'night') {
      /* 귀뚜라미: 먼 합창 루프 + 가까운 개체 3마리 (예전의 계속 도는 사인파 오실레이터 10개 대신) */
      const cs = AC.createBufferSource(), cg = gainN(0.012); cs.buffer = getChorus(); cs.loop = true; chain(cs, cg, out); cs.start(0, rnd(0, 7.9)); nodes.push(cs, cg);
      for (let i = 0; i < 3; i++) cricketNear(nodes, timers);
    }
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
export function stopAmbience() { clearTimeout(evTimer); killBed(bed); bed = null; killSpatial(); setSparkler(false); setSipFocus(false); }

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
  if (type === 'wind') { /* 텐트 천 펄럭임 */ const p = panner(-1.6, 1.0, 1.2, 1.5, 20, 1.2), fl = noise('white'), ff = filt('lowpass', 700), fg = gainN(0); fg.gain.setValueAtTime(0, t + 0.6); fg.gain.linearRampToValueAtTime(0.04 * k, t + 1.8); fg.gain.linearRampToValueAtTime(0, t + 4.0); const [lo, lg2] = lfo(rnd(6, 9), 0.02 * k, fg.gain); chain(fl, ff, fg, p); fl.start(t, off()); fl.stop(t + 4.2); setTimeout(() => kill([lo, lg2, p]), 4500); }
  setTimeout(() => kill([pan]), 4800);
}
function foghorn() { const t = AC.currentTime, p = panner(-160, 15, -70, 60, 800, 0.6), lp = filt('lowpass', 500); lp.connect(p); const o = osc('sine', 95), o2 = osc('sine', 190), g2 = gainN(0.25), g = gainN(0); o.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp); env(g, t, 0.6, 0.06, 2.6); o.start(t); o2.start(t); o.stop(t + 3.4); o2.stop(t + 3.4); setTimeout(() => kill([lp, p]), 4000); }
function snowSlide() { const t = AC.currentTime, out = farSrc(rnd(40, 120), 1.5, 20); burst(out, false, 'lowpass', 900, 1, 0.25, 0.14, 0.8, t, 300, 0.9); }
function creak() { const t = AC.currentTime, pan = spanner(rnd(-0.4, 0.4)); burst(pan, false, 'lowpass', 350, 1, 0.08, 0.035, 0.3, t); tone(pan, 95, 70, 0.08, 0.02, 0.3, t); setTimeout(() => kill([pan]), 1000); }
function ropeCreak() { const t = AC.currentTime, p = panner(5.2, 0.4, -18.6, 1, 12, 1.5); tone(p, rnd(150, 200), rnd(110, 140), 0.12, 0.025, 0.35, t); burst(p, 'brown', 'lowpass', 600, 1, 0.1, 0.03, 0.4, t); setTimeout(() => kill([p]), 1200); }

/* ── 매 프레임: 리스너, 불·랜턴 게인, 물 위치, 바람, 새떼 ── */
const GUST_K = { waves: 0.35, forest: 0.3, wind: 0.7 };
export function updateAudio(dt) {
  if (!AC || !ctx.camera) return; const cam = ctx.camera, L = AC.listener, W = ctx.W, t = AC.currentTime;
  cam.getWorldDirection(_f); _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
  if (L.positionX) { L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z; L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z; L.upX.value = _u.x; L.upY.value = _u.y; L.upZ.value = _u.z; }
  else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
  /* 불소리는 화면의 불꽃 크기(fireK)를 그대로 따라 커지고 작아진다 */
  if (fire) fire.gain.gain.setTargetAtTime((W.fireK || 0) * 0.85, t, 0.1);
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

/* ── 발소리 ──
   모래·흙(숲) 바닥: 폴리 뱅크에서 변형을 골라 재생 (게임 발소리 방식)
   눈·나무·젖은 바닥: 기존 합성 그대로
   위스키를 들었으면 가끔 얼음이 잔에 부딪힌다 */
let stepIdx = 0;
function footstep(surface) {
  const t0 = AC.currentTime + rnd(0, 0.012), side = (stepIdx++ % 2) ? 0.12 : -0.12, v = rnd(0.72, 0.98);
  if (surface === 'sand' || surface === 'grass') {
    const leaves = surface === 'grass' && ctx.W.cfg && ctx.W.cfg.leafs;
    const key = surface === 'sand' ? 'sand' : leaves ? 'dirtLeaf' : 'dirt', gk = surface === 'sand' ? 'sand' : 'dirt';
    playBank(key, sfxBus, FOLEY_GAIN[gk] * rnd(0.82, 1), rnd(0.93, 1.07), t0, side * 0.8);
    /* 숲 바닥: 가끔 잔가지가 '딱' */
    if (surface === 'grass' && Math.random() < 0.05) { const tc = t0 + rnd(0.02, 0.08); burst(sfxBus, 'white', 'bandpass', rnd(2000, 3200), 3, 0.001, 0.035 * v, 0.02, tc); burst(sfxBus, 'white', 'bandpass', rnd(1200, 1800), 4, 0.001, 0.02 * v, 0.03, tc + rnd(0.015, 0.03)); }
  } else {
    const pan = AC.createStereoPanner(); pan.pan.value = side; pan.connect(sfxBus); setTimeout(() => { try { pan.disconnect(); } catch (e) {} }, 1500);
    const grains = (n, span, kind, type, f0, q, peak, d, t, f1) => { for (let i = 0; i < n; i++) { const k = rnd(0.45, 1); burst(pan, kind, type, f0 * rnd(0.8, 1.25), q, 0.002, peak * k * v, d * rnd(0.7, 1.3), t + Math.random() * span, f1 ? f1 * rnd(0.8, 1.2) : undefined, d); } };
    if (surface === 'snow') {
      tone(pan, 65, 45, 0.004, 0.11 * v, 0.08, t0); burst(pan, true, 'lowpass', 220, 1, 0.005, 0.06 * v, 0.15, t0);
      grains(14, 0.12, false, 'highpass', 2400, 1, 0.04, 0.02, t0); burst(pan, false, 'bandpass', 3000, 8, 0.02, 0.02 * v, 0.13, t0 + 0.02, 2200); grains(8, 0.08, false, 'highpass', 2800, 1, 0.025, 0.018, t0 + 0.11);
    } else if (surface === 'wood') {
      tone(pan, 110, 75, 0.004, 0.16 * v, 0.16, t0); burst(pan, false, 'bandpass', 240, 6, 0.003, 0.08 * v, 0.12, t0); tone(pan, 330, 300, 0.004, 0.03 * v, 0.1, t0);
      burst(pan, false, 'lowpass', 1200, 1, 0.002, 0.05 * v, 0.03, t0); tone(pan, 95, 70, 0.004, 0.06 * v, 0.1, t0 + 0.09);
      if (Math.random() < 0.25) { const o = tone(pan, 190, 150, 0.05, 0.02 * v, 0.25, t0 + 0.04); const w = osc('sine', 11), wg = gainN(9); w.connect(wg); wg.connect(o.frequency); w.start(t0); w.stop(t0 + 0.4); }
    } else {
      burst(pan, false, 'bandpass', 2800, 0.8, 0.008, 0.07 * v, 0.14, t0, 1400, 0.14); burst(pan, true, 'lowpass', 350, 1, 0.006, 0.06 * v, 0.1, t0);
      grains(5, 0.25, false, 'bandpass', 4200, 2, 0.02, 0.03, t0 + 0.05); burst(pan, false, 'bandpass', 500, 3, 0.03, 0.03 * v, 0.12, t0 + 0.12, 900, 0.12);
    }
  }
  if (state.item === 'whisky' && Math.random() < 0.15) ice(0.35, t0 + rnd(0.05, 0.15));
}

/* ── 장작 패기 숨소리: 힘을 모을 때 들숨(0.65초), 내려칠 때 날숨.
   들숨이 끝나기 전에 내려치면 날숨과 겹치므로, 들숨 핸들을 잡아 두었다가 날숨이 나가는 순간 15ms 안에 끊는다 ── */
let breath = null;
function stopBreath(t) {
  if (!breath) return; const p = breath.g.gain; breath = null;
  holdParam(p, t); p.setTargetAtTime(0.0001, t, 0.015);
}
function chopBreath(t) {
  stopBreath(t);
  const s = noise('pink'), f = filt('bandpass', 1300, 0.7), g = gainN(0.0001); chain(s, f, g, dryBus);
  f.frequency.setValueAtTime(1300, t); f.frequency.exponentialRampToValueAtTime(1700, t + 0.6);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.01, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
  s.start(t, off()); s.stop(t + 0.7);
  const me = { g }; breath = me;
  s.onended = () => { if (breath === me) breath = null; try { f.disconnect(); g.disconnect(); } catch (e) {} };
}
/* 휘두르는 소리: 도끼는 내려칠수록 빨라지므로(각도가 k² 로 진행) 쉭 소리도 충돌 직전에 가장 크고 높다.
   d = 충돌까지 남은 시간. 꼬리(50ms)는 타격음이 덮는다. 예전 호출(숫자 하나 = 힘)도 받는다 */
function chopWhoosh(arg, t) {
  const o = typeof arg === 'number' ? { p: arg } : (arg || {}), p = o.p || 0, d = Math.max(0.05, o.d || 0.12), pk = 0.05 + 0.06 * p;
  const s = noise('pink'), f = filt('bandpass', 300, 1.1), g = gainN(0.0001); chain(s, f, g, sfxBus);
  f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1400 + 700 * p, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk * 0.08, t + 0.01);
  g.gain.exponentialRampToValueAtTime(pk, t + d * 0.95); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
  s.start(t, off()); s.stop(t + d + 0.08);
  s.onended = () => { try { f.disconnect(); g.disconnect(); } catch (e) {} };
}

/* ── 손·몸 효과음 ── */
/* 얼음: 유리잔에 부딪히는 짧은 비조화 배음. 50~100ms 안에 사라지고, 가끔 두세 번 연달아 부딪힌다
   (예전의 0.3초 사인 두 개는 작은 종처럼 울렸다) */
function ice(k, t) {
  const n = 1 + (Math.random() < 0.55 ? 1 : 0) + (k > 0.8 && Math.random() < 0.5 ? 1 : 0);
  for (let h = 0; h < n; h++) {
    const th = t + h * rnd(0.025, 0.07), f = rnd(1900, 3200), a = 0.035 * k * (h ? rnd(0.35, 0.65) : 1);
    [[1, 1, 0.08], [2.32, 0.45, 0.045], [4.25, 0.2, 0.025]].forEach(([m, g, dd]) => tone(sfxBus, f * m, 0, 0.001, a * g, dd * rnd(0.8, 1.2), th));
    burst(sfxBus, false, 'bandpass', Math.min(f * 1.6, 9000), 1.2, 0.0005, a * 0.5, 0.012, th);
  }
}
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
    /* 마시기: 넘기는 '꿀꺽' 하나만. 커피는 높고 가볍게, 위스키는 낮고 묵직하게 (main.js 가 타이밍을 정한다).
       'sipStart'·'sip'·'sipEnd' 는 예전 호출이 남아 있어도 조용히 넘어가도록 받아 둔다 */
    case 'sipStart': case 'sip': case 'sipEnd': return;
    case 'swallow': case 'gulp': {
      const key = arg === 'whisky' ? 'gulpWhisky' : 'gulpCoffee';
      playBank(key, dryBus, FOLEY_GAIN[key] * rnd(0.85, 1), rnd(0.96, 1.04), t);
      return;
    }
    case 'clink': ice(typeof arg === 'number' ? arg : 1, t); return;
    case 'inhale': burst(B, false, 'highpass', 1200 * pv, 1, 0.35, 0.035, 0.25, t, 2500, 0.6); return;
    case 'exhale': burst(B, false, 'bandpass', 900 * pv, 0.6, 0.06, 0.035, 0.7, t, 450, 0.7); return;
    case 'lighter': burst(B, false, 'highpass', 3000 * pv, 1, 0.003, 0.1, 0.14, t); return;
    /* 장작 패기 */
    case 'chop': { const o = arg || {}, key = o.knot ? 'chopKnot' : o.fin ? 'chopSplit' : 'chopHit', p = o.power || 0;
      playBank(key, sfxBus, FOLEY_GAIN[key] * (0.8 + 0.35 * p) * rnd(0.9, 1), rnd(0.95, 1.04) * (o.perfect ? 0.92 : 1), t, 0); return; }
    case 'chopWhoosh': chopWhoosh(arg, t); return;
    case 'chopRaise': burst(B, 'pink', 'lowpass', 600, 1, 0.08, 0.016, 0.22, t); burst(B, 'pink', 'bandpass', 2200, 1, 0.05, 0.006, 0.15, t + 0.05); return;
    case 'chopBreath': chopBreath(t); return;
    case 'chopExhale': stopBreath(t); burst(dryBus, 'pink', 'bandpass', 850, 0.6, 0.015, 0.012 + 0.012 * (arg || 0), 0.22, t + 0.05, 500, 0.22); return;
    case 'chopReady': burst(B, 'pink', 'bandpass', rnd(760, 880), 7, 0.01, 0.025, 0.09, t, 640, 0.09); return;
    case 'chopPull': burst(B, 'pink', 'bandpass', 650, 2.2, 0.03, 0.06, 0.14, t, 480, 0.14); burst(B, 'brown', 'lowpass', 320, 1, 0.01, 0.05, 0.08, t + 0.1); return;
    case 'chopPick': burst(B, 'pink', 'bandpass', 620, 2, 0.03, 0.05, 0.14, t, 460, 0.14); burst(B, 'brown', 'lowpass', 300, 1, 0.01, 0.04, 0.08, t + 0.1); fabric(B, t + 0.15, 0.03, 0.25); return;
    case 'chopPut': playBank('logPlace', sfxBus, 0.16, rnd(1.15, 1.3), t, 0); fabric(B, t + 0.05, 0.03, 0.25); return;
    case 'stumpBite': playBank('logPlace', sfxBus, 0.12, rnd(1.2, 1.35), t, 0); return;
    case 'logLift': playBank('woodLand', sfxBus, 0.05, rnd(0.8, 0.9), t, -0.3); burst(B, 'pink', 'bandpass', 1800, 0.8, 0.02, 0.01, 0.12, t); return;
    case 'logPlace': playBank('logPlace', sfxBus, FOLEY_GAIN.logPlace * rnd(0.85, 1), rnd(0.95, 1.05), t, 0); return;
    case 'woodLand': { const o = arg || {}; playBank('woodLand', sfxBus, FOLEY_GAIN.woodLand * (o.k || 1) * rnd(0.8, 1), rnd(0.9, 1.1), t + rnd(0, 0.02), o.pan || 0); return; }
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