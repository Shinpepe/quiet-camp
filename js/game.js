import * as THREE from 'three';
import { ctx, state, settings, saveSettings, DAY_LEN, records } from './state.js';
import { BG, TIME, ITEMS, SEAT, BLOCKS, EYE, PR, WAKE, CHOP, ICON, GEAR, GEAR_DEFAULT, FISHING, memoFor, ROAST, roastStage, BEACH, DREAM } from './data.js';
import { $, clamp, wrapPI, isTouch, rnd, josa } from './util.js';
import { terrainH, shoreOff } from './terrain.js';
import { makeItem, applyGear } from './props.js';
import { buildScene, precompileScene, rebakeEnv, compileReflection, applyTime } from './scene.js';
import { clockLabel, paramsAt } from './time.js';
import { initAudio, resumeAudio, setVolume, startAmbience, stopAmbience, sfx, setIndoor, menuAmbience } from './audio.js';
import { startChop, chopEye, chopYaw, chopPress, requestChopStop, resetChop, chopHooks, chopStats } from './chop.js';
import { beginFish, stopFish, resetFish, fishPress, fishActive, fishBusy, fishHint, fishHooks, fishCount } from './fish.js';
import { showJournal, hideJournal, journalHooks } from './journal.js';
import { hideAllFx, gaugeHide, toast, guide } from './gauge.js';
import { showMemo, hideMemo, memoHooks } from './memo.js';
import { snowRolling, snowSpeed, rollBlocked, snowStartable, startSnowball, rollAct, rollLabel, clearSnowman } from './snowman.js';
import { onMat, resetBeach } from './beach.js';
import { dreamOn, dreamGuide, dreamHint, dreamCenter, pickDream, startDream, beginShoot, dreamShoot, endDream, resetDream } from './dream.js';
import { onRoad, roadYaw } from './road.js';

/* ── 조작 원칙: E 는 바라보는 것, 클릭은 손에 든 것. 앉아서 아무것도 안 보면 E = 일어나기.
   장작 패기·낚시 중에는 클릭(스페이스)이 타이밍 입력이 된다.
   무엇을 바라보면 무엇이 일어나는지는 scene.js 의 W.interact 에 act 로 적는다 (act 가 없으면 그 id 의 자리에 앉는다).
   트렁크·도감·메모처럼 화면을 덮는 창이 열린 동안에는 걷기·마시기·E 안내가 멈추고, E 나 ESC 로 닫는다
   빈손일 때 바라보는 것에 click 이 있으면 클릭이 그 행동을 한다 (눈덩이·눈사람 부수기). 눈덩이를 굴리는 동안에는 E 만 쓴다 (내려놓기·눈사람 만들기).
   꿈속(dream.js)에서는 트렁크가 총을 쥐여 주고 'shoot' 모드가 된다: 걷지 않고 시선이 길 쪽 하늘로 묶이며, 클릭이 쏘기다 ── */
const FINE = matchMedia('(pointer:fine)').matches;
export const player = { x: -2.1, z: 8.2, yaw: 0, pitch: 0, bob: 0, side: false };
export const cam = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, yawFrom: 0, yawTo: 0, pitchFrom: 0, pitchTo: 0 };
/* 마시기: mouth = 잔이 입에 닿았는지, leftLips = 입술에서 떨어졌는지, lastGulp·nextSwallow = '꿀꺽' 시각
   마시멜로: roast = 불에 내미는 중, roastMin = 클릭 한 번에 최소로 내밀어 두는 남은 초, roastK = 내민 정도 0..1, eatT = 먹는 동작 0..1 (null = 안 먹는 중), ate = 이번 동작에서 이미 먹었는지, spotPrev = 지난 프레임의 굽기 가능 상태 */
export const anim = { sipT: null, holding: false, holdT: 0, exhale: 0, exhaleStr: 0, lastSteam: 0, mouth: false, leftLips: false, lastGulp: -9, nextSwallow: 0, lastTargetId: null,
  roast: false, roastMin: 0, roastK: 0, eatT: null, ate: false, spotPrev: null };
const keys = {}; let tMove = null, tLook = null;
/* 낚시하거나 돗자리에 누운 동안 맡겨 둔 손의 물건 { type, amount, cook }. 일어나면 돌려준다 */
let stashed = null;
const canvas = () => ctx.renderer.domElement;
const locked = () => document.pointerLockElement === canvas();
export const isNightClock = c => c < 0.22 || c > 0.8;
/* 트렁크에 들어 있는 물건 (마시멜로 꼬치는 아이스박스에서, 총은 꿈속에서 꺼낸다 — data.js ITEMS 의 trunk: false) */
const TRUNK = Object.keys(ITEMS).filter(k => ITEMS[k].trunk !== false), NITEMS = TRUNK.length;
const inTrunk = k => !!k && ITEMS[k].trunk !== false;
/* 화면을 덮는 창(트렁크·도감·메모)이 열려 있는지 */
const inModal = () => state.mode === 'trunk' || state.mode === 'journal' || state.mode === 'memo';

/* 지오메트리·재질을 GPU 에서 해제한다. 텍스처(softTex 등)는 여러 곳이 공유하므로 건드리지 않는다 */
function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m && m.dispose) m.dispose(); });
  });
}

/* 모바일 가상 조이스틱 */
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

/* 포인터 잠금. 브라우저가 거절하면(ESC 직후 등) 클릭 안내를 띄운다 */
function lock() {
  if (isTouch) return;
  const p = canvas().requestPointerLock();
  if (p && p.catch) p.catch(() => { const m = $('#lockmsg'); m.firstChild.textContent = '화면을 클릭하면 계속합니다'; m.style.opacity = 0.85; });
}

const timingMode = () => state.mode === 'chop' || fishActive();
function timingPress() { if (cam.t < 1 || ctx.paused) return; if (state.mode === 'chop') chopPress(); else if (fishActive()) fishPress(); }

