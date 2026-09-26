import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { BG, TIME, ITEMS, SEAT, BLOCKS, EYE, PR } from './data.js';
import { $, clamp, wrapPI, isTouch } from './util.js';
import { terrainH, WATER_Y } from './terrain.js';
import { makeItem } from './props.js';
import { buildScene } from './scene.js';
import { clockLabel } from './time.js';
import { initAudio, resumeAudio, setVolume, startAmbience, stopAmbience, startCrackle, sfx, setIndoor } from './audio.js';

/* ── 조작 원칙: E 는 바라보는 것, 클릭은 손에 든 것. 앉아서 아무것도 안 보면 E = 일어나기 ── */

export const player = { x: -2.1, z: 8.2, yaw: 0, pitch: 0, bob: 0, stepT: 0 };
export const cam = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, yawFrom: 0, yawTo: 0, pitchFrom: 0, pitchTo: 0 };
export const anim = { sipT: null, holding: false, holdT: 0, exhale: 0, exhaleStr: 0, lastSteam: 0, lastSipSfx: 0, lastTargetId: null };
const keys = {}; let toastT = null, tMove = null, tLook = null;
const canvas = () => ctx.renderer.domElement;
const locked = () => document.pointerLockElement === canvas();
export const isNightClock = c => c < 0.22 || c > 0.8;

function bindToggle(id, key, onChange) {
  const el = $('#' + id), lab = $('#' + id + 'V');
  if (!el || !lab) { console.warn('toggle element missing:', id); return; }
  const paint = () => { el.classList.toggle('on', settings[key]); lab.textContent = settings[key] ? '켜짐' : '꺼짐'; };
  el.onclick = () => { settings[key] = !settings[key]; paint(); onChange(settings[key]); }; paint();
}

export function bindInput() {
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (!ctx.running) { if (e.code === 'Enter' && !$('#menu').classList.contains('hidden')) startGame(); return; }
    if (ctx.paused) { if (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space') resume(); return; }
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyP') takePhoto();
    if (state.mode === 'trunk' && /^Digit[1-4]$/.test(e.code)) trunkKey(+e.code[5]);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  /* 창 포커스를 잃으면(Alt-Tab 등) 눌린 키와 터치를 모두 해제 — 안 그러면 계속 걷는다 */
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; tMove = tLook = null; });
  addEventListener('mousemove', e => { if (!locked() || !ctx.running) return; look(e.movementX, e.movementY, 0.0022 * settings.sens); });
  document.addEventListener('pointerlockchange', () => { if (!ctx.running || isTouch) return; if (locked()) { hidePause(); $('#lockmsg').style.opacity = 0; } else if (state.mode !== 'trunk') showPause(); });
  /* 클릭: 포인터 잠금만. 상호작용은 E, 손에 든 것은 mousedown~mouseup */
  canvas().addEventListener('click', () => { if (ctx.running && !isTouch && !locked()) canvas().requestPointerLock(); });
  addEventListener('mousedown', e => { if (e.button !== 0 || !ctx.running || isTouch || !locked()) return; startSip(); });
  addEventListener('mouseup', e => { if (e.button === 0) endSip(); });
  canvas().addEventListener('touchstart', e => { for (const t of e.changedTouches) { if (t.clientX < innerWidth * 0.42 && !tMove) tMove = { id: t.identifier, sx: t.clientX, sy: t.clientY, dx: 0, dy: 0 }; else if (!tLook) tLook = { id: t.identifier, lx: t.clientX, ly: t.clientY }; } }, { passive: true });
  canvas().addEventListener('touchmove', e => { for (const t of e.changedTouches) { if (tMove && t.identifier === tMove.id) { tMove.dx = clamp((t.clientX - tMove.sx) / 60, -1, 1); tMove.dy = clamp((t.clientY - tMove.sy) / 60, -1, 1); } if (tLook && t.identifier === tLook.id) { look(t.clientX - tLook.lx, t.clientY - tLook.ly, 0.005 * settings.sens); tLook.lx = t.clientX; tLook.ly = t.clientY; } } }, { passive: true });
  canvas().addEventListener('touchend', e => { for (const t of e.changedTouches) { if (tMove && t.identifier === tMove.id) tMove = null; if (tLook && t.identifier === tLook.id) tLook = null; } }, { passive: true });

  $('#trunkClose').onclick = closeTrunk;
  $('#resume').onclick = resume;
  $('#pause').addEventListener('click', e => { if (e.target === $('#pause')) resume(); });
  $('#pausebtn').style.display = isTouch ? '' : 'none';
  $('#pausebtn').onclick = () => { if (ctx.paused) resume(); else showPause(); };
  $('#toMenu').onclick = () => { hidePause(); ctx.running = false; endSleepUI(); $('#hud').classList.remove('on'); $('#trunk').classList.remove('on'); stopAmbience(); setIndoor(false); setVolume(settings.vol); $('#menu').classList.remove('hidden'); ctx.hand.visible = false; };
  $('#photoBtn').onclick = () => { hidePause(); setTimeout(takePhoto, 50); if (!isTouch) canvas().requestPointerLock(); };
  $('#mAct').onclick = interact;
  const ms = $('#mSip'); ms.onpointerdown = e => { e.preventDefault(); startSip(); }; ms.onpointerup = ms.onpointercancel = ms.onpointerleave = endSip; ms.oncontextmenu = e => e.preventDefault();
  $('#start').onclick = startGame;
  const bindRange = (id, key, fmt, apply) => { const el = $('#' + id); el.dataset.k = key; el.oninput = () => { settings[key] = +el.value; document.querySelectorAll('input[data-k=' + key + ']').forEach(o => { o.value = el.value; }); document.querySelectorAll('[id^=' + key + 'V]').forEach(l => l.textContent = fmt(settings[key])); apply && apply(settings[key]); }; };
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
  bindToggle('reflect', 'reflect', on => { if (ctx.W.water) ctx.W.water.material.uniforms.uReflect.value = on ? 1 : 0; });
  renderMenu();
}
function look(dx, dy, s) { player.yaw -= dx * s; player.pitch = clamp(player.pitch - dy * s, -1.3, 1.3); }
/* 계속하기: ESC 직후엔 브라우저가 잠금 재요청을 거부할 수 있어, 실패하면 "클릭하면 시작" 안내를 띄운다 */
function resume() {
  hidePause(); if (isTouch) return;
  const p = canvas().requestPointerLock(); if (p && p.catch) p.catch(() => { $('#lockmsg').style.opacity = 0.85; });
}

