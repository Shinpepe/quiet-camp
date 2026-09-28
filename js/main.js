import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { $, rnd, smooth, wrapPI } from './util.js';
import { buildScene, applyTime, rebakeEnv, updateMeteors } from './scene.js';
import { paramsAt } from './time.js';
import { createPost } from './post.js';
import { spawnFlock, updateFlocks, updateLighthouse } from './props.js';
import { WATER_Y } from './terrain.js';
import { startAmbience, updateAudio, sfx, setSparkler, sparklerLevel } from './audio.js';
import { bindInput, player, cam, anim, walk, updateHUD, updatePrompt, updateCaption, resetHand, isNightClock, itemEmptied, updateSleep } from './game.js';

const FINE = matchMedia('(pointer:fine)').matches;
const canvas = $('#c');
const renderer = ctx.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, FINE ? 2 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const camera = ctx.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 3000);
camera.rotation.order = 'YXZ';
ctx.hand = new THREE.Group(); camera.add(ctx.hand); ctx.hand.visible = false;
ctx.post = createPost(renderer, camera);

/* 세로 화면(폰)에서는 수평 시야 78° 를 기준으로 수직 FOV 를 다시 계산한다 */
function fitView() {
  const a = innerWidth / innerHeight; camera.aspect = a;
  camera.fov = a < 1 ? Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(78) / 2) / a))) : 70;
  camera.updateProjectionMatrix();
}
/* 물 반사용 렌더타깃·카메라 (데스크톱, 설정 켜짐일 때만 사용) */
const reflSize = () => [Math.max(256, Math.round(innerWidth * 0.45)), Math.max(144, Math.round(innerHeight * 0.45))];
ctx.reflRT = new THREE.WebGLRenderTarget(...reflSize(), { type: THREE.HalfFloatType });
ctx.reflCam = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);
const reflMat = new THREE.Matrix4(), _lk = new THREE.Vector3(), _rd = new THREE.Vector3(), clipArr = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y + 0.02)];
function renderReflection(scene) {
  const W = ctx.W; if (!W.water || !settings.reflect || !FINE) return;
  const rc = ctx.reflCam;
  rc.fov = camera.fov; rc.aspect = camera.aspect; rc.near = camera.near; rc.far = camera.far; rc.updateProjectionMatrix();
  rc.position.set(camera.position.x, 2 * WATER_Y - camera.position.y, camera.position.z);
  camera.getWorldDirection(_rd); _rd.y = -_rd.y; _lk.copy(rc.position).add(_rd);
  rc.up.set(0, -1, 0); rc.lookAt(_lk); rc.updateMatrixWorld();
  reflMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
  W.water.material.uniforms.uReflMat.value.copy(reflMat);
  const hv = ctx.hand.visible; W.water.visible = false; ctx.hand.visible = false; W.noRefl.forEach(o => { o.visible = false; });
  renderer.clippingPlanes = clipArr; renderer.setRenderTarget(ctx.reflRT); renderer.render(scene, rc); renderer.setRenderTarget(null); renderer.clippingPlanes = [];
  W.water.visible = true; ctx.hand.visible = hv; W.noRefl.forEach(o => { o.visible = true; });
}
fitView();
addEventListener('resize', () => { fitView(); renderer.setSize(innerWidth, innerHeight); ctx.post.resize(innerWidth, innerHeight); ctx.reflRT.setSize(...reflSize()); });

let last = performance.now(), T = 0, lastSec = -1;
const _c = new THREE.Color(), tmpV = new THREE.Vector3(), fwdV = new THREE.Vector3(), basePos = new THREE.Vector3(), sipPos = new THREE.Vector3(), firePos = new THREE.Vector3(0.3, 0.25, -1.4), _sp = new THREE.Vector3();
const lampTo = (light, lit, base, floor, flick, dt) => { const tgt = lit ? Math.max(base, floor) * flick : 0; light.intensity += (tgt - light.intensity) * Math.min(1, dt * 6); };
function startExhale(h) { const k = Math.min(h, 3) / 3; anim.exhale = 0.35 + k * 0.75; anim.exhaleStr = 0.6 + k * 0.8; sfx('exhale'); }
/* 타는 스틱 한 프레임: 끝에서부터 타 들어가고, 불티가 튀고, 글로우가 떨린다. 빛은 아래 라이트 풀이 담당 */
function burnSparkler(W, ud, dt) {
  ud.amount = Math.max(0, ud.amount - dt / 40); ud.setAmount(ud.amount);
  ud.emitter.getWorldPosition(tmpV);
  const n = 2 + (Math.random() < 0.6 ? 1 : 0); for (let i = 0; i < n; i++) W.sparks.spawn(tmpV);
  ud.glow.material.opacity = 0.6 + Math.random() * 0.4; ud.glow.scale.setScalar(0.12 + Math.random() * 0.05);
}
/* ── 스파클러 조명: 타는 스틱을 1.2m 안에서 한 묶음으로 합치고, 카메라에 가까운 묶음부터 풀 라이트를 배정한다.
   라이트 개수가 절대 바뀌지 않으므로 셰이더 재컴파일이 없고, 스틱 수에는 제한이 없다 ── */
