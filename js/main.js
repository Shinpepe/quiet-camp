import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { $, rnd, smooth, clamp, wrapPI } from './util.js';
import { applyTime, rebakeEnv, updateMeteors } from './scene.js';
import { paramsAt } from './time.js';
import { createPost } from './post.js';
import { spawnFlock, updateFlocks, updateLighthouse } from './props.js';
import { WATER_Y } from './terrain.js';
import { startAmbience, updateAudio, sfx, setSparkler, sparklerLevel, menuAmbience, setSipFocus } from './audio.js';
import { bindInput, player, cam, anim, walk, updateHUD, updatePrompt, updateCaption, resetHand, isNightClock, itemEmptied, updateSleep, buildWithLoading } from './game.js';
import { updateChop, chopCamera } from './chop.js';
import { updateFish } from './fish.js';

const FINE = matchMedia('(pointer:fine)').matches;
const canvas = $('#c');
const renderer = ctx.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, FINE ? 2 : 1.5));
renderer.setSize(innerWidth, innerHeight);
/* 저장된 설정을 그대로 반영 (그림자를 꺼 두었으면 처음부터 끈다) */
renderer.shadowMap.enabled = settings.shadow; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
/* AgX: 밝아질수록 하얗게 수렴해 불꽃·노을의 주황이 노랗게 틀어지지 않는다. 채도 보정은 post.js 에서 */
renderer.toneMapping = THREE.AgXToneMapping;
const camera = ctx.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 3000);
camera.rotation.order = 'YXZ';
ctx.hand = new THREE.Group(); camera.add(ctx.hand); ctx.hand.visible = false;
ctx.post = createPost(renderer, camera);
ctx.post.setBloom(settings.bloom);

/* 세로 화면(폰)에서는 수평 시야 78° 를 기준으로 수직 FOV 를 다시 계산한다.
   기준 시야는 ctx.baseFov 에 저장 — 장작 패기의 시야 펀치가 이 위에 더해진다 */
function fitView() {
  const a = innerWidth / innerHeight; camera.aspect = a;
  camera.fov = ctx.baseFov = a < 1 ? Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(78) / 2) / a))) : 70;
  camera.updateProjectionMatrix();
}
/* 물 반사용 렌더타깃·카메라 (데스크톱, 설정 켜짐일 때만 사용) */
const reflSize = () => [Math.max(256, Math.round(innerWidth * 0.45)), Math.max(144, Math.round(innerHeight * 0.45))];
ctx.reflRT = new THREE.WebGLRenderTarget(...reflSize(), { type: THREE.HalfFloatType });
ctx.reflCam = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);
const reflMat = new THREE.Matrix4(), _lk = new THREE.Vector3(), _rd = new THREE.Vector3(), clipArr = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y + 0.02)];
ctx.reflClip = clipArr;   // 사전 컴파일이 클리핑 변형 셰이더도 만들 수 있게
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

/* ── 바람: 풀·나무·연기·배경음·돌풍 소리가 모두 이 값 하나(0..1)를 읽는다.
   느린 기본 흐름 위에 가끔 돌풍이 솟는다. 장소마다 기본 세기가 조금 다르다 ── */
const WIND_BIAS = { lake: 0, beach: 0.05, snow: 0.1 };
function windAt(T, key) {
  const base = 0.35 + 0.12 * Math.sin(T * 0.023 + 1.1) + (WIND_BIAS[key] || 0);
  const g = Math.max(0, 0.6 * Math.sin(T * 0.091) + 0.5 * Math.sin(T * 0.047 + 2.3) + 0.15 * Math.sin(T * 0.31 + 0.7));
  return clamp(base + g * 0.55, 0, 1);
}

