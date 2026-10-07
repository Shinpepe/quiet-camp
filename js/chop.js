import * as THREE from 'three';
import { ctx, state } from './state.js';
import { CHOP, CHOP_GAUGE, EYE } from './data.js';
import { rnd, smooth, smoothM, shadowed, wrapPI } from './util.js';
import { terrainH } from './terrain.js';
import { tex } from './textures.js';
import { sfx } from './audio.js';
import { makeAxe, AXE_EDGE } from './props.js';
import { makeGauge, gaugeUpdate, gaugeJudge, gaugeShow, gaugeHide, banner } from './gauge.js';

/* ══ 장작 패기 ══
   타이밍 게이지: 누른 순간 삼각형이 초록(성공)·금색(대성공) 구간에 있어야 한다.
   성공 CHOP_GAUGE.hits(3)번이면 쪼개지고, 대성공은 한 번에 쪼개진다. 실패는 몇 번을 해도 쪼개지지 않는다 (벌점 없음).
   대성공이 이어지면 "대성공 n연속". 장작 크기는 하나로 고정.
   손맛(히트 스톱·흔들림·시선 반동·시야 펀치·나무 조각·소리)은 그대로.
   모든 메시는 그루터기에 붙은 rig 좌표계 안에 있다: 원점 = 그루터기 바닥 중심, +z = 플레이어가 서는 쪽.
   rig 는 시작할 때마다 플레이어가 다가온 방향으로 돈다 */

const V = THREE.Vector3;
const lerp = (a, b, t) => a + (b - a) * t;
const eio = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const eout = t => 1 - (1 - t) * (1 - t);
const _UP = new V(0, 1, 0);

/* 치수 (props.js 의 그루터기와 맞춘다) */
const STUMP_TOP = 0.32, STUMP_R = 0.19, LOG_H = 0.36, LOG_R = 0.12, LOG_TOP = STUMP_TOP + LOG_H, LOG_CY = STUMP_TOP + LOG_H / 2;

/* 도끼 각도(rad): 손(피벗)을 축으로 x 회전. 클수록 머리가 위로. 기다릴 때는 살짝 든 자세(A_READY) */
const A_READY = 0.5, A_UP = 1.75, A_HIT = -0.25, A_EMB = A_HIT - 0.045;
const EDGE_Y = AXE_EDGE.y, EDGE_Z = AXE_EDGE.z;
const edgeAt = a => ({ y: EDGE_Y * Math.cos(a) - EDGE_Z * Math.sin(a), z: EDGE_Y * Math.sin(a) + EDGE_Z * Math.cos(a) });
const E0 = edgeAt(A_HIT);
const PIVOT = new V(0, LOG_TOP - E0.y, -E0.z);
const FOLLOW_D = new V(0, -0.05, -0.08);
let A_FOLLOW = A_HIT - 0.4;
for (let a = A_HIT; a > -1.4; a -= 0.005) if (PIVOT.y + FOLLOW_D.y + edgeAt(a).y <= STUMP_TOP + 0.012) { A_FOLLOW = a; break; }

/* 시간(초): 누르면 번쩍 들었다(T_RAISE) 내려친다(T_STRIKE). 판정은 누른 순간에 이미 끝나 있다 */
const T_RAISE = 0.12, T_STRIKE = 0.09;

/* game.js 가 연결한다: 그만두기 완료, 안내 문구, HUD 갱신 */
export const chopHooks = { stop: null, toast: null, hud: null };

const C = {
  on: false, st: 'off', a: A_READY, t: 0, from: A_READY, pk: 0, pkFrom: 0, stop: 0, wantStop: false,
  G: null, res: null, hits: 0, combo: 0, best: 0, log: null, nextLogT: 0,
  eye: new V(), fwd: new V(), right: new V(), clock: 0, trauma: 0, kick: 0, kickV: 0, fov: 0,
};
const P = { x: 0, z: 0, yaw: 0 };
let R = null;
const _w = new V(), _d = new THREE.Object3D();

