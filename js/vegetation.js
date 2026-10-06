import * as THREE from 'three';
import { ctx } from './state.js';
import { BLOCKS } from './data.js';
import { rnd, fbm, std, smoothM, shadowed, bar, jitter, mergeParts, tintOf, pushAll, isTouch } from './util.js';
import { terrainH, slopeUp, shoreOff, campDirt, WATER_Y } from './terrain.js';
import { tex } from './textures.js';

/* 모바일은 식생 밀도를 낮춘다 */
const M = isTouch ? 0.55 : 1;

/* ── 자리 잡기: 놓인 물체를 격자(기본 2m)에 기록해 두고, 새 물체가 근처 칸의 물체와 겹치는지만 빠르게 검사한다 ──
   물체마다 두 반지름을 둔다.
   r: 간격 반지름 — 같은 층(나무끼리, 바위끼리, 조개끼리)은 서로 이만큼 떨어진다
   h: 단단한 반지름 — 줄기·바위 몸통. 덤불·풀·조개처럼 아래층에 깔리는 것은 이것만 피한다 (under = true)
   노이즈 군집은 그대로 두므로, 격자처럼 고르게 퍼지지 않고 뭉쳐 자라되 겹치지만 않는다 */
function makeSpace(cell = 2) {
  const grid = new Map(), key = (i, j) => (i + 2048) * 4096 + (j + 2048);
  let maxR = 0;
  const hit = (x, z, reach, test) => {
    const n = Math.ceil(reach / cell), ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
      const l = grid.get(key(i, j)); if (l) for (const o of l) if (test(o)) return true;
    }
    return false;
  };
  return {
    /* 이 자리에 반지름 r 짜리를 놓을 수 있는가. under 면 기존 물체의 단단한 반지름(h)만 피한다 */
    fits(x, z, r, under) { return !hit(x, z, r + maxR, o => Math.hypot(x - o.x, z - o.z) < r + (under ? o.h : o.r)); },
    add(x, z, r, h) {
      const k = key(Math.floor(x / cell), Math.floor(z / cell));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ x, z, r, h: h === undefined ? r : h }); if (r > maxR) maxR = r;
    },
  };
}

/* 잎 재질: 바람 흔들림 + 역광 투과 + 림 라이트 + 아랫면 어두움.
   흔들림 폭은 W.wind(0..1)를 따른다 — 바람 0.5 에서 예전과 같은 폭 */