export function bindInput() {
  /* 모바일이면 body 에 touch 를 단다 → style.css 가 키 표시(E·숫자)를 숨긴다 */
  document.body.classList.toggle('touch', isTouch);
  chopHooks.stop = endChop; chopHooks.hud = updateHUD;
  fishHooks.hud = updateHUD;
  journalHooks.close = closeJournal;
  memoHooks.close = closeMemo;
  /* 첫 입력에서 오디오를 켠다. 터치는 손을 뗄 때(pointerup)부터 소리를 켤 수 있어 둘 다 듣는다.
     모바일은 전화·앱 전환으로 오디오가 멈출 수 있어, 손을 댈 때마다 다시 깨운다 (켜져 있으면 아무 일도 없다).
     메뉴 배경음은 처음 한 번만 시작한다. 씬이 아직 없으면 main.js 의 빌드 완료 콜백이 시작한다 */
  let booted = false;
  const boot = () => { initAudio(); resumeAudio(); if (booted) return; booted = true; if (!ctx.running) menuAmbience(state.bg); };
  addEventListener('pointerdown', boot); addEventListener('pointerup', boot); addEventListener('keydown', boot, { once: true });

  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.repeat) return;
    /* Enter 의 기본 동작(포커스된 버튼의 click)을 막아 두 번 실행되지 않게 한다 */
    if (!ctx.running) { if (e.code === 'Enter' && !$('#menu').classList.contains('hidden')) { e.preventDefault(); startGame(); } return; }
    if (ctx.paused) { if (e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); resume(); } return; }
    if (e.code === 'Space' && timingMode()) { e.preventDefault(); timingPress(); return; }
    if (e.code === 'Escape' && inModal()) { closeModal(); return; }
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyP') takePhoto();
    if (state.mode === 'trunk' && /^Digit[1-9]$/.test(e.code)) trunkKey(+e.code[5]);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; tMove = tLook = null; hideJoy(); });
  addEventListener('mousemove', e => { if (!locked() || !ctx.running) return; look(e.movementX, e.movementY, 0.0022 * settings.sens); });
  document.addEventListener('pointerlockchange', () => { if (!ctx.running || isTouch) return; if (locked()) { hidePause(); $('#lockmsg').style.opacity = 0; if (!guideReady) { guideReady = true; refreshGuide(); } } else if (!inModal()) showPause(); });
  /* 모바일: 앱을 내리거나 화면이 꺼지면 일시정지 (PC 는 포인터 잠금이 풀리며 이미 멈춘다) */
  document.addEventListener('visibilitychange', () => { if (document.hidden && ctx.running && isTouch && !ctx.paused && !inModal() && state.mode !== 'sleep') showPause(); });
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
  /* 메뉴로 나가기: 잠자기 페이드·꿈·꽂아 둔 스파클라·장작 패기·낚시·열린 창을 정리하고, 자리는 운전석으로 되돌린다
     (자리가 'dock' 으로 남아 있으면 메뉴 프리뷰에서 밧줄 삐걱 소리가 난다). 맡겨 둔 물건도 버린다 */
  $('#toMenu').onclick = () => { hidePause(); ctx.running = false; endSleepUI(); resetDream(); state.mode = 'seated'; state.seat = 'car'; stashed = null; putBack(); clearPlanted(); resetChop(); resetFish(); clearSnowman(); hideAllFx(); $('#hud').classList.remove('on'); $('#trunk').classList.remove('on'); hideJournal(); hideMemo(); guideReady = false; guide(null); stopAmbience(); setIndoor(false); setVolume(settings.vol); menuAmbience(state.bg); $('#menu').classList.remove('hidden'); ctx.hand.visible = false; hideJoy(); };
  $('#photoBtn').onclick = () => { hidePause(); setTimeout(takePhoto, 50); lock(); };
  /* 길게 누르기: 포인터를 버튼에 붙잡아 두어 손가락이 살짝 움직여도 놓치지 않는다.
     옆 버튼(mSip)은 누르는 순간 동작하고, 그 결과 숨으면 행동 버튼(mAct)이 그 자리로 밀려온다.
     손을 뗄 때 브라우저가 보내는 click 이 행동 버튼에 떨어지지 않게, 옆 버튼을 누르거나 뗀 뒤 0.5초 동안은 행동 버튼 클릭을 무시한다
     (예: 눈덩이를 부수자마자 발밑에서 "눈 뭉치기"가 눌려 새 눈덩이가 생기던 문제) */
  const ms = $('#mSip'); let sipTouchT = -1e9;
  ms.onpointerdown = e => { e.preventDefault(); sipTouchT = performance.now(); try { ms.setPointerCapture(e.pointerId); } catch (_) {} useItem(); };
  ms.onpointerup = ms.onpointercancel = () => { sipTouchT = performance.now(); endSip(); };
  ms.oncontextmenu = e => e.preventDefault();
  $('#mAct').onclick = () => { if (performance.now() - sipTouchT < 500) return; interact(); };
  $('#start').onclick = startGame;
  /* 슬라이더: 같은 키의 메뉴·일시정지 슬라이더를 함께 움직이고 저장한다.
     map 을 주면 슬라이더 값과 설정 값을 서로 바꿔 준다 (하루 길이: 단계 번호 0..3 ↔ 30·60·120·240분) */
  const bindRange = (id, key, fmt, apply, map) => {
    const el = $('#' + id), toUI = map ? map.toUI : v => v, fromUI = map ? map.fromUI : v => v;
    el.dataset.k = key; el.value = toUI(settings[key]);
    const paint = () => document.querySelectorAll('[id^=' + key + 'V]').forEach(l => { l.textContent = fmt(settings[key]); });
    paint();
    el.oninput = () => { settings[key] = fromUI(+el.value); document.querySelectorAll('input[data-k=' + key + ']').forEach(o => { o.value = el.value; }); paint(); apply && apply(settings[key]); saveSettings(); };
  };
  bindRange('vol', 'vol', v => Math.round(v * 100) + '%', setVolume); bindRange('vol2', 'vol', v => Math.round(v * 100) + '%', setVolume);
  bindRange('sens', 'sens', v => v.toFixed(1)); bindRange('sens2', 'sens', v => v.toFixed(1));
  /* 하루 길이: 바꾸는 즉시 시간이 흐르는 속도만 달라진다 (지금 시각은 그대로) */
  const dayMap = { toUI: v => Math.max(0, DAY_LEN.indexOf(v)), fromUI: i => DAY_LEN[i] }, dayFmt = m => m < 60 ? m + '분' : m / 60 + '시간';
  bindRange('day', 'dayMin', dayFmt, null, dayMap); bindRange('day2', 'dayMin', dayFmt, null, dayMap);
  bindToggle('flow', 'flow', () => {});
  bindToggle('shadow', 'shadow', on => {
    ctx.renderer.shadowMap.enabled = on; ctx.renderer.shadowMap.needsUpdate = true;
    if (ctx.W.sun) ctx.W.sun.castShadow = on;
    if (ctx.W.fireLight) ctx.W.fireLight.castShadow = on && FINE;
    if (ctx.scene) ctx.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
  });
  bindToggle('bloom', 'bloom', on => ctx.post.setBloom(on));
  bindToggle('ao', 'ao', on => ctx.post.setAO(on));
  /* 물 반사: 켜는 순간 로딩 화면 뒤에서 클리핑 셰이더를 만들어 두면, 시작할 때 씬을 다시 빌드하지 않는다 */
  bindToggle('reflect', 'reflect', on => {
    if (ctx.W.water) ctx.W.water.material.uniforms.uReflect.value = on && FINE ? 1 : 0;
    if (on && FINE && ctx.W.water && !builtReflect && !ctx.compiling) {
      $('#loading').classList.add('on');
      setTimeout(() => { compileReflection(); builtReflect = true; $('#loading').classList.remove('on'); }, 40);
    }
  });
  renderMenu();
}
/* 시선. 장작을 패는 동안에는 그루터기 주변으로, 낚시하는 동안에는 물 쪽 180° · 아래 약 20° 까지만, 돗자리에 누우면 바다 쪽으로,
   꿈속에서 총을 든 동안에는 길이 뻗어 나가는 쪽 하늘로만 */
