import * as THREE from 'three';
import { ctx, state } from './state.js';
import { GEAR, GEAR_DEFAULT, BEACH } from './data.js';
import { smoothM, canvasTex, clamp, wrapPI } from './util.js';
import { terrainH } from './terrain.js';
import { DOCK } from './dock.js';
/* game.js·snowman.js 와 서로 불러오지만, 실행 중에만 부르므로 순환해도 괜찮다 (snowman.js 와 같은 방식) */
import { player, anim } from './game.js';
import { snowRolling } from './snowman.js';

/* ══ 아바타 ══
   원점 = 발바닥 가운데, 앞 = −z (카메라와 같은 방향). 키 약 1.72m, 눈높이 1.6m (data.js EYE 와 같다).
   관절마다 그룹 하나 — 그룹을 돌리면 관절이 꺾인다. 자세는 관절 각도 표, 손이 갈 자리가 정해진 동작(마시기·먹기·스파클라)은 IK 로 팔 각도를 계산한다.
   updateAvatar(A, S, dt): S = 스냅샷 { mode, seat, x, z, yaw, pitch, item, jacket, sip, mouth, roast, eat, roll }.
     내 아바타는 localState() 가 게임 상태에서 채우고, 멀티가 되면 다른 플레이어는 네트워크로 받은 같은 스냅샷을 넣는다.
   자리에 앉으면 SEAT_ANCHOR 의 자리(의자·부두 끝·돗자리…)에 몸을 놓고, 걸을 때는 플레이어 위치를 따라가며 걸음 위상을 실제 이동 거리로 정한다(발이 미끄러지지 않게).
   손에 든 물건: 오른손의 mount(몸 기준 방향) 안 grip(물건별 쥐는 자리)에 W.item 을 그대로 옮겨 붙인다 (view.js 의 mountItem).
   모델은 씬을 옮겨 다닌다 — root.userData.persist 라서 scene.js 의 정리에서 빠진다 */

const V3 = THREE.Vector3, Z = [0, 0, 0], PI = Math.PI;
const lerp = (a, b, t) => a + (b - a) * t, ez = x => x * x * (3 - 2 * x);

/* ── 재질 ── */
function makeMats() {
  const teeth = canvasTex(8, 8, g => { g.fillStyle = '#7d838a'; g.fillRect(0, 0, 8, 8); g.fillStyle = '#d5d9de'; g.fillRect(1, 0, 6, 4); });
  teeth.wrapS = teeth.wrapT = THREE.RepeatWrapping; teeth.repeat.set(1, 90); teeth.magFilter = THREE.NearestFilter; teeth.colorSpace = THREE.SRGBColorSpace;
  return {
    jacket: smoothM(0xe0783a, { roughness: 0.55 }), seam: smoothM(0xe0783a, { roughness: 0.65 }), pocket: smoothM(0xe0783a, { roughness: 0.6 }),
    zip: smoothM(0xffffff, { map: teeth, metalness: 0.6, roughness: 0.35 }), metal: smoothM(0xb8bcc2, { metalness: 0.85, roughness: 0.3 }),
    pants: smoothM(0x3b3f47, { roughness: 0.9 }), boot: smoothM(0x5b3e29, { roughness: 0.8 }), sole: smoothM(0x1e1e1e, { roughness: 0.9 }),
    skin: smoothM(0xf2cfb0), eye: smoothM(0x15120f, { roughness: 0.25 }), glove: smoothM(0x4a3426, { roughness: 0.85 }),
    hat: smoothM(0xefe6d1, { roughness: 0.95, side: THREE.DoubleSide }),
  };
}

