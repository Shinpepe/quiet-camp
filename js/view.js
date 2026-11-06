import * as THREE from 'three';
import { ctx, state, settings, saveSettings } from './state.js';
import { clamp } from './util.js';
import { terrainH } from './terrain.js';
import { fishActive } from './fish.js';
/* game.js 와 서로 불러오지만, 실행 중에만 부르므로 순환해도 괜찮다 */
import { showToast } from './game.js';
import { mountItem, updateLocalAvatar } from './avatar.js';

/* ══ 시점: 1인칭 / 3인칭 ══
   게임 로직(걷기·조준·상호작용 거리·낚시·소리)은 언제나 1인칭 눈 위치(카메라)로 돈다.
   3인칭은 그리기 직전에만 카메라를 눈 뒤로 빼고(beginView), 그린 뒤 되돌린다(endView).
   뒤로 뺀 카메라는 눈 앞 8m 지점을 바라보므로 화면 가운데 조준점이 1인칭 시선과 거의 같은 곳을 가리킨다.
   장작 패기·낚시·꿈속 총·잠·차 안·텐트 안·부두 끝에서는 저절로 1인칭이 된다 (타이밍 게임과 좁은 실내).
   차·텐트를 뚫지 않게 카메라를 당기고, 땅 아래로는 내려가지 않게 띄운다 */

const V = { k: 0, d: 0, shown: false }, BOOM = 2.4, LIFT = 0.3;
const FIRST_SEATS = { car: 1, tent: 1, bed: 1, dock: 1 };
const _f = new THREE.Vector3(), _h = new THREE.Vector3(), _p = new THREE.Vector3(), _pv = new THREE.Vector3(), _b = new THREE.Vector3(), _sp = new THREE.Vector3(), _sq = new THREE.Quaternion();

function allowed() {
  if (!ctx.running) return false;
  const m = state.mode;
  if (m === 'chop' || m === 'shoot' || m === 'sleep' || fishActive()) return false;
  if ((m === 'seated' || m === 'memo') && FIRST_SEATS[state.seat]) return false;
  return true;
}
/* 카메라가 들어가면 안 되는 곳: 차 · 텐트(삼각 단면) */
function camBlocked(x, y, z) {
  if (x > -1.05 && x < 1.05 && z > 5.45 && z < 10.55 && y < 1.98) return true;
  const tx = Math.abs(x + 1.6); if (tx < 1.35 && z > -0.25 && z < 2.8 && y < 1.75 * (1 - tx / 1.35) + 0.05) return true;
  return false;
}

export const viewThird = () => V.shown;
export function toggleView() {
  settings.third = !settings.third; saveSettings();
  showToast(settings.third ? (allowed() ? '3인칭 시점' : '3인칭 시점. 여기서는 1인칭으로 보인다') : '1인칭 시점');
}
/* 매 프레임 (main.js): 전환 정도, 손에 든 것 옮기기, 내 아바타 자세 */
export function updateView(dt) {
  if (!ctx.running) V.k = 0;
  else V.k = clamp(V.k + (settings.third && allowed() ? dt : -dt) / 0.45, 0, 1);
  V.shown = V.k > 0.25;
  mountItem(V.shown);
  updateLocalAvatar(dt, V.shown);
}
/* 그리기 직전: 카메라를 눈 뒤로. 3인칭이 아니면 false */
export function beginView(camera) {
  if (V.k <= 0.001) return false;
  _sp.copy(camera.position); _sq.copy(camera.quaternion);
  const e = V.k * V.k * (3 - 2 * V.k);
  camera.getWorldDirection(_f);
  /* 위를 보면 카메라는 조금 내려가고, 아래를 보면 올라간다 (붐 각도는 시선보다 좁게) */
  const bp = clamp(Math.asin(clamp(_f.y, -1, 1)), -0.55, 0.25);
  _h.set(_f.x, 0, _f.z); if (_h.lengthSq() < 1e-6) _h.set(0, 0, -1); _h.normalize();
  _pv.copy(_sp); _pv.y += LIFT * e;
  _b.set(-_h.x * Math.cos(bp), -Math.sin(bp), -_h.z * Math.cos(bp));
  let d = BOOM * e;
  for (let s = 0.3; s <= d; s += 0.1) { _p.copy(_pv).addScaledVector(_b, s); if (camBlocked(_p.x, _p.y, _p.z)) { d = Math.max(0.3, s - 0.2); break; } }
  /* 막히면 바로 당기고, 풀리면 천천히 물러난다 */
  V.d = d < V.d ? d : V.d + (d - V.d) * 0.08;
  _p.copy(_pv).addScaledVector(_b, V.d); _p.y = Math.max(_p.y, terrainH(_p.x, _p.z, ctx.W.cfg) + 0.25);
  camera.position.copy(_p);
  camera.lookAt(_p.copy(_sp).addScaledVector(_f, 8));
  camera.updateMatrixWorld();
  return true;
}
/* 그린 뒤: 눈 위치로 되돌린다 */
export function endView(camera) { camera.position.copy(_sp); camera.quaternion.copy(_sq); camera.updateMatrixWorld(); }