function dust(x, y, z, n, op) {
  const W = ctx.W; if (!W.smoke) return;
  for (let i = 0; i < n; i++) { R.rig.localToWorld(_w.set(x + rnd(-0.06, 0.06), y, z + rnd(-0.06, 0.06))); W.smoke.spawn(_w, { x: rnd(-0.15, 0.15), y: rnd(0.1, 0.3), z: rnd(-0.15, 0.15) }, 0.05, rnd(1, 1.6), 0.1, 0.04, 0.3, op); }
}
function setPile() { R.pile.set(CHOP.pile[0] - CHOP.stump[0], 0, CHOP.pile[1] - CHOP.stump[1]).applyAxisAngle(_UP, -R.rig.rotation.y); }

/* ── 장작 윗면의 금: 도끼날 방향(rig z)을 따라 들쭉날쭉하게 갈라진다 ──
   장작마다 시드로 갈라짐 경로가 정해지고, 성공 단계에 따라 보이는 길이·폭이 늘어난다.
   1단계: 가운데만 짧게 / 2단계: 양끝까지 벌어지고 곁금이 생기며 옆면으로도 갈라져 내려간다.
   어두운 틈 둘레에 밝은 생나무 테두리를 깔아 실제로 벌어진 것처럼 보이게 한다 */
function crackPath(seed) {
  let s = Math.floor(seed * 2147483646) + 1; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pts = [], N = 28; let x = (r() - 0.5) * 0.01, dx = 0;
  for (let i = 0; i <= N; i++) { const t = i / N; dx = dx * 0.55 + (r() - 0.5) * 0.007; x += dx; x = Math.max(-0.035, Math.min(0.035, x)); pts.push([x + (r() - 0.5) * 0.002, -LOG_R * 0.985 + 2 * LOG_R * 0.985 * t, t, r()]); }
  return { pts, branchT: 0.28 + r() * 0.12, branchA: (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.3), depth: [0.1 + r() * 0.04, 0.1 + r() * 0.04], r };
}
function ribbonTop(B, pts, a, b, w, y) {
  const sel = pts.filter(p => p[2] >= a - 1e-6 && p[2] <= b + 1e-6), n = sel.length; if (n < 2) return;
  const o = B.p.length / 3, openA = a < 0.02, openB = b > 0.98;
  for (let i = 0; i < n; i++) {
    const [x, z, t, j] = sel[i], p0 = sel[Math.max(0, i - 1)], p1 = sel[Math.min(n - 1, i + 1)];
    const tx = p1[0] - p0[0], tz = p1[1] - p0[1], L = Math.hypot(tx, tz) || 1, px = tz / L, pz = -tx / L;
    const u = (t - a) / Math.max(1e-6, b - a), taper = (openA ? 1 : smooth(0, 0.18, u)) * (openB ? 1 : 1 - smooth(0.82, 1, u));
    const ww = w * Math.max(0.12, taper) * (0.75 + 0.5 * j);
    B.p.push(x + px * ww, y, z + pz * ww, x - px * ww, y, z - pz * ww); B.n.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < n - 1; i++) { const k = o + i * 2; B.i.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
}
function ribbonSide(B, x0, sign, depth, w, y0, r) {
  const o = B.p.length / 3, N = 8, z = sign * (LOG_R + 0.0015); let x = x0;
  for (let i = 0; i <= N; i++) { const t = i / N, ww = w * (1 - t * 0.9); x += (r() - 0.5) * 0.006; B.p.push(x - ww, y0 - depth * t, z, x + ww, y0 - depth * t, z); B.n.push(0, 0, sign, 0, 0, sign); }
  for (let i = 0; i < N; i++) { const k = o + i * 2; if (sign > 0) B.i.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); else B.i.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
}
function geoFrom(B) { const g = new THREE.BufferGeometry(); g.setIndex(B.i); g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3)); return g; }
function setCrack(stage) {
  const L = C.log; if (!L || !R) return;
  const D = { p: [], n: [], i: [] }, Lt = { p: [], n: [], i: [] }, top = LOG_H / 2;
  if (stage >= 1) {
    const cp = L.crack, full = stage >= 2, a = full ? 0 : 0.32, b = full ? 1 : 0.68, w = full ? 0.0058 : 0.0026;
    ribbonTop(Lt, cp.pts, a, b, w * 2.6, top + 0.001); ribbonTop(D, cp.pts, a, b, w, top + 0.0016);
    if (full) {
      const bi = Math.round(cp.branchT * (cp.pts.length - 1)), bp = cp.pts[bi], br = [];
      for (let k = 0; k <= 5; k++) { const t = k / 5; br.push([bp[0] + Math.sin(cp.branchA) * 0.045 * t + (cp.r() - 0.5) * 0.002, bp[1] + Math.cos(cp.branchA) * 0.02 * t, t, cp.r()]); }
      ribbonTop(Lt, br, 0, 1, 0.0045, top + 0.001); ribbonTop(D, br, 0, 1, 0.0018, top + 0.0016);
      const e0 = cp.pts[0], e1 = cp.pts[cp.pts.length - 1];
      ribbonSide(Lt, e0[0], -1, cp.depth[0], 0.009, top, cp.r); ribbonSide(D, e0[0], -1, cp.depth[0] * 0.95, 0.0045, top, cp.r);
      ribbonSide(Lt, e1[0], 1, cp.depth[1], 0.009, top, cp.r); ribbonSide(D, e1[0], 1, cp.depth[1] * 0.95, 0.0045, top, cp.r);
    }
  }
  R.crackD.geometry.dispose(); R.crackD.geometry = geoFrom(D); R.crackL.geometry.dispose(); R.crackL.geometry = geoFrom(Lt);
  R.crackD.visible = R.crackL.visible = stage >= 1;
}