/* ── 조준: 조준점이 물체의 실루엣 안에 있는 것. 걷는 중이면 'walk', 앉아 있으면 자리 이름으로 대상이 걸러진다 ── */
const fwd = new THREE.Vector3(), toT = new THREE.Vector3();
export function currentTarget() {
  if (cam.t < 1 || state.mode === 'trunk' || state.mode === 'sleep') return null;
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
  const st = SEAT[id]; state.mode = 'seated'; state.seat = id; startMove(new THREE.Vector3(...st.pos), wrapPI(player.yaw), quiet ? 0 : undefined);
  if (!quiet) { if (id === 'car') { sfx('doorOpen'); setTimeout(() => sfx('doorClose'), 900); } else sfx('sit'); }
  setIndoor(id === 'tent' || id === 'car');
}
function standUp() { const st = SEAT[state.seat]; if (state.seat === 'car') { sfx('doorOpen'); setTimeout(() => sfx('doorClose'), 900); } player.x = st.stand[0]; player.z = st.stand[1]; state.mode = 'walk'; state.seat = null; startMove(new THREE.Vector3(player.x, floorY(player.x, player.z) + EYE, player.z), wrapPI(player.yaw), 0); setIndoor(false); }
function toggleFire() { const W = ctx.W; W.fireLit = !W.fireLit; sfx('lighter'); if (W.fireLit) startCrackle(); showToast(W.fireLit ? '불을 피웠다' : '불을 껐다'); }
const LAMP = { lantern: { flag: 'lanternLit', name: '랜턴' }, tentLamp: { flag: 'tentLampLit', name: '텐트 랜턴' } };
function toggleLamp(k) { const L = LAMP[k]; ctx.W[L.flag] = !ctx.W[L.flag]; sfx('lighter'); showToast(ctx.W[L.flag] ? L.name + '을 켰다' : L.name + '을 껐다'); }

