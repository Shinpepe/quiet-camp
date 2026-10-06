import { BG, TIME, GEAR, GEAR_DEFAULT } from './data.js';

const fine = matchMedia('(pointer:fine)').matches;
export const ctx = { renderer: null, camera: null, hand: null, post: null, pmrem: null, scene: null, W: {}, running: false, paused: false };

/* ── 저장: 설정 전체 + 마지막 장소·시작 시각·장비 색을 localStorage 에 둔다.
   시크릿 모드 등에서 저장소가 막혀 있으면 조용히 기본값으로 돌아간다.
   불러온 값은 타입과 범위를 검사한다 (예전 버전이나 손으로 고친 값이 들어와도 깨지지 않게) ── */
const KEY = 'quiet-camp:v1';
const DEFAULTS = { vol: 0.5, sens: 1, shadow: true, bloom: true, ao: fine, reflect: fine, flow: true, dayMin: 30 };
const RANGE = { vol: [0, 1], sens: [0.3, 2], dayMin: [5, 240] };
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
const saved = load();

export const settings = { ...DEFAULTS };
if (saved.settings && typeof saved.settings === 'object') {
  for (const k in DEFAULTS) {
    const v = saved.settings[k];
    if (typeof v !== typeof DEFAULTS[k]) continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) continue; const r = RANGE[k]; settings[k] = r ? Math.min(r[1], Math.max(r[0], v)) : v; }
    else settings[k] = v;
  }
}

const bg0 = BG[saved.bg] ? saved.bg : 'lake', time0 = TIME[saved.time] ? saved.time : 'sunset';
/* 장비 색: 목록에 없는 값(예전에 고른 화이트, 손으로 고친 값 등)은 기본색으로 */
const pickGear = (k, def) => GEAR.some(g => g.key === k) ? k : def;
/* clock: 하루를 0..1 로 (0 = 자정, 0.5 = 정오)
   carColor·tentColor: GEAR 의 key. seat 의 'car'(운전석)와 헷갈리지 않게 이름을 따로 둔다 */
export const state = { bg: bg0, time: time0, clock: TIME[time0].clock, item: null, mode: 'seated', seat: 'car',
  carColor: pickGear(saved.carColor, GEAR_DEFAULT.car), tentColor: pickGear(saved.tentColor, GEAR_DEFAULT.tent) };

/* 슬라이더처럼 연달아 바뀌는 값은 300ms 모아서 한 번에 쓴다. 페이지를 닫을 때는 바로 기록 */
let saveT = null;
function flush() { clearTimeout(saveT); saveT = null; try { localStorage.setItem(KEY, JSON.stringify({ settings, bg: state.bg, time: state.time, carColor: state.carColor, tentColor: state.tentColor })); } catch (e) {} }
export function saveSettings() { clearTimeout(saveT); saveT = setTimeout(flush, 300); }
addEventListener('pagehide', () => { if (saveT) flush(); });