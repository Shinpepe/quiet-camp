import * as THREE from 'three';
import { ctx, records, saveSettings } from './state.js';
import { FISHING } from './data.js';
import { rnd, smoothM } from './util.js';
import { WATER_Y } from './terrain.js';
import { sfx } from './audio.js';
import { makeGauge, gaugeUpdate, gaugeJudge, gaugeShow, gaugeHide, banner, showCard, hideCard } from './gauge.js';
import { DOCK } from './dock.js';

/* ══ 부두 낚시 ══
   부두 끝에 앉으면 낚싯대를 든다. 시선은 game.js 가 물 쪽 180°·아래 약 20°로 제한한다.
   던지기: 바라보는 쪽으로, 거리는 시선 높이로 (수평선 근처 = 멀리, 아래 = 가까이).
   기다리기: 찌가 1~3번 톡톡(헛입질). 이때 누르면 "너무 일렀다" → 찌를 감아 들인다.
   입질: FISHING.biteWin 안에 눌러야 챔질 → 게이지. 놓치면 다시 기다린다.
   끌어올리기: 성공 needOk 번 또는 대성공 needGr 번이면 잡힌다. 실패 FISHING.fails 번이면 줄이 풀린다.
   잡으면 눈앞에 들어 이름·크기를 보여 주고, 누르면 놓아준다.
   줄은 수면을 지나는 지점에서 끊어 그리고, 끌어올릴 때의 물결도 그 지점에서 퍼진다 */

const V = THREE.Vector3, WY = WATER_Y;
const cl = (x, a, b) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a) * t;
const sst = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const eio = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, eout = t => 1 - (1 - t) * (1 - t);
const h2 = (a, b) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };
const h3 = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
function n3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), f = x - i, g = y - j, h = z - k, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g), w = h * h * (3 - 2 * h), c = (a, b, d) => h3(i + a, j + b, k + d);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v), lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const hx = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; }, mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/* game.js 가 연결한다 */
export const fishHooks = { toast: null, hud: null };

/* ── 물고기 8종: 몸 비율·색·무늬·지느러미. s = 크기 범위(cm) ── */
export const FISH_SPECIES = [
  { n: '붕어', s: [15, 40], H: .19, W: .085, pk: .38, ped: .055, sn: .6, hump: .02, back: '#3c4a2a', side: '#a08c48', belly: '#e6d8a8', pat: 'scale', tail: 'fork', fin: '#6b6040', dors: [[.36, .72, .085, 0]], anal: [.72, .83, .06], eye: 1 },
  { n: '잉어', s: [30, 90], H: .15, W: .08, pk: .4, ped: .05, sn: .55, hump: .025, back: '#4a3c20', side: '#c09440', belly: '#eedaa4', pat: 'scale', tail: 'fork', fin: '#8a6a38', dors: [[.36, .78, .075, 0]], anal: [.74, .84, .06], barbel: 'short', eye: .9 },
  { n: '송어', s: [25, 70], H: .12, W: .06, pk: .42, ped: .045, sn: .75, hump: .01, back: '#55664a', side: '#bcc4b4', belly: '#f4f2ec', pat: 'trout', tail: 'fork', fin: '#7a8070', dors: [[.4, .54, .08, 0]], adi: .83, anal: [.7, .8, .05], eye: 1 },
  { n: '메기', s: [30, 100], H: .09, W: .11, pk: .2, ped: .03, sn: .35, hump: 0, back: '#36322c', side: '#5a5246', belly: '#d6cebe', pat: 'mottle', tail: 'round', fin: '#3c3832', dors: [[.3, .36, .04, 0]], anal: [.45, .96, .045], barbel: 'long', eye: .55, flat: 1 },
  { n: '쏘가리', s: [20, 60], H: .15, W: .07, pk: .36, ped: .05, sn: .55, hump: .02, back: '#5a4822', side: '#b89c4a', belly: '#ecdeb2', pat: 'leopard', tail: 'round', fin: '#8a7034', dors: [[.3, .6, .09, 1], [.6, .78, .075, 0]], anal: [.68, .8, .07], mouth: 1, eye: 1 },
  { n: '배스', s: [20, 60], H: .14, W: .07, pk: .38, ped: .05, sn: .55, hump: .02, back: '#3a5a2c', side: '#8ea464', belly: '#e8ecd2', pat: 'bass', tail: 'fork', fin: '#5a6e40', dors: [[.3, .5, .08, 1], [.52, .72, .085, 0]], anal: [.68, .8, .065], mouth: 1, eye: 1 },
  { n: '블루길', s: [10, 25], H: .26, W: .07, pk: .46, ped: .06, sn: .55, hump: 0, back: '#36464a', side: '#7f8f70', belly: '#e09a48', pat: 'gill', tail: 'fork', fin: '#4a5650', dors: [[.3, .55, .08, 1], [.55, .8, .1, 0]], anal: [.6, .82, .09], eye: 1.1 },
  { n: '빙어', s: [8, 15], H: .08, W: .045, pk: .4, ped: .03, sn: .75, hump: 0, back: '#8fa8a0', side: '#d6e0e2', belly: '#f4f6f4', pat: 'smelt', tail: 'fork', fin: '#c8d4d4', dors: [[.46, .56, .06, 0]], adi: .82, anal: [.7, .8, .04], eye: 1.4 },
];

