import * as THREE from 'three';
import { ctx, state, settings, session, records } from './state.js';
import { BG, TIME, DREAM } from './data.js';
import { $, josa, isTouch, clamp, wrapPI } from './util.js';
import { applyGear } from './props.js';
import { sfxAt } from './audio.js';
import { parasolOpen, setParasol } from './beach.js';
import { rollState, remoteRoll, snowRemote, snowList, snowLoad } from './snowman.js';
import { seatKind, seatsOf } from './camp.js';
/* 아래 모듈들도 이 파일을 불러오지만, 서로 실행 중에만 부르므로 순환해도 괜찮다 */
import { startGame, exitGame, toLobby, updateHUD, previewRebuild, renderMenu, showToast, spawnPlanted, surfaceAt, refreshGo, startNap, sleepWaiting } from './game.js';
import { showHome } from './home.js';
import { addRemote, removeRemote, hideRemote, setRemoteTag, updateAvatar, snapshot } from './avatar.js';
import { meteorHooks, showMeteor } from './scene.js';
import { dreamNet, dreamGo, dreamWaiting, dreamReady, dreamStatus, dreamSync, dreamRemote, dreamClaim, dreamOn } from './dream.js';
import { chopNet, chopRemote } from './chop.js';
import { fishNet, fishRemote } from './fish.js';

/* ══ 멀티 캠핑 연결 (Trystero, P2P) ══
   서버 없이 브라우저끼리 직접 잇는다. 방 이름 = 'camp-' + 초대 코드. 최대 4명.
   방장(host)이 세계의 주인이다: 시드·장소·시각·하루 길이·시간 흐름·차/텐트 색, 모닥불·랜턴·실내등·파라솔을 정해 친구(guest)에게 보낸다. 별똥별도 방장이 띄운 값을 보낸다.
   몸은 각자 정한다: 스냅샷(위치·시선·자세·손에 든 것·굴리는 눈덩이·장작 패기 휘두르기·낚시 상태)을 초당 12번 모두에게 보내고, 받은 쪽은 120ms 늦춰 두 스냅샷 사이를 보간한다.
   신호 — hello(친구→방장: 들어가도 될까) · welcome(방장→친구: 세계 정보·자리 번호·함께 쓰는 물건·눈덩이/눈사람 목록) · nope(가득 참·버전 다름) · profile(이름)
          start(방장 출발) · room(방장이 메뉴에서 장소·시각·색을 바꿈) · lobby(방장이 메뉴로) · world(시계, 1초마다) · snap(몸) · meteor(별똥별)
          flags(방장→모두: 불·랜턴·실내등·파라솔 상태) · ask(친구→방장: 이걸 켜거나 꺼 줘) · nap(방장→모두: 함께 잠든다, 각자의 침낭·꿈 여부) · dream(꿈속 운석 막기: 시작·운석·맞힘 판정·순위)
          fx(누구나→모두: 스파클라를 꽂았다·아이스박스를 열었다·물고기를 낚았다·눈덩이/눈사람을 내려놓았다·집었다·부쉈다·만들었다)
   하나뿐인 물건(불·랜턴·파라솔)은 방장이 정한다: 친구는 자기 화면에서 먼저 바꾸고 방장에게 부탁하며, 방장이 모두에게 상태를 알린다.
   각자 만드는 것(꽂은 스파클라·눈덩이·눈사람)은 만든 사람이 한 번 알린다. 눈덩이·눈사람은 누구든 다시 굴리거나 부술 수 있다.
   다른 사람의 소리는 그 자리에서 난다(audio.js sfxAt): 발소리·앉기·문·지퍼는 스냅샷의 변화에서, 나머지는 받은 신호에서.
   게임 밖(메뉴)에서는 1초에 한 번 run: 0 스냅샷만 보낸다 → 받는 쪽은 아바타를 숨긴다.
   방장 신호가 4초 끊기면 친구 화면에 "방장이 잠시 자리를 비웠다". 방장 연결이 끊기면 친구는 홈으로.
   1인 캠핑에서는 이 파일의 연결 코드가 돌지 않는다 (Trystero 도 멀티를 고를 때 처음 불러온다) */

const APP = 'quiet-camp-v1', V = 9, MAX = 4;
/* GUN_WAIT: 꿈속에서 첫 사람이 총을 든 뒤 나머지를 기다리는 최대 시간 (ms) */
const HZ = 12, DELAY = 120, STALE = 3000, AWAY = 4000, FIND = 15000, GUN_WAIT = 30000;
/* 함께 쓰는 물건: 읽기·쓰기, 소리를 낼 자리(W.interact 의 id)와 켤 때·끌 때 소리. now = 움직임 없이 바로 맞추기 (중간에 들어올 때) */
const FLAG = {
  fire: { get: () => ctx.W.fireLit, set: v => { ctx.W.fireLit = v; }, at: 'fire', on: 'fireOn', off: 'fireOff' },
  lantern: { get: () => ctx.W.lanternLit, set: v => { ctx.W.lanternLit = v; }, at: 'lantern', on: 'lampOn', off: 'lampOff' },
  tentLamp: { get: () => ctx.W.tentLampLit, set: v => { ctx.W.tentLampLit = v; }, at: 'tentLamp', on: 'lampOn', off: 'lampOff' },
  dome: { get: () => ctx.W.domeLit, set: v => { ctx.W.domeLit = v; } },
  parasol: { get: () => parasolOpen(), set: (v, now) => setParasol(v, now), at: 'parasol', on: 'parasolOpen', off: 'parasolClose' },
};

