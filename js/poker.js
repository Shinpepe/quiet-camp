import * as THREE from 'three';
import { ctx, state, records, saveSettings } from './state.js';
import { POKER } from './data.js';
import { josa, clamp, isTouch, rnd } from './util.js';
import { sfx, sfxAt } from './audio.js';
import { toast } from './gauge.js';
import { startHand, act, autoAct, leave, legal, publicState, handLabel, UNIT, RANK_CHAR, STREET_NAME } from './pokerEngine.js';
import { renderChips, setButton, updateTable, clearTable, cardPose, holeXZ, boardXZ, deckXZ, stackXZ, betXZ, LAY, PEEK_TILT } from './cards.js';
import { netPoker, netPokerSeats, netIsHost, netSelf, netName, netBubble } from './net.js';

/* ══ 홀덤 진행 (멀티 캠핑, H3·H4·H5) ══
   방장이 딜러다: 누가 앉았는지 보고(net.js netPokerSeats), 규칙 엔진(pokerEngine.js)으로 판을 돌리고, 칩 장부를 가진다.
   모두에게 공개 상태(st)를 보내고, 손패(hole)는 각자에게만 보낸다. 친구는 행동(act)·시작(go)·손패 다시 받기(sync)·칩 벌기(earn)를 방장에게 부탁한다.
   방장도 같은 길을 쓴다 — 자기에게 보내는 것은 바로 받는다.
   판의 흐름: wait(대기) → 앉은 사람 누구나 C → count(10초 세기) → play(판) → result(결과가 떠 있음) → 누구나 C 다시하기 → count …
     세는 동안 일어나면 그 판에서 빠진다. 칩이 있는 사람이 둘 아래로 줄면 세기를 멈춘다.
   차례 시간 60초, 자리 비움이면 10초. 시간이 지나면 체크할 수 있으면 체크, 아니면 폴드.
   두 판 연속 시간이 지나면 쉬는 중(다음 판부터 빠진다, C 로 다시 낀다).
   판 도중 일어나거나 연결이 끊기면 폴드 (올인한 사람은 판에 남는다).
   칩 장부: 처음 앉을 때 1,000칩. 일어나도·잠들어도 그대로, 캠핑장을 나가면 사라진다.
   칩 벌기(H3-2): 판이 끝나 칩이 0 이 되면 빈털터리(broke). 빈털터리일 때만 장작을 패서 칩을 번다 (data.js POKER.earn).
     back(200) 칩이 모이기 전에는 앉아 있어도 판에 들어가지 않고(구경 중), 다시 판에 들어가면 빈털터리가 풀린다.
   포커 상자(#pokerbox): 홀덤 자리에 앉아 있는 동안 아이템 상자 자리에 뜬다. view() 가 보여 줄 것을 정하고 render() 가 그린다.
     PC 는 키(doAct 로 모인다), 폰은 상자 안 버튼(data-act)을 직접 누른다. 시간 막대는 다시 그리지 않고 숫자만 바꾼다(tickTimer).
   들춰 보기(H4-1): 내 손패는 엎어 둔다. 누르고 있는 동안(폰 = 작은 카드, PC = Space) 먼 쪽 모서리를 들어 앞면을 본다.
     한 번 본 뒤에는 포커 상자에 앞면과 족보가 보인다.
     다른 사람에게는 "들춰 보는 중"(스냅샷 pk)만 간다: 그 사람 카드의 가까운 쪽 모서리를 살짝 들고 아랫면은 흰 종이로 (H5)
   족보표(#pokerRanks): 폰 "족보" 버튼, PC H 키. 지금 내 패를 표시한다.
   테이블 연출(H4-2): 아래 "테이블 연출" 참고. 결과 소식은 카드를 다 펼친 뒤에 띄운다.
   다른 사람 보기(H4-3): 방장이 판에서 일어난 일(S.log 의 새 줄, st 의 ev)을 함께 보낸다 →
     행동 말풍선(이름표 위, 칩을 내면 손을 앞으로) · 화면 밖 자리 알약(#pokerPills) · 판 흐름 소식(처음 한 번은 설명을 붙인다)
   마무리(H5): 이름표 아래 칩 줄(pokerTagLine) · 기록(records.poker) · 오늘의 테이블 카드(#pokerDay, 홀덤 자리에서 일어날 때)
   화면 문구: 나란한 항목은 " / ", 문장이 끝나고 이어지면 ". ", 이름 여러 개는 ", " */

const TURN = 60000, AWAY = 10000, COUNT = 3, LOW = 10, E = POKER.earn;
const PEEK_HINT = isTouch ? '눌러서 카드 보기' : 'Space를 눌러서 카드 보기';
/* 다른 사람이 들춰 볼 때 그 사람 카드의 가까운 쪽 모서리를 드는 각도 (rad, 약 17°) */
const REMOTE_PEEK = 0.3;
/* game.js 가 채운다: hud = 일어나기 안내가 바뀌면 updateHUD, stand = 일어나기(폰 버튼) */
export const pokerHooks = { hud: () => {}, stand: () => {} };
/* 자리 id → 테이블 자리 번호 ('poker' = 0, 'poker2' = 1 …), 홀덤 자리가 아니면 −1 */
export const pokerSeatNo = id => { const m = /^poker(\d?)$/.exec(id || ''); return m ? (m[1] ? +m[1] - 1 : 0) : -1; };
const mySeat = () => state.mode === 'seated' ? pokerSeatNo(state.seat) : -1;
const won = n => (n || 0).toLocaleString('ko-KR');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* 팟 = 가운데 쌓인 칩 + 이번 라운드에 건 칩 */
const potNow = pub => pub.pot + pub.seats.reduce((s, p) => s + (p ? p.bet : 0), 0);

/* ── 방장: 판과 칩 장부 ──
   logN: 지난번 보낸 뒤로 S.log 의 몇 번째 줄부터가 새 일인지 */
const H = {};
function hostReset(keep) {
  const L = keep ? H.ledger : null, B = keep ? H.broke : null;
  Object.assign(H, { ledger: new Map(), gone: new Set(), rest: new Set(), streak: new Map(), timed: new Set(), broke: new Set(), lastEarn: new Map(), awayAt: new Map(),
    S: null, ph: 'wait', cnt: 0, cntT: 0, by: '', hand: 0, prevBtn: -1, dl: 0, turnKey: '', turnAt: 0, res: null,
    tbl: [null, null, null, null], tblKey: '', beat: 0, dirty: true, logN: 0 });
  if (L) { H.ledger = L; H.broke = B; }
}
/* ── 모두(방장 포함): 받은 상태와 내 화면 ──
   peek = 지금 들춰 보는 중, seen = 손패를 본 판 번호, ranks = 족보표가 열려 있는지
   flash = 자리마다 방금 한 행동 { text, hot, until } (알약), runHand·sideHand = 그 판에 올인·사이드 팟 소식을 띄웠는지
   my = 이번 판을 시작할 때 내 칩 { hand, start } (오늘의 테이블 계산), day = 이번 캠핑의 홀덤 { hands, wins, net, best, shown } */
const V = {};
function viewReset() {
  Object.assign(V, { ph: 'wait', cnt: 0, by: '', nx: false, pub: null, tbl: [null, null, null, null], dl: 0, res: null, broke: false,
    hole: null, raise: null, stN: 0, lock: -1, asked: 0, resHand: 0, wasTurn: false, hudT: 0, boxKey: '', upKey: '',
    peek: false, seen: 0, ranks: false, ranksKey: '',
    flash: [null, null, null, null], runHand: -1, sideHand: -1, my: { hand: -1, start: 0 },
    day: { hands: 0, wins: 0, net: 0, best: 0, shown: 0 }, dayUntil: 0, seatPrev: -1, lostT: 0 });
}
/* ══ 테이블 연출 (H4-2) ══
   받은 상태(V)에서 테이블이 "되어야 할 모습"(target)을 만들고, 지금 보이는 모습(D)과 비교해 움직임을 만든다.
   카드: 새 판이면 덱을 섞고 버튼 왼쪽부터 한 장씩 두 바퀴 돌린다 · 바닥 카드는 덱에서 미끄러져 와 뒤집힌다
     (한 번에 여러 장면이 나오면 — 올인 — 1초씩 간격) · 폴드한 카드는 덱으로 거둔다 · 공개되면 뒤집힌다
     · 세기(count)가 시작되면 지난 판 카드를 덱으로 거둔다 · 결과가 나오면 이긴 다섯 장만 밝게 들어 올린다
   칩: 앞 칩 → 베팅 줄(밀기) · 베팅 줄·앞 칩 → 팟(라운드 끝) · 팟 → 이긴 사람(카드를 다 펼친 뒤).
     날아가는 동안에는 출발지에서 빼고, 도착하면 도착지에 더한다. 다 끝나면 받은 상태와 똑같이 맞춘다
   중간에 들어왔을 때·같은 판이 다시 보일 때는 움직이지 않고 바로 놓는다
   D.until: 카드 움직임이 끝나는 시각 — 바닥 카드·결과 소식·팟 나누기가 이 뒤로 기다린다 */
let clock = 0;
const D = {};
function dirReset() {
  Object.assign(D, { hand: -1, board: 0, until: 0, btn: -1, sawCount: false, swept: false, sweptHand: -1,
    seat: [0, 1, 2, 3].map(() => ({ on: false, mine: false, shown: false, peek: false, rpeek: false })),
    goal: null, disp: null, chipKey: '', chipDirty: false, pend: 0, tasks: [], tick: -1, riffle: 3,
    /* 칩 계획 번호: 계획이 바뀌면 그 전에 잡아 둔 비행(출발 전·날아가는 중)은 무시한다 */
    cgen: (D.cgen || 0) + 1 });
}
hostReset(); viewReset(); dirReset();
/* 캠핑장에 들어갈 때·나갈 때 (game.js) */
export function pokerReset(keepLedger) {
  hostReset(keepLedger); viewReset(); dirReset(); render(null); renderRanks(); hideDay();
  const pe = document.getElementById('pokerPills'); if (pe) pe.innerHTML = '';
  if (ctx.W.poker) clearTable(ctx.W.poker);
}

