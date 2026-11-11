import { ctx, state, settings, session } from './state.js';
import { BG, TIME } from './data.js';
import { $, josa, isTouch, clamp, wrapPI } from './util.js';
import { applyGear } from './props.js';
/* 아래 모듈들도 이 파일을 불러오지만, 서로 실행 중에만 부르므로 순환해도 괜찮다 */
import { startGame, exitGame, toLobby, updateHUD, previewRebuild, renderMenu, showToast } from './game.js';
import { showHome } from './home.js';
import { addRemote, removeRemote, hideRemote, setRemoteTag, updateAvatar, snapshot } from './avatar.js';
import { meteorHooks, showMeteor } from './scene.js';

/* ══ 멀티 캠핑 연결 (Trystero, P2P) ══
   서버 없이 브라우저끼리 직접 잇는다. 방 이름 = 'camp-' + 초대 코드. 최대 3명.
   방장(host)이 세계의 주인이다: 시드·장소·시각·하루 길이·시간 흐름·차/텐트 색을 정해 친구(guest)에게 보낸다. 별똥별도 방장이 띄운 값을 보낸다.
   몸은 각자 정한다: 스냅샷(위치·시선·자세·손에 든 것)을 초당 12번 모두에게 보내고, 받은 쪽은 120ms 늦춰 두 스냅샷 사이를 보간한다.
   신호 — hello(친구→방장: 들어가도 될까) · welcome(방장→친구: 세계 정보·자리 번호) · nope(가득 참·버전 다름) · profile(이름)
          start(방장 출발) · room(방장이 메뉴에서 장소·시각·색을 바꿈) · lobby(방장이 메뉴로) · world(시계, 1초마다) · snap(몸) · meteor(별똥별)
   게임 밖(메뉴)에서는 1초에 한 번 run: 0 스냅샷만 보낸다 → 받는 쪽은 아바타를 숨긴다.
   방장 신호가 4초 끊기면 친구 화면에 "방장이 잠시 자리를 비웠다". 방장 연결이 끊기면 친구는 홈으로.
   1인 캠핑에서는 이 파일의 연결 코드가 돌지 않는다 (Trystero 도 멀티를 고를 때 처음 불러온다) */

const APP = 'quiet-camp-v1', V = 1, MAX = 3;
const HZ = 12, DELAY = 120, STALE = 3000, AWAY = 4000, FIND = 15000;
/* 친구가 처음 서는 자리: 차 왼쪽 옆 (자리 번호 1·2). 멀티 자리 배치는 5단계 */
const SPAWN = [[-2.2, 7.2], [-2.2, 9.2]];

const N = { room: null, act: null, gen: 0, hostId: null, hostName: '', slot: 0, phase: 'off', err: '', live: false, peers: new Map(),
  sendT: 0, worldT: 0, lastHost: 0, away: false, findT: null, profT: null, dayMin: 60, flow: true, stash: null };

const nm = s => (typeof s === 'string' ? s.trim().slice(0, 12) : '') || '캠퍼';
const isHost = () => session.mode === 'host', isGuest = () => session.mode === 'guest';
function peer(id) { let p = N.peers.get(id); if (!p) { p = { id, name: '', ok: false, slot: 0, buf: [], off: null, last: 0, av: null }; N.peers.set(id, p); } return p; }
/* 방장 쪽: 들여보낸 친구들 */
const guests = () => [...N.peers.values()].filter(p => p.ok);
const profile = () => ({ name: nm(state.name) });
const worldInfo = () => ({ v: V, seed: session.seed, bg: state.bg, time: state.time, clock: state.clock, dayMin: settings.dayMin, flow: settings.flow, car: state.carColor, tent: state.tentColor });
const clockInfo = () => ({ clock: state.clock, dayMin: settings.dayMin, flow: settings.flow });

/* ── 메뉴의 캠핑장 칸 안내 ── */
export function roomNoteText() {
  if (N.err) return N.err;
  if (isHost()) {
    const g = guests().map(p => p.name || '캠퍼');
    return (g.length ? `함께하는 친구: ${g.join(', ')}` : '친구에게 코드나 링크를 보내자.') + (isTouch ? ' 폰이 방장이면 화면이 꺼질 때 캠핑장이 잠시 멈춘다. 와이파이에서 하자.' : '');
  }
  if (N.phase === 'in') return `${N.hostName}의 캠핑장에 들어왔다. 방장이 출발하면 함께 들어간다.`;
  if (N.phase === 'notfound') return '캠핑장을 아직 찾지 못했다. 코드가 맞는지, 방장이 캠핑장을 열어 두었는지 확인하자.';
  return '캠핑장을 찾는 중';
}
function roomNote() { const el = $('#roomNote'); if (el && session.mode !== 'solo') el.textContent = roomNoteText(); }