/* E: 바라보는 것이 있으면 그것, 없으면 (앉아 있을 때) 일어나기 */
export function interact() {
  if (cam.t < 1 || ctx.paused || state.mode === 'sleep') return;
  if (state.mode === 'trunk') { closeTrunk(); return; }
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
    case 'bed': startSleep(); break;
    default: sitDown(id);
  }
}
function openTrunk() { state.mode = 'trunk'; $('#trunk').classList.add('on'); sfx('trunkOpen'); if (!isTouch) document.exitPointerLock(); renderTrunk(); updateHUD(); }
function closeTrunk() { state.mode = 'walk'; $('#trunk').classList.remove('on'); sfx('trunkClose'); if (!isTouch) canvas().requestPointerLock(); updateHUD(); }
function trunkKey(n) { const ks = Object.keys(ITEMS); if (n <= 3) { pickItem(ks[n - 1]); closeTrunk(); } else if (state.item) { putBack(); closeTrunk(); } }
function renderTrunk() {
  const box = $('#trunkItems'); box.innerHTML = '';
  Object.entries(ITEMS).forEach(([k, v], i) => { const d = document.createElement('button'); d.className = 'card'; d.innerHTML = `<div class="ic">${v.ic}</div><div class="nm">${v.name}</div><div class="ds">${v.ds}</div><kbd>${i + 1}</kbd>`; d.onclick = () => trunkKey(i + 1); box.append(d); });
  if (state.item) { const d = document.createElement('button'); d.className = 'card'; d.innerHTML = `<div class="ic">${ICON_BACK}</div><div class="nm">내려놓기</div><div class="ds">${ITEMS[state.item].name}를 다시 넣는다</div><kbd>4</kbd>`; d.onclick = () => trunkKey(4); box.append(d); }
}
const ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-3"/></svg>';
function pickItem(type) { putBack(); state.item = type; const it = makeItem(type); ctx.hand.add(it); ctx.W.item = it; resetHand(); if (type === 'smoke') sfx('lighter'); showToast(ITEMS[type].name + '를 챙겼다'); }
export function putBack() { state.item = null; ctx.hand.clear(); ctx.W.item = null; anim.sipT = null; anim.holding = false; anim.holdT = 0; }
export function resetHand() { const h = ctx.hand; if (state.item === 'smoke') { h.position.set(0.2, -0.13, -0.4); h.rotation.set(0, 0.6, 0.15); } else { h.position.set(0.22, -0.2, -0.45); h.rotation.set(0, 0, 0); } }

/* ── 마시기 / 피우기 (좌클릭·한 모금 버튼) ── */
function startSip() {
  if (!state.item || !ctx.W.item || anim.sipT !== null || state.mode === 'trunk' || state.mode === 'sleep' || ctx.paused || cam.t < 1) return;
  if (ctx.W.item.userData.amount <= 0) { showToast('잔이 비었다'); return; }
  anim.sipT = 0; anim.holding = true; anim.holdT = 0; anim.lastSipSfx = -9;
  if (state.item === 'whisky') sfx('clink'); else if (state.item === 'coffee') sfx('sip'); else sfx('inhale');
}
function endSip() { anim.holding = false; }
export function itemEmptied() {
  if (state.item === 'smoke') { putBack(); showToast('담배를 다 피웠다'); }
  else showToast(state.item === 'coffee' ? '커피를 다 마셨다' : '위스키를 다 마셨다');
  updateHUD();
}

/* ── 잠자기: 어두워짐(1.7s) → 시계가 다음 새벽까지 빠르게(4.5s) → 침낭에 누운 채 밝아짐(1.7s)
   자는 동안은 조준점과 하단 안내를 숨겨 검은 화면 위에 시계만 남긴다 ── */