/* ── 물고기 모델: 길이 1(머리 +x). 단면이 타원인 관을 길이 방향으로 쓸어 몸을 만들고, 무늬는 정점색 ── */
export function fishModel(sp) {
  const g = new THREE.Group(), XU = u => 0.5 - 0.88 * u;
  const prof = (u, H, ped) => u < sp.pk ? H * Math.pow(Math.sin(Math.PI / 2 * u / sp.pk), sp.sn) : lerp(H, ped, Math.pow((u - sp.pk) / (1 - sp.pk), 0.8));
  const hr = u => prof(u, sp.H, sp.ped) * (sp.flat ? 1 - 0.35 * Math.pow(1 - u, 3) : 1), wr = u => prof(u, sp.W, sp.ped * 0.6) * (sp.flat ? 1 + 0.6 * Math.pow(1 - u, 2) : 1);
  const yc = u => sp.hump * Math.sin(Math.PI * u), top = u => yc(u) + hr(u), bot = u => yc(u) - hr(u);
  const B = hx(sp.back), Sd = hx(sp.side), Be = hx(sp.belly), NU = 50, NV = 28, pos = [], col = [], idx = [];
  for (let i = 0; i <= NU + 1; i++) {
    const u = Math.min(1, i / NU), cap = i > NU, x = cap ? XU(1) - 0.01 : XU(u);
    for (let j = 0; j <= NV; j++) {
      const v = j / NV * Math.PI * 2, s = Math.sin(v), c = Math.cos(v), k = cap ? 0 : 1, y = yc(u) + hr(u) * s * k, z = wr(u) * c * k;
      let cc = mix(Be, Sd, sst(-0.55, 0.15, s)); cc = mix(cc, B, sst(0.25, 0.85, s)); if (Math.abs(u - 0.2 - 0.02 * s * s) < 0.012) cc = mul(cc, 0.8);
      if (sp.pat === 'scale' && u > 0.22) { const f = (u * 70 + 0.5 * Math.floor(v / (2 * Math.PI) * 44)) % 1; cc = mul(cc, 1 - 0.16 * sst(0.75, 1, f) * (1 - sst(0.9, 1, u))); }
      else if (sp.pat === 'trout') { const cu = Math.floor(u * 34), cv = Math.floor(v / (2 * Math.PI) * 22), d = Math.hypot(u * 34 % 1 - 0.5, (v / (2 * Math.PI) * 22) % 1 - 0.5); if (h2(cu, cv) > 0.55 && d < 0.24 && s > -0.15 && u > 0.08) cc = mix(cc, [0.08, 0.08, 0.07], 0.85); if (Math.abs(s) < 0.2 && u > 0.15 && u < 0.95) cc = mix(cc, hx('#d98a8c'), 0.55 * (1 - Math.abs(s) / 0.2)); }
      else if (sp.pat === 'mottle') { if (s > -0.35) cc = mul(cc, 0.7 + 0.6 * n3(x * 14, y * 14, z * 14)); }
      else if (sp.pat === 'leopard') { const cu = Math.floor(u * 16), cv = Math.floor(v / (2 * Math.PI) * 14), d = Math.hypot(u * 16 % 1 - 0.5, (v / (2 * Math.PI) * 14) % 1 - 0.5); if (h2(cu + 7, cv) > 0.4 && d < 0.3 && s > -0.4 && u > 0.05) cc = mix(cc, hx('#2b2414'), 0.85); }
      else if (sp.pat === 'bass') { const s0 = 0.05 + 0.08 * Math.sin(u * 18); if (Math.abs(s - s0) < 0.15 * (0.55 + 0.6 * n3(x * 9, y * 9, z * 9)) && u > 0.15) cc = mix(cc, hx('#2e3a1e'), 0.75); }
      else if (sp.pat === 'gill') { if (s > -0.3 && u > 0.25 && u < 0.92) cc = mul(cc, 1 - 0.28 * sst(0.55, 1, 0.5 + 0.5 * Math.cos(u * Math.PI * 14))); if (u < 0.27 && s < 0.25 && s > -0.45) cc = mix(cc, hx('#4a6a9a'), 0.3); if (Math.hypot(u - 0.245, (s - 0.15) * 0.5) < 0.035) cc = hx('#14181f'); }
      else if (sp.pat === 'smelt') { if (Math.abs(s) < 0.09) cc = mix(cc, [0.95, 0.97, 0.98], 0.8); }
      pos.push(x, y, z); col.push(...cc);
    }
  }
  for (let i = 0; i <= NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const bg = new THREE.BufferGeometry(); bg.setIndex(idx); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); bg.computeVertexNormals();
  g.add(new THREE.Mesh(bg, smoothM(0xffffff, { vertexColors: true, roughness: sp.pat === 'mottle' ? 0.55 : 0.32, metalness: sp.pat === 'mottle' ? 0.05 : 0.3, side: THREE.DoubleSide })));
  const finM = smoothM(sp.fin, { roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.88 }), addS = s => { const me = new THREE.Mesh(new THREE.ShapeGeometry(s, 8), finM); g.add(me); return me; };
  const x0 = XU(1), y0 = yc(1), pd = sp.ped, tth = Math.max(0.08, sp.H * 0.8), ts = new THREE.Shape(); ts.moveTo(x0 + 0.01, y0 + pd);
  if (sp.tail === 'fork') { ts.quadraticCurveTo(x0 - 0.07, y0 + tth * 0.6, x0 - 0.14, y0 + tth); ts.quadraticCurveTo(x0 - 0.1, y0 + tth * 0.3, x0 - 0.085, y0); ts.quadraticCurveTo(x0 - 0.1, y0 - tth * 0.3, x0 - 0.14, y0 - tth); ts.quadraticCurveTo(x0 - 0.07, y0 - tth * 0.6, x0 + 0.01, y0 - pd); }
  else { ts.quadraticCurveTo(x0 - 0.05, y0 + tth * 0.9, x0 - 0.11, y0 + tth * 0.6); ts.quadraticCurveTo(x0 - 0.15, y0, x0 - 0.11, y0 - tth * 0.6); ts.quadraticCurveTo(x0 - 0.05, y0 - tth * 0.9, x0 + 0.01, y0 - pd); }
  ts.closePath(); addS(ts);
  const finAlong = (a, b, h, spiny, down) => {
    const s = new THREE.Shape(), N = spiny ? 14 : 10, edge = u => down ? bot(u) + 0.012 : top(u) - 0.012; s.moveTo(XU(a), edge(a));
    for (let k = 0; k <= N; k++) { const t = k / N, u = lerp(a, b, t), hh = spiny ? h * (1 - 0.35 * t) * (k % 2 ? 0.55 : 1) : h * Math.sin(Math.PI * Math.min(1, t * 1.4) / 2) * (1 - 0.45 * t); s.lineTo(XU(u) - 0.01 * t, down ? bot(u) - hh : top(u) + hh); }
    s.lineTo(XU(b), edge(b)); for (let k = 8; k >= 0; k--) { const u = lerp(a, b, k / 8); s.lineTo(XU(u), edge(u)); } addS(s);
  };
  sp.dors.forEach(([a, b, h, sp2]) => finAlong(a, b, h, sp2, false)); finAlong(sp.anal[0], sp.anal[1], sp.anal[2], false, true); if (sp.adi) finAlong(sp.adi, sp.adi + 0.05, 0.025, false, false);
  [[0.24, -0.3, 1, 0.11], [0.48, -0.85, 0.6, 0.08]].forEach(([u, yy, sc, L]) => [-1, 1].forEach(sd => {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(-L * 0.5, 0.025 * sc, -L, 0.012 * sc); s.quadraticCurveTo(-L * 0.8, -0.02 * sc, -L * 0.2, -0.03 * sc); s.closePath();
    const m = addS(s); m.position.set(XU(u), yc(u) + hr(u) * yy, sd * wr(u) * 0.9); m.rotation.y = sd * 0.55; m.rotation.x = sd * 0.3;
  }));
  const eu = sp.flat ? 0.07 : 0.1, er = 0.024 * sp.eye, eyeM = smoothM(0xe8e2cc, { roughness: 0.15 }), pupM = smoothM(0x080808, { roughness: 0.05, metalness: 0.3 });
  [-1, 1].forEach(sd => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(er, 14, 10), eyeM), p = new THREE.Mesh(new THREE.SphereGeometry(er * 0.62, 12, 8), pupM);
    const ex = XU(eu), ey = yc(eu) + hr(eu) * (sp.flat ? 0.55 : 0.3), ez = sd * wr(eu) * (sp.flat ? 0.75 : 0.82); e.position.set(ex, ey, ez); p.position.set(ex + 0.002, ey, ez + sd * er * 0.55); g.add(e, p);
  });
  const darkF = smoothM(0x2a2620, { roughness: 0.6 }), tube = (pts, r) => g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new V(...p))), 16, r, 5, false), darkF));
  if (sp.mouth) [-1, 1].forEach(sd => tube([[0.5, yc(0) - 0.006, sd * 0.003], [0.45, yc(0.05) - hr(0.05) * 0.25, sd * wr(0.05) * 0.95], [0.4, yc(0.1) - hr(0.1) * 0.2, sd * wr(0.1) * 0.97]], 0.004));
  if (sp.barbel === 'long') [-1, 1].forEach(sd => { tube([[0.49, yc(0) + 0.005, sd * 0.02], [0.45, yc(0) - 0.01, sd * 0.12], [0.36, -0.03, sd * 0.22], [0.24, -0.07, sd * 0.26]], 0.0055); tube([[0.48, yc(0) - 0.02, sd * 0.02], [0.45, -0.06, sd * 0.05], [0.42, -0.09, sd * 0.07]], 0.004); });
  if (sp.barbel === 'short') [-1, 1].forEach(sd => tube([[0.48, yc(0) - 0.012, sd * 0.015], [0.46, -0.035, sd * 0.045], [0.44, -0.05, sd * 0.06]], 0.004));
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return g;
}
function disposeModel(m) { if (!m) return; if (m.parent) m.parent.remove(m); m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }

/* ── 낚싯대: 카메라에 붙어 씬이 바뀌어도 살아남는다. 축은 로컬 +y, 네 마디라 끝으로 갈수록 더 휜다.
   ctx.rod 에 등록해 두면 main.js 가 물 반사를 그릴 때 숨긴다 ── */
let rodRoot = null, rod = null, tipObj = null;
const segs = [];
function ensureRod() {
  if (rodRoot) return;
  rodRoot = new THREE.Group(); rodRoot.visible = false; ctx.camera.add(rodRoot); ctx.rod = rodRoot;
  rod = new THREE.Group(); rodRoot.add(rod);
  const chrome = smoothM(0x9aa0a6, { metalness: 0.85, roughness: 0.28 }), blankM = smoothM(0x2a3a4a, { roughness: 0.3, metalness: 0.4 });
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.3, 12), smoothM(0xb48c5c, { roughness: 0.8 })); cork.position.y = 0.15; rod.add(cork);
  const butt = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), smoothM(0x2a2a2a, { roughness: 0.5 })); rod.add(butt);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.045, 6), chrome); stem.rotation.x = Math.PI / 2; stem.position.set(0, 0.32, -0.0225); rod.add(stem);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 20), chrome); reel.rotation.z = Math.PI / 2; reel.position.set(0, 0.32, -0.07); rod.add(reel);
  const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.034, 16), smoothM(0xd8d8d0, { roughness: 0.6 })); spool.rotation.z = Math.PI / 2; spool.position.set(0, 0.33, -0.07); rod.add(spool);
  const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 5), chrome); crank.rotation.z = 0.9; crank.position.set(0.03, 0.31, -0.07); rod.add(crank);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), smoothM(0x1e1e1e)); knob.position.set(0.042, 0.29, -0.07); rod.add(knob);
  let parent = rod, y0 = 0.3;
  [0.42, 0.42, 0.38, 0.36].forEach((L, i) => {
    const s = new THREE.Group(); s.position.y = y0; parent.add(s);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.009 - 0.0016 * (i + 1), 0.009 - 0.0016 * i, L, 8), blankM); m.position.y = L / 2; s.add(m);
    const gy = L * 0.85, gs = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.016, 4), chrome); gs.rotation.x = Math.PI / 2; gs.position.set(0, gy, -0.008); s.add(gs);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.007 - 0.0011 * i, 0.0012, 5, 12), chrome); ring.rotation.x = Math.PI / 2; ring.position.set(0, gy, -0.018); s.add(ring);
    segs.push(s); parent = s; y0 = L;
  });
  tipObj = new THREE.Object3D(); tipObj.position.y = 0.36; parent.add(tipObj);
  rodRoot.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
}
const ROD_BASE = -1.05;