/* ── 방 열기·참여 ── */
async function open(code) {
  const gen = ++N.gen; N.err = '';
  let lib;
  try { lib = await import('trystero'); }
  catch (e) { console.warn('trystero load failed', e); if (gen === N.gen) { N.err = '연결 도구를 불러오지 못했다. 인터넷 연결을 확인하자.'; roomNote(); } return; }
  if (gen !== N.gen) return;
  const room = lib.joinRoom({ appId: APP }, 'camp-' + code);
  N.room = room;
  const mk = name => { const [send, get] = room.makeAction(name); return { send, get }; };
  const A = N.act = { hello: mk('hello'), welcome: mk('welcome'), nope: mk('nope'), profile: mk('profile'), start: mk('start'),
    room: mk('room'), lobby: mk('lobby'), world: mk('world'), snap: mk('snap'), meteor: mk('meteor') };
  room.onPeerJoin(id => { A.profile.send(profile(), id); if (isGuest()) A.hello.send({ v: V, name: nm(state.name) }, id); });
  room.onPeerLeave(id => peerLeft(id));
  A.profile.get((d, id) => { const p = peer(id); p.name = nm(d && d.name); if (isHost()) roomNote(); });
  A.snap.get((d, id) => gotSnap(d, id));
  if (isHost()) hostWire(A); else guestWire(A);
  roomNote();
}

function hostWire(A) {
  meteorHooks.send = p => { if (N.act) N.act.meteor.send(p); };
  A.hello.get((d, id) => {
    const p = peer(id);
    if (!d || d.v !== V) { A.nope.send({ why: 'version' }, id); return; }
    if (!p.ok && guests().length >= MAX - 1) { A.nope.send({ why: 'full' }, id); return; }
    const first = !p.ok;
    p.ok = true; p.name = nm(d.name);
    if (!p.slot) { for (let s = 1; s < MAX; s++) if (!guests().some(o => o.slot === s)) { p.slot = s; break; } }
    A.welcome.send(Object.assign(worldInfo(), { slot: p.slot, name: nm(state.name), running: N.live }), id);
    if (first && ctx.running) showToast(josa(p.name, '이', '가') + ' 놀러 왔다');
    roomNote();
  });
}

function guestWire(A) {
  const fromHost = id => !!N.hostId && id === N.hostId;
  A.welcome.get((d, id) => {
    if (N.hostId && N.hostId !== id) return;
    N.hostId = id; N.lastHost = performance.now(); N.slot = d.slot || 1; N.hostName = nm(d.name); N.phase = 'in'; clearTimeout(N.findT);
    peer(id).name = N.hostName;
    applyWorld(d);
    if (d.running) startGame(true); else follow();
    roomNote();
  });
  A.nope.get(d => bounce(d && d.why === 'full' ? '캠핑장이 가득 찼다 (최대 3명)' : '버전이 달라 들어갈 수 없다. 새로고침하자'));
  A.start.get((d, id) => { if (!fromHost(id)) return; N.lastHost = performance.now(); applyWorld(d); startGame(true); });
  A.room.get((d, id) => { if (!fromHost(id)) return; N.lastHost = performance.now(); applyWorld(d); if (!ctx.running) follow(); });
  A.lobby.get((d, id) => { if (!fromHost(id)) return; N.lastHost = performance.now(); toLobby(); roomNote(); });
  A.world.get((d, id) => { if (!fromHost(id)) return; N.lastHost = performance.now(); syncClock(d); });
  A.meteor.get((d, id) => { if (fromHost(id) && ctx.running && d) showMeteor(d); });
  N.findT = setTimeout(() => { if (N.phase === 'find') { N.phase = 'notfound'; roomNote(); } }, FIND);
}