/* ── 씬마다 한 번: 도끼·장작·금·반쪽·조각을 만들어 숨겨 둔다 (사전 컴파일에 함께 들어간다) ── */
export function buildChop() {
  const W = ctx.W, scene = ctx.scene; W.splitCount = 0;
  Object.assign(C, { on: false, st: 'off', a: A_READY, pk: 0, stop: 0, wantStop: false, log: null, trauma: 0, kick: 0, kickV: 0, fov: 0, hits: 0, combo: 0 });
  C.G = makeGauge(CHOP_GAUGE.speed, CHOP_GAUGE.ok, CHOP_GAUGE.great);
  P.yaw = 0;

  const rig = new THREE.Group(); rig.position.set(CHOP.stump[0], 0, CHOP.stump[1]); scene.add(rig);
  const work = new THREE.Group(); work.visible = false; rig.add(work);

  const bark = smoothM(0x5a3d28, Object.assign({ roughness: 0.95 }, tex('bark', 1, 1, 0.5)));
  const endM = smoothM(0xc9a97c, Object.assign({ roughness: 0.85 }, tex('wood', 1, 1, 0.3)));
  const faceM = smoothM(0xd6b68a, Object.assign({ roughness: 0.8, side: THREE.DoubleSide }, tex('wood', 1, 2, 0.35)));
  const crackDM = smoothM(0x1a120b, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const crackLM = smoothM(0xc49a64, { roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  const axe = makeAxe(); axe.position.copy(PIVOT); axe.rotation.x = A_READY; work.add(axe);

  const logG = new THREE.Group(); logG.visible = false; work.add(logG);
  const logM = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.03, 1, 26), [bark, endM, endM]); logG.add(logM);
  const crackG = new THREE.Group(); logG.add(crackG);
  const crackL = new THREE.Mesh(new THREE.BufferGeometry(), crackLM), crackD = new THREE.Mesh(new THREE.BufferGeometry(), crackDM);
  crackL.visible = crackD.visible = false; crackL.castShadow = crackD.castShadow = false; crackG.add(crackL, crackD);

  const halfGeo = [new THREE.CylinderGeometry(1, 1.03, 1, 12, 1, false, 0, Math.PI), new THREE.CylinderGeometry(1, 1.03, 1, 12, 1, false, Math.PI, Math.PI)];
  const faceGeo = new THREE.PlaneGeometry(2, 1), halves = [];
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.visible = false;
    const cyl = halfGeo.map(geo => { const m = new THREE.Mesh(geo, [bark, endM, endM]); m.scale.set(LOG_R, LOG_H, LOG_R); g.add(m); return m; });
    const face = new THREE.Mesh(faceGeo, faceM); face.scale.set(LOG_R, LOG_H, 1); g.add(face); rig.add(g);
    halves.push({ g, cyl, face, free: true, side: 1, age: 0, d: 0, dz: 0, yaw: 0, T: 0.45, landed: false });
  }

  const NCH = 80, chipMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), endM, NCH);
  chipMesh.frustumCulled = false; const zero = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < NCH; i++) chipMesh.setMatrixAt(i, zero); rig.add(chipMesh);
  const chips = Array.from({ length: NCH }, () => ({ p: new V(), v: new V(), r: new THREE.Euler(), w: new V(), s: new V(), l: 0, m: 0, rest: false, live: false }));

  shadowed(rig); crackL.castShadow = crackD.castShadow = false;
  rig.updateMatrixWorld(true);
  R = { rig, work, axe, logG, logM, crackG, crackL, crackD, halves, chipMesh, chips, chipI: 0, chipLive: false, pile: new V() };
  setPile(); gaugeHide();
}

