import * as THREE from 'three';
import { ctx } from './state.js';
import { BEACH, SEAT } from './data.js';
import { smoothM, canvasTex, shadowed, clamp } from './util.js';
import { terrainH } from './terrain.js';
import { tex } from './textures.js';
import { makeLantern } from './props.js';
import { sfx } from './audio.js';
import { toast } from './gauge.js';

/* ── 해변: 물가의 돗자리와 파라솔 (해변 전용) ──
   돗자리를 보고 E → 눕기 (손에 든 것은 낚시처럼 맡겨 두고, 일어나면 돌려준다 — game.js 의 lieDown).
   파라솔을 보고 E → 접기·펴기. 누워 있는 동안에는 보이는 상호작용이 없으므로 E 는 일어나기뿐이다.
   자리는 호수의 부두처럼 캠프 오른쪽 앞(data.js BEACH). 해안선(z −9)에서 2.5m 떨어져 젖은 띠에 닿지 않고,
   vegetation.js 의 reserved 구역 안이라 야자수·덤불·바위·조개가 들어오지 않는다.
   유목(scene.js)만은 W.space 로 자리를 피하므로, 유목보다 먼저 여기서 등록한다.
   파라솔: 살 8개가 꼭대기(HUB)에 매달려 있고, 접힘 정도 k(0 = 접힘, 1 = 펼침)에 따라 살 각도가 B0 ~ B1 로 바뀐다.
   기둥의 슬라이더(runner)는 지지대 길이(LS)를 고정한 채 살의 40% 지점과 이어지도록 높이를 역산한다.
   천은 살 사이마다 격자 한 장: 펼치면 팽팽한 판(가운데가 살짝 처짐), 접으면 살 사이가 바깥으로 불룩 모이며 살짝 비틀린다.
   천 끝은 살 사이가 물결 모양으로 파였고, 펼친 동안 바람(W.wind)을 따라 아주 조금 흔들린다 ── */

const N = 8, NS = 16, NU = 8, VPG = (NS + 1) * (NU + 1), D = Math.PI * 2 / N;
const L = 1.15, HUB = 2.05, B0 = 0.06, B1 = 1.3, LS = 0.55, T_ANIM = 1.2;
const V3 = THREE.Vector3, UP = new V3(0, 1, 0), _d = new V3(), _a = new V3(), _b = new V3();
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
/* 펼칠 때는 끝에서 살짝 튀어 올랐다 자리를 잡는다 */
const backOut = x => 1 + 1.6 * Math.pow(x - 1, 3) + 0.6 * Math.pow(x - 1, 2);

/* ── 그림 (씬마다 재사용 — memoTex 처럼 정리된 뒤 다시 쓰면 다시 올라간다) ── */
/* 돗자리: 크림 바탕에 길이 방향 코랄·청록 줄, 밀짚 짜임 결 */
const matTex = canvasTex(256, 512, (g, w, h) => {
  g.fillStyle = '#efe2c2'; g.fillRect(0, 0, w, h);
  [[34, 20, '#d46e56'], [62, 6, '#3f8f8a'], [w - 54, 20, '#d46e56'], [w - 68, 6, '#3f8f8a'], [w / 2 - 5, 10, '#3f8f8a']].forEach(([x, b, c]) => { g.fillStyle = c; g.fillRect(x, 0, b, h); });
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) if (((x >> 2) + (y >> 2)) % 2) { g.fillStyle = 'rgba(60,40,20,.11)'; g.fillRect(x, y, 4, 4); }
  for (let y = 0; y < h; y += 4) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, y, w, 1); }
});
matTex.colorSpace = THREE.SRGBColorSpace; matTex.anisotropy = 4;
/* 돌돌 만 수건: 옆면은 고리 줄무늬, 끝면은 나선 */
const towelTex = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = '#3f8f8a'; g.fillRect(0, 0, w, h); g.fillStyle = '#f3ead6';
  [[28, 14], [h - 42, 14], [h / 2 - 3, 6]].forEach(([y, b]) => g.fillRect(0, y, w, b));
  for (let y = 0; y < h; y += 3) { g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, y, w, 1); }
});
towelTex.colorSpace = THREE.SRGBColorSpace;
const capTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#3f8f8a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a6764'; g.lineWidth = 3; g.beginPath();
  for (let a = 0; a < 37.7; a += 0.08) { const r = 2 + a * 1.55, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r; if (a) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
});
capTex.colorSpace = THREE.SRGBColorSpace;

/* 모듈 상태: buildBeach 가 씬마다 새로 채운다. k = 지금 접힘 정도, from·to·p = 접고 펴는 동작(p 0..1) */
const B = { on: false, k: 1, from: 1, to: 1, p: 1, t: 0, lastBeta: -1, geo: null, pos: null, ribG: null, ribs: [], tips: [], stretch: [], runner: null, ribM: null, lamp: null, light: null };