const N = { room: null, act: null, gen: 0, self: null, hostId: null, hostName: '', slot: 0, phase: 'off', err: '', live: false, peers: new Map(),
  sendT: 0, worldT: 0, lastHost: 0, away: false, findT: null, profT: null, dayMin: 60, flow: true, stash: null, shared: null, snow: null,
  /* 친구 쪽: hostLive = 방장이 캠핑장으로 떠나 있는지, entering = 떠나기를 눌러 방장의 답을 기다리는 중 */
  hostLive: false, entering: false,
  /* 같이 잠들기: napT = 방장 쪽, 모두 누운 채 지난 시간 / zzKey = 마지막으로 띄운 "(2/4)" / gunT = 방장 쪽, 꿈속에서 첫 사람이 총을 든 시각 */
  napT: 0, zzKey: '', gunT: 0 };

const nm = s => (typeof s === 'string' ? s.trim().slice(0, 12) : '') || '캠퍼';
const isHost = () => session.mode === 'host', isGuest = () => session.mode === 'guest';
const SEATED = m => m === 'seated' || m === 'memo' || m === 'sleep';
function peer(id) { let p = N.peers.get(id); if (!p) { p = { id, name: '', ok: false, slot: 0, buf: [], off: null, last: 0, av: null, fxT: 0, seat: undefined, step: undefined, side: false, lit: false, snowHold: false }; N.peers.set(id, p); } return p; }
/* 방장 쪽: 들여보낸 친구들 */
const guests = () => [...N.peers.values()].filter(p => p.ok);
const profile = () => ({ name: nm(state.name) });
const worldInfo = () => ({ v: V, seed: session.seed, bg: state.bg, time: state.time, clock: state.clock, dayMin: settings.dayMin, flow: settings.flow, car: state.carColor, tent: state.tentColor });
/* dm: 방장의 꿈 상태 (시작 여부·남은 시간). 꿈이 아니면 null */
const clockInfo = () => ({ clock: state.clock, dayMin: settings.dayMin, flow: settings.flow, dm: dreamStatus() });
const flagsOf = () => { const o = {}; for (const k in FLAG) o[k] = !!FLAG[k].get(); return o; };
function applyFlags(d, now) { for (const k in FLAG) if (typeof d[k] === 'boolean') FLAG[k].set(d[k], now); }
const nameOf = id => id === N.hostId ? N.hostName : nm((N.peers.get(id) || {}).name);
/* 상호작용 자리(W.interact)의 위치 — 소리를 그 물건에서 낸다 */
const posOf = id => { const it = (ctx.W.interact || []).find(i => i.id === id); return it ? it.pos : null; };
function soundAt(id, type, arg) { const p = posOf(id); if (p) sfxAt(type, p[0], p[1], p[2], arg); }
/* 다른 사람이 바꾼 물건의 소리 (내가 바꾼 건 game.js 가 이미 냈다) */
function flagSfx(k, v) { const f = FLAG[k]; if (f && f.at) soundAt(f.at, v ? f.on : f.off); }

/* ── 메뉴의 캠핑장 칸 안내 ── */
export function roomNoteText() {
  if (N.err) return N.err;
  if (isHost()) {
    const g = guests().map(p => p.name || '캠퍼');
    return (g.length ? `함께하는 친구: ${g.join(', ')}` : '친구에게 코드나 링크를 보내자.') + (isTouch ? ' 방장 화면이 꺼지면 캠핑장이 잠시 멈춘다.' : '');
  }
  if (N.phase === 'in') return N.hostLive ? josa(N.hostName, '이', '가') + ' 캠핑장으로 떠났다. 떠나기를 누르면 따라간다.' : `${N.hostName}의 대기실이다. 방장이 떠나면 함께 떠날 수 있다.`;
  if (N.phase === 'notfound') return '캠핑장을 찾지 못했다. 코드가 맞는지, 캠핑이 진행중인지 확인하자.';
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
  N.room = room; N.self = lib.selfId;
  const mk = name => { const [send, get] = room.makeAction(name); return { send, get }; };
  const A = N.act = { hello: mk('hello'), welcome: mk('welcome'), nope: mk('nope'), profile: mk('profile'), start: mk('start'),
    room: mk('room'), lobby: mk('lobby'), world: mk('world'), snap: mk('snap'), meteor: mk('meteor'), flags: mk('flags'), ask: mk('ask'), fx: mk('fx'), nap: mk('nap'), dream: mk('dream') };
  room.onPeerJoin(id => { A.profile.send(profile(), id); if (isGuest()) A.hello.send({ v: V, name: nm(state.name) }, id); });
  room.onPeerLeave(id => peerLeft(id));
  A.profile.get((d, id) => { const p = peer(id); p.name = nm(d && d.name); if (isHost()) roomNote(); });
  A.snap.get((d, id) => gotSnap(d, id));
  A.fx.get((d, id) => gotFx(d, id));
  A.dream.get((d, id) => gotDream(d, id));
  wireDream();
  if (isHost()) hostWire(A); else guestWire(A);
  roomNote();
}

