import * as THREE from 'three';
import { ctx, state } from './state.js';
import { CHOP, EYE } from './data.js';
import { rnd, smooth, smoothM, shadowed } from './util.js';
import { terrainH } from './terrain.js';
import { tex } from './textures.js';
import { sfx } from './audio.js';

/* ══ 장작 패기 ══
   짧게 누르면 기본 내려치기, 길게 누르면 힘을 모은다. 꽉 찬 직후(T_SWEET 안)에 놓으면 '제대로 들어간 한 방'.
   실패나 벌점은 없고, 리듬과 손맛(히트 스톱·흔들림·시선 반동·시야 펀치·나무 조각·소리)에 집중한다.
   모든 메시는 그루터기에 붙은 rig 좌표계 안에 있다: 원점 = 그루터기 바닥 중심, +z = 플레이어가 서는 쪽 */

const V = THREE.Vector3;
const lerp = (a, b, t) => a + (b - a) * t;
const eio = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const eout = t => 1 - (1 - t) * (1 - t);

/* 치수 (props.js 의 그루터기와 맞춘다) */
const STUMP_TOP = 0.32, STUMP_R = 0.19, LOG_H = 0.36, LOG_TOP = STUMP_TOP + LOG_H, LOG_CY = STUMP_TOP + LOG_H / 2;

/* 도끼 각도(rad): 손(피벗)을 축으로 x 회전. 클수록 머리가 위로 */
const A_REST = 0.35, A_UP = 1.75, A_UP_MAX = 2.05, A_HIT = -0.25, A_EMB = A_HIT - 0.045;
/* 날 끝의 피벗 기준 위치. 내려친 각도(A_HIT)에서 날이 장작 윗면 중앙에 정확히 닿도록 피벗을 역산한다 */
const EDGE_Y = -0.125, EDGE_Z = -0.9;
const edgeAt = a => ({ y: EDGE_Y * Math.cos(a) - EDGE_Z * Math.sin(a), z: EDGE_Y * Math.sin(a) + EDGE_Z * Math.cos(a) });
const E0 = edgeAt(A_HIT);
const PIVOT = new V(0, LOG_TOP - E0.y, -E0.z);
/* 쪼갠 뒤 따라 내려갈 때 손이 조금 앞·아래로 → 날이 그루터기 윗면 앞쪽에 박힌다. 그 각도를 미리 계산 */
const FOLLOW_D = new V(0, -0.05, -0.08), CH_D = new V(0, 0.04, 0.05);
let A_FOLLOW = A_HIT - 0.4;
for (let a = A_HIT; a > -1.4; a -= 0.005) if (PIVOT.y + FOLLOW_D.y + edgeAt(a).y <= STUMP_TOP + 0.012) { A_FOLLOW = a; break; }

/* 시간(초) — 손맛 조절은 주로 여기서 */
const T_RAISE = 0.26, T_STRIKE = 0.12, T_CHARGE = 0.7, T_SWEET = 0.32, T_TIRE = 1.4;
/* 내려치기에 걸리는 시간. 힘이 실릴수록 빠르다. 휘두르는 소리도 이 시간에 맞춰 충돌 직전에 정점을 찍는다 */
const strikeDur = () => T_STRIKE * (1 - 0.25 * C.power);

/* game.js 가 연결한다: 그만두기 완료, 안내 문구, HUD 갱신 */
export const chopHooks = { stop: null, toast: null, hud: null };

const C = {
  on: false, st: 'off', a: A_REST, t: 0, from: A_REST, pk: 0, pkFrom: 0, ck: 0, ckFrom: 0, stop: 0,
  hold: false, queued: false, wantStop: false,
  charge: 0, over: 0, ready: false, charged: false, power: 0, dmg: 1, perfect: false,
  log: null, nextLogT: 0, eye: new V(), fwd: new V(), right: new V(), clock: 0, knotTold: false,
  trauma: 0, kick: 0, kickV: 0, fov: 0,
};
let R = null, ring = null;
const _w = new V(), _d = new THREE.Object3D();

function say(msg) { if (chopHooks.toast) chopHooks.toast(msg); }
/* 먼지: 연기 파티클을 옅게 */
function dust(x, y, z, n, op) {
  const W = ctx.W; if (!W.smoke) return;
  for (let i = 0; i < n; i++) { R.rig.localToWorld(_w.set(x + rnd(-0.06, 0.06), y, z + rnd(-0.06, 0.06))); W.smoke.spawn(_w, { x: rnd(-0.15, 0.15), y: rnd(0.1, 0.3), z: rnd(-0.15, 0.15) }, 0.05, rnd(1, 1.6), 0.1, 0.04, 0.3, op); }
}

