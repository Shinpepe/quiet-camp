import * as THREE from 'three';
import { ctx } from './state.js';
import { smoothM, canvasTex, shadowed, bar, METAL, rnd } from './util.js';
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
   칩: 39mm × 3.3mm. 옆면 엣지 스팟 6개, 윗면 인레이에 텐트 그림과 액면가. 액면가마다 InstancedMesh 하나 (그리기 호출 5번).
   테이블 위의 모든 것은 테이블 그룹(가운데 원점) 기준 좌표로 놓는다. 자리 기준 자리는 spot(자리, 안쪽, 오른쪽) 으로 구한다.
   공유 자원(아틀라스·카드 모양·칩 모양·재질)은 한 번만 만들고 씬이 바뀌어도 다시 쓴다 (userData.shared).
   H1: POKER.demo 면 보기용 판을 깔아 둔다 (바닥 카드 5장·엎어 둔 손패·칩 더미·베팅·팟·딜러 버튼) */

export const CARD = { w: 0.063, h: 0.088, r: 0.0045 };
export const CHIP = { r: 0.0195, h: 0.0033 };
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
   board: [가운데에서 차 쪽(+z)으로, 카드 사이 간격] · pot: 팟 가운데 [x, z] (테이블 가운데 기준) */
export const LAY = { hole: [0.16, -0.045, 0.07], chips: [0.14, 0.09, 0.042], bet: 0.28, button: [0.22, -0.14], board: [0.05, 0.009], pot: [0, -0.11] };

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
    g.fillText(RANKS[r], 31, 58, 50); suit(g, s, 31, 82, 28, col);
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
    drawBack(g, 4, 4 * PY + 2);
  });
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 8;
  const chipMats = DENOMS.map(d => {
    const side = shared(smoothM(0xffffff, { map: chipSideTex(d), roughness: 0.42 })), face = shared(smoothM(0xffffff, { map: chipFaceTex(d), roughness: 0.38 }));
    return [side, face, face];
  });
  const btnTop = shared(smoothM(0xffffff, { map: buttonTex(), roughness: 0.4 }));
  A = {
    cardM: shared(smoothM(0xffffff, { map: atlas, roughness: 0.5 })), faces: [], blank: cardGeo(0, 4, true), backGeo: cardGeo(0, 4, false),
    chipGeo: shared(new THREE.CylinderGeometry(CHIP.r, CHIP.r, CHIP.h, 36)), chipMats,
    btnGeo: shared(new THREE.CylinderGeometry(0.021, 0.021, 0.006, 36)), btnMats: [shared(smoothM(0xf2efe8, { roughness: 0.4 })), btnTop, btnTop],
  };
  return A;
}
const faceGeo = c => A.faces[c] || (A.faces[c] = cardGeo(cardRank(c), cardSuit(c), true));

/* ── 카드 한 장: 앞면(위)·뒷면(아래) 두 장을 붙인 얇은 판 ──
   userData.set(c): 앞면에 그릴 카드 (null = 모르는 카드 → 앞면 자리에도 뒷면 무늬. 다른 사람의 손패)
   userData.lay(x, z, yaw, down, top): 테이블 위에 놓는다 (테이블 가운데 기준, yaw = 글자 위쪽이 향하는 자리의 방향, down = 엎어 둠) */
export function makeCard() {
  const a = assets(), g = new THREE.Group();
  const front = new THREE.Mesh(a.blank, a.cardM), back = new THREE.Mesh(a.backGeo, a.cardM);
  front.position.y = 0.00015; back.position.y = -0.00015; front.receiveShadow = back.receiveShadow = true;
  g.add(front, back); g.visible = false; g.userData.card = null;
  g.userData.set = c => { front.geometry = c === null || c === undefined ? a.blank : faceGeo(c); g.userData.card = c; };
  g.userData.lay = (x, z, yaw, down, top) => { g.position.set(x, top + 0.0004, z); g.rotation.set(0, yaw, down ? Math.PI : 0); g.visible = true; };
  return g;
}