function clearDebris() {
  R.halves.forEach(h => { h.free = true; h.g.visible = false; });
  for (let i = 0; i < R.chips.length; i++) { R.chips[i].live = false; _d.position.set(0, -5, 0); _d.scale.set(0, 0, 0); _d.updateMatrix(); R.chipMesh.setMatrixAt(i, _d.matrix); }
  R.chipMesh.instanceMatrix.needsUpdate = true; R.chipLive = false;
}
function placeFor(px, pz, free) {
  const sx = CHOP.stump[0], sz = CHOP.stump[1], a0 = Math.atan2(px - sx, pz - sz);
  for (let k = 0; k <= 32; k++) {
    const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2;
    const x = sx + Math.sin(a) * CHOP.dist, z = sz + Math.cos(a) * CHOP.dist;
    if (!free || free(x, z)) return { x, z, yaw: wrapPI(a) };
  }
  return null;
}

/* ── 시작·그만두기·입력 ── */
export function chopEye() { return C.eye; }
export function chopYaw() { return P.yaw; }
export function startChop(px, pz, free) {
  if (!R || C.on) return false;
  const p = placeFor(px, pz, free); if (!p) return false;
  const W = ctx.W;
  if (Math.abs(wrapPI(p.yaw - R.rig.rotation.y)) > 0.01) { clearDebris(); R.rig.rotation.y = p.yaw; R.rig.updateMatrixWorld(true); setPile(); }
  P.x = p.x; P.z = p.z; P.yaw = p.yaw;
  C.eye.set(p.x, terrainH(p.x, p.z, W.cfg) + EYE, p.z);
  C.fwd.set(CHOP.stump[0] - p.x, 0, CHOP.stump[1] - p.z).normalize(); C.right.set(-C.fwd.z, 0, C.fwd.x);
  Object.assign(C, { on: true, st: 'ready', a: A_READY, pk: 0, wantStop: false, nextLogT: 1.0, log: null, hits: 0, combo: 0 });
  R.work.visible = true; R.logG.visible = false;
  if (W.stumpAxe) W.stumpAxe.visible = false;
  sfx('chopPick');
  return true;
}
/* 클릭·스페이스: 장작이 놓여 있고 도끼가 준비 자세일 때만 판정한다 */
export function chopPress() {
  if (!C.on || C.st !== 'ready' || !C.log || !C.log.landed) return;
  const r = gaugeJudge(C.G); if (!r) return;
  C.res = r; C.st = 'raise'; C.t = 0; C.from = C.a;
  sfx('chopWhoosh', { p: r === 'great' ? 1 : r === 'ok' ? 0.5 : 0.2, d: T_STRIKE + T_RAISE * 0.5 });
}
export function requestChopStop() { if (!C.on) return; if (C.st === 'ready') finishStop(); else C.wantStop = true; }
function finishStop() { resetChop(); sfx('chopPut'); if (chopHooks.stop) chopHooks.stop(); }
export function resetChop() {
  if (!R) return;
  Object.assign(C, { on: false, st: 'off', wantStop: false, log: null, hits: 0, combo: 0 });
  R.work.visible = false; R.logG.visible = false;
  if (ctx.W.stumpAxe) ctx.W.stumpAxe.visible = true;
  gaugeHide();
}
export function chopStats() { return { count: ctx.W.splitCount || 0, best: C.best }; }

/* ── 매 프레임 ── */
export function updateChop(dt) {
  if (!R) return;
  C.clock += dt;
  if (C.on) { gaugeUpdate(C.G, dt); gaugeShow(C.G); }
  if (C.stop > 0) { C.stop -= dt; return; }
  updLog(dt); updAxe(dt); updHalves(dt); updChips(dt);
}