function look(dx, dy, s) {
  player.yaw -= dx * s; player.pitch = clamp(player.pitch - dy * s, -1.3, 1.3);
  if (state.mode === 'chop' && cam.t >= 1) {
    const cy = chopYaw();
    player.yaw = cy + clamp(wrapPI(player.yaw - cy), -CHOP.look[0], CHOP.look[0]);
    player.pitch = clamp(player.pitch, CHOP.pitch - CHOP.look[1], CHOP.pitch + CHOP.look[1]);
  } else if (fishActive() && cam.t >= 1) {
    player.yaw = clamp(wrapPI(player.yaw), -FISHING.yaw, FISHING.yaw);
    player.pitch = clamp(player.pitch, FISHING.pitch[0], FISHING.pitch[1]);
  } else if (state.mode === 'seated' && state.seat === 'mat' && cam.t >= 1) {
    /* 돗자리에 누워서: 바다 쪽 좌우 약 100°, 수평선부터 거의 머리 위까지 */
    player.yaw = clamp(wrapPI(player.yaw), -BEACH.look[0], BEACH.look[0]);
    player.pitch = clamp(player.pitch, BEACH.look[1], BEACH.look[2]);
  } else if (state.mode === 'shoot' && cam.t >= 1) {
    const c = dreamCenter();
    player.yaw = c + clamp(wrapPI(player.yaw - c), -DREAM.look[1], DREAM.look[1]);
    player.pitch = clamp(player.pitch, DREAM.look[2], DREAM.look[3]);
  }
}
function resume() { hidePause(); lock(); }

/* ── 조준: 조준점이 물체의 실루엣 안에 있는 것 ──
   r = 상호작용 점까지의 바닥 기준 수평 거리 (눈높이 때문에 낮은 물건이 손해 보지 않게).
   실루엣 크기(hit)는 실제 거리로 잰 각도라 3D 거리를 쓴다 */
const fwd = new THREE.Vector3(), toT = new THREE.Vector3();
export function currentTarget() {
  if (cam.t < 1 || inModal() || state.mode === 'sleep' || state.mode === 'chop' || snowRolling()) return null;
  const from = state.mode === 'walk' ? 'walk' : state.seat;
  ctx.camera.getWorldDirection(fwd); let best = null, bs = 9;
  for (const it of ctx.W.interact) {
    if (!(it.from || ['walk']).includes(from)) continue;
    toT.set(it.pos[0], it.pos[1], it.pos[2]).sub(ctx.camera.position);
    if (Math.hypot(toT.x, toT.z) > it.r) continue;
    const d = toT.length(); toT.normalize();
    const ang = Math.acos(clamp(toT.dot(fwd), -1, 1)), edge = Math.atan((it.hit || 0.5) / Math.max(d, 0.2)), s = ang - edge;
    if (s > 0.1) continue;
    if (s < bs) { bs = s; best = it; }
  }
  return best;
}
function startMove(to, yawTo, pitchTo) { cam.from.copy(ctx.camera.position); cam.to.copy(to); cam.t = 0; cam.yawFrom = wrapPI(player.yaw); cam.yawTo = yawTo; cam.pitchFrom = player.pitch; cam.pitchTo = pitchTo === undefined ? player.pitch : pitchTo; }
export function sitDown(id, quiet) {
  const st = SEAT[id]; state.mode = 'seated'; state.seat = id;
  /* 부두 끝·돗자리: 물 쪽(정면)을 본다. 돗자리는 하늘을 반쯤 올려다보며 눕는다 */
  const sea = id === 'dock' || id === 'mat';
  const yawTo = sea ? 0 : wrapPI(player.yaw), pitchTo = quiet ? 0 : id === 'dock' ? -0.08 : id === 'mat' ? BEACH.lie : undefined;
  startMove(new THREE.Vector3(...st.pos), yawTo, pitchTo);
  if (!quiet) { if (id === 'car') { sfx('doorOpen'); setTimeout(() => sfx('doorClose'), 900); } else if (id === 'tent') sfx('zipper'); else sfx('sit'); }
  setIndoor(id === 'tent' || id === 'car');
}
function standUp() {
  const st = SEAT[state.seat];
  if (state.seat === 'dock') stopFish();
  if (state.seat === 'car') { sfx('doorOpen'); setTimeout(() => sfx('doorClose'), 900); } else if (state.seat === 'tent') sfx('zipper', 'close'); else sfx('stand');
  player.x = st.stand[0]; player.z = st.stand[1]; state.mode = 'walk'; state.seat = null; startMove(new THREE.Vector3(player.x, floorY(player.x, player.z) + EYE, player.z), wrapPI(player.yaw), 0); setIndoor(false);
  restoreStashed();
}
/* 앉기 전에 손에 든 것을 맡겨 둔다 (일어날 때 standUp → restoreStashed 가 남은 양 그대로 돌려준다).
   타는 스파클라는 먼저 꽂게 한다 (장작 패기와 같은 규칙). 맡길 수 없으면 false */
function stashHand() {
  if (ctx.W.item && ctx.W.item.userData.lit) { showToast('스파클라를 먼저 땅에 꽂자'); return false; }
  if (state.item && ctx.W.item) { const u = ctx.W.item.userData; stashed = { type: state.item, amount: u.amount, cook: u.cook }; putBack(); }
  return true;
}
/* 부두 끝에 앉으면 손에 든 것을 맡겨 두고 낚싯대를 든다 */
export function startFishing() {
  if (!stashHand()) return;
  sitDown('dock'); if (!beginFish()) showToast('여기서는 낚시를 할 수 없다');
}
/* 해변 돗자리에 눕는다. 누워서 마시지는 않으므로 손에 든 것은 낚시처럼 맡겨 둔다 */
export function lieDown() {
  if (!stashHand()) return;
  sitDown('mat');
}
/* 맡겨 둔 물건을 다시 손에 든다. 트렁크에서 꺼낼 때와 달리 붓는 소리·얼음 소리는 내지 않는다 */
function restoreStashed() {
  const s = stashed; stashed = null; if (!s) return;
  const it = makeItem(s.type), ud = it.userData;
  ud.amount = s.amount; ud.setAmount(s.amount); if (ud.setCook && s.cook !== undefined) ud.setCook(s.cook);
  state.item = s.type; ctx.hand.add(it); ctx.W.item = it; resetHand();
  showToast(josa(ITEMS[s.type].name, '을', '를') + ' 다시 들었다');
}
export function toggleFire() { const W = ctx.W; W.fireLit = !W.fireLit; sfx(W.fireLit ? 'fireOn' : 'fireOff'); showToast(W.fireLit ? '불을 피웠다' : '불을 껐다'); }
const LAMP = { lantern: { flag: 'lanternLit', name: '랜턴' }, tentLamp: { flag: 'tentLampLit', name: '텐트 랜턴' }, dome: { flag: 'domeLit', name: '실내등' } };
export function toggleLamp(k) { const L = LAMP[k]; ctx.W[L.flag] = !ctx.W[L.flag]; sfx(k === 'dome' ? 'ui' : ctx.W[L.flag] ? 'lampOn' : 'lampOff'); showToast(josa(L.name, '을', '를') + (ctx.W[L.flag] ? ' 켰다' : ' 껐다')); }