/* ── 몸통 겉면 위의 점: 지퍼·주머니가 곡면을 따라 붙는다 (몸통 = 반지름 0.17 캡슐, 가로 1.12배·앞뒤 0.82배, 척추 기준 y 0.2) ── */
const _n = new V3();
function torsoPt(x, y, off, out) {
  const ly = y - 0.2, d = Math.max(0, Math.abs(ly) - 0.12), r = Math.sqrt(Math.max(1e-5, 0.0289 - d * d)), xr = r * 1.12, zr = r * 0.82;
  const xx = clamp(x / xr, -0.995, 0.995), pz = -zr * Math.sqrt(1 - xx * xx);
  const nx = x / (xr * xr), nz = pz / (zr * zr), nl = Math.hypot(nx, nz), ny = Math.sign(ly) * d / 0.17, hs = Math.sqrt(Math.max(0, 1 - ny * ny));
  _n.set(nx / nl * hs, ny, nz / nl * hs).normalize();
  return out.set(x, y, pz).addScaledVector(_n, off);
}
/* 겉면 패치: f(u, v) → [x, y, 띄우는 거리] */
function surf(nu, nv, f, m) {
  const pos = [], nor = [], uv = [], idx = [], p = new V3();
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const u = i / nu, v = j / nv, r = f(u, v); torsoPt(r[0], r[1], r[2], p); pos.push(p.x, p.y, p.z); nor.push(_n.x, _n.y, _n.z); uv.push(u, v); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const o = new THREE.Mesh(g, m); o.receiveShadow = true; return o;
}
const FWD = new V3(0, 0, -1);
const onTorso = (o, x, y, off) => { torsoPt(x, y, off, o.position); o.quaternion.setFromUnitVectors(FWD, _n); return o; };
const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; };
const joint = (p, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };

function buildAvatar() {
  const mat = makeMats(), root = new THREE.Group(), body = new THREE.Group(), J = {};
  root.add(body); root.visible = false; root.userData.persist = true;
  J.hips = joint(body, 0, 0.93, 0);
  { const p = mesh(new THREE.SphereGeometry(0.16, 24, 16), mat.pants, 0, 0.02, 0); p.scale.set(1.12, 0.72, 0.86); J.hips.add(p); }
  const S = J.spine = joint(J.hips, 0, 0.08, 0);
  /* 재킷: 밑단 밴드 · 중앙 지퍼(덮개 + 이빨 + 슬라이더) · 아래 주머니 둘(덮개·똑딱단추) · 왼쪽 가슴 지퍼 주머니 · 목깃 */
  const t = mesh(new THREE.CapsuleGeometry(0.17, 0.24, 8, 24), mat.jacket, 0, 0.2, 0); t.scale.set(1.12, 1, 0.82); S.add(t);
  const hem = mesh(new THREE.TorusGeometry(0.152, 0.019, 10, 48), mat.seam, 0, 0.005, 0); hem.rotation.x = PI / 2; hem.scale.set(1.12, 0.82, 1); S.add(hem);
  S.add(surf(4, 40, (u, v) => [(u - 0.5) * 0.038, -0.01 + v * 0.43, 0.002 + 0.0045 * Math.sin(PI * u)], mat.seam));
  S.add(surf(2, 60, (u, v) => [(u - 0.5) * 0.009, v * 0.415, 0.0068], mat.zip));
  S.add(onTorso(mesh(new THREE.BoxGeometry(0.014, 0.016, 0.008), mat.metal), 0, 0.37, 0.01));
  const pull = onTorso(mesh(new THREE.BoxGeometry(0.011, 0.03, 0.003), mat.metal), 0, 0.348, 0.013); pull.rotateX(-0.25); S.add(pull);
  [-1, 1].forEach(s => {
    const cx = s * 0.098;
    S.add(surf(10, 10, (u, v) => [cx + (u - 0.5) * 0.092, 0.035 + v * 0.115, 0.0015 + 0.0065 * Math.pow(Math.sin(PI * u) * Math.sin(PI * v), 0.35)], mat.pocket));
    S.add(surf(10, 6, (u, v) => [cx + (u - 0.5) * 0.104 * (1 - 0.08 * (1 - v)), 0.128 + v * 0.05, 0.002 + 0.011 * (1 - 0.8 * v) * Math.pow(Math.sin(PI * u), 0.25)], mat.seam));
    S.add(onTorso(mesh(new THREE.SphereGeometry(0.0075, 12, 8), mat.metal), cx, 0.138, 0.013));
  });
  S.add(surf(14, 3, (u, v) => [lerp(-0.14, -0.055, u), lerp(0.255, 0.292, u) + (v - 0.5) * 0.022, 0.002 + 0.003 * Math.sin(PI * v)], mat.seam));
  S.add(surf(14, 2, (u, v) => [lerp(-0.135, -0.06, u), lerp(0.257, 0.29, u) + (v - 0.5) * 0.007, 0.0055], mat.metal));
  S.add(onTorso(mesh(new THREE.BoxGeometry(0.009, 0.022, 0.003), mat.metal), -0.06, 0.278, 0.008));
  const col = mesh(new THREE.TorusGeometry(0.078, 0.03, 10, 28), mat.jacket, 0, 0.43, 0); col.rotation.x = PI / 2; S.add(col);
  S.add(mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), mat.seam, 0, 0.43, -0.104));
  S.add(mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 16), mat.skin, 0, 0.46, 0));
  /* 머리: 고개는 좌우(y) 먼저, 그다음 위아래(x) */
  J.neck = joint(S, 0, 0.42, 0); J.head = joint(J.neck, 0, 0.05, 0);
  J.neck.rotation.order = J.head.rotation.order = 'YXZ';
  { const h = mesh(new THREE.SphereGeometry(0.13, 32, 24), mat.skin, 0, 0.12, 0); h.scale.set(0.97, 1.05, 1); J.head.add(h);
    [-1, 1].forEach(s => J.head.add(mesh(new THREE.SphereGeometry(0.014, 12, 10), mat.eye, s * 0.045, 0.115, -0.119))); }
  const hatG = new THREE.Group(); J.head.add(hatG);
  /* 팔·다리 */
  [-1, 1].forEach(s => {
    const k = s < 0 ? 'L' : 'R';
    const a = J['arm' + k] = joint(S, s * 0.215, 0.355, 0);
    a.add(mesh(new THREE.SphereGeometry(0.068, 16, 12), mat.jacket)); a.add(mesh(new THREE.CapsuleGeometry(0.062, 0.16, 6, 16), mat.jacket, 0, -0.135, 0));
    const e = J['elbow' + k] = joint(a, 0, -0.27, 0); e.add(mesh(new THREE.CapsuleGeometry(0.054, 0.15, 6, 16), mat.jacket, 0, -0.11, 0));
    const cf = mesh(new THREE.TorusGeometry(0.05, 0.013, 8, 20), mat.seam, 0, -0.215, 0); cf.rotation.x = PI / 2; e.add(cf);
    const h = J['hand' + k] = joint(e, 0, -0.255, 0);
    const hm = mesh(new THREE.SphereGeometry(0.046, 16, 12), mat.glove, 0, -0.015, 0); hm.scale.set(0.85, 1.15, 1); h.add(hm);
    const l = J['leg' + k] = joint(J.hips, s * 0.095, -0.04, 0); l.add(mesh(new THREE.CapsuleGeometry(0.078, 0.27, 6, 16), mat.pants, 0, -0.2, 0));
    const kn = J['knee' + k] = joint(l, 0, -0.43, 0); kn.add(mesh(new THREE.CapsuleGeometry(0.064, 0.28, 6, 16), mat.pants, 0, -0.19, 0));
    const f = J['foot' + k] = joint(kn, 0, -0.41, 0);
    f.add(mesh(new THREE.CylinderGeometry(0.068, 0.072, 0.12, 16), mat.boot, 0, 0.02, 0));
    f.add(mesh(new THREE.BoxGeometry(0.11, 0.075, 0.24), mat.boot, 0, -0.005, -0.045));
    f.add(mesh(new THREE.BoxGeometry(0.116, 0.022, 0.25), mat.sole, 0, -0.04, -0.045));
  });
  /* 손에 든 것: mount 는 몸 기준 방향(매 프레임 계산), grip 은 물건별 쥐는 자리 */
  const mount = new THREE.Group(), grip = new THREE.Group(); J.handR.add(mount); mount.add(grip);
  const A = { root, body, J, mat, hatG, mount, grip, cur: {}, curI: new V3(), hy: 0.93, bPos: new V3(), bRx: 0, yaw: 0, t: 0, ph: 0, v: 0, px: 0, pz: 0, dr: 0,
    item: null, itemFresh: false, key: null, blendT: 0, placed: false, snap: true, jacket: null };
  for (const k in J) A.cur[k] = new V3();
  return A;
}
function setJacket(A, hex) { const m = A.mat; m.jacket.color.setHex(hex); m.seam.color.setHex(hex).multiplyScalar(0.7); m.pocket.color.setHex(hex).multiplyScalar(0.9); }
const HAT = { lake: 'cap', beach: 'bucket', snow: 'beanie' }, HAT_COL = { beanie: 0xefe6d1, bucket: 0xb8a57a, cap: 0x34496a };
function setHat(A, type) {
  const g = A.hatG, m = A.mat.hat; g.children.forEach(o => o.geometry.dispose()); g.clear(); m.color.setHex(HAT_COL[type] || 0xefe6d1);
  if (type === 'beanie') {
    const d = mesh(new THREE.SphereGeometry(0.139, 32, 16, 0, PI * 2, 0, PI / 2), m, 0, 0.15, 0); d.scale.y = 1.12; g.add(d);
    const c = mesh(new THREE.TorusGeometry(0.135, 0.024, 10, 40), m, 0, 0.165, 0); c.rotation.x = PI / 2; g.add(c);
    g.add(mesh(new THREE.SphereGeometry(0.042, 16, 12), m, 0, 0.326, 0));
  } else if (type === 'bucket') {
    g.add(mesh(new THREE.CylinderGeometry(0.115, 0.138, 0.11, 32), m, 0, 0.255, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.138, 0.215, 0.045, 40, 1, true), m, 0, 0.185, 0));
  } else if (type === 'cap') {
    const d = mesh(new THREE.SphereGeometry(0.137, 32, 16, 0, PI * 2, 0, PI / 2), m, 0, 0.16, 0); d.scale.y = 0.92; g.add(d);
    const br = mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.012, 24, 1, false, PI / 2, PI), m, 0, 0.165, -0.06); br.rotation.x = -0.12; br.scale.z = 1.25; g.add(br);
    g.add(mesh(new THREE.SphereGeometry(0.014, 10, 8), m, 0, 0.29, 0));
  }
}