/* ── 씬마다 한 번: 도끼·장작·반쪽·조각을 만들어 숨겨 둔다 (사전 컴파일에 함께 들어간다) ── */
export function buildChop() {
  const W = ctx.W, scene = ctx.scene; W.splitCount = 0;
  Object.assign(C, { on: false, st: 'off', a: A_REST, pk: 0, ck: 0, stop: 0, hold: false, queued: false, wantStop: false, log: null, trauma: 0, kick: 0, kickV: 0, fov: 0, knotTold: false });

  const rig = new THREE.Group(); rig.position.set(CHOP.stump[0], 0, CHOP.stump[1]);
  rig.rotation.y = Math.atan2(CHOP.stand[0] - CHOP.stump[0], CHOP.stand[1] - CHOP.stump[1]); scene.add(rig);
  const work = new THREE.Group(); work.visible = false; rig.add(work);

  const bark = smoothM(0x5a3d28, Object.assign({ roughness: 0.95 }, tex('bark', 1, 1, 0.5)));
  const endM = smoothM(0xc9a97c, Object.assign({ roughness: 0.85 }, tex('wood', 1, 1, 0.3)));
  const faceM = smoothM(0xd6b68a, Object.assign({ roughness: 0.8, side: THREE.DoubleSide }, tex('wood', 1, 2, 0.35)));
  const darkM = smoothM(0x1a120b, { roughness: 1 }), knotM = smoothM(0x3a2616, { roughness: 0.9 });

  /* 도끼 + 장갑 낀 두 손 */
  const axe = new THREE.Group(); axe.position.copy(PIVOT); axe.rotation.x = A_REST; work.add(axe);
  {
    const hickory = smoothM(0xb08a5a, Object.assign({ roughness: 0.6 }, tex('wood', 1, 4, 0.2)));
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e949b, metalness: 0.85, roughness: 0.38 });
    const edgeM = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.9, roughness: 0.2 });
    const leather = smoothM(0x4a3324, { roughness: 0.9 }), glove = smoothM(0x6b5440, Object.assign({ roughness: 0.95 }, tex('fabric', 2, 2, 0.4)));
    const hg = new THREE.CylinderGeometry(0.016, 0.02, 1.04, 10); hg.rotateX(Math.PI / 2); hg.translate(0, 0, -0.44); axe.add(new THREE.Mesh(hg, hickory));
    const wg = new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10); wg.rotateX(Math.PI / 2); wg.translate(0, 0, 0.02); axe.add(new THREE.Mesh(wg, leather));
    const s = new THREE.Shape();
    s.moveTo(-0.045, 0.035); s.lineTo(0.045, 0.035); s.lineTo(0.04, -0.03); s.quadraticCurveTo(0.085, -0.07, 0.08, -0.125); s.lineTo(-0.075, -0.125); s.quadraticCurveTo(-0.08, -0.07, -0.04, -0.03); s.closePath();
    const headG = new THREE.ExtrudeGeometry(s, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 });
    headG.translate(0, 0, -0.013); headG.rotateY(Math.PI / 2); headG.translate(0, 0, -0.9);
    axe.add(new THREE.Mesh(headG, steel));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.158), edgeM); edge.position.set(0, -0.121, -0.9); axe.add(edge);
    const gg = new THREE.CapsuleGeometry(0.034, 0.05, 4, 10); gg.rotateX(Math.PI / 2);
    [0.03, -0.17].forEach(z => { const h = new THREE.Mesh(gg, glove); h.position.set(0, 0.004, z); h.scale.set(1.15, 1, 1); axe.add(h); });
  }

  /* 장작: 단위 원기둥 하나를 굵기만 바꿔 계속 재사용. 금(crack)과 옹이(knot)는 자식 */
  const logG = new THREE.Group(); logG.visible = false; work.add(logG);
  const logM = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.03, 1, 22), [bark, endM, endM]); logG.add(logM);
  const crack = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), darkM); crack.visible = false; logG.add(crack);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), knotM); knot.visible = false; logG.add(knot);

  /* 쪼개진 반쪽 풀 (10개). 그만둬도 남은 연출은 끝까지 보이도록 work 가 아니라 rig 에 단다 */
  const halfGeo = [new THREE.CylinderGeometry(1, 1.03, 1, 12, 1, false, 0, Math.PI), new THREE.CylinderGeometry(1, 1.03, 1, 12, 1, false, Math.PI, Math.PI)];
  const faceGeo = new THREE.PlaneGeometry(2, 1), halves = [];
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.visible = false;
    const cyl = halfGeo.map(geo => { const m = new THREE.Mesh(geo, [bark, endM, endM]); g.add(m); return m; });
    const face = new THREE.Mesh(faceGeo, faceM); g.add(face); rig.add(g);
    halves.push({ g, cyl, face, free: true, side: 1, r: 0.1, age: 0, d: 0, dz: 0, yaw: 0, T: 0.45, landed: false });
  }

  /* 나무 조각 */
  const NCH = 80, chipMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), endM, NCH);
  chipMesh.frustumCulled = false; const zero = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < NCH; i++) chipMesh.setMatrixAt(i, zero); rig.add(chipMesh);
  const chips = Array.from({ length: NCH }, () => ({ p: new V(), v: new V(), r: new THREE.Euler(), w: new V(), s: new V(), l: 0, m: 0, rest: false, live: false }));

  shadowed(rig);
  const pile = new V(CHOP.pile[0] - CHOP.stump[0], 0, CHOP.pile[1] - CHOP.stump[1]).applyAxisAngle(new V(0, 1, 0), -rig.rotation.y);
  rig.updateMatrixWorld(true);
  R = { rig, work, axe, logG, logM, crack, knot, halves, chipMesh, chips, chipI: 0, chipLive: false, pile };
  ensureRing(); if (ring) ring.style.opacity = '0';
}