let last = performance.now(), T = 0, lastSec = -1;
const _c = new THREE.Color(), tmpV = new THREE.Vector3(), fwdV = new THREE.Vector3(), basePos = new THREE.Vector3(), sipPos = new THREE.Vector3(), firePos = new THREE.Vector3(0.3, 0.25, -1.4), _sp = new THREE.Vector3();
/* 텐트 랜턴이 천에 비치는 색: 랜턴의 따뜻한 주황(_gw)과 천 색(_gc)을 섞는다 */
const _gw = new THREE.Color(0xff8a30), _gc = new THREE.Color();
const lampTo = (light, lit, base, floor, flick, dt) => { const tgt = lit ? Math.max(base, floor) * flick : 0; light.intensity += (tgt - light.intensity) * Math.min(1, dt * 6); };
function startExhale(h) { const k = Math.min(h, 3) / 3; anim.exhale = 0.35 + k * 0.75; anim.exhaleStr = 0.6 + k * 0.8; sfx('exhale'); }
/* 마시는 동안 다음 '꿀꺽'까지의 간격. 위스키는 천천히 머금으므로 더 길다 */
const gulpGap = type => type === 'whisky' ? rnd(1.6, 2.2) : rnd(1.2, 1.7);
/* 타는 스파클라 한 프레임: 끝에서부터 타 들어가고, 불티가 튀고, 글로우가 떨린다. 빛은 아래 라이트 풀이 담당 */
function burnSparkler(W, ud, dt) {
  ud.amount = Math.max(0, ud.amount - dt / 40); ud.setAmount(ud.amount);
  ud.emitter.getWorldPosition(tmpV);
  const n = 2 + (Math.random() < 0.6 ? 1 : 0); for (let i = 0; i < n; i++) W.sparks.spawn(tmpV);
  ud.glow.material.opacity = 0.6 + Math.random() * 0.4; ud.glow.scale.setScalar(0.12 + Math.random() * 0.05);
}
/* ── 스파클라 조명: 타는 스파클라를 1.2m 안에서 한 묶음으로 합치고, 카메라에 가까운 묶음부터 풀 라이트를 배정한다.
   라이트 개수가 절대 바뀌지 않으므로 셰이더 재컴파일이 없고, 개수에는 제한이 없다 ── */
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
  const dt = Math.min(0.05, (now - last) / 1000); last = now; const W = ctx.W, scene = ctx.scene;
  /* 씬이 아직 없거나 사전 컴파일 중에는 그리지 않는다 (숨긴 물체가 잠깐 보이는 상태라 로딩 화면이 덮고 있다) */
  if (!scene || ctx.compiling) return;
  T += dt; W.uTime.value = T; ctx.post.update(T);
  W.wind.value = windAt(T, W.cfg.key);
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
  /* 장작 패기 카메라 효과(흔들림·시선 반동·시야 펀치). 패는 중이 아니면 남은 효과만 가라앉힌다 */
  chopCamera(camera, dt, cam.t >= 1);
  camera.updateMatrixWorld();
  updateFish(ctx.paused ? 0 : dt);
  applyTime();
  updateAudio(dt);
  W.envT += dt; if (W.envT > 6) { W.envT = 0; if (settings.flow) rebakeEnv(); }
  /* 그림자맵은 보통 0.1초마다 갱신한다. 장작을 패는 동안에는 눈앞에서 도끼·장작·반쪽이 빠르게 움직여
     10Hz 로 끊기는 게 보이므로 매 프레임 갱신한다 */
  W.shT += dt; if (W.shT >= (ctx.running && state.mode === 'chop' ? 0 : 0.1)) { W.shT = 0; renderer.shadowMap.needsUpdate = true; }

  if (W.trunkLid) { const tgt = state.mode === 'trunk' ? -1.55 : 0; W.trunkLid.rotation.x += (tgt - W.trunkLid.rotation.x) * Math.min(1, dt * 5); }
  if (W.snow) { const p = W.snow.geometry.attributes.position; for (let i = 0; i < p.count; i++) { let y = p.array[i * 3 + 1] - dt * 1.1; p.array[i * 3] += Math.sin(T * 0.8 + i) * 0.4 * dt; if (y < -1) { y = 30; p.array[i * 3] = camera.position.x + rnd(-35, 35); p.array[i * 3 + 2] = camera.position.z + rnd(-40, 20); } p.array[i * 3 + 1] = y; } p.needsUpdate = true; }
  if (W.ff) { const p = W.ff.geometry.attributes.position; W.ffBase.forEach((b, i) => { p.array[i * 3] = b[0] + Math.sin(T * 0.5 + b[3]) * 1.2; p.array[i * 3 + 1] = b[1] + Math.sin(T * 0.9 + b[3] * 2) * 0.4; p.array[i * 3 + 2] = b[2] + Math.cos(T * 0.4 + b[3]) * 1.2; }); p.needsUpdate = true; W.ff.material.opacity = (0.45 + 0.4 * Math.sin(T * 1.7)) * Math.min(1, W.tm.stars * 2.5); }
  if (W.cfg.birds && W.sunUp) { W.birdT -= dt; if (W.birdT < 0) { spawnFlock(); W.birdT = rnd(16, 38); } }
  updateFlocks(dt, T);
  updateMeteors(dt);
  updateLighthouse(T);
  if (!ctx.paused) updateChop(dt);
  const flick = 0.92 + 0.06 * Math.sin(T * 13) + 0.04 * Math.sin(T * 31);
  if (W.lantern) { lampTo(W.lantern, W.lanternLit, W.tm.lantern, 2.5, flick, dt); if (W.lanternObj) W.lanternObj.userData.setLit(W.lanternLit); }
  if (W.tentLamp) { lampTo(W.tentLamp, W.tentLampLit, W.tm.tentLamp, 1.2, flick, dt); if (W.tentLampObj) W.tentLampObj.userData.setLit(W.tentLampLit); }
  /* 차 실내등: 켜고 끌 때 0.1초 남짓 부드럽게. 빛은 항상 장면에 있고 세기만 바뀌어 재컴파일이 없다 */
  if (W.dome) {
    W.domeK += ((W.domeLit ? 1 : 0) - W.domeK) * Math.min(1, dt * 10);
    W.dome.light.intensity = 3 * W.domeK; W.dome.lens.material.emissiveIntensity = 1.6 * W.domeK;
  }
  /* 텐트 랜턴이 켜지면 밖에서 천이 은은하게 빛난다.
     빛 색은 랜턴의 따뜻한 주황과 천 색을 반씩 섞고(스카이 텐트가 주황으로 빛나지 않게), 어두운 천일수록 빛이 덜 샌다(블랙은 거의 비치지 않는다).
     점광원의 빠른 떨림(flick)은 천에 곱하지 않는다 — 큰 면이 13Hz 로 깜빡이면 지직거림으로 보인다 */
  if (W.tentCloth) {
    W.tentGlow = (W.tentGlow || 0) + ((W.tentLampLit ? 1 : 0) - (W.tentGlow || 0)) * Math.min(1, dt * 3);
    const k = 0.32 * W.tentGlow * (0.97 + 0.03 * Math.sin(T * 1.7));
    W.tentCloth.forEach(m => {
      const c = m.color, mx = Math.max(c.r, c.g, c.b, 1e-3), pass = 0.2 + 0.8 * Math.min(1, mx * 1.6);
      _gc.setRGB(c.r / mx, c.g / mx, c.b / mx); m.emissive.copy(_gw).lerp(_gc, 0.5).multiplyScalar(k * pass);
    });
  }
  if (W.dockLight) { W.dockLight.intensity = W.tm.lantern * 0.8 * (0.96 + 0.04 * Math.sin(T * 3.1)); if (W.dockLampObj) W.dockLampObj.userData.setLit(W.tm.lantern > 0.5); }
  if (W.stars) W.stars.material.uniforms.uOp.value = W.tm.stars;

  /* ── 모닥불: 빛의 기본 세기는 부드럽게 따라가고, 오디오의 "파칙"(W.firePop)이 그 위에 순간적으로 얹힌다.
     큰 파칙(W.fireBurst)에는 불티가 한 번에 솟는다 ── */
  W.fireK = (W.fireK || 0) + ((W.fireLit ? 1 : 0) - (W.fireK || 0)) * Math.min(1, dt * 2.5);
  /* 불이 꺼져 있으면 모닥불 큐브 그림자맵(6면) 갱신을 건너뛴다. castShadow 는 그대로라 셰이더 재컴파일은 없다 */
  if (W.fireLight) W.fireLight.shadow.autoUpdate = W.fireK > 0.01;
  W.firePop *= Math.exp(-dt * 10);
  if (W.flames) W.flames.forEach((f, i) => { f.material.uniforms.uK.value = W.fireK; f.visible = W.fireK > 0.02; f.scale.y = W.fireK * (0.85 + 0.2 * Math.sin(T * 8.5 + i * 1.3) + 0.1 * Math.sin(T * 21 + i) + 0.25 * W.firePop); f.scale.x = 0.9 + 0.1 * Math.sin(T * 6.7 + i * 2); });
  if (W.logGlow) W.logGlow.forEach((s, i) => { s.material.opacity = Math.min(1, W.fireK * (0.55 + 0.45 * Math.sin(T * 13 + i * 1.9) + 0.3 * W.firePop)); });
  if (W.fireLight) {
    W.fireBase += ((W.fireLit ? W.tm.fireI : 0) - W.fireBase) * Math.min(1, dt * 4);
    W.fireLight.intensity = W.fireBase * (0.88 + 0.07 * Math.sin(T * 17) + 0.05 * Math.sin(T * 41) + 0.45 * W.firePop);
    W.emberCore.material.color.lerp(_c.setHex(W.fireLit ? 0xff6a1a : 0x2a1c14), Math.min(1, dt * 3));
    if (W.fireLit) {
      if (Math.random() < 0.45) W.fire.spawn(firePos, { x: 0, y: 1.3, z: 0 }, 0.3, 0.45, 0.3);
      if (Math.random() < 0.3) W.fireCore.spawn(firePos, { x: 0, y: 1.4, z: 0 }, 0.12, 0.35, 0.2);
      if (Math.random() < 0.14) W.embers.spawn(firePos, { x: 0, y: 1.8, z: 0 }, 0.3, 1.6, 0.6);
      if (Math.random() < 0.09) W.smoke.spawn(tmpV.copy(firePos).setY(1.2), { x: 0.04, y: 0.5, z: 0 }, 0.2, 5.0, 0.1, 0.2, 1.0, 0.16);
      if (W.fireBurst) {
        W.fireBurst = false;
        for (let i = 0; i < 8; i++) W.embers.spawn(firePos, { x: 0, y: 2.6, z: 0 }, 0.25, 1.4, 1.2);
        for (let i = 0; i < 3; i++) W.fireCore.spawn(firePos, { x: 0, y: 1.8, z: 0 }, 0.15, 0.3, 0.3);
      }
    } else W.fireBurst = false;
  }

  /* ── 손에 든 것 (장작을 패는 동안에는 손을 숨기므로 건너뛴다 — 숨긴 컵에서 김이 나오지 않게) ── */
  if (W.item && ctx.running && state.mode !== 'chop') {
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
          /* 마시는 소리 (audio.js): 넘기는 '꿀꺽' 하나만. 잔이 입에 닿아 있는 동안 배경이 살짝 물러난다.
             길게 들고 있으면 불규칙한 간격으로 다시 넘긴다 */
          if (type !== 'smoke') {
            if (!anim.mouth) { anim.mouth = true; anim.leftLips = false; anim.nextSwallow = T + gulpGap(type); setSipFocus(true); }
            else if (anim.holding && T >= anim.nextSwallow) { anim.lastGulp = T; anim.nextSwallow = T + gulpGap(type); sfx('swallow', type); }
          }
          if (ud.amount === 0) { if (type === 'smoke') startExhale(anim.holdT); itemEmptied(); }
        }
        /* 잔이 입술에서 떨어질 때 입에 든 한 모금을 넘긴다. 방금 넘겼다면 겹치지 않게 건너뛴다 */
        if (type !== 'smoke' && anim.mouth && !anim.leftLips && anim.sipT > 0.5 && k < 0.9) {
          anim.leftLips = true; setSipFocus(false);
          if (!ctx.paused && T - anim.lastGulp > 0.6) { anim.lastGulp = T; sfx('swallow', type); }
        }
        /* 잔을 다 내렸을 때: 담배는 연기를 내쉬고, 위스키는 얼음이 바닥으로 자리를 잡는다 */
        if (W.item && anim.sipT >= 1) {
          anim.sipT = null; anim.holding = false;
          if (type === 'smoke') startExhale(anim.holdT);
          else if (type === 'whisky') sfx('clink', 0.3);
          anim.mouth = false; resetHand();
        }
      }
      if (W.item) {
        ud.emitter.getWorldPosition(tmpV);
        if (type === 'coffee' && ud.amount > 0.02 && T - anim.lastSteam > 0.07) { anim.lastSteam = T; W.steam.spawn(tmpV, { x: 0, y: 0.22, z: 0 }, 0.02, 2.2); }
        if (type === 'smoke') { const puff = anim.sipT !== null && anim.sipT > 0.35; ud.tip.material.color.setHex(puff ? 0xffb060 : 0xff5a1a); ud.glow.material.opacity = puff ? 0.95 : 0.5 + 0.1 * Math.sin(T * 6); if (T - anim.lastSteam > (puff ? 0.03 : 0.12)) { anim.lastSteam = T; W.smoke.spawn(tmpV, { x: 0.02, y: 0.16, z: 0 }, 0.01, 3.2, 0.03, 0.02, 0.16, 0.22); } }
      }
    }
  }
  /* 마시는 중이 아니면 포커스를 풀어 둔다 (잠들기·장작 패기·아이템 내려놓기 등으로 도중에 끊겨도 남지 않게).
     같은 상태면 audio.js 가 아무 일도 하지 않는다 */
  if (anim.sipT === null) setSipFocus(false);
  if (anim.exhale > 0 && ctx.running) {
    anim.exhale -= dt; camera.getWorldDirection(fwdV); tmpV.copy(camera.position).addScaledVector(fwdV, 0.22); tmpV.y -= 0.06;
    for (let i = 0; i < 2; i++) W.smoke.spawn(tmpV, { x: fwdV.x * 0.5, y: 0.1 + fwdV.y * 0.5, z: fwdV.z * 0.5 }, 0.05, 2.6 * anim.exhaleStr, 0.18, 0.06, 0.4, 0.3);
  }

  /* ── 땅에 꽂힌 스파클라: 계속 타다가, 다 타면 20초 뒤 2초에 걸쳐 사라진다. 치익 소리는 가장 가까운 것 기준.
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
  /* 스파클라 소리는 게임 중에만 (메뉴 프리뷰에서는 나지 않게) */
  const sparkOn = ctx.running && sparkLv > 0;
  setSparkler(sparkOn); if (sparkOn) sparklerLevel(sparkLv);

  if (W.prints) W.prints.update(dt);
  W.sparks.update(dt);
  /* 연기·김은 바람을 따라 옆으로 흐른다 */
  const wv = W.wind.value;
  W.steam.update(dt, 0.01 + 0.04 * wv); W.smoke.update(dt, 0.015 + 0.06 * wv); W.fire.update(dt); W.fireCore.update(dt); W.embers.update(dt, 0.1);
  renderReflection(scene);
  ctx.post.render();
}

/* 루프는 바로 돌린다 — 씬이 준비되기 전이나 컴파일 중에는 아무것도 그리지 않는다.
   첫 빌드도 buildWithLoading 을 거쳐서, 로딩 중에 장소를 바꿔도 마지막 요청만 반영된다.
   로딩 중에 첫 입력이 들어오면 boot() 의 menuAmbience 는 씬이 없어 그냥 넘어가므로, 빌드가 끝난 뒤 여기서 시작한다
   (오디오가 아직 켜지지 않았으면 menuAmbience 가 알아서 아무것도 하지 않는다) */
bindInput();
requestAnimationFrame(loop);
buildWithLoading(() => { if (!ctx.running) menuAmbience(state.bg); });