/* ── 상태. count = 이번 캠핑에서 잡은 수 (종별 최고 기록은 state.js 의 records 에 저장) ── */
const F = {
  ok: false, on: false, st: 'idle', t: 0, raise: 0, wait: 0, nibs: [], nibHit: new Set(), G: null, cur: null, oks: 0, gr: 0, fails: 0,
  target: new V(), hook: new V(), p0: new V(), entry: new V(), bend: 0, bendV: 0, thr: 0, jt: 0, jump: -1, model: null, flying: false, count: 0,
};
let line = null, lineGeo = null, bob = null, rings = [];
const LN = 40, TIP = new V(), _a = new V(), _b = new V(), _fw = new V();

/* 씬마다: 줄·찌·물결을 만든다 (부두가 있는 맵만). 첫 입질에서 멈칫하지 않게 사전 컴파일용 물고기 하나를 숨겨 둔다 */
export function buildFish() {
  const W = ctx.W; F.ok = false; F.on = false; F.st = 'idle'; F.model = null; F.count = 0; rings = [];
  ensureRod();
  if (!W.cfg.dock) return;
  lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(LN * 3), 3));
  line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf2f4f6, transparent: true, opacity: 0.75 }));
  line.frustumCulled = false; line.visible = false; line.userData.noAO = true; line.userData.noRefl = true; ctx.scene.add(line);
  bob = new THREE.Group();
  const r = 0.028;
  bob.add(new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), smoothM(0xd8402e, { roughness: 0.35 })));
  bob.add(new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), smoothM(0xf2f2f0, { roughness: 0.35 })));
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 6), smoothM(0x222222)); st.position.y = 0.045; bob.add(st);
  bob.visible = false; bob.userData.noRefl = true; ctx.scene.add(bob);
  const RG = new THREE.RingGeometry(0.9, 1, 48); RG.rotateX(-Math.PI / 2);
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(RG, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.userData.noAO = true; m.userData.noRefl = true; ctx.scene.add(m); rings.push({ m, t: 9, life: 1, size: 1 });
  }
  const dummy = fishModel(FISH_SPECIES[0]); dummy.visible = false; ctx.scene.add(dummy);
  F.ok = true;
}
function ring(x, z, size, life) { const r = rings.find(o => o.t >= o.life) || rings[0]; if (!r) return; r.t = 0; r.life = life || 1.2; r.size = size || 0.5; r.m.position.set(x, WY + 0.03, z); r.m.visible = true; }
function updRings(dt, T) {
  rings.forEach(r => { if (r.t >= r.life) { r.m.visible = false; return; } r.t += dt; const u = r.t / r.life; r.m.scale.setScalar(0.04 + r.size * eout(u)); r.m.material.opacity = 0.6 * (1 - u); });
  const dr = ctx.W.dockRings; if (dr) dr.forEach((r, i) => { r.scale.setScalar(1 + 0.25 * Math.sin(T * 1.6 + i)); r.material.opacity = 0.16 + 0.1 * Math.sin(T * 1.6 + i); });
}
/* 줄: 처지는 곡선. 수면 아래로 내려가는 첫 지점에서 끊고, 그 지점을 F.entry 에 기록한다 */
function setLine(a, b, sag) {
  const p = lineGeo.attributes.position; let py = 0, px = 0, pz = 0, cut = -1; const lim = WY + 0.01;
  for (let i = 0; i < LN; i++) {
    const s = i / (LN - 1), x = lerp(a.x, b.x, s), y = lerp(a.y, b.y, s) - sag * 4 * s * (1 - s), z = lerp(a.z, b.z, s);
    if (i > 0 && py >= lim && y < lim) { const k = (py - lim) / (py - y); const ex = lerp(px, x, k), ez = lerp(pz, z, k); p.setXYZ(i, ex, lim, ez); F.entry.set(ex, WY, ez); cut = i; break; }
    p.setXYZ(i, x, y, z); px = x; py = y; pz = z;
  }
  if (cut < 0) F.entry.set(b.x, WY, b.z);
  lineGeo.setDrawRange(0, cut < 0 ? LN : cut + 1); p.needsUpdate = true;
}
function setSt(s) { F.st = s; F.t = 0; if (fishHooks.hud) fishHooks.hud(); }
function newFish() { const sp = FISH_SPECIES[Math.floor(Math.random() * FISH_SPECIES.length)], size = Math.round(rnd(sp.s[0], sp.s[1])), t = cl((size - 8) / 85, 0, 1); return { sp, size, t, needOk: 3 + Math.round(2 * t), needGr: t > 0.55 ? 2 : 1 }; }
function startWait() {
  setSt('wait'); F.wait = rnd(FISHING.wait[0], FISHING.wait[1]); F.nibs = []; F.nibHit.clear();
  const n = FISHING.nibbles[0] + Math.floor(Math.random() * (FISHING.nibbles[1] - FISHING.nibbles[0] + 1));
  for (let i = 0; i < n; i++) F.nibs.push(rnd(0.8, F.wait - 0.4));
}
/* 던질 곳: 바라보는 방향, 거리는 시선 높이로 */
function aimPoint(out) {
  const cam = ctx.camera; cam.getWorldDirection(_fw);
  const pitch = Math.asin(cl(_fw.y, -1, 1)), d = lerp(FISHING.cast[0], FISHING.cast[1], sst(FISHING.pitch[0] + 0.05, 0.05, pitch)), hl = Math.hypot(_fw.x, _fw.z) || 1;
  out.set(cam.position.x + _fw.x / hl * d, WY, cam.position.z + _fw.z / hl * d);
}