/* 친구: 방장의 세계 정보를 받아 적용한다. 차·텐트 색은 session.gear 로 (내 저장값은 그대로) */
function applyWorld(d) {
  if (!d) return;
  if (typeof d.seed === 'number') session.seed = d.seed;
  if (BG[d.bg]) state.bg = d.bg;
  if (TIME[d.time]) state.time = d.time;
  if (typeof d.clock === 'number') state.clock = ((d.clock % 1) + 1) % 1;
  if (d.dayMin) N.dayMin = d.dayMin;
  if (typeof d.flow === 'boolean') N.flow = d.flow;
  session.gear = { car: d.car, tent: d.tent }; applyGear();
}
/* 대기실의 친구: 메뉴 표시를 방장 것으로 맞추고, 프리뷰가 다른 월드면 다시 만든다 */
function follow() {
  const W = ctx.W;
  if (!W.cfg || W.cfg.key !== state.bg || W.seed !== session.seed) previewRebuild();
  renderMenu();
}
/* 시계: 3분(게임 시간) 넘게 어긋나면 바로 맞추고, 그 안이면 절반씩 다가간다 */
function syncClock(d) {
  if (!d || typeof d.clock !== 'number') return;
  if (d.dayMin) N.dayMin = d.dayMin;
  if (typeof d.flow === 'boolean') N.flow = d.flow;
  const diff = (((d.clock - state.clock) % 1) + 1.5) % 1 - 0.5;
  state.clock = Math.abs(diff) > 0.002 ? d.clock : ((state.clock + diff * 0.5) % 1 + 1) % 1;
}
/* 친구: 캠핑장에서 나가 홈(코드 입력)으로. msg 는 그 자리에 뜬다 */
function bounce(msg) { if (ctx.running) exitGame(); showHome('join', msg); }

function peerLeft(id) {
  const p = N.peers.get(id); if (!p) return;
  if (p.av) removeRemote(p.av);
  N.peers.delete(id);
  if (isGuest() && id === N.hostId) { bounce('방장이 캠핑장을 떠났다'); return; }
  if (ctx.running && p.last && p.name) showToast(josa(p.name, '이', '가') + ' 캠핑장을 떠났다');
  if (isHost()) roomNote();
}

/* ── 스냅샷: 보내기·받기·보간 ── */
const _O = {}, _S = {};
function pack() {
  const t = Math.round(performance.now());
  if (!ctx.running) return { t, run: 0 };
  const o = snapshot(_O), ud = ctx.W.item && ctx.W.item.userData, r = v => Math.round((v || 0) * 1000) / 1000;
  return { t, run: 1, bg: state.bg, m: o.mode, st: o.seat, x: r(o.x), z: r(o.z), y: r(wrapPI(o.yaw)), p: r(o.pitch), i: o.item, j: o.jacket,
    s: r(o.sip), mo: o.mouth ? 1 : 0, r: r(o.roast), e: r(o.eat), ro: o.roll ? 1 : 0,
    am: ud && typeof ud.amount === 'number' ? r(ud.amount) : 1, ck: ud && typeof ud.cook === 'number' ? r(ud.cook) : 0, lt: ud && ud.lit ? 1 : 0,
    aw: ctx.paused || document.hidden ? 1 : 0 };
}
function gotSnap(d, id) {
  if (!d || typeof d.t !== 'number') return;
  const p = peer(id), now = performance.now();
  if (id === N.hostId) N.lastHost = now;
  const b = p.buf; if (b.length && d.t <= b[b.length - 1].t) return;
  /* 보낸 쪽 시계와 내 시계의 차이: 가장 빨리 도착한 값을 기준으로 삼고 아주 천천히 따라간다 */
  const off = now - d.t; p.off = p.off === null ? off : off < p.off ? off : p.off + (off - p.off) * 0.01;
  b.push(d); if (b.length > 30) b.shift(); p.last = now;
}
function sample(p, now, S) {
  const b = p.buf, T = now - p.off - DELAY;
  let a = b[b.length - 1], c = a, u = 0;
  for (let k = b.length - 2; k >= 0; k--) {
    if (b[k].t <= T) { a = b[k]; c = b[k + 1]; u = clamp((T - a.t) / Math.max(1, c.t - a.t), 0, 1); break; }
    if (k === 0) a = c = b[0];
  }
  const L = (x, y) => (x || 0) + ((y || 0) - (x || 0)) * u, jump = Math.hypot(c.x - a.x, c.z - a.z) > 3;
  S.mode = c.m; S.seat = c.st; S.item = c.i || null; S.jacket = c.j; S.mouth = !!c.mo; S.roll = !!c.ro;
  S.x = jump ? c.x : L(a.x, c.x); S.z = jump ? c.z : L(a.z, c.z);
  S.yaw = (a.y || 0) + wrapPI((c.y || 0) - (a.y || 0)) * u; S.pitch = L(a.p, c.p);
  S.sip = L(a.s, c.s); S.roast = L(a.r, c.r); S.eat = L(a.e, c.e);
  S.amount = c.am; S.cook = c.ck; S.lit = !!c.lt;
}
function updatePeer(p, now, dt) {
  const last = p.buf[p.buf.length - 1];
  const show = ctx.running && !!last && last.run === 1 && last.bg === state.bg && (!isHost() || p.ok);
  if (!show) { if (p.av && p.av.root.visible) hideRemote(p.av); return; }
  if (!p.av) p.av = addRemote(p.name || '캠퍼');
  sample(p, now, _S);
  setRemoteTag(p.av, p.name || '캠퍼', !!last.aw || now - p.last > STALE);
  p.av.root.visible = true;
  updateAvatar(p.av, _S, dt);
}