const sleep = { on: false, phase: '', t: 0, from: 0, to: 0 };
function startSleep() {
  sleep.on = true; sleep.phase = 'in'; sleep.t = 0; state.mode = 'sleep'; anim.holding = false; anim.sipT = null;
  const f = $('#fade'); f.style.transition = 'opacity 1.6s'; f.style.opacity = 1;
  $('#prompt').classList.remove('on'); $('#cross').style.display = 'none'; $('#legend').style.display = 'none'; $('#itembox').classList.remove('on'); sfx('sit');
}
/* 잠자기 UI 원상복구 (깨어날 때와 메뉴로 나갈 때) */
function endSleepUI() { sleep.on = false; $('#sleep').classList.remove('on'); $('#fade').style.transition = ''; $('#cross').style.display = ''; $('#legend').style.display = ''; }
export function updateSleep(dt) {
  if (!sleep.on) return; sleep.t += dt;
  const f = $('#fade'), st = $('#sleep');
  if (sleep.phase === 'in') {
    setVolume(settings.vol * Math.max(0.12, 1 - sleep.t / 1.6));
    if (sleep.t >= 1.7) {
      const b = SEAT.bed; state.seat = 'bed'; ctx.camera.position.set(...b.pos); player.yaw = b.yaw; player.pitch = b.pitch; cam.t = 1; putBack();
      sleep.from = state.clock; sleep.to = state.clock < 0.27 ? 0.27 : 1.27; sleep.phase = 'night'; sleep.t = 0;
      st.classList.add('on'); ctx.W.fireLit = false;   // 밤새 불이 사그라든다
    }
  } else if (sleep.phase === 'night') {
    const k = Math.min(1, sleep.t / 4.5), e = k * k * (3 - 2 * k);
    state.clock = (sleep.from + (sleep.to - sleep.from) * e) % 1;
    $('#sleepText').textContent = clockLabel(state.clock);
    if (k >= 1) { sleep.phase = 'out'; sleep.t = 0; st.classList.remove('on'); f.style.opacity = 0; }
  } else if (sleep.phase === 'out') {
    setVolume(settings.vol * Math.min(1, 0.12 + sleep.t / 1.6));
    if (sleep.t >= 1.7) { endSleepUI(); setVolume(settings.vol); state.mode = 'seated'; updateHUD(); anim.lastTargetId = undefined; showToast('아침이 왔다'); }
  }
}

export function showToast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
export function updateCaption() { $('#capText').textContent = BG[state.bg].name + ' — ' + clockLabel(state.clock); }
export function updateHUD() {
  updateCaption();
  const ib = $('#itembox'); ib.classList.toggle('on', !!state.item && state.mode !== 'trunk' && state.mode !== 'sleep');
  if (state.item) {
    const empty = ctx.W.item && ctx.W.item.userData.amount <= 0;
    ib.querySelector('.ic').innerHTML = ITEMS[state.item].ic; ib.querySelector('.nm').textContent = ITEMS[state.item].name;
    ib.querySelector('.hn').textContent = empty ? '비었다 · 트렁크에서 새로 꺼내기' : (isTouch ? '버튼' : '클릭') + ' · ' + ITEMS[state.item].act + ' · 길게 누르면 계속';
  }
  $('#mSip').style.display = state.item && state.mode !== 'trunk' && state.mode !== 'sleep' ? '' : 'none';
  anim.lastTargetId = undefined; updatePrompt();
}
export function updatePrompt() {
  const p = $('#prompt');
  if (state.mode === 'trunk' || state.mode === 'sleep') { p.classList.remove('on'); $('#cross').classList.remove('hot'); anim.lastTargetId = null; return; }
  const t = currentTarget(), id = t ? t.id : (state.mode === 'seated' ? 'up' : null);
  if (id === anim.lastTargetId) return; anim.lastTargetId = id;
  const label = t ? t.label() : state.mode === 'seated' ? SEAT[state.seat].up : null;
  if (label) { p.innerHTML = `<kbd class="a">E</kbd>${label}`; p.classList.add('on'); } else p.classList.remove('on');
  $('#cross').classList.toggle('hot', !!t);
}
function showPause() { ctx.paused = true; anim.holding = false; $('#pause').classList.add('on'); $('#pauseSub').textContent = BG[state.bg].name + ' · ' + clockLabel(state.clock); }
function hidePause() { ctx.paused = false; $('#pause').classList.remove('on'); }

