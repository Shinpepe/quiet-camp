import * as THREE from 'three';
import { ctx, state, settings } from './state.js';
import { BG, TIME, ITEMS, SEAT, BLOCKS, EYE, PR } from './data.js';
import { $, clamp, wrapPI, isTouch } from './util.js';
import { terrainH } from './terrain.js';
import { makeItem } from './props.js';
import { buildScene } from './scene.js';
import { clockLabel } from './time.js';
import { initAudio, resumeAudio, setVolume, startAmbience, stopAmbience, startCrackle, sfx } from './audio.js';

export const player = { x: -2.1, z: 8.2, yaw: 0, pitch: 0, bob: 0, stepT: 0 };
export const cam = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, yawFrom: 0, yawTo: 0 };
/* sipT: 0→1 한 모금 진행. holding 이면 0.5(입에 닿은 순간)에서 멈춰 계속 마신다. exhale: 남은 내뱉기 시간 */
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
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyF') { const l = lampForSeat(); if (l && cam.t >= 1 && !ctx.paused) toggleLamp(l); }
    if (e.code === 'KeyP') takePhoto();
    if (state.mode === 'trunk' && /^Digit[1-4]$/.test(e.code)) trunkKey(+e.code[5]);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('mousemove', e => { if (!locked() || !ctx.running) return; look(e.movementX, e.movementY, 0.0022 * settings.sens); });
  document.addEventListener('pointerlockchange', () => { if (!ctx.running || isTouch) return; if (locked()) { hidePause(); $('#lockmsg').style.opacity = 0; } else if (state.mode !== 'trunk') showPause(); });
  /* 클릭: 포인터 잠금 / 상호작용. 마시기·피우기는 mousedown~mouseup 으로 (길게 누르면 계속) */
  canvas().addEventListener('click', () => {
    if (!ctx.running) return;
    if (!isTouch && !locked()) { canvas().requestPointerLock(); return; }
    if (state.mode === 'walk' && currentTarget()) interact();
  });
  addEventListener('mousedown', e => { if (e.button !== 0 || !ctx.running || isTouch || !locked()) return; if (state.mode === 'walk' && currentTarget()) return; startSip(); });
  addEventListener('mouseup', e => { if (e.button === 0) endSip(); });
  canvas().addEventListener('touchstart', e => { for (const t of e.changedTouches) { if (t.clientX < innerWidth * 0.42 && !tMove) tMove = { id: t.identifier, sx: t.clientX, sy: t.clientY, dx: 0, dy: 0 }; else if (!tLook) tLook = { id: t.identifier, lx: t.clientX, ly: t.clientY }; } }, { passive: true });
  canvas().addEventListener('touchmove', e => { for (const t of e.changedTouches) { if (tMove && t.identifier === tMove.id) { tMove.dx = clamp((t.clientX - tMove.sx) / 60, -1, 1); tMove.dy = clamp((t.clientY - tMove.sy) / 60, -1, 1); } if (tLook && t.identifier === tLook.id) { look(t.clientX - tLook.lx, t.clientY - tLook.ly, 0.005 * settings.sens); tLook.lx = t.clientX; tLook.ly = t.clientY; } } }, { passive: true });
  canvas().addEventListener('touchend', e => { for (const t of e.changedTouches) { if (tMove && t.identifier === tMove.id) tMove = null; if (tLook && t.identifier === tLook.id) tLook = null; } }, { passive: true });

  $('#trunkClose').onclick = closeTrunk;
  $('#resume').onclick = () => { hidePause(); if (!isTouch) canvas().requestPointerLock(); };
  $('#pausebtn').onclick = () => { if (ctx.paused) $('#resume').onclick(); else if (!isTouch && locked()) document.exitPointerLock(); else showPause(); };
  $('#toMenu').onclick = () => { hidePause(); ctx.running = false; $('#hud').classList.remove('on'); $('#trunk').classList.remove('on'); stopAmbience(); $('#menu').classList.remove('hidden'); ctx.hand.visible = false; };
  $('#photoBtn').onclick = () => { hidePause(); setTimeout(takePhoto, 50); if (!isTouch) canvas().requestPointerLock(); };
  $('#mAct').onclick = interact;
  const ms = $('#mSip'); ms.onpointerdown = e => { e.preventDefault(); startSip(); }; ms.onpointerup = ms.onpointercancel = ms.onpointerleave = endSip; ms.oncontextmenu = e => e.preventDefault();
  $('#mLamp').onclick = () => { const l = lampForSeat(); if (l && cam.t >= 1 && !ctx.paused) toggleLamp(l); };
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