export const fishActive = () => F.on;
export const fishCount = () => F.count;
export function beginFish() { if (!F.ok) return false; ensureRod(); F.on = true; setSt('idle'); sfx('rodUp'); return true; }
export function stopFish() { if (!F.on) return; disposeModel(F.model); F.model = null; F.on = false; F.st = 'idle'; gaugeHide(); hideCard(); if (fishHooks.hud) fishHooks.hud(); }
export function resetFish() { disposeModel(F.model); F.model = null; F.on = false; F.st = 'idle'; F.raise = 0; F.count = 0; if (rodRoot) rodRoot.visible = false; gaugeHide(); hideCard(); }

/* 잡은 물고기 카드: 처음 잡은 종 / 기록 경신 / 기록 이하를 구분해 보여 준다 */
function catchCard(c) {
  const prev = records.fish[c.sp.n], rec = !prev || c.size > prev;
  if (rec) { records.fish[c.sp.n] = c.size; saveSettings(); }
  const note = !prev ? '처음 잡았다' : rec ? `새 기록 · 이전 ${prev}cm` : `최고 ${prev}cm`;
  showCard(`<div style="font-size:19px;font-weight:500">${c.sp.n} ${c.size}cm</div><div style="font-size:12px;color:${rec ? '#c98a10' : '#6a7578'};margin-top:2px">${note}</div>`);
}

