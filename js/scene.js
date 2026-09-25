import * as THREE from 'three';
import { ctx, settings } from './state.js';
import { BG, TIME } from './data.js';
import { rnd, std, shadowed, softTex, cloudTex } from './util.js';
import { makeGround, makeWater, terrainH } from './terrain.js';
import { makeVegetation } from './vegetation.js';
import { makeTent, makeChair, makeTable, makeFire, makeCar, makeProps, makeDock, contactShadow, Particles, wingGeo, birdMat } from './props.js';
import { startCrackle } from './audio.js';

function disposeScene() {
  const scene = ctx.scene; if (!scene) return;
  scene.traverse(o => { if (o === ctx.camera || o.parent === ctx.camera || (o.parent && o.parent.parent === ctx.camera)) return; if (o.geometry && o.geometry !== wingGeo) o.geometry.dispose(); if (o.material && o.material !== birdMat) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose && m.dispose()); });
  if (scene.environment) scene.environment.dispose();
}

export function buildScene(bgKey, timeKey) {
  disposeScene();
  const cfg = BG[bgKey], tm = TIME[timeKey];
  const scene = ctx.scene = new THREE.Scene(); scene.add(ctx.camera);
  const W = ctx.W = { cfg, tm, trees: [], flocks: [], birdT: 5, uTime: { value: 0 }, interact: [], fireLit: timeKey !== 'afternoon', platforms: [] };
  scene.fog = new THREE.Fog(tm.fog, 40, tm.fogFar);
  ctx.renderer.toneMappingExposure = tm.exposure;
  const sunDir = new THREE.Vector3(...tm.sun).normalize();

  /* 하늘 — 색은 Color 가 선형으로 넘겨주고, OutputPass 가 톤매핑·sRGB 처리 */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(tm.top) }, bottom: { value: new THREE.Color(tm.bottom) }, sunDir: { value: sunDir }, sunColor: { value: new THREE.Color(tm.disc) }, glow: { value: tm.glow } },
    vertexShader: 'varying vec3 vP;void main(){vP=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform vec3 top,bottom,sunDir,sunColor;uniform float glow;varying vec3 vP;
      void main(){vec3 d=normalize(vP);float h=d.y;float t=pow(max(h,0.0),0.45);vec3 col=mix(bottom,top,t);
      float s=max(dot(d,sunDir),0.0);col+=sunColor*glow*(pow(s,6.0)*0.35+pow(s,40.0)*0.9)*(1.0-t*0.6);
      col=mix(col,bottom*0.9,smoothstep(0.03,-0.2,h));gl_FragColor=vec4(col,1.0);}`,
    side: THREE.BackSide, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1800, 40, 20), skyMat));

  /* 환경광 (IBL): 하늘을 큐브맵으로 구워 재질 반사·간접광에 사용. 세기는 TIME.ibl */
  try {
    const pm = new THREE.PMREMGenerator(ctx.renderer), envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMat));
    scene.environment = pm.fromScene(envScene, 0.04).texture; scene.environmentIntensity = tm.ibl; pm.dispose();
  } catch (e) { console.warn('IBL skipped', e); }

  const sun = new THREE.DirectionalLight(tm.sunColor, tm.sunI); sun.position.copy(sunDir).multiplyScalar(90); sun.castShadow = settings.shadow;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 260 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(tm.top, cfg.ground, tm.hemi));
  scene.add(new THREE.AmbientLight(0xffffff, tm.amb));
  const disc = new THREE.Mesh(new THREE.SphereGeometry(tm.sunSize * 1.3, 20, 20), new THREE.MeshBasicMaterial({ color: tm.disc, fog: false })); disc.material.color.multiplyScalar(2.5); disc.position.copy(sunDir).multiplyScalar(1500); scene.add(disc);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: tm.disc, transparent: true, opacity: tm.glow * 0.7, blending: THREE.AdditiveBlending, fog: false, depthWrite: false })); glow.position.copy(disc.position); glow.scale.setScalar(tm.sunSize * 13); scene.add(glow);
  if (tm.stars > 0) {
    const n = 2600, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.97), r = 1700; sp[i * 3] = r * Math.sin(ph) * Math.cos(th); sp[i * 3 + 1] = r * Math.cos(ph); sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    W.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: tm.stars, fog: false })); scene.add(W.stars);
  }
  W.clouds = [];
  const nC = timeKey === 'night' ? 6 : 14;
  for (let i = 0; i < nC; i++) { const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: tm.cloud, transparent: true, opacity: tm.cloudOp * rnd(0.6, 1), fog: false, depthWrite: false })); const a = rnd(0, Math.PI * 2), r = rnd(600, 1300); c.position.set(Math.cos(a) * r, rnd(220, 420), Math.sin(a) * r); const s = rnd(260, 520); c.scale.set(s, s * 0.45, 1); scene.add(c); W.clouds.push(c); }

  scene.add(makeGround(cfg));
  if (cfg.water) { W.water = makeWater(cfg.water, tm, W.uTime); scene.add(W.water); }
  makeVegetation(cfg);
  if (cfg.dock) { scene.add(makeDock()); W.platforms.push({ x: [5.0, 6.4], z: [-19.5, -8.0], y: 0.36 }); }
  if (cfg.key === 'beach') for (let i = 0; i < 3; i++) { const x = (Math.random() < 0.5 ? -1 : 1) * rnd(7, 18), z = rnd(-7.5, -3); const d = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, rnd(1.5, 2.6), 6), std(0x9a8a72)); d.position.set(x, terrainH(x, z, cfg) + 0.1, z); d.rotation.set(0.1, rnd(0, 3), Math.PI / 2 - 0.1); shadowed(d); scene.add(d); W.trees.push([x, z, 0.9]); }

  const tent = makeTent(); tent.position.set(-1.6, 0, 1.2); scene.add(tent);
  const chair = makeChair(); chair.position.set(1.5, 0, 0.8); scene.add(chair);
  const table = makeTable(); table.position.set(0.6, 0, 0.5); scene.add(table);
  W.lantern = new THREE.PointLight(0xffc07a, tm.lantern, 12, 2); W.lantern.position.set(0.65, 0.75, 0.5); scene.add(W.lantern);
  const fire = makeFire(); fire.position.set(0.3, 0, -1.4); scene.add(fire);
  const car = makeCar(); car.position.set(0, 0, 8); scene.add(car);
  makeProps();
  contactShadow(-1.6, 1.3, 4.4, 4.8); contactShadow(1.5, 0.8, 1.3, 1.3, 0.7); contactShadow(0.6, 0.5, 1.0, 1.0, 0.6); contactShadow(0, 8.05, 3.4, 6.4); contactShadow(0.3, -1.4, 2.0, 2.0, 0.6); contactShadow(2.4, 0.6, 1.0, 0.9, 0.6); contactShadow(-3.25, 1.4, 0.7, 0.7, 0.5);

  W.steam = new Particles(160, { color: 0xffffff, size: 0.05, opacity: 0.32 }); scene.add(W.steam.mesh);
  W.smoke = new Particles(260, { color: 0xc9c9d2, size: 0.09, opacity: 0.22 }); scene.add(W.smoke.mesh);
  W.fire = new Particles(160, { color: 0xff8c2a, size: 0.2, opacity: 0.5, blending: THREE.AdditiveBlending }); scene.add(W.fire.mesh);
  W.fireCore = new Particles(90, { color: 0xfff2b0, size: 0.11, opacity: 0.75, blending: THREE.AdditiveBlending }); scene.add(W.fireCore.mesh);
  W.embers = new Particles(80, { color: 0xffa040, size: 0.035, opacity: 0.95, blending: THREE.AdditiveBlending }); scene.add(W.embers.mesh);
  if (cfg.snow) {
    const n = 2800, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { sp[i * 3] = rnd(-35, 35); sp[i * 3 + 1] = rnd(0, 30); sp[i * 3 + 2] = rnd(-40, 20); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    W.snow = new THREE.Points(g, new THREE.PointsMaterial({ map: softTex, color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85, depthWrite: false })); W.snow.frustumCulled = false; scene.add(W.snow);
  }
  if (cfg.fireflies && timeKey !== 'afternoon') {
    const n = 70, sp = new Float32Array(n * 3); W.ffBase = [];
    for (let i = 0; i < n; i++) { const b = [rnd(-28, 28), rnd(0.3, 2.6), rnd(-12, 5), rnd(0, 6)]; W.ffBase.push(b); sp[i * 3] = b[0]; sp[i * 3 + 1] = b[1]; sp[i * 3 + 2] = b[2]; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    W.ff = new THREE.Points(g, new THREE.PointsMaterial({ map: softTex, color: 0xd6ff7a, size: 0.14, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); W.ff.frustumCulled = false; scene.add(W.ff);
  }

  W.interact = [
    { id: 'trunk', pos: [0, 1.0, 10.9], r: 2.6, label: () => '트렁크 열기' },
    { id: 'chair', pos: [1.5, 0.6, 0.8], r: 2.2, label: () => '의자에 앉기' },
    { id: 'tent',  pos: [-1.6, 0.7, 0.0], r: 2.3, label: () => '텐트에 들어가기' },
    { id: 'car',   pos: [1.35, 1.0, 8.1], r: 2.0, label: () => '운전석에 앉기' },
    { id: 'fire',  pos: [0.3, 0.4, -1.4], r: 2.4, label: () => W.fireLit ? '모닥불 끄기' : '모닥불 피우기' },
  ];
  if (cfg.dock) W.interact.push({ id: 'dock', pos: [5.7, 0.7, -18.6], r: 2.0, label: () => '부두 끝에 앉기' });
  if (ctx.post) { ctx.post.setScene(scene); ctx.post.setTime(tm); }
  if (W.fireLit) startCrackle();
}
