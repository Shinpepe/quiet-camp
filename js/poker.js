import { ctx, state } from './state.js';
import { POKER } from './data.js';
import { josa, clamp } from './util.js';
import { sfx } from './audio.js';
import { toast } from './gauge.js';
import { startHand, act, autoAct, leave, legal, publicState, handLabel, cardName, UNIT } from './pokerEngine.js';
import { renderTable } from './cards.js';
import { netPoker, netPokerSeats, netIsHost, netSelf, netName } from './net.js';

/* ══ 홀덤 진행 (멀티 캠핑, H3) ══
   방장이 딜러다: 누가 앉았는지 보고(net.js netPokerSeats), 규칙 엔진(pokerEngine.js)으로 판을 돌리고, 칩 장부를 가진다.
   모두에게 공개 상태(st)를 보내고, 손패(hole)는 각자에게만 보낸다. 친구는 행동(act)·시작(go)·손패 다시 받기(sync)를 방장에게 부탁한다.
   방장도 같은 길을 쓴다 — 자기에게 보내는 것은 바로 받는다.
   판의 흐름: wait(대기) → 앉은 사람 누구나 C → count(3초 세기) → play(판) → result(결과가 떠 있음) → 누구나 C 다시하기 → count …
     세는 동안 일어나면 그 판에서 빠진다. 칩이 있는 사람이 둘 아래로 줄면 세기를 멈춘다.
   차례 시간 30초, 자리 비움이면 3초. 시간이 지나면 체크할 수 있으면 체크, 아니면 폴드.
   두 판 연속 시간이 지나면 쉬는 중(다음 판부터 빠진다, C 로 다시 낀다).
   판 도중 일어나거나 연결이 끊기면 폴드 (올인한 사람은 판에 남는다).
   칩 장부: 처음 앉을 때 1,000칩. 일어나도·잠들어도 그대로, 캠핑장을 나가면 사라진다.
   테이블에는 지금 상태를 움직임 없이 놓는다 (cards.js renderTable). 날아가는 연출·소리·모바일 버튼은 H4
   화면 문구: 나란한 항목은 " / ", 문장이 끝나고 이어지면 ". ", 이름 여러 개는 ", " */

const TURN = 30000, AWAY = 3000, COUNT = 3;
export const POKER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="10" height="14" rx="1.6" transform="rotate(-8 8.5 12)"/><rect x="10.5" y="4.5" width="10" height="14" rx="1.6" transform="rotate(8 15.5 11.5)"/></svg>';
/* game.js 가 채운다: 포커 상자 글자가 바뀌면 updateHUD */
export const pokerHooks = { hud: () => {} };
/* 자리 id → 테이블 자리 번호 ('poker' = 0, 'poker2' = 1 …), 홀덤 자리가 아니면 −1 */
export const pokerSeatNo = id => { const m = /^poker(\d?)$/.exec(id || ''); return m ? (m[1] ? +m[1] - 1 : 0) : -1; };
const mySeat = () => state.mode === 'seated' ? pokerSeatNo(state.seat) : -1;
const won = n => (n || 0).toLocaleString('ko-KR');
/* 팟 = 가운데 쌓인 칩 + 이번 라운드에 건 칩 */
const potNow = pub => pub.pot + pub.seats.reduce((s, p) => s + (p ? p.bet : 0), 0);

/* ── 방장: 판과 칩 장부 ── */
const H = {};
function hostReset() {
  Object.assign(H, { ledger: new Map(), gone: new Set(), rest: new Set(), streak: new Map(), timed: new Set(),
    S: null, ph: 'wait', cnt: 0, cntT: 0, by: '', hand: 0, prevBtn: -1, dl: 0, turnKey: '', turnAt: 0, res: null,
    tbl: [null, null, null, null], tblKey: '', beat: 0, dirty: true });
}
/* ── 모두(방장 포함): 받은 상태와 내 화면 ── */
const V = {};
function viewReset() {
  Object.assign(V, { ph: 'wait', cnt: 0, by: '', nx: false, pub: null, tbl: [null, null, null, null], dl: 0, res: null,
    hole: null, raise: null, stN: 0, lock: -1, asked: 0, resHand: 0, wasTurn: false, hudT: 0, hudKey: '', drawKey: '' });
}
hostReset(); viewReset();
/* 캠핑장에 들어갈 때·나갈 때 (game.js) */
export function pokerReset() { hostReset(); viewReset(); }