export function fishPress() {
  if (!F.on) return;
  switch (F.st) {
    case 'idle': if (F.raise < 0.95) return; aimPoint(F.target); F.flying = false; setSt('cast'); break;
    case 'wait': banner('너무 일렀다', 1.2, '#ffffff'); F.p0.copy(bob.position); setSt('reelback'); sfx('reel'); break;
    case 'bite': {
      const c = F.cur; F.G = makeGauge(0.9 + 1.1 * c.t, 0.36 - 0.1 * c.t, 0.085 - 0.03 * c.t);
      F.oks = F.gr = F.fails = 0; F.thr = 0.4; F.jt = rnd(1.5, 3); F.jump = -1;
      F.hook.copy(F.target).setY(WY - 0.25);
      disposeModel(F.model); F.model = fishModel(c.sp); F.model.scale.setScalar(c.size / 100); F.model.visible = false; ctx.scene.add(F.model);
      banner(c.t < 0.35 ? '작은 입질' : c.t < 0.65 ? '묵직하다' : '엄청 무겁다', 1.2, '#ffffff');
      F.bendV += 0.25; sfx('reel'); setSt('reel'); break;
    }
    case 'reel': {
      const r = gaugeJudge(F.G); if (!r) return;
      if (r === 'great') { F.gr++; F.oks++; F.bendV -= 0.5; sfx('reel'); }
      else if (r === 'ok') { F.oks++; F.bendV -= 0.3; sfx('reel'); }
      else { F.fails++; F.bendV += 0.4; ring(F.entry.x, F.entry.z, 0.7, 1); sfx('splash', 0.7); }
      const c = F.cur;
      if (F.gr >= c.needGr || F.oks >= c.needOk) {
        F.p0.copy(F.entry); F.model.visible = true; F.jump = -1; F.count++;
        ring(F.entry.x, F.entry.z, 0.9, 1.2); sfx('fishOut'); gaugeHide(); setSt('caught');
        catchCard(c);
      } else if (F.fails >= FISHING.fails) {
        banner('줄이 풀려 도망갔다', 1.8, '#ffffff'); sfx('snap'); disposeModel(F.model); F.model = null; gaugeHide(); setSt('snap');
      }
      break;
    }
    case 'caught': if (F.t > 0.7) { F.p0.copy(F.model.position); hideCard(); setSt('release'); } break;
  }
}
/* HUD 안내 [아이템 상자 둘째 줄, 모바일 버튼]. 끌어올리는 동안에는 게이지만 보면 되므로 안내를 비운다 */
export function fishHint(btn) {
  return ({
    idle: [`${btn} 던지기`, '던지기'], cast: ['던지는 중', '…'],
    wait: ['찌를 지켜보는 중', '기다리기'], bite: [`${btn} 물었다`, '챔질'],
    missed: ['놓쳤다. 다시 기다려보자', '기다리기'], reel: ['', '당기기'],
    caught: [`${btn} 놓아주기`, '놓아주기'], release: ['물속으로 돌아갔다', '…'], snap: ['줄이 풀렸다', '…'], reelback: ['찌를 감아 들이는 중', '…'],
  })[F.st] || ['', '…'];
}

