import * as THREE from 'three';
import { ROAD } from './data.js';
import { smooth, NOISE_GLSL } from './util.js';
import { terrainBase, setRoadGrid, roadAt } from './terrain.js';
import { tex } from './textures.js';

/* ══ 차 뒤쪽 길 ══
   차가 이 길을 따라 들어와 캠프 앞에 멈춘 모습. 차 밑(z 5)에서 시작해 뒤쪽(+z)으로 S자로 휘어 나가 안개 속으로 사라진다.
   prepareRoad(cfg): 씬을 만들 때 지형보다 먼저 부른다 (scene.js).
     경로를 1m 간격으로 나누고, 길 주변 1m 격자에 [길까지 거리, 길 높이, 길을 따라간 거리]를 구워 terrain.js 에 넘긴다.
     terrainH 는 높이맵 굽기·지면·식생 배치에서 수십만 번 불리므로, 매번 경로와 거리를 재지 않고 이 표만 읽는다.
     지형은 길 가장자리 +0.6m 안쪽이 길 높이로 평평하고, 그 바깥 ROAD.flat m 에서 원래 높이로 돌아간다.
   makeRoad(cfg): 지형 위에 얹는 띠 한 장. 무늬는 셰이더가 uv(가로 0..1, 세로 = 길을 따라간 거리 m)로 그린다 —
     바퀴 자국 두 줄, 가운데 둔덕, 노이즈로 들쭉날쭉한 가장자리. 차 밑에서 6m 에 걸쳐 나타나고 끝 30m 에서 사라진다.
   onRoad·nearRoad·roadYaw: 걷기 발소리(game.js), 식생 배치(vegetation.js), 꿈속에서 돌아서는 방향(game.js)이 쓴다 */

/* 경로: 1m 간격 점 { x, z, s(길을 따라간 거리), h(길 높이), tx·tz(진행 방향) } */
let P = null, LEN = 0;

function makePath(cfg) {
  const curve = new THREE.CatmullRomCurve3(ROAD.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  LEN = curve.getLength();
  const N = Math.ceil(LEN), sp = curve.getSpacedPoints(N);
  P = sp.map((p, i) => ({ x: p.x, z: p.z, s: i * LEN / N, h: terrainBase(p.x, p.z, cfg), tx: 0, tz: 1 }));
  P.forEach((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(N, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    p.tx = dx / l; p.tz = dz / l;
  });
  /* 높이: 앞뒤 8m 를 평균 내 경사를 완만하게 (지형의 잔 굴곡을 그대로 따르면 길이 출렁인다) */
  const H = P.map(p => p.h);
  P.forEach((p, i) => { let s = 0, n = 0; for (let k = -8; k <= 8; k++) { const j = i + k; if (j >= 0 && j <= N) { s += H[j]; n++; } } p.h = s / n; });
}

/* 길 주변 격자: 칸마다 가장 가까운 길 선분까지의 거리와, 그 자리의 길 높이·길을 따라간 거리.
   식생이 비키는 범위(clear + clearStart)까지 덮도록 넉넉히 잡는다 */
function makeGrid(cfg) {
  const pad = ROAD.hw + ROAD.clear + ROAD.clearStart + 2, C = 1;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  P.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
  x0 = Math.floor(x0 - pad); z0 = Math.floor(z0 - pad); x1 = Math.ceil(x1 + pad); z1 = Math.ceil(z1 + pad);
  const nx = (x1 - x0) / C + 1, nz = (z1 - z0) / C + 1, d = new Float32Array(nx * nz), h = new Float32Array(nx * nz), s = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * C, z = z0 + j * C; let bd = Infinity, bh = 0, bs = 0;
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k], b = P[k + 1], ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2)), px = a.x + ex * t - x, pz = a.z + ez * t - z, dd = px * px + pz * pz;
      if (dd < bd) { bd = dd; bh = a.h + (b.h - a.h) * t; bs = a.s + (b.s - a.s) * t; }
    }
    const k = j * nx + i; d[k] = Math.sqrt(bd); h[k] = bh; s[k] = bs;
  }
  return { key: cfg.key, x0, z0, nx, nz, cell: C, d, h, s, hw: ROAD.hw, flat: ROAD.flat };
}