function hostWire(A) {
  meteorHooks.send = p => { if (N.act) N.act.meteor.send(p); };
  /* 친구는 두 번 인사한다: 캠핑장을 찾았을 때(대기실로) · 떠나기를 눌렀을 때(enter — 캠핑 중이면 지금 상태를 담아 go 로 받아 준다) */
  A.hello.get((d, id) => {
    const p = peer(id);
    if (!d || d.v !== V) { A.nope.send({ why: 'version' }, id); return; }
    if (!p.ok && guests().length >= MAX - 1) { A.nope.send({ why: 'full' }, id); return; }
    p.ok = true; p.name = nm(d.name);
    if (!p.slot) { for (let s = 1; s < MAX; s++) if (!guests().some(o => o.slot === s)) { p.slot = s; break; } }
    /* 모두 잠든 중(잠자기 화면·꿈속)에는 들여보내지 않고 기다리게 한다 (nap) */
    const nap = !!d.enter && (state.mode === 'sleep' || dreamOn()), go = !!d.enter && N.live && ctx.running && !nap;
    A.welcome.send(Object.assign(worldInfo(), { slot: p.slot, name: nm(state.name), running: N.live, go, nap, sh: go ? flagsOf() : null, snow: go ? snowList() : null }), id);
    if (go) showToast(josa(p.name, '이', '가') + ' 놀러 왔다');
    roomNote();
  });
  /* 친구의 부탁: 바꾸고, 그 자리에서 소리를 내고, 모두에게 새 상태를 알린다 (who = 바꾼 사람 — 그 사람은 소리·소식을 이미 냈다) */
  A.ask.get((d, id) => {
    const p = N.peers.get(id);
    if (!p || !p.ok || !ctx.running || !d || !FLAG[d.k] || typeof d.v !== 'boolean') return;
    if (!!FLAG[d.k].get() !== d.v) { FLAG[d.k].set(d.v); flagSfx(d.k, d.v); }
    if (d.k === 'fire') showToast(josa(p.name || '캠퍼', '이', '가') + (d.v ? ' 불을 피웠다' : ' 불을 껐다'));
    A.flags.send(Object.assign(flagsOf(), { k: d.k, who: id }));
  });
}