let T = 0;
export function updateFish(dt) {
  T += dt;
  if (rodRoot) {
    F.raise = cl(F.raise + (F.on ? dt / 0.6 : -dt / 0.3), 0, 1);
    rodRoot.visible = F.raise > 0.01;
    rodRoot.position.set(0.28, lerp(-0.75, -0.34, eio(F.raise)), -0.45); rodRoot.rotation.x = lerp(-0.9, 0, eio(F.raise));
  }
  if (!F.ok) return;
  updRings(dt, T);
  if (!F.on) { line.visible = false; bob.visible = false; if (rodRoot) { segs.forEach(s => { s.rotation.x = 0; }); rod.rotation.x = ROD_BASE; } return; }
  F.t += dt;
  const cam = ctx.camera; rodRoot.updateMatrixWorld(true); tipObj.getWorldPosition(TIP);
  let bend = 0, lift = 0, sag = 0.02, showBob = true, end = null;
  switch (F.st) {
    case 'idle': bob.position.set(TIP.x + Math.sin(T * 1.3) * 0.01, TIP.y - 0.4, TIP.z); break;
    case 'cast': {
      const t = F.t; lift = t < 0.25 ? 0.9 * eio(t / 0.25) : t < 0.4 ? lerp(0.9, -0.35, eio((t - 0.25) / 0.15)) : lerp(-0.35, 0, Math.min(1, (t - 0.4) / 0.4));
      if (t < 0.3) bob.position.set(TIP.x, TIP.y - 0.4, TIP.z);
      else {
        if (!F.flying) { F.flying = true; F.p0.copy(TIP); sfx('cast'); }
        const u = Math.min(1, (t - 0.3) / 0.85); bob.position.lerpVectors(F.p0, F.target, u); bob.position.y += 2.6 * Math.sin(Math.PI * u); sag = 0.25;
        if (u >= 1) { F.flying = false; ring(F.target.x, F.target.z, 0.5, 1.2); sfx('plop'); startWait(); }
      }
      break;
    }
    case 'wait': {
      sag = 0.4; let dy = Math.sin(T * 2) * 0.006;
      for (const n of F.nibs) { const k = F.t - n; if (k > 0 && k < 0.16) { dy -= 0.022 * Math.sin(Math.PI * k / 0.16); bend = 0.03; if (!F.nibHit.has(n)) { F.nibHit.add(n); ring(F.target.x, F.target.z, 0.22, 0.7); sfx('nibble'); } } }
      bob.position.set(F.target.x, WY + 0.02 + dy, F.target.z);
      if (F.t > F.wait) { F.cur = newFish(); ring(F.target.x, F.target.z, 0.6, 1); sfx('bite'); F.bendV += 0.35; banner('!', FISHING.biteWin, '#f3d27a'); setSt('bite'); }
      break;
    }
    case 'bite':
      bob.position.set(F.target.x, lerp(WY + 0.02, WY - 0.18, Math.min(1, F.t / 0.15)), F.target.z); sag = 0.06; bend = 0.32 + 0.06 * Math.sin(T * 24);
      if (F.t > FISHING.biteWin) { banner('물고기가 도망갔다', 1.6, '#ffffff'); setSt('missed'); }
      break;
    case 'missed':
      bob.position.set(F.target.x, lerp(WY - 0.18, WY + 0.02, Math.min(1, F.t / 0.4)), F.target.z); sag = 0.4;
      if (F.t > 0.9) startWait();
      break;
    case 'reel': {
      showBob = false; gaugeUpdate(F.G, dt); gaugeShow(F.G);
      const c = F.cur, pr = Math.max(F.oks / c.needOk, F.gr / c.needGr);
      F.hook.set(lerp(F.target.x, DOCK.x, 0.6 * pr) + Math.sin(T * (1.2 + c.t)) * (0.6 + 0.9 * c.t) * (1 - 0.4 * pr), WY - 0.25, lerp(F.target.z, DOCK.z1 - 1.2, 0.75 * pr));
      sag = 0.01; bend = 0.25 + 0.35 * c.t + 0.08 * Math.sin(T * (7 + 4 * c.t));
      F.thr -= dt; if (F.thr < 0 && F.jump < 0) { F.thr = rnd(0.5, 1.1) / (0.6 + c.t); ring(F.entry.x, F.entry.z, 0.3 + 0.4 * c.t, 0.9); }
      if (c.t > 0.45) {
        F.jt -= dt;
        if (F.jt < 0 && F.jump < 0) { F.jump = 0; F.model.visible = true; ring(F.hook.x, F.hook.z, 0.8, 1); sfx('splash', 0.8); }
        if (F.jump >= 0) {
          F.jump += dt / 0.6; const u = Math.min(1, F.jump);
          F.model.position.set(F.hook.x, WY + Math.sin(Math.PI * u) * (0.5 + 0.5 * c.t), F.hook.z);
          F.model.rotation.set(0, Math.atan2(F.hook.x - cam.position.x, F.hook.z - cam.position.z) + Math.PI / 2, (0.5 - u) * 1.6);
          if (u >= 1) { F.jump = -1; F.model.visible = false; F.jt = rnd(2.5, 4.5); ring(F.hook.x, F.hook.z, 0.9, 1.1); sfx('splash', 0.8); }
        }
      }
      end = F.jump >= 0 ? F.model.position : F.hook;
      break;
    }
    case 'caught': {
      showBob = false; const u = Math.min(1, F.t / 0.7), e = eio(u), d = 0.5 + F.cur.size / 100 * 0.6;
      _a.set(0, -0.1, -d); cam.localToWorld(_a); F.model.position.lerpVectors(F.p0, _a, e); F.model.position.y += 0.5 * Math.sin(Math.PI * u);
      F.model.quaternion.copy(cam.quaternion); F.model.rotateY(Math.sin(T * 7) * 0.22 * (1 - 0.5 * u)); F.model.rotateZ(-0.12 + Math.sin(T * 9) * 0.05);
      bend = 0.2; _b.set(0.5, 0, 0); end = F.model.localToWorld(_b); break;
    }
    case 'release': {
      showBob = false; const u = Math.min(1, F.t / 0.8); _b.set(DOCK.x + 0.8, WY - 0.2, DOCK.z1 - 1.4);
      F.model.position.lerpVectors(F.p0, _b, u * u); F.model.position.y += 0.35 * Math.sin(Math.PI * u); F.model.rotateZ(dt * 2);
      if (u >= 1 && F.model.visible) { ring(_b.x, _b.z, 0.8, 1.3); sfx('splash', 1); F.model.visible = false; }
      if (F.t > 1.3) { disposeModel(F.model); F.model = null; setSt('idle'); }
      end = TIP; sag = 0; break;
    }
    case 'snap': showBob = false; sag = 0.5; end = _b.set(lerp(F.hook.x, DOCK.x, 0.5), WY, lerp(F.hook.z, DOCK.z1, 0.5)); if (F.t > 0.6) setSt('idle'); break;
    case 'reelback': {
      const u = Math.min(1, F.t / 0.6); _a.set(TIP.x, TIP.y - 0.4, TIP.z); bob.position.lerpVectors(F.p0, _a, eio(u)); bob.position.y += 0.4 * Math.sin(Math.PI * u); sag = 0.1;
      if (u >= 1) setSt('idle'); break;
    }
  }
  F.bend += F.bendV * dt * 10; F.bendV *= Math.exp(-dt * 7); F.bend *= Math.exp(-dt * 5);
  const tb = cl(bend + F.bend, -0.3, 1.1); segs.forEach((s, i) => { s.rotation.x = -tb * (0.08 + 0.12 * i); }); rod.rotation.x = ROD_BASE + lift;
  rodRoot.updateMatrixWorld(true); tipObj.getWorldPosition(TIP);
  bob.visible = showBob; setLine(TIP, end || bob.position, sag);
  line.visible = F.raise > 0.5 && !(F.st === 'release' && F.t > 0.4);
}