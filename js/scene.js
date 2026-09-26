import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { BG } from './data.js';
import { rnd, smooth, std, shadowed, softTex, canvasTex, NOISE_GLSL, SKY_GLSL, FOG } from './util.js';
import { makeGround, makeWater, terrainH, bakeHeightMap, bakeShoreTex, waterEdge } from './terrain.js';
import { makeVegetation } from './vegetation.js';
import { makeTent, makeChair, makeTable, makeFire, makeCar, makeProps, makeDock, makeSnowCaps, contactShadow, Particles, Smoke, birdMat } from './props.js';
import { startCrackle } from './audio.js';
import { paramsAt, sunDirAt } from './time.js';

const streakTex = canvasTex(128, 16, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const v = g.createLinearGradient(0, 0, 0, h); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = v; g.fillRect(0, 0, w, h);
});
const _fc = new THREE.Color(), _ag = new THREE.Color(0x2fae70);

/* 장소를 바꿀 때 이전 씬의 GPU 자원을 모두 놓는다.
   재질만 dispose 하면 재질에 딸린 텍스처(tex() 가 재질마다 clone 한 것, 물의 ripple)가 남아 장소를 바꿀수록 메모리가 는다.
   공유 텍스처(softTex 등)도 함께 dispose 되지만 three 가 다음 사용 때 다시 올리므로 문제없다. */
function disposeScene() {
  const scene = ctx.scene, W = ctx.W; if (!scene) return;
  if (W.envRT) { W.envRT.dispose(); W.envRT = null; }
  if (W.envScene) { W.envScene.children[0].geometry.dispose(); W.envScene = null; }
  if (W.heightTex) { W.heightTex.dispose(); W.heightTex = null; }
  if (W.shoreTex) { W.shoreTex.dispose(); W.shoreTex = null; }
  scene.traverse(o => {
    if (o === ctx.camera || o.parent === ctx.camera || (o.parent && o.parent.parent === ctx.camera)) return;
    if (o.geometry) o.geometry.dispose();
    if (o.material && o.material !== birdMat) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (!m) return;
      ['map', 'normalMap', 'roughnessMap'].forEach(k => { if (m[k]) m[k].dispose(); });
      if (m.uniforms && m.uniforms.uRipple && m.uniforms.uRipple.value) m.uniforms.uRipple.value.dispose();
      if (m.dispose) m.dispose();
    });
  });
  scene.environment = null;
}

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