const fwd = new THREE.Vector3(), toT = new THREE.Vector3();
export function currentTarget() {
  if (state.mode !== 'walk' || cam.t < 1) return null;
  ctx.camera.getWorldDirection(fwd); let best = null, bd = 9;
  for (const it of ctx.W.interact) { toT.set(it.pos[0], it.pos[1], it.pos[2]).sub(ctx.camera.position); const d = toT.length(); if (d > it.r) continue; toT.normalize(); if (toT.dot(fwd) < 0.55) continue; if (d < bd) { bd = d; best = it; } }
  return best;
}
function startMove(to, yawTo) { cam.from.copy(ctx.camera.position); cam.to.copy(to); cam.t = 0; cam.yawFrom = wrapPI(player.yaw); cam.yawTo = yawTo; }
function sitDown(id) { const st = SEAT[id]; state.mode = 'seated'; state.seat = id; startMove(new THREE.Vector3(...st.pos), wrapPI(player.yaw)); sfx('sit'); }
function standUp() { const st = SEAT[state.seat]; player.x = st.stand[0]; player.z = st.stand[1]; state.mode = 'walk'; state.seat = null; startMove(new THREE.Vector3(player.x, floorY(player.x, player.z) + EYE, player.z), wrapPI(player.yaw)); }
function toggleFire() { const W = ctx.W; W.fireLit = !W.fireLit; sfx('lighter'); if (W.fireLit) startCrackle(); showToast(W.fireLit ? '불을 피웠다' : '불을 껐다'); }

/* ── 랜턴: 테이블 랜턴은 걸어가서 E, 의자에 앉아서는 F. 텐트 랜턴은 텐트 안에서 F ── */
const LAMP = { lantern: { flag: 'lanternLit', name: '랜턴' }, tentLamp: { flag: 'tentLampLit', name: '텐트 랜턴' } };
export function lampForSeat() { if (state.mode !== 'seated') return null; return state.seat === 'tent' ? 'tentLamp' : state.seat === 'chair' ? 'lantern' : null; }
function lampLabel(k) { const L = LAMP[k]; return ctx.W[L.flag] ? L.name + ' 끄기' : L.name + ' 켜기'; }
function toggleLamp(k) { const L = LAMP[k]; ctx.W[L.flag] = !ctx.W[L.flag]; sfx('lighter'); showToast(ctx.W[L.flag] ? L.name + '을 켰다' : L.name + '을 껐다'); updateHUD(); }