/* 빈털터리인데 아직 판에 낄 만큼 모으지 못했다 */
const short = id => H.broke.has(id) && (H.ledger.get(id) || 0) < E.back;
/* 다음 판에 들어갈 사람: 앉아 있고, 칩이 있고, 쉬는 중이 아니고, 빈털터리라면 다시 낄 만큼 모은 사람 */
const eligible = () => H.tbl.filter(o => o && (H.ledger.get(o.id) || 0) > 0 && !H.rest.has(o.id) && !short(o.id));
/* 지금 차례의 마감 시각: 자리 비움이면 차례가 시작된 때와 자리를 비운 때 중 늦은 쪽부터 10초 */
const turnDl = () => {
  const S = H.S, o = S && H.tbl[S.turn]; if (!o || !o.away) return H.dl;
  return Math.min(H.dl, Math.max(H.turnAt, H.awayAt.get(o.id) || 0) + AWAY);
};

function hostTick(dt) {
  const now = performance.now(), tbl = [null, null, null, null], at = new Map();
  for (const o of netPokerSeats()) {
    if (o.seat < 0 || o.seat > 3 || tbl[o.seat] || at.has(o.id)) continue;
    tbl[o.seat] = o; at.set(o.id, o.seat);
    if (H.gone.has(o.id)) H.gone.delete(o.id);
    if (!H.ledger.has(o.id)) H.ledger.set(o.id, POKER.start);
  }
  H.tbl = tbl;
  /* 자리 비움이 시작된 시각 (앉아 있는 사람만, 돌아오면 지운다) — 차례 마감은 이때부터 10초 */
  const aw = new Map();
  tbl.forEach(o => { if (o && o.away) aw.set(o.id, H.awayAt.get(o.id) ?? now); });
  H.awayAt = aw;
  const key = tbl.map(o => o ? o.id + (o.away ? '*' : '') : '').join(',');
  if (key !== H.tblKey) { H.tblKey = key; H.dirty = true; }
  const S = H.S;
  if (H.ph === 'play') {
    /* 자리를 떠난 사람(일어남·연결 끊김)은 폴드 */
    S.seats.forEach((p, k) => { if (p && p.st === 'in' && at.get(p.id) !== k) { leave(S, k); H.dirty = true; } });
    if (S.street !== 'done') {
      const tk = S.turn + ':' + S.log.length;
      if (tk !== H.turnKey) { H.turnKey = tk; H.turnAt = now; H.dl = now + TURN; H.dirty = true; }
      if (now >= turnDl()) { H.timed.add(S.seats[S.turn].id); autoAct(S, S.turn); H.dirty = true; }
    }
    if (S.street === 'done') finish();
  } else if (H.ph === 'count') {
    if (eligible().length < 2) { H.ph = H.S ? 'result' : 'wait'; H.dirty = true; }
    else {
      H.cntT -= dt; const c = Math.max(1, Math.ceil(H.cntT));
      if (c !== H.cnt) { H.cnt = c; H.dirty = true; }
      if (H.cntT <= 0) deal();
    }
  }
  H.beat += dt;
  if (H.dirty || (H.beat >= 1 && (tbl.some(Boolean) || H.S))) broadcast();
}
function deal() {
  const pl = eligible();
  if (pl.length < 2) { H.ph = H.S ? 'result' : 'wait'; H.dirty = true; return; }
  const S = startHand({ players: pl.map(o => ({ seat: o.seat, id: o.id, chips: H.ledger.get(o.id) })), prevButton: H.prevBtn, sb: POKER.sb, bb: POKER.bb, hand: ++H.hand });
  H.S = S; H.prevBtn = S.btn; H.ph = 'play'; H.res = null; H.timed.clear(); H.turnKey = ''; H.dirty = true; H.logN = 0;
  /* 다시 판에 들어간 사람은 빈털터리가 풀린다 */
  pl.forEach(o => H.broke.delete(o.id));
  S.seats.forEach(p => { if (p) sendHole(p.id); });
  if (S.street === 'done') finish();
}
/* 판이 끝났다: 칩을 장부에 옮기고, 칩이 0 이 된 사람은 빈털터리로, 시간 초과가 두 판 이어진 사람은 쉬게 하고, 결과를 남긴다.
   결과에는 이긴 다섯 장(b)도 담는다 (쇼다운 강조) */
function finish() {
  const S = H.S;
  S.seats.forEach(p => {
    if (!p) return;
    if (!H.gone.has(p.id)) { H.ledger.set(p.id, p.chips); if (p.chips <= 0) H.broke.add(p.id); }
    const n = H.timed.has(p.id) ? (H.streak.get(p.id) || 0) + 1 : 0;
    if (n >= 2) { H.rest.add(p.id); H.streak.set(p.id, 0); } else H.streak.set(p.id, n);
  });
  const r = S.result;
  H.res = { fold: r.fold, pots: r.pots.map(p => ({ a: p.amount, n: p.name, w: p.winners.map(w => [w.seat, w.amount]), b: p.best || null })) };
  H.ph = 'result'; H.dirty = true;
}
function sendHole(id) {
  const S = H.S, p = S && S.seats.find(q => q && q.id === id); if (!p) return;
  const m = { op: 'hole', h: S.hand, c: p.hole.slice() };
  if (id === netSelf()) gotHole(m); else netPoker(m, id);
}
/* 공개 상태를 보낸다. 지난번 뒤로 판에서 일어난 일(ev — 행동·블라인드·카드·팟)도 함께 (말풍선·소식용, 손패는 들어 있지 않다) */
function broadcast() {
  H.beat = 0; H.dirty = false;
  const S = H.S, now = performance.now();
  const m = { op: 'st', ph: H.ph, cnt: H.cnt, by: H.by, nx: H.hand > 0, pub: S ? publicState(S) : null, res: H.res, bk: [...H.broke],
    dl: H.ph === 'play' && S && S.street !== 'done' ? Math.max(0, Math.round(turnDl() - now)) : 0,
    tbl: H.tbl.map(o => o && { id: o.id, n: o.name, c: H.ledger.get(o.id) || 0, r: H.rest.has(o.id) ? 1 : 0, b: short(o.id) ? 1 : 0 }) };
  if (S && S.log.length > H.logN) { m.ev = S.log.slice(H.logN).filter(e => e.type !== 'end'); H.logN = S.log.length; }
  netPoker(m); gotSt(m);
}
/* 칩 벌기: 빈털터리만, 상한까지, 장작은 1초에 한 번 */
function hostEarn(d, id) {
  const c = H.ledger.get(id);
  if (!H.broke.has(id) || c === undefined || c >= E.cap) return;
  const now = performance.now(); if (now - (H.lastEarn.get(id) || -1e9) < 1000) return;
  H.lastEarn.set(id, now);
  const to = Math.min(E.cap, c + (d.g ? E.great : E.chop)), got = to - c;
  H.ledger.set(id, to); H.dirty = true;
  const m = { op: 'earned', g: d.g ? 1 : 0, a: got, c: to, back: c < E.back && to >= E.back ? 1 : 0, full: to >= E.cap ? 1 : 0 };
  if (id === netSelf()) gotEarned(m); else netPoker(m, id);
}
/* 방장이 받는 부탁: 행동 · 시작(다시하기) · 손패 다시 보내기 · 칩 벌기 */
function hostRecv(d, id) {
  const seat = H.tbl.findIndex(o => o && o.id === id), S = H.S;
  if (d.op === 'act') {
    if (H.ph !== 'play' || !S || d.h !== S.hand || seat < 0 || !S.seats[seat] || S.seats[seat].id !== id) return;
    const e = act(S, seat, { k: d.k, to: d.to });
    H.dirty = true;
    if (e) { if (id === netSelf()) toast(e); else netPoker({ op: 'err', m: e }, id); return; }
    H.rest.delete(id);
    if (S.street === 'done') finish();
  } else if (d.op === 'go') {
    if (seat < 0) return;
    if (H.rest.delete(id)) H.dirty = true;
    if ((H.ph === 'wait' || H.ph === 'result') && eligible().length >= 2) { H.ph = 'count'; H.cntT = COUNT; H.cnt = COUNT; H.by = netName(id); H.dirty = true; }
  } else if (d.op === 'sync') { if (S && S.street !== 'done') sendHole(id); H.dirty = true; }
  else if (d.op === 'earn') hostEarn(d, id);
}
const toHost = d => { if (netIsHost()) hostRecv(d, netSelf()); else netPoker(d, 'host'); };