function guestWire(A) {
  const fromHost = id => !!N.hostId && id === N.hostId;
  /* 방장의 답: 언제나 대기실로. go 가 있으면(내가 떠나기를 눌렀고 방장이 캠핑 중) 그때의 물건 상태·눈덩이 목록을 받아 들어간다 */
  A.welcome.get((d, id) => {
    if (N.hostId && N.hostId !== id) return;
    N.hostId = id; N.lastHost = performance.now(); N.slot = d.slot || 1; N.hostName = nm(d.name); N.phase = 'in'; clearTimeout(N.findT);
    peer(id).name = N.hostName;
    N.hostLive = !!d.running; N.entering = false;
    applyWorld(d);
    if (d.go) { N.shared = d.sh || null; N.snow = d.snow || null; startGame(true); }
    else if (!ctx.running) follow();
    roomNote(); refreshGo();
    if (d.nap) { const el = $('#roomNote'); if (el) el.textContent = '모두 잠든 중이다. 아침이 오면 들어갈 수 있다.'; }
  });
  A.nope.get(d => bounce(d && d.why === 'full' ? '캠핑장이 가득 찼다 (최대 4명)' : '버전이 달라 들어갈 수 없다. 새로고침하자'));
  /* 방장이 캠핑장으로 떠났다: 따라 들어가지는 않고, 떠나기를 누를 수 있게 된다 (프리뷰는 방장 월드로 맞춰 둔다) */
  A.start.get((d, id) => { if (!fromHost(id)) return; N.lastHost = performance.now(); N.hostLive = true; N.shared = N.snow = null; applyWorld(d); if (!ctx.running) follow(); roomNote(); refreshGo(); });
  A.room.get((d, id) => { if (!fromHost(id)) return; N.lastHost = performance.now(); applyWorld(d); if (!ctx.running) follow(); });
  A.lobby.get((d, id) => { if (!fromHost(id)) return; N.lastHost = performance.now(); N.hostLive = false; N.shared = N.snow = null; toLobby(); roomNote(); refreshGo(); });
  A.world.get((d, id) => { if (!fromHost(id)) return; N.lastHost = performance.now(); syncClock(d); if (ctx.running) dreamSync(d.dm || null); });
  A.meteor.get((d, id) => { if (fromHost(id) && ctx.running && d) showMeteor(d); });
  /* 다 같이 잠든다: 방장이 정해 준 내 침낭으로 (자리 비움이었어도) */
  A.nap.get((d, id) => { if (!fromHost(id) || !d || !d.beds) return; N.lastHost = performance.now(); if (ctx.running) startNap(d.beds[N.self] || 'bed', !!d.dream); });
  /* 함께 쓰는 물건 상태: 기억해 두었다가(아직 들어가는 중이면 출발할 때 netBegin 이) 적용한다.
     다른 사람이 바꾼 것이면 그 자리에서 소리를 내고, 불은 바꾼 사람 이름으로 소식을 띄운다 */
  A.flags.get((d, id) => {
    if (!fromHost(id) || !d) return;
    N.lastHost = performance.now(); N.shared = d;
    if (!ctx.running) return;
    const mine = !d.who || d.who === N.self, changed = d.k && FLAG[d.k] && !!FLAG[d.k].get() !== !!d[d.k];
    applyFlags(d);
    if (!mine && changed) flagSfx(d.k, !!d[d.k]);
    if (d.k === 'fire' && !mine) showToast(josa(nameOf(d.who), '이', '가') + (d.fire ? ' 불을 피웠다' : ' 불을 껐다'));
  });
  N.findT = setTimeout(() => { if (N.phase === 'find') { N.phase = 'notfound'; roomNote(); } }, FIND);
}

/* 각자 만든 것·한 일 소식: 같은 장소에서 캠핑 중일 때만 */
function gotFx(d, id) {
  if (!d || !ctx.running || d.bg !== state.bg) return;
  if (isHost() && !(N.peers.get(id) || {}).ok) return;
  if (d.k === 'plant' && Array.isArray(d.q) && d.q.length === 4 && Array.isArray(d.s) && typeof d.x === 'number') {
    spawnPlanted(d); sfxAt('plant', d.x, d.y, d.z, surfaceAt(d.x, d.z));
  } else if (d.k === 'cooler') {
    ctx.W.coolerT = 0.7; soundAt('cooler', 'cooler'); setTimeout(() => { if (ctx.running) soundAt('cooler', 'cooler', 'close'); }, 1100);
  } else if (d.k === 'catch' && typeof d.n === 'string' && typeof d.size === 'number') {
    showToast(josa(nameOf(id), '이', '가') + ` ${d.n.slice(0, 8)} ${Math.round(d.size)}cm를 낚았다`); soundAt('dock', 'fishOut');
  } else if (d.k === 'snow') {
    /* 내려놓거나 눈사람에 올린 눈덩이는 그 사람 앞에서 굴러가던 것 — 스냅샷이 따라올 때까지 굴리는 모습을 숨긴다 */
    if (d.op === 'drop' || d.op === 'man') { peer(id).snowHold = true; remoteRoll(id, null); }
    snowRemote(d);
    if (d.op === 'man') showToast(josa(nameOf(id), '이', '가') + ' 눈사람을 만들었다');
  }
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
  /* 잠자기 화면은 시계를 스스로 돌린다 (끝나면 모두 아침 7시로 맞는다) */
  if (state.mode === 'sleep') return;
  const diff = (((d.clock - state.clock) % 1) + 1.5) % 1 - 0.5;
  state.clock = Math.abs(diff) > 0.002 ? d.clock : ((state.clock + diff * 0.5) % 1 + 1) % 1;
}
/* 친구: 캠핑장에서 나가 홈(코드 입력)으로. msg 는 그 자리에 뜬다 */
function bounce(msg) { if (ctx.running) exitGame(); showHome('join', msg); }

function peerLeft(id) {
  const p = N.peers.get(id); if (!p) return;
  if (p.av) removeRemote(p.av);
  remoteRoll(id, null); chopRemote(id, null, 0); fishRemote(id, null);
  N.peers.delete(id);
  if (isGuest() && id === N.hostId) { bounce('방장이 캠핑장을 떠났다'); return; }
  const ls = p.buf[p.buf.length - 1];
  if (ctx.running && ls && ls.run === 1 && p.name) showToast(josa(p.name, '이', '가') + ' 캠핑장을 떠났다');
  if (isHost()) roomNote();
}