/* ── 오로라: 씬을 만들 때마다 커튼 2~4장을 무작위로. 한 장은 항상 정면에 ── */
function makeAurora(W, scene) {
  const base = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: W.uTime, uStr: { value: 0 }, uSeed: { value: 0 }, uSpd: { value: 1 }, uFold: { value: 5 }, cA: { value: new THREE.Color() }, cB: { value: new THREE.Color() } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: NOISE_GLSL + `uniform float uTime,uStr,uSeed,uSpd,uFold;uniform vec3 cA,cB;varying vec2 vUv;
      void main(){float t=uTime*0.05*uSpd+uSeed;float x=clamp(vUv.x,0.0,1.0),y=clamp(vUv.y,0.0,1.0);
        float f=vnoise(vec2(x*uFold+t,0.3+uSeed))*0.55+vnoise(vec2(x*uFold*2.6-t*1.6,1.7))*0.3+vnoise(vec2(x*uFold*5.8+t*2.4,3.1))*0.15;
        float band=smoothstep(0.32,0.72,f);
        float vert=smoothstep(0.0,0.1,y)*pow(max(1.0-y,0.0),1.5);
        float rays=0.65+0.35*vnoise(vec2(x*70.0+t*2.0,y*1.5));
        float ends=smoothstep(0.0,0.1,x)*smoothstep(1.0,0.9,x);
        float a=clamp(band*vert*rays*ends*uStr,0.0,1.0);
        vec3 col=mix(cA,cB,smoothstep(0.1,0.85,y));
        gl_FragColor=vec4(col*a,a);}`,
  });
  W.aurora = [];
  const palettes = [[0x36e08a, 0x7a3cff], [0x2fd67c, 0xd04cff], [0x4af0a0, 0x3c7cff], [0x6ee89a, 0xff4c8a]];
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const span = rnd(1.6, 2.6);
    const az0 = i === 0 ? -Math.PI / 2 - span * rnd(0.35, 0.65) : rnd(-Math.PI, Math.PI);
    const R = rnd(1400, 1700), y0 = rnd(600, 1000), H = rnd(500, 850), w1 = rnd(60, 160), w2 = rnd(20, 70), f1 = rnd(3, 8), f2 = rnd(8, 16), ph = rnd(0, 6.3);
    const g = new THREE.PlaneGeometry(1, 1, 128, 12), p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const u = p.getX(k) + 0.5, v = p.getY(k) + 0.5, az = az0 + u * span;
      const y = y0 + Math.sin(u * f1 + ph) * w1 + Math.sin(u * f2 + ph * 2) * w2 + v * H;
      const r = R + Math.sin(u * f2 * 0.7 + ph) * 40;
      p.setXYZ(k, Math.cos(az) * r, y, Math.sin(az) * r);
    }
    g.computeVertexNormals();
    const m = base.clone(); m.uniforms.uTime = W.uTime;
    const pal = palettes[Math.floor(Math.random() * palettes.length)];
    m.uniforms.cA.value.setHex(pal[0]); m.uniforms.cB.value.setHex(pal[1]);
    m.uniforms.uSeed.value = rnd(0, 50); m.uniforms.uSpd.value = rnd(0.6, 1.5); m.uniforms.uFold.value = rnd(3.5, 7);
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.userData.noAO = true; scene.add(mesh); W.aurora.push(mesh);
  }
}