/* ── net.js 가 부른다 ── */
export function pokerRecv(d, id) {
  if (!d || typeof d.op !== 'string') return;
  if (netIsHost()) hostRecv(d, id);
  else if (d.op === 'st') gotSt(d);
  else if (d.op === 'hole') gotHole(d);
  else if (d.op === 'earned') gotEarned(d);
  else if (d.op === 'err' && typeof d.m === 'string') toast(d.m.slice(0, 40));
}
/* 방장: 캠핑장을 떠난 사람의 칩은 사라진다 (판 중이면 hostTick 이 폴드시킨다) */
export function pokerPeerLeft(id) {
  if (!netIsHost()) return;
  H.gone.add(id); H.ledger.delete(id); H.rest.delete(id); H.streak.delete(id); H.broke.delete(id); H.lastEarn.delete(id); H.dirty = true;
}
/* game.js: 내가 장작을 쪼갰다 (great = 한 번에 쪼갬). 빈털터리일 때만 방장에게 알린다 */
export function pokerEarn(great) {
  if (!netSelf() || !ctx.running || !V.broke) return;
  toHost({ op: 'earn', k: 'chop', g: great ? 1 : 0 });
}
/* net.js: 내가 지금 카드를 들춰 보는 중인지 (스냅샷 pk — 다른 사람 화면에서 내 카드 모서리가 들린다) */
export const pokerPeeking = () => !!V.peek;

/* ── 받은 상태 ── */
const mineAt = () => { const self = netSelf(); return V.pub ? V.pub.seats.findIndex(p => p && p.id === self) : -1; };
function gotSt(m) {
  if (!m || !Array.isArray(m.tbl)) return;
  const now = performance.now(), wasBroke = V.broke;
  V.ph = m.ph; V.cnt = m.cnt | 0; V.by = typeof m.by === 'string' ? m.by : ''; V.nx = !!m.nx;
  V.pub = m.pub || null; V.res = m.res || null; V.dl = now + (m.dl || 0);
  V.tbl = [0, 1, 2, 3].map(k => m.tbl[k] || null); V.stN++;
  V.broke = Array.isArray(m.bk) && m.bk.includes(netSelf());
  const first = V.stN === 1;
  /* 중간에 들어왔을 때 지난 결과를 다시 알리지 않게, 지난 일로 말풍선을 띄우지 않게 */
  if (first && V.pub) V.resHand = V.pub.hand;
  if (!first && Array.isArray(m.ev) && m.ev.length) onEvents(m.ev);
  if (V.broke && !wasBroke && !first) { records.poker.broke++; saveSettings(); }
  const k = mineAt(), live = !!V.pub && V.pub.street !== 'done';
  /* 이번 판을 시작할 때의 내 칩 (오늘의 테이블) */
  if (live && k >= 0 && V.my.hand !== V.pub.hand) { const p = V.pub.seats[k]; V.my = { hand: V.pub.hand, start: p.chips + p.total }; }
  /* 판에 들었는데 손패를 못 받았으면 다시 달라고 한다 (중간에 들어옴·새로고침) */
  if (live && k >= 0 && (!V.hole || V.hole.h !== V.pub.hand) && now - V.asked > 1500 && !netIsHost()) { V.asked = now; netPoker({ op: 'sync' }, 'host'); }
  const turn = live && k >= 0 && V.pub.turn === k;
  if (turn && !V.wasTurn) { sfx('pokerTurn'); if (isTouch && navigator.vibrate) navigator.vibrate(40); }
  V.wasTurn = turn; if (!turn) V.raise = null;
  if (!live) V.peek = false;
}
function gotHole(d) { if (typeof d.h === 'number' && Array.isArray(d.c) && d.c.length === 2) V.hole = { h: d.h, c: d.c }; }
/* 번 칩 소식: "장작 값으로 25칩을 벌었다. 지금 75칩" */
function gotEarned(m) {
  if (typeof m.a !== 'number' || typeof m.c !== 'number') return;
  records.poker.earned += Math.max(0, Math.floor(m.a)); saveSettings();
  let s = `${m.g ? '한 번에 쪼갰다. ' : '장작 값으로 '}${won(m.a)}칩을 벌었다`;
  s += m.full ? `. ${won(E.cap)}칩을 다 채웠다` : `. 지금 ${won(m.c)}칩` + (m.back ? '. 이제 판에 다시 낄 수 있다' : '');
  toast(s);
}

/* ── 판에서 일어난 일 (H4-3): 행동 말풍선 · 알약의 방금 한 행동 · 판 흐름 소식 ── */
/* 행동 → [글자, 강조색인지(벳·레이즈·올인), 칩을 내는지(손을 앞으로)] */
function actText(e) {
  if (e.k === 'fold') return ['폴드', false, false];
  if (e.k === 'check') return ['체크', false, false];
  if (e.k === 'call') return e.allin ? [`올인 ${won(e.to)}`, true, true] : [`콜 ${won(e.amount)}`, false, true];
  return e.allin ? [`올인 ${won(e.to)}`, true, true] : [`${e.k === 'bet' ? '벳' : '레이즈'} ${won(e.to)}`, true, true];
}
/* 판 흐름 소식: [짧게, 처음 한 번 (설명)]. 이미 본 설명은 records.poker.help 에 남는다. 짧은 글이 없으면 처음 한 번만 */
const NEWS = {
  blind: [null, '판이 시작됐다. 버튼 왼쪽 두 사람이 블라인드 10, 20을 먼저 건다'],
  flop: ['플랍이 나왔다', '플랍이 나왔다. 바닥 카드는 모두가 함께 쓴다'],
  turn: ['턴이 나왔다', '턴이 나왔다. 바닥 카드가 네 장이 됐다'],
  river: ['리버가 나왔다', '리버가 나왔다. 마지막 베팅이다'],
  side: ['사이드 팟이 생겼다', '사이드 팟이 생겼다. 올인한 사람은 자기가 건 만큼만 겨룬다'],
  runout: ['모두 올인했다. 남은 카드를 펼친다', '모두 올인했다. 더 걸 사람이 없어 남은 카드를 펼친다'],
};
function news(key) {
  if (mySeat() < 0 || !NEWS[key]) return;
  const help = records.poker.help, seen = help.includes(key), [s, l] = NEWS[key], text = seen ? s : l;
  if (!seen) { help.push(key); saveSettings(); }
  if (text) toast(text);
}
function onEvents(evs) {
  const pub = V.pub; if (!pub) return;
  const self = netSelf();
  evs.forEach(e => {
    if (!e || typeof e.type !== 'string') return;
    if (e.type === 'act') {
      const p = pub.seats[e.seat]; if (!p) return;
      const [text, hot, push] = actText(e);
      V.flash[e.seat] = { text, hot, until: clock + 2.2 };
      if (p.id !== self) netBubble(p.id, text, hot, push);
    } else if (e.type === 'deal') news('blind');
    else if (e.type === 'street') {
      if (!e.runout) news(e.street);
      else if (V.runHand !== pub.hand) { V.runHand = pub.hand; news('runout'); }
    } else if (e.type === 'collect' && Array.isArray(e.pots) && e.pots.length > 1 && V.sideHand !== pub.hand) { V.sideHand = pub.hand; news('side'); }
  });
}

function seatName(k) {
  const p = V.pub && V.pub.seats[k], t = V.tbl[k];
  if (p && t && t.id === p.id) return t.n;
  return p ? netName(p.id) : t ? t.n : '캠퍼';
}
/* 자리 k 에 앉은 사람의 칩 줄: { name, line, turn, dim } (이름표·알약 공용)
   판에 있음 "760칩" (+ " / 폴드" · " / 올인") · 쉬는 중 "980칩 / 쉬는 중" · 이번 판에 끼지 못함(빈털터리·판 도중에 앉음) "75칩 / 구경 중" */
function seatInfo(k) {
  const t = V.tbl[k]; if (!t) return null;
  const pub = V.pub, live = !!pub && pub.street !== 'done', q = live && pub.seats[k], p = q && q.id === t.id ? q : null;
  let line, turn = false, dim = false;
  if (p) {
    line = `${won(p.chips)}칩`;
    if (p.st === 'fold') { line += ' / 폴드'; dim = true; }
    else if (p.st === 'allin') line += ' / 올인';
    else turn = pub.turn === k;
  } else if (t.r) line = `${won(t.c)}칩 / 쉬는 중`;
  else if (t.b || live) line = `${won(t.c)}칩 / 구경 중`;
  else line = `${won(t.c)}칩`;
  return { name: t.n, line, turn, dim };
}
/* net.js: 이름표 아래 줄. 홀덤 자리에 앉아 있을 때만 (아니면 null — 이름만) */
export function pokerTagLine(id) {
  const k = V.tbl.findIndex(o => o && o.id === id); if (k < 0) return null;
  const i = seatInfo(k); return i.line + (i.turn ? ' / 차례' : '');
}
/* "지윤이 투 페어로 이겼다" — 이긴 사람과 패만. 사이드 팟을 다른 사람이 가져가면 덧붙인다 */
function resultText() {
  const r = V.res; if (!r || !r.pots.length) return '';
  const who = ws => ws.map(w => seatName(w[0])).join(', '), p0 = r.pots[0], w0 = who(p0.w);
  let s = r.fold ? `${josa(w0, '이', '가')} 팟을 가져갔다` : `${josa(w0, '이', '가')} ${p0.n}로 ${p0.w.length > 1 ? '나눠 가졌다' : '이겼다'}`;
  r.pots.slice(1).forEach(p => { const w = who(p.w); if (w !== w0) s += `. 사이드 팟은 ${w}`; });
  return s;
}