export function interact() {
  if (cam.t < 1 || ctx.paused || state.mode === 'sleep') return;
  if (state.mode === 'trunk') { closeTrunk(); return; }
  if (state.mode === 'journal') { closeJournal(); return; }
  if (state.mode === 'memo') { closeMemo(); return; }
  if (state.mode === 'chop') { requestChopStop(); return; }
  /* 물고기와 씨름하거나 들어 올린 동안에는 일어나지 않는다 */
  const busy = fishBusy(); if (busy) { showToast(busy); return; }
  /* 눈덩이를 굴리는 중: 내려놓거나, 다른 눈덩이에 붙어 있으면 눈사람을 만든다 */
  if (snowRolling()) rollAct();
  else {
    const t = currentTarget();
    if (t) { if (t.act) t.act(); else sitDown(t.id); }
    else if (state.mode === 'walk' && snowStartable()) startSnowball();
    else if (state.mode === 'seated') { if (state.seat === 'bed') sitDown('tent', true); else standUp(); }
  }
  updateHUD(); anim.lastTargetId = undefined;
}

/* ── 장작 패기: 지금 서 있는 쪽에서 그루터기를 바라보고 선다. 손에 든 것은 잠시 숨긴다 ── */
export function beginChop() {
  if (ctx.W.item && ctx.W.item.userData.lit) { showToast('스파클라를 먼저 땅에 꽂자'); return; }
  if (!startChop(player.x, player.z, (x, z) => !blockedAt(x, z))) { showToast('조금 비켜서 다시 해 보자'); return; }
  anim.sipT = null; anim.holding = false; anim.mouth = false; anim.roast = false; anim.roastK = 0; anim.eatT = null;
  if (state.item === 'marsh') { const u = ctx.W.item.userData; u.burnT = 0; u.setBurn(0); }
  if (state.item) resetHand(); ctx.hand.visible = false;
  const eye = chopEye();
  state.mode = 'chop'; state.seat = null; player.x = eye.x; player.z = eye.z;
  startMove(eye.clone(), chopYaw(), CHOP.pitch); updateHUD();
}
function endChop() {
  state.mode = 'walk'; ctx.hand.visible = true;
  startMove(new THREE.Vector3(player.x, floorY(player.x, player.z) + EYE, player.z), wrapPI(player.yaw), 0); updateHUD();
}

export function openTrunk() {
  if (dreamOn()) { takeGun(); return; }
  state.mode = 'trunk'; $('#trunk').classList.add('on'); sfx('trunkOpen'); if (!isTouch) document.exitPointerLock(); renderTrunk(); updateHUD();
}
/* 꿈속의 트렁크: 창을 여는 대신 총을 쥐고, 길이 뻗어 나가는 쪽 하늘을 올려다본다 (road.js roadYaw).
   트렁크 뚜껑은 W.trunkT 동안 잠깐 열린다 (main.js) */
function takeGun() {
  if (ctx.W.item && ctx.W.item.userData.lit) { showToast('스파클라를 먼저 땅에 꽂자'); return; }
  ctx.W.trunkT = 1.4; sfx('trunkOpen'); setTimeout(() => sfx('trunkClose'), 1300);
  pickItem('gun'); showToast('하늘에서 무언가 떨어진다');
  const y0 = roadYaw(player.x, player.z);
  state.mode = 'shoot'; anim.lastTargetId = undefined;
  startMove(ctx.camera.position.clone(), y0, DREAM.look[0]);
  beginShoot(y0); $('#cross').classList.add('aim'); updateHUD();
}
function closeTrunk() { if (state.mode !== 'trunk') return; state.mode = 'walk'; $('#trunk').classList.remove('on'); sfx('trunkClose'); lock(); updateHUD(); }
/* ── 물고기 도감: 부두 끝 태클 상자 위의 노트. 열고 닫을 때 종이가 스치는 부드러운 소리(천 스침 소리를 함께 쓴다) ── */
export function openJournal() { state.mode = 'journal'; anim.holding = false; showJournal(); sfx('rodUp'); if (!isTouch) document.exitPointerLock(); updateHUD(); }
function closeJournal() { if (state.mode !== 'journal') return; state.mode = 'walk'; hideJournal(); sfx('rodUp'); lock(); updateHUD(); }

/* ── 캠핑 메모: 조수석 담요 위의 줄노트. 운전석에서만 열 수 있고, 닫으면 다시 운전석에 앉은 채로 돌아온다.
   열면 지금 장소 메모에 적힌 줄의 이름표를 "읽음"으로 남긴다 (state.js records.memoRead) ── */
export function openMemo() {
  const list = memoFor(state.bg);
  state.mode = 'memo'; anim.holding = false; showMemo(list); sfx('rodUp'); if (!isTouch) document.exitPointerLock();
  let added = false; list.forEach(m => { if (!records.memoRead.includes(m.key)) { records.memoRead.push(m.key); added = true; } });
  if (added) saveSettings();
  updateHUD();
}
function closeMemo() { if (state.mode !== 'memo') return; state.mode = 'seated'; hideMemo(); sfx('rodUp'); lock(); updateHUD(); }
/* ESC 로 닫기: 지금 열린 창을 닫는다 */
function closeModal() { if (state.mode === 'trunk') closeTrunk(); else if (state.mode === 'journal') closeJournal(); else closeMemo(); }

/* ── 안내: 소식 자리에 거둘 때까지 떠 있는 한 줄 ──
   꿈속이면 꿈의 안내("차 트렁크를 확인해 보자")가 우선이다.
   그 밖에는 지금 장소의 메모에 아직 안 읽은 줄이 있으면 메모 안내를 띄운다.
   시작 직후에는 띄우지 않는다: PC 는 화면을 클릭해 조작이 시작된 뒤, 모바일은 화면이 밝아진 뒤부터 (guideReady).
   운전석에 앉아 있으면 "내리기 전에…", 그 밖에서는 "차 조수석의…". 잠자는 동안에는 숨긴다.
   updateHUD 가 부를 때마다 다시 판단하므로 자리·모드가 바뀌면 문구도 따라 바뀐다 */