/* ── 시작·그만두기·입력 ── */
export function chopEye() { return C.eye; }
export function startChop() {
  if (!R || C.on) return false;
  const W = ctx.W, sx = CHOP.stand[0], sz = CHOP.stand[1];
  C.eye.set(sx, terrainH(sx, sz, W.cfg) + EYE, sz);
  C.fwd.set(CHOP.stump[0] - sx, 0, CHOP.stump[1] - sz).normalize(); C.right.set(-C.fwd.z, 0, C.fwd.x);
  Object.assign(C, { on: true, st: 'idle', a: A_REST, pk: 0, ck: 0, hold: false, queued: false, wantStop: false, nextLogT: 1.0, log: null });
  R.work.visible = true; R.logG.visible = false; R.crack.visible = false;
  if (W.stumpAxe) W.stumpAxe.visible = false;
  sfx('chopPick');
  return true;
}
export function chopPress() {
  if (!C.on) return;
  C.hold = true;
  if (C.st === 'idle' && C.log && C.log.landed) beginRaise(); else C.queued = true;
}
export function chopRelease() { C.hold = false; }
/* 도끼질 도중이면 끝난 뒤 그만둔다 */
export function requestChopStop() { if (!C.on) return; if (C.st === 'idle') finishStop(); else { C.wantStop = true; C.queued = false; } }
function finishStop() { resetChop(); sfx('chopPut'); if (chopHooks.stop) chopHooks.stop(); }
/* 메뉴로 나갈 때 등: 소리·콜백 없이 정리 */
export function resetChop() {
  if (!R) return;
  Object.assign(C, { on: false, st: 'off', hold: false, queued: false, wantStop: false, log: null });
  R.work.visible = false; R.logG.visible = false; R.crack.visible = false;
  if (ctx.W.stumpAxe) ctx.W.stumpAxe.visible = true;
  if (ring) ring.style.opacity = '0';
}

/* ── 매 프레임 ── */
export function updateChop(dt) {
  if (!R) return;
  C.clock += dt;
  /* 히트 스톱: 도끼·장작·조각을 잠깐 멈춘다 (카메라 흔들림은 chopCamera 에서 계속) */
  if (C.stop > 0) { C.stop -= dt; return; }
  updLog(dt); updAxe(dt); updHalves(dt); updChips(dt); updRing();
}