export function interact() {
  if (cam.t < 1 || ctx.paused) return;
  if (state.mode === 'trunk') { closeTrunk(); return; }
  if (state.mode === 'seated') { standUp(); updateHUD(); return; }
  const t = currentTarget(); if (!t) return;
  if (t.id === 'trunk') openTrunk(); else if (t.id === 'fire') toggleFire(); else if (t.id === 'lantern') toggleLamp('lantern'); else sitDown(t.id);
  updateHUD(); anim.lastTargetId = undefined;
}
function openTrunk() { state.mode = 'trunk'; $('#trunk').classList.add('on'); sfx('trunk'); if (!isTouch) document.exitPointerLock(); renderTrunk(); updateHUD(); }
function closeTrunk() { state.mode = 'walk'; $('#trunk').classList.remove('on'); if (!isTouch) canvas().requestPointerLock(); updateHUD(); }
function trunkKey(n) { const ks = Object.keys(ITEMS); if (n <= 3) { pickItem(ks[n - 1]); closeTrunk(); } else if (state.item) { putBack(); closeTrunk(); } }
function renderTrunk() {
  const box = $('#trunkItems'); box.innerHTML = '';
  Object.entries(ITEMS).forEach(([k, v], i) => { const d = document.createElement('button'); d.className = 'card'; d.innerHTML = `<div class="ic">${v.ic}</div><div class="nm">${v.name}</div><div class="ds">${v.ds}</div><kbd>${i + 1}</kbd>`; d.onclick = () => trunkKey(i + 1); box.append(d); });
  if (state.item) { const d = document.createElement('button'); d.className = 'card'; d.innerHTML = `<div class="ic">↩</div><div class="nm">내려놓기</div><div class="ds">${ITEMS[state.item].name}를 다시 넣는다</div><kbd>4</kbd>`; d.onclick = () => trunkKey(4); box.append(d); }
}
/* 손 없이 아이템만 시야 오른쪽 아래에 든다. 트렁크에서 꺼낼 때마다 새 것(가득) */
function pickItem(type) { putBack(); state.item = type; const it = makeItem(type); ctx.hand.add(it); ctx.W.item = it; resetHand(); if (type === 'smoke') sfx('lighter'); showToast(ITEMS[type].name + '를 챙겼다'); }
export function putBack() { state.item = null; ctx.hand.clear(); ctx.W.item = null; anim.sipT = null; anim.holding = false; anim.holdT = 0; }
export function resetHand() { const h = ctx.hand; if (state.item === 'smoke') { h.position.set(0.2, -0.13, -0.4); h.rotation.set(0, 0.6, 0.15); } else { h.position.set(0.22, -0.2, -0.45); h.rotation.set(0, 0, 0); } }

/* ── 마시기 / 피우기 ── */
function startSip() {
  if (!state.item || !ctx.W.item || anim.sipT !== null || state.mode === 'trunk' || ctx.paused || cam.t < 1) return;
  if (ctx.W.item.userData.amount <= 0) { showToast('잔이 비었다'); return; }
  anim.sipT = 0; anim.holding = true; anim.holdT = 0; anim.lastSipSfx = -9;
  if (state.item === 'whisky') sfx('clink'); else if (state.item === 'coffee') sfx('sip');
}
function endSip() { anim.holding = false; }
/* 다 마셨거나 다 탔을 때 (main.js 에서 호출) */
export function itemEmptied() {
  if (state.item === 'smoke') { putBack(); showToast('담배를 다 피웠다'); }
  else showToast(state.item === 'coffee' ? '커피를 다 마셨다' : '위스키를 다 마셨다');
  updateHUD();
}

export function showToast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
export function updateCaption() { $('#capText').textContent = BG[state.bg].name + ' — ' + clockLabel(state.clock); }
export function updateHUD() {
  updateCaption();
  const ib = $('#itembox'); ib.classList.toggle('on', !!state.item && state.mode !== 'trunk');
  if (state.item) {
    const empty = ctx.W.item && ctx.W.item.userData.amount <= 0;
    ib.querySelector('.ic').textContent = ITEMS[state.item].ic; ib.querySelector('.nm').textContent = ITEMS[state.item].name;
    ib.querySelector('.hn').textContent = empty ? '비었다 · 트렁크에서 새로 꺼내기' : (isTouch ? '버튼' : '클릭') + ' · ' + ITEMS[state.item].act + ' · 길게 누르면 계속';
  }
  $('#mSip').style.display = state.item && state.mode !== 'trunk' ? '' : 'none';
  const lamp = lampForSeat(), ml = $('#mLamp'); ml.style.display = lamp ? '' : 'none'; if (lamp) ml.textContent = lampLabel(lamp);
  const p = $('#prompt');
  if (state.mode === 'seated') { p.innerHTML = `<kbd class="a">E</kbd>${SEAT[state.seat].up}` + (lamp ? ` &nbsp; <kbd class="a">F</kbd>${lampLabel(lamp)}` : ''); p.classList.add('on'); }
  else if (state.mode === 'trunk') p.classList.remove('on');
  $('#cross').classList.remove('hot');
}
export function updatePrompt() {
  if (state.mode !== 'walk') return;
  const t = currentTarget(), id = t ? t.id : null; if (id === anim.lastTargetId) return; anim.lastTargetId = id;
  const p = $('#prompt'); if (t) { p.innerHTML = `<kbd class="a">E</kbd>${t.label()}`; p.classList.add('on'); } else p.classList.remove('on');
  $('#cross').classList.toggle('hot', !!t);
}
function showPause() { ctx.paused = true; anim.holding = false; $('#pause').classList.add('on'); $('#pauseSub').textContent = BG[state.bg].name + ' · ' + clockLabel(state.clock); }
function hidePause() { ctx.paused = false; $('#pause').classList.remove('on'); }

