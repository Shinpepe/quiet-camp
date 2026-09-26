import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { $, rnd, smooth, wrapPI } from './util.js';
import { buildScene, applyTime, rebakeEnv, updateMeteors } from './scene.js';
import { paramsAt } from './time.js';
import { createPost } from './post.js';
import { spawnFlock, updateFlocks, updateLighthouse } from './props.js';
import { startAmbience, updateAudio, sfx } from './audio.js';
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
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); ctx.post.resize(innerWidth, innerHeight); });

let last = performance.now(), T = 0, lastSec = -1;
const _c = new THREE.Color(), tmpV = new THREE.Vector3(), fwdV = new THREE.Vector3(), basePos = new THREE.Vector3(), sipPos = new THREE.Vector3(), firePos = new THREE.Vector3(0.3, 0.25, -1.4);
const lampTo = (light, lit, base, floor, flick, dt) => { const tgt = lit ? Math.max(base, floor) * flick : 0; light.intensity += (tgt - light.intensity) * Math.min(1, dt * 6); };
function startExhale(h) { const k = Math.min(h, 3) / 3; anim.exhale = 0.35 + k * 0.75; anim.exhaleStr = 0.6 + k * 0.8; sfx('exhale'); }

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
  if (W.fireLight) W.fireLight.castShadow = settings.shadow && FINE && W.fireLit && !W.sunUp;

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
  if (W.dockLight) { W.dockLight.intensity = W.tm.lantern * 0.8 * (0.96 + 0.04 * Math.sin(T * 3.1)); if (W.dockLampObj) W.dockLampObj.userData.setLit(W.tm.lantern > 0.5); }
  if (W.stars) W.stars.material.opacity = W.tm.stars * (0.85 + 0.15 * Math.sin(T * 2.3));

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
      /* 불꽃놀이 스틱: 켜져 있으면 끝에서부터 타 들어가고, 불티가 사방으로 튀며, 손 주변이 밝아진다 (약 40초) */
      if (ud.lit && !ctx.paused) {
        ud.amount = Math.max(0, ud.amount - dt / 40); ud.setAmount(ud.amount);
        ud.emitter.getWorldPosition(tmpV);
        const n = 2 + (Math.random() < 0.6 ? 1 : 0); for (let i = 0; i < n; i++) W.sparks.spawn(tmpV);
        ud.light.intensity = 2.0 + Math.random() * 1.3; ud.glow.material.opacity = 0.6 + Math.random() * 0.4; ud.glow.scale.setScalar(0.12 + Math.random() * 0.05);
        if (ud.amount === 0) { ud.setLit(false); itemEmptied(); }
      }
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
  if (W.prints) W.prints.update(dt);
  W.sparks.update(dt);
  W.steam.update(dt, 0.03); W.smoke.update(dt, 0.04); W.fire.update(dt); W.fireCore.update(dt); W.embers.update(dt, 0.1);
  ctx.post.render();
}

bindInput();
$('#loading').classList.add('on');
setTimeout(() => { buildScene(state.bg); $('#loading').classList.remove('on'); requestAnimationFrame(loop); }, 50);
