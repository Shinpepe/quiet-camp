import * as THREE from 'three';
import { ctx, state, settings, saveSettings } from './state.js';
import { BG, TIME, ITEMS, SEAT, BLOCKS, EYE, PR, WAKE, CHOP, ICON, GEAR, GEAR_DEFAULT, FISHING } from './data.js';
import { $, clamp, wrapPI, isTouch, rnd, josa } from './util.js';
import { terrainH, shoreOff } from './terrain.js';
import { makeItem, applyGear } from './props.js';
import { buildScene, precompileScene, rebakeEnv } from './scene.js';
import { clockLabel } from './time.js';
import { initAudio, resumeAudio, setVolume, startAmbience, stopAmbience, sfx, setIndoor, menuAmbience } from './audio.js';
import { startChop, chopEye, chopYaw, chopPress, requestChopStop, resetChop, chopHooks, chopStats } from './chop.js';
import { beginFish, stopFish, resetFish, fishPress, fishActive, fishHint, fishHooks, fishCount } from './fish.js';
import { hideAllFx } from './gauge.js';

/* ── 조작 원칙: E 는 바라보는 것, 클릭은 손에 든 것. 앉아서 아무것도 안 보면 E = 일어나기 ──
   장작 패기·낚시 중에는 클릭(스페이스)이 타이밍 입력이 된다 */

export const player = { x: -2.1, z: 8.2, yaw: 0, pitch: 0, bob: 0, side: false };
export const cam = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, yawFrom: 0, yawTo: 0, pitchFrom: 0, pitchTo: 0 };
/* 마시기: mouth = 이번 모금에서 잔이 입에 닿았는지, leftLips = 잔이 입술에서 떨어졌는지,
   lastGulp = 마지막 '꿀꺽' 시각(연달아 겹치지 않게), nextSwallow = 길게 마실 때 다음 '꿀꺽' 시각 */
export const anim = { sipT: null, holding: false, holdT: 0, exhale: 0, exhaleStr: 0, lastSteam: 0, mouth: false, leftLips: false, lastGulp: -9, nextSwallow: 0, lastTargetId: null };
const keys = {}; let toastT = null, tMove = null, tLook = null;
const canvas = () => ctx.renderer.domElement;
const locked = () => document.pointerLockElement === canvas();
export const isNightClock = c => c < 0.22 || c > 0.8;
const NITEMS = Object.keys(ITEMS).length;

/* 오브젝트 하위의 지오메트리·재질을 GPU 에서 해제한다.
   텍스처는 건드리지 않는다 — 아이템의 글로우 맵(softTex) 등은 여러 곳이 공유한다.
   셰이더 프로그램은 사전 컴파일용 임시 아이템의 재질이 계속 붙잡고 있어서, 다시 꺼낼 때 재컴파일이 일어나지 않는다 */
function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m && m.dispose) m.dispose(); });
  });
}