/* ── 내 행동 ── */
const myLegal = () => { const k = mineAt(); return k >= 0 && V.pub && V.pub.street !== 'done' ? legal(V.pub, k) : null; };
function sendAct(k, to) {
  if (V.lock === V.stN || !V.pub) return;   // 보낸 행동의 답(새 상태)을 기다리는 중
  V.lock = V.stN; V.raise = null;
  toHost({ op: 'act', h: V.pub.hand, k, to });
}
/* 빠른 금액: 최소 · ½팟 · 팟 · 올인 (팟 레이즈 = 지금 베팅 + 콜한 뒤의 팟) */
function sizes(L) {
  const pot = potNow(V.pub) + L.toCall, r = to => clamp(Math.round(to / UNIT) * UNIT, L.minTo, L.maxTo);
  return [L.minTo, r(L.curBet + pot / 2), r(L.curBet + pot), L.maxTo];
}
const nudge = (L, dir) => { V.raise.to = clamp(V.raise.to + dir * POKER.bb, L.minTo, L.maxTo); };
/* 누른 뒤 포커 상자를 바로 다시 그린다 (다음 프레임) */
const refresh = () => { V.hudT = 1; };
/* 들춰 보기: 판에 살아 있고 손패를 받았을 때만. 처음 보면 그 판의 손패를 "봤다"로 남긴다 */
function setPeek(on) {
  const k = mineAt(), pub = V.pub, live = !!pub && pub.street !== 'done';
  const can = !!on && live && k >= 0 && !!V.hole && V.hole.h === pub.hand && pub.seats[k].st !== 'fold';
  if (can) V.seen = pub.hand;
  if (V.peek !== can) { V.peek = can; refresh(); }
}
/* 모든 행동은 여기로 모인다 (PC 키 · 폰 버튼).
   call = 체크/콜, 판 밖에서는 시작하기·다시하기·다시 끼기 · raise = 레이즈 패널 열기, 열려 있으면 확정
   raiseGo = 확정 · raiseX = 취소 · q1~q4 = 빠른 금액 · up·down = 빅블라인드만큼 · ranks = 족보표 · stand = 일어나기 */
function doAct(a) {
  const L = myLegal();
  if (a === 'stand') { pokerHooks.stand(); return; }
  if (a === 'ranks') V.ranks = !V.ranks;
  else if (a === 'call') { if (L) sendAct(L.canCheck ? 'check' : 'call'); else toHost({ op: 'go' }); }
  else if (a === 'fold') { if (L) sendAct('fold'); }
  else if (a === 'raise') { if (L && L.canRaise) { if (V.raise) sendAct(V.raise.to >= L.maxTo ? 'allin' : 'raise', V.raise.to); else V.raise = { to: L.minTo }; } }
  else if (a === 'raiseGo') { if (L && V.raise) sendAct(V.raise.to >= L.maxTo ? 'allin' : 'raise', V.raise.to); }
  else if (a === 'raiseX') V.raise = null;
  else if (/^q[1-4]$/.test(a)) { if (L && V.raise) V.raise.to = sizes(L)[+a[1] - 1]; }
  else if (a === 'up' || a === 'down') { if (L && V.raise) nudge(L, a === 'up' ? 1 : -1); }
  refresh();
}
const KEYMAP = { KeyF: 'fold', KeyC: 'call', KeyR: 'raise', Backspace: 'raiseX', ArrowUp: 'up', ArrowDown: 'down', Digit1: 'q1', Digit2: 'q2', Digit3: 'q3', Digit4: 'q4', KeyH: 'ranks' };
/* PC 키 (game.js keydown·keyup): F 폴드 · C 체크·콜 · R 레이즈 · H 족보표 · Space 누르고 있기 = 들춰 보기 */
export function pokerKey(code) {
  if (mySeat() < 0 || !ctx.running || ctx.paused) return false;
  if (code === 'Space') { setPeek(true); return true; }
  const a = KEYMAP[code]; if (!a) return false;
  doAct(a); return true;
}
export function pokerKeyUp(code) { if (code === 'Space') setPeek(false); }
/* 휠: 레이즈 패널이 열려 있으면 금액 (빅블라인드 단위) */
export function pokerWheel(dy) { const L = myLegal(); if (!L || !V.raise || !dy) return false; nudge(L, dy < 0 ? 1 : -1); refresh(); return true; }
/* 오른쪽 클릭: 레이즈 패널 닫기 */
export function pokerCancel() { if (!V.raise) return false; V.raise = null; refresh(); return true; }
/* 일어나기 안내: 판에 살아 있으면 폴드한다고 알려 준다 (올인이면 판에 남으므로 그냥 일어나기) */
export function pokerUpLabel() {
  const k = mineAt(); return k >= 0 && V.pub && V.pub.street !== 'done' && V.pub.seats[k].st === 'in' ? '폴드하고 일어나기' : null;
}

/* ── 포커 상자: 보여 줄 것 (view) ──
   { cards, hand, peek(누르면 들춰 보기), title, hd: 윗줄 버튼, stats: [[이름, 칩]], earn: { now, goal }, timer: { who, left, mine }, msg, keys, raise }
   버튼 하나 = [키 글자, 이름, 행동, 지금 값인지, 덧붙일 class, 금액] */
/* 내 차례의 상황 문장: 누가 얼마를 걸었고 나는 얼마를 더 내야 하는지 */
const aggressive = l => l === 'bet' || l === 'raise' || l === 'allin';
function turnMsg(pub, k, L, p) {
  if (L.toCall <= 0) return pub.street === 'pre' ? '모두 따라왔다. 체크하거나 올릴 수 있다' : L.open ? '아직 아무도 걸지 않았다. 체크하거나 걸 수 있다' : '체크할 수 있다';
  let ai = -1, mx = -1;
  pub.seats.forEach((q, j) => {
    if (!q || j === k || q.st === 'fold') return;
    if (q.bet > mx || (q.bet === mx && aggressive(q.last) && !aggressive(pub.seats[ai].last))) { mx = q.bet; ai = j; }
  });
  const q = pub.seats[ai], who = josa(seatName(ai), '이', '가');
  const head = q.last === 'bb' || q.last === 'sb' ? `빅블라인드는 ${won(pub.bb)}이다` : q.last === 'raise' || q.last === 'allin' ? `${who} ${won(q.bet)}까지 올렸다` : `${who} ${won(q.bet)} 걸었다`;
  const need = L.toCall >= p.chips ? '콜하면 올인이다' : `콜하려면 ${won(L.toCall)} 더 내야 한다`;
  return `${head}. ${need}` + (!L.canRaise && p.chips > L.toCall ? '. 더 올릴 수는 없다' : '');
}
function raiseView(L) {
  const to = V.raise.to, q = sizes(L), span = Math.max(1, L.maxTo - L.minTo);
  const quick = [['1', `최소 ${won(q[0])}`, q[0]], ['2', `½팟 ${won(q[1])}`, q[1]], ['3', `팟 ${won(q[2])}`, q[2]], ['4', `올인 ${won(q[3])}`, q[3]]];
  return {
    label: L.open ? '벳 금액' : '레이즈 금액', amt: to, min: L.minTo, max: L.maxTo, frac: (to - L.minTo) / span,
    /* 같은 금액이 겹치면(최소 = ½팟 등) 앞의 것만 고른 표시, 뒤의 것은 흐리게 */
    quick: quick.map(([k, n, a], i) => { const dup = q.indexOf(a) !== i; return [k, n, 'q' + (i + 1), a === to && !dup, dup ? 'dup' : '', a]; }),
    hint: isTouch ? '' : `휠이나 ↑↓ 로 ${POKER.bb}씩 조절한다`,
    keys: [['Backspace', '취소', 'raiseX'], ['R', to >= L.maxTo ? `올인 ${won(to)}` : `${won(to)} ${L.open ? '벳' : '레이즈'}`, 'raiseGo', false, 'ok']],
  };
}
function body(me) {
  const self = netSelf(), pub = V.pub, live = !!pub && pub.street !== 'done', t = V.tbl[me] && V.tbl[me].id === self ? V.tbl[me] : null;
  if (!t) {
    if (!V.lostT) V.lostT = clock;
    else if (clock - V.lostT > 3) { V.lostT = 0; toast('다른 사람이 먼저 앉았다'); pokerHooks.stand(); }
    return { title: '홀덤 테이블', msg: '자리를 맞추는 중' };
  }
  V.lostT = 0;
  const k = mineAt(), p = live && k >= 0 ? pub.seats[k] : null;
  if (p) {
    const hole = V.hole && V.hole.h === pub.hand ? V.hole.c : null, seen = !!hole && V.seen === pub.hand, L = legal(pub, k);
    const left = Math.ceil(Math.max(0, V.dl - performance.now()) / 1000);
    const v = { cards: seen ? hole : [null, null], hand: seen ? handLabel(hole, pub.board) : hole ? PEEK_HINT : '카드를 받는 중', hint: !seen,
      peek: !!hole && p.st !== 'fold', stats: [['내 칩', p.chips], ['팟', potNow(pub)]] };
    if (L) {
      v.timer = { who: '내 차례', left, mine: true };
      if (V.raise) v.raise = raiseView(L);
      else {
        v.msg = turnMsg(pub, k, L, p);
        v.keys = [['F', '폴드', 'fold'], ['C', L.canCheck ? '체크' : L.toCall >= p.chips ? '콜 올인' : `콜 ${won(L.toCall)}`, 'call']];
        if (L.canRaise) v.keys.push(['R', L.open ? '벳' : '레이즈', 'raise']);
      }
    } else {
      if (pub.turn >= 0) v.timer = { who: `${seatName(pub.turn)}의 차례`, left, mine: false };
      v.msg = p.st === 'fold' ? '이번 판은 폴드했다' : p.st === 'allin' ? '올인했다. 판이 끝나기를 기다리자'
        : pub.turn >= 0 ? `${STREET_NAME[pub.street]}. ${josa(seatName(pub.turn), '이', '가')} 정하는 중` : '';
    }
    return v;
  }
  const stats = [['내 칩', t.c]];
  if (t.b) return { title: '칩을 다시 모으자', earn: { now: t.c, goal: E.back }, msg: `일어나서 장작을 패자. 하나에 ${E.chop}칩, 한 번에 쪼개면 ${E.great}칩` };
  if (t.r) return { title: '쉬는 중', stats, msg: '두 판 연속 시간이 지나 쉬는 중이다', keys: [['C', '다시 끼기', 'call']] };
  if (live) return { title: '홀덤 테이블', stats, msg: '다음 판부터 낀다' };
  if (V.ph === 'count') return { title: `${josa(V.by, '이', '가')} ${V.nx ? '다음 판을' : '판을'} 시작한다. ${V.cnt}`, stats, msg: '일어나면 이번 판에서 빠진다' };
  const ready = V.tbl.filter(o => o && o.c > 0 && !o.r && !o.b).length, seated = V.tbl.filter(Boolean).length;
  /* 결과: 카드를 다 펼친 뒤에 보여 준다 (그 전에는 "카드를 펼치는 중") */
  const presented = !!V.res && !!pub && V.resHand === pub.hand;
  const v = { title: V.ph === 'result' && V.res ? (presented ? resultText() : '카드를 펼치는 중') : '홀덤 테이블', stats };
  if (ready >= 2) v.keys = [['C', V.ph === 'result' ? '다시하기' : '판 시작하기', 'call']];
  else v.msg = seated < 2 ? '한 명 더 앉으면 시작할 수 있다' : '칩이 있는 사람이 한 명 더 있어야 한다';
  return v;
}
function view() {
  const me = mySeat(); if (me < 0) return null;
  const v = body(me);
  /* 윗줄 버튼: 폰은 족보·일어나기, PC 는 H 족보 (일어나기는 화면 가운데 E 안내) */
  v.hd = isTouch ? [['', '족보', 'ranks'], ['', pokerUpLabel() || '일어나기', 'stand']] : [['H', '족보', 'ranks']];
  return v;
}
/* 다시 그릴지 정하는 열쇠: 남은 초(left)는 빼고 비교한다 — 초만 바뀌면 숫자와 막대만 고친다 */
const keyOf = v => v ? JSON.stringify(v, (k, x) => k === 'left' ? undefined : x) : '';