/* ── 씬마다: 지형을 굽기 전에 ── */
export function prepareRoad(cfg) {
  setRoadGrid(null);
  makePath(cfg);
  setRoadGrid(makeGrid(cfg));
}

/* ── 씬마다: 지면을 만든 뒤 길 띠를 얹는다 ── */
export function makeRoad(cfg) {
  const tone = ROAD.tone[cfg.key] || ROAD.tone.lake, hw = ROAD.hw, NJ = 8, pos = [], uv = [], idx = [];
  P.forEach(q => {
    for (let j = 0; j <= NJ; j++) { const u = -1 + 2 * j / NJ; pos.push(q.x - q.tz * u * hw, q.h + 0.04, q.z + q.tx * u * hw); uv.push(j / NJ, q.s); }
  });
  for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < NJ; j++) { const a = i * (NJ + 1) + j, b = a + NJ + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const geo = new THREE.BufferGeometry(); geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  /* 결: 장소의 바닥과 같은 노멀맵. 가로는 길 폭만큼, 세로는 1m 에 한 번 반복 */
  const det = cfg.snow ? 'snow' : cfg.key === 'beach' ? 'sand' : 'dirt';
  const mat = new THREE.MeshStandardMaterial(Object.assign({ roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }, tex(det, hw * 2, 1, 0.35, false)));
  mat.defines.USE_UV = '';
  const u = {
    uBase: { value: new THREE.Color(tone.base) }, uRut: { value: new THREE.Color(tone.rut) }, uMid: { value: new THREE.Color(tone.mid) },
    uMidK: { value: tone.midK }, uLen: { value: LEN }, uRutK: { value: ROAD.rut },
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = NOISE_GLSL + 'uniform vec3 uBase,uRut,uMid;uniform float uMidK,uLen,uRutK;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float ru=vUv.x*2.0-1.0,ra=abs(ru),rs=vUv.y;
      float rn1=vnoise(vec2(rs*0.3,ru*1.5)),rn2=vnoise(vec2(rs*1.6,ru*5.0)),rn3=vnoise(vec2(rs*7.0,ru*16.0));
      float redge=1.0-smoothstep(0.72,1.0,ra+(rn1-0.5)*0.4);
      float rrut=(1.0-smoothstep(0.07,0.2,abs(ra-0.5)+(rn2-0.5)*0.07))*uRutK;
      float rmid=1.0-smoothstep(0.1,0.3,ra+(rn2-0.5)*0.18);
      vec3 rc=uBase*(0.88+0.24*rn3);
      rc=mix(rc,uRut*(0.9+0.15*rn3),rrut);
      rc=mix(rc,uMid*(0.8+0.35*rn2),rmid*uMidK*(0.6+0.4*rn1));
      float rfade=smoothstep(0.0,6.0,rs)*(1.0-smoothstep(uLen-30.0,uLen,rs));
      diffuseColor.rgb*=rc;diffuseColor.a*=redge*rfade;`);
  };
  mat.customProgramCacheKey = () => 'road';
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true; m.renderOrder = 1; m.userData.noAO = true; m.userData.noRefl = true;
  return m;
}

/* 길 위인지 (pad 만큼 바깥까지 넓혀 본다). 발소리·풀·낙엽 */
export function onRoad(x, z, pad = 0) { const r = roadAt(x, z); return !!r && r.d < ROAD.hw + pad; }
/* 나무·바위·덤불이 비켜야 하는 자리. 차 바로 뒤 20m 는 clearStart 만큼 더 넓다 */
export function nearRoad(x, z) { const r = roadAt(x, z); return !!r && r.d < ROAD.hw + ROAD.clear + ROAD.clearStart * (1 - smooth(0, 20, r.s)); }
/* (x, z) 에서 길 위 35m 지점을 바라보는 방향 (카메라 yaw). 꿈속에서 총을 들고 돌아서는 방향 */
export function roadYaw(x, z) {
  if (!P) return Math.PI;
  const q = P[Math.min(P.length - 1, Math.round(35 / LEN * (P.length - 1)))];
  return Math.atan2(-(q.x - x), -(q.z - z));
}