/* ── 스냅샷: 보내기·받기·보간 ── */
const _O = {}, _S = {};
function pack() {
  const t = Math.round(performance.now());
  if (!ctx.running) return { t, run: 0 };
  const o = snapshot(_O), ud = ctx.W.item && ctx.W.item.userData, r = v => Math.round((v || 0) * 1000) / 1000, sb = rollState();
  const cn = chopNet(), fn = fishNet();
  return { t, run: 1, bg: state.bg, m: o.mode, st: o.seat, x: r(o.x), z: r(o.z), y: r(wrapPI(o.yaw)), p: r(o.pitch), i: o.item, j: o.jacket,
    s: r(o.sip), mo: o.mouth ? 1 : 0, r: r(o.roast), e: r(o.eat), ro: o.roll ? 1 : 0,
    am: ud && typeof ud.amount === 'number' ? r(ud.amount) : 1, ck: ud && typeof ud.cook === 'number' ? r(ud.cook) : 0, lt: ud && ud.lit ? 1 : 0,
    br: sb ? r(sb.r) : 0, bx: sb ? r(sb.x) : 0, bz: sb ? r(sb.z) : 0,
    aw: ctx.paused || document.hidden ? 1 : 0, zz: sleepWaiting() ? 1 : 0, nd: records.dreams === 0 ? 1 : 0,
    /* 장작 패기: 휘두른 횟수·결과·장작이 놓였는지 / 낚시: 상태 번호(-1 = 아님)·찌 자리·휜 정도 */
    cw: cn ? cn.sw : 0, cr: cn ? cn.res : 0, cg: cn && cn.log ? 1 : 0,
    fs: fn ? fn.st : -1, fx: fn ? r(fn.x) : 0, fz: fn ? r(fn.z) : 0, fb: fn ? r(fn.b) : 0 };
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
  S.cw = c.cw || 0; S.cr = c.cr || 0; S.cg = !!c.cg;
  S.fs = typeof c.fs === 'number' ? c.fs : -1; S.fx = c.fx || 0; S.fz = c.fz || 0; S.fb = L(a.fb, c.fb);
  /* 굴리는 눈덩이: 앞뒤 스냅샷 모두 굴리는 중일 때만 보간한다 (막 굴리기 시작한 순간 원점에서 날아오지 않게) */
  const both = a.br > 0 && c.br > 0;
  S.br = c.br || 0; S.bx = both ? L(a.bx, c.bx) : c.bx || 0; S.bz = both ? L(a.bz, c.bz) : c.bz || 0;
}
/* 다른 사람 손의 물건 효과: 타는 스파클라의 불티(불붙는 순간 치익), 커피 김, 담배 연기 (main.js 의 내 손 효과와 같은 값) */
const _fx = new THREE.Vector3();
function peerFx(p, dt) {
  const m = p.av.itemMesh, W = ctx.W;
  const lit = !!m && _S.item === 'sparkler' && _S.lit;
  if (lit && !p.lit) { m.userData.emitter.getWorldPosition(_fx); sfxAt('sparkOn', _fx.x, _fx.y, _fx.z); }
  p.lit = lit;
  if (!m || !W.sparks) return;
  const it = _S.item, ud = m.userData;
  if (it === 'sparkler') {
    if (!lit) return;
    ud.emitter.getWorldPosition(_fx);
    for (let n = dt * 140; n > 0; n -= 1) if (Math.random() < n) W.sparks.spawn(_fx);
    return;
  }
  p.fxT += dt;
  if (it === 'coffee' && _S.amount > 0.02 && p.fxT > 0.07) { p.fxT = 0; ud.emitter.getWorldPosition(_fx); W.steam.spawn(_fx, { x: 0, y: 0.22, z: 0 }, 0.02, 2.2); }
  else if (it === 'smoke' && _S.amount > 0 && p.fxT > 0.12) { p.fxT = 0; ud.emitter.getWorldPosition(_fx); W.smoke.spawn(_fx, { x: 0.02, y: 0.16, z: 0 }, 0.01, 3.2, 0.03, 0.02, 0.16, 0.22); }
}
/* 다른 사람의 몸 소리: 앉기·일어나기(차는 문, 텐트는 지퍼)와 발소리.
   발소리는 아바타의 걸음 위상(A.ph)이 반 바퀴 넘어갈 때마다 — 내 발소리와 같은 바닥 판정, 해변·설산이면 발자국도 찍는다 */