/* 다음 판에 들어갈 사람: 앉아 있고, 칩이 있고, 쉬는 중이 아닌 사람 */
const eligible = () => H.tbl.filter(o => o && (H.ledger.get(o.id) || 0) > 0 && !H.rest.has(o.id));
/* 지금 차례의 마감 시각 (자리 비움이면 3초) */
const turnDl = () => { const S = H.S, o = S && H.tbl[S.turn]; return o && o.away ? Math.min(H.dl, H.turnAt + AWAY) : H.dl; };

function hostTick(dt) {
  const now = performance.now(), tbl = [null, null, null, null], at = new Map();
  for (const o of netPokerSeats()) {
    if (o.seat < 0 || o.seat > 3 || tbl[o.seat] || at.has(o.id)) continue;
    tbl[o.seat] = o; at.set(o.id, o.seat);
    if (H.gone.has(o.id)) H.gone.delete(o.id);
    if (!H.ledger.has(o.id)) H.ledger.set(o.id, POKER.start);
  }
  H.tbl = tbl;
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
  H.S = S; H.prevBtn = S.btn; H.ph = 'play'; H.res = null; H.timed.clear(); H.turnKey = ''; H.dirty = true;
  S.seats.forEach(p => { if (p) sendHole(p.id); });
  if (S.street === 'done') finish();
}
/* 판이 끝났다: 칩을 장부에 옮기고, 시간 초과가 두 판 이어진 사람은 쉬게 하고, 결과를 남긴다 */
function finish() {
  const S = H.S;
  S.seats.forEach(p => {
    if (!p) return;
    if (!H.gone.has(p.id)) H.ledger.set(p.id, p.chips);
    const n = H.timed.has(p.id) ? (H.streak.get(p.id) || 0) + 1 : 0;
    if (n >= 2) { H.rest.add(p.id); H.streak.set(p.id, 0); } else H.streak.set(p.id, n);
  });
  const r = S.result;
  H.res = { fold: r.fold, pots: r.pots.map(p => ({ a: p.amount, n: p.name, w: p.winners.map(w => [w.seat, w.amount]) })) };
  H.ph = 'result'; H.dirty = true;
}
function sendHole(id) {
  const S = H.S, p = S && S.seats.find(q => q && q.id === id); if (!p) return;
  const m = { op: 'hole', h: S.hand, c: p.hole.slice() };
  if (id === netSelf()) gotHole(m); else netPoker(m, id);
}
function broadcast() {
  H.beat = 0; H.dirty = false;
  const S = H.S, now = performance.now();
  const m = { op: 'st', ph: H.ph, cnt: H.cnt, by: H.by, nx: H.hand > 0, pub: S ? publicState(S) : null, res: H.res,
    dl: H.ph === 'play' && S && S.street !== 'done' ? Math.max(0, Math.round(turnDl() - now)) : 0,
    tbl: H.tbl.map(o => o && { id: o.id, n: o.name, c: H.ledger.get(o.id) || 0, r: H.rest.has(o.id) ? 1 : 0 }) };
  netPoker(m); gotSt(m);
}
/* 방장이 받는 부탁: 행동 · 시작(다시하기) · 손패 다시 보내기 */
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
}
const toHost = d => { if (netIsHost()) hostRecv(d, netSelf()); else netPoker(d, 'host'); };

/* ── net.js 가 부른다 ── */
export function pokerRecv(d, id) {
  if (!d || typeof d.op !== 'string') return;
  if (netIsHost()) hostRecv(d, id);
  else if (d.op === 'st') gotSt(d);
  else if (d.op === 'hole') gotHole(d);
  else if (d.op === 'err' && typeof d.m === 'string') toast(d.m.slice(0, 40));
}
/* 방장: 캠핑장을 떠난 사람의 칩은 사라진다 (판 중이면 hostTick 이 폴드시킨다) */
export function pokerPeerLeft(id) {
  if (!netIsHost()) return;
  H.gone.add(id); H.ledger.delete(id); H.rest.delete(id); H.streak.delete(id); H.dirty = true;
}