const groups = [];
function assignSparkLights(W) {
  groups.length = 0;
  const each = ud => {
    ud.light.getWorldPosition(_sp);
    let g = null; for (const c of groups) if (c.p.distanceToSquared(_sp) < 1.44) { g = c; break; }
    if (g) { g.n++; g.p.lerp(_sp, 1 / g.n); } else groups.push({ p: _sp.clone(), n: 1, d: 0 });
  };
  if (W.item && W.item.userData.lit) each(W.item.userData);
  for (const s of W.planted) if (s.ud.lit) each(s.ud);
  for (const g of groups) g.d = g.p.distanceToSquared(camera.position);
  groups.sort((a, b) => a.d - b.d);
  for (let i = 0; i < W.sparkLights.length; i++) {
    const l = W.sparkLights[i], g = groups[i];
    if (g) { l.position.copy(g.p); l.intensity = (2.0 + Math.random() * 1.3) * Math.min(g.n, 3); } else l.intensity = 0;
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; const W = ctx.W, scene = ctx.scene; if (!scene) return; T += dt; W.uTime.value = T; ctx.post.update(T);
  const hand = ctx.hand;

  if (settings.flow && !ctx.paused && state.mode !== 'sleep') state.clock = (state.clock + dt / (settings.dayMin * 60)) % 1;
  paramsAt(state.clock, W.tm);
  if (Math.floor(T) !== lastSec) { lastSec = Math.floor(T); if (ctx.running) updateCaption(); }
  { const night = isNightClock(state.clock); if (ctx.running && night !== W.wasNight) { W.wasNight = night; startAmbience(W.cfg.ambience, night ? 'night' : 'day'); } }

  if (!ctx.running) { const a = T * 0.06; camera.position.set(Math.sin(a) * 9.5, 2.3 + Math.sin(T * 0.13) * 0.3, 2 + Math.cos(a) * 9.5); camera.lookAt(0, 0.9, 0.3); }
  else {
    if (cam.t < 1) {
      cam.t = Math.min(1, cam.t + dt / 1.3); const k = smooth(0, 1, cam.t);
      camera.position.lerpVectors(cam.from, cam.to, k); camera.position.y += Math.sin(k * Math.PI) * 0.18;
      player.yaw = cam.yawFrom + wrapPI(cam.yawTo - cam.yawFrom) * k; player.pitch = cam.pitchFrom + (cam.pitchTo - cam.pitchFrom) * k;
      if (cam.t >= 1) { player.yaw = cam.yawTo; player.pitch = cam.pitchTo; updateHUD(); anim.lastTargetId = undefined; }
    } else if (state.mode === 'walk' && !ctx.paused) walk(dt);
    camera.rotation.y = player.yaw; camera.rotation.x = player.pitch + Math.sin(T * 0.7) * 0.003; camera.rotation.z = Math.sin(T * 0.5) * 0.002;
    updatePrompt(); if (!ctx.paused) updateSleep(dt);
  }
  camera.updateMatrixWorld();
  applyTime();
  updateAudio(dt);
  W.envT += dt; if (W.envT > 6) { W.envT = 0; if (settings.flow) rebakeEnv(); }
  W.shT += dt; if (W.shT >= 0.1) { W.shT = 0; renderer.shadowMap.needsUpdate = true; }

  if (W.trunkLid) { const tgt = state.mode === 'trunk' ? -1.55 : 0; W.trunkLid.rotation.x += (tgt - W.trunkLid.rotation.x) * Math.min(1, dt * 5); }
  if (W.snow) { const p = W.snow.geometry.attributes.position; for (let i = 0; i < p.count; i++) { let y = p.array[i * 3 + 1] - dt * 1.1; p.array[i * 3] += Math.sin(T * 0.8 + i) * 0.4 * dt; if (y < -1) { y = 30; p.array[i * 3] = camera.position.x + rnd(-35, 35); p.array[i * 3 + 2] = camera.position.z + rnd(-40, 20); } p.array[i * 3 + 1] = y; } p.needsUpdate = true; }
  if (W.ff) { const p = W.ff.geometry.attributes.position; W.ffBase.forEach((b, i) => { p.array[i * 3] = b[0] + Math.sin(T * 0.5 + b[3]) * 1.2; p.array[i * 3 + 1] = b[1] + Math.sin(T * 0.9 + b[3] * 2) * 0.4; p.array[i * 3 + 2] = b[2] + Math.cos(T * 0.4 + b[3]) * 1.2; }); p.needsUpdate = true; W.ff.material.opacity = (0.45 + 0.4 * Math.sin(T * 1.7)) * Math.min(1, W.tm.stars * 2.5); }
  if (W.cfg.birds && W.sunUp) { W.birdT -= dt; if (W.birdT < 0) { spawnFlock(); W.birdT = rnd(16, 38); } }
  updateFlocks(dt, T);
  updateMeteors(dt);
  updateLighthouse(T);
  const flick = 0.92 + 0.06 * Math.sin(T * 13) + 0.04 * Math.sin(T * 31);
  if (W.lantern) { lampTo(W.lantern, W.lanternLit, W.tm.lantern, 2.5, flick, dt); if (W.lanternObj) W.lanternObj.userData.setLit(W.lanternLit); }
  if (W.tentLamp) { lampTo(W.tentLamp, W.tentLampLit, W.tm.tentLamp, 1.2, flick, dt); if (W.tentLampObj) W.tentLampObj.userData.setLit(W.tentLampLit); }
  /* 텐트 랜턴이 켜지면 밖에서 천이 은은하게 빛난다. 점광원의 빠른 떨림(flick)은 천에 곱하지 않는다 — 큰 면이 13Hz 로 깜빡이면 지직거림으로 보인다 */
  if (W.tentCloth) { W.tentGlow = (W.tentGlow || 0) + ((W.tentLampLit ? 1 : 0) - (W.tentGlow || 0)) * Math.min(1, dt * 3); const k = 0.32 * W.tentGlow * (0.97 + 0.03 * Math.sin(T * 1.7)); W.tentCloth.forEach(m => { m.emissive.setHex(0xff8a30).multiplyScalar(k); }); }
  if (W.dockLight) { W.dockLight.intensity = W.tm.lantern * 0.8 * (0.96 + 0.04 * Math.sin(T * 3.1)); if (W.dockLampObj) W.dockLampObj.userData.setLit(W.tm.lantern > 0.5); }
  if (W.stars) W.stars.material.uniforms.uOp.value = W.tm.stars;

  W.fireK = (W.fireK || 0) + ((W.fireLit ? 1 : 0) - (W.fireK || 0)) * Math.min(1, dt * 2.5);
  if (W.flames) W.flames.forEach((f, i) => { f.material.uniforms.uK.value = W.fireK; f.visible = W.fireK > 0.02; f.scale.y = W.fireK * (0.85 + 0.2 * Math.sin(T * 8.5 + i * 1.3) + 0.1 * Math.sin(T * 21 + i)); f.scale.x = 0.9 + 0.1 * Math.sin(T * 6.7 + i * 2); });
  if (W.logGlow) W.logGlow.forEach((s, i) => { s.material.opacity = W.fireK * (0.55 + 0.45 * Math.sin(T * 13 + i * 1.9)); });
  if (W.fireLight) {
    const tgt = W.fireLit ? W.tm.fireI : 0; W.fireLight.intensity += (tgt * (0.85 + 0.12 * Math.sin(T * 17) + 0.08 * Math.sin(T * 41)) - W.fireLight.intensity) * Math.min(1, dt * 4);
    W.emberCore.material.color.lerp(_c.setHex(W.fireLit ? 0xff6a1a : 0x2a1c14), Math.min(1, dt * 3));
    if (W.fireLit) {
      if (Math.random() < 0.45) W.fire.spawn(firePos, { x: 0, y: 1.3, z: 0 }, 0.3, 0.45, 0.3);
      if (Math.random() < 0.3) W.fireCore.spawn(firePos, { x: 0, y: 1.4, z: 0 }, 0.12, 0.35, 0.2);
      if (Math.random() < 0.14) W.embers.spawn(firePos, { x: 0, y: 1.8, z: 0 }, 0.3, 1.6, 0.6);
      if (Math.random() < 0.09) W.smoke.spawn(tmpV.copy(firePos).setY(1.2), { x: 0.04, y: 0.5, z: 0 }, 0.2, 5.0, 0.1, 0.2, 1.0, 0.16);
    }
  }

  /* ── 손에 든 것 ── */
  if (W.item && ctx.running) {
    const type = state.item, ud = W.item.userData;
    if (type === 'sparkler') {
      if (ud.lit && !ctx.paused) { burnSparkler(W, ud, dt); if (ud.amount === 0) { ud.setLit(false); itemEmptied(); } }
    } else {
      if (anim.sipT !== null) {
        const atMouth = anim.holding && anim.sipT >= 0.5 && ud.amount > 0 && !ctx.paused;
        if (atMouth) { anim.sipT = 0.5; anim.holdT += dt; } else anim.sipT += dt / 1.7;
        const k = Math.sin(Math.PI * Math.min(anim.sipT, 1));
        if (type === 'smoke') { basePos.set(0.2, -0.13, -0.4); sipPos.set(0.04, -0.045, -0.2); hand.rotation.set(0, 0.6 + k * 0.5, 0.15 + k * 0.1); }
        else { basePos.set(0.22, -0.2, -0.45); sipPos.set(0.06, -0.08, -0.27); hand.rotation.set(k * 0.55, 0, k * -0.1); }
        hand.position.lerpVectors(basePos, sipPos, k);
        if (k > 0.85 && ud.amount > 0) {
          const rate = type === 'smoke' ? 0.07 : type === 'coffee' ? 0.22 : 0.28;
          ud.amount = Math.max(0, ud.amount - rate * dt); ud.setAmount(ud.amount);
          if (type !== 'smoke' && T - anim.lastSipSfx > 0.75) { anim.lastSipSfx = T; sfx(type === 'coffee' ? 'sip' : 'gulp'); }
          if (ud.amount === 0) { if (type === 'smoke') startExhale(anim.holdT); itemEmptied(); }
        }
        if (W.item && anim.sipT >= 1) { anim.sipT = null; anim.holding = false; if (type === 'smoke') startExhale(anim.holdT); else sfx('gulp'); resetHand(); }
      }
      if (W.item) {
        ud.emitter.getWorldPosition(tmpV);
        if (type === 'coffee' && ud.amount > 0.02 && T - anim.lastSteam > 0.07) { anim.lastSteam = T; W.steam.spawn(tmpV, { x: 0, y: 0.22, z: 0 }, 0.02, 2.2); }
        if (type === 'smoke') { const puff = anim.sipT !== null && anim.sipT > 0.35; ud.tip.material.color.setHex(puff ? 0xffb060 : 0xff5a1a); ud.glow.material.opacity = puff ? 0.95 : 0.5 + 0.1 * Math.sin(T * 6); if (T - anim.lastSteam > (puff ? 0.03 : 0.12)) { anim.lastSteam = T; W.smoke.spawn(tmpV, { x: 0.02, y: 0.16, z: 0 }, 0.01, 3.2, 0.03, 0.02, 0.16, 0.22); } }
      }
    }
  }
  if (anim.exhale > 0 && ctx.running) {
    anim.exhale -= dt; camera.getWorldDirection(fwdV); tmpV.copy(camera.position).addScaledVector(fwdV, 0.22); tmpV.y -= 0.06;
    for (let i = 0; i < 2; i++) W.smoke.spawn(tmpV, { x: fwdV.x * 0.5, y: 0.1 + fwdV.y * 0.5, z: fwdV.z * 0.5 }, 0.05, 2.6 * anim.exhaleStr, 0.18, 0.06, 0.4, 0.3);
  }

  /* ── 땅에 꽂힌 스틱: 계속 타다가, 다 타면 20초 뒤 2초에 걸쳐 사라진다. 치익 소리는 가장 가까운 타는 스틱 기준.
     발밑 데칼은 개수와 무관하게 전부 켜서 "빛나 보이게" 한다 ── */
  let sparkLv = W.item && W.item.userData.lit ? 1 : 0;
  for (const s of W.planted) {
    const ud = s.ud;
    if (ud.lit) {
      if (!ctx.paused) {
        burnSparkler(W, ud, dt);
        sparkLv = Math.max(sparkLv, 1 / (1 + 0.35 * tmpV.distanceToSquared(camera.position)));
        if (ud.amount === 0) { ud.setLit(false); s.doneT = 0; sfx('sparkOff'); }
      } else sparkLv = 1;
      if (ud.decal) { ud.decal.visible = ud.lit; ud.decal.material.opacity = 0.3 + Math.random() * 0.2; }
    } else if (s.doneT >= 0) {
      s.doneT += dt; const k = 1 - smooth(18, 20, s.doneT); s.g.scale.setScalar(Math.max(0.001, k));
      if (s.doneT >= 20) { scene.remove(s.g); s.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); s.gone = true; }
    }
  }
  if (W.planted.length) W.planted = W.planted.filter(s => !s.gone);
  if (W.sparkLights) assignSparkLights(W);
  setSparkler(sparkLv > 0); if (sparkLv > 0) sparklerLevel(sparkLv);

  if (W.prints) W.prints.update(dt);
  W.sparks.update(dt);
  W.steam.update(dt, 0.03); W.smoke.update(dt, 0.04); W.fire.update(dt); W.fireCore.update(dt); W.embers.update(dt, 0.1);
  renderReflection(scene);
  ctx.post.render();
}

bindInput();
$('#loading').classList.add('on');
setTimeout(() => { buildScene(state.bg); $('#loading').classList.remove('on'); requestAnimationFrame(loop); }, 50);
