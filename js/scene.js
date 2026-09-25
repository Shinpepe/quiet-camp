import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { BG } from './data.js';
import { rnd, smooth, std, shadowed, softTex, NOISE_GLSL } from './util.js';
import { makeGround, makeWater, terrainH } from './terrain.js';
import { makeVegetation } from './vegetation.js';
import { makeTent, makeChair, makeTable, makeFire, makeCar, makeProps, makeDock, contactShadow, Particles, birdMat } from './props.js';
import { startCrackle } from './audio.js';
import { paramsAt, sunDirAt } from './time.js';

function disposeScene() {
  const scene = ctx.scene, W = ctx.W; if (!scene) return;
  if (W.envRT) { W.envRT.dispose(); W.envRT = null; }
  if (W.envScene) { W.envScene.children[0].geometry.dispose(); W.envScene = null; }
  scene.traverse(o => { if (o === ctx.camera || o.parent === ctx.camera || (o.parent && o.parent.parent === ctx.camera)) return; if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== birdMat) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose && m.dispose()); });
  scene.environment = null;
}

/* 하늘을 큐브맵으로 구워 환경광으로. 시간이 흐르면 몇 초마다 다시 굽는다. */
export function rebakeEnv() {
  const W = ctx.W; if (!W.skyMat) return;
  try {
    if (!ctx.pmrem) ctx.pmrem = new THREE.PMREMGenerator(ctx.renderer);
    if (!W.envScene) { W.envScene = new THREE.Scene(); W.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), W.skyMat)); }
    const rt = ctx.pmrem.fromScene(W.envScene, 0.04);
    ctx.scene.environment = rt.texture; ctx.scene.environmentIntensity = W.tm.ibl;
    if (W.envRT) W.envRT.dispose();
    W.envRT = rt;
  } catch (e) { console.warn('IBL skipped', e); }
}

/* 현재 시각 파라미터(W.tm)를 씬의 모든 것에 반영 — 매 프레임 호출 */
export function applyTime() {
  const W = ctx.W, cur = W.tm; if (!W.sun) return;
  const sd = sunDirAt(state.clock, W.sunDir), md = sunDirAt(state.clock + 0.5, W.moonDir);
  const up = sd.y > 0.0; W.sunUp = sd.y > 0.02;
  const L = up ? sd : md, fade = smooth(0.0, 0.08, Math.abs(L.y));
  W.sun.position.copy(L).multiplyScalar(90); W.sun.color.copy(cur.sunColor); W.sun.intensity = cur.sunI * fade;
  W.hemi.color.copy(cur.top); W.hemi.intensity = cur.hemi; W.amb.intensity = cur.amb;
  const u = W.skyMat.uniforms;
  u.top.value.copy(cur.top); u.bottom.value.copy(cur.bottom); u.sunDir.value.copy(sd); u.moonDir.value.copy(md); u.sunColor.value.copy(cur.disc);
  u.glow.value = cur.glow * smooth(-0.15, 0.02, sd.y); u.uCover.value = cur.cloudCover; u.cloudLit.value.copy(cur.cloudLit); u.cloudShade.value.copy(cur.cloudShade); u.uMoon.value = cur.stars;
  W.sunDisc.position.copy(sd).multiplyScalar(1500); W.sunDisc.scale.setScalar(cur.sunSize * 1.3); W.sunDisc.material.color.copy(cur.disc).multiplyScalar(2.5); W.sunDisc.visible = sd.y > -0.05;
  W.sunGlow.position.copy(W.sunDisc.position); W.sunGlow.scale.setScalar(cur.sunSize * 13); W.sunGlow.material.color.copy(cur.disc); W.sunGlow.material.opacity = cur.glow * 0.7 * smooth(-0.05, 0.05, sd.y);
  const mk = cur.stars * smooth(-0.05, 0.05, md.y);
  W.moon.position.copy(md).multiplyScalar(1500); W.moon.material.opacity = mk; W.moonGlow.position.copy(W.moon.position); W.moonGlow.material.opacity = mk * 0.45;
  ctx.scene.fog.color.copy(cur.fog); ctx.scene.fog.far = cur.fogFar; ctx.renderer.toneMappingExposure = cur.exposure; ctx.scene.environmentIntensity = cur.ibl;
  if (W.water) { const wu = W.water.material.uniforms, w = W.cfg.water; wu.skyTop.value.copy(cur.top); wu.skyBottom.value.copy(cur.bottom); wu.sunDir.value.copy(L); wu.sunColor.value.copy(cur.sunColor).multiplyScalar(cur.sunI * 0.5 * fade); wu.fogColor.value.copy(cur.fog); wu.fogFar.value = cur.fogFar; wu.deep.value.set(w.deep).multiplyScalar(cur.waterMul); wu.shallow.value.set(w.shallow).multiplyScalar(cur.waterMul); }
  if (ctx.post) ctx.post.setTime(cur);
}