function peerSounds(p) {
  const av = p.av, r = av.root.position, seat = SEATED(_S.mode) ? _S.seat : null;
  if (p.seat === undefined) p.seat = seat;
  else if (seat !== p.seat) {
    const was = p.seat; p.seat = seat;
    const inTent = s => !!s && (seatKind(s) === 'tent' || seatKind(s) === 'bed');
    if (!(inTent(was) && inTent(seat))) {
      const k = seat || was, x = r.x, y = r.y + 1, z = r.z;
      if (seatKind(k) === 'car') { sfxAt('doorOpen', x, y, z); setTimeout(() => { if (ctx.running) sfxAt('doorClose', x, y, z); }, 900); }
      else if (inTent(k)) sfxAt('zipper', x, y, z, seat ? 'open' : 'close');
      else sfxAt(seat ? 'sit' : 'stand', x, y, z);
    }
  }
  const n = Math.floor(av.ph / Math.PI);
  if (p.step === undefined || seat) { p.step = n; return; }
  if (n === p.step) return;
  p.step = n;
  const sf = surfaceAt(r.x, r.z); sfxAt('step', r.x, r.y + 0.1, r.z, sf);
  if (ctx.W.prints && (sf === 'snow' || sf === 'sand')) { p.side = !p.side; ctx.W.prints.stamp(r.x, r.z, -Math.sin(av.yaw), -Math.cos(av.yaw), p.side ? 1 : -1); }
}
const _tip = new THREE.Vector3();
function updatePeer(p, now, dt) {
  const last = p.buf[p.buf.length - 1];
  const show = ctx.running && !!last && last.run === 1 && last.bg === state.bg && (!isHost() || p.ok);
  if (!show) {
    if (p.av && p.av.root.visible) { hideRemote(p.av); p.seat = p.step = undefined; p.lit = false; }
    remoteRoll(p.id, null); chopRemote(p.id, null, dt); fishRemote(p.id, null);
    return;
  }
  if (!p.av) p.av = addRemote(p.name || '캠퍼');
  sample(p, now, _S);
  setRemoteTag(p.av, p.name || '캠퍼', !!last.aw || now - p.last > STALE);
  p.av.root.visible = true;
  updateAvatar(p.av, _S, dt);
  peerSounds(p);
  peerFx(p, dt);
  /* 장작 패기·낚시: 그루터기의 장작·반쪽, 부두의 줄·찌를 그 사람 몫으로 그린다 (낚싯대 끝은 아바타 손의 낚싯대에서) */
  chopRemote(p.id, _S.mode === 'chop' ? _S : null, dt);
  const rod = _S.fs >= 0 && p.av.itemType === 'rod' ? p.av.itemMesh : null;
  if (rod) { rod.userData.setBend(_S.fb); p.av.root.updateMatrixWorld(true); rod.userData.tip.getWorldPosition(_tip); }
  fishRemote(p.id, rod ? _S : null, _tip, dt);
  /* 굴리는 눈덩이: 내려놓았다는 소식을 받은 뒤로는, 굴리지 않는 스냅샷이 올 때까지 숨긴다 */
  if (!last.br) p.snowHold = false;
  if (!p.snowHold && _S.br > 0) remoteRoll(p.id, _S.bx, _S.bz, _S.br); else remoteRoll(p.id, null);
}

/* 캠핑장 안(같은 장소에서 캠핑 중)의 사람마다 { 누워 기다리는지, 자리 비움인지, 앉은 자리, 총을 들었는지, 꿈을 꾼 적이 없는지 }. 첫 칸은 나 */
function campers(now) {
  const out = [{ id: N.self, zz: sleepWaiting(), away: ctx.paused || document.hidden, seat: SEATED(state.mode) ? state.seat : null, gun: state.item === 'gun', nd: records.dreams === 0 }];
  for (const p of N.peers.values()) {
    const s = p.buf[p.buf.length - 1];
    if (!s || s.run !== 1 || s.bg !== state.bg || (isHost() && !p.ok)) continue;
    out.push({ id: p.id, zz: s.zz === 1, away: s.aw === 1 || now - p.last > STALE, seat: SEATED(s.m) ? s.st : null, gun: s.i === 'gun', nd: s.nd === 1 });
  }
  return out;
}
/* 안내 줄 "(2/4)": 자리 비움이 아닌 사람 중 누워 기다리는 사람 수 / 자리 비움이 아닌 사람 수 */
export function netSleepCount() {
  const on = campers(performance.now()).filter(o => !o.away);
  return { n: on.filter(o => o.zz).length, of: on.length };
}
/* 방장: 자리 비움이 아닌 사람이 모두 누운 채 1초가 지나면 잠들기 신호를 보낸다.
   침낭은 방장이 정한다: 텐트 자리·침낭에 있던 사람은 자기 침낭, 나머지(자리 비움)는 빈 침낭을 앞에서부터 */
function hostNap(dt) {
  if (!ctx.running || state.mode === 'sleep') { N.napT = 0; return; }
  const all = campers(performance.now()), on = all.filter(o => !o.away);
  if (!on.length || !on.every(o => o.zz)) { N.napT = 0; return; }
  N.napT += dt; if (N.napT < 1) return; N.napT = 0;
  const own = s => s && (seatKind(s) === 'tent' || seatKind(s) === 'bed') ? s.replace('tent', 'bed') : null;
  const used = new Set(), beds = {};
  all.forEach(o => { const b = own(o.seat); o.bed = b && !used.has(b) ? b : null; if (o.bed) used.add(o.bed); });
  const free = seatsOf('bed').filter(b => !used.has(b));
  all.forEach(o => { beds[o.id] = o.bed || free.shift() || 'bed'; });
  /* 꿈: 한 명이라도 꿈을 꾼 적이 없으면 반드시, 아니면 1인과 같은 확률 */
  const dream = all.some(o => o.nd) || Math.random() < DREAM.chance;
  N.act.nap.send({ beds, dream });
  startNap(beds[N.self], dream);
}