function updAxe(dt) {
  if (!C.on) return;
  let a = C.a;
  switch (C.st) {
    case 'raise':
      C.t += dt / T_RAISE; a = lerp(C.from, A_UP, eio(Math.min(1, C.t)));
      if (C.t >= 1) { C.st = 'strike'; C.t = 0; C.from = a; }
      break;
    case 'strike': {
      C.t += dt / T_STRIKE; const k = Math.min(1, C.t); a = lerp(C.from, A_HIT, k * k);
      if (C.t >= 1) { C.a = A_HIT; impact(); a = A_HIT; }
      break;
    }
    case 'embed':
      C.t += dt / 0.3; a = A_EMB + Math.sin(C.t * 40) * 0.006 * Math.max(0, 1 - C.t);
      if (C.t >= 1) { C.st = 'recover'; C.t = 0; C.from = a; C.pkFrom = C.pk; sfx('chopPull'); C.kickV += 0.2; }
      break;
    case 'bounce':
      C.t += dt / 0.2; a = A_HIT + 0.35 * Math.sin(Math.min(1, C.t) * Math.PI / 2);
      if (C.t >= 1) { C.st = 'recover'; C.t = 0; C.from = a; C.pkFrom = C.pk; }
      break;
    case 'follow': {
      C.t += dt / 0.13; const k = eout(Math.min(1, C.t)); a = lerp(A_HIT, A_FOLLOW, k); C.pk = k;
      if (C.t >= 1) { C.st = 'rest'; C.t = 0; sfx('stumpBite'); C.kickV -= 0.15; }
      break;
    }
    case 'rest':
      C.t += dt / 0.22; a = A_FOLLOW;
      if (C.t >= 1) { C.st = 'recover'; C.t = 0; C.from = a; C.pkFrom = C.pk; }
      break;
    case 'recover': {
      C.t += dt / 0.45; const k = eio(Math.min(1, C.t)); a = lerp(C.from, A_READY, k); C.pk = C.pkFrom * (1 - k);
      if (C.t >= 1) C.st = 'ready';
      break;
    }
    default: /* ready: 숨 쉬듯 아주 조금 */
      a = A_READY + Math.sin(C.clock * 1.3) * 0.012;
      if (C.wantStop) { C.a = a; finishStop(); return; }
  }
  C.a = a; R.axe.rotation.x = a;
  R.axe.position.copy(PIVOT).addScaledVector(FOLLOW_D, C.pk);
}

function impact() {
  const L = C.log, r = C.res; C.t = 0;
  if (!L || !L.landed) { C.st = 'recover'; C.from = C.a; C.pkFrom = C.pk; return; }
  if (r === 'fail') {
    /* 실패: 도끼가 튕겨 나오고 장작이 흔들리기만 한다 */
    C.combo = 0; C.st = 'bounce'; L.sqV -= 0.8; L.wob = 1;
    C.trauma = Math.min(1, C.trauma + 0.18); C.kickV += 0.35;
    spawnChips(2, 0.5); sfx('chop', { knot: true, power: 0 }); return;
  }
  const great = r === 'great';
  C.stop = great ? 0.09 : 0.055; C.trauma = Math.min(1, C.trauma + (great ? 0.5 : 0.28));
  C.kickV -= great ? 0.7 : 0.45; C.fov = great ? -2.4 : -1.1; L.sqV -= great ? 3 : 2;
  if (great) {
    C.combo++; C.best = Math.max(C.best, C.combo);
    if (C.combo >= 2) banner(`대성공 ${C.combo}연속`, 1.5);
    if (navigator.vibrate) navigator.vibrate(30);
    split(1.3); return;
  }
  C.combo = 0; C.hits++;
  if (C.hits >= CHOP_GAUGE.hits) { split(1); return; }
  spawnChips(5, 0.6); dust(0, LOG_TOP, 0, 1, 0.07);
  sfx('chop', { power: 0.35 }); setCrack(C.hits); C.st = 'embed';
}
function split(fly) {
  sfx('chop', { fin: true, perfect: fly > 1, power: fly > 1 ? 1 : 0.6 });
  spawnChips(fly > 1 ? 22 : 12, fly > 1 ? 1.15 : 0.85); dust(0, LOG_TOP, 0, 3, 0.12);
  C.hits = 0; R.logG.visible = false; R.crackD.visible = R.crackL.visible = false; C.log = null; C.nextLogT = 0.85;
  spawnHalves(fly); C.st = 'follow';
  ctx.W.splitCount++;
  if (chopHooks.hud) chopHooks.hud();
}

