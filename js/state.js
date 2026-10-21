import { BG, TIME, GEAR, GEAR_DEFAULT } from './data.js';

const fine = matchMedia('(pointer:fine)').matches;
export const ctx = { renderer: null, camera: null, hand: null, rod: null, post: null, pmrem: null, scene: null, W: {}, running: false, paused: false };

/* ── 저장: 설정·마지막 장소·시작 시각·장비 색·기록을 localStorage 한 키에 둔다.
   저장소가 막혀 있으면 조용히 기본값으로 돌아가고, 불러온 값은 타입과 범위를 검사한다 ── */
const KEY = 'quiet-camp:v1';
/* 저장 형식 버전. 2 부터 하루 길이(dayMin)를 사용자가 메뉴에서 고른다.
   그 전 저장본의 dayMin 은 슬라이더가 없던 시절의 옛 기본값(30)일 뿐이라 읽지 않는다 */
const SAVE_V = 2;
/* 하루 길이(실제 분): 메뉴·일시정지 슬라이더가 이 네 단계 중 하나를 고른다 */
export const DAY_LEN = [30, 60, 120, 240];
const DEFAULTS = { vol: 0.5, sens: 1, shadow: true, bloom: true, ao: fine, reflect: fine, flow: true, dayMin: 60 };
const RANGE = { vol: [0, 1], sens: [0.3, 2], dayMin: [30, 240] };
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
const saved = load();

export const settings = { ...DEFAULTS };
if (saved.settings && typeof saved.settings === 'object') {
  const oldSave = (saved.v || 1) < 2;
  for (const k in DEFAULTS) {
    if (k === 'dayMin' && oldSave) continue;
    const v = saved.settings[k];
    if (typeof v !== typeof DEFAULTS[k]) continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) continue; const r = RANGE[k]; settings[k] = r ? Math.min(r[1], Math.max(r[0], v)) : v; }
    else settings[k] = v;
  }
}
/* 하루 길이는 네 단계 중 가장 가까운 값으로 맞춘다 (슬라이더가 단계 번호로 읽는다) */
settings.dayMin = DAY_LEN.reduce((a, b) => Math.abs(b - settings.dayMin) < Math.abs(a - settings.dayMin) ? b : a);

const bg0 = BG[saved.bg] ? saved.bg : 'lake', time0 = TIME[saved.time] ? saved.time : 'sunset';
/* 목록에 없는 장비 색은 기본색으로 */
const pickGear = (k, def) => GEAR.some(g => g.key === k) ? k : def;
/* clock: 하루를 0..1 로 (0 = 자정, 0.5 = 정오). carColor·tentColor 는 GEAR 의 key */
export const state = { bg: bg0, time: time0, clock: TIME[time0].clock, item: null, mode: 'seated', seat: 'car',
  carColor: pickGear(saved.carColor, GEAR_DEFAULT.car), tentColor: pickGear(saved.tentColor, GEAR_DEFAULT.tent) };

/* 기록
   fish: 종 이름 → { best: 최고 크기(cm), count: 잡은 수, first: { bg: 장소 key, clock: 게임 속 시각 0..1 } | null }
         물고기 도감(journal.js)이 이 값을 보여 준다.
         예전 저장본은 최고 크기 숫자만 있었다 → 잡은 수 1, 처음 잡은 곳은 모름(null)으로 옮긴다
   chopBest: 장작 패기 최고 연속
   memoRead: 캠핑 메모에서 읽은 할 일 이름표 (data.js MEMO 의 key). 지금 장소의 메모에 여기 없는 줄이 있으면 안내를 띄운다 */
export const records = { fish: {}, chopBest: 0, memoRead: [] };
if (saved.records && typeof saved.records === 'object') {
  const f = saved.records.fish, okSize = v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 500;
  const okClock = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1;
  if (f && typeof f === 'object') for (const k in f) {
    const v = f[k];
    if (typeof v === 'number') { if (okSize(v)) records.fish[k] = { best: Math.round(v), count: 1, first: null }; continue; }
    if (!v || typeof v !== 'object' || !okSize(v.best)) continue;
    const count = typeof v.count === 'number' && Number.isFinite(v.count) && v.count >= 1 ? Math.min(99999, Math.floor(v.count)) : 1;
    const first = v.first && typeof v.first === 'object' && BG[v.first.bg] && okClock(v.first.clock) ? { bg: v.first.bg, clock: v.first.clock } : null;
    records.fish[k] = { best: Math.round(v.best), count, first };
  }
  const c = saved.records.chopBest; if (typeof c === 'number' && Number.isFinite(c) && c >= 0 && c < 1e4) records.chopBest = Math.floor(c);
  /* 읽은 이름표: 글자만, 중복 없이 */
  const mr = saved.records.memoRead;
  if (Array.isArray(mr)) records.memoRead = [...new Set(mr.filter(k => typeof k === 'string' && k.length > 0 && k.length < 40))].slice(0, 500);
}

/* 슬라이더처럼 연달아 바뀌는 값은 300ms 모아서 한 번에 쓴다. 페이지를 닫을 때는 바로 기록 */
let saveT = null;
function flush() { clearTimeout(saveT); saveT = null; try { localStorage.setItem(KEY, JSON.stringify({ v: SAVE_V, settings, records, bg: state.bg, time: state.time, carColor: state.carColor, tentColor: state.tentColor })); } catch (e) {} }
export function saveSettings() { clearTimeout(saveT); saveT = setTimeout(flush, 300); }
addEventListener('pagehide', () => { if (saveT) flush(); });