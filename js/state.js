import { BG, TIME, GEAR, GEAR_DEFAULT } from './data.js';

const fine = matchMedia('(pointer:fine)').matches;
export const ctx = { renderer: null, camera: null, hand: null, rod: null, post: null, pmrem: null, scene: null, W: {}, running: false, paused: false };

/* ── 저장: 설정·마지막 장소·시작 시각·장비 색·기록을 localStorage 한 키에 둔다.
   저장소가 막혀 있으면 조용히 기본값으로 돌아가고, 불러온 값은 타입과 범위를 검사한다 ── */
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
/* 목록에 없는 장비 색은 기본색으로 */
const pickGear = (k, def) => GEAR.some(g => g.key === k) ? k : def;
/* clock: 하루를 0..1 로 (0 = 자정, 0.5 = 정오). carColor·tentColor 는 GEAR 의 key */
export const state = { bg: bg0, time: time0, clock: TIME[time0].clock, item: null, mode: 'seated', seat: 'car',
  carColor: pickGear(saved.carColor, GEAR_DEFAULT.car), tentColor: pickGear(saved.tentColor, GEAR_DEFAULT.tent) };

/* 기록: 물고기 종별 최고 크기(cm), 장작 패기 최고 연속 */
export const records = { fish: {}, chopBest: 0 };
if (saved.records && typeof saved.records === 'object') {
  const f = saved.records.fish;
  if (f && typeof f === 'object') for (const k in f) { const v = f[k]; if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 500) records.fish[k] = Math.round(v); }
  const c = saved.records.chopBest; if (typeof c === 'number' && Number.isFinite(c) && c >= 0 && c < 1e4) records.chopBest = Math.floor(c);
}

/* 슬라이더처럼 연달아 바뀌는 값은 300ms 모아서 한 번에 쓴다. 페이지를 닫을 때는 바로 기록 */
let saveT = null;
function flush() { clearTimeout(saveT); saveT = null; try { localStorage.setItem(KEY, JSON.stringify({ settings, records, bg: state.bg, time: state.time, carColor: state.carColor, tentColor: state.tentColor })); } catch (e) {} }
export function saveSettings() { clearTimeout(saveT); saveT = setTimeout(flush, 300); }
addEventListener('pagehide', () => { if (saveT) flush(); });