/* ── 꿈속 운석 막기 ──
   방장: 자리 비움이 아닌 사람이 모두 총을 들었거나, 첫 사람이 총을 든 지 30초가 지나면 시작한다 */
function hostGuns(now) {
  if (!dreamWaiting()) { N.gunT = 0; return; }
  const on = campers(now).filter(o => !o.away), armed = on.filter(o => o.gun).length;
  if (!armed) return;
  if (!N.gunT) N.gunT = now;
  if (armed >= on.length || now - N.gunT > GUN_WAIT) { N.gunT = 0; dreamGo(); }
}
/* 꿈 신호: 방장은 친구의 "맞혔다"(hit)만 받고, 친구는 방장이 보낸 것(시작·운석·판정·순위)만 받는다 */
function gotDream(d, id) {
  if (!d || !ctx.running) return;
  if (isHost()) { if (d.op === 'hit' && (N.peers.get(id) || {}).ok) dreamClaim(d.id, id); return; }
  if (id !== N.hostId) return;
  N.lastHost = performance.now(); dreamRemote(d);
}
/* dream.js 가 쓰는 연결 고리: 방장인지, 내 id, 보내기(모두에게·방장에게), 캠핑장 사람들 이름, 총을 든 사람 수 */
function wireDream() {
  Object.assign(dreamNet, {
    host: isHost, self: () => N.self,
    send: d => { if (N.act) N.act.dream.send(d); },
    claim: d => { if (N.act && N.hostId) N.act.dream.send(d, N.hostId); },
    names: () => { const o = {}; campers(performance.now()).forEach(c => { o[c.id] = c.id === N.self ? nm(state.name) : nameOf(c.id); }); return o; },
    guns: () => { const on = campers(performance.now()).filter(o => !o.away); return { n: on.filter(o => o.gun).length, of: on.length }; },
  });
}