const rc = new THREE.Raycaster(), center = new THREE.Vector2(0, 0);
function takePhoto() {
  if (!ctx.running || ctx.paused) return; const hud = $('#hud'); hud.classList.add('photo');
  let focus = 8;
  try { rc.setFromCamera(center, ctx.camera); const h = rc.intersectObjects(ctx.scene.children, true).find(h => h.object.visible && !h.object.isSprite && !h.object.isPoints && !h.object.userData.noAO && h.distance < 1000); if (h) focus = h.distance; } catch (e) {}
  ctx.post.renderPhoto(focus); const url = canvas().toDataURL('image/png');
  const a = document.createElement('a'); a.href = url; a.download = `quiet-camp-${state.bg}-${clockLabel(state.clock).replace(':', '')}.png`; a.click();
  setTimeout(() => { hud.classList.remove('photo'); showToast('사진을 저장했다'); }, 250);
}
function renderMenu() {
  const bl = $('#bgList'); bl.innerHTML = '';
  Object.values(BG).forEach(b => { const d = document.createElement('div'); d.className = 'opt' + (state.bg === b.key ? ' sel' : ''); d.innerHTML = `<div class="ic">${b.ic}</div><div><div class="nm">${b.name}</div><div class="ds">${b.ds}</div></div>`; d.onclick = () => { if (state.bg === b.key) return; state.bg = b.key; renderMenu(); previewRebuild(); }; bl.append(d); });
  const tl = $('#timeList'); tl.innerHTML = '';
  /* 시각 칩은 씬을 다시 만들지 않고 시계만 옮긴다 — 조명이 바로 따라온다 */
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
    $('#hud').classList.add('on'); $('#mobile').classList.toggle('on', isTouch);
    ctx.running = true; updateHUD(); fade.style.opacity = 0;
    $('#lockmsg').style.opacity = isTouch ? 0 : 0.85;
    $('#caption').classList.add('bright'); setTimeout(() => $('#caption').classList.remove('bright'), 5000);
  }, 700);
}

function onPlatform(x, z) { return ctx.W.platforms.find(p => x > p.x[0] && x < p.x[1] && z > p.z[0] && z < p.z[1]); }
export function floorY(x, z) { const p = onPlatform(x, z); return p ? p.y : terrainH(x, z, ctx.W.cfg); }
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
    if (player.stepT > 0.55) { player.stepT = 0; sfx('step'); }
  } else player.bob += (0 - (player.bob % (Math.PI * 2))) * 0.1;
  const targetY = floorY(player.x, player.z) + EYE + Math.sin(player.bob) * 0.035;
  cam3.position.set(player.x, cam3.position.y + (targetY - cam3.position.y) * Math.min(1, dt * 12), player.z);
  if (ctx.W.item && anim.sipT === null) { const b = state.item === 'smoke' ? [0.2, -0.13] : [0.22, -0.2]; ctx.hand.position.x = b[0] + Math.sin(player.bob * 0.5) * 0.01; ctx.hand.position.y = b[1] + Math.abs(Math.sin(player.bob)) * 0.012; }
}
