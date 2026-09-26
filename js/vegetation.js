import * as THREE from 'three';
import { ctx } from './state.js';
import { BLOCKS } from './data.js';
import { rnd, fbm, std, smoothM, shadowed, bar, jitter, mergeParts, tintOf, pushAll } from './util.js';
import { terrainH, slopeUp, shoreOff, campDirt, WATER_Y } from './terrain.js';
import { tex } from './textures.js';

/* 잎 재질: 바람 흔들림 + 역광 투과 + 림 라이트 + 아랫면 어두움 */
export function swayMat(extra, strength, from) {
  const W = ctx.W, mat = new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.95 }, extra || {}));
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = W.uTime; sh.uniforms.uSunV = W.uSunV; sh.uniforms.uLeafCol = W.uLeafCol;
    sh.vertexShader = 'uniform float uTime;varying vec3 vWN;\n' + sh.vertexShader
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN=inverseTransformDirection(transformedNormal,viewMatrix);')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
    vec3 ip=instanceMatrix[3].xyz;float hh=max(transformed.y-${from.toFixed(2)},0.0);float sw=(sin(uTime*0.9+ip.x*0.25+ip.z*0.2)+0.5*sin(uTime*2.3+ip.x*0.9))*${strength.toFixed(4)}*hh;transformed.x+=sw;transformed.z+=sw*0.6;
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

/* ── 조개껍데기 ── */
function gridGeo(nu, nv, fn) {
  const pos = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const p = fn(i / nu, j / nv); pos.push(p[0], p[1], p[2]); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}
/* 소라: 원뿔에 나선 이랑이 5바퀴 감기고, 아래 몸통이 볼록했다가 오므라든다. 옆으로 눕힘(축이 x) */
function conchGeo() {
  const g = gridGeo(90, 36, (u, v) => {
    const th = v * Math.PI * 2;
    let r = u < 0.82 ? Math.pow(u / 0.82, 1.15) : 1 - 0.5 * Math.pow((u - 0.82) / 0.18, 1.6);
    const sp = ((u * 5 - v) % 1 + 1) % 1, whorl = Math.exp(-Math.pow(sp - 0.5, 2) * 45);
    r *= 1 + 0.13 * whorl * Math.min(1, u * 4) + 0.02 * Math.sin(th * 18);
    return [r * Math.cos(th), 1.7 * (1 - u), r * Math.sin(th)];
  });
  g.rotateZ(Math.PI / 2); return g;
}
/* 가리비: 물결치는 가장자리, 방사형 골 16개, 가운데가 볼록, 경첩에 귀 두 개. 위·아래 면이 있어 두께가 보인다 */
function clamGeo() {
  const shell = (top) => gridGeo(14, 48, (u, v) => {
    const a = (v - 0.5) * Math.PI * 1.25, rib = 0.5 + 0.5 * Math.cos(a * 16), r = u * (1 + 0.05 * (rib - 0.5) * u * u);
    const dome = 0.32 * Math.sin(Math.PI * Math.min(1, r * 1.05)) * (1 - 0.25 * r);
    const y = top ? dome + 0.05 * rib * r : -0.03 * (1 - r * r);
    return [r * Math.sin(a), y, r * Math.cos(a)];
  });
  return mergeParts([
    { geo: shell(true), color: 0xffffff }, { geo: shell(false), color: 0xffffff },
    { geo: new THREE.BoxGeometry(0.24, 0.06, 0.18), color: 0xffffff, x: -0.3, y: 0.03, z: -0.06 }, { geo: new THREE.BoxGeometry(0.24, 0.06, 0.18), color: 0xffffff, x: 0.3, y: 0.03, z: -0.06 },
  ]);
}
function reserved(x, z) { if (Math.abs(x) < 9.5 && z > -9 && z < 14) return true; if (ctx.W.cfg.dock && x > 3 && x < 9 && z < -6 && z > -22) return true; return false; }