/* ── 팔 IK: 척추 기준 좌표 (tx, ty, tz) 에 손이 오도록 어깨·팔꿈치 각도를 구한다. pole = 팔꿈치가 향할 쪽 ── */
const IS = new V3(), ID = new V3(), IP = new V3(), IU = new V3(), IX = new V3(), IY = new V3(), IZ = new V3(), IM = new THREE.Matrix4(), IQ = new THREE.Quaternion(), IE = new THREE.Euler();
const POLE_R = [1, -0.6, 0.15], POLE_L = [-1, -0.6, 0.15];
function ik(s, tx, ty, tz, pole) {
  const L1 = 0.27, L2 = 0.255;
  IS.set(s * 0.215, 0.355, 0); ID.set(tx, ty, tz).sub(IS);
  const len = clamp(ID.length(), 0.06, L1 + L2 - 0.002); ID.normalize();
  const a = Math.acos(clamp((L1 * L1 + len * len - L2 * L2) / (2 * L1 * len), -1, 1));
  const bend = PI - Math.acos(clamp((L1 * L1 + L2 * L2 - len * len) / (2 * L1 * L2), -1, 1));
  IP.set(pole[0], pole[1], pole[2]).normalize(); IP.addScaledVector(ID, -IP.dot(ID)).normalize();
  IU.copy(ID).multiplyScalar(Math.cos(a)).addScaledVector(IP, Math.sin(a));
  IY.copy(IU).negate(); IZ.copy(ID).addScaledVector(IU, -ID.dot(IU)).normalize().negate(); IX.crossVectors(IY, IZ);
  IM.makeBasis(IX, IY, IZ); IQ.setFromRotationMatrix(IM); IE.setFromQuaternion(IQ, 'XYZ');
  return [[IE.x, IE.y, IE.z], [bend, 0, 0]];
}
function setArm(j, s, x, y, z) { const [a, e] = ik(s, x, y, z, s > 0 ? POLE_R : POLE_L), k = s > 0 ? 'R' : 'L'; j['arm' + k] = a; j['elbow' + k] = e; }
/* 입으로 가져가기: 물건의 rim(입술에 닿을 점, mount 기준)이 아랫입술에 오도록 손 자리를 역산하고,
   hold 에서 그 자리까지 대각선으로 올라온다 (가운데쯤 살짝 앞으로 휘어 턱에 걸리지 않게) */
const _e1 = new THREE.Euler(0, 0, 0, 'YXZ'), _e2 = new THREE.Euler(), _m = new V3(), _r = new V3(), _X = new V3(1, 0, 0);
function toMouth(j, u, hold, rim, ie) {
  _e1.set(j.head[0], j.head[1], 0, 'YXZ'); _m.set(0, 0.045, -0.112).applyEuler(_e1); _m.y += 0.47;
  _r.copy(rim).applyEuler(_e2.set(ie[0], ie[1], ie[2], 'XYZ')).applyAxisAngle(_X, -j.spine[0]);
  _m.sub(_r); _m.z -= 0.004;
  setArm(j, 1, lerp(hold[0], _m.x, u), lerp(hold[1], _m.y, u), lerp(hold[2], _m.z, u) - 0.06 * Math.sin(PI * u));
}