/* ── 매 프레임 (main.js) ── */
export function updateNet(dt) {
  if (!N.room) return;
  const now = performance.now(), A = N.act;
  N.sendT += dt;
  if (N.sendT >= (ctx.running ? 1 / HZ : 1)) { N.sendT = 0; A.snap.send(pack()); }
  if (isHost()) { N.worldT += dt; if (N.worldT >= 1) { N.worldT = 0; A.world.send(clockInfo()); } }
  if (isGuest() && N.hostId) { const away = now - N.lastHost > AWAY; if (away !== N.away) { N.away = away; if (ctx.running) updateHUD(); } }
  for (const p of N.peers.values()) updatePeer(p, now, dt);
}

/* ── game.js·home.js·main.js 가 부르는 것 ── */
/* 홈에서 초대하기·놀러가기를 고를 때. 친구는 내 장소·시각을 맡겨 두었다가 나갈 때 돌려받는다 */
export function netHost() { netLeave(); N.phase = 'host'; open(session.code); }
export function netJoin() { netLeave(); N.stash = { bg: state.bg, time: state.time, clock: state.clock }; N.phase = 'find'; open(session.code); }
/* 방을 나간다 (홈으로 돌아갈 때 showHome 이 부른다) */
export function netLeave() {
  N.gen++; clearTimeout(N.findT); clearTimeout(N.profT);
  if (N.room) { try { N.room.leave(); } catch (e) {} }
  N.room = null; N.act = null; N.hostId = null; N.hostName = ''; N.slot = 0; N.phase = 'off'; N.err = ''; N.away = false; N.live = false;
  N.peers.forEach(p => { if (p.av) removeRemote(p.av); }); N.peers.clear();
  meteorHooks.send = null; session.gear = null;
  if (N.stash) { const s = N.stash; N.stash = null; state.bg = s.bg; state.time = s.time; state.clock = s.clock; }
  applyGear();
}
/* 방장: 출발 · 메뉴로 · 메뉴에서 장소·시각·색 바꿈 · 하루 길이·시간 흐름 바꿈 */
export function netStart() { if (!isHost() || !N.act) return; N.live = true; N.act.start.send(worldInfo()); }
export function netLobby() { if (!isHost() || !N.act) return; N.live = false; N.act.lobby.send(1); }
export function netRoom() { if (isHost() && N.act) N.act.room.send(worldInfo()); }
export function netWorld() { if (isHost() && N.act) N.act.world.send(clockInfo()); }
/* 이름을 바꾸면 0.4초 뒤 모두에게 알린다 */
export function netProfile() { clearTimeout(N.profT); N.profT = setTimeout(() => { if (N.act) N.act.profile.send(profile()); }, 400); }
/* 시간 흐름 규칙: 친구는 방장의 하루 길이·시간 흐름을 따른다 (내 설정은 건드리지 않는다) */
export const clockRule = () => isGuest() && N.hostId ? { dayMin: N.dayMin, flow: N.flow } : { dayMin: settings.dayMin, flow: settings.flow };
/* 안내 줄: 방장 신호가 끊겼을 때 */
export const netNotice = () => isGuest() && N.away ? '방장이 잠시 자리를 비웠다' : null;
/* 친구가 처음 설 자리 (1인·방장은 null → 운전석) */
export const netSpawn = () => isGuest() ? SPAWN[(N.slot || 1) - 1] || SPAWN[0] : null;
/* 다른 사람 아바타가 보이는 중 — main.js 가 그동안 그림자맵을 매 프레임 갱신한다 */
export const netBusy = () => { for (const p of N.peers.values()) if (p.av && p.av.root.visible) return true; return false; };