/* 살 위의 점: 꼭대기에서의 비율 s → [기둥에서의 거리, 높이]. 펼치면 끝이 처지고, 접으면 가운데가 살짝 바깥으로 휜다 */
function rib(s, beta, o) {
  const r = s * L; let rho = Math.sin(beta) * r, y = HUB - Math.cos(beta) * r;
  y -= 0.11 * s * s * o; rho -= 0.03 * s * s * o; rho += 0.03 * Math.sin(Math.PI * s) * (1 - o);
  return [rho, y];
}
/* 천: 살 사이마다 (NS+1)×(NU+1) 격자. 코랄·크림이 번갈아, 끝단 띠는 조금 어둡게. 위치는 updCanopy 가 채운다 */
function canopyGeo() {
  const pos = new Float32Array(N * VPG * 3), col = [], uv = [], idx = [], c = new THREE.Color();
  for (let g = 0; g < N; g++) {
    const base = new THREE.Color(g % 2 ? 0xf3ead6 : 0xde6c55);
    for (let si = 0; si <= NS; si++) for (let ui = 0; ui <= NU; ui++) { const s = si / NS; c.copy(base).multiplyScalar(s > 0.93 ? 0.78 : 1); col.push(c.r, c.g, c.b); uv.push((g + ui / NU) * 1.5, s * 6); }
    const o = g * VPG;
    for (let si = 0; si < NS; si++) for (let ui = 0; ui < NU; ui++) { const a = o + si * (NU + 1) + ui, b = a + NU + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  const geo = new THREE.BufferGeometry(); geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  B.pos = pos; return geo;
}
function updCanopy(beta, o, t, wind) {
  const p = B.pos, fl = (0.004 + 0.006 * wind) * o; let k = 0;
  for (let g = 0; g < N; g++) for (let si = 0; si <= NS; si++) for (let ui = 0; ui <= NU; ui++) {
    const s = si / NS, u = ui / NU, su = Math.sin(Math.PI * u), se = s - 0.055 * su * Math.pow(s, 6), [rho, y] = rib(se, beta, o);
    const th = g * D + u * D + (1 - o) * 0.16 * s * su, ch = Math.cos(D / 2) / Math.cos((u - 0.5) * D);
    const rc = rho * (ch * o + 1 - o) + 0.075 * su * Math.sin(Math.PI * Math.min(1, se * 1.05)) * (1 - o);
    const yy = y - 0.035 * su * Math.sin(Math.PI * se) * o + fl * Math.sin(t * 2.6 + g * 1.7 + se * 5) * se;
    p[k++] = rc * Math.cos(th); p[k++] = yy; p[k++] = rc * Math.sin(th);
  }
  B.geo.attributes.position.needsUpdate = true; B.geo.computeVertexNormals();
}
/* 원기둥(높이 1)을 a → b 로 세운다 */
function span(m, a, b) { _d.subVectors(b, a); const l = _d.length(); m.position.copy(a).addScaledVector(_d, 0.5); m.quaternion.setFromUnitVectors(UP, _d.normalize()); m.scale.set(1, l, 1); }
/* 살·살끝·지지대·슬라이더. 살은 각도가 바뀔 때만 다시 만든다 (천보다 1.4cm 아래) */
function updRibs(beta, o) {
  B.ribs.forEach(m => { B.ribG.remove(m); m.geometry.dispose(); }); B.ribs = [];
  const [rq, yq] = rib(0.4, beta, o), yr = yq - 0.014 - Math.sqrt(Math.max(1e-4, LS * LS - rq * rq));
  B.runner.position.y = yr;
  for (let i = 0; i < N; i++) {
    const th = i * D, c = Math.cos(th), s = Math.sin(th), pts = [];
    for (let j = 0; j <= 8; j++) { const [rho, y] = rib(j / 8, beta, o); pts.push(new V3(rho * c, y - 0.014, rho * s)); }
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.0055, 5, false), B.ribM); m.castShadow = true;
    B.ribG.add(m); B.ribs.push(m);
    B.tips[i].position.copy(pts[8]);
    span(B.stretch[i], _a.set(0.03 * c, yr, 0.03 * s), _b.set(rq * c, yq - 0.014, rq * s));
  }
}
/* 지금 k 로 모양을 맞춘다. 다 접혀 멈춰 있으면 아무것도 하지 않는다 */
function shape(wind) {
  const beta = B0 + (B1 - B0) * B.k, o = clamp(B.k, 0, 1);
  if (o > 0 || beta !== B.lastBeta) updCanopy(beta, o, B.t, wind);
  if (beta !== B.lastBeta) { updRibs(beta, o); B.lastBeta = beta; }
}
/* 시작 상태: 밤이면 접혀 있고, 그 밖에는 펼쳐 있다 */
const startOpen = () => ctx.W.tm.stars > 0.5 ? 0 : 1;

