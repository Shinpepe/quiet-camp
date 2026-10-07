import * as THREE from 'three';
import { ctx } from './state.js';
import { rnd, smoothM, shadowed, bar } from './util.js';
import { terrainH, WATER_Y } from './terrain.js';
import { tex } from './textures.js';
import { makeLantern } from './props.js';

/* ── 부두 ──
   판자 아래에 들보 두 줄과 가로대, 기둥 사이에 X자 버팀목 → 옆에서 봐도 떠 보이지 않는다.
   판자는 짙은 나무색으로, 길이·색·높이·기울기를 조금씩 다르게, 양끝 들보 위에 못 자국.
   기둥은 물 높이에 젖은 띠, 둘레에 잔물결 고리(fish.js 가 일렁이게 한다).
   난간은 없애 앉아서 던질 때 시야를 트고, 랜턴은 물가 쪽 첫 기둥 위로. 물가에는 디딤판.
   끝자락: 미끼 통·태클 상자.
   DOCK 은 fish.js·scene.js·data.js(SEAT.dock)와 맞춘다 */
export const DOCK = { x: 5.7, top: 0.36, z0: -8.2, z1: -19.2, half: 0.78 };

export function makeDock() {
  const W = ctx.W, cfg = W.cfg, g = new THREE.Group(), X = DOCK.x, TOP = DOCK.top;
  const beam = smoothM(0x4a3520, Object.assign({ roughness: 0.9 }, tex('wood', 1, 4, 0.3)));
  const post = smoothM(0x4f3a28, Object.assign({ roughness: 0.9 }, tex('bark', 1, 2, 0.4)));
  const wet = smoothM(0x2f3426, { roughness: 1 }), nailM = smoothM(0x2a2622, { metalness: 0.6, roughness: 0.4 });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };

  /* 기둥: 2.4m 간격, 물속 2m 까지 */
  const zs = []; for (let z = DOCK.z0 - 0.4; z > DOCK.z1 + 0.1; z -= 2.4) zs.push(z); zs.push(DOCK.z1 + 0.12);
  W.dockRings = [];
  zs.forEach(z => [-0.7, 0.7].forEach(dx => {
    g.add(bar([X + dx, -2.2, z], [X + dx, TOP - 0.08, z], 0.075, post, 10));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.081, 0.081, 0.28, 10), wet); band.position.set(X + dx, WATER_Y - 0.02, z); g.add(band);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(X + dx, WATER_Y + 0.02, z); ring.userData.noAO = true; ring.userData.noRefl = true; g.add(ring); W.dockRings.push(ring);
  }));
  /* X자 버팀목 (양옆), 기둥 위 가로대, 판자 아래 들보 두 줄 */
  for (let i = 0; i < zs.length - 1; i++) [-0.7, 0.7].forEach(dx => {
    g.add(bar([X + dx, TOP - 0.18, zs[i]], [X + dx, -0.8, zs[i + 1]], 0.025, beam, 6));
    g.add(bar([X + dx, -0.8, zs[i]], [X + dx, TOP - 0.18, zs[i + 1]], 0.025, beam, 6));
  });
  zs.forEach(z => box(1.5, 0.1, 0.12, beam, X, TOP - 0.14, z));
  [-0.56, 0.56].forEach(dx => box(0.1, 0.12, DOCK.z0 - DOCK.z1 + 0.3, beam, X + dx, TOP - 0.09, (DOCK.z0 + DOCK.z1) / 2));

  /* 판자: 인스턴스 하나로 (길이·색·높이·기울기만 조금씩 다르게). 색은 짙은 갈색 (밝기 0.24~0.32). 못 자국도 인스턴스 */
  const plankM = smoothM(0xffffff, Object.assign({ roughness: 0.85 }, tex('wood', 3, 0.6, 0.35)));
  const planks = [];
  for (let z = DOCK.z0 - 0.1; z > DOCK.z1; z -= 0.205) planks.push(z);
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.045, 0.18), plankM, planks.length), nm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.004, 0.012), nailM, planks.length * 4);
  const d = new THREE.Object3D(), c = new THREE.Color();
  planks.forEach((z, i) => {
    d.position.set(X + rnd(-0.03, 0.03), TOP - 0.022 + rnd(-0.004, 0.004), z); d.rotation.set(rnd(-0.008, 0.008), rnd(-0.01, 0.01), rnd(-0.012, 0.012)); d.scale.set(1.56 + rnd(-0.05, 0.05), 1, 1); d.updateMatrix();
    pm.setMatrixAt(i, d.matrix); pm.setColorAt(i, c.setHSL(0.07, rnd(0.3, 0.42), rnd(0.24, 0.32)));
    let k = 0; [-0.56, 0.56].forEach(dx => [-0.04, 0.04].forEach(dz => { d.position.set(X + dx, TOP + 0.001, z + dz); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); nm.setMatrixAt(i * 4 + k++, d.matrix); }));
  });
  g.add(pm, nm);

  /* 물가 디딤판: 판자와 같은 짙은 나무색 (인스턴스 색이 곱해지지 않으므로 재질 색으로 맞춘다) */
  const sy = terrainH(X, DOCK.z0 + 0.25, cfg);
  const step = box(1.4, 0.08, 0.5, smoothM(0x4e3622, Object.assign({ roughness: 0.9 }, tex('wood', 3, 0.6, 0.35))), X, sy + 0.03, DOCK.z0 + 0.25); step.rotation.x = -0.08;

  /* 랜턴 기둥: 물가 쪽 첫 부두 기둥 위로 이어 올린다 (밤에 길을 밝힌다). main.js 가 W.dockLight·W.dockLampObj 를 시간대에 맞춰 켠다 */
  const lx = X + 0.7, lz = zs[0];
  g.add(bar([lx, TOP - 0.1, lz], [lx, 1.5, lz], 0.045, post, 8));
  const lamp = makeLantern(W.tm.lantern > 0.5); lamp.scale.setScalar(0.8); lamp.position.set(lx, 1.52, lz); g.add(lamp); W.dockLampObj = lamp;
  W.dockLight = new THREE.PointLight(0xffc07a, W.tm.lantern * 0.8, 8, 2); W.dockLight.position.set(lx, 1.65, lz); g.add(W.dockLight);

  /* 끝자락 소품: 미끼 통 · 태클 상자 */
  const tz = DOCK.z1 + 0.6;
  const bucket = new THREE.Group();
  const bw = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.22, 18, 1, true), smoothM(0x6f8d9e, { side: THREE.DoubleSide, metalness: 0.3, roughness: 0.5 })); bw.position.y = 0.11; bucket.add(bw);
  const bb = new THREE.Mesh(new THREE.CircleGeometry(0.1, 18), smoothM(0x3a3a34)); bb.rotation.x = -Math.PI / 2; bb.position.y = 0.15; bucket.add(bb);
  const bh = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.004, 6, 20, Math.PI), smoothM(0x888888, { metalness: 0.8 })); bh.position.y = 0.22; bh.rotation.y = 0.5; bucket.add(bh);
  bucket.position.set(X + 0.52, TOP, tz); g.add(bucket);
  const tackle = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.2), smoothM(0x3f6a4a, { roughness: 0.5 })); tb.position.y = 0.07; tackle.add(tb);
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.03, 0.21), smoothM(0x35593e, { roughness: 0.5 })); tl.position.y = 0.155; tackle.add(tl);
  const lt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.01), smoothM(0xc0c0c0, { metalness: 0.8 })); lt.position.set(0, 0.14, 0.105); tackle.add(lt);
  tackle.position.set(X - 0.5, TOP, tz + 0.15); tackle.rotation.y = 0.3; g.add(tackle);

  shadowed(g);
  W.dockRings.forEach(r => { r.castShadow = false; r.receiveShadow = false; });
  return g;
}