/* ── 장작: 장작더미에서 포물선으로 날아와 놓인다. 맞으면 눌렸다 튀어 오른다(스프링) ── */
function newLog() {
  C.log = { t: 0, landed: false, sq: 0, sqV: 0, wob: 0, yaw: rnd(-0.8, 0.8), crack: crackPath(Math.random()) };
  R.logM.rotation.y = rnd(0, 6.28); setCrack(0);
  R.logG.visible = true; sfx('logLift');
}
function updLog(dt) {
  const L = C.log;
  if (!L) { if (C.on && C.nextLogT > 0) { C.nextLogT -= dt; if (C.nextLogT <= 0) newLog(); } return; }
  const g = R.logG;
  if (!L.landed) {
    L.t = Math.min(1, L.t + dt / 0.45); const u = L.t, e = eout(u);
    g.position.set(lerp(R.pile.x, 0, e), lerp(0.28, LOG_CY, u) + 0.42 * Math.sin(Math.PI * u), lerp(R.pile.z, 0, e));
    g.rotation.set(0.15 * (1 - e), L.yaw * (1 - e), (1 - e) * Math.PI / 2);
    if (u >= 1) { L.landed = true; g.position.set(0, LOG_CY, 0); g.rotation.set(0, 0, 0); L.sqV -= 1.4; C.trauma = Math.min(1, C.trauma + 0.07); sfx('logPlace'); dust(0, STUMP_TOP + 0.02, 0, 3, 0.08); }
  }
  for (let i = 0; i < 4; i++) { const h = dt / 4; L.sqV += (-900 * L.sq - 24 * L.sqV) * h; L.sq += L.sqV * h; }
  L.wob *= Math.exp(-dt * 6);
  R.logM.scale.set(LOG_R * (1 - 0.5 * L.sq), LOG_H * (1 + L.sq), LOG_R * (1 - 0.5 * L.sq)); R.logM.position.y = LOG_H * L.sq / 2;
  R.crackG.position.y = LOG_H * L.sq; R.crackG.scale.set(1 - 0.5 * L.sq, 1, 1 - 0.5 * L.sq);
  if (L.landed) g.rotation.z = Math.sin(C.clock * 36) * 0.03 * L.wob;
}