/* ── 손에 든 것별 쥐는 자리(g)와 팔 동작. arm 은 j 를 고치고, 물건의 몸 기준 회전 [x, y, z] 를 돌려준다 ── */
const HOLD_CUP = [0.12, 0.13, -0.25], HOLD_SMOKE = [0.2, 0.02, -0.14];
const RIM_SMOKE = new V3(-0.017, 0, 0), RIM_MARSH = new V3(0, 0, -0.47), EAT_E = [2.0, 0, 0];
const drinkArm = rim => (j, S, A, dt) => {
  const u = ez(S.sip); A.dr = clamp(A.dr + (S.mouth ? dt / 1.6 : -dt * 2), 0, 1);
  const tilt = 0.95 * Math.pow(u, 2.2) + 0.28 * A.dr * u, ie = [tilt, 0, 0];
  j.head = [lerp(j.head[0], 0.14 + 0.08 * A.dr, u), j.head[1] * (1 - u), 0];
  j.spine = [j.spine[0] + 0.03 * u, j.spine[1], 0];
  toMouth(j, u, HOLD_CUP, rim, ie); return ie;
};
const ITEM = {
  coffee: { g: [-0.065, 0, 0], arm: drinkArm(new V3(-0.065, 0.045, 0.045)) },
  whisky: { g: [-0.055, 0.01, 0], arm: drinkArm(new V3(-0.055, 0.053, 0.038)) },
  smoke: { g: [0.035, 0, 0], arm: (j, S) => { const u = ez(S.sip), ie = [0, PI / 2, 0]; j.head = [lerp(j.head[0], 0.06, u), j.head[1] * (1 - u), 0]; toMouth(j, u, HOLD_SMOKE, RIM_SMOKE, ie); return ie; } },
  sparkler: { g: [0, -0.02, 0], arm: j => { setArm(j, 1, 0.13, 0.3, -0.34); return [-0.35, 0, 0]; } },
  /* 마시멜로: 쉬는 자세(꼬치가 앞위로) ↔ 불에 내밀기(roast) ↔ 입으로(eat) */
  marsh: { g: [0, 0, 0.02], arm: (j, S) => {
    const r = ez(clamp(S.roast, 0, 1)), e = S.eat, hold = [lerp(0.14, 0.1, r), lerp(0.1, 0.2, r), lerp(-0.22, -0.44, r)];
    let ie = [lerp(0.85, -0.55, r), 0, 0];
    if (e > 0) { toMouth(j, e, hold, RIM_MARSH, EAT_E); ie = [lerp(ie[0], EAT_E[0], e), 0, 0]; } else setArm(j, 1, hold[0], hold[1], hold[2]);
    if (r > 0) j.head = [lerp(j.head[0], -0.35, r * 0.6), j.head[1], 0];
    return ie;
  } },
  gun: { g: [0, 0, 0], arm: j => { setArm(j, 1, 0.08, 0.47, -0.45); setArm(j, -1, 0.03, 0.44, -0.38); return [0, 0, 0]; } },
};