export function buildScene(bgKey) {
  disposeScene();
  const cfg = BG[bgKey], cur = paramsAt(state.clock);
  const scene = ctx.scene = new THREE.Scene(); scene.add(ctx.camera);
  const W = ctx.W = { cfg, tm: cur, trees: [], flocks: [], birdT: 5, uTime: { value: 0 }, interact: [], fireLit: cur.stars > 0.1, lanternLit: cur.lantern > 0.5, tentLampLit: cur.tentLamp > 0.5, platforms: [], envT: 0, envScene: null, envRT: null, wasNight: null, sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), sunUp: true };
  scene.fog = new THREE.Fog(cur.fog, 40, cur.fogFar);
  ctx.renderer.toneMappingExposure = cur.exposure;

  /* 하늘 + 구름층 (노이즈 기반 2.5D 구름, 빛 방향 쪽 두께로 음영) */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, moonDir: { value: new THREE.Vector3(0, -1, 0) }, sunColor: { value: new THREE.Color() }, glow: { value: 0 }, uTime: W.uTime, uCover: { value: 0.5 }, cloudLit: { value: new THREE.Color() }, cloudShade: { value: new THREE.Color() }, uMoon: { value: 0 } },
    vertexShader: 'varying vec3 vP;void main(){vP=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: NOISE_GLSL + `uniform vec3 top,bottom,sunDir,moonDir,sunColor,cloudLit,cloudShade;uniform float glow,uTime,uCover,uMoon;varying vec3 vP;
      float cloudD(vec2 p){float n=vnoise(p)*0.5+vnoise(p*2.1+vec2(3.1,7.3))*0.25+vnoise(p*4.3+vec2(9.7,1.3))*0.125+vnoise(p*8.9+vec2(4.2,5.5))*0.0625;return smoothstep(0.66-uCover*0.4,0.74,n);}
      void main(){vec3 d=normalize(vP);float h=d.y;float t=pow(max(h,0.0),0.45);vec3 col=mix(bottom,top,t);
        float s=max(dot(d,sunDir),0.0);col+=sunColor*glow*(pow(s,6.0)*0.35+pow(s,40.0)*0.9)*(1.0-t*0.6);
        float ms=max(dot(d,moonDir),0.0);col+=vec3(0.5,0.6,0.85)*uMoon*(pow(ms,8.0)*0.12+pow(ms,120.0)*0.4);
        col=mix(col,bottom*0.9,smoothstep(0.03,-0.2,h));
        if(h>0.0){vec2 p=d.xz/(h+0.12)*2.2+vec2(uTime*0.006,uTime*0.0025);float dens=cloudD(p);
          vec3 L=sunDir.y>-0.05?sunDir:moonDir;vec2 ts=(L.xz/(max(L.y,0.05)+0.12))*0.12;float d2=cloudD(p+ts);
          vec3 cc=mix(cloudShade,cloudLit,1.0-0.75*d2);
          col=mix(col,cc,dens*smoothstep(0.0,0.2,h));}
        gl_FragColor=vec4(col,1.0);}`,
    side: THREE.BackSide, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1800, 40, 20), skyMat)); W.skyMat = skyMat;

  /* 빛 */
  W.sun = new THREE.DirectionalLight(0xffffff, 1); W.sun.castShadow = settings.shadow;
  Object.assign(W.sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 260 }); W.sun.shadow.mapSize.set(2048, 2048); W.sun.shadow.bias = -0.0006; W.sun.shadow.normalBias = 0.02;
  scene.add(W.sun, W.sun.target);
  W.hemi = new THREE.HemisphereLight(0xffffff, cfg.ground, 1); scene.add(W.hemi);
  W.amb = new THREE.AmbientLight(0xffffff, 1); scene.add(W.amb);
  W.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })); scene.add(W.sunDisc);
  W.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, fog: false, depthWrite: false })); scene.add(W.sunGlow);
  W.moon = new THREE.Mesh(new THREE.SphereGeometry(11, 20, 20), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, transparent: true, opacity: 0, fog: false })); scene.add(W.moon);
  W.moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x9fb0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, fog: false, depthWrite: false })); W.moonGlow.scale.setScalar(120); scene.add(W.moonGlow);
  { const n = 2600, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.97), r = 1700; sp[i * 3] = r * Math.sin(ph) * Math.cos(th); sp[i * 3 + 1] = r * Math.cos(ph); sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    W.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false })); scene.add(W.stars); }

  scene.add(makeGround(cfg));
  if (cfg.water) { W.water = makeWater(cfg.water, cur, W.uTime); scene.add(W.water); }
  makeVegetation(cfg);
  if (cfg.dock) { scene.add(makeDock()); W.platforms.push({ x: [5.0, 6.4], z: [-19.5, -8.0], y: 0.36 }); }
  if (cfg.key === 'beach') for (let i = 0; i < 3; i++) { const x = (Math.random() < 0.5 ? -1 : 1) * rnd(7, 18), z = rnd(-7.5, -3); const d = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, rnd(1.5, 2.6), 6), std(0x9a8a72)); d.position.set(x, terrainH(x, z, cfg) + 0.1, z); d.rotation.set(0.1, rnd(0, 3), Math.PI / 2 - 0.1); shadowed(d); scene.add(d); W.trees.push([x, z, 0.9]); }

  const tent = makeTent(); tent.position.set(-1.6, 0, 1.2); scene.add(tent);
  const chair = makeChair(); chair.position.set(1.5, 0, 0.8); scene.add(chair);
  const table = makeTable(); table.position.set(0.6, 0, 0.5); scene.add(table);
  W.lantern = new THREE.PointLight(0xffc07a, W.lanternLit ? cur.lantern : 0, 12, 2); W.lantern.position.set(0.65, 0.75, 0.5); scene.add(W.lantern);
  const fire = makeFire(); fire.position.set(0.3, 0, -1.4); scene.add(fire);
  const car = makeCar(); car.position.set(0, 0, 8); scene.add(car);
  makeProps();
  contactShadow(-1.6, 1.3, 4.4, 4.8); contactShadow(1.5, 0.8, 1.3, 1.3, 0.7); contactShadow(0.6, 0.5, 1.0, 1.0, 0.6); contactShadow(0, 8.05, 3.4, 6.4); contactShadow(0.3, -1.4, 2.0, 2.0, 0.6); contactShadow(2.4, 0.6, 1.0, 0.9, 0.6); contactShadow(2.95, 0.3, 0.7, 0.7, 0.5);

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
  if (cfg.fireflies) {
    const n = 70, sp = new Float32Array(n * 3); W.ffBase = [];
    for (let i = 0; i < n; i++) { const b = [rnd(-28, 28), rnd(0.3, 2.6), rnd(-12, 5), rnd(0, 6)]; W.ffBase.push(b); sp[i * 3] = b[0]; sp[i * 3 + 1] = b[1]; sp[i * 3 + 2] = b[2]; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    W.ff = new THREE.Points(g, new THREE.PointsMaterial({ map: softTex, color: 0xd6ff7a, size: 0.14, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); W.ff.frustumCulled = false; scene.add(W.ff);
  }

  W.interact = [
    { id: 'trunk',   pos: [0, 1.0, 10.9],     r: 2.6, label: () => '트렁크 열기' },
    { id: 'chair',   pos: [1.5, 0.6, 0.8],    r: 2.2, label: () => '의자에 앉기' },
    { id: 'tent',    pos: [-1.6, 0.7, 0.0],   r: 2.3, label: () => '텐트에 들어가기' },
    { id: 'car',     pos: [1.35, 1.0, 8.1],   r: 2.0, label: () => '운전석에 앉기' },
    { id: 'fire',    pos: [0.3, 0.4, -1.4],   r: 2.4, label: () => W.fireLit ? '모닥불 끄기' : '모닥불 피우기' },
    { id: 'lantern', pos: [0.65, 0.6, 0.5],   r: 1.6, label: () => W.lanternLit ? '랜턴 끄기' : '랜턴 켜기' },
  ];
  if (cfg.dock) W.interact.push({ id: 'dock', pos: [5.7, 0.7, -18.6], r: 2.0, label: () => '부두 끝에 앉기' });
  if (ctx.post) ctx.post.setScene(scene);
  applyTime(); rebakeEnv();
  if (W.fireLit) startCrackle();
}