/* ── 씬마다. 해변이 아니면 상태만 비운다. 상호작용 자리 { mat, parasol } 를 돌려준다 (scene.js 가 W.interact 에 넣는다) ── */
export function buildBeach(cfg) {
  B.on = false; B.ribs = []; B.tips = []; B.stretch = []; B.lamp = B.light = null; B.lastBeta = -1;
  if (cfg.key !== 'beach') return null;
  const W = ctx.W, scene = ctx.scene, m = BEACH.mat, pa = BEACH.parasol, h = (x, z) => terrainH(x, z, cfg);
  const M = {
    mat: smoothM(0xffffff, Object.assign({ map: matTex, roughness: 0.95 }, tex('fabric', 4, 6, 0.3, false))),
    bind: smoothM(0xb4533c, { roughness: 0.85 }),
    towel: smoothM(0xffffff, Object.assign({ map: towelTex, roughness: 1 }, tex('fabric', 2, 4, 0.4, false))),
    cap: smoothM(0xffffff, { map: capTex, roughness: 1 }),
    pole: smoothM(0xece8df, { metalness: 0.3, roughness: 0.4 }),
    dark: smoothM(0x2b2c30, { metalness: 0.6, roughness: 0.4 }),
    rib: smoothM(0x8f8b84, { metalness: 0.6, roughness: 0.4 }),
    cloth: smoothM(0xffffff, Object.assign({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }, tex('fabric', 1, 1, 0.25, false))),
    sand: smoothM(0xdcc697, Object.assign({ roughness: 1 }, tex('sand', 1, 1, 0.3, false))),
  };

  /* 돗자리: 정점을 지형에 붙여 바다 쪽으로 낮아지는 경사를 그대로 따른다 (주름은 4mm 안팎) */
  const mg = new THREE.PlaneGeometry(m.w, m.l, 26, 38); mg.rotateX(-Math.PI / 2);
  const mp = mg.attributes.position;
  for (let i = 0; i < mp.count; i++) { const x = mp.getX(i), z = mp.getZ(i); mp.setY(i, h(m.x + x, m.z + z) + 0.012 + 0.003 * Math.sin(x * 11 + z * 3) * Math.sin(z * 7)); }
  mg.computeVertexNormals();
  const mat = new THREE.Mesh(mg, M.mat); mat.position.set(m.x, 0, m.z); mat.receiveShadow = true; scene.add(mat);
  /* 테두리 띠: 모서리가 둥근 직사각형을 따라 지형 위로 감는다 (상자로 두르면 경사에서 떠 보인다) */
  {
    const hw = m.w / 2, hl = m.l / 2, cr = 0.04, sh = new THREE.Shape();
    sh.moveTo(-hw + cr, -hl); sh.lineTo(hw - cr, -hl); sh.quadraticCurveTo(hw, -hl, hw, -hl + cr); sh.lineTo(hw, hl - cr); sh.quadraticCurveTo(hw, hl, hw - cr, hl);
    sh.lineTo(-hw + cr, hl); sh.quadraticCurveTo(-hw, hl, -hw, hl - cr); sh.lineTo(-hw, -hl + cr); sh.quadraticCurveTo(-hw, -hl, -hw + cr, -hl);
    const pts = sh.getSpacedPoints(96); pts.pop();
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new V3(m.x + p.x, h(m.x + p.x, m.z + p.y) + 0.014, m.z + p.y)), true);
    const rim = new THREE.Mesh(new THREE.TubeGeometry(curve, 192, 0.009, 5, true), M.bind); rim.receiveShadow = true; scene.add(rim);
  }
  /* 머리맡의 돌돌 만 수건 */
  const tz = m.z + m.l / 2 - 0.2;
  const towel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.6, 28), [M.towel, M.cap, M.cap]);
  towel.rotation.z = Math.PI / 2; towel.position.set(m.x, h(m.x, tz) + 0.097, tz); towel.castShadow = towel.receiveShadow = true; scene.add(towel);

  /* 파라솔: 모래 둔덕에 꽂고 바다 쪽·돗자리 쪽으로 살짝 기울인다 */
  const y0 = h(pa.x, pa.z);
  const mound = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.sand);
  mound.scale.y = 0.22; mound.position.set(pa.x, y0 - 0.005, pa.z); mound.receiveShadow = true; scene.add(mound);
  const umb = new THREE.Group(); umb.position.set(pa.x, y0, pa.z); umb.rotation.set(pa.tilt[0], pa.yaw, pa.tilt[1]); scene.add(umb);
  const part = (geo, mat, y) => { const o = new THREE.Mesh(geo, mat); o.position.y = y; umb.add(o); return o; };
  part(new THREE.CylinderGeometry(0.019, 0.022, 2.35, 14), M.pole, 0.925);
  part(new THREE.CylinderGeometry(0.027, 0.027, 0.05, 14), M.dark, 1.12);
  part(new THREE.CylinderGeometry(0.034, 0.03, 0.07, 14), M.dark, HUB);
  part(new THREE.SphereGeometry(0.032, 14, 10), M.pole, HUB + 0.09);
  B.runner = part(new THREE.CylinderGeometry(0.032, 0.032, 0.06, 14), M.dark, 1.5);
  B.geo = canopyGeo();
  const canopy = new THREE.Mesh(B.geo, M.cloth); canopy.frustumCulled = false; umb.add(canopy);
  B.ribM = M.rib; B.ribG = new THREE.Group(); umb.add(B.ribG);
  const tipG = new THREE.SphereGeometry(0.011, 8, 6), strG = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 5);
  for (let i = 0; i < N; i++) { const tp = new THREE.Mesh(tipG, M.dark); umb.add(tp); B.tips.push(tp); const st = new THREE.Mesh(strG, M.rib); umb.add(st); B.stretch.push(st); }
  shadowed(umb); canopy.receiveShadow = false;

  /* 머리맡 랜턴: 부두 랜턴처럼 시간대에 맞춰 저절로 켜진다 */
  const [lx, lz] = BEACH.lantern, lit = W.tm.lantern > 0.5;
  B.lamp = makeLantern(lit); B.lamp.scale.setScalar(0.8); B.lamp.position.set(lx, h(lx, lz), lz); scene.add(shadowed(B.lamp));
  B.light = new THREE.PointLight(0xffc07a, lit ? W.tm.lantern * 0.2 : 0, 4, 2); B.light.position.set(lx, h(lx, lz) + 0.15, lz); scene.add(B.light);

  /* 걷기 충돌(기둥·랜턴)과 자리 격자(유목이 피한다). 돗자리는 밟고 지나갈 수 있다 */
  W.trees.push([pa.x, pa.z, 0.06], [lx, lz, 0.1]);
  if (W.space) { W.space.add(m.x, m.z, 1.15, 1.15); W.space.add(pa.x, pa.z, 1.2, 1.2); }
  /* 누운 눈높이는 땅 높이에 맞춘다 */
  SEAT.mat.pos = [BEACH.head[0], h(BEACH.head[0], BEACH.head[1]) + BEACH.eye, BEACH.head[1]];

  B.k = B.from = B.to = startOpen(); B.p = 1; B.t = 0;
  B.on = true; shape(0.4);
  umb.updateMatrixWorld(true);
  const pp = umb.localToWorld(new V3(0, 1.3, 0));
  return { mat: [m.x, h(m.x, m.z) + 0.05, m.z], parasol: [pp.x, pp.y, pp.z] };
}