export function makeVegetation(cfg) {
  const W = ctx.W, scene = ctx.scene, pines = [], leafs = [], bushes = [];
  const tryPlace = (rMin, rMax, list, minH, maxH, radius, minUp, cluster, zmin) => {
    const a = rnd(0, Math.PI * 2), r = rMax * Math.sqrt(rnd((rMin * rMin) / (rMax * rMax), 1)), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (reserved(x, z) || (zmin !== undefined && z < zmin)) return; const h = terrainH(x, z, cfg); if (h < minH || h > maxH) return;
    if (cluster && fbm(x * 0.03 + 5, z * 0.03 + 9, 3) < cluster) return;
    if (slopeUp(x, z, cfg) < minUp) return;
    const s = rnd(0.8, 1.6); list.push({ x, y: h - 0.15, z, s, rot: rnd(0, 6.3), tint: tintOf(0, rnd(-0.05, 0.05)) }); W.trees.push([x, z, radius * s]);
  };
  const near = Math.round(cfg.pines * 0.45);
  for (let i = 0; i < near * 5 && pines.length < near; i++) tryPlace(10, 65, pines, 0.3, 60, 0.32, 0.68, cfg.key === 'lake' ? 0.34 : 0.42);
  for (let i = 0; i < cfg.pines * 4 && pines.length < cfg.pines; i++) tryPlace(55, 180, pines, 0.3, 130, 0.32, 0.7, cfg.key === 'lake' ? 0.4 : 0.45);
  for (let i = 0; i < cfg.leafs * 4 && leafs.length < cfg.leafs; i++) tryPlace(10, 85, leafs, 0.3, 60, 0.35, 0.72, 0.36);
  for (let i = 0; i < cfg.bushes * 4 && bushes.length < cfg.bushes; i++) tryPlace(5, 70, bushes, 0.15, 60, 0.45, 0.6, 0, cfg.bushZmin);
  const treeColor = cfg.key === 'snow' ? 0x2f4f46 : 0x2b5a2b, fol = () => tex('foliage', 1, 1, 0.3);
  if (pines.length) scene.add(instanced(pineGeo(treeColor, cfg.snow), swayMat(fol(), 0.012, 1.5), pines, true));
  if (leafs.length) {
    const groups = [[], [], []]; leafs.forEach((t, i) => groups[i % 3].push(t));
    groups.forEach(list => { if (list.length) scene.add(instanced(treeGeo(0x4c8a3a), swayMat(fol(), 0.02, 2.0), list, true)); });
  }
  if (bushes.length) scene.add(instanced(bushGeo(cfg.key === 'beach' ? 0x7a8a4e : 0x3f7a35), swayMat(fol(), 0.03, 0.2), bushes.map(b => Object.assign(b, { s: b.s * 0.6, y: b.y + 0.1 })), true));
  for (let i = 0; i < cfg.palms; i++) { const x = (Math.random() < 0.5 ? -1 : 1) * rnd(5, 42), z = rnd(-2, 34); if (reserved(x, z)) continue; const p = makePalm(); p.position.set(x, terrainH(x, z, cfg) - 0.1, z); scene.add(p); W.trees.push([x, z, 0.35]); }
  for (let i = 0; i < (cfg.rocks || 0); i++) { const a = rnd(0, 6.3), r = rnd(9, 70), x = Math.cos(a) * r, z = Math.sin(a) * r; if (reserved(x, z)) continue; const h = terrainH(x, z, cfg); if (h < 0.05) continue; const s = rnd(0.35, 1.4), rk = makeRock(s, cfg.snow ? 0xa8b3c0 : 0x6f7276); rk.position.set(x, h + s * 0.15, z); scene.add(rk); W.trees.push([x, z, s * 0.9]); }

  /* 낙엽: 활엽수 밑에만 (눈·모래사장 제외) */
  if (leafs.length && !cfg.snow) {
    const lv = [], cols = [0xc8742a, 0x8a5a2e, 0xd6a33a, 0x9a4a22], c = new THREE.Color();
    leafs.forEach(t => { for (let i = 0; i < 7; i++) { const a = rnd(0, 6.3), r = rnd(0.5, 4.5) * t.s, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r; const h = terrainH(x, z, cfg); if (h < WATER_Y + 0.1) continue; c.set(cols[Math.floor(Math.random() * 4)]).multiplyScalar(rnd(0.75, 1.15)); lv.push({ x, y: h + 0.012, z, s: rnd(0.7, 1.2), rot: rnd(0, 6.3), rx: rnd(-0.15, 0.15), tint: [c.r, c.g, c.b] }); } });
    const lg = new THREE.PlaneGeometry(0.14, 0.09); lg.rotateX(-Math.PI / 2);
    if (lv.length) scene.add(instanced(lg, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), lv, false));
  }
  /* 물가: 갈대(호수) + 자갈(호수) + 조개껍데기(모래사장) */
  if (cfg.water) {
    if (cfg.key === 'lake') {
      const reeds = [];
      for (let t = 0; t < 1100 && reeds.length < 520; t++) {
        const x = rnd(-110, 110); if (cfg.dock && x > 2 && x < 9.5) continue;
        const z = cfg.water.z + shoreOff(x, cfg) - 2.3 + rnd(-1.6, 1.4);
        const h = terrainH(x, z, cfg); if (h < WATER_Y - 0.4 || h > WATER_Y + 0.15) continue;
        if (fbm(x * 0.05 + 21, z * 0.05 + 8, 3) < 0.5) continue;
        reeds.push({ x, y: h - 0.05, z, s: rnd(0.8, 1.3), sy: rnd(0.9, 1.4), rot: rnd(0, 6.3), tint: tintOf(0, rnd(-0.04, 0.06)) });
      }
      if (reeds.length) scene.add(instanced(reedGeo(), swayMat(fol(), 0.05, 0.2), reeds, false));
    }
    if (cfg.key !== 'beach') {
      const pb = [];
      for (let t = 0; t < 1400 && pb.length < 450; t++) {
        const x = rnd(-90, 90); if (cfg.dock && x > 2.5 && x < 9) continue;
        const z = cfg.water.z + shoreOff(x, cfg) - 2.3 + rnd(-1.8, 1.8), h = terrainH(x, z, cfg); if (h < WATER_Y - 0.25) continue;
        const g = rnd(0.55, 0.85); pb.push({ x, y: h + 0.01, z, s: rnd(0.03, 0.08), rot: rnd(0, 6.3), tint: [g, g, g * 0.97] });
      }
      if (pb.length) scene.add(instanced(jitter(new THREE.DodecahedronGeometry(1, 0), 0.5), std(0xffffff, { roughness: 0.85 }), pb, false));
    }
    if (cfg.key === 'beach') {
      const tints = [[0.96, 0.92, 0.82], [0.95, 0.84, 0.8], [0.97, 0.97, 0.94], [0.86, 0.76, 0.62], [0.92, 0.88, 0.9]], conch = [], clam = [];
      for (let t = 0; t < 400 && conch.length + clam.length < 60; t++) {
        const x = rnd(-90, 90); if (cfg.dock && x > 2.5 && x < 9) continue;
        const z = cfg.water.z + shoreOff(x, cfg) + rnd(-1.6, 4.2), h = terrainH(x, z, cfg); if (h < WATER_Y + 0.02) continue;
        const tint = tints[Math.floor(Math.random() * tints.length)];
        if (Math.random() < 0.55) { const s = rnd(0.04, 0.065); clam.push({ x, y: h + s * 0.03, z, s, rot: rnd(0, 6.3), rx: rnd(-0.2, 0.2), tint }); }
        else { const s = rnd(0.045, 0.07); conch.push({ x, y: h + s * rnd(0.55, 0.85), z, s, rot: rnd(0, 6.3), rx: rnd(-0.25, 0.25), tint }); }
      }
      const shellM = smoothM(0xffffff, { roughness: 0.5, side: THREE.DoubleSide });
      if (conch.length) scene.add(instanced(conchGeo(), shellM, conch, false));
      if (clam.length) scene.add(instanced(clamGeo(), shellM, clam, false));
    }
  }

  const gr = cfg.grass; if (!gr) return;
  const list = [], base = new THREE.Color(gr.color), c = new THREE.Color();
  for (let tries = 0; tries < gr.n * 4 && list.length < gr.n; tries++) {
    const a = rnd(0, Math.PI * 2), r = 3.5 + 44 * Math.pow(Math.random(), 0.7), x = Math.cos(a) * r, z = 3 + Math.sin(a) * r;
    if (z < gr.zmin || Math.hypot(x, z) > 48) continue;
    if (campDirt(x, z) > 0.35) continue;
    if (BLOCKS.some(b => x > b.x[0] - 0.2 && x < b.x[1] + 0.2 && z > b.z[0] - 0.2 && z < b.z[1] + 0.2)) continue;
    if (cfg.dock && x > 4.6 && x < 6.8 && z < -7.5) continue;
    const cl = fbm(x * 0.11 + 3, z * 0.11 + 8, 3); if (cl < 0.42 && Math.random() > (cl - 0.25) * 2) continue;
    const h = terrainH(x, z, cfg); if (h < WATER_Y + 0.3 && cfg.water) continue;
    c.copy(base).multiplyScalar(rnd(0.7, 1.25)); list.push({ x, y: h - 0.02, z, s: rnd(0.6, 1.4), sy: rnd(0.8, 1.3), rot: rnd(0, 6.3), tint: [c.r, c.g, c.b] });
  }
  const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  gm.onBeforeCompile = sh => {
    sh.uniforms.uTime = W.uTime; sh.uniforms.uSunV = W.uSunV; sh.uniforms.uLeafCol = W.uLeafCol; sh.uniforms.uGroundCol = { value: new THREE.Color(cfg.ground).multiplyScalar(0.85) };
    sh.vertexShader = 'uniform float uTime;varying float vGH;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vGH=position.y/0.5;
    vec3 ip=instanceMatrix[3].xyz;float gust=0.6+0.4*sin(uTime*0.35+ip.x*0.05+ip.z*0.08);float sw=(sin(uTime*1.7+ip.x*0.7+ip.z*0.5)+0.5*sin(uTime*3.4+ip.x*1.3+ip.z*0.4))*gust;float k=transformed.y*transformed.y*4.0;transformed.x+=sw*0.1*k;transformed.z+=sw*0.05*k;`);
    sh.fragmentShader = 'uniform vec3 uSunV,uLeafCol,uGroundCol;varying float vGH;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb=mix(uGroundCol,diffuseColor.rgb,smoothstep(0.0,0.5,vGH));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 Vd=normalize(vViewPosition);float back=pow(max(dot(-Vd,uSunV),0.0),3.0);totalEmissiveRadiance+=diffuseColor.rgb*uLeafCol*back*0.8*smoothstep(0.2,0.9,vGH); }`);
  };
  scene.add(instanced(grassGeo(), gm, list, false));
}