/* ── 서기·걷기: amp 0 = 서 있음, 1 = 걷기. ph = 걸음 위상 (한 걸음 = π) ── */
function walkPose(j, ph, amp, t) {
  const s = Math.sin(ph), A = 0.42 * amp, kn = o => -(0.06 * amp + 0.85 * amp * Math.max(0, Math.cos(ph + 0.4 + o)) ** 1.5);
  const lL = A * s, lR = -A * s, kL = kn(0), kR = kn(PI);
  Object.assign(j, {
    legL: [lL, 0, -0.02], legR: [lR, 0, 0.02], kneeL: [kL, 0, 0], kneeR: [kR, 0, 0], footL: [-(lL + kL) * 0.8, 0, 0], footR: [-(lR + kR) * 0.8, 0, 0],
    armL: [0.06 - 0.38 * amp * s, 0, -0.1], armR: [0.06 + 0.38 * amp * s, 0, 0.1],
    elbowL: [0.18 + 0.12 * amp - 0.1 * amp * s, 0, 0], elbowR: [0.18 + 0.12 * amp + 0.1 * amp * s, 0, 0],
    spine: [-0.05 * amp + 0.015 * Math.sin(t * 1.6) * (1 - amp), 0.07 * amp * s, 0], hips: [0, -0.07 * amp * s, 0],
  });
  return 0.93 - 0.015 * amp + 0.018 * amp * Math.cos(2 * ph);
}
/* ── 앉은 자세: 관절 표 + 엉덩이 높이(hipsY). 눕는 자세는 몸 전체를 뒤로 눕히고(rx) 머리가 root 에 오게 민다(by·bz) ── */
const SEATP = {
  chair: { hipsY: 0.55, j: { spine: [0.16, 0, 0], legL: [1.5, 0, -0.08], legR: [1.48, 0, 0.08], kneeL: [-1.48, 0, 0], kneeR: [-1.42, 0, 0], footL: [-0.02, 0, 0], footR: [-0.06, 0, 0], armL: [0.25, 0, -0.18], armR: [0.25, 0, 0.18], elbowL: [1.15, 0, 0], elbowR: [1.15, 0, 0] } },
  car: { hipsY: 0.86, j: { spine: [0.14, 0, 0], legL: [1.35, 0, -0.05], legR: [1.35, 0, 0.05], kneeL: [-0.25, 0, 0], kneeR: [-0.3, 0, 0], footL: [-0.8, 0, 0], footR: [-0.75, 0, 0], armL: [0.8, 0, -0.05], armR: [0.8, 0, 0.05], elbowL: [0.6, 0, 0], elbowR: [0.6, 0, 0] } },
  tent: { hipsY: 0.14, j: { spine: [-0.25, 0, 0], legL: [1.95, 0, -0.12], legR: [1.95, 0, 0.12], kneeL: [-2.6, 0, 0], kneeR: [-2.6, 0, 0], footL: [0.5, 0, 0], footR: [0.5, 0, 0], armL: [0.95, 0, -0.12], armR: [0.95, 0, 0.12], elbowL: [0.85, 0, 0], elbowR: [0.85, 0, 0] } },
  dock: { hipsY: 0.46, bz: 0.08, kick: 1, j: { spine: [-0.12, 0, 0], legL: [1.38, 0, -0.06], legR: [1.38, 0, 0.06], kneeL: [-1.2, 0, 0], kneeR: [-1.25, 0, 0], footL: [-0.2, 0, 0], footR: [-0.2, 0, 0], armR: [0.62, 0, -0.12], elbowR: [0.95, 0, 0], armL: [0.78, 0, 0.32], elbowL: [0.95, 0, 0] } },
  mat: { hipsY: 0.93, rx: PI / 2, by: 0.135, bz: -1.62, lie: 1, j: { spine: [0, 0, 0], legL: [0.05, 0, -0.1], kneeL: [-0.05, 0, 0], footL: [-0.4, 0, 0], legR: [0.9, 0, 0.06], kneeR: [-2.05, 0, 0], footR: [-0.42, 0, 0], armL: [2.75, 0, -0.35], elbowL: [1.95, 0, 0], armR: [0.12, 0, 0.22], elbowR: [0.2, 0, 0] } },
  bed: { hipsY: 0.93, rx: PI / 2, by: 0.13, bz: -1.62, lie: 1, j: { spine: [0, 0, 0], legL: [0.03, 0, -0.05], legR: [0.03, 0, 0.05], kneeL: [-0.05, 0, 0], kneeR: [-0.05, 0, 0], footL: [-0.35, 0, 0], footR: [-0.35, 0, 0], armL: [0.1, 0, -0.2], armR: [0.1, 0, 0.2], elbowL: [0.3, 0, 0], elbowR: [0.3, 0, 0] } },
};
/* 자리마다 몸을 놓을 곳 [x, y, z, 몸 방향]. 모두 −z 를 본다 (scene.js·props.js 의 의자·차·텐트·부두·돗자리 자리와 맞춘다) */
function anchor(seat) {
  const cfg = ctx.W.cfg;
  switch (seat) {
    case 'chair': return [1.5, 0, 0.84, 0];
    case 'car': return [-0.45, 0, 8.08, 0];
    case 'tent': return [-1.6, 0.05, 1.7, 0];
    case 'bed': return [-1.1, 0.17, 2.0, 0];
    case 'dock': return [DOCK.x, 0, DOCK.z1, 0];
    case 'mat': { const [x, z] = BEACH.head; return [x, terrainH(x, z, cfg) + 0.012, z, 0]; }
  }
  return null;
}
function floorAt(x, z) {
  const W = ctx.W;
  for (const p of W.platforms) if (x > p.x[0] && x < p.x[1] && z > p.z[0] && z < p.z[1]) return p.y;
  return terrainH(x, z, W.cfg);
}