/* ── 받은 상태 ── */
const mineAt = () => { const self = netSelf(); return V.pub ? V.pub.seats.findIndex(p => p && p.id === self) : -1; };
function gotSt(m) {
  if (!m || !Array.isArray(m.tbl)) return;
  const now = performance.now();
  V.ph = m.ph; V.cnt = m.cnt | 0; V.by = typeof m.by === 'string' ? m.by : ''; V.nx = !!m.nx;
  V.pub = m.pub || null; V.res = m.res || null; V.dl = now + (m.dl || 0);
  V.tbl = [0, 1, 2, 3].map(k => m.tbl[k] || null); V.stN++;
  if (V.stN === 1 && V.pub) V.resHand = V.pub.hand;
  const k = mineAt(), live = !!V.pub && V.pub.street !== 'done';
  /* 판에 들었는데 손패를 못 받았으면 다시 달라고 한다 (중간에 들어옴·새로고침) */
  if (live && k >= 0 && (!V.hole || V.hole.h !== V.pub.hand) && now - V.asked > 1500 && !netIsHost()) { V.asked = now; netPoker({ op: 'sync' }, 'host'); }
  const turn = live && k >= 0 && V.pub.turn === k;
  if (turn && !V.wasTurn) sfx('ui');
  V.wasTurn = turn; if (!turn) V.raise = null;
  /* 새 결과: 앉아 있는 사람에게 소식 */
  if (V.res && V.pub && V.pub.hand !== V.resHand) { V.resHand = V.pub.hand; if (mySeat() >= 0) toast(resultText()); }
}
function gotHole(d) { if (typeof d.h === 'number' && Array.isArray(d.c) && d.c.length === 2) V.hole = { h: d.h, c: d.c }; }

