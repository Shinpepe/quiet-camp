import * as THREE from 'three';
import { ctx, state, records, saveSettings, session } from './state.js';
import { ANIMALS, ANIMAL } from './data.js';
import { smoothM, shadowTex, clamp, wrapPI, rnd, josa } from './util.js';
import { terrainH, WATER_Y, shoreOff } from './terrain.js';
import { blocks } from './camp.js';
import { onMat } from './beach.js';
import { sfxAt } from './audio.js';
/* dream.js → game.js → 이 파일로 이어지는 순환이지만, 서로 실행 중에만 부르므로 괜찮다 */
import { dreamOn } from './dream.js';

/* ══ 동물: 바라보기만 ══
   흰뺨검둥오리 가족·다람쥐(숲) · 산토끼·여우(설산) · 달랑게·바다거북(해변). 나오는 시각·간격·경계 거리는 data.js 의 ANIMALS·ANIMAL.

   모델: 등뼈 곡선을 따라 단면을 이어 붙인 곡면(loft) + 표면 위치로 칠한 무늬(정점 색).
     여우·다람쥐·산토끼는 몸통·다리·꼬리를 한 장의 피부(SkinnedMesh)로 잇고, 관절 근처는 위아래 뼈를 섞어 따라가게 한다.
     머리·귀·눈·오리 깃털·거북 등딱지처럼 휘지 않는 것은 뼈에 붙인 보통 메쉬.
     지오메트리는 종마다 처음 한 번만 굽고(GC) 다음부터 재사용한다. 다 쓴 동물은 숨겨 두었다가(pool) 다시 쓴다.
   상태: roam(목표로 이동) · rest(쉬기) · act(종마다 하는 일) · alert(멈춰 바라보기) · flee(달아나기) · leave(떠나기 → 사라짐) · in(거북이 올라오는 중)
     상태가 바뀌면 0.3초 동안 이전 자세에서 새 자세로 섞는다 (snapPose·blend).
     여우 쥐 사냥은 키프레임 곡선(POUNCE)이라 끊김 없이 이어진다.
   사람과의 거리: 앉아 있거나 거의 움직이지 않으면 calm 배로만 친다. 장작을 패면 1.5배로 시끄럽다.
     모두 calmAfter 초 넘게 가만히 있으면 동물이 그 사람 근처로 다가온다. alert 중에 사람이 가만히 있으면 익숙해진다(trust).
   땅: 앞발·뒷발·좌우 밑의 지형 높이로 몸 높이·앞뒤·좌우 기울기를 맞추고, 디딤발은 다리 IK 로 지면에 붙인다.
     그래도 땅에 묻히는 점(엉덩이·발뒤꿈치·배딱지·게 다리 끝)이 있으면 몸 전체를 그만큼 띄운다. 카메라에서 ANIMAL.ik m 안에서만.
   사진(animalPhoto): 화면 안에 충분히 크게 잡히고 나무 줄기에 가리지 않은 종을 records.animals 에 남긴다.
   멀티: 방장(1인 포함)이 생각하고, 친구는 받은 위치·방향·상태를 320ms 늦춰 보간한다. 자세·IK·소리는 각자 그린다.
   그림자: 동물은 그림자맵에 그리지 않고(0.1초마다 갱신되어 끊겨 보인다) 땅에 붙는 바닥 얼룩을 따로 둔다 */

const TAU = Math.PI * 2, lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const turnTo = (a, b, max) => a + clamp(wrapPI(b - a), -max, max);
const KEYS = Object.keys(ANIMALS), ST = ['roam', 'rest', 'alert', 'flee', 'leave', 'act', 'in'];
const hT = (x, z) => terrainH(x, z, ctx.W.cfg);

/* net.js 가 채운다: peers() = 같은 장소에서 캠핑 중인 다른 사람 [{ x, z, still, loud }] */
export const animalHooks = { peers: null };

const A = { on: false, list: [], next: {}, seq: 0, calm: 0, T: 0, trunks: [], pool: {}, prev: new THREE.Vector3(), selfV: 0, sentEmpty: true };

/* ══ 색·노이즈 ══ (THREE.Color 가 sRGB → 작업 색공간으로 바꿔 준다) */
const lin = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
function h3(x, y, z) { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); }
function n3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), c = (i, j, k) => h3(ix + i, iy + j, iz + k);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v), lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