/* ── 매 프레임: 스냅샷 S 로 자세를 잡는다 ── */
const _tp = new V3(), _tv = new V3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
export function updateAvatar(A, S, dt) {
  const W = ctx.W; if (!W.cfg) return;
  A.t += dt; if (A.blendT > 0) A.blendT -= dt;
  const t = A.t, j = {};
  if (S.jacket !== A.jacket) { A.jacket = S.jacket; const g = GEAR.find(x => x.key === S.jacket) || GEAR.find(x => x.key === GEAR_DEFAULT.jacket); setJacket(A, g.tent); }
  const seat = (S.mode === 'seated' || S.mode === 'memo' || S.mode === 'sleep') ? S.seat : null, sp = seat && SEATP[seat];
  const key = (sp ? seat : 'walk') + ':' + (S.item || '');
  if (key !== A.key) { A.key = key; A.blendT = 0.9; }
  let tx, ty, tz, yaw, hipsY, by = 0, bz = 0, rx = 0, look = clamp(S.pitch, -0.6, 0.6);
  if (sp) {
    [tx, ty, tz, yaw] = anchor(seat);
    Object.assign(j, sp.j); hipsY = sp.hipsY; by = sp.by || 0; bz = sp.bz || 0; rx = sp.rx || 0;
    j.spine = [j.spine[0] + 0.012 * Math.sin(t * 1.4), 0, 0];
    if (sp.kick) { j.kneeL = [j.kneeL[0] + 0.12 * Math.sin(t * 1.1), 0, 0]; j.kneeR = [j.kneeR[0] + 0.12 * Math.sin(t * 1.1 + 1.7), 0, 0]; }
    /* 돗자리는 바다 쪽으로 낮아진다: 발 쪽이 내려가게 몸을 기울인다 */
    if (seat === 'mat') { const [hx, hz] = BEACH.head, s = Math.atan2(terrainH(hx, hz, W.cfg) - terrainH(hx, hz - 1.6, W.cfg), 1.6); rx -= s; by -= 1.6 * Math.sin(s); bz = -1.6 * Math.cos(s) - 0.02; }
    A.v = 0;
  } else {
    tx = S.x; tz = S.z; ty = floorAt(tx, tz); yaw = S.yaw;
    /* 걸음: 실제로 움직인 거리만큼 위상이 나간다. 빠를수록 보폭이 넓어진다 (한 걸음 0.75 ~ 1.0m) */
    const d = Math.hypot(tx - A.px, tz - A.pz); A.px = tx; A.pz = tz;
    const v = d < 0.5 ? d / Math.max(dt, 1e-3) : 0; A.v += (Math.min(v, 4) - A.v) * Math.min(1, dt * 8);
    if (d < 0.5) A.ph += d / (0.75 + 0.25 * clamp((A.v - 1.4) / 1.2, 0, 1)) * PI;
    hipsY = walkPose(j, A.ph, clamp(A.v / 1.2, 0, 1), t);
    /* 눈덩이 굴리기: 몸을 숙이고 두 손을 앞으로 */
    if (S.roll) { j.armL = [0.75, 0, 0.15]; j.armR = [0.75, 0, -0.15]; j.elbowL = j.elbowR = [0.45, 0, 0]; j.spine = [-0.28, 0, 0]; look = Math.max(-0.6, look - 0.3); }
  }
  /* 몸은 시선 방향을 조금 늦게 따라가고, 남은 차이는 고개가 돌린다 */
  A.yaw += wrapPI(yaw - A.yaw) * Math.min(1, dt * (sp ? 6 : 12));
  let hyaw = clamp(wrapPI(S.yaw - A.yaw), -1, 1);
  if (sp && sp.lie) { look = 0.05; hyaw *= 0.3; }
  j.head = [look, hyaw, 0]; j.spine = j.spine || [0, 0, 0];
  /* 손에 든 것 (누워 있으면 맡겨 두었다) */
  const it = sp && sp.lie ? null : S.item, I = it ? ITEM[it] : null;
  if (it !== A.item) { A.item = it; A.dr = 0; A.itemFresh = true; if (I) A.grip.position.set(I.g[0], I.g[1], I.g[2]); }
  const ie = I ? I.arm(j, S, A, dt) : Z;
  /* 관절: 자세가 바뀐 직후 0.9초는 천천히, 그 뒤엔 빠르게 따라간다 (처음 보일 때는 바로) */
  const k = A.snap ? 1 : 1 - Math.exp(-dt * (A.blendT > 0 ? 7 : 30));
  for (const n in A.J) { const a = j[n] || Z, c = A.cur[n]; c.x += (a[0] - c.x) * k; c.y += (a[1] - c.y) * k; c.z += (a[2] - c.z) * k; A.J[n].rotation.set(c.x, c.y, c.z); }
  A.hy += (hipsY - A.hy) * k; A.J.hips.position.y = A.hy;
  A.bPos.lerp(_tv.set(0, by, bz), k); A.body.position.copy(A.bPos); A.bRx += (rx - A.bRx) * k; A.body.rotation.x = A.bRx;
  /* 자리: 걸을 때는 그대로, 앉고 일어나는 동안에는 부드럽게 옮겨 간다 */
  if (!A.placed) { A.root.position.set(tx, ty, tz); A.yaw = yaw; A.placed = true; }
  else if (sp || A.blendT > 0) A.root.position.lerp(_tp.set(tx, ty, tz), 1 - Math.exp(-dt * 6));
  else A.root.position.set(tx, ty, tz);
  A.root.rotation.y = A.yaw;
  /* 물건 방향: 손이 어떻게 돌아가 있든 몸 기준으로 ie 만큼 */
  if (I) {
    if (A.itemFresh || A.snap) { A.curI.set(ie[0], ie[1], ie[2]); A.itemFresh = false; } else A.curI.lerp(_tv.set(ie[0], ie[1], ie[2]), k);
    A.root.updateMatrixWorld(true);
    A.J.handR.getWorldQuaternion(_q1).invert(); A.body.getWorldQuaternion(_q2); _q3.setFromEuler(_e2.set(A.curI.x, A.curI.y, A.curI.z, 'XYZ'));
    A.mount.quaternion.copy(_q1).multiply(_q2).multiply(_q3);
  }
  A.snap = false;
}

