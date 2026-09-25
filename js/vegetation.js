import * as THREE from 'three';
import { ctx } from './state.js';
import { BLOCKS } from './data.js';
import { rnd, fbm, std, smoothM, shadowed, bar, jitter, mergeParts, tintOf } from './util.js';
import { terrainH, slopeUp } from './terrain.js';

export function swayMat(extra, strength, from) {
  const mat = new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.95 }, extra || {}));
  mat.onBeforeCompile = sh => { sh.uniforms.uTime = ctx.W.uTime; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
    vec3 ip=instanceMatrix[3].xyz;float hh=max(transformed.y-${from.toFixed(2)},0.0);float sw=(sin(uTime*0.9+ip.x*0.25+ip.z*0.2)+0.5*sin(uTime*2.3+ip.x*0.9))*${strength.toFixed(4)}*hh;transformed.x+=sw;transformed.z+=sw*0.6;
    #endif`); };
  return mat;
}
export function instanced(geo, mat, list, cast) {
  const im = new THREE.InstancedMesh(geo, mat, list.length), d = new THREE.Object3D(), c = new THREE.Color();
  list.forEach((t, i) => { d.position.set(t.x, t.y, t.z); d.rotation.set(0, t.rot || 0, 0); d.scale.set(t.s, t.s * (t.sy || 1), t.s); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, c.setRGB(t.tint[0], t.tint[1], t.tint[2])); });
  im.castShadow = !!cast; im.receiveShadow = true; im.frustumCulled = false; return im;
}
function pineGeo(color, snowy) {
  const parts = [{ geo: new THREE.CylinderGeometry(0.16, 0.26, 1.8, 6), color: 0x4a3325, y: 0.9 }];
  [[1.45, 2.8, 2.3], [1.15, 2.6, 3.4], [0.85, 2.3, 4.5], [0.5, 2.0, 5.5]].forEach(([r, h, y], i) => {
    parts.push({ geo: jitter(new THREE.ConeGeometry(r, h, 8), 0.28), color: new THREE.Color(color).multiplyScalar(1 + i * 0.07).getHex(), y, grad: true });
    if (snowy) parts.push({ geo: jitter(new THREE.ConeGeometry(r * 0.78, h * 0.42, 8), 0.28), color: 0xf3f6fb, y: y + h * 0.3 });
  });
  return mergeParts(parts);
}
function leafGeo(color) {
  const parts = [{ geo: new THREE.CylinderGeometry(0.14, 0.24, 2.4, 6), color: 0x5a4030, y: 1.2 }];
  [[1.5, 3.3, 0, 0], [1.1, 3.9, 0.8, 0.3], [1.0, 3.7, -0.7, -0.4], [0.9, 4.4, 0.1, 0.5]].forEach(([r, y, x, z], i) => parts.push({ geo: jitter(new THREE.IcosahedronGeometry(r, 1), 0.3), color: new THREE.Color(color).multiplyScalar(0.9 + i * 0.08).getHex(), y, x, z, sy: 0.85, grad: true }));
  return mergeParts(parts);
}
function bushGeo(color) { return mergeParts([{ geo: jitter(new THREE.IcosahedronGeometry(1, 1), 0.35), color, y: 0.6, sy: 0.7, grad: true }, { geo: jitter(new THREE.IcosahedronGeometry(0.7, 1), 0.35), color, y: 0.7, x: 0.7, z: 0.3, sy: 0.7, grad: true }]); }
function grassGeo() {
  const blade = () => { const g = new THREE.PlaneGeometry(0.09, 0.5, 1, 3); g.translate(0, 0.25, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 0.5; p.setX(i, p.getX(i) * (1 - t * 0.85)); p.setZ(i, t * t * 0.16); } return g; };
  return mergeParts([{ geo: blade(), color: 0xffffff, grad: true }, { geo: blade(), color: 0xffffff, ry: Math.PI / 2, grad: true }]);
}
function makePalm() {
  const g = new THREE.Group(), bark = smoothM(0x8a6b48, { roughness: 0.95 }), leaf = smoothM(0x3f8a3a, { roughness: 0.85, side: THREE.DoubleSide });
  const H = rnd(5.5, 8), bend = rnd(0.8, 1.8), dir = rnd(0, Math.PI * 2), N = 8; let prev = [0, 0, 0];
  for (let i = 1; i <= N; i++) { const t = i / N, x = Math.cos(dir) * bend * t * t, z = Math.sin(dir) * bend * t * t, y = H * t; g.add(bar(prev, [x, y, z], 0.17 - t * 0.07, bark, 7)); prev = [x, y, z]; }
  const top = new THREE.Vector3(...prev);
  const frond = () => { const fg = new THREE.PlaneGeometry(0.55, 2.8, 1, 8); const p = fg.attributes.position; for (let i = 0; i < p.count; i++) { const t = (p.getY(i) + 1.4) / 2.8; p.setX(i, p.getX(i) * (1 - t * 0.85) * (t < 0.08 ? t * 12 : 1)); p.setY(i, t * 2.8); p.setZ(i, t * t * 1.6); } fg.computeVertexNormals(); return fg; };
  const nF = 9; for (let i = 0; i < nF; i++) { const f = new THREE.Mesh(frond(), leaf); f.rotation.order = 'YXZ'; f.rotation.y = i / nF * Math.PI * 2 + rnd(-0.2, 0.2); f.rotation.x = rnd(0.85, 1.25); f.position.copy(top); f.scale.setScalar(rnd(0.85, 1.15)); g.add(f); }
  for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), smoothM(0x6b5a30)); c.position.copy(top).add(new THREE.Vector3(rnd(-0.2, 0.2), -0.18, rnd(-0.2, 0.2))); g.add(c); }
  return shadowed(g);
}
function makeRock(s, color) { const r = new THREE.Mesh(jitter(new THREE.DodecahedronGeometry(s, 1), 0.4), std(color)); r.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3)); return shadowed(r); }
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
  for (let i = 0; i < cfg.leafs * 4 && leafs.length < cfg.leafs; i++) tryPlace(10, 85, leafs, 0.3, 60, 0.3, 0.72, 0.36);
  for (let i = 0; i < cfg.bushes * 4 && bushes.length < cfg.bushes; i++) tryPlace(5, 70, bushes, 0.15, 60, 0.45, 0.6, 0, cfg.bushZmin);
  const treeColor = cfg.key === 'snow' ? 0x2f4f46 : 0x2b5a2b;
  if (pines.length) scene.add(instanced(pineGeo(treeColor, cfg.snow), swayMat({}, 0.012, 1.5), pines, true));
  if (leafs.length) scene.add(instanced(leafGeo(0x4c8a3a), swayMat({}, 0.018, 1.5), leafs, true));
  if (bushes.length) scene.add(instanced(bushGeo(cfg.key === 'beach' ? 0x7a8a4e : 0x3f7a35), swayMat({}, 0.03, 0.2), bushes.map(b => Object.assign(b, { s: b.s * 0.6, y: b.y + 0.1 })), true));
  for (let i = 0; i < cfg.palms; i++) { const x = (Math.random() < 0.5 ? -1 : 1) * rnd(5, 42), z = rnd(-2, 34); if (reserved(x, z)) continue; const p = makePalm(); p.position.set(x, terrainH(x, z, cfg) - 0.1, z); scene.add(p); W.trees.push([x, z, 0.35]); }
  for (let i = 0; i < (cfg.rocks || 0); i++) { const a = rnd(0, 6.3), r = rnd(9, 70), x = Math.cos(a) * r, z = Math.sin(a) * r; if (reserved(x, z)) continue; const h = terrainH(x, z, cfg); if (h < 0.05) continue; const s = rnd(0.35, 1.4), rk = makeRock(s, cfg.snow ? 0xa8b3c0 : 0x6f7276); rk.position.set(x, h + s * 0.15, z); scene.add(rk); W.trees.push([x, z, s * 0.9]); }
  const gr = cfg.grass; if (!gr) return;
  const list = [], base = new THREE.Color(gr.color), c = new THREE.Color();
  for (let tries = 0; tries < gr.n * 4 && list.length < gr.n; tries++) {
    const a = rnd(0, Math.PI * 2), r = 3.5 + 44 * Math.pow(Math.random(), 0.7), x = Math.cos(a) * r, z = 3 + Math.sin(a) * r;
    if (z < gr.zmin || Math.hypot(x, z) > 48) continue;
    if (BLOCKS.some(b => x > b.x[0] - 0.2 && x < b.x[1] + 0.2 && z > b.z[0] - 0.2 && z < b.z[1] + 0.2)) continue;
    if (cfg.dock && x > 4.6 && x < 6.8 && z < -7.5) continue;
    const cl = fbm(x * 0.11 + 3, z * 0.11 + 8, 3); if (cl < 0.42 && Math.random() > (cl - 0.25) * 2) continue;
    const h = terrainH(x, z, cfg); if (h < 0.06 && cfg.water) continue;
    c.copy(base).multiplyScalar(rnd(0.7, 1.25)); list.push({ x, y: h - 0.02, z, s: rnd(0.6, 1.4), sy: rnd(0.8, 1.3), rot: rnd(0, 6.3), tint: [c.r, c.g, c.b] });
  }
  const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  gm.onBeforeCompile = sh => { sh.uniforms.uTime = W.uTime; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vec3 ip=instanceMatrix[3].xyz;float gust=0.6+0.4*sin(uTime*0.35+ip.x*0.05+ip.z*0.08);float sw=(sin(uTime*1.7+ip.x*0.7+ip.z*0.5)+0.5*sin(uTime*3.4+ip.x*1.3+ip.z*0.4))*gust;float k=transformed.y*transformed.y*4.0;transformed.x+=sw*0.1*k;transformed.z+=sw*0.05*k;`); };
  scene.add(instanced(grassGeo(), gm, list, false));
}