/* 현재 시각 파라미터(W.tm)를 씬의 모든 것에 반영 — 매 프레임 호출 */
export function applyTime() {
  const W = ctx.W, cur = W.tm; if (!W.sun) return;
  const sd = sunDirAt(state.clock, W.sunDir), md = sunDirAt(state.clock + 0.5, W.moonDir);
  const up = sd.y > 0.0; W.sunUp = sd.y > 0.02;
  const L = up ? sd : md, fade = smooth(0.0, 0.08, Math.abs(L.y));
  const tgt = W.sun.target.position; tgt.set(Math.round(ctx.camera.position.x / 2) * 2, 0, Math.round(ctx.camera.position.z / 2) * 2);
  W.sun.position.copy(L).multiplyScalar(90).add(tgt); W.sun.color.copy(cur.sunColor); W.sun.intensity = cur.sunI * fade;
  W.hemi.color.copy(cur.top); W.hemi.intensity = cur.hemi; W.amb.intensity = cur.amb;
  if (W.aurora) {
    const ak = cur.stars * smooth(0.5, 0.9, cur.stars) * (0.55 + 0.45 * Math.sin(W.uTime.value * 0.31));
    W.aurora.forEach(m => { m.material.uniforms.uStr.value = ak * 1.1; m.visible = ak > 0.01; });
    if (ak > 0) W.hemi.color.lerp(_ag, 0.3 * ak);
  }
  const glow = cur.glow * smooth(-0.15, 0.02, sd.y);
  const u = W.skyMat.uniforms;
  u.top.value.copy(cur.top); u.bottom.value.copy(cur.bottom); u.sunDir.value.copy(sd); u.moonDir.value.copy(md); u.sunColor.value.copy(cur.disc);
  u.glow.value = glow; u.uCover.value = cur.cloudCover; u.cloudLit.value.copy(cur.cloudLit); u.cloudShade.value.copy(cur.cloudShade); u.uMoon.value = cur.stars;
  W.sunDisc.position.copy(sd).multiplyScalar(1500); W.sunDisc.scale.setScalar(cur.sunSize * 1.3); W.sunDisc.material.color.copy(cur.disc).multiplyScalar(2.5); W.sunDisc.visible = sd.y > -0.05;
  W.sunGlow.position.copy(W.sunDisc.position); W.sunGlow.scale.setScalar(cur.sunSize * 13); W.sunGlow.material.color.copy(cur.disc); W.sunGlow.material.opacity = cur.glow * 0.7 * smooth(-0.05, 0.05, sd.y);
  const mk = cur.stars * smooth(-0.05, 0.05, md.y);
  W.moon.position.copy(md).multiplyScalar(1500); W.moon.material.opacity = mk; W.moonGlow.position.copy(W.moon.position); W.moonGlow.material.opacity = mk * 0.45;
  ctx.scene.fog.color.copy(cur.fog); ctx.scene.fog.far = cur.fogFar; ctx.renderer.toneMappingExposure = cur.exposure; ctx.scene.environmentIntensity = cur.ibl;
  FOG[0] = L.x; FOG[1] = L.y; FOG[2] = L.z; FOG[3] = cur.insc * fade;
  FOG[4] = 2.3 / cur.fogFar; FOG[5] = 1 / cur.fogH; FOG[6] = -3; FOG[7] = 0;
  _fc.copy(cur.disc).multiplyScalar(up ? 1.0 : 0.45); FOG[8] = _fc.r; FOG[9] = _fc.g; FOG[10] = _fc.b; FOG[11] = 0;
  ctx.camera.matrixWorldInverse.copy(ctx.camera.matrixWorld).invert();
  W.uSunV.value.copy(L).transformDirection(ctx.camera.matrixWorldInverse);
  W.uLeafCol.value.copy(cur.sunColor).multiplyScalar(cur.sunI * fade * 0.2);
  if (W.water) {
    const wu = W.water.material.uniforms, w = W.cfg.water;
    wu.skyTop.value.copy(cur.top); wu.skyBottom.value.copy(cur.bottom); wu.sunDir.value.copy(L); wu.sunColor.value.copy(cur.sunColor).multiplyScalar(cur.sunI * 0.5 * fade);
    wu.uSunD.value.copy(sd); wu.moonDir.value.copy(md); wu.disc.value.copy(cur.disc); wu.cloudLit.value.copy(cur.cloudLit); wu.cloudShade.value.copy(cur.cloudShade); wu.glow.value = glow; wu.uMoon.value = cur.stars; wu.uCover.value = cur.cloudCover;
    wu.fogColor.value.copy(cur.fog); wu.deep.value.set(w.deep).multiplyScalar(cur.waterMul); wu.shallow.value.set(w.shallow).multiplyScalar(cur.waterMul);
  }
  const gs = W.groundMat && W.groundMat.userData.shader;
  if (gs) { gs.uniforms.uCaust.value = 0.35 * cur.sunI * fade * (up ? 1 : 0.25); gs.uniforms.uSpark.value = W.cfg.snow ? 0.5 * cur.sunI * fade : 0; }
  if (ctx.post) ctx.post.setTime(cur);
}

/* ── 별똥별 ── */
const _r = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Matrix4();
function spawnMeteor(m) {
  const az = rnd(0, Math.PI * 2), el = rnd(0.3, 1.22);
  _r.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  m.head.copy(_r).multiplyScalar(1650);
  _x.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)); m.dir.crossVectors(_r, _x).normalize();
  if (m.dir.y > 0) m.dir.multiplyScalar(-1);
  if (m.dir.y > -0.3) { m.dir.y -= 0.5; m.dir.normalize(); }
  m.speed = rnd(320, 520); m.life = rnd(1.2, 2.4); m.t = 0; m.len = rnd(90, 200); m.width = rnd(2.4, 4.5);
  m.mesh.material.color.setHex(Math.random() < 0.3 ? 0xd8e6ff : 0xf4f6ff); m.mesh.visible = true;
}
export function updateMeteors(dt) {
  const W = ctx.W; if (!W.meteors) return;
  const night = W.tm.stars > 0.5 && !W.sunUp;
  if (night && !ctx.paused) {
    W.meteorT -= dt;
    if (W.meteorT <= 0) {
      const free = W.meteors.find(m => m.life <= 0); if (free) spawnMeteor(free);
      W.meteorT = Math.random() < 0.25 ? rnd(0.4, 1.6) : rnd(7, 22);
    }
  }
  W.meteors.forEach(m => {
    if (m.life <= 0) return;
    m.t += dt; if (m.t >= m.life) { m.life = 0; m.mesh.visible = false; return; }
    m.head.addScaledVector(m.dir, m.speed * dt);
    _p.copy(m.head).addScaledVector(m.dir, -m.len * 0.5); m.mesh.position.copy(_p);
    _z.copy(ctx.camera.position).sub(_p).normalize(); _y.crossVectors(_z, m.dir).normalize(); _x.crossVectors(_y, _z).normalize();
    m.mesh.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    const k = m.t / m.life; m.mesh.material.opacity = Math.pow(Math.sin(Math.PI * k), 0.6) * 0.95 * W.tm.stars; m.mesh.scale.set(m.len, m.width, 1);
  });
}