/* ── 매 프레임 (main.js) ── */
export function updateNet(dt) {
  if (!N.room) return;
  const now = performance.now(), A = N.act;
  N.sendT += dt;
  if (N.sendT >= (ctx.running ? 1 / HZ : 1)) { N.sendT = 0; A.snap.send(pack()); }
  if (isHost()) { N.worldT += dt; if (N.worldT >= 1) { N.worldT = 0; A.world.send(clockInfo()); } }
  if (isGuest() && N.hostId) { const away = now - N.lastHost > AWAY; if (away !== N.away) { N.away = away; if (ctx.running) updateHUD(); } }
  if (isHost()) { hostNap(dt); hostGuns(now); }
  /* 누워 기다리는 중·꿈속에서 총을 들고 기다리는 중이면 숫자(2/4)가 바뀔 때 안내 줄을 새로 쓴다 */
  let k = '';
  if (sleepWaiting()) { const c = netSleepCount(); k = 'z' + c.n + '/' + c.of; }
  else if (dreamReady()) { const c = dreamNet.guns(); k = 'g' + c.n + '/' + c.of; }
  if (k !== N.zzKey) { N.zzKey = k; if (k && ctx.running) updateHUD(); }
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
  N.room = null; N.act = null; N.self = null; N.hostId = null; N.hostName = ''; N.slot = 0; N.phase = 'off'; N.err = ''; N.away = false; N.live = false; N.shared = null; N.snow = null;
  N.hostLive = false; N.entering = false; N.napT = 0; N.zzKey = ''; N.gunT = 0;
  N.peers.forEach(p => { if (p.av) removeRemote(p.av); remoteRoll(p.id, null); chopRemote(p.id, null, 0); fishRemote(p.id, null); }); N.peers.clear();
  meteorHooks.send = null; session.gear = null;
  if (N.stash) { const s = N.stash; N.stash = null; state.bg = s.bg; state.time = s.time; state.clock = s.clock; }
  applyGear();
}
/* 방장: 출발 · 메뉴로 · 메뉴에서 장소·시각·색 바꿈 · 하루 길이·시간 흐름 바꿈 */
export function netStart() { if (!isHost() || !N.act) return; N.live = true; N.act.start.send(worldInfo()); }
export function netLobby() { if (!isHost() || !N.act) return; N.live = false; N.act.lobby.send(1); }
export function netRoom() { if (isHost() && N.act) N.act.room.send(worldInfo()); }
export function netWorld() { if (isHost() && N.act) N.act.world.send(clockInfo()); }
/* 게임에 들어간 순간 (game.js begin): 방장은 지금 상태를 알리고, 친구는 받아 둔 상태(불·랜턴·파라솔, 눈덩이·눈사람)를 바로 적용한다 */
export function netBegin() {
  if (isHost() && N.act) N.act.flags.send(flagsOf());
  else if (isGuest()) {
    if (N.shared) applyFlags(N.shared, true);
    if (N.snow) { snowLoad(N.snow); N.snow = null; }
  }
}
/* 함께 쓰는 물건을 바꿨다 (game.js toggleFire·toggleLamp, beach.js toggleParasol — 내 화면·소리는 이미 바뀌었다) */
export function netShare(k) {
  if (!N.act || !FLAG[k]) return;
  if (isHost()) N.act.flags.send(Object.assign(flagsOf(), { k, who: N.self }));
  else if (N.hostId) N.act.ask.send({ k, v: !!FLAG[k].get() }, N.hostId);
}
/* 내가 만든 것·한 일 소식 (스파클라를 꽂았다, 아이스박스를 열었다, 물고기를 낚았다, 눈덩이·눈사람) */
export function netFx(k, p) { if (N.act) N.act.fx.send(Object.assign({}, p, { k, bg: state.bg })); }
/* 다른 사람이 차지한 자리: seats 중 하나에 앉아(누워) 있거나, 'stump' 면 장작을 패는 중인 사람의 이름 */
export function netSeatTaken(seats) {
  for (const p of N.peers.values()) {
    /* 같은 장소에서 캠핑 중인 사람만. 아바타가 보이는지가 아니라 마지막 스냅샷으로 본다 (막 들어오는 중이라 아직 아무도 안 보여도 맞게) */
    const s = p.buf[p.buf.length - 1];
    if (!s || s.run !== 1 || s.bg !== state.bg || (isHost() && !p.ok)) continue;
    const at = s.m === 'chop' ? 'stump' : SEATED(s.m) ? s.st : null;
    if (at && seats.includes(at)) return p.name || '캠퍼';
  }
  return null;
}
/* 다른 사람이 트렁크를 열어 둔 중 — main.js 가 뚜껑을 연다 */
export const netTrunk = () => { for (const p of N.peers.values()) { const s = p.buf[p.buf.length - 1]; if (s && s.m === 'trunk' && p.av && p.av.root.visible) return true; } return false; };
/* 다른 사람 손에서 타는 스파클라 (userData) — main.js 가 조명을 배정하고 치익 소리 크기를 정한다 */
const _sparks = [];
export function netSparks() {
  _sparks.length = 0;
  for (const p of N.peers.values()) { const m = p.av && p.av.root.visible && p.av.itemMesh; if (m && m.userData.lit) _sparks.push(m.userData); }
  return _sparks;
}
/* 이름을 바꾸면 0.4초 뒤 모두에게 알린다 */
export function netProfile() { clearTimeout(N.profT); N.profT = setTimeout(() => { if (N.act) N.act.profile.send(profile()); }, 400); }
/* 시간 흐름 규칙: 친구는 방장의 하루 길이·시간 흐름을 따른다 (내 설정은 건드리지 않는다) */
export const clockRule = () => isGuest() && N.hostId ? { dayMin: N.dayMin, flow: N.flow } : { dayMin: settings.dayMin, flow: settings.flow };
/* 안내 줄: 방장 신호가 끊겼을 때 */
export const netNotice = () => isGuest() && N.away ? '방장이 잠시 자리를 비웠다' : null;
/* 처음 앉을 좌석: 1인·방장은 운전석, 친구는 자리 번호 순으로 조수석·뒷좌석 왼쪽·오른쪽 (이미 차 있으면 game.js 가 다른 빈 좌석을 고른다) */
export const netStartSeat = () => isGuest() ? ['car2', 'car3', 'car4'][(N.slot || 1) - 1] || 'car2' : 'car';
/* 다른 사람 아바타가 보이는 중 — main.js 가 그동안 그림자맵을 매 프레임 갱신한다 */
export const netBusy = () => { for (const p of N.peers.values()) if (p.av && p.av.root.visible) return true; return false; };

/* 친구: 방장이 캠핑장으로 떠나 있는지 (떠나기 버튼을 밝힌다) */
export const netHostLive = () => isGuest() && N.hostLive;
/* 친구의 떠나기: 방장이 캠핑 중이면 "들어갈게"를 보내고 답(welcome go)을 받으면 들어간다. 못 가면 이유를 돌려준다 */
export function netEnter() {
  if (!isGuest() || !N.act || !N.hostId) return '캠핑장을 아직 찾지 못했다';
  if (!N.hostLive) return '방장이 떠나기 전에는 떠날 수 없다';
  if (N.entering) return null;
  N.entering = true; N.act.hello.send({ v: V, name: nm(state.name), enter: 1 }, N.hostId);
  setTimeout(() => { N.entering = false; }, 3000);
  return null;
}