/* 모바일 가상 조이스틱 표시 */
const joy = $('#joy'), joyStick = joy && joy.querySelector('.stick');
const moveJoy = (dx, dy) => { if (joyStick) joyStick.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`; };
const showJoy = (x, y) => { if (!joy) return; joy.style.left = x + 'px'; joy.style.top = y + 'px'; joy.classList.add('on'); moveJoy(0, 0); };
const hideJoy = () => { if (joy) joy.classList.remove('on'); };

function bindToggle(id, key, onChange) {
  const el = $('#' + id), lab = $('#' + id + 'V');
  if (!el || !lab) { console.warn('toggle element missing:', id); return; }
  const paint = () => { el.classList.toggle('on', settings[key]); lab.textContent = settings[key] ? '켜짐' : '꺼짐'; };
  el.onclick = () => { settings[key] = !settings[key]; paint(); onChange(settings[key]); saveSettings(); }; paint();
}

/* 포인터 잠금 요청. 브라우저가 거절하면(ESC 직후 등) "화면을 클릭하면 시작합니다" 안내를 띄운다 */
function lock() {
  if (isTouch) return;
  const p = canvas().requestPointerLock(); if (p && p.catch) p.catch(() => { $('#lockmsg').style.opacity = 0.85; });
}

/* 타이밍 입력(장작 패기·낚시) 중인가 */
const timingMode = () => state.mode === 'chop' || fishActive();
function timingPress() { if (cam.t < 1 || ctx.paused) return; if (state.mode === 'chop') chopPress(); else if (fishActive()) fishPress(); }

export function bindInput() {
  chopHooks.stop = endChop; chopHooks.toast = showToast; chopHooks.hud = updateHUD;
  fishHooks.toast = showToast; fishHooks.hud = updateHUD;
  /* 첫 입력에서 오디오를 켜고 메뉴 배경음을 작게 시작한다 (씬이 아직 없으면 main.js 의 빌드 완료 콜백이 대신 시작) */
  const boot = () => { initAudio(); resumeAudio(); if (!ctx.running) menuAmbience(state.bg); };
  addEventListener('pointerdown', boot, { once: true }); addEventListener('keydown', boot, { once: true });

  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.repeat) return;
    if (!ctx.running) { if (e.code === 'Enter' && !$('#menu').classList.contains('hidden')) startGame(); return; }
    if (ctx.paused) { if (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space') resume(); return; }
    if (e.code === 'Space' && timingMode()) { e.preventDefault(); timingPress(); return; }
    /* 트렁크가 열려 있으면 포인터 잠금이 풀려 있어 ESC 가 일시정지로 이어지지 않는다 → 트렁크를 닫는다 */
    if (e.code === 'Escape' && state.mode === 'trunk') { closeTrunk(); return; }
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyP') takePhoto();
    if (state.mode === 'trunk' && /^Digit[1-9]$/.test(e.code)) trunkKey(+e.code[5]);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; tMove = tLook = null; hideJoy(); });
  addEventListener('mousemove', e => { if (!locked() || !ctx.running) return; look(e.movementX, e.movementY, 0.0022 * settings.sens); });
  document.addEventListener('pointerlockchange', () => { if (!ctx.running || isTouch) return; if (locked()) { hidePause(); $('#lockmsg').style.opacity = 0; } else if (state.mode !== 'trunk') showPause(); });
  canvas().addEventListener('click', () => { if (ctx.running && !isTouch && !locked()) canvas().requestPointerLock(); });
  addEventListener('mousedown', e => { if (e.button !== 0 || !ctx.running || isTouch || !locked()) return; useItem(); });
  addEventListener('mouseup', e => { if (e.button === 0) endSip(); });
  canvas().addEventListener('touchstart', e => { for (const t of e.changedTouches) { if (t.clientX < innerWidth * 0.42 && !tMove) { tMove = { id: t.identifier, sx: t.clientX, sy: t.clientY, dx: 0, dy: 0 }; if (ctx.running) showJoy(t.clientX, t.clientY); } else if (!tLook) tLook = { id: t.identifier, lx: t.clientX, ly: t.clientY }; } }, { passive: true });
  canvas().addEventListener('touchmove', e => { for (const t of e.changedTouches) { if (tMove && t.identifier === tMove.id) { tMove.dx = clamp((t.clientX - tMove.sx) / 60, -1, 1); tMove.dy = clamp((t.clientY - tMove.sy) / 60, -1, 1); moveJoy(tMove.dx, tMove.dy); } if (tLook && t.identifier === tLook.id) { look(t.clientX - tLook.lx, t.clientY - tLook.ly, 0.005 * settings.sens); tLook.lx = t.clientX; tLook.ly = t.clientY; } } }, { passive: true });
  const touchEnd = e => { for (const t of e.changedTouches) { if (tMove && t.identifier === tMove.id) { tMove = null; hideJoy(); } if (tLook && t.identifier === tLook.id) tLook = null; } };
  canvas().addEventListener('touchend', touchEnd, { passive: true }); canvas().addEventListener('touchcancel', touchEnd, { passive: true });

  $('#trunkClose').onclick = closeTrunk;
  $('#resume').onclick = resume;
  $('#pause').addEventListener('click', e => { if (e.target === $('#pause')) resume(); });
  $('#pausebtn').style.display = isTouch ? '' : 'none';
  $('#pausebtn').onclick = () => { if (ctx.paused) resume(); else showPause(); };
  /* 잠자는 중에 메뉴로 나가도 페이드가 검게 남지 않고, 메뉴 프리뷰의 시간도 다시 흐르도록 mode 를 되돌린다.
     땅에 꽂아 둔 스파클라도 치운다 — 남겨 두면 메뉴 프리뷰에서 계속 타면서 소리가 난다. 장작 패기·낚시 중이었다면 정리한다 */
  $('#toMenu').onclick = () => { hidePause(); ctx.running = false; endSleepUI(); state.mode = 'seated'; putBack(); clearPlanted(); resetChop(); resetFish(); hideAllFx(); $('#hud').classList.remove('on'); $('#trunk').classList.remove('on'); stopAmbience(); setIndoor(false); setVolume(settings.vol); menuAmbience(state.bg); $('#menu').classList.remove('hidden'); ctx.hand.visible = false; hideJoy(); };
  $('#photoBtn').onclick = () => { hidePause(); setTimeout(takePhoto, 50); lock(); };
  $('#mAct').onclick = interact;
  /* 길게 누르기: 포인터를 버튼에 붙잡아 두어 손가락이 살짝 움직여도 놓치지 않는다 */
  const ms = $('#mSip');
  ms.onpointerdown = e => { e.preventDefault(); try { ms.setPointerCapture(e.pointerId); } catch (_) {} useItem(); };
  ms.onpointerup = ms.onpointercancel = endSip; ms.oncontextmenu = e => e.preventDefault();
  $('#start').onclick = startGame;
  /* 슬라이더: 저장된 값으로 위치·라벨을 먼저 맞추고, 바뀔 때마다 같은 키의 다른 슬라이더(메뉴/일시정지)도 같이 움직인 뒤 저장 */
  const bindRange = (id, key, fmt, apply) => {
    const el = $('#' + id); el.dataset.k = key; el.value = settings[key];
    const paint = () => document.querySelectorAll('[id^=' + key + 'V]').forEach(l => { l.textContent = fmt(settings[key]); });
    paint();
    el.oninput = () => { settings[key] = +el.value; document.querySelectorAll('input[data-k=' + key + ']').forEach(o => { o.value = el.value; }); paint(); apply && apply(settings[key]); saveSettings(); };
  };
  bindRange('vol', 'vol', v => Math.round(v * 100) + '%', setVolume); bindRange('vol2', 'vol', v => Math.round(v * 100) + '%', setVolume);
  bindRange('sens', 'sens', v => v.toFixed(1)); bindRange('sens2', 'sens', v => v.toFixed(1));
  bindToggle('flow', 'flow', () => {});
  bindToggle('shadow', 'shadow', on => {
    ctx.renderer.shadowMap.enabled = on; ctx.renderer.shadowMap.needsUpdate = true;
    if (ctx.W.sun) ctx.W.sun.castShadow = on;
    if (ctx.scene) ctx.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
  });
  bindToggle('bloom', 'bloom', on => ctx.post.setBloom(on));
  bindToggle('ao', 'ao', on => ctx.post.setAO(on));
  bindToggle('reflect', 'reflect', on => { if (ctx.W.water) ctx.W.water.material.uniforms.uReflect.value = on && !isTouch ? 1 : 0; });
  renderMenu();
}
/* 시선. 장작을 패는 동안에는 그루터기 주변으로, 낚시하는 동안에는 물 쪽 180° · 아래 약 20° 까지만 (하늘은 볼 수 있다) */
function look(dx, dy, s) {
  player.yaw -= dx * s; player.pitch = clamp(player.pitch - dy * s, -1.3, 1.3);
  if (state.mode === 'chop' && cam.t >= 1) {
    const cy = chopYaw();
    player.yaw = cy + clamp(wrapPI(player.yaw - cy), -CHOP.look[0], CHOP.look[0]);
    player.pitch = clamp(player.pitch, CHOP.pitch - CHOP.look[1], CHOP.pitch + CHOP.look[1]);
  } else if (fishActive() && cam.t >= 1) {
    player.yaw = clamp(wrapPI(player.yaw), -FISHING.yaw, FISHING.yaw);
    player.pitch = clamp(player.pitch, FISHING.pitch[0], FISHING.pitch[1]);
  }
}
function resume() { hidePause(); lock(); }

/* ── 조준: 조준점이 물체의 실루엣 안에 있는 것 ── */
const fwd = new THREE.Vector3(), toT = new THREE.Vector3();
export function currentTarget() {
  if (cam.t < 1 || state.mode === 'trunk' || state.mode === 'sleep' || state.mode === 'chop') return null;
  const from = state.mode === 'walk' ? 'walk' : state.seat;
  ctx.camera.getWorldDirection(fwd); let best = null, bs = 9;
  for (const it of ctx.W.interact) {
    if (!(it.from || ['walk']).includes(from)) continue;
    toT.set(it.pos[0], it.pos[1], it.pos[2]).sub(ctx.camera.position); const d = toT.length(); if (d > it.r) continue;
    toT.normalize(); const ang = Math.acos(clamp(toT.dot(fwd), -1, 1)), edge = Math.atan((it.hit || 0.5) / Math.max(d, 0.2)), s = ang - edge;
    if (s > 0.1) continue;
    if (s < bs) { bs = s; best = it; }
  }
  return best;
}
function startMove(to, yawTo, pitchTo) { cam.from.copy(ctx.camera.position); cam.to.copy(to); cam.t = 0; cam.yawFrom = wrapPI(player.yaw); cam.yawTo = yawTo; cam.pitchFrom = player.pitch; cam.pitchTo = pitchTo === undefined ? player.pitch : pitchTo; }
function sitDown(id, quiet) {
  const st = SEAT[id]; state.mode = 'seated'; state.seat = id;
  /* 부두 끝: 물 쪽(정면)을 보고 앉는다 */
  const yawTo = id === 'dock' ? 0 : wrapPI(player.yaw), pitchTo = quiet ? 0 : id === 'dock' ? -0.08 : undefined;
  startMove(new THREE.Vector3(...st.pos), yawTo, pitchTo);
  if (!quiet) { if (id === 'car') { sfx('doorOpen'); setTimeout(() => sfx('doorClose'), 900); } else if (id === 'tent') sfx('zipper'); else sfx('sit'); }
  setIndoor(id === 'tent' || id === 'car');
}
function standUp() {
  const st = SEAT[state.seat];
  if (state.seat === 'dock') stopFish();
  if (state.seat === 'car') { sfx('doorOpen'); setTimeout(() => sfx('doorClose'), 900); } else if (state.seat === 'tent') sfx('zipper', 'close'); else sfx('stand');
  player.x = st.stand[0]; player.z = st.stand[1]; state.mode = 'walk'; state.seat = null; startMove(new THREE.Vector3(player.x, floorY(player.x, player.z) + EYE, player.z), wrapPI(player.yaw), 0); setIndoor(false);
}
/* 부두 끝에 앉으면 손에 든 것을 내려놓고 낚싯대를 든다 */
function startFishing() { if (state.item) putBack(); sitDown('dock'); if (!beginFish()) showToast('여기서는 낚시를 할 수 없다'); }
function toggleFire() { const W = ctx.W; W.fireLit = !W.fireLit; sfx(W.fireLit ? 'fireOn' : 'fireOff'); showToast(W.fireLit ? '불을 피웠다' : '불을 껐다'); }
const LAMP = { lantern: { flag: 'lanternLit', name: '랜턴' }, tentLamp: { flag: 'tentLampLit', name: '텐트 랜턴' }, dome: { flag: 'domeLit', name: '실내등' } };
function toggleLamp(k) { const L = LAMP[k]; ctx.W[L.flag] = !ctx.W[L.flag]; sfx(k === 'dome' ? 'ui' : ctx.W[L.flag] ? 'lampOn' : 'lampOff'); showToast(josa(L.name, '을', '를') + (ctx.W[L.flag] ? ' 켰다' : ' 껐다')); }

export function interact() {
  if (cam.t < 1 || ctx.paused || state.mode === 'sleep') return;
  if (state.mode === 'trunk') { closeTrunk(); return; }
  if (state.mode === 'chop') { requestChopStop(); return; }
  const t = currentTarget();
  if (t) act(t.id);
  else if (state.mode === 'seated') { if (state.seat === 'bed') sitDown('tent', true); else standUp(); }
  updateHUD(); anim.lastTargetId = undefined;
}
function act(id) {
  switch (id) {
    case 'trunk': openTrunk(); break;
    case 'fire': toggleFire(); break;
    case 'lantern': toggleLamp('lantern'); break;
    case 'tentLamp': toggleLamp('tentLamp'); break;
    case 'dome': toggleLamp('dome'); break;
    case 'bed': startSleep(); break;
    case 'stump': beginChop(); break;
    case 'dock': startFishing(); break;
    default: sitDown(id);
  }
}

/* ── 장작 패기 시작·끝: 지금 서 있는 쪽에서 그루터기를 바라보고 선다. 손에 든 것은 잠시 숨긴다 ── */
let chopTold = false;
function beginChop() {
  if (ctx.W.item && ctx.W.item.userData.lit) { showToast('스파클라를 먼저 땅에 꽂자'); return; }
  if (!startChop(player.x, player.z, (x, z) => !blockedAt(x, z))) { showToast('장작을 팰 자리가 없다'); return; }
  anim.sipT = null; anim.holding = false; anim.mouth = false; if (state.item) resetHand(); ctx.hand.visible = false;
  const eye = chopEye();
  state.mode = 'chop'; state.seat = null; player.x = eye.x; player.z = eye.z;
  startMove(eye.clone(), chopYaw(), CHOP.pitch); updateHUD();
  if (!chopTold) { chopTold = true; setTimeout(() => { if (state.mode === 'chop') showToast('삼각형이 초록·금색 구간에 있을 때 내려치자'); }, 1500); }
}
function endChop() {
  state.mode = 'walk'; ctx.hand.visible = true;
  startMove(new THREE.Vector3(player.x, floorY(player.x, player.z) + EYE, player.z), wrapPI(player.yaw), 0); updateHUD();
}

function openTrunk() { state.mode = 'trunk'; $('#trunk').classList.add('on'); sfx('trunkOpen'); if (!isTouch) document.exitPointerLock(); renderTrunk(); updateHUD(); }
function closeTrunk() { if (state.mode !== 'trunk') return; state.mode = 'walk'; $('#trunk').classList.remove('on'); sfx('trunkClose'); lock(); updateHUD(); }
function trunkKey(n) { sfx('ui'); const ks = Object.keys(ITEMS); if (n <= ks.length) { pickItem(ks[n - 1]); closeTrunk(); } else if (n === ks.length + 1 && state.item) { putBack(); closeTrunk(); } }
function renderTrunk() {
  const box = $('#trunkItems'); box.innerHTML = '';
  Object.entries(ITEMS).forEach(([k, v], i) => { const d = document.createElement('button'); d.className = 'card'; d.innerHTML = `<div class="ic">${v.ic}</div><div class="nm">${v.name}</div><div class="ds">${v.ds}</div><kbd>${i + 1}</kbd>`; d.onclick = () => trunkKey(i + 1); box.append(d); });
  if (state.item) { const d = document.createElement('button'); d.className = 'card'; d.innerHTML = `<div class="ic">${ICON_BACK}</div><div class="nm">내려놓기</div><div class="ds">${josa(ITEMS[state.item].name, '을', '를')} 다시 넣는다</div><kbd>${NITEMS + 1}</kbd>`; d.onclick = () => trunkKey(NITEMS + 1); box.append(d); }
}
const ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-3"/></svg>';
function pickItem(type) { putBack(); state.item = type; const it = makeItem(type); ctx.hand.add(it); ctx.W.item = it; resetHand(); sfx('pick', type); showToast(josa(ITEMS[type].name, '을', '를') + ' 챙겼다'); }
/* 손에 든 것을 내려놓는다. 떼어 내기 전에 GPU 자원을 해제한다 (예전엔 바꿀 때마다 지오메트리·재질이 쌓였다) */
export function putBack() { state.item = null; disposeTree(ctx.hand); ctx.hand.clear(); ctx.W.item = null; anim.sipT = null; anim.holding = false; anim.holdT = 0; anim.mouth = false; }
/* 땅에 꽂힌 스파클라를 모두 치운다 (메뉴로 나갈 때, 잠들어 시간이 건너뛸 때, 같은 씬으로 다시 시작할 때) */
function clearPlanted() {
  const W = ctx.W; if (!W.planted) return;
  W.planted.forEach(s => { ctx.scene.remove(s.g); disposeTree(s.g); });
  W.planted = [];
}
export function resetHand() {
  const h = ctx.hand;
  if (state.item === 'smoke') { h.position.set(0.2, -0.13, -0.4); h.rotation.set(0, 0.6, 0.15); }
  else if (state.item === 'sparkler') { h.position.set(0.2, -0.28, -0.55); h.rotation.set(-0.2, 0, -0.25); }
  else { h.position.set(0.22, -0.2, -0.45); h.rotation.set(0, 0, 0); }
}

/* ── 손에 든 것 사용: 마실 것·담배는 길게, 스파클라는 클릭으로 점화 → 다시 클릭으로 땅에 꽂기 ──
   장작을 패거나 낚시하는 중이면 클릭이 타이밍 입력이 된다.
   마시는 소리는 누르는 순간이 아니라 잔이 입술에서 떨어질 때(길게 마시면 그 사이에도) main.js 가 '꿀꺽'으로 낸다 */
function useItem() {
  if (timingMode()) { timingPress(); return; }
  if (!state.item || !ctx.W.item || state.mode === 'trunk' || state.mode === 'sleep' || ctx.paused || cam.t < 1) return;
  if (state.item === 'sparkler') { if (ctx.W.item.userData.lit) plantSparkler(); else igniteSparkler(); return; }
  if (anim.sipT !== null) return;
  if (ctx.W.item.userData.amount <= 0) { showToast(state.item === 'smoke' ? '다 피웠다' : '잔이 비었다'); return; }
  anim.sipT = 0; anim.holding = true; anim.holdT = 0; anim.mouth = false; anim.leftLips = false;
  if (state.item === 'smoke') sfx('inhale');
}
function endSip() { anim.holding = false; }
function igniteSparkler() {
  const it = ctx.W.item, ud = it.userData; if (ud.lit || ud.igniting || ud.amount <= 0) return;
  ud.igniting = true; sfx('lighter');
  setTimeout(() => { if (ctx.W.item !== it || !ctx.running) return; ud.igniting = false; ud.setLit(true); sfx('sparkOn'); updateHUD(); }, 450);
}
/* 타는 스파클라를 앞쪽 땅에 꽂는다 — 서 있을 때만. 남은 양을 그대로 이어받아 계속 탄다.
   그룹은 지면 기울기에 맞춰 세우고(발밑 데칼이 땅에 붙게), 스틱 자체만 살짝 비뚤게 */
const _UP = new THREE.Vector3(0, 1, 0), _nrm = new THREE.Vector3();
function plantSparkler() {
  const it = ctx.W.item, ud = it.userData; if (!ud.lit) return;
  if (state.mode !== 'walk') { showToast('서 있을 때 꽂을 수 있다'); return; }
  const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
  let px = player.x - s * 0.75, pz = player.z - c * 0.75;
  if (blockedAt(px, pz)) { px = player.x + c * 0.4; pz = player.z - s * 0.4; }
  const g = makeItem('sparkler'), nu = g.userData; nu.amount = ud.amount; nu.setAmount(nu.amount); nu.setLit(true);
  const cfg = ctx.W.cfg;
  if (onPlatform(px, pz)) _nrm.copy(_UP);
  else _nrm.set(-(terrainH(px + 0.3, pz, cfg) - terrainH(px - 0.3, pz, cfg)) / 0.6, 1, -(terrainH(px, pz + 0.3, cfg) - terrainH(px, pz - 0.3, cfg)) / 0.6).normalize();
  g.position.set(px, floorY(px, pz) - 0.03, pz);
  g.quaternion.setFromUnitVectors(_UP, _nrm); g.rotateY(rnd(0, 6.3));
  nu.stick.rotation.set(rnd(-0.15, 0.15), 0, rnd(-0.15, 0.15));
  ctx.scene.add(g); ctx.W.planted.push({ g, ud: nu, doneT: -1 });
  ud.setLit(false); putBack(); sfx('plant', surfaceAt(px, pz)); showToast('스파클라를 땅에 꽂았다'); updateHUD();
}
export function itemEmptied() {
  if (state.item === 'smoke') { putBack(); showToast('담배를 다 피웠다'); }
  else if (state.item === 'sparkler') { sfx('sparkOff'); putBack(); showToast('스파클라가 다 탔다'); }
  else showToast(state.item === 'coffee' ? '커피를 다 마셨다' : '위스키를 다 마셨다');
  updateHUD();
}

/* ── 잠자기: 언제 잠들든 다음 아침 7시(WAKE)에 깬다 ── */
const sleep = { on: false, phase: '', t: 0, from: 0, to: 0 };
function startSleep() {
  sleep.on = true; sleep.phase = 'in'; sleep.t = 0; state.mode = 'sleep'; anim.holding = false; anim.sipT = null; anim.mouth = false;
  const f = $('#fade'); f.style.transition = 'opacity 1.6s'; f.style.opacity = 1;
  $('#prompt').classList.remove('on'); $('#cross').style.display = 'none'; $('#legend').style.display = 'none'; $('#itembox').classList.remove('on'); sfx('bag');
}
/* 잠자기 화면을 정리한다. 잠자는 도중(페이드가 검은 상태)에 불렸다면 페이드도 걷어 낸다 */
function endSleepUI() {
  const was = sleep.on; sleep.on = false; sleep.phase = ''; sleep.t = 0;
  $('#sleep').classList.remove('on');
  const f = $('#fade'); f.style.transition = ''; if (was) f.style.opacity = 0;
  $('#cross').style.display = ''; $('#legend').style.display = '';
}
export function updateSleep(dt) {
  if (!sleep.on) return; sleep.t += dt;
  const f = $('#fade'), st = $('#sleep');
  if (sleep.phase === 'in') {
    setVolume(settings.vol * Math.max(0.12, 1 - sleep.t / 1.6));
    if (sleep.t >= 1.7) {
      const b = SEAT.bed; state.seat = 'bed'; ctx.camera.position.set(...b.pos); player.yaw = b.yaw; player.pitch = b.pitch; cam.t = 1; putBack();
      sleep.from = state.clock; sleep.to = state.clock < WAKE ? WAKE : 1 + WAKE; sleep.phase = 'night'; sleep.t = 0;
      st.classList.add('on'); ctx.W.fireLit = false;
      clearPlanted();
    }
  } else if (sleep.phase === 'night') {
    const k = Math.min(1, sleep.t / 4.5), e = k * k * (3 - 2 * k);
    state.clock = k >= 1 ? WAKE : (sleep.from + (sleep.to - sleep.from) * e) % 1;
    $('#sleepText').textContent = clockLabel(state.clock);
    if (k >= 1) { rebakeEnv(); ctx.W.envT = 0; sleep.phase = 'out'; sleep.t = 0; st.classList.remove('on'); f.style.opacity = 0; }
  } else if (sleep.phase === 'out') {
    setVolume(settings.vol * Math.min(1, 0.12 + sleep.t / 1.6));
    if (sleep.t >= 1.7) { endSleepUI(); setVolume(settings.vol); state.mode = 'seated'; updateHUD(); anim.lastTargetId = undefined; showToast('아침이 왔다'); }
  }
}

export function showToast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
export function updateCaption() { $('#capText').textContent = BG[state.bg].name + ' — ' + clockLabel(state.clock); }
export function updateHUD() {
  updateCaption();
  const ib = $('#itembox'), chop = state.mode === 'chop', fish = fishActive(), btn = isTouch ? '버튼' : '클릭';
  ib.classList.toggle('on', chop || fish || (!!state.item && state.mode !== 'trunk' && state.mode !== 'sleep'));
  if (chop) {
    const s = chopStats();
    ib.querySelector('.ic').innerHTML = ICON.axe; ib.querySelector('.nm').textContent = '도끼' + (s.count ? ` · 쪼갠 장작 ${s.count}` : '') + (s.best >= 2 ? ` · 최고 ${s.best}연속` : '');
    ib.querySelector('.hn').textContent = `${btn}: 삼각형이 초록·금색 구간에 있을 때 내려치기`;
    $('#mSip').textContent = '내려치기';
  } else if (fish) {
    const n = fishCount(), [hn, act] = fishHint(btn);
    ib.querySelector('.ic').innerHTML = ICON.rod; ib.querySelector('.nm').textContent = '낚싯대' + (n ? ` · 잡은 물고기 ${n}` : '');
    ib.querySelector('.hn').textContent = hn; $('#mSip').textContent = act;
  } else if (state.item) {
    const def = ITEMS[state.item], ud = ctx.W.item && ctx.W.item.userData, empty = ud && ud.amount <= 0;
    ib.querySelector('.ic').innerHTML = def.ic; ib.querySelector('.nm').textContent = def.name;
    ib.querySelector('.hn').textContent = empty ? '비었다, 트렁크에서 새로 꺼내기' : ud && ud.lit ? btn + ': 땅에 꽂기 (타는 중)' : btn + ': ' + def.act + (def.hold ? ', 길게 누르면 계속' : '');
    $('#mSip').textContent = ud && ud.lit ? '땅에 꽂기' : def.act;
  }
  $('#mSip').style.display = chop || fish || (state.item && state.mode !== 'trunk' && state.mode !== 'sleep') ? '' : 'none';
  anim.lastTargetId = undefined; updatePrompt();
}
export function updatePrompt() {
  const p = $('#prompt');
  if (state.mode === 'trunk' || state.mode === 'sleep') { p.classList.remove('on'); $('#cross').classList.remove('hot'); anim.lastTargetId = null; return; }
  const chop = state.mode === 'chop', t = currentTarget(), id = t ? t.id : state.mode === 'seated' ? 'up' : chop ? 'chopUp' : null;
  if (id === anim.lastTargetId) return; anim.lastTargetId = id;
  const label = t ? t.label() : state.mode === 'seated' ? SEAT[state.seat].up : chop ? '그만하기' : null;
  if (label) { p.innerHTML = `<kbd class="a">E</kbd>${label}`; p.classList.add('on'); } else p.classList.remove('on');
  $('#cross').classList.toggle('hot', !!t);
}
function showPause() { if (!ctx.paused) sfx('uiOpen'); ctx.paused = true; anim.holding = false; $('#pause').classList.add('on'); $('#pauseSub').textContent = BG[state.bg].name + ' / ' + clockLabel(state.clock); }
function hidePause() { if (ctx.paused) sfx('uiClose'); ctx.paused = false; $('#pause').classList.remove('on'); }

/* ── 사진: 지금 보이는 화면을 그대로 담고, 아래에 장소와 시각 캡션을 얹는다.
   WebGL 캔버스는 화면에 표시된 뒤 버퍼가 비워질 수 있어서, 같은 태스크 안에서 한 프레임을 다시 그리고 곧바로 복사한다.
   인코딩은 toBlob 으로 비동기 처리하고, 모바일은 공유 시트를 먼저 시도한 뒤 안 되면 내려받기로 넘어간다 ── */
let shooting = false;
function takePhoto() {
  if (shooting || !ctx.running || ctx.paused || state.mode === 'sleep') return;
  shooting = true;
  const hud = $('#hud'); hud.classList.add('photo'); sfx('shutter');
  ctx.post.render();
  const src = canvas(), w = src.width, h = src.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  g.drawImage(src, 0, 0);
  const s = h / 1080, x0 = 48 * s, label = clockLabel(state.clock);
  const grd = g.createLinearGradient(0, h - 190 * s, 0, h); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.5)'); g.fillStyle = grd; g.fillRect(0, h - 190 * s, w, 190 * s);
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(233,197,138,.95)'; g.font = `500 ${Math.round(13 * s)}px "Pretendard Variable", Pretendard, sans-serif`; try { g.letterSpacing = '0.35em'; } catch (_) {} g.fillText('QUIET CAMP', x0, h - 80 * s);
  g.fillStyle = 'rgba(255,255,255,.92)'; g.font = `400 ${Math.round(27 * s)}px "Noto Serif KR", serif`; try { g.letterSpacing = '0.06em'; } catch (_) {} g.fillText(`${BG[state.bg].name} — ${label}`, x0, h - 44 * s);
  const name = `quiet-camp-${state.bg}-${label.replace(':', '')}.png`;
  setTimeout(() => hud.classList.remove('photo'), 180);
  cv.toBlob(blob => { savePhoto(blob, name).finally(() => { shooting = false; }); }, 'image/png');
}
async function savePhoto(blob, name) {
  if (!blob) { showToast('사진을 저장하지 못했다'); return; }
  if (isTouch && navigator.canShare) {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Quiet Camp' }); showToast('사진을 공유했다'); return; }
      catch (e) { if (e && e.name === 'AbortError') { showToast('사진 공유를 취소했다'); return; } }
    }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast('사진을 저장했다');
}
function renderMenu() {
  const bl = $('#bgList'); bl.innerHTML = '';
  Object.values(BG).forEach(b => { const d = document.createElement('div'); d.className = 'opt' + (state.bg === b.key ? ' sel' : ''); d.innerHTML = `<div class="ic">${b.ic}</div><div class="nm">${b.name}</div>`; d.onclick = () => { if (state.bg === b.key) return; sfx('ui'); state.bg = b.key; saveSettings(); renderMenu(); previewRebuild(); }; bl.append(d); });
  const tl = $('#timeList'); tl.innerHTML = '';
  Object.values(TIME).forEach(t => { const d = document.createElement('div'); d.className = 'chip' + (state.time === t.key ? ' sel' : ''); d.innerHTML = `<span class="ic">${t.ic}</span>${t.name}`; d.onclick = () => { sfx('ui'); state.time = t.key; state.clock = t.clock; saveSettings(); renderMenu(); const W = ctx.W; if (W.tm) { W.fireLit = W.tm.stars > 0.1; W.lanternLit = W.tm.lantern > 0.5; W.tentLampLit = W.tm.tentLamp > 0.5; } if (!ctx.running) menuAmbience(state.bg); }; tl.append(d); });
  const gear = (id, kind, prop) => {
    const box = $('#' + id); if (!box) return; box.innerHTML = '';
    const cur = GEAR.find(g => g.key === state[prop]) || GEAR.find(g => g.key === GEAR_DEFAULT[kind]);
    GEAR.forEach(g => {
      const b = document.createElement('button'); b.className = 'sw' + (g === cur ? ' sel' : '');
      b.style.setProperty('--c', '#' + g[kind].toString(16).padStart(6, '0')); b.title = g.name; b.setAttribute('aria-label', g.name);
      b.onclick = () => { if (state[prop] === g.key) return; sfx('ui'); state[prop] = g.key; saveSettings(); applyGear(); renderMenu(); };
      box.append(b);
    });
    const lab = $('#' + id + 'Name'); if (lab) lab.textContent = cur.name;
  };
  gear('carList', 'car', 'carColor'); gear('tentList', 'tent', 'tentColor');
}
let buildGen = 0, doneGen = 0, builtReflect = false;
export function buildWithLoading(after) {
  const gen = ++buildGen;
  $('#loading').classList.add('on');
  setTimeout(() => {
    if (gen !== buildGen) return;
    buildScene(state.bg);
    const refl = settings.reflect;
    precompileScene().then(() => { if (gen !== buildGen) return; doneGen = gen; builtReflect = refl; $('#loading').classList.remove('on'); after && after(); });
  }, 40);
}
function sceneReady(bg) {
  const W = ctx.W;
  return doneGen === buildGen && !ctx.compiling && !!ctx.scene && !!W.cfg && W.cfg.key === bg && !(settings.reflect && !builtReflect);
}
/* 프리뷰 씬을 재사용할 때 게임 시작 상태로 되돌린다 (새로 빌드했을 때와 같은 출발점) */
function resetSceneForStart() {
  const W = ctx.W, tm = W.tm;
  W.fireLit = tm.stars > 0.1; W.lanternLit = tm.lantern > 0.5; W.tentLampLit = tm.tentLamp > 0.5;
  clearPlanted(); resetChop(); resetFish(); hideAllFx(); W.splitCount = 0;
}
let rebuildT = null;
export function previewRebuild() { const f = $('#fade'); f.style.opacity = 1; clearTimeout(rebuildT); rebuildT = setTimeout(() => buildWithLoading(() => { f.style.opacity = 0; if (!ctx.running) menuAmbience(state.bg); }), 420); }
export function startGame() {
  clearTimeout(rebuildT);
  initAudio(); resumeAudio(); sfx('uiGo');
  const fade = $('#fade'); fade.style.opacity = 1; $('#menu').classList.add('hidden');
  const begin = () => {
    putBack(); ctx.hand.visible = true; state.mode = 'seated'; state.seat = 'car'; player.yaw = player.pitch = 0; cam.t = 1; anim.lastTargetId = undefined; ctx.paused = false; anim.exhale = 0;
    ctx.camera.position.set(...SEAT.car.pos); ctx.camera.rotation.set(0, 0, 0);
    const night = isNightClock(state.clock);
    ctx.W.wasNight = night;
    ctx.W.domeLit = night;
    startAmbience(BG[state.bg].ambience, night ? 'night' : 'day');
    setIndoor(true);
    $('#hud').classList.add('on'); $('#mobile').classList.toggle('on', isTouch);
    ctx.running = true; updateHUD(); fade.style.opacity = 0;
    $('#lockmsg').style.opacity = isTouch ? 0 : 0.85;
    $('#caption').classList.add('bright'); setTimeout(() => $('#caption').classList.remove('bright'), 5000);
  };
  if (sceneReady(state.bg)) setTimeout(() => { if (sceneReady(state.bg)) { resetSceneForStart(); begin(); } else buildWithLoading(begin); }, 520);
  else setTimeout(() => buildWithLoading(begin), 700);
}

function onPlatform(x, z) { return ctx.W.platforms.find(p => x > p.x[0] && x < p.x[1] && z > p.z[0] && z < p.z[1]); }
export function floorY(x, z) { const p = onPlatform(x, z); return p ? p.y : terrainH(x, z, ctx.W.cfg); }
function surfaceAt(x, z) { const cfg = ctx.W.cfg; if (onPlatform(x, z)) return 'wood'; if (cfg.water && z - cfg.water.z - shoreOff(x, cfg) < -1.2) return 'wet'; return cfg.key === 'snow' ? 'snow' : cfg.key === 'beach' ? 'sand' : 'grass'; }
function blockedAt(x, z) {
  for (const b of BLOCKS) if (x > b.x[0] - PR && x < b.x[1] + PR && z > b.z[0] - PR && z < b.z[1] + PR) return true;
  for (const t of ctx.W.trees) if (Math.hypot(x - t[0], z - t[1]) < t[2] + PR) return true;
  if (onPlatform(x, z)) return false;
  if (terrainH(x, z, ctx.W.cfg) < -0.35) return true;
  if (Math.hypot(x, z) > 90) return true;
  return false;
}
const STEP = 0.5;
export function walk(dt) {
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz -= 1; if (keys.KeyS || keys.ArrowDown) mz += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (tMove) { mx += tMove.dx; mz += tMove.dy; }
  const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
  const moving = len > 0.05, sp = 2.6 * dt, cam3 = ctx.camera;
  if (moving) {
    const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
    const wx = (mx * c + mz * s) * sp, wz = (-mx * s + mz * c) * sp;
    if (!blockedAt(player.x + wx, player.z)) player.x += wx;
    if (!blockedAt(player.x, player.z + wz)) player.z += wz;
    const prev = Math.floor(player.bob / Math.PI);
    player.bob += dt * (Math.PI / STEP) * Math.min(1, len);
    if (Math.floor(player.bob / Math.PI) !== prev) {
      const sf = surfaceAt(player.x, player.z); sfx('step', sf);
      if (ctx.W.prints && (sf === 'snow' || sf === 'sand')) { player.side = !player.side; ctx.W.prints.stamp(player.x, player.z, wx, wz, player.side ? 1 : -1); }
    }
  } else { const r = player.bob % Math.PI; player.bob += (r < Math.PI / 2 ? -r : Math.PI - r) * Math.min(1, dt * 8); }
  const targetY = floorY(player.x, player.z) + EYE + (Math.abs(Math.sin(player.bob)) - 0.5) * 0.04;
  cam3.position.set(player.x, cam3.position.y + (targetY - cam3.position.y) * Math.min(1, dt * 12), player.z);
  if (ctx.W.item && anim.sipT === null) { const b = state.item === 'smoke' ? [0.2, -0.13] : state.item === 'sparkler' ? [0.2, -0.28] : [0.22, -0.2]; ctx.hand.position.x = b[0] + Math.sin(player.bob * 0.5) * 0.01; ctx.hand.position.y = b[1] + Math.abs(Math.sin(player.bob)) * 0.012; }
}