export function buildScene(bgKey) {
  disposeScene();
  const cfg = BG[bgKey], cur = paramsAt(state.clock);
  const scene = ctx.scene = new THREE.Scene(); scene.add(ctx.camera);
  const W = ctx.W = { cfg, tm: cur, trees: [], flocks: [], birdT: 5, uTime: { value: 0 }, uSunV: { value: new THREE.Vector3(0, 1, 0) }, uLeafCol: { value: new THREE.Color(0, 0, 0) }, interact: [], fireLit: cur.stars > 0.1, lanternLit: cur.lantern > 0.5, tentLampLit: cur.tentLamp > 0.5, platforms: [], envT: 0, envScene: null, envRT: null, wasNight: null, sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), sunUp: true, meteors: [], meteorT: rnd(4, 12), heightTex: null, shoreTex: null, groundMat: null, shT: 0, aurora: null };
  scene.fog = new THREE.Fog(cur.fog, 40, cur.fogFar);
  ctx.renderer.toneMappingExposure = cur.exposure;

  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, moonDir: { value: new THREE.Vector3(0, -1, 0) }, sunColor: { value: new THREE.Color() }, glow: { value: 0 }, uTime: W.uTime, uCover: { value: 0.5 }, cloudLit: { value: new THREE.Color() }, cloudShade: { value: new THREE.Color() }, uMoon: { value: 0 } },
    vertexShader: 'varying vec3 vP;void main(){vP=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: NOISE_GLSL + SKY_GLSL + `uniform vec3 top,bottom,sunDir,moonDir,sunColor,cloudLit,cloudShade;uniform float glow,uTime,uCover,uMoon;varying vec3 vP;
      void main(){gl_FragColor=vec4(skyColor(normalize(vP),top,bottom,sunDir,moonDir,sunColor,cloudLit,cloudShade,glow,uMoon,uCover,uTime,1.0),1.0);}`,
    side: THREE.BackSide, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1800, 40, 20), skyMat)); W.skyMat = skyMat;

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
  W.sunDisc.userData.noAO = W.moon.userData.noAO = W.stars.userData.noAO = true;
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: streakTex, color: 0xf4f6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.visible = false; m.frustumCulled = false; m.userData.noAO = true; scene.add(m);
    W.meteors.push({ mesh: m, t: 0, life: 0, head: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, len: 0, width: 0 });
  }
  if (cfg.snow) makeAurora(W, scene);

  if (cfg.water) { W.shoreTex = bakeShoreTex(cfg); W.heightTex = bakeHeightMap(cfg); }
  const ground = makeGround(cfg, W.uTime, W.shoreTex); scene.add(ground); W.groundMat = ground.material;
  if (cfg.water) { W.water = makeWater(cfg.water, cur, W.uTime, W.heightTex, waterEdge(cfg)); scene.add(W.water); }
  makeVegetation(cfg);
  if (cfg.dock) { scene.add(makeDock()); W.platforms.push({ x: [5.0, 6.4], z: [-19.5, -8.0], y: 0.36 }); }
  if (cfg.key === 'beach') for (let i = 0; i < 3; i++) { const x = (Math.random() < 0.5 ? -1 : 1) * rnd(7, 18), z = rnd(-7.5, -3); const h = terrainH(x, z, cfg); if (h < 0.1) continue; const d = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, rnd(1.5, 2.6), 6), std(0x9a8a72)); d.position.set(x, h + 0.1, z); d.rotation.set(0.1, rnd(0, 3), Math.PI / 2 - 0.1); shadowed(d); scene.add(d); W.trees.push([x, z, 0.9]); }

  const tent = makeTent(); tent.position.set(-1.6, 0, 1.2); scene.add(tent);
  const chair = makeChair(); chair.position.set(1.5, 0, 0.8); scene.add(chair);
  const table = makeTable(); table.position.set(0.6, 0, 0.5); scene.add(table);
  W.lantern = new THREE.PointLight(0xffc07a, W.lanternLit ? cur.lantern : 0, 12, 2); W.lantern.position.set(0.65, 0.75, 0.5); scene.add(W.lantern);
  const fire = makeFire(); fire.position.set(0.3, 0, -1.4); scene.add(fire);
  const car = makeCar(); car.position.set(0, 0, 8); scene.add(car);
  makeProps();
  if (cfg.snow) makeSnowCaps();
  contactShadow(-1.6, 1.3, 4.4, 4.8); contactShadow(1.5, 0.8, 1.3, 1.3, 0.7); contactShadow(0.6, 0.5, 1.0, 1.0, 0.6); contactShadow(0, 8.05, 3.4, 6.4); contactShadow(0.3, -1.4, 2.0, 2.0, 0.6); contactShadow(2.4, 0.6, 1.0, 0.9, 0.6); contactShadow(2.95, 0.3, 0.7, 0.7, 0.5);

  W.steam = new Particles(160, { color: 0xffffff, size: 0.05, opacity: 0.32 }); scene.add(W.steam.mesh);
  W.smoke = new Smoke(220, { color: 0xb9bdc5, warm: 0.6 }); scene.add(W.smoke.mesh);
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
    { id: 'trunk',    pos: [0, 1.0, 10.9],      r: 2.6, hit: 0.9,  from: ['walk'],          label: () => '트렁크 열기' },
    { id: 'chair',    pos: [1.5, 0.6, 0.8],     r: 2.2, hit: 0.45, from: ['walk'],          label: () => '의자에 앉기' },
    { id: 'tent',     pos: [-1.6, 0.7, 0.0],    r: 2.3, hit: 1.0,  from: ['walk'],          label: () => '텐트에 들어가기' },
    { id: 'car',      pos: [-1.35, 1.0, 8.1],   r: 2.0, hit: 0.7,  from: ['walk'],          label: () => '운전석에 앉기' },
    { id: 'fire',     pos: [0.3, 0.4, -1.4],    r: 2.4, hit: 0.6,  from: ['walk'],          label: () => W.fireLit ? '모닥불 끄기' : '모닥불 피우기' },
    { id: 'lantern',  pos: [0.65, 0.6, 0.5],    r: 1.8, hit: 0.22, from: ['walk', 'chair'], label: () => W.lanternLit ? '랜턴 끄기' : '랜턴 켜기' },
    { id: 'tentLamp', pos: [-2.35, 0.1, 2.1],   r: 2.0, hit: 0.18, from: ['tent', 'bed'],   label: () => W.tentLampLit ? '랜턴 끄기' : '랜턴 켜기' },
    { id: 'bed',      pos: [-1.1, 0.25, 1.25],  r: 2.0, hit: 0.5,  from: ['tent'],          label: () => '침낭에 눕기' },
  ];
  if (cfg.dock) W.interact.push({ id: 'dock', pos: [5.7, 0.7, -18.6], r: 2.0, hit: 0.6, from: ['walk'], label: () => '부두 끝에 앉기' });
  if (ctx.post) ctx.post.setScene(scene);
  applyTime(); rebakeEnv();
  if (W.fireLit) startCrackle();
}