/* ── 칩 묶음: 액면가마다 InstancedMesh 하나. clear → put·stack·pile → commit ── */
const CAP = 320, _o = new THREE.Object3D();
export class ChipSet {
  constructor(parent) {
    const a = assets();
    this.ims = a.chipMats.map(ms => {
      const im = new THREE.InstancedMesh(a.chipGeo, ms, CAP); im.count = 0; im.castShadow = im.receiveShadow = true; im.frustumCulled = false; parent.add(im); return im;
    });
    this.n = this.ims.map(() => 0);
  }
  clear() { this.n.fill(0); }
  put(k, x, y, z, ry, tx = 0, tz = 0) {
    if (this.n[k] >= CAP) return;
    _o.position.set(x, y, z); _o.rotation.set(tx, ry, tz); _o.scale.set(1, 1, 1); _o.updateMatrix(); this.ims[k].setMatrixAt(this.n[k]++, _o.matrix);
  }
  /* 한 더미: 바닥 (x, z) 에서 n 개. 살짝씩 어긋나고 저마다 돌아가 있다 */
  stack(k, x, z, n, top) { for (let i = 0; i < n; i++) this.put(k, x + rnd(-0.0007, 0.0007), top + CHIP.h * (i + 0.5), z + rnd(-0.0007, 0.0007), Math.random() * 6.283); }
  /* 팟처럼 흩어 놓은 칩: counts = 액면가별 개수. 작은 더미 여러 개로, 서로 겹치지 않게 */
  pile(counts, cx, cz, top, R = 0.05) {
    const piles = [];
    counts.forEach((n, k) => {
      for (let i = 0; i < n; i++) {
        let p = piles.length && Math.random() < 0.5 ? piles[Math.floor(Math.random() * piles.length)] : null;
        if (!p) {
          for (let t = 0; t < 10 && !p; t++) {
            const a = Math.random() * 6.283, r = R * Math.sqrt(Math.random()), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
            if (piles.every(q => Math.hypot(q.x - x, q.z - z) > CHIP.r * 2.05)) p = { x, z, n: 0 };
          }
          if (!p) p = piles[0] || { x: cx, z: cz, n: 0 };
          if (!piles.includes(p)) piles.push(p);
        }
        this.put(k, p.x + rnd(-0.003, 0.003), top + CHIP.h * (p.n + 0.5), p.z + rnd(-0.003, 0.003), Math.random() * 6.283, rnd(-0.04, 0.04), rnd(-0.04, 0.04)); p.n++;
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

/* ── 씬마다 (멀티 배치일 때 scene.js) ── */
export function buildPoker(P) {
  const W = ctx.W, scene = ctx.scene, a = assets(), TOP = P.h + 0.004;
  const g = new THREE.Group(); g.position.set(P.at[0], 0, P.at[1]); scene.add(g);
  const wood = smoothM(0x7d5a3a, Object.assign({ roughness: 0.7 }, tex('wood', 2, 2, 0.25)));
  const felt = smoothM(0x2b5a3e, Object.assign({ roughness: 1 }, tex('fabric', 10, 10, 0.3, false)));
  const leather = smoothM(0x2a1c15, { roughness: 0.55 }), metal = METAL();
  const disk = (sx, sz, th, y, m) => { const d = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, th, 72), m); d.scale.set(sx, 1, sz); d.position.y = y; g.add(d); };
  /* 상판·펠트(가장자리 5cm 안쪽)·레일 */
  disk(P.rx, P.rz, 0.025, P.h - 0.0125, wood);
  disk(P.rx - 0.05, P.rz - 0.05, 0.004, P.h + 0.002, felt);
  const rp = []; for (let i = 0; i < 72; i++) { const t = i / 72 * Math.PI * 2; rp.push(new THREE.Vector3(Math.cos(t) * (P.rx - 0.028), TOP + 0.008, Math.sin(t) * (P.rz - 0.028))); }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp, true), 144, 0.026, 10, true), leather));
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
  const T = W.poker = { P, group: g, top: TOP, frames: seatFrames(P), chips, board, hole, btn };
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
  [1, 2].forEach(k => { const f = frames[k], a = spot(f, LAY.bet, -0.021), b = spot(f, LAY.bet, 0.021); chips.stack(3, a[0], a[1], 1, top); chips.stack(1, b[0], b[1], 2, top); });
  chips.pile([1, 1, 1, 2, 0], LAY.pot[0], LAY.pot[1], top);
  const [bx, bz] = spot(frames[3], LAY.button[0], LAY.button[1]); btn.position.set(bx, top + 0.003, bz); btn.rotation.y = frames[3].yaw; btn.visible = true;
}