/* ── 매 프레임 (main.js). 멈춘 동안에는 dt = 0 ── */
export function updateBeach(dt) {
  if (!B.on) return;
  const W = ctx.W, lit = W.tm.lantern > 0.5;
  B.lamp.userData.setLit(lit);
  B.light.intensity += ((lit ? W.tm.lantern * 0.2 : 0) - B.light.intensity) * Math.min(1, dt * 4);
  if (dt <= 0) return;
  B.t += dt;
  if (B.p < 1) { B.p = Math.min(1, B.p + dt / T_ANIM); const e = B.to > B.from ? backOut(B.p) : ease(B.p); B.k = B.from + (B.to - B.from) * e; }
  shape(W.wind ? W.wind.value : 0.4);
}

/* ── game.js·scene.js·main.js 가 부르는 것 ── */
/* 접고 펴는 도중에 다시 누르면 지금 자리에서 반대로 움직인다 */
export function toggleParasol() {
  if (!B.on) return;
  const to = B.to > 0.5 ? 0 : 1; B.from = B.k; B.to = to; B.p = 0;
  sfx(to ? 'parasolOpen' : 'parasolClose'); toast(to ? '파라솔을 폈다' : '파라솔을 접었다');
}
export const parasolOpen = () => B.on && B.to > 0.5;
/* 접고 펴는 중 — main.js 가 그동안 그림자맵을 매 프레임 갱신한다 */
export const parasolMoving = () => B.on && B.p < 1;
/* 프리뷰 씬을 재사용해 다시 시작할 때 시간대에 맞는 처음 상태로 */
export function resetBeach() { if (!B.on) return; B.k = B.from = B.to = startOpen(); B.p = 1; shape(0.4); }
/* 돗자리 위인지. pad 만큼 바깥까지 넓혀 본다 (발소리는 0, 발자국은 발자국 크기만큼) */
export function onMat(x, z, pad = 0) { if (!B.on) return false; const m = BEACH.mat; return Math.abs(x - m.x) < m.w / 2 + pad && Math.abs(z - m.z) < m.l / 2 + pad; }