/* ══ 재질·지오메트리: 모두 씬을 넘어 재사용한다 (userData.shared — scene.js 정리에서 빠진다) ══ */
const shared = o => { o.userData.shared = true; return o; };
const MC = {};
const mat = (h, r = 0.8) => MC[h + '_' + r] || (MC[h + '_' + r] = shared(smoothM(h, { roughness: r })));
let VC = null, VCM = null, PUP = null, CLM = null, BLOB = null;
function mats() {
  if (VC) return;
  VC = shared(smoothM(0xffffff, { vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }));
  VCM = shared(smoothM(0xffffff, { vertexColors: true, roughness: 0.32, metalness: 0.5, side: THREE.DoubleSide }));
  PUP = shared(smoothM(0x050403, { roughness: 0.08 }));
  CLM = shared(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  BLOB = shared(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}
const G = {
  sph: shared(new THREE.SphereGeometry(1, 24, 16)), lo: shared(new THREE.SphereGeometry(1, 12, 8)), cone: shared(new THREE.ConeGeometry(1, 1, 12)),
  blob: shared(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
};

/* ══ 모델 만들기 ══
   B = 지금 만드는 모델. 첫 빌드는 곡면을 구워 GC[종] 에 차례대로 적어 두고, 다음 빌드는 같은 순서로 꺼내 쓴다.
   피부(SkinnedMesh)는 뼈 순서도 기억해 두었다가 새 모델의 같은 번호 뼈에 묶는다 */
let B = null;
const GC = {};
function begin(key) { const c = GC[key] || (GC[key] = { geos: [], skin: null, boneJ: null, done: false }); B = { c, joints: [], gi: 0 }; }
function end() { B.c.done = true; B = null; }
const joint = (p, x, y, z) => { const g = new THREE.Bone(); g.position.set(x, y, z); g.userData.jid = B.joints.length; B.joints.push(g); p.add(g); return g; };
function part(p, geo, m, pos, scl, rot) {
  const o = new THREE.Mesh(geo, m); o.position.set(pos[0], pos[1], pos[2]); o.scale.set(scl[0], scl[1], scl[2]);
  if (rot) o.rotation.set(rot[0], rot[1], rot[2]);
  o.receiveShadow = true; p.add(o); return o;
}
/* Catmull-Rom 보간 (반지름 같은 값을 곡선 위치 u 에서) */
function cr(v, uk, u) {
  let j = 0; while (j < uk.length - 2 && u > uk[j + 1]) j++;
  const t = clamp((u - uk[j]) / ((uk[j + 1] - uk[j]) || 1), 0, 1), p0 = v[Math.max(0, j - 1)], p1 = v[j], p2 = v[Math.min(v.length - 1, j + 1)], p3 = v[Math.min(v.length - 1, j + 2)], t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/* 양 끝을 반구처럼 둥글게: 끝 바깥에 점 셋을 더해 반지름이 0 으로 줄어들게 (잘린 단면이 보이지 않게) */
function roundEnds(pts, rx, ry, W) {
  const F = [[0.5, 0.87], [0.85, 0.53], [0.98, 0.2]];
  const add = (i, j, front) => {
    const t = pts[i].clone().sub(pts[j]).normalize(), r = (rx[i] + ry[i]) / 2, np = [], nx = [], ny = [], nw = [];
    F.forEach(([d, f]) => { np.push(pts[i].clone().addScaledVector(t, r * d)); nx.push(rx[i] * f); ny.push(ry[i] * f); nw.push(W ? W[i] : null); });
    if (front) { np.reverse(); nx.reverse(); ny.reverse(); nw.reverse(); pts.unshift(...np); rx.unshift(...nx); ry.unshift(...ny); if (W) W.unshift(...nw); }
    else { pts.push(...np); rx.push(...nx); ry.push(...ny); if (W) W.push(...nw); }
  };
  add(0, 1, true); const n = pts.length; add(n - 1, n - 2, false);
}
/* 곡면 굽기: 곡선을 NU 마디로 나누고 마디마다 NV 각도의 단면(타원, sq 로 네모지게)을 잇는다.
   단면 방향은 평행 이동 틀(뒤틀리지 않는다). col(u, θ, s=위쪽 성분, c=옆 성분, 위치) → 색
   옵션: fuzz 털 결 · fzu 털 결 세기(u) · rad 반지름 배율(u, θ, s, c) · disp 바깥쪽 밀어내기(위치, u, θ, s) · flat 아랫면 납작 · up 단면 기준 방향 */
const _q = new THREE.Quaternion(), _dv = new THREE.Vector3();
function loftCore(pts, rx, ry, col, o) {
  const NU = o.nu || 40, NV = o.nv || 24, curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const uk = [0]; for (let i = 1; i < pts.length; i++) uk.push(uk[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const L = uk[uk.length - 1] || 1; for (let i = 0; i < uk.length; i++) uk[i] /= L;
  const up = new THREE.Vector3(...(o.up || [0, 1, 0])), P = [], T = [], NN = [];
  for (let i = 0; i <= NU; i++) { const u = i / NU; P.push(curve.getPointAt(u)); T.push(curve.getTangentAt(u).normalize()); }
  let N = up.clone().addScaledVector(T[0], -up.dot(T[0]));
  if (N.lengthSq() < 1e-4) N.set(0, 0, 1).addScaledVector(T[0], -T[0].z);
  if (N.lengthSq() < 1e-4) N.set(1, 0, 0).addScaledVector(T[0], -T[0].x);
  N.normalize();
  for (let i = 0; i <= NU; i++) { if (i) { _q.setFromUnitVectors(T[i - 1], T[i]); N.applyQuaternion(_q); N.addScaledVector(T[i], -N.dot(T[i])).normalize(); } NN.push(N.clone()); }
  const pos = [], cols = [], idx = [], us = [], S = new THREE.Vector3(), q = new THREE.Vector3(), sq = o.sq || 1, fz = o.fuzz || 0, fl = o.flat || 1;
  for (let i = 0; i <= NU; i++) {
    const u = i / NU, a = Math.max(0, cr(rx, uk, u)), b = Math.max(0, cr(ry, uk, u)), fu = fz * (o.fzu ? o.fzu(u) : 1);
    S.crossVectors(T[i], NN[i]).normalize();
    for (let j = 0; j < NV; j++) {
      const th = j / NV * TAU, c = Math.cos(th), s = Math.sin(th);
      const ex = Math.sign(c) * Math.pow(Math.abs(c), sq); let ey = Math.sign(s) * Math.pow(Math.abs(s), sq); if (s < 0) ey *= fl;
      let k = 1;
      if (fu) k += fu * (n3(P[i].x * 90 + c * 3, P[i].y * 90 + s * 3, P[i].z * 90) - 0.5) + fu * 0.6 * (n3(u * 70, th * 5, 1.7) - 0.5);
      if (o.rad) k *= o.rad(u, th, s, c);
      q.copy(P[i]).addScaledVector(S, ex * a * k).addScaledVector(NN[i], ey * b * k);
      if (o.disp && a > 1e-5 && b > 1e-5) { const d = o.disp(q, u, th, s); if (d) { _dv.copy(S).multiplyScalar(ex / a).addScaledVector(NN[i], ey / b).normalize(); q.addScaledVector(_dv, d); } }
      pos.push(q.x, q.y, q.z); us.push(u); const cc = col(u, th, s, c, q); cols.push(cc[0], cc[1], cc[2]);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a0 = i * NV + j, b0 = (i + 1) * NV + j, c0 = i * NV + (j + 1) % NV, d0 = (i + 1) * NV + (j + 1) % NV; idx.push(a0, b0, c0, b0, d0, c0); }
  const s0 = pos.length / 3; pos.push(P[0].x, P[0].y, P[0].z); us.push(0); let cc = col(0, 0, 0, 1, P[0]); cols.push(cc[0], cc[1], cc[2]);
  for (let j = 0; j < NV; j++) idx.push(s0, j, (j + 1) % NV);
  const s1 = pos.length / 3; pos.push(P[NU].x, P[NU].y, P[NU].z); us.push(1); cc = col(1, 0, 0, 1, P[NU]); cols.push(cc[0], cc[1], cc[2]);
  for (let j = 0; j < NV; j++) idx.push(s1, NU * NV + (j + 1) % NV, NU * NV + j);
  return { pos, cols, idx, us, uk };
}
function geoOf(d) {
  const g = new THREE.BufferGeometry(); g.setIndex(d.idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(d.cols, 3));
  return g;
}
/* 휘지 않는 곡면 하나: ctrl 은 parent 기준 [x, y, z, 옆 반지름, 위아래 반지름] */
function loft(parent, ctrl, col, o = {}) {
  let g;
  if (B.c.done) g = B.c.geos[B.gi++];
  else {
    const pts = ctrl.map(c => new THREE.Vector3(c[0], c[1], c[2])), rx = ctrl.map(c => c[3]), ry = ctrl.map(c => c[4]);
    if (o.round) roundEnds(pts, rx, ry, null);
    g = geoOf(loftCore(pts, rx, ry, col, o)); g.computeVertexNormals(); shared(g); B.c.geos.push(g); B.gi++;
  }
  const m = new THREE.Mesh(g, o.mat || VC); m.receiveShadow = true; parent.add(m); return m;
}
/* 피부 조각: ents 는 [뼈, x, y, z, 옆 반지름, 위아래 반지름, 무게 [[뼈, w], …]?] — 점은 그 뼈 기준, 무게를 안 주면 그 뼈에 1.
   점 사이의 무게는 매끄럽게 섞인다. infl: 몸통처럼 큰 조각에서 다리 뿌리 근처 피부가 다리를 조금 따라가게 */
const Skin = () => ({ pos: [], col: [], idx: [], si: [], sw: [], bones: [] });
function boneIdx(K, b) { let i = K.bones.indexOf(b); if (i < 0) { K.bones.push(b); i = K.bones.length - 1; } return i; }
const _vp = new THREE.Vector3();
function skinLoft(K, R, ents, col, o = {}) {
  if (B.c.done) return;
  R.updateMatrixWorld(true);
  const pts = [], rx = [], ry = [], W = [];
  ents.forEach(e => { const v = new THREE.Vector3(e[1], e[2], e[3]); e[0].localToWorld(v); R.worldToLocal(v); pts.push(v); rx.push(e[4]); ry.push(e[5]); W.push(e[6] || [[e[0], 1]]); });
  if (o.round) roundEnds(pts, rx, ry, W);
  const d = loftCore(pts, rx, ry, col, o), base = K.pos.length / 3;
  for (let i = 0; i < d.us.length; i++) {
    const u = d.us[i]; let j = 0; while (j < d.uk.length - 2 && u > d.uk[j + 1]) j++;
    const t = ss(0, 1, (u - d.uk[j]) / ((d.uk[j + 1] - d.uk[j]) || 1)), m = new Map();
    W[j].forEach(([b, w]) => m.set(b, (m.get(b) || 0) + w * (1 - t)));
    W[Math.min(W.length - 1, j + 1)].forEach(([b, w]) => m.set(b, (m.get(b) || 0) + w * t));
    if (o.infl) {
      _vp.set(d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]); let tot = 0; const add = [];
      o.infl.forEach(f => { const w = f.max * (1 - ss(f.r0, f.r1, _vp.distanceTo(f.c))); if (w > 0) { add.push([f.b, w]); tot += w; } });
      if (tot > 0) { const kk = Math.max(0, 1 - tot); m.forEach((w, b) => m.set(b, w * kk)); add.forEach(([b, w]) => m.set(b, (m.get(b) || 0) + w)); }
    }
    const arr = [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = arr.reduce((s, x) => s + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) { const e = arr[k]; K.si.push(e ? boneIdx(K, e[0]) : 0); K.sw.push(e ? e[1] / sum : 0); }
  }
  for (const v of d.pos) K.pos.push(v); for (const v of d.cols) K.col.push(v); for (const v of d.idx) K.idx.push(v + base);
}
function buildSkin(K, R) {
  let g, bones;
  if (B.c.done) { g = B.c.skin; bones = B.c.boneJ.map(j => B.joints[j]); }
  else {
    g = new THREE.BufferGeometry(); g.setIndex(K.idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(K.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(K.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(K.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(K.sw, 4));
    g.computeVertexNormals(); shared(g);
    B.c.skin = g; B.c.boneJ = K.bones.map(b => b.userData.jid); bones = K.bones;
  }
  const m = new THREE.SkinnedMesh(g, VC); m.receiveShadow = true; m.frustumCulled = false;
  R.add(m); R.updateMatrixWorld(true); m.bind(new THREE.Skeleton(bones)); return m;
}
const cOf = (R, o) => { R.updateMatrixWorld(true); const v = new THREE.Vector3(); o.getWorldPosition(v); return R.worldToLocal(v); };
function eye(p, x, y, z, r, iris) {
  const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); const sx = Math.sign(x) || 1;
  if (iris) { part(g, G.sph, mat(iris, 0.15), [0, 0, 0], [r, r, r]); part(g, G.sph, PUP, [sx * r * 0.42, 0, r * 0.42], [r * 0.62, r * 0.72, r * 0.62]); }
  else part(g, G.sph, PUP, [0, 0, 0], [r, r, r]);
  const c = new THREE.Mesh(G.lo, CLM); c.scale.setScalar(r * 0.2); c.position.set(sx * r * 0.55, r * 0.5, r * 0.6); g.add(c);
  return g;
}
/* 여우 눈: 아몬드 모양으로 눈꼬리를 올리고, 짙은 테두리·호박색 홍채·반사광 둘 */
function foxEye(p, sx) {
  const r = 0.0125, g = new THREE.Group(); g.position.set(sx * 0.031, 0.03, 0.073); g.rotation.set(-0.1, sx * 0.55, sx * 0.28); p.add(g);
  part(g, G.sph, mat(0x1a120c, 0.4), [0, 0, 0], [r * 1.3, r * 0.86, r * 0.7]);
  part(g, G.sph, mat(0xd08a24, 0.12), [0, 0, r * 0.22], [r * 1.08, r * 0.74, r * 0.62]);
  part(g, G.sph, PUP, [0, 0, r * 0.48], [r * 0.42, r * 0.6, r * 0.34]);
  const c = new THREE.Mesh(G.lo, CLM); c.scale.setScalar(r * 0.22); c.position.set(r * 0.3, r * 0.28, r * 0.78); g.add(c);
  const c2 = new THREE.Mesh(G.lo, CLM); c2.scale.setScalar(r * 0.1); c2.position.set(-r * 0.25, -r * 0.2, r * 0.7); g.add(c2);
}

/* ── 여우: 가슴·엉덩이 두 마디 등뼈, 세 마디 다리(어깨·허벅지 / 무릎 / 발목) ── */
function foxModel() {
  const R = new THREE.Group(), J = { legs: [] }, b = J.body = joint(R, 0, 0.3, 0), hip = J.hip = joint(b, 0, 0.02, -0.08), chest = J.chest = joint(b, 0, 0.02, 0.08);
  const OR = lin(0xc8622a), ORD = lin(0x9c4a1e), CR = lin(0xf0e6d6), BK = lin(0x2a1f19), K = Skin();
  const mk = (sx, z, front, ph, go) => {
    const Pb = front ? chest : hip, U = joint(Pb, sx * (front ? 0.045 : 0.05), front ? -0.04 : -0.02, z); U.rotation.x = front ? 0.05 : -0.35;
    const Kn = joint(U, 0, front ? -0.13 : -0.14, front ? 0.01 : 0); Kn.rotation.x = front ? -0.05 : 0.7;
    const F = joint(Kn, 0, front ? -0.125 : -0.15, 0); F.rotation.x = front ? 0 : -0.35;
    J.legs.push({ U, K: Kn, F, front, sx, ph, go, u0: U.rotation.x, k0: Kn.rotation.x, f0: F.rotation.x });
    return { U, Kn, F, Pb };
  };
  const Ls = [mk(-1, 0.07, true, 0, 0), mk(1, 0.07, true, Math.PI, 0.45), mk(-1, -0.09, false, Math.PI, 0), mk(1, -0.09, false, 0, 0.45)];
  const tl = J.tail = joint(hip, 0, 0.025, -0.16);
  const infl = [...Ls.map(l => ({ b: l.U, c: cOf(R, l.U), r0: 0.03, r1: 0.1, max: 0.45 })), { b: tl, c: cOf(R, tl), r0: 0.02, r1: 0.07, max: 0.45 }];
  skinLoft(K, R, [[b, 0, 0.02, -0.27, 0.012, 0.012, [[hip, 1]]], [b, 0, 0.03, -0.21, 0.07, 0.08, [[hip, 1]]], [b, 0, 0.025, -0.09, 0.074, 0.085, [[hip, 0.8], [chest, 0.2]]], [b, 0, 0.022, 0.05, 0.07, 0.088, [[hip, 0.2], [chest, 0.8]]], [b, 0, 0.035, 0.15, 0.068, 0.095, [[chest, 1]]], [b, 0, 0.06, 0.21, 0.052, 0.072, [[chest, 1]]], [b, 0, 0.08, 0.24, 0.042, 0.05, [[chest, 1]]]],
    (u, th, s) => { let c = mixc(OR, ORD, ss(0.55, 0.95, s)); const w = ss(-0.4, -0.7, s) * (u > 0.62 ? 1 : 0.55) + ss(-0.1, -0.5, s) * ss(0.78, 0.95, u); c = mixc(c, CR, clamp(w, 0, 1)); return mulc(c, 0.94 + 0.12 * n3(u * 30, th * 3, 0.3)); },
    { flat: 0.9, nu: 52, nv: 36, infl, rad: (u, th, s) => 1 + 0.16 * ss(-0.35, -0.8, s) * Math.exp(-(((u - 0.86) / 0.07) ** 2)) * (1 + 0.7 * (n3(th * 8, u * 30, 3) - 0.5)) });
  Ls.forEach((l, i) => {
    const fr = i < 2, { U, Kn, F, Pb } = l;
    const ents = fr
      ? [[U, 0, 0.045, 0, 0.03, 0.042, [[Pb, 1]]], [U, 0, -0.02, 0.002, 0.033, 0.044, [[Pb, 0.35], [U, 0.65]]], [U, 0, -0.06, 0.006, 0.025, 0.03], [U, 0, -0.105, 0.01, 0.021, 0.024], [Kn, 0, 0, 0, 0.019, 0.021, [[U, 0.5], [Kn, 0.5]]], [Kn, 0, -0.06, 0, 0.016, 0.017], [Kn, 0, -0.11, 0.002, 0.015, 0.016], [F, 0, 0, 0.002, 0.016, 0.014, [[Kn, 0.5], [F, 0.5]]], [F, 0, -0.008, 0.02, 0.019, 0.012], [F, 0, -0.011, 0.038, 0.011, 0.007]]
      : [[U, 0, 0.055, 0.02, 0.035, 0.05, [[Pb, 1]]], [U, 0, 0, 0.015, 0.045, 0.06, [[Pb, 0.3], [U, 0.7]]], [U, 0, -0.06, 0.006, 0.036, 0.04], [U, 0, -0.12, 0, 0.024, 0.026], [Kn, 0, 0, 0, 0.021, 0.023, [[U, 0.5], [Kn, 0.5]]], [Kn, 0, -0.075, 0, 0.016, 0.017], [Kn, 0, -0.14, 0, 0.014, 0.015], [F, 0, 0, 0, 0.015, 0.014, [[Kn, 0.5], [F, 0.5]]], [F, 0, -0.01, 0.018, 0.018, 0.012], [F, 0, -0.012, 0.036, 0.011, 0.007]];
    skinLoft(K, R, ents, fr ? u => mixc(mixc(CR, OR, ss(0.05, 0.25, u)), BK, ss(0.42, 0.55, u)) : u => mixc(mixc(OR, ORD, ss(0.3, 0.6, u) * 0.5), BK, ss(0.5, 0.62, u)), { up: [0, 0, 1], nu: 44, nv: 18, round: true });
  });
  skinLoft(K, R, [[tl, 0, 0.012, 0.05, 0.03, 0.03, [[hip, 1]]], [tl, 0, 0.002, 0.015, 0.03, 0.03, [[hip, 0.5], [tl, 0.5]]], [tl, 0, -0.01, -0.06, 0.048, 0.05], [tl, 0, -0.04, -0.17, 0.066, 0.066], [tl, 0, -0.08, -0.29, 0.06, 0.058], [tl, 0, -0.11, -0.38, 0.035, 0.035], [tl, 0, -0.12, -0.415, 0.004, 0.004]],
    (u, th, s) => { let c = mixc(OR, ORD, ss(0.3, 0.9, s) * 0.6); if (u > 0.5 && u < 0.72 && s > 0.3) c = mixc(c, BK, 0.35); if (u > 0.82) c = mixc(c, CR, ss(0.82, 0.88, u)); return mulc(c, 0.92 + 0.16 * n3(u * 50, th * 5, 4)); },
    { fuzz: 0.08, fzu: u => ss(0.12, 0.3, u), nu: 48, nv: 24 });
  buildSkin(K, R);
  /* 머리: 볼 아래를 바깥으로 부풀려 볼털을 얼굴과 한 몸으로 */
  const h = J.head = joint(chest, 0, 0.065, 0.17); h.scale.setScalar(1.08);
  const ruff = (u, th, s, c) => ss(0.35, 0.8, Math.abs(c)) * ss(0.3, -0.3, s) * Math.exp(-(((u - 0.3) / 0.12) ** 2));
  loft(h, [[0, -0.01, -0.055, 0.05, 0.055], [0, 0.025, -0.01, 0.066, 0.062], [0, 0.03, 0.035, 0.062, 0.056], [0, 0.012, 0.075, 0.04, 0.036], [0, -0.006, 0.11, 0.024, 0.022], [0, -0.012, 0.145, 0.015, 0.014], [0, -0.014, 0.166, 0.006, 0.006]], (u, th, s, c) => {
    const ac = Math.abs(c); let col = mixc(OR, ORD, ss(0.6, 1, s) * 0.4 * (1 - ss(0.5, 0.7, u)));
    const cheek = ss(0.15, -0.25, s) * ss(0.22, 0.38, u) * ss(0.2, 0.5, ac), lip = ss(0.25, -0.05, s) * ss(0.55, 0.66, u), chin = ss(-0.3, -0.6, s) * ss(0.2, 0.35, u);
    col = mixc(col, CR, clamp(Math.max(cheek, lip, chin, ss(0.1, 0.35, ruff(u, th, s, c))), 0, 1));
    const tear = ss(0.5, 0.65, ac) * (1 - ss(0.82, 0.92, ac)) * ss(-0.1, 0.05, s) * (1 - ss(0.25, 0.35, s)) * ss(0.5, 0.56, u) * (1 - ss(0.64, 0.7, u));
    col = mixc(col, lin(0x5a3220), tear * 0.7);
    if (u > 0.6 && s > 0.3) col = mixc(col, lin(0xb25a28), 0.4);
    if (u > 0.93) col = mixc(col, BK, ss(0.93, 0.97, u));
    return mulc(col, 0.95 + 0.1 * n3(u * 40, th * 3, 2));
  }, { nu: 60, nv: 52, sq: 0.92, rad: (u, th, s, c) => { const r = ruff(u, th, s, c); return 1 + r * (0.36 + 0.16 * (n3(th * 7, u * 26, 7) - 0.5)); } });
  part(h, G.sph, mat(0x161210, 0.25), [0, -0.008, 0.166], [0.014, 0.011, 0.011]);
  [-1, 1].forEach((sx, i) => {
    foxEye(h, sx);
    const e = J[i ? 'earR' : 'earL'] = joint(h, sx * 0.036, 0.058, -0.005); e.rotation.set(-0.05, sx * 0.35, -sx * 0.24);
    loft(e, [[0, -0.008, 0, 0.04, 0.013], [0, 0.03, 0.001, 0.034, 0.011], [0, 0.065, 0, 0.018, 0.007], [0, 0.092, -0.003, 0.003, 0.002]], (u, th, s) => s > 0.35 ? mixc(OR, BK, ss(0.75, 0.95, u)) : mixc(mixc(OR, ORD, 0.3), BK, ss(0.3, 0.55, u)), { up: [0, 0, 1], nu: 20, nv: 18, sq: 0.75 });
    loft(e, [[0, 0, 0.009, 0.028, 0.006], [0, 0.035, 0.01, 0.022, 0.005], [0, 0.065, 0.008, 0.009, 0.003], [0, 0.078, 0.006, 0.002, 0.001]], u => mixc(CR, lin(0xd8c8b2), u * 0.5), { up: [0, 0, 1], nu: 14, nv: 12, fuzz: 0.3 });
  });
  J.ik = J.legs.map(l => ({ chain: [l.U, l.K], end: l.F, tip: [0, -0.019, 0.018] })); J.ct = [];
  return { R, J };
}
/* ── 다람쥐: 등에 다섯 줄, 납작하고 복슬복슬한 꼬리. 실제보다 1.5배 ── */
function squirrelModel() {
  const R = new THREE.Group(), J = { hind: [], front: [] }, b = J.body = joint(R, 0, 0.042, 0);
  const RB = lin(0xa8683a), FL = lin(0xc8874e), GR = lin(0x8a7a68), CRM = lin(0xece0c8), DK = lin(0x2e2118), LT = lin(0xeadcc2), PW = lin(0x8a6a50), K = Skin();
  const hs = [-1, 1].map(sx => { const U = joint(b, sx * 0.022, -0.004, -0.04), F = joint(U, 0, -0.024, -0.004); J.hind.push({ U, F }); return { U, F }; });
  const fs = [-1, 1].map(sx => { const Fr = joint(b, sx * 0.015, -0.018, 0.034); J.front.push(Fr); return Fr; });
  const t = J.tail = joint(b, 0, 0.008, -0.072);
  const infl = [...hs.map(q => ({ b: q.U, c: cOf(R, q.U), r0: 0.012, r1: 0.035, max: 0.45 })), ...fs.map(f => ({ b: f, c: cOf(R, f), r0: 0.006, r1: 0.02, max: 0.4 })), { b: t, c: cOf(R, t), r0: 0.008, r1: 0.025, max: 0.4 }];
  const stripe = (u, th) => {
    const a = Math.abs(wrapPI(th - Math.PI / 2)), on = ss(0.08, 0.16, u) * (1 - ss(0.8, 0.9, u));
    const d = Math.max(1 - ss(0.03, 0.07, a), 1 - ss(0.03, 0.065, Math.abs(a - 0.42)), 1 - ss(0.025, 0.055, Math.abs(a - 0.86))), l = 1 - ss(0.04, 0.09, Math.abs(a - 0.64));
    return [d * on, l * on];
  };
  skinLoft(K, R, [[b, 0, 0.002, -0.078, 0.012, 0.012], [b, 0, 0.006, -0.062, 0.036, 0.038], [b, 0, 0.007, -0.02, 0.036, 0.04], [b, 0, 0.009, 0.02, 0.03, 0.035], [b, 0, 0.017, 0.05, 0.023, 0.025]],
    (u, th, s) => { let c = mixc(GR, RB, ss(0.1, 0.5, u)); c = mixc(c, FL, ss(0.3, -0.2, s) * 0.7); const [d, l] = stripe(u, th); c = mixc(c, LT, l); c = mixc(c, DK, d); c = mixc(c, CRM, ss(-0.3, -0.6, s)); return mulc(c, 0.93 + 0.14 * n3(u * 40, th * 4, 1)); },
    { nu: 44, nv: 32, infl });
  hs.forEach(({ U, F }) => skinLoft(K, R, [[U, 0, 0.016, 0.006, 0.013, 0.017, [[b, 1]]], [U, 0, 0.004, 0.006, 0.017, 0.021, [[b, 0.35], [U, 0.65]]], [U, 0, -0.012, 0.002, 0.013, 0.014], [U, 0, -0.021, -0.002, 0.007, 0.008], [F, 0, 0, -0.004, 0.0055, 0.006, [[U, 0.5], [F, 0.5]]], [F, 0, -0.006, 0.008, 0.006, 0.0045], [F, 0, -0.008, 0.022, 0.004, 0.003]],
    u => mixc(mixc(FL, GR, ss(0.2, 0.5, u) * 0.4), PW, ss(0.55, 0.7, u)), { up: [0, 0, 1], nu: 32, nv: 14, round: true }));
  fs.forEach(Fr => skinLoft(K, R, [[Fr, 0, 0.012, -0.002, 0.008, 0.009, [[b, 1]]], [Fr, 0, 0.002, 0, 0.0075, 0.0085, [[b, 0.4], [Fr, 0.6]]], [Fr, 0, -0.01, 0.004, 0.0055, 0.0055], [Fr, 0, -0.02, 0.008, 0.0045, 0.004], [Fr, 0, -0.023, 0.013, 0.004, 0.003]],
    u => mixc(FL, PW, ss(0.4, 0.8, u)), { up: [0, 0, 1], nu: 22, nv: 12, round: true }));
  skinLoft(K, R, [[t, 0, 0.002, 0.02, 0.012, 0.012, [[b, 1]]], [t, 0, 0, 0.004, 0.009, 0.008, [[b, 0.5], [t, 0.5]]], [t, 0, 0.003, -0.028, 0.014, 0.01], [t, 0, 0.02, -0.062, 0.02, 0.012], [t, 0, 0.055, -0.082, 0.024, 0.013], [t, 0, 0.095, -0.082, 0.023, 0.012], [t, 0, 0.124, -0.068, 0.016, 0.009], [t, 0, 0.138, -0.054, 0.003, 0.002]],
    (u, th, s, c) => { const e = Math.abs(c) * ss(0.15, 0.3, u); let col = mixc(lin(0x7a6048), RB, 0.4); col = mixc(col, DK, ss(0.7, 0.82, e) * (1 - ss(0.9, 0.97, e))); col = mixc(col, LT, ss(0.92, 0.99, e)); return mulc(col, 0.9 + 0.2 * n3(u * 60, th * 6, 3)); },
    { fuzz: 0.16, fzu: u => ss(0.14, 0.3, u), nu: 52, nv: 26 });
  buildSkin(K, R);
  const h = J.head = joint(b, 0, 0.018, 0.052);
  loft(h, [[0, 0, -0.022, 0.02, 0.021], [0, 0.005, 0, 0.026, 0.025], [0, 0.003, 0.022, 0.024, 0.021], [0, -0.003, 0.04, 0.012, 0.011], [0, -0.005, 0.05, 0.003, 0.003]], (u, th, s, c) => {
    let col = mixc(RB, FL, 0.3); const side = Math.abs(c), band = (lo, hi) => ss(lo - 0.04, lo, s) * (1 - ss(hi, hi + 0.04, s)) * ss(0.2, 0.35, u) * (1 - ss(0.8, 0.9, u)) * ss(0.3, 0.6, side);
    col = mixc(col, LT, band(0.34, 0.5)); col = mixc(col, DK, band(0.12, 0.28)); col = mixc(col, LT, band(-0.12, 0.05)); col = mixc(col, CRM, ss(-0.3, -0.6, s));
    if (u > 0.85) col = mixc(col, lin(0x8a5a40), 0.5);
    return col;
  }, { nu: 28, nv: 28 });
  part(h, G.sph, mat(0x5a3a30, 0.5), [0, -0.004, 0.05], [0.004, 0.0035, 0.003]);
  [-1, 1].forEach(sx => {
    eye(h, sx * 0.0195, 0.008, 0.022, 0.0062);
    const e = joint(h, sx * 0.013, 0.022, -0.006); e.rotation.set(-0.2, 0, -sx * 0.3);
    loft(e, [[0, -0.002, 0, 0.008, 0.003], [0, 0.007, 0, 0.0085, 0.003], [0, 0.012, 0, 0.003, 0.0015]], u => u > 0.6 ? LT : RB, { up: [0, 0, 1], nu: 8, nv: 12 });
  });
  J.ik = [...J.hind.map(q => ({ chain: [q.U, q.F], end: q.F, tip: [0, -0.011, 0.012] })), ...J.front.map(f => ({ chain: [f], end: f, tip: [0, -0.026, 0.012] }))];
  J.ct = [[b, 0, -0.036, -0.062], [b, 0, -0.03, 0.02]];
  R.scale.setScalar(1.5);
  return { R, J };
}
/* ── 산토끼: 겨울털이라 하얗고 귀 끝만 검다 ── */
function hareModel() {
  const R = new THREE.Group(), J = { hind: [], front: [] }, b = J.body = joint(R, 0, 0.11, 0);
  const WH = lin(0xf4f5f7), SH = lin(0xd5d8de), BK = lin(0x1d1d21), PK = lin(0xe2c6c6), fur = (c, u, th) => mulc(c, 0.95 + 0.08 * n3(u * 40, th * 4, 5)), K = Skin();
  const hs = [-1, 1].map(sx => { const U = joint(b, sx * 0.055, -0.02, -0.09), F = joint(U, 0, -0.055, 0.035); J.hind.push({ U, F }); return { U, F }; });
  const fs = [-1, 1].map(sx => { const Fr = joint(b, sx * 0.03, -0.035, 0.065); J.front.push(Fr); return Fr; });
  const infl = [...hs.map(q => ({ b: q.U, c: cOf(R, q.U), r0: 0.035, r1: 0.1, max: 0.45 })), ...fs.map(f => ({ b: f, c: cOf(R, f), r0: 0.015, r1: 0.05, max: 0.4 }))];
  skinLoft(K, R, [[b, 0, 0.02, -0.175, 0.02, 0.02], [b, 0, 0.025, -0.145, 0.08, 0.085], [b, 0, 0.02, -0.07, 0.088, 0.095], [b, 0, 0.025, 0.02, 0.072, 0.085], [b, 0, 0.045, 0.08, 0.05, 0.06], [b, 0, 0.06, 0.1, 0.035, 0.04]],
    (u, th, s) => fur(mixc(WH, SH, ss(-0.3, -0.9, s) * 0.6), u, th), { nu: 44, nv: 32, fuzz: 0.03, infl });
  hs.forEach(({ U, F }) => {
    skinLoft(K, R, [[U, 0, 0.045, -0.005, 0.035, 0.05, [[b, 1]]], [U, 0, 0.02, 0.01, 0.042, 0.058, [[b, 0.35], [U, 0.65]]], [U, 0, -0.02, 0.022, 0.036, 0.042], [U, 0, -0.045, 0.02, 0.022, 0.024], [F, 0, 0.004, -0.05, 0.016, 0.016, [[U, 0.5], [F, 0.5]]]], (u, th) => fur(WH, u, th), { up: [0, 0, 1], nu: 30, nv: 18, round: true });
    skinLoft(K, R, [[F, 0, 0.004, -0.068, 0.016, 0.014, [[U, 0.4], [F, 0.6]]], [F, 0, -0.012, -0.02, 0.019, 0.012], [F, 0, -0.02, 0.03, 0.014, 0.009], [F, 0, -0.022, 0.045, 0.006, 0.005]], (u, th) => fur(SH, u, th), { nu: 24, nv: 16, round: true });
  });
  fs.forEach(Fr => skinLoft(K, R, [[Fr, 0, 0.03, -0.005, 0.02, 0.022, [[b, 1]]], [Fr, 0, 0.008, 0, 0.017, 0.018, [[b, 0.4], [Fr, 0.6]]], [Fr, 0, -0.04, 0.004, 0.012, 0.012], [Fr, 0, -0.07, 0.012, 0.011, 0.01], [Fr, 0, -0.075, 0.025, 0.006, 0.005]], (u, th) => fur(WH, u, th), { up: [0, 0, 1], nu: 26, nv: 14, round: true }));
  buildSkin(K, R);
  const h = J.head = joint(b, 0, 0.07, 0.11);
  loft(h, [[0, 0, -0.04, 0.038, 0.042], [0, 0.01, 0, 0.048, 0.048], [0, 0.004, 0.04, 0.044, 0.04], [0, -0.008, 0.072, 0.025, 0.023], [0, -0.012, 0.092, 0.006, 0.006]], (u, th) => fur(u > 0.9 ? PK : WH, u, th), { nu: 28, nv: 26 });
  part(h, G.sph, mat(0xc99a9a, 0.5), [0, -0.009, 0.09], [0.008, 0.006, 0.005]);
  [-1, 1].forEach((sx, i) => {
    eye(h, sx * 0.038, 0.012, 0.04, 0.0105, 0x5a3c24);
    const e = J[i ? 'earR' : 'earL'] = joint(h, sx * 0.018, 0.042, -0.012); e.rotation.z = -sx * 0.12;
    loft(e, [[0, -0.004, 0, 0.016, 0.008], [0, 0.04, -0.004, 0.022, 0.008], [0, 0.085, -0.006, 0.018, 0.006], [0, 0.112, -0.004, 0.008, 0.004], [0, 0.12, -0.003, 0.002, 0.002]], (u, th, s) => u > 0.84 ? BK : s > 0.25 && u < 0.82 ? mixc(PK, WH, 0.4) : WH, { up: [0, 0, 1], nu: 20, nv: 16 });
  });
  part(b, G.sph, mat(0xf4f5f7, 0.95), [0, 0.04, -0.17], [0.028, 0.028, 0.024]);
  J.ik = [...J.hind.map(q => ({ chain: [q.U, q.F], end: q.F, tip: [0, -0.03, 0.005] })), ...J.front.map(f => ({ chain: [f], end: f, tip: [0, -0.08, 0.022] }))];
  J.ct = [[b, 0, -0.066, -0.13], ...J.hind.map(q => [q.F, 0, -0.016, -0.066])];
  return { R, J };
}
/* ── 오리: 깃털 한 장(feather)씩 겹쳐 붙인 날개 ── */
function feather(p, x, y, z, len, wid, yaw, lift, base, edge, o = {}) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(lift, yaw, o.roll || 0); p.add(g);
  loft(g, [[0, 0, 0, wid * 0.45, 0.0022], [0, 0.0005, -len * 0.45, wid * 0.5, 0.0028], [0, -0.001, -len * 0.88, wid * 0.32, 0.002], [0, -0.0015, -len, 0.0015, 0.001]], (u, th, s, c) => {
    const ac = Math.abs(c); let col = base;
    if (o.tip) col = mixc(col, o.tip, ss(o.tipAt, o.tipAt + 0.06, u));
    col = mixc(col, edge, ss(0.72, 0.9, ac)); if (ac < 0.08 && s > 0) col = mulc(col, 0.75);
    return col;
  }, { nu: 10, nv: 12, mat: o.mat });
  return g;
}
/* 날개 하나: 바탕 → 덮깃 두 줄 → 흰 끝의 청록 날개 무늬 → 담황색 테두리의 셋째날개깃 → 꼬리 위로 겹치는 첫째날개깃 */
function duckWing(b, sx) {
  const w = new THREE.Group(); w.position.set(sx * 0.074, 0.106, 0.06); w.rotation.set(-0.06, 0, -sx * 0.46); b.add(w);
  const BR = lin(0x4a3a2c), DK = lin(0x34281f), PE = lin(0xa08664), BU = lin(0xcdb894), SP = lin(0x1f6f7c), SPW = lin(0xf2eee4), PR = lin(0x2a221c);
  loft(w, [[0, -0.006, 0.025, 0.03, 0.01], [0, 0, -0.04, 0.048, 0.013], [0, -0.003, -0.14, 0.04, 0.011], [0, -0.008, -0.21, 0.012, 0.004]], () => DK, { nu: 20, nv: 16 });
  [[-0.022, 0.006], [-0.005, 0.008], [0.012, 0.007], [0.028, 0.004]].forEach(([x, z]) => feather(w, sx * x, 0.011, z, 0.045, 0.022, 0, 0.05, BR, PE));
  [[-0.03, -0.018], [-0.012, -0.016], [0.006, -0.018], [0.024, -0.02], [0.04, -0.024]].forEach(([x, z]) => feather(w, sx * x, 0.013, z, 0.05, 0.022, 0, 0.06, BR, PE));
  [[0, -0.05], [0.014, -0.052], [0.028, -0.055], [0.042, -0.058]].forEach(([x, z]) => feather(w, sx * x, 0.008, z, 0.075, 0.018, sx * 0.05, 0.04, SP, SPW, { mat: VCM, tip: SPW, tipAt: 0.85 }));
  [[-0.03, -0.045, 0.12], [-0.016, -0.05, 0.115], [-0.002, -0.056, 0.105]].forEach(([x, z, l], i) => feather(w, sx * x, 0.017 - i * 0.001, z, l, 0.026, -sx * 0.04, 0.03, BR, i === 2 ? SPW : BU));
  [[0.02, -0.09], [0.01, -0.098], [0, -0.104], [-0.01, -0.108]].forEach(([x, z]) => feather(w, sx * x, 0.006, z, 0.13, 0.016, -sx * 0.06, 0.02, PR, lin(0x4a4038)));
}
function duckModel(chick) {
  const R = new THREE.Group(), J = { ik: [], ct: [] }, b = J.body = joint(R, 0, 0, 0);
  if (!chick) {
    const BR = lin(0x4d3d2e), ED = lin(0x8c7458), WG = lin(0x3a2e24), BU = lin(0xd6c6a6), BL = lin(0x232120), YL = lin(0xe2b53c);
    loft(b, [[0, 0.085, -0.235, 0.01, 0.006], [0, 0.068, -0.18, 0.07, 0.035], [0, 0.045, -0.09, 0.112, 0.075], [0, 0.042, 0.02, 0.12, 0.08], [0, 0.052, 0.11, 0.095, 0.075], [0, 0.07, 0.165, 0.055, 0.055], [0, 0.09, 0.19, 0.02, 0.02]],
      (u, th, s, c) => { const f = (u * 18 + Math.abs(c) * 4) % 1; let col = mixc(BR, ED, ss(0.6, 0.95, f) * 0.6); if (u > 0.72) col = mixc(col, mixc(ED, BU, 0.3), ss(0.72, 0.85, u) * 0.6); return col; },
      { nu: 44, nv: 32, flat: 0.75 });
    duckWing(b, -1); duckWing(b, 1);
    const h = J.head = joint(b, 0, 0.075, 0.15);
    loft(h, [[0, -0.025, -0.02, 0.042, 0.042], [0, 0.035, 0, 0.033, 0.034], [0, 0.08, 0.012, 0.038, 0.04], [0, 0.09, 0.045, 0.035, 0.035], [0, 0.082, 0.072, 0.022, 0.02]], (u, th, s, c) => {
      let col = mixc(ED, BU, ss(0.1, 0.35, u)); col = mixc(col, WG, ss(0.45, 0.65, s) * ss(0.45, 0.6, u));
      const st = ss(0.05, 0.12, s) * (1 - ss(0.2, 0.28, s)) * ss(0.6, 0.7, u) * ss(0.4, 0.7, Math.abs(c));
      return mixc(col, WG, st * 0.85);
    }, { nu: 32, nv: 26 });
    loft(h, [[0, 0.078, 0.068, 0.018, 0.009], [0, 0.072, 0.1, 0.016, 0.006], [0, 0.066, 0.124, 0.012, 0.004]], u => u > 0.75 ? YL : BL, { nu: 14, nv: 16 });
    [-1, 1].forEach(sx => eye(h, sx * 0.031, 0.088, 0.058, 0.0062));
  } else {
    const DB = lin(0x5a4630), YE = lin(0xd8c27a), BL = lin(0x3a3028);
    loft(b, [[0, 0.04, -0.062, 0.01, 0.01], [0, 0.035, -0.045, 0.045, 0.04], [0, 0.033, 0, 0.05, 0.045], [0, 0.04, 0.035, 0.04, 0.038], [0, 0.05, 0.055, 0.015, 0.015]], (u, th, s) => mulc(mixc(YE, DB, ss(0.2, 0.6, s)), 0.92 + 0.16 * n3(u * 40, th * 5, 2)), { fuzz: 0.08, nu: 28, nv: 22 });
    const h = J.head = joint(b, 0, 0.068, 0.042);
    loft(h, [[0, -0.012, -0.016, 0.026, 0.026], [0, 0.01, 0.004, 0.033, 0.032], [0, 0.01, 0.028, 0.026, 0.024], [0, 0.004, 0.044, 0.008, 0.008]], (u, th, s, c) => {
      const col = mixc(YE, DB, ss(0.45, 0.7, s)), st = ss(0, 0.08, s) * (1 - ss(0.18, 0.26, s)) * ss(0.5, 0.7, Math.abs(c)) * ss(0.35, 0.5, u);
      return mulc(mixc(col, DB, st * 0.8), 0.94 + 0.12 * n3(u * 40, th * 5, 6));
    }, { fuzz: 0.06, nu: 24, nv: 20 });
    loft(h, [[0, 0.002, 0.04, 0.009, 0.005], [0, -0.002, 0.058, 0.006, 0.003]], () => BL, { nu: 8, nv: 12 });
    [-1, 1].forEach(sx => eye(h, sx * 0.024, 0.014, 0.024, 0.0048));
  }
  return { R, J };
}
/* ── 달랑게: 네모진 등딱지, 끝이 검은 긴 자루 눈, 한쪽이 큰 집게, 두 마디 다리 8개. 1.3배 ── */
function crabModel() {
  const R = new THREE.Group(), J = { legs: [], claws: [], ik: [] }, b = J.body = joint(R, 0, 0.03, 0);
  const SA = lin(0xd9c7a0), SD = lin(0xb09a74), WH = lin(0xf0e6d0), DK = lin(0x2a241f);
  loft(b, [[0, -0.004, -0.046, 0.026, 0.01], [0, 0, -0.036, 0.048, 0.019], [0, 0.003, -0.005, 0.056, 0.022], [0, 0.003, 0.028, 0.052, 0.02], [0, 0, 0.041, 0.036, 0.012], [0, -0.004, 0.046, 0.01, 0.004]],
    (u, th, s, c, p) => { let col = mixc(SA, WH, ss(-0.2, -0.6, s)); if (s > 0) col = mixc(col, SD, ss(0.6, 0.7, n3(p.x * 120, 0, p.z * 120)) * 0.7); return col; }, { sq: 0.62, nu: 24, nv: 32, flat: 0.8 });
  [-1, 1].forEach(sx => {
    const E = joint(b, sx * 0.02, 0.012, 0.036);
    loft(E, [[0, 0, 0, 0.004, 0.004], [0, 0.018, 0.002, 0.0042, 0.0042], [0, 0.024, 0.003, 0.0055, 0.005], [0, 0.04, 0.006, 0.0048, 0.004], [0, 0.044, 0.007, 0.002, 0.002]], u => u > 0.45 ? DK : SA, { nu: 14, nv: 10 });
    const C = joint(b, sx * 0.036, -0.002, 0.04), k = sx > 0 ? 1 : 0.65;
    loft(C, [[0, 0, 0, 0.006, 0.005], [sx * 0.012, 0.004, 0.014, 0.007, 0.006], [sx * 0.018, 0.006, 0.022, 0.011 * k, 0.009 * k], [sx * 0.022, 0.006, 0.038, 0.01 * k, 0.007 * k], [sx * 0.024, 0.004, 0.05, 0.004, 0.003]], u => u > 0.3 ? mixc(WH, SA, 0.2) : SA, { nu: 18, nv: 14 });
    const Fg = joint(C, sx * 0.02, 0.012 * k, 0.036);
    loft(Fg, [[0, 0, 0, 0.004 * k + 0.001, 0.003], [sx * 0.003, -0.002, 0.012 * k, 0.003, 0.0025], [sx * 0.004, -0.005, 0.02 * k, 0.001, 0.001]], () => WH, { nu: 8, nv: 8 });
    J.claws.push({ C, Fg });
    for (let j = 0; j < 4; j++) {
      const L = joint(b, sx * 0.046, 0, 0.02 - j * 0.018); L.rotation.y = sx * (0.35 - j * 0.28);
      loft(L, [[0, 0, 0, 0.0055, 0.004], [sx * 0.018, 0.012, 0, 0.0055, 0.0045], [sx * 0.035, 0.018, 0, 0.0045, 0.004]], u => mixc(SA, SD, ss(0.85, 1, u)), { nu: 10, nv: 10 });
      const Kj = joint(L, sx * 0.035, 0.018, 0);
      loft(Kj, [[0, 0, 0, 0.0045, 0.0038], [sx * 0.014, -0.022, 0, 0.0038, 0.003], [sx * 0.026, -0.048, 0, 0.0015, 0.0012]], u => mixc(SA, SD, ss(0.7, 1, u)), { nu: 10, nv: 10 });
      J.legs.push({ L, K: Kj, sx, j, y0: L.rotation.y });
    }
  });
  J.ct = [...J.legs.map(l => [l.K, l.sx * 0.026, -0.049, 0]), [b, 0, -0.017, 0]];
  R.scale.setScalar(1.3);
  return { R, J };
}
/* ── 바다거북: 비늘판마다 볼록하고 이음매는 홈, 성장선·용골·테두리 톱니 ── */
function turtleModel() {
  const R = new THREE.Group(), J = { fl: [], ik: [] }, b = J.body = joint(R, 0, 0.065, 0);
  const SH = lin(0x5e5032), SL = lin(0x8f7846), SE = lin(0xc9b072), SG = lin(0x2e2618), PL = lin(0xd6c99a), SK = lin(0x6b6c4c), SKD = lin(0x45452f), SKL = lin(0xcfc48e);
  /* 등딱지 위치 → [비늘판 번호, 이음매까지 0..1, 가운데에서 먼 정도, 테두리 판 안 위치, 옆 거리] */
  const scute = (x, z) => {
    const nx = x / 0.43, nz = z / 0.55, r = Math.hypot(nx, nz), ax = Math.abs(nx); let id, e, kf = 0.5;
    if (r > 0.86) { const k = Math.atan2(nz, nx) / (TAU / 26); kf = k - Math.floor(k); id = 100 + Math.floor(k); e = Math.min(Math.min(kf, 1 - kf) * 3, (r - 0.86) * 12); }
    else if (ax < 0.27) { const bs = [-0.62, -0.28, 0.06, 0.4], d = bs.reduce((m, v) => Math.min(m, Math.abs(nz - v)), 9); id = bs.filter(v => nz > v).length; e = Math.min(d * 8, (0.27 - ax) * 10, (0.86 - r) * 12); }
    else { const zz = nz + ax * 0.1, bs = [-0.42, -0.05, 0.32], d = bs.reduce((m, v) => Math.min(m, Math.abs(zz - v)), 9); id = 10 + bs.filter(v => zz > v).length + (nx > 0 ? 5 : 0); e = Math.min(d * 8, (ax - 0.27) * 10, (0.86 - r) * 12); }
    return [id, clamp(e, 0, 1), r, kf, ax];
  };
  const sdisp = (q, u, th, s) => {
    if (s < -0.05) return 0;
    const [, e, r, kf, ax] = scute(q.x, q.z), up = ss(-0.05, 0.2, s);
    let d = 0.014 * ss(0, 0.32, e) * up + 0.0014 * Math.sin(e * 30) * ss(0.12, 0.5, e) * up;
    if (ax * 0.43 < 0.12) d += 0.007 * (1 - ax * 0.43 / 0.12) * ss(0, 0.4, e) * up;
    if (r > 0.88) { const bb = Math.min(kf, 1 - kf); d -= 0.016 * ss(0.88, 0.98, r) * Math.pow(1 - bb * 2, 4) * (q.z < 0 ? 1 : 0.5); }
    return d;
  };
  loft(b, [[0, -0.01, -0.56, 0.05, 0.02], [0, 0, -0.5, 0.25, 0.08], [0, 0.01, -0.3, 0.4, 0.15], [0, 0.015, 0, 0.43, 0.17], [0, 0.01, 0.3, 0.39, 0.15], [0, 0, 0.48, 0.27, 0.09], [0, -0.01, 0.55, 0.08, 0.03]], (u, th, s, c, p) => {
    if (s < -0.12) return mixc(PL, SE, 0.15);
    const [id, e] = scute(p.x, p.z), ray = 0.82 + 0.32 * n3(p.x * 30 + id * 3.1, id * 1.7, p.z * 30);
    let col = mulc(mixc(SH, SL, h3(id, 1, 2) * 0.5 + 0.35 * e), ray);
    col = mulc(col, 0.78 + 0.22 * ss(0.05, 0.25, e)); col = mixc(col, SE, 1 - ss(0.02, 0.07, e)); col = mixc(col, SG, (1 - ss(0, 0.025, e)) * 0.6);
    if (s < 0.05) col = mixc(col, SE, 0.35);
    return col;
  }, { sq: 0.85, flat: 0.35, nu: 150, nv: 150, disp: sdisp });
  const brick = (a, c, sc) => { const row = Math.floor(c * sc), x = a * sc + row * 0.5, fx = x - Math.floor(x), fy = c * sc - row; return Math.min(fx, 1 - fx, fy * 1.4, (1 - fy) * 1.4); };
  const h = J.head = joint(b, 0, 0.025, 0.5);
  loft(h, [[0, -0.01, -0.09, 0.085, 0.065], [0, 0, 0, 0.078, 0.062], [0, 0.012, 0.07, 0.076, 0.066], [0, 0.014, 0.13, 0.07, 0.062], [0, 0.002, 0.19, 0.05, 0.045], [0, -0.012, 0.222, 0.018, 0.016]], (u, th, s, c, p) => {
    if (s < -0.2) return SKL;
    let col = mixc(SK, SKD, ss(0.2, 0.8, s) * 0.5);
    if (u > 0.45 && s > -0.1) col = mixc(col, SKL, 1 - ss(0.05, 0.16, brick(p.x, p.z, 40)));
    if (u > 0.88) col = mixc(col, SE, 0.5);
    return col;
  }, { nu: 64, nv: 48, disp: (q, u, th, s) => u > 0.45 && s > -0.1 ? 0.003 * ss(0.03, 0.18, brick(q.x, q.z, 40)) : 0 });
  [-1, 1].forEach(sx => eye(h, sx * 0.058, 0.038, 0.15, 0.015, 0x3a2a18));
  const ct = [];
  [[-1, 0.27, true], [1, 0.27, true], [-1, -0.42, false], [1, -0.42, false]].forEach(([sx, z, front]) => {
    const F = joint(b, sx * (front ? 0.3 : 0.22), -0.02, z);
    const ctrl = front
      ? [[0, 0, 0, 0.06, 0.025], [sx * 0.18, -0.005, -0.02, 0.085, 0.018], [sx * 0.34, -0.012, -0.1, 0.065, 0.012], [sx * 0.45, -0.018, -0.2, 0.03, 0.006], [sx * 0.48, -0.02, -0.24, 0.004, 0.002]]
      : [[0, 0, 0, 0.045, 0.018], [sx * 0.07, -0.005, -0.05, 0.05, 0.012], [sx * 0.13, -0.01, -0.12, 0.03, 0.006], [sx * 0.15, -0.012, -0.15, 0.004, 0.002]];
    loft(F, ctrl, (u, th, s, c, p) => s < -0.1 ? mixc(SKL, PL, 0.4) : mixc(mixc(SKD, SK, 0.3), SKL, 1 - ss(0.06, 0.18, brick(p.x, p.z, 30))),
      { nu: 56, nv: 24, disp: (q, u, th, s) => s > 0 ? 0.0022 * ss(0.04, 0.2, brick(q.x, q.z, 30)) : 0 });
    J.fl.push({ F, sx, front });
    const tp = ctrl[ctrl.length - 2]; ct.push([F, tp[0], tp[1] - 0.012, tp[2]], [F, ctrl[1][0], ctrl[1][1] - 0.02, ctrl[1][2]]);
  });
  part(b, G.cone, mat(0x5a5a40), [0, -0.02, -0.58], [0.03, 0.08, 0.02], [-Math.PI / 2, 0, 0]);
  J.ct = [...ct, [b, 0.3, -0.058, 0.3], [b, -0.3, -0.058, 0.3], [b, 0.3, -0.058, -0.3], [b, -0.3, -0.058, -0.3], [b, 0, -0.064, 0]];
  return { R, J };
}

/* ══ 자세 (방장·친구 모두, 매 프레임) ══ */
/* 키프레임 곡선: 이웃 키로 기울기를 정한 3차 에르미트 — 속도까지 매끄럽다 */
function kf(tr, t) {
  t = clamp(t, tr[0][0], tr[tr.length - 1][0]); let i = 0; while (i < tr.length - 2 && t > tr[i + 1][0]) i++;
  const n = tr.length, t0 = tr[i][0], t1 = tr[i + 1][0], u = (t - t0) / (t1 - t0), d = t1 - t0, u2 = u * u, u3 = u2 * u, o = {};
  const tg = (j, k) => j <= 0 || j >= n - 1 ? 0 : (tr[j + 1][1][k] - tr[j - 1][1][k]) / (tr[j + 1][0] - tr[j - 1][0]);
  for (const k in tr[i][1]) { const p0 = tr[i][1][k], p1 = tr[i + 1][1][k]; o[k] = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * d * tg(i, k) + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * d * tg(i + 1, k); }
  return o;
}
/* 여우 쥐 사냥 (3.4초): 귀 기울이며 갸웃 → 웅크림 → 박차기 → 정점에서 앞발 모으기 → 앞발 뻗으며 다이빙 → 앞발로 눌러 박힘 → 멈춤 → 빠져나와 서기.
   마지막 자세가 처음과 같다. by 몸 높이 · bp 몸 기울기 · hp 머리 · hz 갸웃 · fl 등 굽힘 · off 뜬 높이 · fU·fK 앞다리 · hU·hK·hF 뒷다리 */
const FX0 = { by: 0.3, bp: 0, hp: 0.05, hz: 0, fl: 0, off: 0, fU: 0.05, fK: -0.05, hU: -0.35, hK: 0.7, hF: -0.35, ear: -0.05, tail: -0.05 };
const POUNCE = [[0, FX0],
  [0.45, { by: 0.3, bp: 0.05, hp: 0.42, hz: 0.18, fl: 0.02, off: 0, fU: 0.05, fK: -0.05, hU: -0.35, hK: 0.7, hF: -0.35, ear: 0.25, tail: 0 }],
  [0.95, { by: 0.255, bp: -0.05, hp: 0.32, hz: 0.05, fl: 0.1, off: 0, fU: 0.18, fK: -0.15, hU: -0.6, hK: 1.15, hF: -0.55, ear: 0.25, tail: 0.05 }],
  [1.15, { by: 0.29, bp: -0.42, hp: 0.06, hz: 0, fl: -0.12, off: 0.1, fU: -0.6, fK: 0.45, hU: 0.35, hK: 0.3, hF: 0.2, ear: 0.1, tail: 0.15 }],
  [1.45, { by: 0.3, bp: 0.15, hp: 0.15, hz: 0, fl: -0.02, off: 0.48, fU: -0.95, fK: 0.7, hU: 0.55, hK: 0.25, hF: 0.1, ear: -0.1, tail: 0.3 }],
  [1.75, { by: 0.3, bp: 0.92, hp: 0.2, hz: 0, fl: 0.1, off: 0.14, fU: -1.15, fK: 0.15, hU: 0.3, hK: 0.35, hF: -0.1, ear: -0.1, tail: 0.5 }],
  [1.92, { by: 0.3, bp: 1.02, hp: 0.25, hz: 0, fl: 0.14, off: 0, fU: -0.7, fK: 0.9, hU: 0.35, hK: 0.45, hF: -0.2, ear: -0.15, tail: 0.45 }],
  [2.5, { by: 0.3, bp: 0.96, hp: 0.28, hz: 0, fl: 0.12, off: -0.005, fU: -0.65, fK: 0.85, hU: 0.3, hK: 0.5, hF: -0.25, ear: -0.1, tail: 0.35 }],
  [3.0, { by: 0.297, bp: 0.3, hp: 0.15, hz: 0.06, fl: 0.03, off: 0, fU: 0, fK: 0.1, hU: -0.3, hK: 0.8, hF: -0.4, ear: 0.05, tail: 0.05 }],
  [3.4, FX0]];
function poseDuck(a, dt) {
  const J = a.J, T = A.T, k = 1 - Math.exp(-dt * 3), D = SPEC.duck.actDur;
  const dab = a.st === 'act' ? ss(0, 0.5, a.t) * (1 - ss(D - 0.6, D, a.t)) : 0;
  J.body.rotation.x = 1.25 * dab; J.body.position.y = 0.004 * Math.sin(T * 1.4 + a.id);
  J.head.rotation.x = a.st === 'alert' ? -0.3 : 0.06 * Math.sin(T * 0.5 + a.id);
  if ((a.st === 'roam' || a.st === 'rest') && Math.random() < dt / 14) sfxAt('quack', a.x, WATER_Y + 0.2, a.z, Math.random() < 0.4 ? 2 : 1);
  /* 새끼는 어미가 지나간 자리를 0.5m 간격으로 따라간다 */
  const tr = a.trail;
  if (!tr.length || Math.hypot(tr[0][0] - a.x, tr[0][1] - a.z) > 0.1) { tr.unshift([a.x, a.z]); if (tr.length > 60) tr.pop(); }
  a.kids.forEach((c, i) => {
    const n = (i + 1) * 5, d = 0.5 * (i + 1), p = tr.length > n ? tr[n] : [a.x - Math.sin(a.head) * d, a.z - Math.cos(a.head) * d];
    const tx = p[0] + Math.sin(T * 0.5 + i * 2) * 0.12, tz = p[1] + Math.cos(T * 0.4 + i) * 0.12, dx = tx - c.x, dz = tz - c.z;
    if (dx * dx + dz * dz > 1e-5) c.head = turnTo(c.head, Math.atan2(dx, dz), 3 * dt);
    c.x += dx * k; c.z += dz * k;
    if (a.st === 'rest' || a.st === 'act') { c.dabT -= dt; if (c.dabT <= 0) { c.dab = 2; c.dabT = rnd(4, 9); } }
    c.dab = Math.max(0, c.dab - dt);
    const cd = c.dab > 0 ? ss(0, 0.35, 2 - c.dab) * ss(0, 0.35, c.dab) : 0;
    c.J.body.rotation.x = 1.25 * cd; c.J.body.position.y = 0.003 * Math.sin(T * 1.8 + i);
    c.R.position.set(c.x, WATER_Y, c.z); c.R.rotation.y = c.head;
  });
}
/* 다람쥐: 뒷다리를 뒤로 뻗어 박차고(cos > 0), 공중에서 앞발을 내밀고, 내려앉으며 뒷다리를 앞으로 */
function poseSquirrel(a, dt) {
  const J = a.J, k = 1 - Math.exp(-dt * 6), mv = clamp(a.spd / 1.1, 0, 1), up = a.st === 'alert' ? 1.1 : a.st === 'rest' || a.st === 'act' ? 0.85 : 0;
  a.sit = lerp(a.sit, up, k); a.flick = Math.max(0, a.flick - dt);
  const hop = Math.max(0, Math.sin(a.ph)), c = Math.cos(a.ph), sn = Math.sin(a.ph);
  J.body.position.y = 0.042 + hop * 0.04 * mv + a.sit * 0.028; J.body.rotation.x = -a.sit - c * 0.22 * mv; a.air = hop * mv > 0.3;
  J.head.rotation.x = a.sit * 0.75 + c * 0.12 * mv + (a.st === 'act' ? 0.2 + 0.08 * Math.sin(A.T * 9) : 0);
  J.hind.forEach(hl => { hl.U.rotation.x = a.sit * 0.85 + c * 0.65 * mv; hl.F.rotation.x = -a.sit * 0.3 + Math.max(0, c) * 0.45 * mv; });
  J.front.forEach((f, i) => { f.rotation.x = a.st === 'act' ? -0.6 * a.sit + 0.12 * Math.sin(A.T * 9 + i) : -a.sit * 0.3 - sn * 0.65 * mv; });
  J.tail.rotation.x = a.sit * 0.55 - 0.25 * mv + 0.15 * sn * mv + (a.flick > 0 ? 0.25 * Math.sin(A.T * 22) : 0) + 0.03 * Math.sin(A.T * 1.3);
}
/* 산토끼: 박찰 때 뒷다리를 뒤로 길게, 내려앉을 때 뒷발이 앞발보다 앞에 */
function poseHare(a, dt) {
  const J = a.J, k = 1 - Math.exp(-dt * 6), mv = clamp(a.spd / 1.2, 0, 1), run = clamp(a.spd / 5, 0, 1), hop = Math.max(0, Math.sin(a.ph)), c = Math.cos(a.ph), sn = Math.sin(a.ph);
  a.sit = lerp(a.sit, a.st === 'alert' ? 1 : a.st === 'act' ? 0.75 : 0, k);
  J.body.position.y = 0.11 + hop * (0.04 + 0.1 * run) * mv + a.sit * 0.05; J.body.rotation.x = -c * (0.22 + 0.15 * run) * mv - a.sit * 0.6; a.air = hop * mv > 0.3;
  J.head.rotation.x = a.sit * 0.5 + (a.st === 'rest' ? 0.2 : 0) + c * 0.1 * mv; J.head.position.z = 0.11 + (a.st === 'rest' ? 0.0015 * Math.sin(A.T * 7) : 0);
  J.hind.forEach(hl => { hl.U.rotation.x = a.sit * 0.6 + c * (0.5 + 0.45 * run) * mv; hl.F.rotation.x = -a.sit * 0.4 + Math.max(0, c) * (0.45 + 0.25 * run) * mv; });
  J.front.forEach(f => { f.rotation.x = -a.sit * 0.3 - sn * (0.5 + 0.5 * run) * mv; });
  const ear = a.st === 'flee' ? -1.0 : a.st === 'alert' || a.st === 'act' ? 0.08 : a.st === 'rest' ? -0.75 : -0.3 - 0.3 * run;
  a.ear = lerp(a.ear, ear, k);
  J.earL.rotation.x = a.ear + 0.04 * Math.sin(A.T * 1.6 + a.id); J.earR.rotation.x = a.ear + 0.04 * Math.sin(A.T * 1.9 + a.id);
}
/* 여우: 걷기·빠른 걸음은 트롯, 빨라질수록(g) 질주로 — 다리를 모으며 등을 말고, 뻗으며 등을 편다. 쥐 사냥은 POUNCE */
function poseFox(a, dt) {
  const J = a.J, k = 1 - Math.exp(-dt * 6);
  if (a.st === 'act') {
    const v = kf(POUNCE, a.t);
    J.body.position.y = v.by; J.body.rotation.x = v.bp; J.chest.rotation.x = v.fl; J.hip.rotation.x = -v.fl;
    J.head.rotation.x = v.hp - v.fl; J.head.rotation.z = v.hz; a.offY = v.off; a.air = v.off > 0.03;
    J.legs.forEach(l => { l.U.rotation.x = l.front ? v.fU : v.hU; l.K.rotation.x = l.front ? v.fK : v.hK; l.F.rotation.x = l.front ? 0 : v.hF; });
    a.ear = v.ear; J.earL.rotation.x = J.earR.rotation.x = v.ear; J.tail.rotation.x = v.tail; J.tail.rotation.y = 0.08 * Math.sin(A.T * 0.9);
    if (a.t > 1.88 && !a.landed) { a.landed = true; const y = a.R.position.y + 0.15; sfxAt('snowPop', a.x, y, a.z); sfxAt('snowDrop', a.x, y, a.z, 0.1); }
    return;
  }
  const mv = clamp(a.spd / 0.9, 0, 2), m1 = Math.min(1, mv), g = ss(1.9, 3.4, a.spd), p = a.ph, sw = (0.3 * m1 + 0.12 * Math.max(0, mv - 1)) * (1 - g);
  a.air = false;
  const by = 0.3 + Math.abs(Math.cos(p)) * 0.01 * m1 * (1 - g) + g * 0.028 * (0.5 - 0.5 * Math.cos(p));
  const bp = 0.015 * Math.sin(p * 2) * m1 * (1 - g) + g * 0.05 * Math.sin(p), flex = -0.15 * g * Math.cos(p);
  const hp = a.st === 'rest' ? 0.6 + 0.06 * Math.sin(A.T * 1.1) : a.st === 'alert' ? -0.3 : lerp(0.05 + 0.03 * Math.sin(p * 2) * m1, -0.18 + 0.05 * Math.cos(p) - bp, g);
  J.legs.forEach(l => {
    const q = p + l.ph, s = Math.sin(q), w = Math.max(0, -Math.cos(q)) * m1;
    let U = l.u0 + s * sw, K = l.k0, F = l.f0;
    if (l.front) { K += w * 0.9; F += w * 0.4; } else { K += w * 0.5; F -= w * 0.3; }
    if (g > 0) {
      const qg = l.front ? p + Math.PI + l.go : p + l.go, cg = Math.cos(qg), sg = Math.max(0, Math.sin(qg)), ext = Math.max(0, cg);
      let Ug, Kg, Fg;
      if (l.front) { Ug = l.u0 + 0.1 + 0.78 * cg; Kg = l.k0 + 1.25 * sg; Fg = l.f0 + 0.55 * sg - 0.1 * ext; }
      else { Ug = l.u0 + 0.15 + 0.72 * cg; Kg = l.k0 + 0.75 * sg - 0.3 * ext; Fg = l.f0 - 0.45 * sg + 0.35 * ext; }
      U = lerp(U, Ug, g); K = lerp(K, Kg, g); F = lerp(F, Fg, g);
    }
    l.U.rotation.x = U; l.K.rotation.x = K; l.F.rotation.x = F;
  });
  J.body.position.y = by; J.body.rotation.x = bp; J.chest.rotation.x = flex; J.hip.rotation.x = -flex;
  J.head.rotation.x = hp - flex; J.head.rotation.z = a.st === 'rest' ? 0.08 * Math.sin(A.T * 0.6) : a.st === 'alert' ? 0.12 : 0;
  a.ear = lerp(a.ear, a.st === 'alert' ? 0.18 : lerp(-0.05, -0.45, g), k); J.earL.rotation.x = J.earR.rotation.x = a.ear;
  J.tail.rotation.x = lerp(-0.05 + 0.05 * Math.sin(A.T * 0.8), 0.38 + 0.1 * Math.sin(p + 0.6) + flex, g);
  J.tail.rotation.y = 0.12 * Math.sin(A.T * 0.7 + a.id) * (a.st === 'rest' ? 1 : 0.4) * (1 - g);
}
function poseCrab(a, dt) {
  const J = a.J, mv = Math.min(1, a.spd / 0.3), dig = a.st === 'act', w = dig ? 1 : mv, D = SPEC.crab.actDur;
  J.legs.forEach(l => {
    const p = (dig ? A.T * 14 : a.ph * 2) + l.j * 1.3 + (l.sx > 0 ? 0 : Math.PI), s = Math.sin(p), lift = Math.max(0, Math.cos(p));
    l.L.rotation.y = l.y0 + s * 0.3 * w; l.L.rotation.z = l.sx * lift * 0.25 * w; l.K.rotation.z = -l.sx * lift * 0.3 * w;
  });
  a.sit = lerp(a.sit, a.st === 'alert' ? 1 : 0, 1 - Math.exp(-dt * 6));
  J.claws.forEach(c => { c.C.rotation.x = -0.7 * a.sit; c.Fg.rotation.y = 0.25 * a.sit * Math.max(0, Math.sin(A.T * 3)); });
  J.body.position.y = 0.03 + 0.002 * Math.abs(Math.sin(a.ph * 2)) * mv + 0.008 * a.sit;
  J.body.rotation.z = dig ? 0.1 * Math.sin(A.T * 18) : 0;
  if (dig) a.dig = -0.08 * ss(0.1, D, a.t);
}
function poseTurtle(a, dt) {
  const J = a.J, k = 1 - Math.exp(-dt * 3), mv = clamp(a.spd / 0.14, 0, 1), dig = a.st === 'act';
  a.tuck = lerp(a.tuck, a.st === 'alert' ? 1 : 0, k);
  J.fl.forEach(f => {
    if (a.swim) { f.F.rotation.y = f.sx * (f.front ? 0.25 : 0.15) * Math.sin(a.ph - 1); f.F.rotation.z = -f.sx * (f.front ? 0.55 : 0.2) * Math.sin(a.ph); }
    else if (f.front) { f.F.rotation.y = f.sx * 0.5 * Math.sin(a.ph) * mv; f.F.rotation.z = -f.sx * 0.18 * Math.max(0, Math.cos(a.ph)) * mv; }
    else { f.F.rotation.z = 0; f.F.rotation.y = f.sx * (dig ? 0.55 * Math.sin(A.T * 1.8 + (f.sx > 0 ? 0 : Math.PI)) : 0.2 * Math.sin(a.ph + 1) * mv); }
  });
  J.body.position.y = 0.065 + (a.swim ? 0.015 * Math.sin(a.ph * 2) : 0.02 * Math.max(0, -Math.cos(a.ph)) * mv);
  J.body.rotation.x = (dig ? -0.05 : 0) + 0.015 * Math.sin(a.ph) * mv;
  J.head.position.z = 0.5 - 0.12 * a.tuck; J.head.rotation.x = 0.04 * Math.sin(A.T * 0.4) - 0.05 * a.tuck;
  if (dig) { a.sndT = (a.sndT || 0) - dt; if (a.sndT <= 0) { a.sndT = rnd(1.2, 2); sfxAt('plant', a.x, a.R.position.y + 0.1, a.z, 'sand'); } }
}

/* ══ 다닐 수 있는 곳 ══ */
const shoreZ = x => ctx.W.cfg.water.z + shoreOff(x, ctx.W.cfg);
/* 땅: 물 밖, 캠프 소품·부두·나무 줄기·바위에서 pad 만큼 떨어진 곳 */
function groundOk(x, z, pad = 0.12) {
  const W = ctx.W;
  if (x * x + z * z > 70 * 70 || hT(x, z) < WATER_Y + 0.08) return false;
  for (const b of blocks()) if (x > b.x[0] - pad && x < b.x[1] + pad && z > b.z[0] - pad && z < b.z[1] + pad) return false;
  for (const p of W.platforms) if (x > p.x[0] && x < p.x[1] && z > p.z[0] && z < p.z[1]) return false;
  for (const t of W.trees) { const dx = x - t[0], dz = z - t[1], r = t[2] * 0.85 + pad; if (dx * dx + dz * dz < r * r) return false; }
  return true;
}
/* 오리: 물가에서 3.5m 넘게 떨어진 깊은 물, 부두 둘레는 피한다 */
function waterOk(x, z) {
  const cfg = ctx.W.cfg; if (!cfg.water || Math.abs(x) > 70 || z < -70) return false;
  if (z > shoreZ(x) - 3.5 || hT(x, z) > WATER_Y - 0.4) return false;
  return !(cfg.dock && x > 4 && x < 7.4 && z > -20.5);
}
/* 달랑게: 물가에서 땅 쪽으로 0.2~6m 띠, 돗자리 밖 */
const crabOk = (x, z) => { const s = z - shoreZ(x); return s > 0.2 && s < 6 && Math.abs(x) < 45 && !onMat(x, z, 0.4) && groundOk(x, z, 0.05); };
const sqOk = (x, z) => groundOk(x, z, 0.08);
function pickNear(cx, cz, r0, r1, ok, tries = 10) {
  for (let i = 0; i < tries; i++) { const g = rnd(0, TAU), r = rnd(r0, r1), x = cx + Math.sin(g) * r, z = cz + Math.cos(g) * r; if (ok(x, z)) return [x, z]; }
  return null;
}
/* 다람쥐: (cx, cz) 에서 r0~r1 떨어진 나무 줄기 바로 옆 */
function nearTrunk(cx, cz, r0, r1) {
  const c = A.trunks.filter(t => { const d = Math.hypot(t[0] - cx, t[1] - cz); return d > r0 && d < r1; });
  for (let i = 0; i < 6 && c.length; i++) {
    const t = c[(Math.random() * c.length) | 0], g = rnd(0, TAU), r = t[2] + 0.3, x = t[0] + Math.sin(g) * r, z = t[1] + Math.cos(g) * r;
    if (sqOk(x, z)) return [x, z];
  }
  return null;
}

/* ══ 종 ══
   walk·run: 빠르기(m/s) · turn: 도는 빠르기(rad/s, 달릴 때 2.5배) · stride: 한 걸음(m) · cy: 몸 가운데 높이(사진 판정)
   fleeDist: 한 번에 달아나는 거리 · rest: 쉬는 시간 · act: 쉰 뒤 act 를 할 확률 · actDur · actLock: act 중에는 놀라지 않는다
   actEnd 'gone' = act 가 끝나면 사라진다 · fleeEnd·leaveBy 'dig' = 모래로 파고든다 · side: 옆으로 걷는다
   foot: 지형을 재는 앞발·뒷발 z 와 좌우 반폭 · snap: 땅에서 이만큼 안이면 디딤발로 보고 IK 로 붙인다 · blob: 바닥 얼룩 크기 */
const SPEC = {
  duck: { water: true, walk: 0.3, run: 1.1, turn: 0.9, stride: 0.55, cy: 0.07, fleeDist: 16, rest: [3, 8], act: 0.55, actDur: 3.6, life: [80, 160], ok: waterOk,
    start: () => { const x = rnd(-40, 40); return [x, shoreZ(x) - rnd(14, 32)]; }, roam: a => pickNear(a.x, a.z, 3, 10, waterOk), pose: poseDuck },
  squirrel: { walk: 1.1, run: 3.5, turn: 6, stride: 0.38, cy: 0.05, fleeDist: 9, rest: [1.5, 4], act: 0.6, actDur: 4, life: [50, 110], ok: sqOk,
    start: () => nearTrunk(0, 0, 14, 35), roam: a => nearTrunk(a.x, a.z, 1.5, 9) || pickNear(a.x, a.z, 1.5, 5, sqOk), pose: poseSquirrel,
    foot: { f: 0.035, h: -0.035, w: 0.022 }, snap: 0.006, blob: [0.2, 0.28] },
  hare: { walk: 0.7, run: 5.5, turn: 3, stride: 0.75, cy: 0.13, fleeDist: 18, zig: true, rest: [2, 6], act: 0.3, actDur: 4, life: [60, 130], ok: groundOk,
    start: () => pickNear(0, 0, 16, 34, groundOk), roam: a => pickNear(a.x, a.z, 2, 7, groundOk), pose: poseHare,
    foot: { f: 0.07, h: -0.07, w: 0.055 }, snap: 0.012, blob: [0.32, 0.42] },
  fox: { walk: 0.9, run: 4.5, turn: 2, stride: 0.95, cy: 0.28, fleeDist: 20, rest: [2, 5], act: 0.45, actDur: 3.4, actLock: true, actStep: foxPounce, life: [70, 150], ok: groundOk,
    start: () => pickNear(0, 0, 20, 40, groundOk), roam: a => pickNear(a.x, a.z, 4, 12, groundOk), pose: poseFox,
    foot: { f: 0.15, h: -0.17, w: 0.05 }, snap: 0.025, blob: [0.45, 0.8] },
  crab: { side: true, walk: 0.3, run: 1.2, turn: 4, stride: 0.14, cy: 0.03, fleeDist: 1.6, rest: [1, 4], act: 0, actDur: 2, actLock: true, actEnd: 'gone', fleeEnd: 'dig', leaveBy: 'dig', life: [40, 90], ok: crabOk,
    start: () => { const x = (Math.random() < 0.5 ? -1 : 1) * rnd(5, 30); return [x, shoreZ(x) + rnd(0.5, 3.5)]; }, roam: a => pickNear(a.x, a.z, 0.6, 2.5, crabOk), pose: poseCrab,
    foot: { f: 0.02, h: -0.03, w: 0.05 }, blob: [0.18, 0.15] },
  turtle: { walk: 0.14, turn: 0.5, stride: 0.42, cy: 0.12, ok: () => true, startOk: (x, z) => hT(x, z) < WATER_Y - 0.6,
    start: () => { const x = (Math.random() < 0.5 ? -1 : 1) * rnd(10, 34); return [x, shoreZ(x) - 7]; }, enter: turtleEnter, think: turtleThink, pose: poseTurtle,
    foot: { f: 0.3, h: -0.4, w: 0.3 }, blob: [1.0, 1.3] },
};
const BUILD = { fox: foxModel, squirrel: squirrelModel, hare: hareModel, duck: () => duckModel(false), chick: () => duckModel(true), crab: crabModel, turtle: turtleModel };

/* ══ 모델 풀: 처음엔 굽고, 다 쓰면 숨겨 두었다가 다시 쓴다 ══ */
function build(key) {
  mats(); begin(key); const m = BUILD[key](); end();
  m.key = key; m.R.rotation.order = 'YXZ'; m.R.visible = false;
  m.bones = []; m.R.traverse(o => { if (o.isBone) m.bones.push(o); });
  const S = SPEC[key];
  if (S && S.blob) { m.blob = new THREE.Mesh(G.blob, BLOB); m.blob.renderOrder = 1; m.blob.userData.noAO = true; m.blob.userData.noRefl = true; m.blob.visible = false; ctx.scene.add(m.blob); }
  ctx.scene.add(m.R);
  return m;
}
function take(key) { const p = A.pool[key] || (A.pool[key] = []), m = p.pop() || build(key); m.R.visible = true; return m; }
function give(m) { m.R.visible = false; if (m.blob) m.blob.visible = false; (A.pool[m.key] || (A.pool[m.key] = [])).push(m); }

/* ══ 한 마리 ══ */
function make(key, id, x, z) {
  const S = SPEC[key], m = take(key);
  const a = { id, key, S, C: ANIMALS[key], m, R: m.R, J: m.J, bones: m.bones, x, z, head: rnd(-Math.PI, Math.PI), yaw: 0, st: 'rest', t: 0, dur: 2, spd: 0, ph: 0, life: 60,
    tx: x, tz: z, trust: 0, sit: 0, ear: -0.05, tuck: 0, flick: 0, offY: 0, dig: 0, side: id % 2 ? 1 : -1, buf: [], kids: [], trail: [],
    gy: 0, gp: 0, gr: 0, init: true, from: null, bt: 0, swim: false, air: false };
  if (key === 'duck') for (let i = 0, n = 3 + id % 3; i < n; i++) {
    const c = take('chick'), d = 0.5 * (i + 1);
    a.kids.push({ m: c, R: c.R, J: c.J, x: x - Math.sin(a.head) * d, z: z - Math.cos(a.head) * d, head: a.head, dab: 0, dabT: rnd(2, 6) });
  }
  A.list.push(a); return a;
}
function drop(a) { give(a.m); a.kids.forEach(c => give(c.m)); }
/* 동작 섞기: 상태가 바뀌는 순간의 자세를 적어 두고 0.3초 동안 새 자세로 넘어간다 */
const BLEND = 0.3;
function snapPose(a) { a.from = a.bones.map(b => [b.rotation.x, b.rotation.y, b.rotation.z, b.position.x, b.position.y, b.position.z]); a.fromOff = a.offY; a.bt = 0; }
function blend(a, dt) {
  if (!a.from || a.bt >= BLEND) return;
  a.bt += dt; const w = ss(0, 1, a.bt / BLEND);
  a.bones.forEach((b, i) => { const f = a.from[i]; b.rotation.set(lerp(f[0], b.rotation.x, w), lerp(f[1], b.rotation.y, w), lerp(f[2], b.rotation.z, w)); b.position.set(lerp(f[3], b.position.x, w), lerp(f[4], b.position.y, w), lerp(f[5], b.position.z, w)); });
  a.offY = lerp(a.fromOff, a.offY, w);
}
function set(a, st) { const prev = a.st; if (prev !== st) snapPose(a); a.st = st; a.t = 0; a.landed = false; if (prev !== st) onState(a); }
/* 상태가 바뀐 순간의 소리 (방장·친구 모두) */
function onState(a) {
  const y = a.R.position.y + 0.2, k = a.key, st = a.st;
  if (k === 'duck' && st === 'flee') sfxAt('quack', a.x, y, a.z, 3);
  else if (k === 'squirrel' && st === 'flee') sfxAt('scurry', a.x, y, a.z, 1);
  else if (k === 'crab' && st === 'flee') sfxAt('scurry', a.x, y, a.z, 0.5);
  else if (k === 'crab' && st === 'act') sfxAt('plant', a.x, y, a.z, 'sand');
  else if (k === 'hare' && st === 'flee') sfxAt('snowPop', a.x, y, a.z);
}

/* ══ 생각하기 (방장·1인) ══ */
/* 가장 가까운 사람과 그 "유효 거리" (가만히 있으면 calm 배로 멀게, 시끄러우면 가깝게, 익숙해지면 더 멀게) */
function threat(a, P) {
  let th = null, eff = Infinity;
  for (const p of P) {
    const k = (p.still ? ANIMAL.calm : 1) * (p.loud ? 1.5 : 1) * (1 - 0.35 * a.trust), e = Math.hypot(p.x - a.x, p.z - a.z) / k;
    if (e < eff) { eff = e; th = p; }
  }
  return [th, eff];
}
const nearest = (a, P) => P.reduce((b, p) => !b || Math.hypot(p.x - a.x, p.z - a.z) < Math.hypot(b.x - a.x, b.z - a.z) ? p : b, null);
const farFrom = (a, P) => P.every(p => Math.hypot(p.x - a.x, p.z - a.z) > ANIMAL.gone);
function away(a, from, dist) {
  const base = Math.atan2(a.x - from.x, a.z - from.z);
  for (const d of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) { const g = base + d, x = a.x + Math.sin(g) * dist, z = a.z + Math.cos(g) * dist; if (a.S.ok(x, z)) return [x, z]; }
  return null;
}
function leaveTarget(a, P) {
  const p = nearest(a, P); if (!p) return pickNear(a.x, a.z, 8, 15, a.S.ok);
  return away(a, p, Math.max(6, ANIMAL.gone + 6 - Math.hypot(a.x - p.x, a.z - p.z)));
}
function toLeave(a, P) {
  if (a.S.leaveBy === 'dig') { set(a, 'act'); a.dur = a.S.actDur; return; }
  const t = leaveTarget(a, P); if (t) { a.tx = t[0]; a.tz = t[1]; } else { a.tx = a.x; a.tz = a.z; }
  set(a, 'leave');
}
function toFlee(a, th) {
  const t = away(a, th, a.S.fleeDist);
  if (!t) { if (a.st !== 'alert') set(a, 'alert'); return; }
  a.tx = t[0]; a.tz = t[1]; a.flick = 1; set(a, 'flee');
}
/* 새 목표: 모두 오래 가만히 있으면 그 사람 근처(경계 거리 바로 바깥)로, 아니면 종마다 고르는 곳 */
function newRoam(a, P) {
  const S = a.S, C = a.C; let t = null;
  if (A.calm > ANIMAL.calmAfter && Math.random() < 0.6) {
    const p = nearest(a, P), k = ANIMAL.calm * (1 - 0.35 * a.trust);
    if (p) t = pickNear(p.x, p.z, C.flee * k + 0.8, C.alert * k, S.ok, 8);
  }
  t = t || S.roam(a);
  if (!t) { set(a, 'rest'); a.dur = rnd(S.rest[0], S.rest[1]); return; }
  a.tx = t[0]; a.tz = t[1]; set(a, 'roam');
}
/* 목표로 한 걸음: 몸을 돌려 가며 가고, 목표와 각도가 크면 느려진다. 도착 true · 막힘이 이어짐 'blocked' · 그 밖 false */
function stepTo(a, tx, tz, sp, dt, wob = 0) {
  const S = a.S, dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
  if (d < 0.08) { a.spd = 0; return true; }
  const want = Math.atan2(dx, dz) + wob;
  a.head = turnTo(a.head, want, S.turn * (sp > S.walk ? 2.5 : 1) * dt);
  const s = Math.min(sp * dt * clamp(Math.cos(wrapPI(want - a.head)), 0.15, 1), d), nx = a.x + Math.sin(a.head) * s, nz = a.z + Math.cos(a.head) * s;
  if (!S.ok(nx, nz)) { a.spd = 0; a.stuck = (a.stuck || 0) + dt; return a.stuck > 0.6 ? 'blocked' : false; }
  a.stuck = 0; a.x = nx; a.z = nz; a.spd = s / dt; return false;
}
function think(a, dt, P) {
  const S = a.S, C = a.C;
  if (S.think) { S.think(a, dt, P); return; }
  a.life -= dt;
  const [th, eff] = threat(a, P);
  const calm = a.st === 'roam' || a.st === 'rest' || a.st === 'alert' || (a.st === 'act' && !S.actLock);
  if (calm && th) {
    if (eff < C.flee) { toFlee(a, th); return; }
    if (eff < C.alert && a.st !== 'alert') { set(a, 'alert'); a.flick = 1; }
  }
  switch (a.st) {
    case 'roam': { const r = stepTo(a, a.tx, a.tz, S.walk, dt); if (r === true) { set(a, 'rest'); a.dur = rnd(S.rest[0], S.rest[1]); } else if (r === 'blocked') newRoam(a, P); break; }
    case 'rest':
      a.spd = 0;
      if (a.t > a.dur) { if (a.life < 0) toLeave(a, P); else if (Math.random() < S.act) { set(a, 'act'); a.dur = S.actDur; } else newRoam(a, P); }
      break;
    case 'act':
      a.spd = 0; if (S.actStep) S.actStep(a, dt);
      if (a.t > a.dur) { if (S.actEnd === 'gone') a.dead = true; else if (a.life < 0) toLeave(a, P); else newRoam(a, P); }
      break;
    case 'alert':
      a.spd = 0;
      if (th) a.head = turnTo(a.head, Math.atan2(th.x - a.x, th.z - a.z), 2.5 * dt);
      if (!th || eff > C.alert * 1.15) { set(a, 'rest'); a.dur = rnd(1, 3); }
      else if (a.t > 6 && th.still) { a.trust = Math.min(1, a.trust + 0.5); set(a, 'rest'); a.dur = rnd(2, 4); }
      break;
    case 'flee': {
      const r = stepTo(a, a.tx, a.tz, S.run, dt, S.zig ? 0.8 * Math.sin(a.t * 6 + a.id) : 0);
      if (r || a.t > 8) { if (S.fleeEnd === 'dig') { set(a, 'act'); a.dur = S.actDur; } else toLeave(a, P); }
      break;
    }
    case 'leave': {
      const r = stepTo(a, a.tx, a.tz, S.walk * 1.8, dt);
      if (farFrom(a, P) && (a.t > 15 || !seen(a))) a.dead = true;
      else if (r) { const t = leaveTarget(a, P); if (t) { a.tx = t[0]; a.tz = t[1]; } }
      if (a.t > 45) a.dead = true;
      break;
    }
  }
}
/* 여우의 쥐 사냥: 박차는 순간부터 다이빙까지 앞으로 약 0.9m (높이·자세는 POUNCE) */
function foxPounce(a, dt) {
  if (a.t < 1.0 || a.t > 1.75) return;
  const s = 1.2 * dt, x = a.x + Math.sin(a.head) * s, z = a.z + Math.cos(a.head) * s;
  if (groundOk(x, z)) { a.x = x; a.z = z; }
}
/* 바다거북: in(바다에서 모래 위 둥지까지 기어오름) → act(모래 파기) → leave(바다로 돌아가 가라앉음).
   경계 거리 안이면 멈춰 머리를 움츠리고, 달아날 거리 안이면 서둘러 바다로 */
function turtleEnter(a) {
  let tz = shoreZ(a.x) + rnd(3, 5);
  if (!groundOk(a.x, tz, 0.4) || onMat(a.x, tz, 1)) tz = shoreZ(a.x) + 1.5;
  a.tx = a.x + rnd(-1, 1); a.tz = tz; a.head = 0; set(a, 'in');
}
function toSea(a, hurry) { a.hurry = !!hurry; a.tx = a.x + rnd(-2, 2); a.tz = shoreZ(a.x) - 12; set(a, 'leave'); }
function turtleThink(a, dt, P) {
  const [th, eff] = threat(a, P), C = a.C, sp = hT(a.x, a.z) < WATER_Y - 0.1 ? 0.45 : 0.14;
  if (a.st === 'in' || a.st === 'act' || a.st === 'alert') {
    if (th && eff < C.flee) { toSea(a, true); return; }
    if (th && eff < C.alert) { if (a.st !== 'alert') { a.resume = a.st; set(a, 'alert'); } a.spd = 0; return; }
    if (a.st === 'alert') { set(a, a.resume || 'in'); a.dur = rnd(10, 16); }
  }
  if (a.st === 'in') { if (stepTo(a, a.tx, a.tz, sp, dt) === true) { set(a, 'act'); a.dur = rnd(14, 22); } }
  else if (a.st === 'act') { a.spd = 0; if (a.t > a.dur) toSea(a); }
  else if (a.st === 'leave') { stepTo(a, a.tx, a.tz, sp * (a.hurry ? 1.5 : 1), dt); if (a.R.position.y < WATER_Y - 0.9 || a.t > 90) a.dead = true; }
}

/* ══ 땅에 맞추기 (방장·친구 모두) ══
   1) 앞발·뒷발·좌우 밑 지형으로 몸 높이·앞뒤·좌우 기울기 (부드럽게 따라간다)
   2) 디딤발(땅에서 snap 안)이거나 땅에 묻힌 발은 다리 IK 로 지면에 붙인다 — 다리 뼈를 무릎 축으로 돌려 발끝을 맞춘다
   3) 그래도 묻히는 점이 있으면 몸 전체를 띄운다. 카메라에서 ANIMAL.ik m 밖이면 1)의 높이만 */
const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _ax = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _cx = new THREE.Vector3(), _tg = new THREE.Vector3();
const tipW = (leg, o) => leg.end.localToWorld(o.set(leg.tip[0], leg.tip[1], leg.tip[2]));
function solveLeg(leg, snap) {
  leg.chain[0].updateMatrixWorld(true); tipW(leg, _t);
  const g = hT(_t.x, _t.z) + 0.002, gap = _t.y - g;
  if (gap > snap || (gap > 0 && snap === 0)) return 0;
  _tg.set(_t.x, g, _t.z);
  for (let it = 0; it < 4; it++) for (let i = leg.chain.length - 1; i >= 0; i--) {
    const bn = leg.chain[i]; bn.updateMatrixWorld(true); tipW(leg, _t); bn.getWorldPosition(_p);
    _ax.set(1, 0, 0).transformDirection(bn.matrixWorld);
    _v1.copy(_t).sub(_p); _v2.copy(_tg).sub(_p); _v1.addScaledVector(_ax, -_v1.dot(_ax)); _v2.addScaledVector(_ax, -_v2.dot(_ax));
    bn.rotation.x += clamp(Math.atan2(_ax.dot(_cx.crossVectors(_v1, _v2)), _v1.dot(_v2)), -0.4, 0.4);
  }
  leg.chain[0].updateMatrixWorld(true); tipW(leg, _t);
  return Math.max(0, hT(_t.x, _t.z) + 0.002 - _t.y);
}
function place(a, dt, near) {
  const S = a.S, R = a.R; let base, pit = 0, rol = 0;
  a.swim = false;
  if (S.water) base = WATER_Y;
  else {
    const g = hT(a.x, a.z);
    a.swim = a.key === 'turtle' && g < WATER_Y - 0.15;
    if (a.swim) base = WATER_Y - 0.22 - clamp(WATER_Y - g - 0.4, 0, 0.7);
    else if (near && S.foot) {
      const F = S.foot, sc = R.scale.x, cy = Math.cos(a.yaw), sy = Math.sin(a.yaw), gp = (lx, lz) => { lx *= sc; lz *= sc; return hT(a.x + lx * cy + lz * sy, a.z - lx * sy + lz * cy); };
      const yf = gp(0, F.f), yh = gp(0, F.h), zm = (F.f + F.h) / 2, yl = gp(-F.w, zm), yr = gp(F.w, zm);
      base = (yf + yh + yl + yr) / 4; pit = -Math.atan2(yf - yh, (F.f - F.h) * sc); rol = Math.atan2(yr - yl, 2 * F.w * sc);
    } else base = g;
  }
  const k = a.init ? 1 : 1 - Math.exp(-dt * 12); a.init = false;
  a.gy = lerp(a.gy, base, k); a.gp = lerp(a.gp, pit, k); a.gr = lerp(a.gr, rol, k);
  R.rotation.set(a.gp, a.yaw, a.gr); R.position.set(a.x, a.gy + a.offY + a.dig, a.z); R.updateMatrixWorld(true);
  if (!S.water && !a.swim && near) {
    let pen = 0; const snap = a.air || a.offY > 0.03 ? 0 : (S.snap || 0);
    for (const l of a.J.ik) pen = Math.max(pen, solveLeg(l, snap));
    for (const c of a.J.ct) { c[0].localToWorld(_t.set(c[1], c[2], c[3])); pen = Math.max(pen, hT(_t.x, _t.z) + 0.002 - _t.y); }
    if (a.dig < -0.005) pen = 0;
    if (pen > 0) { R.position.y += pen; R.updateMatrixWorld(true); }
  }
  /* 바닥 얼룩: 땅에 붙어 있고, 몸이 뜰수록 작아진다 */
  const bl = a.m.blob;
  if (bl) {
    const g = hT(a.x, a.z), lift = Math.max(0, R.position.y - g), sc = R.scale.x / (1 + lift * 2.5);
    bl.visible = !a.swim && a.dig > -0.04; bl.position.set(a.x, g + 0.015, a.z); bl.rotation.y = a.yaw; bl.scale.set(S.blob[0] * sc, 1, S.blob[1] * sc);
  }
}

/* ══ 나오기 ══ */
const _s = new THREE.Vector3();
function seenAt(x, y, z) {
  const c = ctx.camera; _s.set(x, y, z); if (_s.distanceTo(c.position) > 70) return false;
  _s.project(c); return _s.z < 1 && Math.abs(_s.x) < 1.1 && Math.abs(_s.y) < 1.1;
}
const seen = a => seenAt(a.x, a.R.position.y + 0.2, a.z);
const inHours = (hours, h) => hours.some(([s, e]) => (h >= s && h < e) || (h + 24 >= s && h + 24 < e));
/* force: 시각·화면 검사를 건너뛴다 (콘솔 spawnAnimal) */
function spawn(key, P, force) {
  const S = SPEC[key], okS = S.startOk || S.ok;
  for (let i = 0; i < 20; i++) {
    const s = S.start(); if (!s || !okS(s[0], s[1])) continue;
    if (P.some(p => Math.hypot(p.x - s[0], p.z - s[1]) < (force ? 12 : ANIMAL.spawnMin))) continue;
    if (!force && i < 14 && seenAt(s[0], Math.max(WATER_Y, hT(s[0], s[1])) + 0.3, s[1])) continue;
    const a = make(key, ++A.seq, s[0], s[1]);
    a.life = S.life ? rnd(S.life[0], S.life[1]) : 0;
    if (S.enter) S.enter(a); else newRoam(a, P);
    return a;
  }
  return null;
}
function director(dt, P) {
  const cfg = ctx.W.cfg, h = state.clock * 24;
  for (const k of KEYS) {
    const C = ANIMALS[k]; if (C.bg !== cfg.key) continue;
    if ((A.next[k] -= dt) > 0) continue;
    A.next[k] = rnd(C.every[0], C.every[1]);
    if (inHours(C.hours, h) && A.list.filter(a => a.key === k).length < C.max) spawn(k, P);
  }
}
/* 사람들: 나(카메라 눈 위치) + 다른 사람. 나는 앉아 있거나 초당 0.4m 보다 느리면 가만히 있는 것 */
function people(dt) {
  const P = [], c = ctx.camera.position, m = state.mode;
  if (dt > 0) { const v = Math.hypot(c.x - A.prev.x, c.z - A.prev.z) / dt; A.selfV += (Math.min(v, 6) - A.selfV) * Math.min(1, dt * 4); }
  A.prev.copy(c);
  if (m !== 'sleep') P.push({ x: c.x, z: c.z, still: (m !== 'walk' && m !== 'chop') || A.selfV < 0.4, loud: m === 'chop' });
  if (animalHooks.peers) for (const p of animalHooks.peers()) P.push(p);
  return P;
}
/* 친구: 받은 값을 320ms 늦춰 보간한다 */
function follow(a, dt) {
  const b = a.buf; if (!b.length) return;
  const T = performance.now() - 320;
  let s0 = b[0], s1 = b[0];
  for (let i = b.length - 1; i >= 0; i--) if (b[i].t <= T) { s0 = b[i]; s1 = b[i + 1] || b[i]; break; }
  const u = s1 === s0 ? 1 : clamp((T - s0.t) / (s1.t - s0.t), 0, 1), x = lerp(s0.x, s1.x, u), z = lerp(s0.z, s1.z, u);
  const v = dt > 0 ? Math.min(8, Math.hypot(x - a.x, z - a.z) / dt) : 0;
  a.spd += (v - a.spd) * (1 - Math.exp(-dt * 6));
  a.x = x; a.z = z; a.head = s0.h + wrapPI(s1.h - s0.h) * u;
  if (s0.st !== a.st) set(a, s0.st);
}

/* ══ 밖에서 부르는 것 ══ */
/* 씬마다 (scene.js, 식생·해변·유목 다음): 풀을 비우고, 이 장소 동물을 한 마리씩 미리 만들어 숨겨 둔다
   → 로딩 화면 뒤 사전 컴파일에 함께 들어가고, 처음 나올 때 멈칫하지 않는다 */
export function buildAnimals(cfg) {
  mats(); A.list = []; A.pool = {}; A.seq = 0; A.on = true; A.sentEmpty = true;
  A.trunks = cfg.key === 'lake' ? ctx.W.trunks.filter(t => { const d = Math.hypot(t[0], t[1]); return d > 8 && d < 50; }) : [];
  for (const k of KEYS) if (ANIMALS[k].bg === cfg.key) { give(build(k)); if (k === 'duck') give(build('chick')); }
  resetAnimals();
}
/* 출발·메뉴로·잠들 때 (game.js): 모두 치우고 다음 등장 시각을 새로 정한다 */
export function resetAnimals() {
  A.list.forEach(drop); A.list = []; A.calm = 0; A.sentEmpty = false;
  for (const k of KEYS) A.next[k] = rnd(5, ANIMALS[k].every[0]);
}
/* 매 프레임 (main.js). 1인은 멈춘 동안 dt 0 */
export function updateAnimals(dt) {
  if (!A.on || !ctx.running) return;
  A.T += dt;
  const guest = session.mode === 'guest', P = people(dt), cam = ctx.camera.position, ikR = ANIMAL.ik || 35;
  if (!guest && dt > 0) {
    A.calm = P.length && P.every(p => p.still) ? A.calm + dt : 0;
    if (state.mode !== 'sleep' && !dreamOn()) director(dt, P);
  }
  for (const a of A.list) {
    const S = a.S;
    a.t += dt;
    if (guest) follow(a, dt); else if (dt > 0) think(a, dt, P);
    a.ph += a.spd * dt / (S.stride * (1 + a.spd * 0.25)) * TAU;
    a.offY = 0; a.dig = 0; S.pose(a, dt); blend(a, dt);
    a.yaw = a.head - (S.side ? a.side * Math.PI / 2 : 0);
    place(a, dt, Math.hypot(a.x - cam.x, a.z - cam.z) < ikR);
  }
  if (A.list.some(a => a.dead)) A.list = A.list.filter(a => { if (a.dead) drop(a); return !a.dead; });
}

/* ── 사진 (game.js takePhoto, 찍는 카메라 그대로 — 3인칭이면 뒤로 뺀 카메라) ──
   화면 안 · 충분히 크게 · 나무 줄기에 가리지 않은 종을 남기고, 소식에 덧붙일 글을 돌려준다 (없으면 '') */
const _v = new THREE.Vector3();
function behindTree(c, a) {
  const dx = a.x - c.x, dz = a.z - c.z, L2 = dx * dx + dz * dz;
  for (const t of ctx.W.trunks) {
    const u = ((t[0] - c.x) * dx + (t[1] - c.z) * dz) / L2; if (u <= 0.02 || u >= 1) continue;
    const px = c.x + dx * u - t[0], pz = c.z + dz * u - t[1], r = t[2] * 0.8;
    if (px * px + pz * pz < r * r && (1 - u) * Math.sqrt(L2) > 1.2) return true;
  }
  return false;
}
export function animalPhoto(cam) {
  if (!A.on || !A.list.length) return '';
  const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), got = new Set();
  for (const a of A.list) {
    if (got.has(a.key) || (a.key === 'crab' && a.st === 'act' && a.t > 0.6) || a.R.position.y < WATER_Y - 0.4) continue;
    _v.set(a.x, a.R.position.y + a.S.cy * a.R.scale.y, a.z);
    const d = _v.distanceTo(cam.position); if (d < 0.5) continue;
    if (a.C.photo / (d * tanH) < ANIMAL.minShot || behindTree(cam.position, a)) continue;
    _v.project(cam); if (_v.z > 1 || Math.abs(_v.x) > 0.92 || Math.abs(_v.y) > 0.92) continue;
    got.add(a.key);
  }
  if (!got.size) return '';
  const firsts = [], names = [];
  got.forEach(k => {
    const r = records.animals[k], n = ANIMALS[k].name;
    if (!r) { records.animals[k] = { n: 1, first: { bg: state.bg, clock: state.clock } }; firsts.push(n); }
    else r.n = Math.min(99999, r.n + 1);
    names.push(n);
  });
  saveSettings();
  return firsts.length ? `${josa(firsts.join(', '), '을', '를')} 처음 사진에 담았다` : `${josa(names.join(', '), '을', '를')} 사진에 담았다`;
}

/* ── 멀티 (net.js) ── 방장: [id, 종 번호, x, z, 방향, 상태 번호]. 동물이 없으면 빈 목록을 한 번만 보낸다 */
export function animalPack() {
  if (!A.on || session.mode !== 'host' || !ctx.running) return null;
  if (!A.list.length) { if (A.sentEmpty) return null; A.sentEmpty = true; return { bg: state.bg, a: [] }; }
  A.sentEmpty = false;
  const r = v => Math.round(v * 100) / 100;
  return { bg: state.bg, a: A.list.map(a => [a.id, KEYS.indexOf(a.key), r(a.x), r(a.z), r(wrapPI(a.head)), ST.indexOf(a.st)]) };
}
/* 친구: 받은 목록대로 만들고, 목록에서 빠진 것은 치운다 */
export function animalRecv(d) {
  if (!A.on || !ctx.running || !d || d.bg !== state.bg || !Array.isArray(d.a)) return;
  const now = performance.now(), keep = new Set();
  for (const e of d.a.slice(0, 16)) {
    if (!Array.isArray(e) || e.length < 6 || !e.slice(0, 6).every(Number.isFinite)) continue;
    const [id, ki, x, z, h, si] = e, key = KEYS[ki], st = ST[si];
    if (!key || !st || ANIMALS[key].bg !== state.bg) continue;
    keep.add(id);
    let a = A.list.find(o => o.id === id);
    if (!a) { a = make(key, id, x, z); a.head = h; a.st = st; }
    a.buf.push({ t: now, x, z, h, st }); if (a.buf.length > 12) a.buf.shift();
  }
  A.list.forEach(a => { if (!keep.has(a.id)) a.dead = true; });
}

/* 콘솔 시험: spawnAnimal('fox') — 시각·화면 검사 없이 지금 장소에 한 마리 (1인·방장만) */
if (typeof window !== 'undefined') window.spawnAnimal = key => {
  if (!A.on || !ctx.running || session.mode === 'guest' || !Object.hasOwn(ANIMALS, key) || ANIMALS[key].bg !== state.bg) return null;
  return spawn(key, people(0), true) ? key : null;
};