function beginRaise() { Object.assign(C, { st: 'raise', t: 0, from: C.a, charge: 0, over: 0, ready: false, charged: false, queued: false }); sfx('chopRaise'); }
function strike() {
  const perfect = C.charged && C.charge >= 0.8 && C.over < T_SWEET, tired = C.charged && C.over >= T_SWEET;
  C.perfect = perfect;
  C.power = perfect ? 1 : C.charged ? (tired ? 0.45 : 0.75 * C.charge) : 0;
  C.dmg = perfect ? 2.2 : tired ? 1.15 : C.charged ? 1 + 0.6 * C.charge : 1;
  C.ckFrom = C.ck; C.st = 'strike'; C.t = 0; C.from = C.a; C.hold = false;
  /* 휘두르는 소리에 충돌까지 남은 시간을 넘긴다 → 충돌 직전에 가장 크게 */
  sfx('chopWhoosh', { p: C.power, d: strikeDur() }); if (C.charged) sfx('chopExhale', C.power);
}

function updAxe(dt) {
  if (!C.on) return;
  let a = C.a;
  switch (C.st) {
    case 'raise':
      C.t += dt / T_RAISE; a = lerp(C.from, A_UP, eio(Math.min(1, C.t)));
      if (C.t >= 1) { if (C.hold) { C.st = 'charge'; C.t = 0; C.charged = true; sfx('chopBreath'); } else { C.a = a; strike(); } }
      break;
    case 'charge': {
      C.charge = Math.min(1, C.charge + dt / T_CHARGE); if (C.charge >= 1) C.over += dt;
      if (!C.ready && C.charge >= 0.8) { C.ready = true; sfx('chopReady'); }
      const tired = smooth(T_SWEET, T_SWEET + 0.6, C.over);
      C.ck = eio(C.charge) * (1 - 0.4 * tired);
      /* 힘이 차면 더 높이 들고, 너무 오래 들면 팔이 떨리며 조금씩 처진다 */
      a = lerp(A_UP, A_UP_MAX, eio(C.charge)) - 0.08 * tired + Math.sin(C.clock * 29) * 0.014 * tired + Math.sin(C.clock * 6.5) * 0.004 * C.charge;
      if (!C.hold || C.over > T_TIRE) { C.a = a; strike(); }
      break;
    }
    case 'strike': {
      C.t += dt / strikeDur(); const k = Math.min(1, C.t);
      a = lerp(C.from, A_HIT, k * k); C.ck = C.ckFrom * (1 - k);
      if (C.t >= 1) { C.a = A_HIT; impact(); a = A_HIT; }
      break;
    }
    case 'embed':
      C.t += dt / 0.36; a = A_EMB + Math.sin(C.t * 40) * 0.006 * Math.max(0, 1 - C.t);
      if (C.t >= 1) { C.st = 'pull'; C.t = 0; C.from = a; sfx('chopPull'); C.kickV += 0.25; }
      break;
    case 'bounce':
      C.t += dt / 0.2; a = A_HIT + 0.32 * Math.sin(Math.min(1, C.t) * Math.PI / 2);
      if (C.t >= 1) { C.st = 'recover'; C.t = 0; C.from = a; C.pkFrom = C.pk; }
      break;
    case 'pull':
      C.t += dt / 0.38; a = lerp(C.from, A_REST, eio(Math.min(1, C.t)));
      if (C.t >= 1) C.st = 'idle';
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
      C.t += dt / 0.6; const k = eio(Math.min(1, C.t)); a = lerp(C.from, A_REST, k); C.pk = C.pkFrom * (1 - k);
      if (C.t >= 1) C.st = 'idle';
      break;
    }
    default: /* idle: 숨 쉬듯 아주 조금 */
      a = A_REST + Math.sin(C.clock * 1.3) * 0.012; C.ck *= Math.exp(-dt * 8);
      if (C.wantStop) { C.a = a; finishStop(); return; }
      if (C.queued && C.log && C.log.landed) { C.a = a; beginRaise(); }
  }
  C.a = a; R.axe.rotation.x = a;
  R.axe.position.copy(PIVOT).addScaledVector(FOLLOW_D, C.pk).addScaledVector(CH_D, C.ck);
}