/* ── 포커 상자: 그리기 (render) ── */
/* 작은 카드: 빨간 무늬는 빨갛게, 6·9 는 밑줄. 무늬 뒤의 \uFE0E 는 기기가 이모지로 바꾸지 않게 하는 표시 */
const SUITS = ['♠', '♥', '♦', '♣'];
function miniCard(c) {
  if (c === null || c === undefined) return '<span class="pc back"></span>';
  const r = c % 13, s = Math.floor(c / 13), rank = r === 5 || r === 8 ? `<u>${RANK_CHAR[r]}</u>` : RANK_CHAR[r];
  return `<span class="pc${s === 1 || s === 2 ? ' red' : ''}">${rank}<span>${SUITS[s]}\uFE0E</span></span>`;
}
const keyHtml = ([k, n, act, sel, cls, to]) => `<span class="key${sel ? ' sel' : ''}${cls ? ' ' + cls : ''}" data-act="${act}"${to !== undefined ? ` data-to="${to}"` : ''}>${k ? `<kbd>${k}</kbd>` : ''}${esc(n)}</span>`;
const keysHtml = (ks, cls) => `<div class="keys${cls ? ' ' + cls : ''}">${ks.map(keyHtml).join('')}</div>`;
const pct = f => Math.round(clamp(f, 0, 1) * 100);
const barCls = T => T.mine ? (T.left <= LOW ? ' low' : '') : ' other';
function render(v) {
  /* 홀덤 자리에 앉아 있는 동안 body.poker — 아래 조작키 안내를 숨긴다 (style.css) */
  document.body.classList.toggle('poker', !!v);
  const el = document.getElementById('pokerbox'); if (!el) return;
  if (!v) { el.classList.remove('on'); el.innerHTML = ''; return; }
  wire(el);
  let h = '<div class="top">';
  if (v.cards) h += `<div class="who"${v.peek ? ' data-act="peek"' : ''}>${v.cards.map(miniCard).join('')}<span class="hand${v.hint ? ' hint' : ''}">${esc(v.hand)}</span></div>`;
  else h += `<div class="who"><span class="title">${esc(v.title || '')}</span></div>`;
  h += `<div class="hd">${v.hd.map(keyHtml).join('')}</div></div>`;
  if (v.cards && v.title) h += `<div class="title">${esc(v.title)}</div>`;
  if (v.stats) h += `<div class="stats">${v.stats.map(([n, a]) => `<span>${n}<b>${won(a)}</b></span>`).join('')}</div>`;
  if (v.earn) h += `<div class="stats"><span>지금<b>${won(v.earn.now)}</b>칩</span><span>${won(v.earn.goal)}칩부터 낀다</span></div><div class="bar earn"><i style="width:${pct(v.earn.now / v.earn.goal)}%"></i></div>`;
  if (v.timer) {
    const T = v.timer;
    h += `<div class="tm"><span class="${T.mine ? 'me' : ''}">${esc(T.who)}</span><span class="left">${T.left}초</span></div><div class="bar tbar${barCls(T)}"><i style="width:${pct(T.left / (TURN / 1000))}%"></i></div>`;
  }
  if (v.raise) {
    const R = v.raise, f = pct(R.frac);
    h += `<div class="amt"><span>${R.label}</span><b>${won(R.amt)}</b></div>`;
    /* 막대는 한 줄을 다 쓰고, 최소·올인 금액은 막대 아래 양끝에 */
    h += `<div class="rng col"><div class="trw" data-act="slide"><div class="tr"><i style="width:${f}%"></i><em style="left:${f}%"></em></div></div><div class="ends"><span>${won(R.min)}</span><span>${won(R.max)} 올인</span></div></div>`;
    h += keysHtml(R.quick, 'quick') + (R.hint ? `<div class="msg">${R.hint}</div>` : '') + keysHtml(R.keys, 'pair');
  }
  if (v.msg) h += `<div class="msg">${esc(v.msg)}</div>`;
  if (v.keys) h += keysHtml(v.keys);
  el.innerHTML = h; el.classList.add('on');
}
/* 초만 바뀌었을 때: 남은 초와 막대만 고친다 */
function tickTimer(T) {
  const el = document.getElementById('pokerbox'); if (!el) return;
  const l = el.querySelector('.tm .left'), b = el.querySelector('.tbar');
  if (l) l.textContent = `${T.left}초`;
  if (b) { b.className = 'bar tbar' + barCls(T); b.firstChild.style.width = pct(T.left / (TURN / 1000)) + '%'; }
}
/* 레이즈 막대를 끄는 동안: 상자를 다시 그리지 않고 금액·막대·빠른 금액 표시·확정 글자만 고친다 */
function syncRaise() {
  const el = document.getElementById('pokerbox'), v = view(); if (!el || !v || !v.raise) return;
  const R = v.raise, f = pct(R.frac), b = el.querySelector('.amt b'), i = el.querySelector('.tr i'), m = el.querySelector('.tr em'), g = el.querySelector('.key[data-act=raiseGo]');
  if (b) b.textContent = won(R.amt);
  if (i) i.style.width = f + '%';
  if (m) m.style.left = f + '%';
  el.querySelectorAll('.keys.quick .key').forEach((k, i) => k.classList.toggle('sel', !!R.quick[i][3]));
  if (g && g.lastChild) g.lastChild.textContent = R.keys[1][1];
  V.boxKey = keyOf(v);
}
function slideAt(el, x) {
  const L = myLegal(), tr = el.querySelector('.tr'); if (!L || !V.raise || !tr) return;
  const r = tr.getBoundingClientRect(), f = clamp((x - r.left) / Math.max(1, r.width), 0, 1);
  V.raise.to = clamp(Math.round((L.minTo + f * (L.maxTo - L.minTo)) / UNIT) * UNIT, L.minTo, L.maxTo);
  syncRaise();
}
/* 폰: 상자·족보표 안의 버튼(data-act). 손가락을 뗀 자리가 누른 버튼과 같을 때만 실행한다 (밀다가 다른 버튼에서 떼면 취소).
   들춰 보기(peek)는 누르는 동안, 레이즈 막대(slide)는 끄는 동안 */