/* ── 쪼개진 반쪽: 좌우로 기울며 떨어져 한 번 튕기고 눕는다. 7초 뒤 가라앉으며 사라진다 ── */
function takeHalf() { return R.halves.find(o => o.free) || R.halves.reduce((a, b) => (b.age > a.age ? b : a)); }
function spawnHalves(fly) {
  [1, -1].forEach(side => {
    const h = takeHalf();
    Object.assign(h, { free: false, side, age: 0, d: rnd(0.4, 0.55) * fly, dz: rnd(-0.12, 0.14), yaw: rnd(-0.4, 0.4), T: rnd(0.4, 0.5) / Math.sqrt(fly), landed: false });
    h.cyl[0].visible = side > 0; h.cyl[1].visible = side < 0;
    h.face.rotation.set(0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    h.g.scale.setScalar(1); h.g.visible = true;
  });
}
function updHalves(dt) {
  for (const h of R.halves) {
    if (h.free) continue;
    h.age += dt; const u = Math.min(1, h.age / h.T), g = h.g;
    const tip = Math.pow(u, 1.7) * Math.PI / 2; let y = lerp(LOG_CY, LOG_R, u * u) + 0.1 * u * (1 - u), ov = 0;
    if (h.age > h.T) {
      const v = Math.min(1, (h.age - h.T) / 0.3); y += 0.03 * Math.sin(Math.PI * v) * (1 - v); ov = 0.08 * Math.sin(Math.PI * v) * (1 - v);
      if (!h.landed) {
        h.landed = true;
        if (ctx.running) { sfx('woodLand', { k: 1, pan: h.side * 0.35 }); C.trauma = Math.min(1, C.trauma + 0.04); }
        dust(h.side * (0.01 + h.d), 0.03, h.dz, 2, 0.08);
      }
    }
    g.position.set(h.side * (0.01 + h.d * eout(u)), y, h.dz * u);
    g.rotation.set(0, h.yaw * u, -h.side * (tip + ov));
    if (h.age > 7) { const k = smooth(7, 8, h.age); g.position.y -= 0.05 * k; g.scale.setScalar(Math.max(0.001, 1 - k)); if (h.age >= 8) { h.free = true; g.visible = false; } }
  }
}

/* ── 나무 조각 ── */
function spawnChips(n, power) {
  for (let i = 0; i < n; i++) {
    const c = R.chips[R.chipI]; R.chipI = (R.chipI + 1) % R.chips.length;
    c.p.set(rnd(-0.03, 0.03), LOG_TOP - 0.02, rnd(-0.05, 0.05)); c.v.set(rnd(-1.4, 1.4) * power, rnd(1, 2.6) * power, rnd(-0.6, 1.4) * power);
    c.w.set(rnd(-15, 15), rnd(-15, 15), rnd(-15, 15)); c.r.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
    const L = rnd(0.015, 0.04); c.s.set(L * rnd(0.3, 0.6), rnd(0.004, 0.008), L); c.l = 0; c.m = rnd(5, 8); c.rest = false; c.live = true;
  }
  R.chipLive = true;
}
function updChips(dt) {
  if (!R.chipLive) return;
  const M = R.chipMesh; let any = false;
  for (let i = 0; i < R.chips.length; i++) {
    const c = R.chips[i]; if (!c.live) continue;
    c.l += dt;
    if (c.l >= c.m) { c.live = false; _d.position.set(0, -5, 0); _d.scale.set(0, 0, 0); _d.updateMatrix(); M.setMatrixAt(i, _d.matrix); continue; }
    any = true;
    if (!c.rest) {
      c.v.y -= 9.8 * dt; c.p.addScaledVector(c.v, dt); c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      const fl = Math.hypot(c.p.x, c.p.z) < STUMP_R ? STUMP_TOP : 0;
      if (c.p.y < fl + 0.003 && c.v.y < 0) {
        c.p.y = fl + 0.003; c.v.y *= -0.25; c.v.x *= 0.45; c.v.z *= 0.45; c.w.multiplyScalar(0.4);
        if (Math.abs(c.v.y) < 0.3) { c.rest = true; c.r.x = rnd(-0.2, 0.2) + (Math.random() < 0.5 ? 0 : Math.PI); c.r.z = rnd(-0.2, 0.2); }
      }
    }
    const k = 1 - smooth(c.m - 1, c.m, c.l);
    _d.position.copy(c.p); _d.rotation.copy(c.r); _d.scale.copy(c.s).multiplyScalar(Math.max(0.001, k)); _d.updateMatrix(); M.setMatrixAt(i, _d.matrix);
  }
  M.instanceMatrix.needsUpdate = true; R.chipLive = any;
}

/* ── 카메라: 흔들림 = trauma² × 여러 주파수 사인 합, 시선 반동 = 감쇠 스프링, 시야 = 맞는 순간 좁아짐 ── */
const nz = (t, s) => Math.sin(t * 43.1 + s * 7.3) * 0.5 + Math.sin(t * 71.7 + s * 3.1) * 0.3 + Math.sin(t * 97.3 + s * 11.9) * 0.2;
export function chopCamera(camera, dt, settled) {
  C.trauma = Math.max(0, C.trauma - dt * 1.7);
  for (let i = 0; i < 3; i++) { const h = dt / 3; C.kickV += (-220 * C.kick - 22 * C.kickV) * h; C.kick += C.kickV * h; }
  C.fov += (0 - C.fov) * Math.min(1, dt * 6);
  if (C.on && settled && state.mode === 'chop') {
    const amp = C.trauma * C.trauma, t = C.clock;
    camera.position.copy(C.eye).addScaledVector(C.fwd, -C.kick * 0.3).addScaledVector(C.right, amp * 0.035 * nz(t, 2));
    camera.position.y += Math.sin(t * 1.1) * 0.004 + C.kick * 0.25 + amp * 0.03 * nz(t, 1);
    camera.rotation.x += C.kick + amp * 0.02 * nz(t, 3);
    camera.rotation.z += amp * 0.03 * nz(t, 4);
  }
  if (ctx.baseFov) { const f = ctx.baseFov + C.fov; if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; camera.updateProjectionMatrix(); } }
}