let guideReady = false, guideSess = 0;
const memoUnread = () => memoFor(state.bg).some(m => !records.memoRead.includes(m.key));
function refreshGuide() {
  if (!ctx.running || !guideReady || state.mode === 'sleep') { guide(null); return; }
  if (dreamOn()) { guide(dreamGuide()); return; }
  if (!memoUnread()) { guide(null); return; }
  guide(state.mode === 'seated' && state.seat === 'car' ? '내리기 전에 조수석 메모를 보자' : '차 조수석의 메모를 보자');
}

/* ── 아이스박스: 바라보고 E. 꼬치가 없으면 마시멜로 꼬치를 꺼내고, 들고 있으면(빈 꼬치 포함) 넣는다.
   꺼낼 때 들고 있던 다른 물건은 트렁크에서 고를 때처럼 내려놓는다. 뚜껑이 열렸다 닫힌다 (main.js 가 W.coolerT 동안 연다) ── */
export function useCooler() {
  if (ctx.W.item && ctx.W.item.userData.lit) { showToast('스파클라를 먼저 땅에 꽂자'); return; }
  ctx.W.coolerT = 0.7; sfx('cooler'); setTimeout(() => sfx('cooler', 'close'), 1100);
  if (state.item === 'marsh') { putBack(); showToast('꼬치를 넣었다'); } else pickItem('marsh');
}

/* ── 마시멜로 굽기: 서서 모닥불 가까이(ROAST.near) 불꽃 자리를 바라볼 때만 굽는다 ──
   roastSpot: 'roast' = 구울 수 있음, 'cold' = 불이 꺼져 있음, null = 굽는 자리가 아님(클릭하면 먹는다) */
const FIRE = new THREE.Vector3(...ROAST.fire), _rv = new THREE.Vector3(), _rf = new THREE.Vector3();
/* 꼬치 끝이 닿을 자리: 모닥불 가운데에서 플레이어 쪽으로 12cm, 불꽃 높이 */
export function roastTarget(out) {
  const c = ctx.camera.position, dx = c.x - FIRE.x, dz = c.z - FIRE.z, d = Math.hypot(dx, dz) || 1;
  return out.set(FIRE.x + dx / d * 0.12, FIRE.y, FIRE.z + dz / d * 0.12);
}
export function roastSpot() {
  if (state.item !== 'marsh' || state.mode !== 'walk' || cam.t < 1 || ctx.paused) return null;
  const ud = ctx.W.item && ctx.W.item.userData; if (!ud || ud.amount <= 0) return null;
  const c = ctx.camera.position; if (Math.hypot(c.x - FIRE.x, c.z - FIRE.z) > ROAST.near) return null;
  roastTarget(_rv).sub(c).normalize(); ctx.camera.getWorldDirection(_rf);
  if (_rv.dot(_rf) < Math.cos(ROAST.aim)) return null;
  return ctx.W.fireLit ? 'roast' : 'cold';
}
/* 클릭: 굽는 자리면 불에 내민다(클릭 = 0.9초 한 번, 길게 = 누르는 동안 계속). 아니면 먹는다 */
function marshPress() {
  const ud = ctx.W.item.userData;
  if (anim.eatT !== null) return;
  if (ud.amount <= 0) { showToast('빈 꼬치는 아이스박스에 넣자'); return; }
  const spot = roastSpot();
  if (spot === 'cold') { showToast('불을 먼저 피우자'); return; }
  if (spot === 'roast') { anim.roast = true; anim.holding = true; anim.roastMin = 0.9; return; }
  if (anim.roastK > 0.05) return;
  anim.eatT = 0; anim.ate = false;
}
/* 먹는 동작의 한가운데(마시멜로가 입에 닿을 때) main.js 가 부른다 */
export function eatMarsh() {
  const ud = ctx.W.item && ctx.W.item.userData; if (state.item !== 'marsh' || !ud || ud.amount <= 0) return;
  const s = roastStage(ud.cook);
  ud.amount = 0; ud.setAmount(0); ud.burnT = 0; ud.setBurn(0);
  sfx('eat', s); showToast(ROAST.eat[s]); updateHUD();
}

function trunkKey(n) { sfx('ui'); if (n <= NITEMS) { pickItem(TRUNK[n - 1]); closeTrunk(); } else if (n === NITEMS + 1 && inTrunk(state.item)) { putBack(); closeTrunk(); } }
function renderTrunk() {
  const box = $('#trunkItems'); box.innerHTML = '';
  TRUNK.forEach((k, i) => { const v = ITEMS[k], d = document.createElement('button'); d.className = 'card'; d.innerHTML = `<div class="ic">${v.ic}</div><div class="nm">${v.name}</div><div class="ds">${v.ds}</div><kbd>${i + 1}</kbd>`; d.onclick = () => trunkKey(i + 1); box.append(d); });
  if (inTrunk(state.item)) { const d = document.createElement('button'); d.className = 'card'; d.innerHTML = `<div class="ic">${ICON_BACK}</div><div class="nm">내려놓기</div><div class="ds">${josa(ITEMS[state.item].name, '을', '를')} 다시 넣는다</div><kbd>${NITEMS + 1}</kbd>`; d.onclick = () => trunkKey(NITEMS + 1); box.append(d); }
}
const ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-3"/></svg>';
function pickItem(type) { putBack(); state.item = type; const it = makeItem(type); ctx.hand.add(it); ctx.W.item = it; resetHand(); sfx('pick', type); showToast(josa(ITEMS[type].name, '을', '를') + ' 챙겼다'); }
/* 손에 든 것을 내려놓는다. 떼어 내기 전에 GPU 자원을 해제한다 */
export function putBack() { state.item = null; disposeTree(ctx.hand); ctx.hand.clear(); ctx.W.item = null; anim.sipT = null; anim.holding = false; anim.holdT = 0; anim.mouth = false; anim.roast = false; anim.roastK = 0; anim.eatT = null; anim.ate = false; }
/* 땅에 꽂힌 스파클라를 모두 치운다 (메뉴로 나갈 때, 잠들 때, 같은 씬으로 다시 시작할 때) */
function clearPlanted() {
  const W = ctx.W; if (!W.planted) return;
  W.planted.forEach(s => { ctx.scene.remove(s.g); disposeTree(s.g); });
  W.planted = [];
}
export function resetHand() {
  const h = ctx.hand;
  if (state.item === 'marsh') { h.position.set(0.24, -0.4, -0.42); h.rotation.set(0.85, 0.12, 0); return; }
  else if (state.item === 'smoke') { h.position.set(0.2, -0.13, -0.4); h.rotation.set(0, 0.6, 0.15); }
  else if (state.item === 'sparkler') { h.position.set(0.2, -0.28, -0.55); h.rotation.set(-0.2, 0, -0.25); }
  else if (state.item === 'gun') { h.position.set(0.2, -0.2, -0.42); h.rotation.set(0.05, 0, 0); }
  else { h.position.set(0.22, -0.2, -0.45); h.rotation.set(0, 0, 0); }
}

