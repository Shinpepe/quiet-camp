import * as THREE from 'three';
import { ctx } from './state.js';
import { smoothM, canvasTex, shadowed, bar, METAL } from './util.js';
import { tex } from './textures.js';
import { makeChair, makeLantern, contactShadow } from './props.js';

/* ══ 홀덤 테이블·카드·칩 (멀티 배치에만) ══
   buildPoker(P): 씬을 만들 때 scene.js 가 부른다 (P = data.js 의 POKER + 의자 자리). 결과는 W.poker 에 남는다.
   테이블: 살짝 타원(장축 x)의 접이식 캠핑 테이블. 나무 상판 위 초록 펠트, 가장자리에 가죽 레일, X자 다리.
   랜턴 폴대: 테이블 옆에 세운 기둥에서 팔을 뻗어 테이블 가운데 위에 랜턴을 매단다. 시간대에 맞춰 저절로 켜진다 (main.js 가 W.pokerLight 를 밝힌다).
   카드: 52장 앞면 + 뒷면 한 장을 아틀라스 텍스처 하나에 그린다. 2색, 점보 인덱스(큰 숫자), 그림 카드는 테두리와 큰 무늬.
     뒷면은 표준 카드처럼 버건디 바탕에 마름모 격자, 흰 테두리, 가운데 작은 타원에 QUIET CAMP.
     무늬(♠♥♦♣)는 글꼴 대신 직접 그린다 — 기기에 따라 이모지로 바뀌는 일이 없게.
     카드 번호: 0..51 = 숫자 + 13 × 무늬 (숫자 0 = A … 12 = K, 무늬 0 ♠ · 1 ♥ · 2 ♦ · 3 ♣).
   칩: 52mm × 4.5mm (실제 칩의 1.33배). 옆면 엣지 스팟 6개, 윗면 인레이에 텐트 그림과 액면가. 액면가마다 InstancedMesh 하나 (그리기 호출 5번).
   테이블 위의 모든 것은 테이블 그룹(가운데 원점) 기준 좌표로 놓는다. 자리 기준 자리는 spot(자리, 안쪽, 오른쪽) 으로 구한다.
   공유 자원(아틀라스·카드 모양·칩 모양·재질)은 한 번만 만들고 씬이 바뀌어도 다시 쓴다 (userData.shared).
   H4-2 움직임: 카드마다 place(바로 놓기)·go(옮기기, 기다렸다가 포물선으로)·tint(밝기), 날아가는 칩 묶음(ChipFlights),
     덱(카드가 나가고 거둬지는 자리), 딜러 버튼 미끄러지기. 매 프레임 updateTable 이 움직인다 (poker.js 가 부른다)
   H1: POKER.demo 면 보기용 판을 깔아 둔다 (바닥 카드 5장·엎어 둔 손패·칩 더미·베팅·팟·딜러 버튼) */

/* 카드는 실제 포커 카드(6.3 × 8.8cm)의 1.6배, 칩은 실제(39mm)의 1.33배.
   앉은 눈에서 바닥 카드까지 약 1.1m 라, 실제 크기로는 비스듬히 눕힌 글자가 읽히지 않는다 */
export const CARD = { w: 0.1, h: 0.14, r: 0.007 };
export const CHIP = { r: 0.026, h: 0.0045 };
/* 액면가와 색 (카지노 관례) */
export const DENOMS = [
  { v: 5, col: '#b3262b' }, { v: 10, col: '#1f4fa0' }, { v: 25, col: '#2c7a3a' }, { v: 100, col: '#1d1d21' }, { v: 500, col: '#5a2a86' },
];
/* 시작 1,000칩의 구성 (DENOMS 순서): 5×10 · 10×15 · 25×12 · 100×5 */
export const START_STACK = [10, 15, 12, 5, 0];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const cardRank = c => c % 13, cardSuit = c => Math.floor(c / 13);
/* 자리 기준 배치 (가장자리에서 안쪽으로 m, 오른쪽으로 m)
   hole: [안쪽, 첫 장 오른쪽, 두 장 간격] · chips: [안쪽, 첫 더미 오른쪽, 더미 간격] · bet: 베팅 줄 안쪽 · button: [안쪽, 오른쪽]
   deck: 덱 자리 [안쪽, 오른쪽] (버튼을 가진 자리 기준)
   board: [가운데에서 차 쪽(+z)으로, 카드 사이 간격] · pot: 팟 가운데 [x, z] (테이블 가운데 기준) */
export const LAY = { hole: [0.2, -0.062, 0.11], chips: [0.2, 0.13, 0.056], bet: 0.36, button: [0.3, -0.2], deck: [0.36, 0.17], board: [0.07, 0.012], pot: [0, -0.13] };
/* 들춰 볼 때 손패의 먼 쪽 모서리를 드는 각도 (rad, 약 52°) */
export const PEEK_TILT = 0.9;