function impact() {
  const L = C.log;
  if (!L || !L.landed) { C.st = 'recover'; C.t = 0; C.from = C.a; C.pkFrom = C.pk; return; }
  L.hits++; L.hp -= C.dmg;
  const fin = L.hp <= 0.001, p = C.power, knotHit = L.knot && !fin;
  /* 손맛: 멈춤 → 흔들림 → 시선 반동 → 시야 펀치 → 장작 눌림 → 조각·먼지 → 소리 */
  C.stop = fin ? (C.perfect ? 0.095 : 0.07) : 0.05;
  C.trauma = Math.min(1, C.trauma + (fin ? 0.38 : 0.24) + 0.22 * p);
  C.kickV -= (fin ? 0.55 : 0.4) + 0.25 * p; if (knotHit) C.kickV += 0.55;
  C.fov = -(0.7 + 1.3 * p) - (fin ? 0.5 : 0);
  L.sqV -= 1.8 + 1.4 * p; L.wob = fin ? 0 : 1;
  spawnChips(fin ? Math.round(10 + 12 * p) : (knotHit ? 3 : 5), fin ? 0.9 + 0.35 * p : 0.6);
  dust(0, LOG_TOP, 0, fin ? 3 : 1, fin ? 0.12 : 0.07);
  sfx('chop', { fin, perfect: C.perfect, knot: knotHit, power: p });
  C.t = 0;
  if (fin) {
    split(L); C.st = 'follow';
    const n = ++ctx.W.splitCount;
    if ([5, 10, 20, 30, 50].includes(n)) say(`쪼갠 장작 ${n}개`);
    if (chopHooks.hud) chopHooks.hud();
  } else {
    const frac = 1 - L.hp / L.need, depth = LOG_H * (0.18 + 0.6 * frac);
    R.crack.visible = true; R.crack.scale.set(0.006 + 0.006 * frac, depth, L.r * 1.75); R.crack.position.y = LOG_H / 2 - depth / 2 + 0.002;
    if (knotHit) { C.st = 'bounce'; if (!C.knotTold) { C.knotTold = true; say('옹이가 있어 단단하다'); } }
    else C.st = 'embed';
  }
}

/* ── 장작: 장작더미에서 포물선으로 날아와 일어서며 놓인다. 맞으면 눌렸다 튀어 오른다(스프링) ── */
function newLog() {
  const r = rnd(0.095, 0.14), knot = r >= 0.11 && Math.random() < 0.3;
  let need = r < 0.11 ? 1 : r < 0.125 ? 2 : (Math.random() < 0.4 ? 3 : 2); if (knot) need++;
  C.log = { r, need, hp: need, hits: 0, knot, t: 0, landed: false, sq: 0, sqV: 0, wob: 0, yaw: rnd(-0.8, 0.8) };
  R.logM.rotation.y = rnd(0, 6.28); R.crack.visible = false; R.knot.visible = knot;
  if (knot) { const a = rnd(-0.7, 0.7); R.knot.position.set(Math.sin(a) * r * 0.97, rnd(-0.08, 0.1), Math.cos(a) * r * 0.97); R.knot.rotation.set(0, a, 0); R.knot.scale.set(0.028, 0.036, 0.014); }
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
  R.logM.scale.set(L.r * (1 - 0.5 * L.sq), LOG_H * (1 + L.sq), L.r * (1 - 0.5 * L.sq)); R.logM.position.y = LOG_H * L.sq / 2;
  if (L.landed) g.rotation.z = Math.sin(C.clock * 36) * 0.025 * L.wob;
}