export function swayMat(extra, strength, from) {
  const W = ctx.W, mat = new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.95 }, extra || {}));
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = W.uTime; sh.uniforms.uSunV = W.uSunV; sh.uniforms.uLeafCol = W.uLeafCol; sh.uniforms.uWind = W.wind;
    sh.vertexShader = 'uniform float uTime;uniform float uWind;varying vec3 vWN;\n' + sh.vertexShader
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN=inverseTransformDirection(transformedNormal,viewMatrix);')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
    vec3 ip=instanceMatrix[3].xyz;float hh=max(transformed.y-${from.toFixed(2)},0.0);float sw=(sin(uTime*0.9+ip.x*0.25+ip.z*0.2)+0.5*sin(uTime*2.3+ip.x*0.9))*${strength.toFixed(4)}*hh*(0.35+1.3*uWind);transformed.x+=sw;transformed.z+=sw*0.6;
    #endif`);
    sh.fragmentShader = 'uniform vec3 uSunV,uLeafCol;varying vec3 vWN;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb*=mix(0.62,1.0,smoothstep(-0.45,0.4,vWN.y));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 Vd=normalize(vViewPosition);float rim=pow(1.0-max(dot(normal,Vd),0.0),3.0);float back=pow(max(dot(-Vd,uSunV),0.0),3.0);
          totalEmissiveRadiance+=diffuseColor.rgb*uLeafCol*(back*0.7+rim*0.25); }`);
  };
  return mat;
}
export function instanced(geo, mat, list, cast) {
  const im = new THREE.InstancedMesh(geo, mat, list.length), d = new THREE.Object3D(), c = new THREE.Color();
  list.forEach((t, i) => { d.position.set(t.x, t.y, t.z); d.rotation.set(t.rx || 0, t.rot || 0, t.rz || 0); d.scale.set(t.s, t.s * (t.sy || 1), t.s); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, c.setRGB(t.tint[0], t.tint[1], t.tint[2])); });
  im.castShadow = !!cast; im.receiveShadow = true; im.frustumCulled = false; return im;
}
/* ── 넓게 흩어진 인스턴스를 구역별로 나눈다 ──
   하나의 InstancedMesh 가 360°를 덮으면 바운딩 구가 전부를 감싸 컬링이 아무 효과가 없다.
   방위각 nA 조각 × (rSplit 안쪽 / 바깥쪽) 으로 나누면 메인·반사·태양 그림자·모닥불 큐브 그림자 패스에서 화면 밖 구역이 빠진다 */
function sectorize(list, nA, rSplit) {
  const groups = new Map();
  list.forEach(t => {
    const a = Math.floor((Math.atan2(t.z, t.x) + Math.PI) / (Math.PI * 2) * nA) % nA, ring = Math.hypot(t.x, t.z) < rSplit ? 0 : 1, k = ring * nA + a;
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
  });
  return [...groups.values()];
}
/* 인스턴스 기준 바운딩 구를 만들고 컬링을 켠다. pad 는 바람 흔들림 여유 */
function culled(im, pad) { im.frustumCulled = true; im.computeBoundingSphere(); im.boundingSphere.radius += pad; return im; }
function mergeGeos(list) {
  const pos = [], col = [], uv = [], c = new THREE.Color();
  list.forEach(p => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; g.applyMatrix4(p.matrix);
    const pa = g.attributes.position, ua = g.attributes.uv, k = p.uvs || 1; let minY = 1e9, maxY = -1e9;
    if (p.grad) for (let i = 0; i < pa.count; i++) { minY = Math.min(minY, pa.getY(i)); maxY = Math.max(maxY, pa.getY(i)); }
    c.set(p.color);
    for (let i = 0; i < pa.count; i++) { const sh = p.grad ? 0.72 + 0.4 * (pa.getY(i) - minY) / (maxY - minY + 1e-6) : 1; col.push(c.r * sh, c.g * sh, c.b * sh); uv.push(ua ? ua.getX(i) * k : 0, ua ? ua.getY(i) * k : 0); }
    pushAll(pos, pa.array);
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}

function pineGeo(color, snowy) {
  const parts = [{ geo: new THREE.CylinderGeometry(0.16, 0.26, 1.8, 6), color: 0x4a3325, y: 0.9, uvs: 2 }];
  [[1.45, 2.8, 2.3], [1.15, 2.6, 3.4], [0.85, 2.3, 4.5], [0.5, 2.0, 5.5]].forEach(([r, h, y], i) => {
    parts.push({ geo: jitter(new THREE.ConeGeometry(r, h, 8), 0.28), color: new THREE.Color(color).multiplyScalar(1 + i * 0.07).getHex(), y, grad: true, uvs: 3 });
    if (snowy) parts.push({ geo: jitter(new THREE.ConeGeometry(r * 0.78, h * 0.42, 8), 0.28), color: 0xf3f6fb, y: y + h * 0.3, uvs: 2 });
  });
  return mergeParts(parts);
}
const UP = new THREE.Vector3(0, 1, 0);
function treeGeo(color) {
  const list = [], q = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
  const seg = (a, b, r0, r1) => { const dir = b.clone().sub(a), len = dir.length(); dir.normalize(); const rot = new THREE.Quaternion().setFromUnitVectors(UP, dir); list.push({ geo: new THREE.CylinderGeometry(r1, r0, len, 7), matrix: new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), rot, ONE), color: 0x5a4030, uvs: 2 }); };
  const grow = (p0, dir, len, r, depth) => {
    const p1 = p0.clone().addScaledVector(dir, len); seg(p0, p1, r, r * 0.65);
    if (depth === 0) { const s = len * 0.95; list.push({ geo: jitter(new THREE.IcosahedronGeometry(1, 1), 0.32), matrix: new THREE.Matrix4().compose(p1, new THREE.Quaternion(), new THREE.Vector3(s, s * 0.8, s)), color: new THREE.Color(color).multiplyScalar(rnd(0.85, 1.15)).getHex(), grad: true, uvs: 3 }); return; }
    const n = depth >= 2 ? 3 : 2 + (Math.random() < 0.5 ? 1 : 0), base = rnd(0, 6.3), rot = q.setFromUnitVectors(UP, dir).clone();
    for (let i = 0; i < n; i++) {
      const az = base + i * 6.28 / n + rnd(-0.4, 0.4), tilt = rnd(0.5, 0.95);
      const nd = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)).applyQuaternion(rot); nd.y += 0.25; nd.normalize();
      grow(p1.clone().addScaledVector(dir, -len * rnd(0, 0.2)), nd, len * rnd(0.6, 0.75), r * 0.62, depth - 1);
    }
  };
  grow(new THREE.Vector3(0, 0, 0), UP.clone(), 2.2, 0.17, 3);
  return mergeGeos(list);
}
function bushGeo(color) { return mergeParts([{ geo: jitter(new THREE.IcosahedronGeometry(1, 1), 0.35), color, y: 0.6, sy: 0.7, grad: true, uvs: 2 }, { geo: jitter(new THREE.IcosahedronGeometry(0.7, 1), 0.35), color, y: 0.7, x: 0.7, z: 0.3, sy: 0.7, grad: true, uvs: 2 }]); }
function bladeGeo(w, h, curl) { const g = new THREE.PlaneGeometry(w, h, 1, 4); g.translate(0, h / 2, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getY(i) / h; p.setX(i, p.getX(i) * (1 - t * 0.85)); p.setZ(i, t * t * curl); } return g; }
function grassGeo() { return mergeParts([{ geo: bladeGeo(0.09, 0.5, 0.16), color: 0xffffff, grad: true }, { geo: bladeGeo(0.09, 0.5, 0.16), color: 0xffffff, ry: Math.PI / 2, grad: true }]); }
function reedGeo() {
  return mergeParts([
    { geo: bladeGeo(0.05, 1.4, 0.12), color: 0x7f9a48, grad: true }, { geo: bladeGeo(0.05, 1.4, 0.12), color: 0x74903f, ry: Math.PI / 2, grad: true },
    { geo: bladeGeo(0.035, 1.05, 0.1), color: 0x8aa050, ry: 0.8, grad: true },
    { geo: new THREE.CylinderGeometry(0.012, 0.016, 0.18, 6), color: 0x6b4a2a, y: 1.32 },
  ]);
}

/* ── 야자수 ── */
function frondGeo(L) {
  const pos = [], col = [], uv = [];
  const rib = t => new THREE.Vector3(L * t, L * (0.32 * t - 0.62 * t * t), 0);
  const tri = (a, b, c, ca, cb, cc) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); col.push(...ca, ...cb, ...cc); uv.push(0, 0, 1, 0, 0.5, 1); };
  const SEG = 10, cr = [0.6, 0.55, 0.32];
  for (let i = 0; i < SEG; i++) { const t0 = i / SEG, t1 = (i + 1) / SEG, w0 = 0.022 * (1 - t0 * 0.7), w1 = 0.022 * (1 - t1 * 0.7); const a = rib(t0), b = rib(t1); const a1 = a.clone().setZ(-w0), a2 = a.clone().setZ(w0), b1 = b.clone().setZ(-w1), b2 = b.clone().setZ(w1); tri(a1, b1, b2, cr, cr, cr); tri(a1, b2, a2, cr, cr, cr); }
  const N = 18, cb = [0.74, 0.8, 0.62], ct = [0.98, 1.06, 0.86];
  for (let i = 0; i < N; i++) for (const s of [-1, 1]) {
    const t = 0.1 + 0.88 * (i + (s > 0 ? 0.5 : 0)) / N, P = rib(t), lf = L * 0.27 * (1 - 0.55 * t) * rnd(0.85, 1.1), w = L * 0.032;
    const d = new THREE.Vector3(0.45, -0.55 - 0.35 * t, s * 0.85).normalize(), n = new THREE.Vector3(1, 0, 0);
    const tip = P.clone().addScaledVector(d, lf), b1 = P.clone().addScaledVector(n, -w * 0.5), b2 = P.clone().addScaledVector(n, w * 0.5);
    const m1 = P.clone().addScaledVector(d, lf * 0.5).addScaledVector(n, -w * 0.4), m2 = P.clone().addScaledVector(d, lf * 0.5).addScaledVector(n, w * 0.4);
    tri(b1, m1, b2, cb, ct, cb); tri(b2, m1, m2, cb, ct, ct); tri(m1, tip, m2, ct, ct, ct);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g;
}
function crownGeo(L) {
  const pos = [], col = [], uv = [], m = new THREE.Matrix4(), rz = new THREE.Matrix4(), n = 11;
  for (let i = 0; i < n; i++) {
    const g = frondGeo(L * rnd(0.85, 1.15));
    m.makeRotationY(i / n * Math.PI * 2 + rnd(-0.2, 0.2)).multiply(rz.makeRotationZ(rnd(0.2, 0.75))); g.applyMatrix4(m);
    pushAll(pos, g.attributes.position.array); pushAll(col, g.attributes.color.array); pushAll(uv, g.attributes.uv.array);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}
function makePalm() {
  const g = new THREE.Group(), bark = smoothM(0x8a6b48, Object.assign({ roughness: 0.95 }, tex('bark', 1, 1, 0.5)));
  const H = rnd(5.5, 8), bend = rnd(0.8, 1.8), dir = rnd(0, Math.PI * 2), N = 8; let prev = [0, 0, 0];
  for (let i = 1; i <= N; i++) { const t = i / N, x = Math.cos(dir) * bend * t * t, z = Math.sin(dir) * bend * t * t, y = H * t; g.add(bar(prev, [x, y, z], 0.17 - t * 0.07, bark, 9)); prev = [x, y, z]; }
  const top = new THREE.Vector3(...prev);
  const leaf = smoothM(0x3f8a3a, Object.assign({ roughness: 0.8, side: THREE.DoubleSide, vertexColors: true }, tex('leaf', 1, 1, 0.35)));
  const crown = new THREE.Mesh(crownGeo(2.7), leaf); crown.position.copy(top).add(new THREE.Vector3(0, -0.1, 0)); g.add(crown);
  for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), smoothM(0x6b5a30)); c.position.copy(top).add(new THREE.Vector3(rnd(-0.2, 0.2), -0.22, rnd(-0.2, 0.2))); g.add(c); }
  return shadowed(g);
}
function makeRock(s, color) { const r = new THREE.Mesh(jitter(new THREE.DodecahedronGeometry(s, 1), 0.4), std(color, tex('rock', 2, 2, 0.55))); r.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3)); return shadowed(r); }

/* ── 조개껍데기: 가리비·소라·바지락 (정점색 무늬 포함) ── */
/* 격자 함수 fn(u,v) → [x,y,z,r,g,b] 여러 장을 한 지오메트리로 잇는다 (인덱스라 노멀이 매끈하다) */
function shellGeo(parts) {
  const pos = [], col = [], idx = [];
  parts.forEach(([nu, nv, fn]) => {
    const base = pos.length / 3;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const p = fn(i / nu, j / nv); pos.push(p[0], p[1], p[2]); col.push(p[3], p[4], p[5]); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = base + i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  });
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); return g;
}
/* 가장 낮은 점을 y 0 에, 가로 가운데를 원점에 — 모래 위에 바로 놓인다 */
function sitOnGround(g) { g.computeBoundingBox(); const b = g.boundingBox; g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); return g; }
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* 가리비: 경첩에서 부채꼴로 퍼지는 몸통에 방사형 골 16개, 촘촘한 성장선, 동심원 색띠.
   경첩 양옆으로 납작한 귀 두 장. 볼록한 면이 위로, 가장자리가 모래에 닿는다 */
function scallopGeo() {
  const N = 50, SPAN = 0.95, base = [0.98, 0.91, 0.85], band = [0.9, 0.66, 0.56], rib = [1, 0.97, 0.93];
  const body = (u, v) => {
    const phi = (v * 2 - 1) * SPAN, rb = Math.pow(0.5 + 0.5 * Math.cos(phi * N), 1.5);
    const r = u * (1 - 0.1 * phi * phi) * (1 + 0.025 * rb);
    const y = 0.26 * Math.sin(Math.PI * Math.pow(u, 0.8)) * (1 - 0.25 * u) * (1 - 0.35 * phi * phi) + 0.03 * u * rb + 0.003 * Math.sin(u * 95) * u;
    const c = mix3(mix3(base, band, 0.8 * sstep(0.3, 0.9, 0.5 + 0.5 * Math.sin(u * 13 + phi * 1.5))), rib, rb * 0.5);
    return [r * Math.sin(phi), y, r * Math.cos(phi), ...c];
  };
  const ear = side => (a, b) => [side * 0.36 * a * (1 - 0.25 * b), 0.012 + 0.05 * b * (1 - 0.5 * a) + 0.004 * Math.cos(a * 30), 0.22 * b * (1 - 0.45 * a) - 0.02, ...mix3(base, band, 0.3)];
  return sitOnGround(shellGeo([[24, 64, body], [6, 10, ear(1)], [6, 10, ear(-1)]]));
}
/* 소라: 로그 나선을 따라 커지는 타원 단면을 쓸어 만든다 (실제 고둥이 자라는 방식).
   어깨에 돌기가 줄지어 나고, 표면엔 나선 이랑과 갈색 줄무늬, 입구는 넓게 벌어지며 안쪽이 분홍빛이다.
   옆으로 누워 모래에 놓인 모습으로 돌려 두고, 가장 긴 길이를 1.7 로 맞춘다 */
function conchGeo() {
  const T0 = -5.5 * Math.PI, B = 0.13, D = 0.7, H = 2.2, A = 0.75, BV = 1.05;
  const cream = [0.97, 0.9, 0.8], brown = [0.7, 0.5, 0.37], pink = [1, 0.78, 0.7];
  const g = shellGeo([[170, 36, (u, v) => {
    const th = T0 * (1 - u), k = Math.exp(B * th), s = v * Math.PI * 2, cs = Math.cos(s), sn = Math.sin(s);
    const lip = sstep(0.93, 1, u), flare = 1 + 0.35 * lip;
    const knob = Math.pow(Math.max(0, Math.sin(th * 4.5)), 3) * Math.exp(-((s - 0.7) ** 2) / 0.12);
    const rr = 1 + 0.03 * Math.sin(s * 16) + 0.22 * knob;
    const ex = A * cs * rr * flare, ey = BV * sn * (sn < 0 ? 1.45 : 1) * rr * flare;
    const cx = Math.cos(th), cz = Math.sin(th);
    let c = mix3(cream, brown, 0.6 * sstep(0.55, 0.8, 0.5 + 0.5 * Math.sin(th * 2.5 + s * 3)));
    c = mix3(c, pink, lip * sstep(0.3, -0.6, cs));
    return [k * (D + ex) * cx, k * (-H + ey), k * (D + ex) * cz, ...c];
  }]]);
  g.rotateZ(Math.PI / 2); g.rotateX(0.5);
  g.computeBoundingBox(); const bb = g.boundingBox, L = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  g.scale(1.7 / L, 1.7 / L, 1.7 / L);
  return sitOnGround(g);
}
/* 바지락: 위가 살짝 좁은 달걀꼴, 앞쪽으로 비켜 난 꼭지(각정), 촘촘한 동심 성장선, 지그재그 무늬 */
function clamGeo() {
  const base = [0.93, 0.89, 0.84], dark = [0.56, 0.5, 0.46];
  return sitOnGround(shellGeo([[22, 64, (u, v) => {
    const t = v * Math.PI * 2, sz = Math.sin(t);
    const ex = 0.62 * Math.cos(t) * (1 + 0.06 * sz), ez = 0.5 * sz * (sz < 0 ? 0.88 : 1);
    const x = -0.08 * (1 - u) + ex * u, z = -0.32 * (1 - u) + ez * u;
    const y = 0.24 * Math.pow(1 - u * u, 0.7) + 0.006 * Math.sin(u * 60) * u;
    const ray = sstep(0.6, 0.9, 0.5 + 0.5 * Math.sin(t * 9 + Math.sin(u * 18) * 0.8)), ring = sstep(0.5, 0.8, 0.5 + 0.5 * Math.sin(u * 11));
    return [x, y, z, ...mix3(base, dark, Math.max(ray * 0.55, ring * 0.3) * sstep(0.1, 0.4, u))];
  }]]));
}
function reserved(x, z) { if (Math.abs(x) < 9.5 && z > -9 && z < 14) return true; if (ctx.W.cfg.dock && x > 3 && x < 9 && z < -6 && z > -22) return true; return false; }

export function makeVegetation(cfg) {
  const W = ctx.W, scene = ctx.scene, pines = [], leafs = [], bushes = [];
  /* 자리 격자: scene.js 의 해변 유목도 같은 격자를 쓴다 */
  const S = W.space = makeSpace();
  const nPines = Math.round(cfg.pines * M), nLeafs = Math.round(cfg.leafs * M), nBushes = Math.round(cfg.bushes * M);

  /* 바위: 가장 먼저, 가장 단단한 것부터 자리를 잡는다 (몸통이 땅에 반쯤 묻혀 있어 간격 = 크기, 단단한 부분 = 0.9배) */
  for (let i = 0, n = 0; i < (cfg.rocks || 0) * 4 && n < (cfg.rocks || 0); i++) {
    const a = rnd(0, 6.3), r = rnd(9, 70), x = Math.cos(a) * r, z = Math.sin(a) * r; if (reserved(x, z)) continue;
    const h = terrainH(x, z, cfg); if (h < 0.05) continue;
    const s = rnd(0.35, 1.4); if (!S.fits(x, z, s)) continue;
    S.add(x, z, s, s * 0.9);
    const rk = makeRock(s, cfg.snow ? 0xa8b3c0 : 0x6f7276); rk.position.set(x, h + s * 0.15, z); scene.add(rk); W.trees.push([x, z, s * 0.9]); n++;
  }

  /* sp: 자리 규칙. r·h 는 크기(s)에 곱하는 간격·단단한 반지름, under 는 큰 나무 밑에도 들어갈 수 있는지(줄기·바위만 피한다) */
  const tryPlace = (rMin, rMax, list, minH, maxH, radius, minUp, cluster, zmin, sp) => {
    const a = rnd(0, Math.PI * 2), r = rMax * Math.sqrt(rnd((rMin * rMin) / (rMax * rMax), 1)), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (reserved(x, z) || (zmin !== undefined && z < zmin)) return; const h = terrainH(x, z, cfg); if (h < minH || h > maxH) return;
    if (cluster && fbm(x * 0.03 + 5, z * 0.03 + 9, 3) < cluster) return;
    if (slopeUp(x, z, cfg) < minUp) return;
    const s = rnd(0.8, 1.6); if (!S.fits(x, z, sp.r * s, sp.under)) return;
    S.add(x, z, sp.r * s, sp.h * s);
    list.push({ x, y: h - 0.15, z, s, rot: rnd(0, 6.3), tint: tintOf(0, rnd(-0.05, 0.05)) }); W.trees.push([x, z, radius * s]);
  };
  /* 소나무: 원뿔 밑지름의 약 2/3 간격 — 가지 끝은 살짝 맞닿아도 줄기와 몸통은 겹치지 않는다
     활엽수: 가지가 넓게 퍼지므로 조금 더 띄운다. 덤불: 나무 그늘 아래에도 자라되 줄기는 피하고, 덤불끼리는 겹치지 않는다 (bushes 는 아래에서 0.6배로 줄인다) */
  const PINE = { r: 0.95, h: 0.3 }, LEAF = { r: 1.2, h: 0.25 }, BUSH = { r: 0.54, h: 0.3, under: true };
  const near = Math.round(nPines * 0.45);
  for (let i = 0; i < near * 5 && pines.length < near; i++) tryPlace(10, 65, pines, 0.3, 60, 0.32, 0.68, cfg.key === 'lake' ? 0.34 : 0.42, undefined, PINE);
  for (let i = 0; i < nPines * 4 && pines.length < nPines; i++) tryPlace(55, 180, pines, 0.3, 130, 0.32, 0.7, cfg.key === 'lake' ? 0.4 : 0.45, undefined, PINE);
  for (let i = 0; i < nLeafs * 4 && leafs.length < nLeafs; i++) tryPlace(10, 85, leafs, 0.3, 60, 0.35, 0.72, 0.36, undefined, LEAF);
  for (let i = 0; i < nBushes * 4 && bushes.length < nBushes; i++) tryPlace(5, 70, bushes, 0.15, 60, 0.45, 0.6, 0, cfg.bushZmin, BUSH);
  const treeColor = cfg.key === 'snow' ? 0x2f4f46 : 0x2b5a2b, fol = () => tex('foliage', 1, 1, 0.3);
  /* 소나무: 방위 8조각 × 60m 안팎 = 최대 16개 메시. 지오메트리·재질은 공유하므로 셰이더는 그대로 하나 */
  if (pines.length) {
    const pg = pineGeo(treeColor, cfg.snow), pm = swayMat(fol(), 0.012, 1.5);
    sectorize(pines, 8, 60).forEach(list => scene.add(culled(instanced(pg, pm, list, true), 0.6)));
  }
  /* 활엽수: 모양 3종 × 방위 8조각 × 45m 안팎. 화면·태양 그림자·모닥불 큐브 그림자·반사 패스에서 보이지 않는 구역은 빠진다.
     흔들림 여유 1.0m (줄기 위 최대 흔들림 약 0.4m 에 여유를 둠) */
  if (leafs.length) {
    const groups = [[], [], []]; leafs.forEach((t, i) => groups[i % 3].push(t));
    groups.forEach(list => {
      if (!list.length) return;
      const g = treeGeo(0x4c8a3a), m = swayMat(fol(), 0.02, 2.0);
      sectorize(list, 8, 45).forEach(sub => scene.add(culled(instanced(g, m, sub, true), 1.0)));
    });
  }
  /* 덤불: 방위 8조각 × 35m 안팎 */
  if (bushes.length) {
    const g = bushGeo(cfg.key === 'beach' ? 0x7a8a4e : 0x3f7a35), m = swayMat(fol(), 0.03, 0.2);
    const list = bushes.map(b => Object.assign(b, { s: b.s * 0.6, y: b.y + 0.1 }));
    sectorize(list, 8, 35).forEach(sub => scene.add(culled(instanced(g, m, sub, true), 0.4)));
  }
  /* 야자수: 줄기 밑동 기준 0.6m 간격 (윗부분이 휘어 잎끼리는 겹쳐도 자연스럽다). 자리가 없으면 다른 곳을 다시 찾는다 */
  for (let i = 0, n = 0; i < cfg.palms * 6 && n < cfg.palms; i++) {
    const x = (Math.random() < 0.5 ? -1 : 1) * rnd(5, 42), z = rnd(-2, 34);
    if (reserved(x, z) || !S.fits(x, z, 0.6)) continue;
    S.add(x, z, 0.6, 0.3);
    const p = makePalm(); p.position.set(x, terrainH(x, z, cfg) - 0.1, z); scene.add(p); W.trees.push([x, z, 0.35]); n++;
  }

  /* 낙엽: 활엽수 밑에만 (눈·모래사장 제외). 물 반사에서는 제외. 땅에 납작하게 깔려 서로 겹쳐도 자연스러우므로 자리 검사를 하지 않는다 */
  if (leafs.length && !cfg.snow) {
    const lv = [], cols = [0xc8742a, 0x8a5a2e, 0xd6a33a, 0x9a4a22], c = new THREE.Color();
    leafs.forEach(t => { for (let i = 0; i < 7; i++) { const a = rnd(0, 6.3), r = rnd(0.5, 4.5) * t.s, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r; const h = terrainH(x, z, cfg); if (h < WATER_Y + 0.1) continue; c.set(cols[Math.floor(Math.random() * 4)]).multiplyScalar(rnd(0.75, 1.15)); lv.push({ x, y: h + 0.012, z, s: rnd(0.7, 1.2), rot: rnd(0, 6.3), rx: rnd(-0.15, 0.15), tint: [c.r, c.g, c.b] }); } });
    const lg = new THREE.PlaneGeometry(0.14, 0.09); lg.rotateX(-Math.PI / 2);
    if (lv.length) { const im = instanced(lg, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), lv, false); im.userData.noRefl = true; scene.add(im); }
  }
  /* 물가: 갈대(호수) + 자갈(호수) + 조개껍데기(모래사장) */
  if (cfg.water) {
    if (cfg.key === 'lake') {
      /* 갈대: 바위·줄기만 피한다. 갈대끼리는 무더기로 뭉쳐 자라므로 기록하지 않는다 */
      const reeds = [], nReeds = Math.round(520 * M);
      for (let t = 0; t < 1100 && reeds.length < nReeds; t++) {
        const x = rnd(-110, 110); if (cfg.dock && x > 2 && x < 9.5) continue;
        const z = cfg.water.z + shoreOff(x, cfg) - 2.3 + rnd(-1.6, 1.4);
        const h = terrainH(x, z, cfg); if (h < WATER_Y - 0.4 || h > WATER_Y + 0.15) continue;
        if (fbm(x * 0.05 + 21, z * 0.05 + 8, 3) < 0.5) continue;
        if (!S.fits(x, z, 0.12, true)) continue;
        reeds.push({ x, y: h - 0.05, z, s: rnd(0.8, 1.3), sy: rnd(0.9, 1.4), rot: rnd(0, 6.3), tint: tintOf(0, rnd(-0.04, 0.06)) });
      }
      if (reeds.length) scene.add(instanced(reedGeo(), swayMat(fol(), 0.05, 0.2), reeds, false));
    }
    if (cfg.key !== 'beach') {
      /* 자갈: 바위·줄기를 피하고, 자갈끼리도 포개지지 않게 */
      const pb = [];
      for (let t = 0; t < 1400 && pb.length < 450; t++) {
        const x = rnd(-90, 90); if (cfg.dock && x > 2.5 && x < 9) continue;
        const z = cfg.water.z + shoreOff(x, cfg) - 2.3 + rnd(-1.8, 1.8), h = terrainH(x, z, cfg); if (h < WATER_Y - 0.25) continue;
        const s = rnd(0.03, 0.08); if (!S.fits(x, z, s, true)) continue;
        S.add(x, z, s);
        const g = rnd(0.55, 0.85); pb.push({ x, y: h + 0.01, z, s, rot: rnd(0, 6.3), tint: [g, g, g * 0.97] });
      }
      if (pb.length) { const im = instanced(jitter(new THREE.DodecahedronGeometry(1, 0), 0.5), std(0xffffff, { roughness: 0.85 }), pb, false); im.userData.noRefl = true; scene.add(im); }
    }
    if (cfg.key === 'beach') {
      /* 조개: 가리비 40% · 소라 30% · 바지락 30%. 모양에 정점색 무늬가 구워져 있고, 인스턴스 색(tint)이 그 위에 곱해진다.
         지오메트리의 바닥이 y 0 이라 모래 높이에 바로 놓는다 (1mm 묻어 떠 보이지 않게).
         조개끼리 포개지지 않고, 야자수 줄기도 피한다. 반지름은 모양의 반폭(소라는 길쭉해서 조금 더 크게) */
      const tints = [[1, 0.97, 0.92], [1, 0.9, 0.86], [0.97, 0.97, 0.95], [0.92, 0.84, 0.74], [0.96, 0.92, 0.95]], lists = [[], [], []], SHELL_R = [0.75, 0.85, 0.65];
      for (let t = 0; t < 600 && lists[0].length + lists[1].length + lists[2].length < 70; t++) {
        const x = rnd(-90, 90); if (cfg.dock && x > 2.5 && x < 9) continue;
        const z = cfg.water.z + shoreOff(x, cfg) + rnd(-1.6, 4.2), h = terrainH(x, z, cfg); if (h < WATER_Y + 0.02) continue;
        const r = Math.random(), k = r < 0.4 ? 0 : r < 0.7 ? 1 : 2, s = k === 1 ? rnd(0.045, 0.07) : rnd(0.04, 0.065), sr = s * SHELL_R[k];
        if (!S.fits(x, z, sr, true)) continue;
        S.add(x, z, sr);
        lists[k].push({ x, y: h - 0.001, z, s, rot: rnd(0, 6.3), rx: rnd(-0.12, 0.12), tint: tints[Math.floor(Math.random() * tints.length)] });
      }
      const shellM = smoothM(0xffffff, { roughness: 0.45, vertexColors: true, side: THREE.DoubleSide });
      [scallopGeo(), conchGeo(), clamGeo()].forEach((g, k) => {
        if (!lists[k].length) return;
        const im = instanced(g, shellM, lists[k], false); im.userData.noRefl = true; scene.add(im);
      });
    }
  }

  const gr = cfg.grass; if (!gr) return;
  /* 풀: 바위·줄기·조개 같은 단단한 부분만 피한다 (나무 그늘 아래 풀은 그대로). 풀끼리는 기록하지 않는다 */
  const list = [], base = new THREE.Color(gr.color), c = new THREE.Color(), nGrass = Math.round(gr.n * M);
  for (let tries = 0; tries < nGrass * 4 && list.length < nGrass; tries++) {
    const a = rnd(0, Math.PI * 2), r = 3.5 + 44 * Math.pow(Math.random(), 0.7), x = Math.cos(a) * r, z = 3 + Math.sin(a) * r;
    if (z < gr.zmin || Math.hypot(x, z) > 48) continue;
    if (campDirt(x, z) > 0.35) continue;
    if (BLOCKS.some(b => x > b.x[0] - 0.2 && x < b.x[1] + 0.2 && z > b.z[0] - 0.2 && z < b.z[1] + 0.2)) continue;
    if (cfg.dock && x > 4.6 && x < 6.8 && z < -7.5) continue;
    const cl = fbm(x * 0.11 + 3, z * 0.11 + 8, 3); if (cl < 0.42 && Math.random() > (cl - 0.25) * 2) continue;
    const h = terrainH(x, z, cfg); if (h < WATER_Y + 0.3 && cfg.water) continue;
    if (!S.fits(x, z, 0.04, true)) continue;
    c.copy(base).multiplyScalar(rnd(0.7, 1.25)); list.push({ x, y: h - 0.02, z, s: rnd(0.6, 1.4), sy: rnd(0.8, 1.3), rot: rnd(0, 6.3), tint: [c.r, c.g, c.b] });
  }
  /* 풀: 돌풍 세기는 W.wind 를 따르고, 위치마다 약간의 변화만 남긴다 */
  const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  gm.onBeforeCompile = sh => {
    sh.uniforms.uTime = W.uTime; sh.uniforms.uWind = W.wind; sh.uniforms.uSunV = W.uSunV; sh.uniforms.uLeafCol = W.uLeafCol; sh.uniforms.uGroundCol = { value: new THREE.Color(cfg.ground).multiplyScalar(0.85) };
    sh.vertexShader = 'uniform float uTime;uniform float uWind;varying float vGH;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vGH=position.y/0.5;
    vec3 ip=instanceMatrix[3].xyz;float gust=(0.25+1.0*uWind)*(0.85+0.15*sin(uTime*0.35+ip.x*0.05+ip.z*0.08));float sw=(sin(uTime*1.7+ip.x*0.7+ip.z*0.5)+0.5*sin(uTime*3.4+ip.x*1.3+ip.z*0.4))*gust;float k=transformed.y*transformed.y*4.0;transformed.x+=sw*0.1*k;transformed.z+=sw*0.05*k;`);
    sh.fragmentShader = 'uniform vec3 uSunV,uLeafCol,uGroundCol;varying float vGH;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb=mix(uGroundCol,diffuseColor.rgb,smoothstep(0.0,0.5,vGH));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 Vd=normalize(vViewPosition);float back=pow(max(dot(-Vd,uSunV),0.0),3.0);totalEmissiveRadiance+=diffuseColor.rgb*uLeafCol*back*0.8*smoothstep(0.2,0.9,vGH); }`);
  };
  const grass = instanced(grassGeo(), gm, list, false); grass.userData.noRefl = true; scene.add(grass);
}