import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { $, rnd, smooth, wrapPI } from './util.js';
import { buildScene, applyTime, rebakeEnv, updateMeteors } from './scene.js';
import { paramsAt } from './time.js';
import { createPost } from './post.js';
import { spawnFlock, updateFlocks } from './props.js';
import { startAmbience, sfx } from './audio.js';
import { bindInput, player, cam, anim, walk, updateHUD, updatePrompt, updateCaption, resetHand, isNightClock, itemEmptied } from './game.js';

const canvas = $('#c');
const renderer = ctx.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer:fine)').matches ? 2 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const camera = ctx.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 3000);
camera.rotation.order = 'YXZ';
ctx.hand = new THREE.Group(); camera.add(ctx.hand); ctx.hand.visible = false;
ctx.post = createPost(renderer, camera);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); ctx.post.resize(innerWidth, innerHeight); });

let last = performance.now(), T = 0, lastSec = -1;
const _c = new THREE.Color(), tmpV = new THREE.Vector3(), fwdV = new THREE.Vector3(), basePos = new THREE.Vector3(), sipPos = new THREE.Vector3(), firePos = new THREE.Vector3(0.3, 0.25, -1.4);
/* 랜턴 밝기: 켜졌으면 시간대 값(최소치 보장)으로, 꺼졌으면 0 으로 부드럽게 */
const lampTo = (light, lit, base, floor, flick, dt) => { const tgt = lit ? Math.max(base, floor) * flick : 0; light.intensity += (tgt - light.intensity) * Math.min(1, dt * 6); };
/* 담배: 빨아들인 시간(h)에 비례해 길고 진하게 내뱉는다 */
function startExhale(h) { const k = Math.min(h, 3) / 3; anim.exhale = 0.35 + k * 0.75; anim.exhaleStr = 0.6 + k * 0.8; sfx('exhale'); }

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; const W = ctx.W, scene = ctx.scene; if (!scene) return; T += dt; W.uTime.value = T; ctx.post.update(T);
  const hand = ctx.hand;

  /* 시간 흐름: 하루 = settings.dayMin 분 */
  if (settings.flow && !ctx.paused) state.clock = (state.clock + dt / (settings.dayMin * 60)) % 1;
  paramsAt(state.clock, W.tm); applyTime();
  W.envT += dt; if (W.envT > 6) { W.envT = 0; if (settings.flow) rebakeEnv(); }
  if (Math.floor(T) !== lastSec) { lastSec = Math.floor(T); if (ctx.running) updateCaption(); }

  /* 낮/밤이 바뀌면 앰비언스(새소리 ↔ 풀벌레)도 따라 바꾼다 */
  { const night = isNightClock(state.clock); if (ctx.running && night !== W.wasNight) { W.wasNight = night; startAmbience(W.cfg.ambience, night ? 'night' : 'day'); } }

  if (!ctx.running) { const a = T * 0.06; camera.position.set(Math.sin(a) * 9.5, 2.3 + Math.sin(T * 0.13) * 0.3, 2 + Math.cos(a) * 9.5); camera.lookAt(0, 0.9, 0.3); }
  else {
    if (cam.t < 1) {
      cam.t = Math.min(1, cam.t + dt / 1.3); const k = smooth(0, 1, cam.t);
      camera.position.lerpVectors(cam.from, cam.to, k); camera.position.y += Math.sin(k * Math.PI) * 0.18;
      player.yaw = cam.yawFrom + wrapPI(cam.yawTo - cam.yawFrom) * k;
      if (cam.t >= 1) { player.yaw = cam.yawTo; updateHUD(); anim.lastTargetId = undefined; }
    } else if (state.mode === 'walk' && !ctx.paused) walk(dt);
    camera.rotation.y = player.yaw; camera.rotation.x = player.pitch + Math.sin(T * 0.7) * 0.003; camera.rotation.z = Math.sin(T * 0.5) * 0.002;
    updatePrompt();
  }
  camera.updateMatrixWorld();

  if (W.trunkLid) { const tgt = state.mode === 'trunk' ? -1.55 : 0; W.trunkLid.rotation.x += (tgt - W.trunkLid.rotation.x) * Math.min(1, dt * 5); }
  if (W.snow) { const p = W.snow.geometry.attributes.position; for (let i = 0; i < p.count; i++) { let y = p.array[i * 3 + 1] - dt * 1.1; p.array[i * 3] += Math.sin(T * 0.8 + i) * 0.4 * dt; if (y < -1) { y = 30; p.array[i * 3] = camera.position.x + rnd(-35, 35); p.array[i * 3 + 2] = camera.position.z + rnd(-40, 20); } p.array[i * 3 + 1] = y; } p.needsUpdate = true; }
  if (W.ff) { const p = W.ff.geometry.attributes.position; W.ffBase.forEach((b, i) => { p.array[i * 3] = b[0] + Math.sin(T * 0.5 + b[3]) * 1.2; p.array[i * 3 + 1] = b[1] + Math.sin(T * 0.9 + b[3] * 2) * 0.4; p.array[i * 3 + 2] = b[2] + Math.cos(T * 0.4 + b[3]) * 1.2; }); p.needsUpdate = true; W.ff.material.opacity = (0.45 + 0.4 * Math.sin(T * 1.7)) * Math.min(1, W.tm.stars * 2.5); }
  if (W.cfg.birds && W.sunUp) { W.birdT -= dt; if (W.birdT < 0) { spawnFlock(); W.birdT = rnd(16, 38); } }
  updateFlocks(dt, T);
  updateMeteors(dt);
  const flick = 0.92 + 0.06 * Math.sin(T * 13) + 0.04 * Math.sin(T * 31);
  if (W.lantern) { lampTo(W.lantern, W.lanternLit, W.tm.lantern, 2.5, flick, dt); if (W.lanternObj) W.lanternObj.userData.setLit(W.lanternLit); }
  if (W.tentLamp) { lampTo(W.tentLamp, W.tentLampLit, W.tm.tentLamp, 1.2, flick, dt); if (W.tentLampObj) W.tentLampObj.userData.setLit(W.tentLampLit); }
  if (W.dockLight) W.dockLight.intensity = W.tm.lantern * 0.8 * (0.92 + 0.06 * Math.sin(T * 11 + 1));
  if (W.stars) W.stars.material.opacity = W.tm.stars * (0.85 + 0.15 * Math.sin(T * 2.3));
  if (W.fireLight) {
    const tgt = W.fireLit ? W.tm.fireI : 0; W.fireLight.intensity += (tgt * (0.85 + 0.12 * Math.sin(T * 17) + 0.08 * Math.sin(T * 41)) - W.fireLight.intensity) * Math.min(1, dt * 4);
    W.emberCore.material.color.lerp(_c.setHex(W.fireLit ? 0xff6a1a : 0x2a1c14), Math.min(1, dt * 3));
    if (W.fireLit) {
      for (let i = 0; i < 5; i++) W.fire.spawn(firePos, { x: 0, y: 1.1, z: 0 }, 0.34, 0.55, 0.25);
      for (let i = 0; i < 3; i++) W.fireCore.spawn(firePos, { x: 0, y: 1.3, z: 0 }, 0.16, 0.45, 0.2);
      if (Math.random() < 0.35) W.embers.spawn(firePos, { x: 0, y: 1.8, z: 0 }, 0.3, 1.6, 0.6);
      if (Math.random() < 0.22) W.smoke.spawn(tmpV.copy(firePos).setY(1.0), { x: 0.05, y: 0.5, z: 0 }, 0.3, 4.5, 0.2);
    }
  }

  /* ── 손에 든 것: 한 모금 / 길게 마시기 / 양 감소 ── */
  if (W.item && ctx.running) {
    const type = state.item, ud = W.item.userData;
    if (anim.sipT !== null) {
      const atMouth = anim.holding && anim.sipT >= 0.5 && ud.amount > 0 && !ctx.paused;
      if (atMouth) { anim.sipT = 0.5; anim.holdT += dt; } else anim.sipT += dt / 1.7;
      const k = Math.sin(Math.PI * Math.min(anim.sipT, 1));
      if (type === 'smoke') { basePos.set(0.2, -0.13, -0.4); sipPos.set(0.04, -0.045, -0.2); hand.rotation.set(0, 0.6 + k * 0.5, 0.15 + k * 0.1); }
      else { basePos.set(0.22, -0.2, -0.45); sipPos.set(0.06, -0.08, -0.27); hand.rotation.set(k * 0.55, 0, k * -0.1); }
      hand.position.lerpVectors(basePos, sipPos, k);
      if (k > 0.85 && ud.amount > 0) {
        const rate = type === 'smoke' ? 0.07 : type === 'coffee' ? 0.22 : 0.28;   // 초당 소비량: 담배 ~15초, 커피 ~4.5초, 위스키 ~3.5초
        ud.amount = Math.max(0, ud.amount - rate * dt); ud.setAmount(ud.amount);
        if (type !== 'smoke' && T - anim.lastSipSfx > 0.75) { anim.lastSipSfx = T; sfx('sip'); }
        if (ud.amount === 0) { if (type === 'smoke') startExhale(anim.holdT); itemEmptied(); }
      }
      if (W.item && anim.sipT >= 1) { anim.sipT = null; anim.holding = false; if (type === 'smoke') startExhale(anim.holdT); resetHand(); }
    }
    if (W.item) {
      W.item.userData.emitter.getWorldPosition(tmpV);
      if (type === 'coffee' && ud.amount > 0.02 && T - anim.lastSteam > 0.07) { anim.lastSteam = T; W.steam.spawn(tmpV, { x: 0, y: 0.22, z: 0 }, 0.02, 2.2); }
      if (type === 'smoke') { const puff = anim.sipT !== null && anim.sipT > 0.35; ud.tip.material.color.setHex(puff ? 0xffb060 : 0xff5a1a); ud.glow.material.opacity = puff ? 0.95 : 0.5 + 0.1 * Math.sin(T * 6); if (T - anim.lastSteam > (puff ? 0.02 : 0.09)) { anim.lastSteam = T; W.smoke.spawn(tmpV, { x: 0.02, y: 0.18, z: 0 }, 0.01, 3.2); } }
    }
  }
  /* 내뱉는 연기: 시야 앞 22cm 아래쪽에서 앞으로 퍼진다 */
  if (anim.exhale > 0 && ctx.running) {
    anim.exhale -= dt; camera.getWorldDirection(fwdV); tmpV.copy(camera.position).addScaledVector(fwdV, 0.22); tmpV.y -= 0.06;
    for (let i = 0; i < 2; i++) W.smoke.spawn(tmpV, { x: fwdV.x * 0.5, y: 0.1 + fwdV.y * 0.5, z: fwdV.z * 0.5 }, 0.05, 2.6 * anim.exhaleStr, 0.18);
  }
  W.steam.update(dt, 0.03); W.smoke.update(dt, 0.04); W.fire.update(dt); W.fireCore.update(dt); W.embers.update(dt, 0.1);
  ctx.post.render();
}

bindInput();
$('#loading').classList.add('on');
setTimeout(() => { buildScene(state.bg); $('#loading').classList.remove('on'); requestAnimationFrame(loop); }, 50);