/* ── 손에 든 것 사용: 마실 것·담배는 길게, 스파클라는 클릭으로 점화 → 다시 클릭으로 땅에 꽂기, 꿈속의 총은 클릭으로 쏘기.
   장작 패기·낚시 중이면 클릭이 타이밍 입력. 마시는 소리('꿀꺽')는 main.js 가 잔의 움직임에 맞춰 낸다 ── */
function useItem() {
  if (timingMode()) { timingPress(); return; }
  /* 빈손 클릭: 바라보는 것에 클릭 행동(click)이 있으면 한다 — 눈덩이·눈사람 부수기 */
  if (!state.item) {
    if (state.mode === 'walk' && !snowRolling() && !inModal() && !ctx.paused && cam.t >= 1) { const t = currentTarget(); if (t && t.click) t.click(); }
    return;
  }
  if (!ctx.W.item || inModal() || state.mode === 'sleep' || ctx.paused || cam.t < 1) return;
  if (state.item === 'gun') { dreamShoot(); return; }
  if (state.item === 'sparkler') { if (ctx.W.item.userData.lit) plantSparkler(); else igniteSparkler(); return; }
  if (state.item === 'marsh') { marshPress(); return; }
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
/* 타는 스파클라를 앞쪽 땅에 꽂는다 (서 있을 때만). 남은 양을 이어받아 계속 탄다.
   그룹은 지면 기울기에 맞춰 세우고(발밑 데칼이 땅에 붙게), 스틱만 살짝 비뚤게 */
const _UP = new THREE.Vector3(0, 1, 0), _nrm = new THREE.Vector3();
function plantSparkler() {
  const it = ctx.W.item, ud = it.userData; if (!ud.lit) return;
  if (state.mode !== 'walk') { showToast('일어서서 꽂자'); return; }
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

/* ── 잠자기: 보통은 다음 아침 7시(WAKE)에 깬다.
   꿈을 꾸면(pickDream — 처음 잠들 때는 반드시) 잠자기 시계가 0:00 까지 돌아가 멈추고, 꿈속 밤에 깨어난다 (dream.js startDream).
   꿈에서 깰 때(wake)는 화면이 흐려지며 어두워지고, 시계가 0:00 → 7:00 으로 돌아 아침의 침낭에서 깬다.
   꿈속에서 침낭에 다시 누워도, 운석 막기가 끝나도(dream.js) wake 로 깬다 ── */
const sleep = { on: false, phase: '', t: 0, from: 0, to: 0, wake: false, dream: false };
export function startSleep(wake) {
  if (sleep.on) return;
  sleep.wake = wake === true || dreamOn(); sleep.dream = false;
  sleep.on = true; sleep.phase = 'in'; sleep.t = 0; state.mode = 'sleep'; anim.holding = false; anim.sipT = null; anim.mouth = false; anim.roast = false; anim.eatT = null;
  const f = $('#fade'); f.style.transition = 'opacity 1.6s'; f.style.opacity = 1;
  $('#prompt').classList.remove('on'); $('#cross').style.display = 'none'; $('#legend').style.display = 'none';
  if (sleep.wake) canvas().style.filter = 'blur(10px)'; else sfx('bag');
  updateHUD();
}
/* 잠자기 화면을 정리한다. 잠자는 도중(페이드가 검은 상태)이었다면 페이드도 걷어 낸다. 흐림·조준 모양도 되돌린다 */
function endSleepUI() {
  const was = sleep.on; sleep.on = false; sleep.phase = ''; sleep.t = 0;
  $('#sleep').classList.remove('on');
  const f = $('#fade'); f.style.transition = ''; if (was) f.style.opacity = 0;
  $('#cross').style.display = ''; $('#cross').classList.remove('aim'); $('#legend').style.display = '';
  canvas().style.filter = '';
}
export function updateSleep(dt) {
  if (!sleep.on) return; sleep.t += dt;
  const f = $('#fade'), st = $('#sleep');
  if (sleep.phase === 'in') {
    setVolume(settings.vol * Math.max(0.12, 1 - sleep.t / 1.6));
    if (sleep.t >= 1.7) {
      const b = SEAT.bed; state.seat = 'bed'; ctx.camera.position.set(...b.pos); player.yaw = b.yaw; player.pitch = b.pitch; cam.t = 1; putBack();
      if (sleep.wake) endDream(); else sleep.dream = pickDream();
      setIndoor(true);
      sleep.from = state.clock; sleep.to = sleep.dream ? 1 : state.clock < WAKE ? WAKE : 1 + WAKE; sleep.phase = 'night'; sleep.t = 0;
      st.classList.add('on'); ctx.W.fireLit = false;
      clearPlanted();
    }
  } else if (sleep.phase === 'night') {
    const k = Math.min(1, sleep.t / 4.5), e = k * k * (3 - 2 * k);
    state.clock = k >= 1 ? (sleep.dream ? 0 : WAKE) : (sleep.from + (sleep.to - sleep.from) * e) % 1;
    $('#sleepText').textContent = clockLabel(state.clock);
    if (k >= 1) {
      /* 하늘·주변광을 새 시각에 바로 맞춘다 (꿈이면 startDream 이 꿈 색으로) */
      if (sleep.dream) startDream(); else { paramsAt(state.clock, ctx.W.tm); applyTime(); rebakeEnv(); }
      ctx.W.envT = 0; sleep.phase = 'out'; sleep.t = 0; st.classList.remove('on'); f.style.opacity = 0; canvas().style.filter = '';
    }
  } else if (sleep.phase === 'out') {
    setVolume(settings.vol * Math.min(1, 0.12 + sleep.t / 1.6));
    if (sleep.t >= 1.7) {
      const dream = sleep.dream;
      endSleepUI(); setVolume(settings.vol); state.mode = 'seated'; updateHUD(); anim.lastTargetId = undefined;
      showToast(dream ? '아직 밤이다' : '아침이 왔다');
    }
  }
}

/* 소식(위쪽 토스트)은 gauge.js 가 띄운다 — 낚시·장작 패기도 같은 곳을 쓰도록 한 곳에 모았다 */
export const showToast = toast;
export function updateCaption() { $('#capText').textContent = BG[state.bg].name + ' — ' + clockLabel(state.clock); }
/* 아이템 상자: 첫 줄 = 이름(+ 기록), 둘째 줄 = 조작 안내 */
export function updateHUD() {
  updateCaption();
  refreshGuide();
  const ib = $('#itembox'), chop = state.mode === 'chop', fish = fishActive(), btn = isTouch ? '버튼 :' : '클릭 :';
  const covered = inModal() || state.mode === 'sleep';
  const mud = state.item === 'marsh' && ctx.W.item && ctx.W.item.userData, marshEmpty = !!mud && mud.amount <= 0;
  ib.classList.toggle('on', chop || fish || (!!state.item && !covered));
  /* 기록은 이름 줄 안에 넣는다 — .hn 은 모바일 세로에서 숨겨진다 */
  const sub = t => `<span style="display:block;font-size:.82em;opacity:.8;margin-top:2px">${t}</span>`;
  if (chop) {
    const s = chopStats();
    ib.querySelector('.ic').innerHTML = ICON.axe; ib.querySelector('.nm').innerHTML = '도끼' + sub(`쪼갠 장작 ${s.count} / 최고 ${s.best}연속`);
    ib.querySelector('.hn').textContent = '';
    $('#mSip').textContent = '내려치기';
  } else if (fish) {
    const n = fishCount(), [hn, act] = fishHint(btn);
    ib.querySelector('.ic').innerHTML = ICON.rod; ib.querySelector('.nm').innerHTML = '낚싯대' + (n ? sub(`잡은 물고기 ${n}`) : '');
    ib.querySelector('.hn').textContent = hn; $('#mSip').textContent = act;
  } else if (state.item === 'marsh') {
    /* 익음 단계는 글자로 보여 주지 않는다 — 색으로만 판단하게 */
    const def = ITEMS.marsh, spot = roastSpot();
    ib.querySelector('.ic').innerHTML = def.ic; ib.querySelector('.nm').textContent = def.name;
    ib.querySelector('.hn').textContent = marshEmpty ? '빈 꼬치. 아이스박스에 넣기' : spot === 'roast' ? btn + ' 불에 굽기, 길게 누르면 계속' : spot === 'cold' ? '불을 피우면 구울 수 있다' : btn + ' 먹기';
    $('#mSip').textContent = spot ? '굽기' : '먹기';
  } else if (state.item === 'gun') {
    /* 꿈속의 총: 이름 아래 줄에 막아 낸 운석, 안내 줄에 남은 시간 (dream.js 가 1초마다 updateHUD 를 부른다) */
    const [line, hn] = dreamHint(btn);
    ib.querySelector('.ic').innerHTML = ICON.gun; ib.querySelector('.nm').innerHTML = ITEMS.gun.name + (line ? sub(line) : '');
    ib.querySelector('.hn').textContent = hn; $('#mSip').textContent = ITEMS.gun.act;
  } else if (state.item) {
    const def = ITEMS[state.item], ud = ctx.W.item && ctx.W.item.userData, empty = ud && ud.amount <= 0;
    ib.querySelector('.ic').innerHTML = def.ic; ib.querySelector('.nm').textContent = def.name;
    ib.querySelector('.hn').textContent = empty ? '비었다. 트렁크에서 새로 꺼내기' : ud && ud.lit ? btn + ' 땅에 꽂기 (타는 중)' : btn + ' ' + def.act + (def.hold ? ', 길게 누르면 계속' : '');
    $('#mSip').textContent = ud && ud.lit ? '땅에 꽂기' : def.act;
  }
  $('#mSip').style.display = chop || fish || (state.item && !covered && !marshEmpty) ? '' : 'none';
  anim.lastTargetId = undefined; updatePrompt();
}
/* 모바일 행동 버튼: 지금 할 수 있는 행동 이름을 그대로 버튼에 쓴다 (E 안내 대신).
   할 것이 없으면 숨긴다 — 자리는 그대로 두어(visibility) 옆 버튼이 움직이지 않게.
   글자가 바뀌면 살짝 튀어 올라 눈에 띄게 한다 (style.css 의 .pop) */
function setAct(text) {
  const b = $('#mAct');
  if (!text) { b.style.visibility = 'hidden'; return; }
  if (b.textContent !== text || b.style.visibility === 'hidden') {
    b.textContent = text; b.style.visibility = '';
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  }
}
/* 안내: PC 는 화면 가운데 "E 행동 · 클릭 행동", 모바일은 행동 버튼(E)과 옆 버튼(빈손 클릭)의 글자. 조준 표시(가운데 동그라미)는 둘 다 같다.
   굴리는 중에는 "내려놓기 / 눈사람 만들기", 설산에서 빈손으로 발밑을 보면 "눈 뭉치기" */
export function updatePrompt() {
  const p = $('#prompt'), cross = $('#cross');
  const off = () => { p.classList.remove('on'); cross.classList.remove('hot'); if (isTouch) setAct(null); };
  if (inModal() || state.mode === 'sleep') { off(); anim.lastTargetId = null; return; }
  /* 물고기와 씨름하거나 들어 올린 동안에는 E 가 막혀 있으므로 안내도(모바일은 버튼도) 숨긴다 */
  if (fishBusy()) { if (anim.lastTargetId !== 'fishBusy') { anim.lastTargetId = 'fishBusy'; off(); } return; }
  const chop = state.mode === 'chop', roll = snowRolling(), rl = roll ? rollLabel() : null, t = currentTarget();
  const start = !t && !roll && state.mode === 'walk' && snowStartable();
  const id = roll ? 'roll:' + rl : t ? t.id : start ? 'snowStart' : state.mode === 'seated' ? 'up' : chop ? 'chopUp' : null;
  if (id === anim.lastTargetId) return; anim.lastTargetId = id;
  const label = roll ? rl : t ? t.label() : start ? '눈 뭉치기' : state.mode === 'seated' ? SEAT[state.seat].up : chop ? '그만하기' : null;
  const clickLab = t && t.click && !state.item ? t.clickLabel() : null;
  cross.classList.toggle('hot', !!t || rl === '눈사람 만들기');
  if (isTouch) {
    p.classList.remove('on'); setAct((t && t.tap) || label);
    /* 빈손으로 서 있을 때 옆 버튼은 클릭 행동(부수기) 자리 — 할 것이 없으면 숨긴다 */
    if (state.mode === 'walk' && !state.item) { const ms = $('#mSip'); ms.style.display = clickLab ? '' : 'none'; if (clickLab) ms.textContent = clickLab; }
    return;
  }
  const parts = [];
  if (label) parts.push(`<kbd class="a">E</kbd>${label}`);
  if (clickLab) parts.push(`<kbd class="a">클릭</kbd>${clickLab}`);
  if (parts.length) { p.innerHTML = parts.join('<span style="opacity:.5;margin:0 .6em">·</span>'); p.classList.add('on'); } else p.classList.remove('on');
}
function showPause() { if (!ctx.paused) sfx('uiOpen'); ctx.paused = true; anim.holding = false; gaugeHide(); $('#pause').classList.add('on'); $('#pauseSub').textContent = BG[state.bg].name + ' / ' + clockLabel(state.clock); }
function hidePause() { if (ctx.paused) sfx('uiClose'); ctx.paused = false; $('#pause').classList.remove('on'); }

/* ── 사진: 지금 화면에 장소·시각 캡션을 얹어 저장한다.
   WebGL 버퍼는 표시 뒤 비워질 수 있어 같은 태스크 안에서 한 프레임을 다시 그리고 바로 복사한다.
   모바일은 공유 시트를 먼저 시도하고, 안 되면 내려받기 ── */
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
/* 프리뷰 씬을 재사용할 때 새로 빌드한 것과 같은 출발점으로 되돌린다 */
function resetSceneForStart() {
  const W = ctx.W, tm = W.tm;
  W.fireLit = tm.stars > 0.1; W.lanternLit = tm.lantern > 0.5; W.tentLampLit = tm.tentLamp > 0.5;
  clearPlanted(); resetChop(); resetFish(); clearSnowman(); resetBeach(); resetDream(); hideAllFx(); W.splitCount = 0; W.trunkT = 0;
}
let rebuildT = null;
export function previewRebuild() { const f = $('#fade'); f.style.opacity = 1; clearTimeout(rebuildT); rebuildT = setTimeout(() => buildWithLoading(() => { f.style.opacity = 0; if (!ctx.running) menuAmbience(state.bg); }), 420); }
export function startGame() {
  clearTimeout(rebuildT);
  initAudio(); resumeAudio(); sfx('uiGo');
  const fade = $('#fade'); fade.style.opacity = 1; $('#menu').classList.add('hidden');
  const begin = () => {
    stashed = null; putBack(); ctx.hand.visible = true; state.mode = 'seated'; state.seat = 'car'; player.yaw = player.pitch = 0; cam.t = 1; anim.lastTargetId = undefined; ctx.paused = false; anim.exhale = 0;
    ctx.camera.position.set(...SEAT.car.pos); ctx.camera.rotation.set(0, 0, 0);
    const night = isNightClock(state.clock);
    ctx.W.wasNight = night;
    ctx.W.domeLit = night;
    startAmbience(BG[state.bg].ambience, night ? 'night' : 'day');
    setIndoor(true);
    $('#hud').classList.add('on'); $('#mobile').classList.toggle('on', isTouch);
    guideReady = false; const gs = ++guideSess;
    ctx.running = true; updateHUD(); fade.style.opacity = 0;
    if (isTouch) setTimeout(() => { if (gs !== guideSess || !ctx.running) return; guideReady = true; refreshGuide(); }, 700);
    $('#lockmsg').firstChild.textContent = '화면을 클릭하면 시작합니다';
    $('#lockmsg').style.opacity = isTouch ? 0 : 0.85;
    $('#caption').classList.add('bright'); setTimeout(() => $('#caption').classList.remove('bright'), 5000);
  };
  if (sceneReady(state.bg)) setTimeout(() => { if (sceneReady(state.bg)) { resetSceneForStart(); begin(); } else buildWithLoading(begin); }, 520);
  else setTimeout(() => buildWithLoading(begin), 700);
}

function onPlatform(x, z) { return ctx.W.platforms.find(p => x > p.x[0] && x < p.x[1] && z > p.z[0] && z < p.z[1]); }
export function floorY(x, z) { const p = onPlatform(x, z); return p ? p.y : terrainH(x, z, ctx.W.cfg); }
/* 발밑 바닥: 부두 판자 · 돗자리 · 젖은 물가 · 숲의 길(낙엽 없는 흙) · 장소의 바닥 */
function surfaceAt(x, z) {
  const cfg = ctx.W.cfg;
  if (onPlatform(x, z)) return 'wood';
  if (onMat(x, z)) return 'mat';
  if (cfg.water && z - cfg.water.z - shoreOff(x, cfg) < -1.2) return 'wet';
  if (cfg.key === 'lake' && onRoad(x, z)) return 'road';
  return cfg.key === 'snow' ? 'snow' : cfg.key === 'beach' ? 'sand' : 'grass';
}
/* 걷기 충돌: 몸(반지름 PR)이 네모나 원에 닿으면 막힌다.
   네모는 "가장 가까운 점까지의 거리"로 재서 모서리를 둥글게 돌아 나간다 (예전엔 네모를 PR 만큼 키워 모서리에서 더 일찍 막혔다) */
function blockedAt(x, z) {
  for (const b of BLOCKS) {
    if (b.round) { const r = (b.x[1] - b.x[0]) / 2; if (Math.hypot(x - b.x[0] - r, z - b.z[0] - r) < r + PR) return true; continue; }
    const dx = Math.max(b.x[0] - x, 0, x - b.x[1]), dz = Math.max(b.z[0] - z, 0, z - b.z[1]);
    if (dx * dx + dz * dz < PR * PR) return true;
  }
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
  const moving = len > 0.05, sp = 2.6 * dt * snowSpeed(), cam3 = ctx.camera;
  if (moving) {
    const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
    const wx = (mx * c + mz * s) * sp, wz = (-mx * s + mz * c) * sp;
    /* 눈덩이를 굴리는 동안: 몸과 앞의 눈덩이가 둘 다 갈 수 있을 때만 움직인다 (축별로 미끄러지지 않는다) */
    if (snowRolling()) { const nx = player.x + wx, nz = player.z + wz; if (!blockedAt(nx, nz) && !rollBlocked(nx, nz)) { player.x = nx; player.z = nz; } }
    else {
      if (!blockedAt(player.x + wx, player.z)) player.x += wx;
      if (!blockedAt(player.x, player.z + wz)) player.z += wz;
    }
    const prev = Math.floor(player.bob / Math.PI);
    player.bob += dt * (Math.PI / STEP) * Math.min(1, len);
    if (Math.floor(player.bob / Math.PI) !== prev) {
      const sf = surfaceAt(player.x, player.z); sfx('step', sf);
      if (ctx.W.prints && (sf === 'snow' || sf === 'sand')) { player.side = !player.side; ctx.W.prints.stamp(player.x, player.z, wx, wz, player.side ? 1 : -1); }
    }
  } else { const r = player.bob % Math.PI; player.bob += (r < Math.PI / 2 ? -r : Math.PI - r) * Math.min(1, dt * 8); }
  const targetY = floorY(player.x, player.z) + EYE + (Math.abs(Math.sin(player.bob)) - 0.5) * 0.04;
  cam3.position.set(player.x, cam3.position.y + (targetY - cam3.position.y) * Math.min(1, dt * 12), player.z);
  if (ctx.W.item && anim.sipT === null && state.item !== 'marsh') { const b = state.item === 'smoke' ? [0.2, -0.13] : state.item === 'sparkler' ? [0.2, -0.28] : [0.22, -0.2]; ctx.hand.position.x = b[0] + Math.sin(player.bob * 0.5) * 0.01; ctx.hand.position.y = b[1] + Math.abs(Math.sin(player.bob)) * 0.012; }
}