/* ── 쪼개진 반쪽: 좌우로 기울며 떨어져 한 번 튕기고 눕는다. 7초 뒤 가라앉으며 사라진다 ── */
function takeHalf() { return R.halves.find(o => o.free) || R.halves.reduce((a, b) => (b.age > a.age ? b : a)); }
function split(L) {
  R.logG.visible = false; R.crack.visible = false; C.log = null; C.nextLogT = 0.75;
  const fly = 1 + 0.3 * C.power;
  [1, -1].forEach(side => {
    const h = takeHalf();
    Object.assign(h, { free: false, side, r: L.r, age: 0, d: rnd(0.4, 0.55) * fly, dz: rnd(-0.12, 0.14), yaw: rnd(-0.4, 0.4), T: rnd(0.4, 0.5) / Math.sqrt(fly), landed: false });
    h.cyl[0].visible = side > 0; h.cyl[1].visible = side < 0;
    h.cyl.forEach(m => m.scale.set(L.r, LOG_H, L.r));
    h.face.scale.set(L.r, LOG_H, 1); h.face.rotation.set(0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    h.g.scale.setScalar(1); h.g.visible = true;
  });
}
function updHalves(dt) {
  for (const h of R.halves) {
    if (h.free) continue;
    h.age += dt; const u = Math.min(1, h.age / h.T), g = h.g;
    const tip = Math.pow(u, 1.7) * Math.PI / 2; let y = lerp(LOG_CY, h.r, u * u) + 0.1 * u * (1 - u), ov = 0;
    if (h.age > h.T) {
      const v = Math.min(1, (h.age - h.T) / 0.3); y += 0.03 * Math.sin(Math.PI * v) * (1 - v); ov = 0.08 * Math.sin(Math.PI * v) * (1 - v);
      if (!h.landed) {
        h.landed = true;
        /* 쪼갠 직후 메뉴로 나가면 반쪽은 프리뷰에서 마저 떨어진다 — 그때는 소리·화면 흔들림 없이 모습만 */
        if (ctx.running) { sfx('woodLand', { k: h.r / 0.12, pan: h.side * 0.35 }); C.trauma = Math.min(1, C.trauma + 0.04); }
        dust(h.side * (0.01 + h.d), 0.03, h.dz, 2, 0.08);
      }
    }
    g.position.set(h.side * (0.01 + h.d * eout(u)), y, h.dz * u);
    g.rotation.set(0, h.yaw * u, -h.side * (tip + ov));
    if (h.age > 7) { const k = smooth(7, 8, h.age); g.position.y -= 0.05 * k; g.scale.setScalar(Math.max(0.001, 1 - k)); if (h.age >= 8) { h.free = true; g.visible = false; } }
  }
}

/* ── 나무 조각: 살아 있는 조각이 없으면 갱신하지 않는다 ── */
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

/* ── 힘 모으기 고리: 좁아지다가 꽉 차면 금빛, 너무 오래 들면 흐려지며 다시 벌어진다 ── */
function ensureRing() {
  if (ring && ring.isConnected) return;
  const hud = document.querySelector('#hud'); if (!hud) return;
  ring = document.createElement('div');
  ring.style.cssText = 'position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:1.5px solid rgba(255,255,255,.5);box-shadow:0 0 10px rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .15s,border-color .12s';
  hud.append(ring);
}
function updRing() {
  if (!ring) return;
  const show = C.on && C.st === 'charge'; ring.style.opacity = show ? '1' : '0'; if (!show) return;
  const sweet = C.charge >= 0.8 && C.over < T_SWEET, tired = C.over >= T_SWEET;
  const s = tired ? 0.32 + 0.4 * smooth(T_SWEET, T_SWEET + 0.6, C.over) : 1 - 0.68 * smooth(0, 0.8, C.charge);
  ring.style.transform = `scale(${s.toFixed(3)})`;
  ring.style.borderColor = sweet ? 'rgba(233,197,138,1)' : tired ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.5)';
}

/* ── 카메라: main.js 가 시선 회전을 정한 직후에 부른다. 위치는 서는 자리에 고정하고 그 위에 효과를 더한다 ──
   흔들림 = trauma² × 여러 주파수 사인 합, 시선 반동 = 감쇠 스프링, 시야 = 힘 모을 때 넓어지고 맞는 순간 좁아짐 */
const nz = (t, s) => Math.sin(t * 43.1 + s * 7.3) * 0.5 + Math.sin(t * 71.7 + s * 3.1) * 0.3 + Math.sin(t * 97.3 + s * 11.9) * 0.2;
export function chopCamera(camera, dt, settled) {
  C.trauma = Math.max(0, C.trauma - dt * 1.7);
  for (let i = 0; i < 3; i++) { const h = dt / 3; C.kickV += (-220 * C.kick - 22 * C.kickV) * h; C.kick += C.kickV * h; }
  const ch = C.on && C.st === 'charge' ? eio(C.charge) : 0;
  C.fov += (1.6 * ch - C.fov) * Math.min(1, dt * (C.fov < 0 ? 6 : 4));
  if (C.on && settled && state.mode === 'chop') {
    const amp = C.trauma * C.trauma, t = C.clock;
    camera.position.copy(C.eye).addScaledVector(C.fwd, -C.kick * 0.3 - 0.035 * ch).addScaledVector(C.right, amp * 0.035 * nz(t, 2));
    camera.position.y += Math.sin(t * 1.1) * 0.004 + C.kick * 0.25 + amp * 0.03 * nz(t, 1);
    camera.rotation.x += C.kick + 0.03 * ch + amp * 0.02 * nz(t, 3);
    camera.rotation.z += amp * 0.03 * nz(t, 4);
  }
  if (ctx.baseFov) { const f = ctx.baseFov + C.fov; if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; camera.updateProjectionMatrix(); } }
}