/* ── 아틀라스: 칸 13 × 5 (4줄 = 무늬, 마지막 줄 첫 칸 = 뒷면). 칸 사이에 여백을 두어 먼 거리(밉맵)에서 옆 칸이 번지지 않게 ── */
const CW = 144, CH = 200, PX = 152, PY = 204, AW = 2048, AH = 1024;
const RED = '#c0262c', BLACK = '#1b1b1d', PAPER = '#f6f3ec', BACK = '#7a1f2b', SPOT = '#f2eee6', INLAY = '#efe8d9';
const SERIF = 'Georgia, "Times New Roman", serif';

function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
/* 하트 모양 (dir 1 = 뾰족한 쪽이 아래, −1 = 위 — 스페이드의 몸통) */
function heartPath(g, x, y, S, dir) {
  const Y = k => y + k * S * dir;
  g.moveTo(x, Y(0.42));
  g.bezierCurveTo(x - 0.12 * S, Y(0.3), x - 0.5 * S, Y(0.08), x - 0.5 * S, Y(-0.16));
  g.bezierCurveTo(x - 0.5 * S, Y(-0.4), x - 0.3 * S, Y(-0.5), x - 0.24 * S, Y(-0.5));
  g.bezierCurveTo(x - 0.1 * S, Y(-0.5), x, Y(-0.4), x, Y(-0.28));
  g.bezierCurveTo(x, Y(-0.4), x + 0.1 * S, Y(-0.5), x + 0.24 * S, Y(-0.5));
  g.bezierCurveTo(x + 0.3 * S, Y(-0.5), x + 0.5 * S, Y(-0.4), x + 0.5 * S, Y(-0.16));
  g.bezierCurveTo(x + 0.5 * S, Y(0.08), x + 0.12 * S, Y(0.3), x, Y(0.42));
}
/* 무늬 하나: (x, y) 가운데, 높이 약 S */
function suit(g, s, x, y, S, col) {
  g.fillStyle = col; g.beginPath();
  if (s === 1) heartPath(g, x, y, S, 1);
  else if (s === 2) { g.moveTo(x, y - 0.5 * S); g.lineTo(x + 0.38 * S, y); g.lineTo(x, y + 0.5 * S); g.lineTo(x - 0.38 * S, y); g.closePath(); }
  else if (s === 0) {
    heartPath(g, x, y - 0.06 * S, S * 0.95, -1);
    g.moveTo(x, y + 0.05 * S); g.lineTo(x - 0.19 * S, y + 0.5 * S); g.lineTo(x + 0.19 * S, y + 0.5 * S); g.closePath();
  } else {
    [[0, -0.24], [-0.25, 0.08], [0.25, 0.08]].forEach(([dx, dy]) => { g.moveTo(x + dx * S + 0.22 * S, y + dy * S); g.arc(x + dx * S, y + dy * S, 0.22 * S, 0, Math.PI * 2); });
    g.moveTo(x + 0.12 * S, y + 0.02 * S); g.arc(x, y + 0.02 * S, 0.12 * S, 0, Math.PI * 2);
    g.moveTo(x, y); g.lineTo(x - 0.18 * S, y + 0.5 * S); g.lineTo(x + 0.18 * S, y + 0.5 * S); g.closePath();
  }
  g.fill();
}
/* 앞면: 모서리 두 곳에 큰 숫자와 무늬, 가운데에 큰 무늬 하나 (그림 카드는 가는 테두리 안에) */
function drawFace(g, ox, oy, r, s) {
  const col = s === 1 || s === 2 ? RED : BLACK;
  g.save(); g.translate(ox, oy);
  rr(g, 2, 2, CW - 4, CH - 4, 12); g.fillStyle = PAPER; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,.16)'; g.stroke();
  const index = () => {
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.font = `bold 54px ${SERIF}`;
    g.fillText(RANKS[r], 31, 58, 50);
    /* 6·9 는 테이블에서 돌려 보면 헷갈리므로 숫자 밑에 밑줄 */
    if (r === 5 || r === 8) g.fillRect(18, 62, 26, 4);
    suit(g, s, 31, 82, 28, col);
  };
  index(); g.save(); g.translate(CW, CH); g.rotate(Math.PI); index(); g.restore();
  if (r >= 10) { rr(g, 54, 30, 36, 140, 5); g.lineWidth = 2; g.strokeStyle = col; g.stroke(); suit(g, s, CW / 2, CH / 2, 30, col); }
  else suit(g, s, CW / 2, CH / 2, r === 0 ? 58 : 46, col);
  g.restore();
}
/* 뒷면: 흰 테두리 → 버건디 바탕에 마름모 격자 → 안쪽 가는 테두리 → 가운데 타원에 QUIET CAMP */
function drawBack(g, ox, oy) {
  g.save(); g.translate(ox, oy);
  rr(g, 2, 2, CW - 4, CH - 4, 12); g.fillStyle = PAPER; g.fill();
  rr(g, 10, 10, CW - 20, CH - 20, 7); g.fillStyle = BACK; g.fill();
  g.save(); rr(g, 10, 10, CW - 20, CH - 20, 7); g.clip();
  g.strokeStyle = 'rgba(255,240,230,.28)'; g.lineWidth = 1.4;
  for (let k = -CH; k < CW + CH; k += 11) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + CH, CH); g.stroke(); g.beginPath(); g.moveTo(k, CH); g.lineTo(k + CH, 0); g.stroke(); }
  g.restore();
  rr(g, 15, 15, CW - 30, CH - 30, 5); g.strokeStyle = 'rgba(255,240,230,.6)'; g.lineWidth = 1.2; g.stroke();
  g.beginPath(); g.ellipse(CW / 2, CH / 2, 46, 20, 0, 0, Math.PI * 2); g.fillStyle = BACK; g.fill(); g.strokeStyle = 'rgba(255,240,230,.85)'; g.lineWidth = 1.4; g.stroke();
  g.fillStyle = '#f3e9dc'; g.font = `bold 13px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  try { g.letterSpacing = '1.5px'; } catch (_) {}
  g.fillText('QUIET CAMP', CW / 2, CH / 2 + 1, 84);
  try { g.letterSpacing = '0px'; } catch (_) {}
  g.restore();
}

/* 흰 앞면: 숫자도 무늬도 없는 종이 (다른 사람이 들춰 보는 카드의 아랫면 — 실제 카드 정보는 그 사람에게만 있다) */
function drawBlank(g, ox, oy) {
  g.save(); g.translate(ox, oy);
  rr(g, 2, 2, CW - 4, CH - 4, 12); g.fillStyle = PAPER; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,.16)'; g.stroke();
  g.restore();
}
/* ── 칩 그림: 옆면(엣지 스팟 6개)과 윗면(가장자리 스팟·홈·점 고리·인레이·텐트·액면가) ── */
function chipSideTex(d) {
  const t = canvasTex(512, 32, (g, w, h) => {
    g.fillStyle = d.col; g.fillRect(0, 0, w, h);
    g.fillStyle = SPOT; for (let k = 0; k < 6; k++) g.fillRect((k + 0.5) * w / 6 - 14, 0, 28, h);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  });
  t.colorSpace = THREE.SRGBColorSpace; return t;
}
function chipFaceTex(d) {
  const t = canvasTex(256, 256, (g, w) => {
    const c = w / 2; g.fillStyle = d.col; g.fillRect(0, 0, w, w);
    g.fillStyle = SPOT;
    for (let k = 0; k < 6; k++) { const a = (k + 0.5) * Math.PI / 3, da = 0.2; g.beginPath(); g.arc(c, c, c, a - da, a + da); g.arc(c, c, c * 0.78, a + da, a - da, true); g.closePath(); g.fill(); }
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, c * 0.74, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.75)';
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; g.beginPath(); g.arc(c + Math.cos(a) * c * 0.66, c + Math.sin(a) * c * 0.66, 2.2, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = INLAY; g.beginPath(); g.arc(c, c, c * 0.56, 0, Math.PI * 2); g.fill();
    g.strokeStyle = d.col; g.lineWidth = 3; g.beginPath(); g.arc(c, c, c * 0.5, 0, Math.PI * 2); g.stroke();
    g.fillStyle = d.col; g.beginPath(); g.moveTo(c, c - 44); g.lineTo(c + 15, c - 20); g.lineTo(c - 15, c - 20); g.closePath(); g.fill();
    g.font = `bold 50px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(d.v), c, c + 16, c * 0.85);
  });
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function buttonTex() {
  const t = canvasTex(128, 128, (g, w) => {
    const c = w / 2; g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, c * 0.8, 0, Math.PI * 2); g.stroke();
    g.fillStyle = BLACK; g.font = `bold 64px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('D', c, c + 3);
  });
  t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ── 공유 자원: 처음 테이블을 만들 때 한 번 (1인 캠핑에서는 만들지 않는다) ── */
let A = null;
const shared = o => { o.userData.shared = true; return o; };
function cardShape() {
  const { w, h, r } = CARD, s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
/* 카드 한 면: 아틀라스의 (col, row) 칸. up = 위를 보는 면(앞면 자리), 아니면 아래를 보는 면(뒷면 자리).
   카드의 위쪽(글자 위)은 −z 를 향한다 → yaw 0 이면 +z 쪽에 앉은 사람에게 바로 보인다 */
function cardGeo(col, row, up) {
  const geo = new THREE.ShapeGeometry(cardShape(), 3), p = geo.attributes.position, uv = geo.attributes.uv;
  const u0 = (col * PX + 4) / AW, u1 = (col * PX + 4 + CW) / AW, v1 = 1 - (row * PY + 2) / AH, v0 = 1 - (row * PY + 2 + CH) / AH;
  for (let i = 0; i < p.count; i++) uv.setXY(i, u0 + (p.getX(i) / CARD.w + 0.5) * (u1 - u0), v0 + (p.getY(i) / CARD.h + 0.5) * (v1 - v0));
  geo.rotateX(-Math.PI / 2); if (!up) geo.rotateZ(Math.PI);
  return shared(geo);
}
function assets() {
  if (A) return A;
  const atlas = canvasTex(AW, AH, g => {
    for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) drawFace(g, r * PX + 4, s * PY + 2, r, s);
    drawBack(g, 4, 4 * PY + 2); drawBlank(g, PX + 4, 4 * PY + 2);
  });
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = Math.min(16, ctx.renderer.capabilities.getMaxAnisotropy());
  const chipMats = DENOMS.map(d => {
    const side = shared(smoothM(0xffffff, { map: chipSideTex(d), roughness: 0.42 })), face = shared(smoothM(0xffffff, { map: chipFaceTex(d), roughness: 0.38 }));
    return [side, face, face];
  });
  const btnTop = shared(smoothM(0xffffff, { map: buttonTex(), roughness: 0.4 }));
  A = {
    cardM: shared(smoothM(0xffffff, { map: atlas, roughness: 0.5 })), faces: [], blank: cardGeo(0, 4, true), backGeo: cardGeo(0, 4, false), white: cardGeo(1, 4, true),
    chipGeo: shared(new THREE.CylinderGeometry(CHIP.r, CHIP.r, CHIP.h, 36)), chipMats,
    btnGeo: shared(new THREE.CylinderGeometry(0.028, 0.028, 0.008, 36)), btnMats: [shared(smoothM(0xf2efe8, { roughness: 0.4 })), btnTop, btnTop],
  };
  return A;
}
const faceGeo = c => A.faces[c] || (A.faces[c] = cardGeo(cardRank(c), cardSuit(c), true));
const ease = u => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;

/* ── 카드 한 장: 앞면(위)·뒷면(아래) 두 장을 붙인 얇은 판 ──
   userData.set(c): 앞면에 그릴 카드 (null = 모르는 카드 → 앞면 자리에도 뒷면 무늬. 다른 사람의 손패. −1 = 흰 종이 — 다른 사람이 들춰 보는 카드의 아랫면).
     userData.card 에 카드 번호가 남는다 (모르는 카드·흰 종이는 null)
   userData.place(x, y, z, rx, ry, rz, show): 바로 놓는다 (show = false 면 숨긴 채로 — 곧 날아올 카드)
   userData.go(x, y, z, rx, ry, rz, dur, delay, arc, done): delay 초 기다렸다가(그동안 숨겨져 있었다면 그대로) dur 초에 걸쳐 옮긴다.
     arc = 가운데에서 솟는 높이(m). 끝나면 done()
   userData.lay(x, z, yaw, down, top, tilt): 예전 방식 (보기용 판)
   userData.tint(k): 밝기 (1 = 그대로, 0.5 = 어둡게 — 쇼다운에서 지지 않은 카드)
   회전 순서 YXZ: 자리 방향(yaw)으로 돌린 뒤, 그 자리 기준으로 기울이고(tilt) 뒤집는다(rz = π) */
export function makeCard() {
  const a = assets(), g = new THREE.Group(), m = a.cardM.clone(); m.userData = {};
  const front = new THREE.Mesh(a.blank, m), back = new THREE.Mesh(a.backGeo, m);
  front.position.y = 0.00015; back.position.y = -0.00015; front.receiveShadow = back.receiveShadow = true;
  g.add(front, back); g.visible = false; g.userData.card = null; g.rotation.order = 'YXZ';
  const tw = { on: false, t: 0, dur: 0, arc: 0, p0: new THREE.Vector3(), p1: new THREE.Vector3(), q0: new THREE.Quaternion(), q1: new THREE.Quaternion(), done: null };
  const E = new THREE.Euler(0, 0, 0, 'YXZ'), U = g.userData;
  U.set = c => { front.geometry = c === null || c === undefined ? a.blank : c === -1 ? a.white : faceGeo(c); U.card = typeof c === 'number' && c >= 0 ? c : null; };
  U.place = (x, y, z, rx, ry, rz, show = true) => { tw.on = false; tw.done = null; g.position.set(x, y, z); g.rotation.set(rx, ry, rz); g.visible = show; };
  U.go = (x, y, z, rx, ry, rz, dur, delay = 0, arc = 0, done = null) => {
    tw.p0.copy(g.position); tw.q0.copy(g.quaternion); tw.p1.set(x, y, z); tw.q1.setFromEuler(E.set(rx, ry, rz));
    tw.t = -delay; tw.dur = Math.max(0.01, dur); tw.arc = arc; tw.done = done; tw.on = true;
  };
  U.step = dt => {
    if (!tw.on) return; tw.t += dt; if (tw.t < 0) return; g.visible = true;
    const u = Math.min(1, tw.t / tw.dur), e = ease(u);
    g.position.lerpVectors(tw.p0, tw.p1, e); g.position.y += tw.arc * Math.sin(Math.PI * u);
    g.quaternion.slerpQuaternions(tw.q0, tw.q1, e);
    if (u >= 1) { tw.on = false; const d = tw.done; tw.done = null; if (d) d(); }
  };
  U.busy = () => tw.on;
  U.hide = () => { tw.on = false; tw.done = null; g.visible = false; };
  U.tint = k => { m.color.setScalar(k); };
  U.lay = (x, z, yaw, down, top, tilt = 0) => U.place(x, top + 0.0004 + (tilt ? Math.abs(Math.sin(tilt)) * CARD.h / 2 + 0.002 : 0), z, tilt, yaw, down ? Math.PI : 0);
  return g;
}
/* 카드 자세 [x, y, z, rx, ry, rz]: 테이블 가운데 기준 (x, z), yaw 방향, down = 엎음, lift = 띄우는 높이(m)
   tilt = 모서리 들기 (+ = 먼 쪽 — 내 들춰 보기, − = 가까운 쪽 — 다른 사람의 들춰 보기). 남은 모서리가 테이블에 닿게 그만큼 올린다 */
export function cardPose(T, x, z, yaw, down, tilt = 0, lift = 0) {
  return [x, T.top + 0.0004 + lift + (tilt ? Math.abs(Math.sin(tilt)) * CARD.h / 2 + 0.002 : 0), z, tilt, yaw, down ? Math.PI : 0];
}

/* ── 칩 묶음: 액면가마다 InstancedMesh 하나. clear → put·stack·pile → commit ──
   r: 난수 (renderChips 는 같은 금액이면 같은 모양이 되게 정해진 난수를 넣는다) */
const CAP = 320, _o = new THREE.Object3D();
export class ChipSet {
  constructor(parent) {
    const a = assets();
    this.ims = a.chipMats.map(ms => {
      const im = new THREE.InstancedMesh(a.chipGeo, ms, CAP); im.count = 0; im.castShadow = im.receiveShadow = true; im.frustumCulled = false; parent.add(im); return im;
    });
    this.n = this.ims.map(() => 0); this.r = Math.random;
  }
  clear() { this.n.fill(0); }
  j(a) { return (this.r() * 2 - 1) * a; }
  put(k, x, y, z, ry, tx = 0, tz = 0) {
    if (this.n[k] >= CAP) return;
    _o.position.set(x, y, z); _o.rotation.set(tx, ry, tz); _o.scale.set(1, 1, 1); _o.updateMatrix(); this.ims[k].setMatrixAt(this.n[k]++, _o.matrix);
  }
  /* 한 더미: 바닥 (x, z) 에서 n 개. 살짝씩 어긋나고 저마다 돌아가 있다 */
  stack(k, x, z, n, top) { for (let i = 0; i < n; i++) this.put(k, x + this.j(0.0007), top + CHIP.h * (i + 0.5), z + this.j(0.0007), this.r() * 6.283); }
  /* 팟처럼 흩어 놓은 칩: counts = 액면가별 개수. 작은 더미 여러 개로, 서로 겹치지 않게 */
  pile(counts, cx, cz, top, R = 0.05) {
    const piles = [], r = this.r;
    counts.forEach((n, k) => {
      for (let i = 0; i < n; i++) {
        let p = piles.length && r() < 0.5 ? piles[Math.floor(r() * piles.length)] : null;
        if (!p) {
          for (let t = 0; t < 10 && !p; t++) {
            const ang = r() * 6.283, rad = R * Math.sqrt(r()), x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
            if (piles.every(q => Math.hypot(q.x - x, q.z - z) > CHIP.r * 2.05)) p = { x, z, n: 0 };
          }
          if (!p) p = piles[0] || { x: cx, z: cz, n: 0 };
          if (!piles.includes(p)) piles.push(p);
        }
        this.put(k, p.x + this.j(0.003), top + CHIP.h * (p.n + 0.5), p.z + this.j(0.003), r() * 6.283, this.j(0.04), this.j(0.04)); p.n++;
      }
    });
  }
  commit() { this.ims.forEach((im, k) => { im.count = this.n[k]; im.instanceMatrix.needsUpdate = true; }); }
}
/* 금액 → 액면가별 개수 (큰 것부터) */
export function chipsFor(amount) {
  const out = DENOMS.map(() => 0);
  for (let k = DENOMS.length - 1; k >= 0; k--) { out[k] = Math.floor(amount / DENOMS[k].v); amount -= out[k] * DENOMS[k].v; }
  return out;
}
/* 앞에 쌓아 둔 칩의 구성: 5·10·25 를 조금씩 섞고 나머지는 큰 것부터 (1,000칩이면 시작 구성과 같다).
   1,500칩까지는 500칩을 쓰지 않는다 */
export function stackChips(amount) {
  const out = [0, 0, 0, 0, 0]; let rest = amount;
  [[0, 10, 0.05], [1, 15, 0.15], [2, 12, 0.3]].forEach(([k, max, share]) => {
    const v = DENOMS[k].v, n = Math.min(max, Math.floor(amount * share / v), Math.floor(rest / v)); out[k] = n; rest -= n * v;
  });
  for (let k = amount > 1500 ? 4 : 3; k >= 0; k--) { const v = DENOMS[k].v, n = Math.floor(rest / v); out[k] += n; rest -= n * v; }
  return out;
}

/* ── 날아가는 칩 묶음: 한 번에 최대 5개 (금액의 큰 칩부터). 포물선으로 옮겨 가고 도착하면 done() ── */
class ChipFlights {
  constructor(parent, top) {
    const a = assets(); this.top = top;
    this.pool = Array.from({ length: 16 }, () => {
      const g = new THREE.Group(); g.visible = false; parent.add(g);
      const ms = Array.from({ length: 5 }, (_, i) => { const m = new THREE.Mesh(a.chipGeo, a.chipMats[0]); m.position.y = CHIP.h * (i + 0.5); m.castShadow = true; g.add(m); return m; });
      return { g, ms, on: false, t: 0, dur: 1, from: [0, 0], to: [0, 0], done: null };
    });
  }
  fly(from, to, amount, dur, done) {
    let f = this.pool.find(o => !o.on);
    if (!f) { f = this.pool[0]; const d = f.done; f.done = null; f.on = false; if (d) d(); }
    const n = chipsFor(amount), list = [];
    for (let k = DENOMS.length - 1; k >= 0 && list.length < 5; k--) for (let i = 0; i < n[k] && list.length < 5; i++) list.push(k);
    f.ms.forEach((m, i) => { m.visible = i < list.length; if (i < list.length) { m.material = A.chipMats[list[i]]; m.rotation.y = Math.random() * 6.283; } });
    Object.assign(f, { on: true, t: 0, dur, from, to, done });
    f.g.position.set(from[0], this.top, from[1]); f.g.visible = true;
  }
  update(dt) {
    for (const f of this.pool) {
      if (!f.on) continue;
      f.t += dt; const u = Math.min(1, f.t / f.dur), e = ease(u);
      f.g.position.set(f.from[0] + (f.to[0] - f.from[0]) * e, this.top + 0.04 * Math.sin(Math.PI * u), f.from[1] + (f.to[1] - f.from[1]) * e);
      if (u >= 1) { f.on = false; f.g.visible = false; const d = f.done; f.done = null; if (d) d(); }
    }
  }
  clear() { this.pool.forEach(f => { f.on = false; f.g.visible = false; f.done = null; }); }
}

/* ── 자리 기준: d = 가운데 → 의자 방향, r = 그 자리에 앉은 사람의 오른쪽, e = 그 방향의 상판 가장자리까지 거리 ── */
function seatFrames(P) {
  return P.chairs.map(([x, z, yaw]) => {
    const dx = x - P.at[0], dz = z - P.at[1], L = Math.hypot(dx, dz) || 1, d = [dx / L, dz / L];
    return { d, r: [d[1], -d[0]], e: 1 / Math.hypot(d[0] / P.rx, d[1] / P.rz), yaw };
  });
}
/* 자리 f 에서 가장자리 안쪽 inw, 오른쪽 lat 인 점 (테이블 가운데 기준 [x, z]) */
export const spot = (f, inw, lat) => [f.d[0] * (f.e - inw) + f.r[0] * lat, f.d[1] * (f.e - inw) + f.r[1] * lat];
export const pokerTable = () => ctx.W.poker || null;
/* 자리마다의 자리 [x, z, yaw]: 손패 j 번째 · 바닥 카드 i 번째 · 덱(버튼을 가진 자리 앞) · 앞 칩 더미 가운데 · 베팅 줄 */
export const holeXZ = (T, k, j) => { const f = T.frames[k], [x, z] = spot(f, LAY.hole[0], LAY.hole[1] + j * LAY.hole[2]); return [x, z, f.yaw + (j ? 0.07 : -0.05)]; };
export const boardXZ = i => [(i - 2) * (CARD.w + LAY.board[1]), LAY.board[0], 0];
export const deckXZ = (T, btn) => { const f = T.frames[btn >= 0 && T.frames[btn] ? btn : 0], [x, z] = spot(f, LAY.deck[0], LAY.deck[1]); return [x, z, f.yaw]; };
export const stackXZ = (T, k) => spot(T.frames[k], LAY.chips[0], LAY.chips[1] + LAY.chips[2]);
export const betXZ = (T, k) => spot(T.frames[k], LAY.bet, 0);

/* ── 씬마다 (멀티 배치일 때 scene.js) ── */
export function buildPoker(P) {
  const W = ctx.W, scene = ctx.scene, a = assets(), TOP = P.h + 0.004;
  const g = new THREE.Group(); g.position.set(P.at[0], 0, P.at[1]); scene.add(g);
  const wood = smoothM(0x7d5a3a, Object.assign({ roughness: 0.7 }, tex('wood', 2, 2, 0.25)));
  const felt = smoothM(0x2b5a3e, Object.assign({ roughness: 1 }, tex('fabric', 10, 10, 0.3, false)));
  const leather = smoothM(0x2a1c15, { roughness: 0.55 }), metal = METAL();
  const disk = (sx, sz, th, y, m) => { const d = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, th, 72), m); d.scale.set(sx, 1, sz); d.position.y = y; g.add(d); };
  /* 상판·펠트(가장자리 6cm 안쪽)·레일 */
  disk(P.rx, P.rz, 0.025, P.h - 0.0125, wood);
  disk(P.rx - 0.06, P.rz - 0.06, 0.004, P.h + 0.002, felt);
  const rp = []; for (let i = 0; i < 72; i++) { const t = i / 72 * Math.PI * 2; rp.push(new THREE.Vector3(Math.cos(t) * (P.rx - 0.034), TOP + 0.01, Math.sin(t) * (P.rz - 0.034))); }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp, true), 144, 0.031, 10, true), leather));
  /* X자 다리 두 벌 (앞뒤), 바닥 받침, 상판 밑 가로대 */
  const lx = P.rx * 0.55, lz = P.rz * 0.55, ly = P.h - 0.03;
  [-1, 1].forEach(s => {
    g.add(bar([-lx, ly, s * lz], [lx, 0.012, s * lz], 0.011, metal, 8)); g.add(bar([lx, ly, s * lz], [-lx, 0.012, s * lz], 0.011, metal, 8));
    g.add(bar([s * lx, 0.012, -lz], [s * lx, 0.012, lz], 0.011, metal, 8)); g.add(bar([s * lx, ly, -lz], [s * lx, ly, lz], 0.011, metal, 8));
  });
  shadowed(g);
  contactShadow(P.at[0], P.at[1], P.rx * 2 + 0.5, P.rz * 2 + 0.5, 0.6);
  /* 의자: 캠프 의자와 같은 모델을 테이블 쪽으로 돌려 놓는다 */
  P.chairs.forEach(([x, z, yaw]) => { const c = makeChair(); c.position.set(x, 0, z); c.rotation.y = yaw; scene.add(c); contactShadow(x, z, 1.2, 1.2, 0.6); });
  /* 랜턴 폴대: 기둥 → 테이블 가운데 위로 뻗은 팔 → 고리 → 랜턴. 앉은 눈보다 높아 테이블을 내려다볼 때는 시야 밖이다 */
  const [px, pz] = P.pole, cx = P.at[0], cz = P.at[1], HY = 1.82, pole = new THREE.Group();
  pole.add(bar([px, 0, pz], [px, HY + 0.02, pz], 0.018, metal, 10), bar([px, HY, pz], [cx, HY, cz], 0.011, metal, 8), bar([cx, HY, cz], [cx, 1.66, cz], 0.0025, metal, 4));
  pole.add(bar([px - 0.18, 0.012, pz], [px + 0.18, 0.012, pz], 0.012, metal, 6), bar([px, 0.012, pz - 0.18], [px, 0.012, pz + 0.18], 0.012, metal, 6));
  const lamp = makeLantern(W.tm.lantern > 0.5); lamp.scale.setScalar(0.9); lamp.position.set(cx, 1.66 - 0.193 * 0.9, cz); pole.add(lamp);
  scene.add(shadowed(pole)); W.pokerLampObj = lamp;
  W.pokerLight = new THREE.PointLight(0xffc07a, 0, 5, 2); W.pokerLight.position.set(cx, 1.5, cz); scene.add(W.pokerLight);
  /* 카드·칩·딜러 버튼: 바닥 카드 5장, 자리마다 손패 2장 */
  const chips = new ChipSet(g);
  const board = Array.from({ length: 5 }, () => { const c = makeCard(); g.add(c); return c; });
  const hole = P.chairs.map(() => [0, 1].map(() => { const c = makeCard(); g.add(c); return c; }));
  const btn = new THREE.Mesh(a.btnGeo, a.btnMats); btn.visible = false; btn.castShadow = btn.receiveShadow = true; g.add(btn);
  /* 덱: 판이 열린 동안 버튼 자리 앞에 놓인 카드 더미. 카드가 여기서 나가고 여기로 거둬진다 */
  const deck = new THREE.Group(), deckBody = new THREE.Mesh(new THREE.BoxGeometry(CARD.w * 0.97, 0.014, CARD.h * 0.97), smoothM(0xefe9de, { roughness: 0.6 })), deckTop = makeCard();
  deckBody.position.y = 0.007; deckBody.castShadow = deckBody.receiveShadow = true;
  deckTop.userData.place(0, 0.0142, 0, 0, 0, 0); deck.add(deckBody, deckTop); deck.visible = false; g.add(deck);
  const T = W.poker = { P, group: g, top: TOP, frames: seatFrames(P), chips, board, hole, btn, deck, flights: new ChipFlights(g, TOP), btnTw: null };
  if (P.demo) demo(T);
  chips.commit();
  return T;
}

/* ── H1 보기용 판: 플랍·턴·리버가 다 나온 채로, 1·2번 자리가 120씩 걸었고 3번 자리는 폴드, 딜러 버튼은 3번 자리 ── */
function demo(T) {
  const { chips, frames, board, hole, btn, top } = T;
  [12, 21, 34, 42, 13].forEach((c, i) => { board[i].userData.set(c); board[i].userData.lay((i - 2) * (CARD.w + LAY.board[1]), LAY.board[0], 0, false, top); });
  const STACKS = [START_STACK, [6, 7, 10, 4, 0], [8, 12, 8, 6, 0], [4, 6, 14, 8, 0]];
  frames.forEach((f, k) => {
    if (k !== 3) hole[k].forEach((c, j) => { const [x, z] = spot(f, LAY.hole[0], LAY.hole[1] + j * LAY.hole[2]); c.userData.set(null); c.userData.lay(x, z, f.yaw + (j ? 0.07 : -0.05), true, top); });
    let col = 0;
    for (let d = DENOMS.length - 1; d >= 0; d--) {
      let n = STACKS[k][d];
      while (n > 0) { const m = Math.min(n, 20), [x, z] = spot(f, LAY.chips[0], LAY.chips[1] + col * LAY.chips[2]); chips.stack(d, x, z, m, top); n -= m; col++; }
    }
  });
  [1, 2].forEach(k => { const f = frames[k], a = spot(f, LAY.bet, -0.028), b = spot(f, LAY.bet, 0.028); chips.stack(3, a[0], a[1], 1, top); chips.stack(1, b[0], b[1], 2, top); });
  chips.pile([1, 1, 1, 2, 0], LAY.pot[0], LAY.pot[1], top);
  const [bx, bz] = spot(frames[3], LAY.button[0], LAY.button[1]); btn.position.set(bx, top + 0.004, bz); btn.rotation.y = frames[3].yaw; btn.visible = true;
}

/* ══ 판의 모습 (poker.js 가 쓴다) ══ */
/* 놓여 있는 칩: d = { stacks: [칩 ×4], bets: [칩 ×4], pot: 칩 }. 같은 금액이면 늘 같은 모양 (자리·팟마다 정해진 난수) */
export function renderChips(T, d) {
  const { chips, frames, top } = T; let s = 1;
  const seed = v => { s = v; chips.r = () => (s = (s * 16807) % 2147483647) / 2147483647; };
  chips.clear();
  frames.forEach((f, k) => {
    seed(7 + k * 101);
    /* 앞의 칩: 큰 것부터 더미마다 20개까지 */
    const n = stackChips(Math.max(0, d.stacks[k] || 0)); let col = 0;
    for (let q = DENOMS.length - 1; q >= 0; q--) {
      let m = n[q];
      while (m > 0) { const c = Math.min(m, 20), [x, z] = spot(f, LAY.chips[0], LAY.chips[1] + col * LAY.chips[2]); chips.stack(q, x, z, c, top); m -= c; col++; }
    }
    /* 이번 라운드에 건 칩: 베팅 줄 위에 액면가마다 한 더미 */
    const bet = Math.max(0, d.bets[k] || 0);
    if (bet > 0) {
      const used = chipsFor(bet).map((v, q) => [q, v]).filter(e => e[1] > 0);
      used.forEach(([q, v], i) => { const [x, z] = spot(f, LAY.bet, (i - (used.length - 1) / 2) * 0.056); chips.stack(q, x, z, v, top); });
    }
  });
  seed(991);
  if (d.pot > 0) chips.pile(stackChips(d.pot), LAY.pot[0], LAY.pot[1], top);
  chips.commit(); chips.r = Math.random;
}
/* 딜러 버튼: dur 초에 걸쳐 그 자리로 미끄러진다 (0 이면 바로). seat < 0 이면 숨긴다 */
export function setButton(T, seat, dur = 0) {
  const b = T.btn; if (seat < 0 || !T.frames[seat]) { b.visible = false; T.btnTw = null; return; }
  const f = T.frames[seat], [x, z] = spot(f, LAY.button[0], LAY.button[1]);
  b.rotation.y = f.yaw;
  if (!b.visible || !dur) { b.position.set(x, T.top + 0.004, z); b.visible = true; T.btnTw = null; return; }
  T.btnTw = { x0: b.position.x, z0: b.position.z, x1: x, z1: z, t: 0, dur };
}
/* 매 프레임: 카드·날아가는 칩·버튼 */
export function updateTable(T, dt) {
  T.board.forEach(c => c.userData.step(dt)); T.hole.forEach(p => p.forEach(c => c.userData.step(dt)));
  T.flights.update(dt);
  const b = T.btnTw;
  if (b) {
    b.t += dt; const u = Math.min(1, b.t / b.dur), e = ease(u);
    T.btn.position.set(b.x0 + (b.x1 - b.x0) * e, T.top + 0.004 + 0.02 * Math.sin(Math.PI * u), b.z0 + (b.z1 - b.z0) * e);
    if (u >= 1) T.btnTw = null;
  }
}
/* 테이블을 비운다 (캠핑장에 들어갈 때·나갈 때) */
export function clearTable(T) {
  [...T.board, ...T.hole.flat()].forEach(c => { c.userData.hide(); c.userData.tint(1); });
  T.flights.clear(); T.deck.visible = false; T.btn.visible = false; T.btnTw = null;
  T.chips.clear(); T.chips.commit();
}