function wire(el) {
  if (el._wired) return; el._wired = true;
  let down = null;
  el.addEventListener('pointerdown', e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    e.preventDefault(); down = t.dataset.act;
    if (down === 'peek' || down === 'slide') { try { el.setPointerCapture(e.pointerId); } catch (_) {} }
    if (down === 'peek') setPeek(true);
    else if (down === 'slide') slideAt(el, e.clientX);
  });
  el.addEventListener('pointermove', e => { if (down === 'slide') slideAt(el, e.clientX); });
  const up = e => {
    const a = down; down = null; if (!a) return;
    if (a === 'peek') { setPeek(false); return; }
    if (a === 'slide' || e.type === 'pointercancel') return;
    const t = document.elementFromPoint(e.clientX, e.clientY), b = t && t.closest && t.closest('[data-act]');
    if (b && b.dataset.act === a) { sfx('ui'); doAct(a); }
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

/* ── 족보표 (#pokerRanks) ── */
const RANK_LIST = [
  ['로열 스트레이트 플러시', '같은 무늬 10 J Q K A'], ['스트레이트 플러시', '같은 무늬로 이어진 다섯 장'], ['포카드', '같은 숫자 넷'],
  ['풀하우스', '트리플과 원 페어'], ['플러시', '같은 무늬 다섯 장'], ['스트레이트', '이어진 다섯 장. A 2 3 4 5 도'],
  ['트리플', '같은 숫자 셋'], ['투 페어', '같은 숫자 둘이 두 쌍'], ['원 페어', '같은 숫자 둘'], ['하이카드', '가장 높은 카드로 겨룬다'],
];
/* 지금 내 패 이름 (판에 살아 있고 손패를 본 뒤) */
function myHand() {
  const k = mineAt(), pub = V.pub;
  return k >= 0 && pub && V.hole && V.hole.h === pub.hand && V.seen === pub.hand && pub.seats[k].st !== 'fold' ? handLabel(V.hole.c, pub.board) : '';
}
function renderRanks() {
  const el = document.getElementById('pokerRanks'); if (!el) return;
  if (!V.ranks) { el.classList.remove('on'); el.innerHTML = ''; return; }
  wire(el);
  const mine = myHand();
  el.innerHTML = `<div class="rh"><span>족보 (높은 순)</span>${keyHtml([isTouch ? '' : 'H', '닫기', 'ranks'])}</div>`
    + RANK_LIST.map(([n, d]) => `<div class="rk${n === mine ? ' me' : ''}"><b>${n}${n === mine ? '<em>지금</em>' : ''}</b><span>${d}</span></div>`).join('');
  el.classList.add('on');
}

/* ── 화면 밖 자리 알약 (#pokerPills, H4-3) ──
   홀덤 자리에 앉아 있을 때, 화면 밖(또는 등 뒤)에 앉은 사람을 그 사람 쪽 가장자리에.
   화면 안에 있는 사람은 아바타 이름표에 칩 줄이 있으므로 알약을 띄우지 않는다 */
const _pv = new THREE.Vector3();
function pillEl(el, k) {
  let p = el.querySelector(`[data-k="${k}"]`);
  if (!p) { p = document.createElement('div'); p.dataset.k = k; p.className = 'pill'; el.append(p); }
  return p;
}
function pills(T) {
  const el = document.getElementById('pokerPills'); if (!el) return;
  const me = mySeat(), cam = ctx.camera, show = [false, false, false, false], spots = [];
  if (me >= 0 && cam) for (let k = 0; k < 4; k++) {
    if (k === me || !V.tbl[k]) continue;
    const [cx, cz] = T.P.chairs[k];
    _pv.set(cx, 1.2, cz).applyMatrix4(cam.matrixWorldInverse);
    const sx = _pv.x, behind = _pv.z > -0.2;
    let ny = 0;
    if (!behind) { _pv.applyMatrix4(cam.projectionMatrix); if (Math.abs(_pv.x) < 0.92 && Math.abs(_pv.y) < 0.92) continue; ny = _pv.y; }
    /* 높이는 화면 25~55% 사이 (아래쪽 포커 상자와 겹치지 않게) */
    spots.push({ k, side: sx < 0 ? 'l' : 'r', y: innerHeight * (0.5 - clamp(ny, -0.1, 0.5) * 0.5) });
  }
  /* 같은 쪽에 둘이면 겹치지 않게 46px 이상 띄운다 */
  ['l', 'r'].forEach(sd => { const g = spots.filter(s => s.side === sd).sort((a, b) => a.y - b.y); for (let i = 1; i < g.length; i++) g[i].y = Math.max(g[i].y, g[i - 1].y + 46); });
  spots.forEach(s => {
    show[s.k] = true;
    const p = pillEl(el, s.k), info = seatInfo(s.k), f = V.flash[s.k] && V.flash[s.k].until > clock ? V.flash[s.k] : null;
    const html = (s.side === 'l' ? '<i>‹</i>' : '') + `<b>${esc(info.name)}</b><span>${esc(info.line)}</span>`
      + (info.turn ? '<em>차례</em>' : '') + (f ? `<span class="fl${f.hot ? ' hot' : ''}">${esc(f.text)}</span>` : '') + (s.side === 'r' ? '<i>›</i>' : '');
    if (p._html !== html) { p._html = html; p.innerHTML = html; }
    const cls = `pill ${s.side}${info.turn ? ' turn' : ''}${info.dim ? ' dim' : ''}`;
    if (p.className !== cls) p.className = cls;
    const top = Math.round(s.y) + 'px'; if (p.style.top !== top) p.style.top = top;
    if (p.style.display) p.style.display = '';
  });
  for (const p of el.children) if (!show[+p.dataset.k] && p.style.display !== 'none') p.style.display = 'none';
}

/* ── 기록과 오늘의 테이블 (H5) ── */
/* 판이 끝나 결과를 보여 줄 때: 내가 그 판에 있었으면 판 수·이긴 판·가져간 칩·오늘의 칩 변화를 남긴다 */
function tally() {
  const pub = V.pub, k = mineAt(); if (k < 0 || !V.res || V.my.hand !== pub.hand) return;
  const p = pub.seats[k], got = V.res.pots.reduce((s, q) => s + q.w.filter(w => w[0] === k).reduce((a, w) => a + w[1], 0), 0);
  const d = V.day, R = records.poker;
  d.hands++; R.hands++; d.net += p.chips - V.my.start;
  if (got > 0) { d.wins++; R.wins++; d.best = Math.max(d.best, got); R.best = Math.max(R.best, got); }
  saveSettings();
}
/* 홀덤 자리에서 일어날 때 (이번 캠핑에서 새로 한 판이 있으면): 8초 동안, 폰은 누르면 닫힌다 */
function showDay() {
  const el = document.getElementById('pokerDay'); if (!el) return;
  const d = V.day, R = records.poker, sign = d.net > 0 ? '+' : d.net < 0 ? '−' : '';
  el.innerHTML = `<div class="t">오늘의 테이블</div><div class="big">${sign}${won(Math.abs(d.net))}칩</div>`
    + `<div class="sub">${won(d.hands)}판 / 이긴 판 ${won(d.wins)}${d.best ? ` / 가장 큰 팟 ${won(d.best)}` : ''}</div><hr>`
    + `<div class="sub">지금까지 이긴 판 ${won(R.wins)} / 빈털터리 ${won(R.broke)}번 / 장작으로 번 칩 ${won(R.earned)}</div>`;
  el.classList.add('on'); V.dayUntil = clock + 8;
  if (!el._wired) { el._wired = true; el.addEventListener('pointerdown', e => { e.preventDefault(); hideDay(); }); }
}
function hideDay() { const el = document.getElementById('pokerDay'); if (el) el.classList.remove('on'); V.dayUntil = 0; }

/* ══ 테이블 연출 ══ */
const later = (dt, fn) => D.tasks.push({ at: clock + dt, fn });
/* 테이블 위 소리: 그 자리에서 난다 (가까이 있는 사람에게만 크게) */
const tsfx = (type, x, z, arg) => { const T = ctx.W.poker; if (T) sfxAt(type, T.P.at[0] + x, T.top + 0.05, T.P.at[1] + z, arg); };
const allCards = T => [...T.board, ...T.hole.flat()];
/* 다른 사람 중 지금 카드를 들춰 보는 자리 (스냅샷 pk) */
const remotePeeks = () => { const s = new Set(), self = netSelf(); netPokerSeats().forEach(o => { if (o.pk && o.id !== self) s.add(o.seat); }); return s; };
/* 테이블이 되어야 할 모습: 바닥 카드, 자리마다 손패([카드|null ×2] — null 은 뒷면, 자리에 없으면 null), 내 손패 자리, 칩, 버튼 */
function target() {
  const pub = V.pub, self = netSelf(), live = !!pub && pub.street !== 'done';
  const t = { hand: pub ? pub.hand : -1, live, board: pub ? pub.board : [], btn: pub ? pub.btn : -1, holes: [null, null, null, null], mine: -1,
    stacks: [0, 0, 0, 0], bets: [0, 0, 0, 0], pot: live ? pub.pot : 0, ids: V.tbl.map(o => o ? o.id : '') };
  V.tbl.forEach((o, k) => { if (o) t.stacks[k] = o.c; });
  if (pub) pub.seats.forEach((p, k) => {
    if (!p) return;
    const o = V.tbl[k];
    if (live) { t.stacks[k] = p.chips; t.bets[k] = p.bet; t.ids[k] = p.id; }
    else if (!o || o.id !== p.id) return;   // 끝난 판의 자리에 지금은 다른 사람(또는 아무도) 없다
    if (p.st === 'fold') return;
    if (p.hole) { t.holes[k] = p.hole; return; }
    if (p.id === self && V.hole && V.hole.h === pub.hand) { t.holes[k] = V.hole.c; t.mine = k; return; }
    t.holes[k] = [null, null];
  });
  return t;
}
/* 한 자리의 손패를 움직임 없이 놓는다 */
function snapSeat(T, k, t) {
  const h = t.holes[k], s = D.seat[k], mine = k === t.mine;
  s.on = !!h; s.mine = mine; s.peek = false; s.rpeek = false; s.shown = !!h && h[0] !== null && !mine;
  T.hole[k].forEach((c, j) => {
    c.userData.tint(1);
    if (!h) { c.userData.hide(); return; }
    const [x, z, yaw] = holeXZ(T, k, j);
    c.userData.set(h[j]); c.userData.place(...cardPose(T, x, z, yaw, mine));
  });
}
/* 모든 카드를 움직임 없이 놓는다 (중간에 들어왔을 때 · 거둔 뒤 같은 판으로 돌아왔을 때) */
function snapCards(T, t) {
  const n = t.board.length;
  T.board.forEach((c, i) => {
    c.userData.tint(1);
    if (i >= n) { c.userData.hide(); return; }
    const [x, z, yaw] = boardXZ(i); c.userData.set(t.board[i]); c.userData.place(...cardPose(T, x, z, yaw, false));
  });
  D.board = n;
  for (let k = 0; k < 4; k++) snapSeat(T, k, t);
}
/* 세기가 시작되면: 테이블의 카드를 덱 자리로 거둔다 */
function sweep(T) {
  const [dx, dz, dyaw] = deckXZ(T, D.btn), to = cardPose(T, dx, dz, dyaw, false, 0, 0.016);
  let any = false;
  allCards(T).forEach(c => {
    c.userData.tint(1);
    if (c.visible) { any = true; c.userData.go(...to, 0.36, Math.random() * 0.12, 0.03, () => c.userData.hide()); }
  });
  if (any) tsfx('cardSlide', dx, dz);
  D.board = 0; D.seat.forEach(s => { s.on = false; s.shown = false; s.peek = false; s.rpeek = false; });
}
/* 폴드·자리 비움: 그 자리의 카드를 덱으로 거둔다 */
function collect(T, cs) {
  const [dx, dz, dyaw] = deckXZ(T, D.btn), to = cardPose(T, dx, dz, dyaw, false, 0, 0.016);
  cs.forEach((c, j) => { if (c.visible) c.userData.go(...to, 0.32, j * 0.05, 0.03, () => c.userData.hide()); });
  tsfx('cardSlide', dx, dz);
}
/* 새 판: 덱을 섞고, 버튼 왼쪽부터 한 장씩 두 바퀴 (내 카드는 엎어진 채, 다른 사람 카드는 뒷면) */
function dealCards(T, t) {
  const pub = V.pub, [dx, dz, dyaw] = deckXZ(T, pub.btn), order = [];
  for (let i = 1; i <= 4; i++) { const k = (pub.btn + i) % 4; if (pub.seats[k]) order.push(k); }
  tsfx('shuffle', dx, dz);
  const start = 0.9; let n = 0;
  for (let r = 0; r < 2; r++) order.forEach(k => {
    const c = T.hole[k][r], mine = k === t.mine, h = t.holes[k], d = start + 0.13 * n++, [x, z, yaw] = holeXZ(T, k, r);
    c.userData.set(h ? h[r] : null); c.userData.place(...cardPose(T, dx, dz, dyaw, mine, 0, 0.016), false);
    c.userData.go(...cardPose(T, x, z, yaw, mine), 0.32, d, 0.035);
    later(d, () => tsfx('cardSlide', x, z));
  });
  order.forEach(k => { const s = D.seat[k]; s.on = true; s.mine = k === t.mine; s.shown = false; s.peek = false; s.rpeek = false; });
  D.until = clock + start + 0.13 * n + 0.35;
}
function directCards(T, t) {
  const pub = V.pub;
  if (!pub) {
    if (D.hand !== -1) { allCards(T).forEach(c => { c.userData.hide(); c.userData.tint(1); }); D.hand = -1; D.board = 0; D.seat.forEach(s => { s.on = false; }); }
    return;
  }
  /* 새 판 (또는 처음 보는 판): 세기를 보고 시작된 프리플랍이면 돌리고, 아니면 바로 놓는다 */
  if (t.hand !== D.hand) {
    const fresh = D.sawCount && t.live && pub.street === 'pre' && !pub.board.length;
    allCards(T).forEach(c => { c.userData.hide(); c.userData.tint(1); });
    D.board = 0; D.seat.forEach(s => { s.on = false; s.shown = false; s.peek = false; s.rpeek = false; s.mine = false; });
    D.hand = t.hand; D.sawCount = false; D.until = clock;
    if (fresh) dealCards(T, t); else snapCards(T, t);
    return;
  }
  /* 손패 */
  const rp = remotePeeks();
  for (let k = 0; k < 4; k++) {
    const s = D.seat[k], h = t.holes[k], cs = T.hole[k];
    if (!h) { if (s.on) { s.on = false; collect(T, cs); } continue; }
    if (!s.on) { snapSeat(T, k, t); continue; }
    if (cs.some(c => c.userData.busy())) continue;
    const mine = k === t.mine;
    /* 손패가 카드보다 늦게 도착했다: 내 카드로 바꿔 엎어 둔다 */
    if (mine && !s.mine) {
      s.mine = true;
      cs.forEach((c, j) => { const [x, z, yaw] = holeXZ(T, k, j); c.userData.set(h[j]); c.userData.place(...cardPose(T, x, z, yaw, true)); });
    }
    /* 공개 (쇼다운·올인): 엎어 놓고 뒤집는다 */
    if (!mine && h[0] !== null && !s.shown) {
      s.shown = true; s.peek = false; s.rpeek = false;
      cs.forEach((c, j) => {
        const [x, z, yaw] = holeXZ(T, k, j);
        c.userData.set(h[j]); c.userData.place(...cardPose(T, x, z, yaw, true));
        c.userData.go(...cardPose(T, x, z, yaw, false), 0.28, j * 0.08, 0.03);
      });
      const [x, z] = holeXZ(T, k, 0); tsfx('cardFlip', x, z);
      continue;
    }
    /* 다른 사람이 들춰 보는 중: 엎은 채 가까운 쪽 모서리를 살짝 들고, 아랫면은 흰 종이 (카드 정보는 그 사람에게만 있다) */
    if (!mine && h[0] === null) {
      const on = t.live && rp.has(k);
      if (on !== s.rpeek) {
        s.rpeek = on;
        cs.forEach((c, j) => {
          const [x, z, yaw] = holeXZ(T, k, j);
          if (on) { c.userData.set(-1); c.userData.place(...cardPose(T, x, z, yaw, true)); }
          c.userData.go(...cardPose(T, x, z, yaw, true, on ? -REMOTE_PEEK : 0), 0.2);
        });
      }
    }
    /* 들춰 보기 */
    if (mine) {
      const pk = V.peek && t.live;
      if (pk !== s.peek) {
        s.peek = pk;
        cs.forEach((c, j) => { const [x, z, yaw] = holeXZ(T, k, j); c.userData.go(...cardPose(T, x, z, yaw, !pk, pk ? PEEK_TILT : 0), 0.16); });
      }
    }
  }
  /* 바닥 카드: 덱에서 미끄러져 와(엎은 채) 뒤집힌다. 여러 장면(플랍·턴·리버)이 한꺼번에 나오면 1초씩 띄운다 */
  const nb = t.board.length;
  if (nb > D.board) {
    const [dx, dz, dyaw] = deckXZ(T, pub.btn);
    let start = Math.max(0, D.until - clock), grp = -1;
    for (let i = D.board; i < nb; i++) {
      const g = i < 3 ? 0 : i - 2;
      if (g !== grp) { if (grp >= 0) start += 1.0; grp = g; }
      const c = T.board[i], [x, z, yaw] = boardXZ(i), d = start + (g === 0 ? i * 0.1 : 0);
      c.userData.tint(1); c.userData.set(t.board[i]);
      c.userData.place(...cardPose(T, dx, dz, dyaw, true, 0, 0.016), false);
      c.userData.go(...cardPose(T, x, z, yaw, true), 0.3, d, 0.04);
      later(d, () => tsfx('cardSlide', x, z));
      later(d + 0.32, () => { c.userData.go(...cardPose(T, x, z, yaw, false), 0.22, 0, 0.03); tsfx('cardFlip', x, z); });
      D.until = Math.max(D.until, clock + d + 0.6);
    }
    D.board = nb;
  }
}
/* 결과를 보여 준다 (카드를 다 펼친 뒤): 소식 + 기록 + 이긴 다섯 장만 밝게 들어 올린다 */
function present(T) {
  if (mySeat() >= 0) toast(resultText());
  tally();
  const p0 = V.res.pots[0], best = p0 && p0.b; if (!best) return;
  const win = new Set(best), lift = (c, x, z, yaw) => c.userData.go(...cardPose(T, x, z, yaw, false, 0, 0.012), 0.22);
  T.board.forEach((c, i) => {
    if (!c.visible) return; const w = win.has(c.userData.card); c.userData.tint(w ? 1 : 0.5);
    if (w) { const [x, z, yaw] = boardXZ(i); lift(c, x, z, yaw); }
  });
  T.hole.forEach((pair, k) => pair.forEach((c, j) => {
    if (!c.visible) return; const w = c.userData.card !== null && win.has(c.userData.card); c.userData.tint(w ? 1 : 0.5);
    if (w) { const [x, z, yaw] = holeXZ(T, k, j); lift(c, x, z, yaw); }
  }));
}

/* ── 칩: 지난 목표(goal)에서 새 목표로 갈 때 칩이 어디서 어디로 가는지 정한다 ──
   같은 자리: 앞 칩 → 베팅 줄 (걸기·블라인드) / 베팅 줄 → 앞 칩 (돌려받기)
   남은 베팅 줄·앞 칩의 감소 → 팟 / 팟 → 앞 칩이 늘어난 자리 (판 끝, 카드를 다 펼친 뒤)
   자리 주인이 바뀌었거나, 앉거나, 장작으로 번 칩처럼 출처가 없는 차이는 바로 맞춘다 */
const xzOf = (T, e) => e[0] === 'p' ? LAY.pot : e[0] === 's' ? stackXZ(T, e[1]) : betXZ(T, e[1]);
function addTo(e, a) {
  if (e[0] === 'p') D.disp.pot += a; else if (e[0] === 's') D.disp.stacks[e[1]] += a; else D.disp.bets[e[1]] += a;
  D.chipDirty = true;
}
/* g = 이 비행을 잡을 때의 계획 번호. 그 사이 계획이 바뀌었으면(flush) 출발하지도, 도착해서 더하지도 않는다 */
function launch(T, f, g) {
  if (g !== D.cgen) return;
  addTo(f.f, -f.a);
  const from = xzOf(T, f.f), to = xzOf(T, f.to);
  if (f.f[0] === 's' && f.to[0] === 'b') tsfx('chipPush', to[0], to[1]);
  T.flights.fly(from, to, f.a, f.ph === 2 ? 0.5 : 0.38, () => {
    if (g !== D.cgen) return;
    addTo(f.to, f.a); D.pend--; tsfx('chip', to[0], to[1], f.a >= 100 ? 3 : 2);
  });
}
/* 아직 출발을 기다리거나 날아가는 칩이 있는데 새 상태가 왔다: 날아가는 칩을 거두고, 지난 목표에 다 도착한 것으로 맞춘 뒤 새로 계획한다.
   (그대로 두면 새 비행이 아직 도착하지 않은 칩을 빼 가서, 칩이 중간에 사라졌다가 나중에 덮어씌워진다) */
function flush(T) {
  D.cgen++; D.pend = 0; T.flights.clear();
  const G = D.goal; D.disp = { stacks: G.stacks.slice(), bets: G.bets.slice(), pot: G.pot }; D.chipDirty = true;
}
/* 단계: 0 = 앞 칩 ↔ 베팅 줄 (바로, 0.06초 간격) · 1 = 베팅 줄 → 팟 (0단계가 다 내려앉은 뒤) · 2 = 팟 → 앞 칩 (1단계가 끝나고 카드를 다 펼친 뒤).
   라운드를 닫는 콜·올인도 먼저 베팅 줄로 밀었다가 다른 베팅과 함께 팟으로 간다 */
function plan(T, G, N) {
  if (D.pend > 0) flush(T);
  const same = k => !!G.ids[k] && G.ids[k] === N.ids[k], ds = [0, 0, 0, 0], db = [0, 0, 0, 0], fl = [];
  for (let k = 0; k < 4; k++) {
    if (same(k)) { ds[k] = N.stacks[k] - G.stacks[k]; db[k] = N.bets[k] - G.bets[k]; }
    else { D.disp.stacks[k] += N.stacks[k] - G.stacks[k]; D.disp.bets[k] += N.bets[k] - G.bets[k]; }
  }
  const move = (f, to, a, ph) => { if (a > 0) fl.push({ f, to, a, ph }); };
  for (let k = 0; k < 4; k++) if (ds[k] < 0 && db[k] > 0) { const a = Math.min(-ds[k], db[k]); move(['s', k], ['b', k], a, 0); ds[k] += a; db[k] -= a; }
  for (let k = 0; k < 4; k++) if (db[k] < 0 && ds[k] > 0) { const a = Math.min(-db[k], ds[k]); move(['b', k], ['s', k], a, 0); db[k] += a; ds[k] -= a; }
  /* 남은 앞 칩 감소 = 라운드를 닫으며 낸 칩: 베팅 줄로 먼저 민다 (그만큼 베팅 줄에서 팟으로 갈 몫이 늘어난다) */
  for (let k = 0; k < 4; k++) if (ds[k] < 0) { const a = -ds[k]; move(['s', k], ['b', k], a, 0); db[k] -= a; ds[k] = 0; }
  let potIn = 0;
  for (let k = 0; k < 4; k++) if (db[k] < 0) { move(['b', k], ['p'], -db[k], 1); potIn -= db[k]; db[k] = 0; }
  let avail = Math.max(0, G.pot + potIn - N.pot);
  for (let k = 0; k < 4; k++) if (ds[k] > 0 && avail > 0) { const a = Math.min(ds[k], avail); move(['p'], ['s', k], a, 2); ds[k] -= a; avail -= a; }
  for (let k = 0; k < 4; k++) { D.disp.stacks[k] += ds[k]; D.disp.bets[k] += db[k]; }
  /* 단계별 시작 시각: 앞 단계의 마지막 칩이 내려앉은 뒤 */
  const FLY = 0.38, GAP = 0.06, n = [0, 0, 0];
  fl.forEach(f => n[f.ph]++);
  const end = (t, c) => c ? t + GAP * (c - 1) + FLY + 0.05 : t;
  const t1 = end(0, n[0]), t2 = Math.max(end(t1, n[1]), D.until - clock + 0.5);
  const at = [0, t1, t2], i = [0, 0, 0], g = D.cgen;
  fl.forEach(f => { const t = at[f.ph] + GAP * i[f.ph]++; D.pend++; later(t, () => launch(T, f, g)); });
  D.chipDirty = true;
}
function directChips(T, t) {
  const key = JSON.stringify([t.stacks, t.bets, t.pot, t.ids]);
  if (key === D.chipKey) return;
  D.chipKey = key;
  const N = { stacks: t.stacks.slice(), bets: t.bets.slice(), pot: t.pot, ids: t.ids.slice() };
  if (!D.goal) { D.goal = N; D.disp = { stacks: N.stacks.slice(), bets: N.bets.slice(), pot: N.pot }; D.chipDirty = true; return; }
  plan(T, D.goal, N); D.goal = N;
}
/* 날아가는 칩이 다 도착했는데 보이는 칩이 목표와 다르면 (중간에 꼬였을 때) 목표대로 맞춘다 */
function settle() {
  const G = D.goal, d = D.disp; if (!G || !d || D.pend > 0) return;
  let same = d.pot === G.pot; for (let k = 0; k < 4 && same; k++) same = d.stacks[k] === G.stacks[k] && d.bets[k] === G.bets[k];
  if (!same) { D.disp = { stacks: G.stacks.slice(), bets: G.bets.slice(), pot: G.pot }; D.chipDirty = true; }
}
function direct(T) {
  const t = target(), pub = V.pub;
  if (V.ph === 'count') {
    D.sawCount = true;
    if (!D.swept && D.hand !== -1) { D.swept = true; D.sweptHand = D.hand; sweep(T); }
  } else {
    /* 세기가 취소되어 같은 판(결과)으로 돌아왔다: 그 모습 그대로 다시 놓는다 */
    if (D.swept) { D.swept = false; if (pub && t.hand === D.sweptHand) snapCards(T, t); }
    directCards(T, t);
  }
  directChips(T, t);
  /* 덱: 판이 열린 동안·세는 동안 버튼 자리 앞에 */
  const deck = !!pub && (t.live || V.ph === 'count');
  T.deck.visible = deck;
  if (deck) { const [x, z, yaw] = deckXZ(T, pub.btn); T.deck.position.set(x, T.top, z); T.deck.rotation.y = yaw; }
  /* 딜러 버튼: 판마다 왼쪽 사람에게 미끄러져 간다 */
  if (t.btn !== D.btn) { const first = D.btn < 0; D.btn = t.btn; setButton(T, t.btn, first ? 0 : 0.5); }
}
/* 소리: 내 차례 마지막 5초 똑딱 · 다른 사람 차례에 가끔 칩을 만지작거리는 소리 (그 사람 자리에서) */
function sounds(T, dt) {
  const pub = V.pub, live = !!pub && pub.street !== 'done', L = myLegal();
  if (L) {
    const left = Math.ceil(Math.max(0, V.dl - performance.now()) / 1000);
    if (left <= 5 && left > 0 && left !== D.tick) { D.tick = left; sfx('pokerTick'); }
  } else D.tick = -1;
  if (live && pub.turn >= 0 && pub.turn !== mineAt()) {
    D.riffle -= dt;
    if (D.riffle <= 0) { D.riffle = rnd(5, 11); const [x, z] = stackXZ(T, pub.turn); tsfx('chipRiffle', x, z); }
  } else D.riffle = rnd(2, 5);
}

/* ── 매 프레임 (net.js updateNet — 멀티에서만) ── */
export function pokerUpdate(dt) {
  if (!ctx.running || !ctx.W.poker) return;
  const T = ctx.W.poker;
  clock += dt;
  if (netIsHost()) hostTick(dt);
  if (V.raise) { const L = myLegal(); if (!L || !L.canRaise) V.raise = null; else V.raise.to = clamp(V.raise.to, L.minTo, L.maxTo); }
  if (V.peek && mySeat() < 0) V.peek = false;
  if (D.tasks.length) {
    const due = D.tasks.filter(q => clock >= q.at);
    if (due.length) { D.tasks = D.tasks.filter(q => clock < q.at); due.forEach(q => q.fn()); }
  }
  direct(T);
  updateTable(T, dt);
  settle();
  if (D.chipDirty && D.disp) { D.chipDirty = false; renderChips(T, D.disp, D.goal && D.goal.ids); }
  sounds(T, dt);
  pills(T);
  /* 결과: 카드를 다 펼친 뒤에 소식과 강조 */
  if (V.res && V.pub && V.pub.hand !== V.resHand && clock >= D.until) { V.resHand = V.pub.hand; present(T); }
  /* 오늘의 테이블: 홀덤 자리에서 일어날 때 (새로 한 판이 있으면) */
  const ms = mySeat();
  if (V.seatPrev >= 0 && ms < 0 && V.day.hands > V.day.shown) { V.day.shown = V.day.hands; showDay(); }
  V.seatPrev = ms;
  if (V.dayUntil && clock >= V.dayUntil) hideDay();
  V.hudT += dt;
  if (V.hudT >= 0.25) {
    V.hudT = 0;
    const v = view(), key = keyOf(v);
    if (key !== V.boxKey) { V.boxKey = key; render(v); } else if (v && v.timer) tickTimer(v.timer);
    if (V.ranks && mySeat() < 0) V.ranks = false;
    const rk = V.ranks ? 'on|' + myHand() : '';
    if (rk !== V.ranksKey) { V.ranksKey = rk; renderRanks(); }
    const up = pokerUpLabel() || '';
    if (up !== V.upKey) { V.upKey = up; pokerHooks.hud(); }
  }
}