const rc = new THREE.Raycaster(), center = new THREE.Vector2(0, 0);
function takePhoto() {
  if (!ctx.running || ctx.paused || state.mode === 'sleep') return; const hud = $('#hud'); hud.classList.add('photo');
  let focus = 8;
  try { rc.setFromCamera(center, ctx.camera); const h = rc.intersectObjects(ctx.scene.children, true).find(h => h.object.visible && !h.object.isSprite && !h.object.isPoints && !h.object.userData.noAO && h.distance < 1000); if (h) focus = h.distance; } catch (e) {}
  ctx.post.renderPhoto(focus); const url = canvas().toDataURL('image/png');
  const a = document.createElement('a'); a.href = url; a.download = `quiet-camp-${state.bg}-${clockLabel(state.clock).replace(':', '')}.png`; a.click();
  setTimeout(() => { hud.classList.remove('photo'); showToast('사진을 저장했다'); }, 250);
}
function renderMenu() {
  const bl = $('#bgList'); bl.innerHTML = '';
  Object.values(BG).forEach(b => { const d = document.createElement('div'); d.className = 'opt' + (state.bg === b.key ? ' sel' : ''); d.innerHTML = `<div class="ic">${b.ic}</div><div class="nm">${b.name}</div>`; d.onclick = () => { if (state.bg === b.key) return; state.bg = b.key; renderMenu(); previewRebuild(); }; bl.append(d); });
  const tl = $('#timeList'); tl.innerHTML = '';
  Object.values(TIME).forEach(t => { const d = document.createElement('div'); d.className = 'chip' + (state.time === t.key ? ' sel' : ''); d.innerHTML = `<span class="ic">${t.ic}</span>${t.name}`; d.onclick = () => { state.time = t.key; state.clock = t.clock; renderMenu(); }; tl.append(d); });
}
let rebuildT = null;
export function previewRebuild() { const f = $('#fade'); f.style.opacity = 1; clearTimeout(rebuildT); rebuildT = setTimeout(() => { buildScene(state.bg); f.style.opacity = 0; }, 420); }
export function startGame() {
  initAudio(); resumeAudio();
  const fade = $('#fade'); fade.style.opacity = 1; $('#menu').classList.add('hidden');
  setTimeout(() => {
    buildScene(state.bg);
    putBack(); ctx.hand.visible = true; state.mode = 'seated'; state.seat = 'car'; player.yaw = player.pitch = 0; cam.t = 1; anim.lastTargetId = undefined; ctx.paused = false; anim.exhale = 0;
    ctx.camera.position.set(...SEAT.car.pos); ctx.camera.rotation.set(0, 0, 0);
    const night = isNightClock(state.clock);
    ctx.W.wasNight = night;
    startAmbience(BG[state.bg].ambience, night ? 'night' : 'day');
    setIndoor(true);
    $('#hud').classList.add('on'); $('#mobile').classList.toggle('on', isTouch);
    ctx.running = true; updateHUD(); fade.style.opacity = 0;
    $('#lockmsg').style.opacity = isTouch ? 0 : 0.85;
    $('#caption').classList.add('bright'); setTimeout(() => $('#caption').classList.remove('bright'), 5000);
  }, 700);
}

function onPlatform(x, z) { return ctx.W.platforms.find(p => x > p.x[0] && x < p.x[1] && z > p.z[0] && z < p.z[1]); }
export function floorY(x, z) { const p = onPlatform(x, z); return p ? p.y : terrainH(x, z, ctx.W.cfg); }
function surfaceAt(x, z) { const cfg = ctx.W.cfg; if (onPlatform(x, z)) return 'wood'; if (cfg.water && terrainH(x, z, cfg) < WATER_Y + 0.3) return 'wet'; return cfg.key === 'snow' ? 'snow' : cfg.key === 'beach' ? 'sand' : 'grass'; }
function blockedAt(x, z) {
  for (const b of BLOCKS) if (x > b.x[0] - PR && x < b.x[1] + PR && z > b.z[0] - PR && z < b.z[1] + PR) return true;
  for (const t of ctx.W.trees) if (Math.hypot(x - t[0], z - t[1]) < t[2] + PR) return true;
  if (onPlatform(x, z)) return false;
  if (terrainH(x, z, ctx.W.cfg) < -0.35) return true;
  if (Math.hypot(x, z) > 90) return true;
  return false;
}
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
    player.bob += dt * 9 * Math.min(1, len); player.stepT += dt * Math.min(1, len);
    if (player.stepT > 0.55) { player.stepT = 0; const sf = surfaceAt(player.x, player.z); sfx('step', sf); if (ctx.W.prints && (sf === 'snow' || sf === 'sand')) { player.side = !player.side; ctx.W.prints.stamp(player.x, player.z, wx, wz, player.side ? 1 : -1); } }
  } else player.bob += (0 - (player.bob % (Math.PI * 2))) * 0.1;
  const targetY = floorY(player.x, player.z) + EYE + Math.sin(player.bob) * 0.035;
  cam3.position.set(player.x, cam3.position.y + (targetY - cam3.position.y) * Math.min(1, dt * 12), player.z);
  if (ctx.W.item && anim.sipT === null) { const b = state.item === 'smoke' ? [0.2, -0.13] : [0.22, -0.2]; ctx.hand.position.x = b[0] + Math.sin(player.bob * 0.5) * 0.01; ctx.hand.position.y = b[1] + Math.abs(Math.sin(player.bob)) * 0.012; }
}