function seatName(k) {
  const p = V.pub && V.pub.seats[k], t = V.tbl[k];
  if (p && t && t.id === p.id) return t.n;
  return p ? netName(p.id) : t ? t.n : '캠퍼';
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
function refresh() { V.hudKey = ''; pokerHooks.hud(); }
const KEYS = ['KeyF', 'KeyC', 'KeyR', 'Backspace', 'ArrowUp', 'ArrowDown', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];
/* PC 키 (game.js keydown): F 폴드 · C 체크·콜 (판 밖에서는 시작·다시하기·다시 끼기) · R 레이즈 패널 */
export function pokerKey(code) {
  if (mySeat() < 0 || !ctx.running || ctx.paused || !KEYS.includes(code)) return false;
  const L = myLegal();
  if (L && V.raise) {
    if (code === 'KeyR') sendAct(V.raise.to >= L.maxTo ? 'allin' : 'raise', V.raise.to);
    else if (code === 'Backspace') V.raise = null;
    else if (code === 'ArrowUp' || code === 'ArrowDown') nudge(L, code === 'ArrowUp' ? 1 : -1);
    else if (code.startsWith('Digit')) V.raise.to = sizes(L)[+code[5] - 1];
    else if (code === 'KeyF') sendAct('fold');
    else if (code === 'KeyC') sendAct(L.canCheck ? 'check' : 'call');
  } else if (code === 'KeyC') { if (L) sendAct(L.canCheck ? 'check' : 'call'); else toHost({ op: 'go' }); }
  else if (code === 'KeyF') { if (L) sendAct('fold'); }
  else if (code === 'KeyR') { if (L && L.canRaise) V.raise = { to: L.minTo }; }
  refresh();
  return true;
}
/* 휠: 레이즈 패널이 열려 있으면 금액 (빅블라인드 단위) */
export function pokerWheel(dy) { const L = myLegal(); if (!L || !V.raise || !dy) return false; nudge(L, dy < 0 ? 1 : -1); refresh(); return true; }
/* 오른쪽 클릭: 레이즈 패널 닫기 */
export function pokerCancel() { if (!V.raise) return false; V.raise = null; refresh(); return true; }
/* 일어나기 안내: 판에 살아 있으면 폴드한다고 알려 준다 (올인이면 판에 남으므로 그냥 일어나기) */
export function pokerUpLabel() {
  const k = mineAt(); return k >= 0 && V.pub && V.pub.street !== 'done' && V.pub.seats[k].st === 'in' ? '폴드하고 일어나기' : null;
}

/* ── 포커 상자 (아이템 상자 자리): 첫 줄 nm, 그 아래 작은 줄 sub, 조작 안내 hn. 홀덤 자리에 앉아 있지 않으면 null ── */
export function pokerBox() {
  const me = mySeat(); if (me < 0) return null;
  const self = netSelf(), pub = V.pub, live = !!pub && pub.street !== 'done', t = V.tbl[me] && V.tbl[me].id === self ? V.tbl[me] : null;
  if (!t) return { nm: '홀덤 테이블', sub: '', hn: '자리를 맞추는 중' };
  const k = mineAt(), p = live && k >= 0 ? pub.seats[k] : null;
  if (p) {
    const hole = V.hole && V.hole.h === pub.hand ? V.hole.c : null, L = legal(pub, k);
    const left = Math.ceil(Math.max(0, V.dl - performance.now()) / 1000);
    const nm = hole ? `${cardName(hole[0])} ${cardName(hole[1])} / ${handLabel(hole, pub.board)}` : '카드를 받는 중';
    let sub = `칩 ${won(p.chips)} / 팟 ${won(potNow(pub))}`, hn;
    if (p.st === 'fold') hn = '이번 판은 폴드했다';
    else if (p.st === 'allin') hn = '올인했다. 판이 끝나기를 기다리자';
    else if (L) {
      sub += ` / ${left}초`;
      if (V.raise) { const to = V.raise.to; hn = `${L.open ? '벳' : '레이즈'} ${won(to)}${to >= L.maxTo ? ' 올인' : ''} / 휠, ↑↓ 금액 / 1 최소 2 ½팟 3 팟 4 올인 / R 확정 / Backspace 취소`; }
      else hn = ['F 폴드', L.canCheck ? 'C 체크' : `C 콜 ${won(L.toCall)}${L.toCall >= p.chips ? ' 올인' : ''}`, L.canRaise ? (L.open ? 'R 벳' : 'R 레이즈') : ''].filter(Boolean).join(' / ');
    } else hn = pub.turn >= 0 ? `${seatName(pub.turn)}의 차례. ${left}초` : '';
    return { nm, sub, hn };
  }
  const chips = t.c;
  if (live) return { nm: '홀덤 테이블', sub: `칩 ${won(chips)}`, hn: t.r ? '쉬는 중. C 다음 판부터 끼기' : chips > 0 ? '다음 판부터 낀다' : '칩이 다 떨어졌다' };
  if (V.ph === 'count') return { nm: `${josa(V.by, '이', '가')} ${V.nx ? '다음 판을' : '판을'} 시작한다. ${V.cnt}`, sub: `칩 ${won(chips)}`, hn: t.r ? '쉬는 중. C 다시 끼기' : chips > 0 ? '일어나면 이번 판에서 빠진다' : '칩이 다 떨어졌다' };
  const ready = V.tbl.filter(o => o && o.c > 0 && !o.r).length, seated = V.tbl.filter(Boolean).length;
  let hn;
  if (t.r) hn = 'C 다시 끼기';
  else if (chips <= 0) hn = '칩이 다 떨어졌다';
  else if (ready >= 2) hn = V.ph === 'result' ? 'C 다시하기' : 'C 판 시작하기';
  else hn = seated < 2 ? '한 명 더 앉으면 시작할 수 있다' : '칩이 있는 사람이 한 명 더 있어야 한다';
  return { nm: V.ph === 'result' && V.res ? resultText() : '홀덤 테이블', sub: `칩 ${won(chips)}`, hn };
}

/* ── 테이블에 지금 상태를 놓는다: 바뀐 것이 있을 때만 (칩 더미의 작은 흔들림이 매번 바뀌지 않게) ── */
function draw() {
  const pub = V.pub, self = netSelf(), live = !!pub && pub.street !== 'done';
  const d = { board: [], holes: [null, null, null, null], stacks: [0, 0, 0, 0], bets: [0, 0, 0, 0], pot: 0, btn: -1 };
  V.tbl.forEach((t, k) => { if (t) d.stacks[k] = t.c; });
  if (pub) {
    d.board = pub.board.slice(); d.btn = pub.btn; d.pot = live ? pub.pot : 0;
    pub.seats.forEach((p, k) => {
      if (!p) return;
      const t = V.tbl[k];
      if (live) { d.stacks[k] = p.chips; d.bets[k] = p.bet; }
      else if (!t || t.id !== p.id) return;   // 끝난 판의 자리에 지금은 다른 사람(또는 아무도) 없다
      d.holes[k] = p.st === 'fold' ? null : p.hole ? p.hole : p.id === self && V.hole && V.hole.h === pub.hand ? V.hole.c : [null, null];
    });
  }
  const key = JSON.stringify(d); if (key === V.drawKey) return;
  V.drawKey = key; renderTable(ctx.W.poker, d);
}

/* ── 매 프레임 (net.js updateNet — 멀티에서만) ── */
export function pokerUpdate(dt) {
  if (!ctx.running || !ctx.W.poker) return;
  if (netIsHost()) hostTick(dt);
  if (V.raise) { const L = myLegal(); if (!L || !L.canRaise) V.raise = null; else V.raise.to = clamp(V.raise.to, L.minTo, L.maxTo); }
  draw();
  V.hudT += dt;
  if (V.hudT >= 0.25) {
    V.hudT = 0;
    const b = pokerBox(), key = b ? b.nm + '|' + b.sub + '|' + b.hn : '';
    if (key !== V.hudKey) { V.hudKey = key; pokerHooks.hud(); }
  }
}