/* ── 내 아바타 ── */
let LA = null;
const LS = {};
/* 게임 상태 → 스냅샷. 멀티에서는 이 값을 그대로 보내면 된다 */
function localState(o) {
  o.mode = state.mode; o.seat = state.seat; o.x = player.x; o.z = player.z; o.yaw = player.yaw; o.pitch = player.pitch;
  o.item = state.item; o.jacket = state.jacketColor; o.roll = snowRolling();
  o.sip = anim.sipT !== null ? Math.sin(PI * Math.min(anim.sipT, 1)) : 0;
  o.mouth = anim.sipT !== null && anim.sipT >= 0.5 && anim.holding;
  o.roast = anim.roastK;
  const u = anim.eatT; o.eat = u === null ? 0 : ez(u < 0.4 ? u / 0.4 : u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4));
  return o;
}
/* 씬마다 (scene.js buildScene): 처음이면 만들고, 새 씬으로 옮긴다. 모자는 장소별로 */
export function attachAvatar(scene, cfg) {
  if (!LA) LA = buildAvatar();
  scene.add(LA.root); LA.root.visible = false; LA.placed = false; LA.snap = true;
  setHat(LA, HAT[cfg.key] || 'beanie');
}
/* 손에 든 것(W.item)을 아바타 손(true) 또는 카메라 손(false)에 붙인다 */
export function mountItem(onAvatar) {
  const it = ctx.W.item; if (!it || !LA) return;
  const dest = onAvatar ? LA.grip : ctx.hand;
  if (it.parent !== dest) dest.add(it);
}
export function updateLocalAvatar(dt, show) {
  if (!LA) return;
  LA.root.visible = show;
  if (!show) { LA.placed = false; LA.snap = true; return; }
  updateAvatar(LA, localState(LS), dt);
}