/* ══ 홀덤 규칙 엔진 (노리밋 텍사스 홀덤) ══
   화면·소리·네트워크와 떨어진 규칙만 담는다 (three·DOM 없음).
   방장이 이 엔진으로 판을 돌리고(H3), 친구는 받은 공개 상태(publicState)에 같은 함수(legal·bestHand)를 써서 버튼과 족보 이름을 그린다.
   카드 번호: 0..51 = 숫자 + 13 × 무늬 (숫자 0 = A … 12 = K, 무늬 0 ♠ · 1 ♥ · 2 ♦ · 3 ♣) — cards.js 와 같다.
   자리 번호: 테이블 의자 0..3. 위에서 보아 시계 방향 = 앉은 사람의 왼쪽 = 판이 도는 방향.
   금액은 모두 칩 단위(UNIT = 5)의 배수.

   실제 홀덤과 같게:
   · 딜러 버튼은 판마다 왼쪽 사람에게. 블라인드는 버튼 왼쪽부터 스몰·빅.
     2명(헤즈업)이면 버튼이 스몰 블라인드이고, 프리플랍에서는 먼저, 그 뒤로는 나중에 행동한다
   · 카드는 버튼 왼쪽부터 한 장씩 두 바퀴. 플랍·턴·리버 앞에 한 장씩 버린다 (번 카드)
   · 빅블라인드가 칩이 모자라 다 못 내도 콜 금액은 빅블라인드 전부.
     프리플랍에서 다들 콜만 하면 빅블라인드가 마지막에 체크·레이즈할 기회를 받는다
   · 최소 레이즈 = 이번 라운드에서 가장 컸던 벳·레이즈 크기 (처음엔 빅블라인드)
   · 정식 레이즈에 못 미치는 올인은 베팅을 다시 열지 않는다: 이미 행동한 사람은 콜·폴드만, 아직 행동하지 않은 사람은 레이즈할 수 있다.
     짧은 올인이 겹쳐 합이 정식 레이즈 크기를 넘으면 그때 다시 열린다
   · 아무도 받지 않은 베팅은 라운드가 끝날 때 돌려준다. 사이드 팟은 각자 넣은 칩으로 나눈다
   · 더 베팅할 사람이 없으면(올인) 남은 사람의 패를 먼저 공개하고 남은 카드를 펼친다 (runout)
   · 쇼다운에서는 남은 사람의 패를 모두 공개한다 (홈게임 방식).
     같은 패면 나누고, 나눠지지 않는 칩은 5칩씩 버튼 왼쪽에 가까운 사람부터
   · 한 명 빼고 모두 폴드하면 패를 공개하지 않고 바로 가져간다
   쓰는 법: S = startHand({...}) → 차례(S.turn)마다 legal(S, 자리)를 보고 act(S, 자리, 행동) → S.street === 'done' 이면 끝.
   일어난 일은 S.log 에 순서대로 쌓인다 (H3 이 모두에게 보내고, H4 연출이 이것을 재생한다).
   콘솔에서 pokerTest() 로 규칙을 시험한다 */

export const UNIT = 5;
export const STREET_NAME = { pre: '프리플랍', flop: '플랍', turn: '턴', river: '리버' };
export const HAND_NAME = ['하이카드', '원 페어', '투 페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
export const RANK_CHAR = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_CHAR = ['♠', '♥', '♦', '♣'];
export const cardName = c => RANK_CHAR[c % 13] + SUIT_CHAR[Math.floor(c / 13)];
/* 족보 계산용 숫자: 2..14 (A = 14) */
const val = c => { const r = c % 13; return r === 0 ? 14 : r + 1; };
const suitOf = c => Math.floor(c / 13);

/* ── 덱: 52장을 섞는다. rand 를 주면 그것으로 (시험용), 아니면 crypto 난수 ── */
function cryptoRand() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
export function newDeck(rand) {
  const R = rand || cryptoRand, d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
  return d;
}

/* ══ 족보 ══
   evalCards: 2~5장의 족보. 5장 미만이면 페어·트리플·포카드만 본다 (프리플랍 손패 두 장의 이름용).
   score: 큰 쪽이 이긴다 — 족보 번호 다음에 비교할 숫자 다섯 개를 15진법으로 이어 붙였다 */
function evalCards(cs) {
  const v = cs.map(val).sort((a, b) => b - a), cnt = new Map();
  v.forEach(x => cnt.set(x, (cnt.get(x) || 0) + 1));
  /* 숫자 묶음: 많이 나온 것부터, 같으면 높은 것부터 → 페어·트리플·키커 비교 순서가 된다 */
  const g = [...cnt.keys()].sort((a, b) => cnt.get(b) - cnt.get(a) || b - a), c0 = cnt.get(g[0]), c1 = g.length > 1 ? cnt.get(g[1]) : 0;
  const five = cs.length === 5, flush = five && cs.every(c => suitOf(c) === suitOf(cs[0]));
  /* 스트레이트: 다섯 숫자가 이어지면 가장 높은 숫자, A-2-3-4-5 는 5 가 가장 높다 */
  let sh = 0;
  if (five && g.length === 5) sh = v[0] - v[4] === 4 ? v[0] : v[0] === 14 && v[1] === 5 ? 5 : 0;
  let cat, tb;
  if (sh && flush) { cat = 8; tb = [sh]; }
  else if (c0 === 4) { cat = 7; tb = g; }
  else if (c0 === 3 && c1 >= 2) { cat = 6; tb = g; }
  else if (flush) { cat = 5; tb = v; }
  else if (sh) { cat = 4; tb = [sh]; }
  else if (c0 === 3) { cat = 3; tb = g; }
  else if (c0 === 2 && c1 === 2) { cat = 2; tb = g; }
  else if (c0 === 2) { cat = 1; tb = g; }
  else { cat = 0; tb = v; }
  let score = cat; for (let i = 0; i < 5; i++) score = score * 15 + (tb[i] || 0);
  return { cat, score, high: sh || g[0] };
}
/* 손패 + 바닥 카드(2~7장)에서 가장 좋은 5장: { cat, score, high, cards(그 5장), name } */
export function bestHand(cards) {
  const cs = (cards || []).filter(c => c !== null && c !== undefined);
  if (cs.length < 2) return null;
  let best = null;
  const use = five => { const r = evalCards(five); if (!best || r.score > best.score) best = Object.assign(r, { cards: five }); };
  const n = cs.length;
  if (n <= 5) use(cs.slice());
  else for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++) for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) use([cs[a], cs[b], cs[c], cs[d], cs[e]]);
  best.name = best.cat === 8 && best.high === 14 ? '로열 스트레이트 플러시' : HAND_NAME[best.cat];
  return best;
}
/* 지금 내 족보 이름 (포커 상자·도움말) */
export const handLabel = (hole, board) => { const h = bestHand((hole || []).concat(board || [])); return h ? h.name : ''; };

/* ══ 판 진행 ══
   자리 하나: { id, chips(앞에 남은 칩), bet(이번 라운드에 건 칩), total(이번 판에 넣은 칩), hole, st, acted, actedAt, last }
   st: 'in'(아직 행동할 수 있음) · 'allin' · 'fold'
   acted: 이번 라운드에서 행동했는지 (누가 레이즈하면 다른 사람은 다시 false)
   actedAt: 마지막으로 행동했을 때의 정식 베팅 높이(lastFullTo). 지금 높이와 같으면 그 뒤로 정식 레이즈가 없었다 → 다시 레이즈할 수 없다
   last: 방금 한 행동 ('sb'·'bb'·'fold'·'check'·'call'·'bet'·'raise'·'allin') — 이름표 말풍선용 */
function nextSeat(S, from, pred) {
  for (let i = 1; i <= S.n; i++) { const k = (from + i) % S.n, p = S.seats[k]; if (p && pred(p, k)) return k; }
  return -1;
}
const occupied = () => true;
const contenders = S => S.seats.filter(p => p && p.st !== 'fold');
const liveCount = S => S.seats.filter(p => p && p.st === 'in').length;
function ev(S, type, data) { S.log.push(Object.assign({ type }, data)); }
const draw = S => S.deck[S.di++];
function put(S, p, amt) {
  amt = Math.max(0, Math.min(amt, p.chips));
  p.chips -= amt; p.bet += amt; p.total += amt; if (p.chips === 0) p.st = 'allin';
  return amt;
}
/* 자리 k 가 맞춰야 할 높이. 다른 사람이 모두 올인이면 그들이 건 것보다 더 맞출 필요가 없다 */
function target(S, k) {
  let live = false, mx = 0;
  S.seats.forEach((q, j) => { if (!q || j === k || q.st === 'fold') return; if (q.st === 'in') live = true; mx = Math.max(mx, q.bet); });
  return live ? S.curBet : Math.min(S.curBet, mx);
}
const needsAct = S => (p, k) => p.st === 'in' && (!p.acted || p.bet < target(S, k));
function roundDone(S) {
  const live = []; S.seats.forEach((p, k) => { if (p && p.st === 'in') live.push(k); });
  if (live.length === 0) return true;
  if (live.length === 1) return S.seats[live[0]].bet >= target(S, live[0]);
  return live.every(k => S.seats[k].acted && S.seats[k].bet >= S.curBet);
}
/* 버튼에서 시계 방향으로 몇 번째인지 (버튼 왼쪽 = 1, 버튼 = n). 나눠지지 않는 칩을 받는 순서 */
const fromButton = (S, k) => ((k - S.btn + S.n) % S.n) || S.n;

/* 새 판. o = { players: [{ seat, id, chips }], sb, bb, button?(정한 자리), prevButton?(지난 판 버튼 — 그 왼쪽으로 옮긴다), deck?, hand?, seats?(의자 수 4) }
   칩이 없는 사람은 빠진다. 앉은 사람이 2명 아래면 null */
export function startHand(o) {
  const n = o.seats || 4, seats = Array(n).fill(null);
  (o.players || []).forEach(q => {
    if (q.chips > 0 && q.seat >= 0 && q.seat < n && !seats[q.seat]) seats[q.seat] = { id: q.id, chips: q.chips, bet: 0, total: 0, hole: [], st: 'in', acted: false, actedAt: -1, last: null };
  });
  const count = seats.filter(Boolean).length; if (count < 2) return null;
  const S = { hand: o.hand || 1, n, seats, sb: o.sb, bb: o.bb, btn: -1, sbSeat: -1, bbSeat: -1, street: 'pre', board: [], burned: [], deck: o.deck || newDeck(), di: 0,
    curBet: 0, lastFullTo: 0, minRaise: o.bb, turn: -1, runout: false, shown: [], log: [], result: null };
  S.btn = o.button !== undefined && seats[o.button] ? o.button : nextSeat(S, o.prevButton >= 0 ? o.prevButton : n - 1, occupied);
  if (count === 2) { S.sbSeat = S.btn; S.bbSeat = nextSeat(S, S.btn, occupied); }
  else { S.sbSeat = nextSeat(S, S.btn, occupied); S.bbSeat = nextSeat(S, S.sbSeat, occupied); }
  ev(S, 'button', { seat: S.btn });
  const blind = (k, amt, kind) => { const p = seats[k], a = put(S, p, amt); p.last = kind; ev(S, 'blind', { seat: k, kind, amount: a, allin: p.st === 'allin' }); };
  blind(S.sbSeat, S.sb, 'sb'); blind(S.bbSeat, S.bb, 'bb');
  S.curBet = S.bb; S.lastFullTo = S.bb; S.minRaise = S.bb;
  /* 카드: 버튼 왼쪽부터 한 장씩 두 바퀴 */
  const order = []; for (let k = nextSeat(S, S.btn, occupied), i = 0; i < count; i++, k = nextSeat(S, k, occupied)) order.push(k);
  for (let r = 0; r < 2; r++) order.forEach(k => seats[k].hole.push(draw(S)));
  ev(S, 'deal', { order });
  advance(S, S.bbSeat);
  return S;
}

/* 자리 k 가 지금 할 수 있는 것. 차례가 아니면 null
   toCall: 콜하려면 더 낼 칩 · canCheck · canRaise · minTo·maxTo: 레이즈(벳)할 때 이번 라운드 총 베팅액의 최소·최대(= 올인) · open: 아직 아무도 걸지 않았다(벳) */
export function legal(S, k) {
  const p = S && S.seats[k];
  if (!p || S.street === 'done' || S.turn !== k || p.st !== 'in') return null;
  const tgt = target(S, k), max = p.bet + p.chips, others = S.seats.some((q, j) => q && j !== k && q.st === 'in');
  return {
    toCall: Math.min(Math.max(0, tgt - p.bet), p.chips), canCheck: tgt <= p.bet,
    canRaise: others && max > S.curBet && p.actedAt !== S.lastFullTo,
    minTo: Math.min(S.curBet + S.minRaise, max), maxTo: max, bet: p.bet, curBet: S.curBet, open: S.curBet === 0,
  };
}

/* 행동: a = { k: 'fold' | 'check' | 'call' | 'raise' | 'allin', to: 레이즈(벳)할 때 이번 라운드 총 베팅액 }
   잘 됐으면 null, 안 되면 이유(글자). 레이즈할 수 없는데 올인을 누르면 올인 콜로, 낼 칩이 없는 콜은 체크로 받아 준다 */
export function act(S, k, a) {
  if (!S || S.street === 'done') return '판이 끝났다';
  if (S.turn !== k) return '차례가 아니다';
  const p = S.seats[k], L = legal(S, k); if (!L) return '행동할 수 없다';
  let kind = a && a.k;
  if (kind === 'allin' && !L.canRaise) kind = 'call';
  if (kind === 'call' && L.toCall === 0) kind = 'check';
  if (kind === 'fold') { p.st = 'fold'; p.last = 'fold'; ev(S, 'act', { seat: k, k: 'fold' }); }
  else if (kind === 'check') {
    if (!L.canCheck) return '콜 금액이 남아 있어 체크할 수 없다';
    p.last = 'check'; ev(S, 'act', { seat: k, k: 'check' });
  } else if (kind === 'call') {
    const amt = put(S, p, L.toCall); p.last = p.st === 'allin' ? 'allin' : 'call';
    ev(S, 'act', { seat: k, k: 'call', amount: amt, to: p.bet, allin: p.st === 'allin' });
  } else if (kind === 'raise' || kind === 'allin') {
    if (!L.canRaise) return '지금은 레이즈할 수 없다';
    let to = kind === 'allin' ? L.maxTo : Math.round(+(a && a.to));
    if (!Number.isFinite(to)) return '금액이 잘못됐다';
    to = Math.min(to, L.maxTo);
    if (to <= S.curBet) return '지금 베팅보다 많이 걸어야 한다';
    if (to < L.minTo && to < L.maxTo) return `최소 ${L.minTo}까지 걸어야 한다`;
    if (to < L.maxTo && to % UNIT) return `${UNIT} 단위로 걸어야 한다`;
    const prev = S.curBet, open = prev === 0;
    put(S, p, to - p.bet);
    /* 정식 레이즈(마지막 정식 높이에서 최소 레이즈 이상)면 베팅이 다시 열린다. 최소 레이즈는 가장 컸던 올림 폭 */
    if (to - S.lastFullTo >= S.minRaise) S.lastFullTo = to;
    S.minRaise = Math.max(S.minRaise, to - prev);
    S.curBet = to;
    S.seats.forEach((q, j) => { if (q && j !== k && q.st === 'in') q.acted = false; });
    p.last = p.st === 'allin' ? 'allin' : open ? 'bet' : 'raise';
    ev(S, 'act', { seat: k, k: open ? 'bet' : 'raise', to, allin: p.st === 'allin' });
  } else return '모르는 행동이다';
  p.acted = true; p.actedAt = S.lastFullTo;
  advance(S, k);
  return null;
}
/* 시간이 다 됐을 때: 체크할 수 있으면 체크, 아니면 폴드 */
export function autoAct(S, k) { const L = legal(S, k); if (!L) return '행동할 수 없다'; return act(S, k, { k: L.canCheck ? 'check' : 'fold' }); }

/* 다음 차례를 정하고, 라운드가 끝났으면 칩을 거둬 다음 카드를 펼친다. 더 베팅할 사람이 없으면 리버까지 계속 펼친다 */
function advance(S, from) {
  for (let guard = 0; guard < 10; guard++) {
    if (contenders(S).length <= 1) { winByFold(S); return; }
    if (!roundDone(S)) { S.turn = nextSeat(S, from, needsAct(S)); return; }
    collect(S);
    if (S.street === 'river') { showdown(S); return; }
    if (!S.runout && liveCount(S) <= 1) { S.runout = true; reveal(S); }
    dealNext(S);
    from = S.btn;
  }
}
/* 라운드 끝: 아무도 받지 않은 베팅은 돌려주고, 건 칩을 팟으로 거둔다 */
function collect(S) {
  let top = -1, topBet = 0, second = 0;
  S.seats.forEach((p, k) => { if (!p) return; if (p.bet > topBet) { second = topBet; topBet = p.bet; top = k; } else if (p.bet > second) second = p.bet; });
  if (top >= 0 && topBet > second && S.seats[top].st !== 'fold') {
    const p = S.seats[top], back = topBet - second;
    p.bet -= back; p.total -= back; p.chips += back; if (p.st === 'allin') p.st = 'in';
    ev(S, 'refund', { seat: top, amount: back });
  }
  let sum = 0;
  S.seats.forEach(p => { if (!p) return; sum += p.bet; p.bet = 0; p.acted = false; p.actedAt = -1; if (p.st === 'in') p.last = null; });
  S.curBet = 0; S.lastFullTo = 0; S.minRaise = S.bb;
  if (sum > 0) ev(S, 'collect', { amount: sum, pot: potTotal(S), pots: potsOf(S) });
}
/* 다음 카드: 한 장 버리고 플랍 3장 · 턴 1장 · 리버 1장 */
function dealNext(S) {
  const next = { pre: 'flop', flop: 'turn', turn: 'river' }[S.street];
  S.burned.push(draw(S));
  const cards = []; for (let i = next === 'flop' ? 3 : 1; i > 0; i--) cards.push(draw(S));
  S.board.push(...cards); S.street = next;
  ev(S, 'street', { street: next, cards, runout: S.runout });
}
/* 남은 사람의 손패를 공개한다 (올인 runout·쇼다운) */
function reveal(S) {
  const add = [];
  S.seats.forEach((p, k) => { if (p && p.st !== 'fold' && !S.shown.includes(k)) { S.shown.push(k); add.push({ seat: k, hole: p.hole.slice() }); } });
  if (add.length) ev(S, 'reveal', { hands: add });
}
function winByFold(S) {
  collect(S);
  const k = S.seats.findIndex(p => p && p.st !== 'fold');
  let amount = 0; S.seats.forEach(p => { if (p) amount += p.total; });
  S.seats[k].chips += amount;
  const winners = [{ seat: k, amount }];
  S.result = { fold: true, pots: [{ amount, winners, name: null, best: null }], hands: [] };
  ev(S, 'win', { fold: true, pot: 0, amount, winners });
  end(S);
}
function showdown(S) {
  reveal(S);
  const hands = S.seats.map(p => p && p.st !== 'fold' ? bestHand(p.hole.concat(S.board)) : null);
  const pots = potsOf(S), out = [];
  pots.forEach((pot, i) => {
    let best = -1; pot.seats.forEach(k => { best = Math.max(best, hands[k].score); });
    const win = pot.seats.filter(k => hands[k].score === best).sort((a, b) => fromButton(S, a) - fromButton(S, b));
    const shares = splitPot(pot.amount, win.length), winners = win.map((k, j) => ({ seat: k, amount: shares[j] }));
    winners.forEach(w => { S.seats[w.seat].chips += w.amount; });
    const h = hands[win[0]];
    out.push({ amount: pot.amount, winners, name: h.name, best: h.cards });
    ev(S, 'win', { fold: false, pot: i, amount: pot.amount, winners, name: h.name, best: h.cards });
  });
  S.result = { fold: false, pots: out, hands: hands.map(h => h ? { name: h.name, best: h.cards } : null) };
  end(S);
}
function end(S) { S.street = 'done'; S.turn = -1; ev(S, 'end', { chips: S.seats.map(p => p ? p.chips : null) }); }

/* 팟 나누기: 접지 않은 사람이 넣은 칩 높이마다 한 팟. seats = 그 팟을 가져갈 수 있는 사람 (첫 팟이 메인 팟) */
export function potsOf(S) {
  const live = []; S.seats.forEach((p, k) => { if (p && p.st !== 'fold') live.push(k); });
  const levels = [...new Set(live.map(k => S.seats[k].total).filter(t => t > 0))].sort((a, b) => a - b);
  const pots = []; let prev = 0;
  for (const L of levels) {
    let amt = 0; S.seats.forEach(p => { if (p) amt += Math.min(p.total, L) - Math.min(p.total, prev); });
    const seats = live.filter(k => S.seats[k].total >= L), last = pots[pots.length - 1];
    if (last && last.seats.length === seats.length) last.amount += amt; else if (amt > 0) pots.push({ amount: amt, seats });
    prev = L;
  }
  /* 접은 사람이 남은 사람보다 많이 넣은 칩 (거의 없다) 은 마지막 팟에 더한다 */
  let rest = 0; S.seats.forEach(p => { if (p) rest += Math.max(0, p.total - prev); });
  if (rest && pots.length) pots[pots.length - 1].amount += rest;
  return pots;
}
/* 가운데 쌓인 칩 (이번 라운드 베팅 줄은 빼고) */
export const potTotal = S => S.seats.reduce((s, p) => s + (p ? p.total - p.bet : 0), 0);
/* 금액을 n 명이 나눈다: 5칩 단위로 고르게, 남는 5칩은 앞사람부터 (winners 는 버튼 왼쪽에 가까운 순서) */
export function splitPot(amount, n) {
  const base = Math.floor(amount / (n * UNIT)) * UNIT, out = Array(n).fill(base);
  let rem = amount - base * n, i = 0;
  while (rem > 0) { const u = Math.min(UNIT, rem); out[i % n] += u; rem -= u; i++; }
  return out;
}
/* 모두에게 보낼 공개 상태: 덱·버린 카드·공개되지 않은 손패는 뺀다. legal() 을 이 상태에 그대로 쓸 수 있다 */
export function publicState(S) {
  return {
    hand: S.hand, n: S.n, sb: S.sb, bb: S.bb, btn: S.btn, sbSeat: S.sbSeat, bbSeat: S.bbSeat, street: S.street,
    board: S.board.slice(), burned: S.burned.length, curBet: S.curBet, lastFullTo: S.lastFullTo, minRaise: S.minRaise,
    turn: S.turn, runout: S.runout, shown: S.shown.slice(), pot: potTotal(S),
    seats: S.seats.map((p, k) => p && { id: p.id, chips: p.chips, bet: p.bet, total: p.total, st: p.st, acted: p.acted, actedAt: p.actedAt, last: p.last, hole: S.shown.includes(k) ? p.hole.slice() : null }),
  };
}

/* ══ 시험: 콘솔에서 pokerTest() ══
   족보 비교 · 블라인드와 순서 · 최소 레이즈 · 짧은 올인 · 사이드 팟 · 나눠 갖기 · 무작위 판 수천 개(칩 총합이 그대로인지) */
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function pokerTest(N = 3000) {
  const lines = []; let pass = 0, fail = 0;
  const need = (c, msg) => { if (!c) throw new Error(msg); };
  const T = (name, fn) => {
    try { fn(); pass++; lines.push(['✔', name, '']); }
    catch (e) { fail++; lines.push(['✘', name, e && e.message ? e.message : String(e)]); if (e && !/^[^\n]*$/.test(e.message || '')) console.error(e); }
  };
  /* 카드 글자: 'As Kh Td 2c' (T = 10) */
  const C = s => s.trim().split(/\s+/).map(t => { const r = 'A23456789TJQK'.indexOf(t[0]), su = 'shdc'.indexOf(t[1]); if (r < 0 || su < 0) throw new Error('카드 글자 ' + t); return r + 13 * su; });
  const H = s => bestHand(C(s));
  /* 정해 둔 손패·바닥 카드가 그대로 나오도록 덱을 맞춰 판을 연다 */
  const setup = (seats, btn, holes, board, blinds) => {
    const ord = []; for (let i = 1; i <= 4; i++) { const k = (btn + i) % 4; if (seats.some(s => s[0] === k)) ord.push(k); }
    let deck;
    if (holes) {
      const HC = {}; for (const k in holes) HC[k] = C(holes[k]);
      const B = C(board), used = new Set([...Object.values(HC).flat(), ...B]), spare = [];
      for (let c = 0; c < 52; c++) if (!used.has(c)) spare.push(c);
      deck = [];
      for (const r of [0, 1]) ord.forEach(k => deck.push(HC[k][r]));
      deck.push(spare.shift(), B[0], B[1], B[2], spare.shift(), B[3], spare.shift(), B[4], ...spare);
    } else deck = newDeck(mulberry(7));
    return startHand({ players: seats.map(([seat, chips]) => ({ seat, id: 'p' + seat, chips })), button: btn, deck, sb: blinds ? blinds[0] : 10, bb: blinds ? blinds[1] : 20 });
  };
  const play = (S, steps) => steps.forEach(([k, kind, to]) => { const e = act(S, k, { k: kind, to }); need(e === null, `${k}번 자리 ${kind}${to ? ' ' + to : ''}: ${e}`); });
  const chips = S => JSON.stringify(S.seats.map(p => p ? p.chips : null));

  /* ── 족보 ── */
  T('로열 스트레이트 플러시', () => { const h = H('As Ks Qs Js Ts 2d 3c'); need(h.cat === 8 && h.name === '로열 스트레이트 플러시', h.name); });
  T('A-2-3-4-5 스트레이트는 5 가 가장 높고, 6 하이 스트레이트보다 낮다', () => {
    const w = H('Ah 2d 3c 4s 5h Kd Qc'), s6 = H('2h 3d 4c 5s 6h Kd Qc'); need(w.cat === 4 && w.high === 5, `휠 ${w.name} ${w.high}`); need(s6.score > w.score, '6 하이가 더 커야 한다');
  });
  T('A 하이 스트레이트 > K 하이 스트레이트', () => need(H('Ts Jh Qd Kc Ad').score > H('Ks Qh Jd Tc 9s').score, '순서'));
  T('5-4-3-2-A 스트레이트 플러시는 로열이 아니다', () => { const h = H('5h 4h 3h 2h Ah'); need(h.cat === 8 && h.high === 5 && h.name === '스트레이트 플러시', h.name); });
  T('같은 무늬 6장이면 높은 5장으로 플러시', () => need(H('Ah Kh 9h 7h 4h 2h 3c').score === H('Ah Kh 9h 7h 4h').score, '가장 높은 5장'));
  T('플러시끼리는 다섯째 카드까지 비교', () => need(H('Ah Qh 9h 5h 3h').score > H('Ad Qd 9d 5d 2d').score, '키커'));
  T('페어가 셋이면 높은 두 페어 + 가장 높은 키커', () => need(H('Ah Ad Kc Kd Qs Qh 2c').score === H('Ah Ad Kc Kd Qs').score, '투 페어 키커'));
  T('트리플이 둘이면 풀하우스', () => { const h = H('Ah Ad Ac Kh Kd Kc 2s'); need(h.cat === 6 && h.score === H('Ah Ad Ac Kh Kd').score, h.name); });
  T('같은 원 페어는 키커로 가린다', () => { const b = ' Kh Kd 7s 4c 2h'; need(H('Ac 3d' + b).score > H('Qc Jd' + b).score, 'A 키커'); });
  T('포카드는 다섯째 카드로 가린다', () => { const b = ' Ks Kh Kd Kc 2s'; need(H('Ah 3d' + b).score > H('Qd Qh' + b).score, 'A 키커'); });
  T('바닥 카드가 가장 좋으면 비긴다', () => { const b = ' As Kd Qh Jc Td'; need(H('2c 3c' + b).score === H('4d 5h' + b).score, '같아야 한다'); });
  T('족보 순서: 풀하우스 > 플러시 > 스트레이트 > 트리플 > 투 페어', () => {
    const s = ['Ah Ad Ac Kh Kd', 'Ah 9h 7h 5h 2h', '9c Td Jh Qs Kc', '7c 7d 7h 2s 9c', '7c 7d 2h 2s 9c'].map(x => H(x).score);
    need(s.every((v, i) => i === 0 || s[i - 1] > v), JSON.stringify(s));
  });
  T('손패 두 장: 페어면 원 페어, 아니면 하이카드', () => need(H('Ah Ad').name === '원 페어' && H('Ah Kd').name === '하이카드', '이름'));

  /* ── 진행 ── */
  T('헤즈업: 버튼이 스몰 블라인드·프리플랍 먼저, 플랍부터 빅블라인드 먼저, 번 카드 한 장', () => {
    const S = setup([[0, 1000], [2, 1000]], 0);
    need(S.sbSeat === 0 && S.bbSeat === 2, `블라인드 ${S.sbSeat}/${S.bbSeat}`); need(S.turn === 0, '프리플랍 첫 차례 ' + S.turn);
    play(S, [[0, 'call']]); need(S.turn === 2, '빅블라인드 차례 ' + S.turn);
    play(S, [[2, 'check']]);
    need(S.street === 'flop' && S.board.length === 3 && S.burned.length === 1 && S.turn === 2, `${S.street} 바닥 ${S.board.length} 번 ${S.burned.length} 차례 ${S.turn}`);
  });
  T('3명: 블라인드는 버튼 왼쪽부터, 첫 차례는 빅블라인드 왼쪽, 버튼은 다음 판에 왼쪽으로', () => {
    const S = setup([[0, 1000], [1, 1000], [3, 1000]], 3);
    need(S.sbSeat === 0 && S.bbSeat === 1 && S.turn === 3, `${S.sbSeat}/${S.bbSeat}/${S.turn}`);
    const S2 = startHand({ players: [{ seat: 0, id: 'a', chips: 100 }, { seat: 2, id: 'b', chips: 100 }], prevButton: 0, sb: 10, bb: 20 });
    need(S2.btn === 2, '다음 버튼 ' + S2.btn);
  });
  T('최소 레이즈: 20 → 60 이면 다음은 100 이상', () => {
    const S = setup([[0, 1000], [1, 1000], [2, 1000]], 0);
    play(S, [[0, 'raise', 60]]); need(legal(S, 1).minTo === 100, 'minTo ' + legal(S, 1).minTo);
    need(act(S, 1, { k: 'raise', to: 90 }) !== null, '90 은 막혀야 한다');
    play(S, [[1, 'raise', 100]]); need(legal(S, 2).minTo === 140 && legal(S, 2).toCall === 80, JSON.stringify(legal(S, 2)));
  });
  T('짧은 올인은 이미 행동한 사람에게 레이즈를 다시 열지 않는다', () => {
    const S = setup([[0, 1000], [1, 170], [2, 1000]], 2);
    play(S, [[2, 'call'], [0, 'call'], [1, 'check']]); need(S.street === 'flop' && S.turn === 0, `${S.street} ${S.turn}`);
    play(S, [[0, 'raise', 100], [1, 'allin']]);
    const L2 = legal(S, 2); need(L2.canRaise && L2.minTo === 250, '아직 행동 안 한 사람 ' + JSON.stringify(L2));
    play(S, [[2, 'call']]);
    const L0 = legal(S, 0); need(!L0.canRaise && L0.toCall === 50, '이미 행동한 사람 ' + JSON.stringify(L0));
    play(S, [[0, 'call']]); need(S.street === 'turn' && potTotal(S) === 510, `${S.street} 팟 ${potTotal(S)}`);
  });
  T('프리플랍에서 모두 콜하면 빅블라인드가 체크·레이즈할 기회를 받는다', () => {
    const S = setup([[0, 1000], [1, 1000], [2, 1000]], 0);
    play(S, [[0, 'call'], [1, 'call']]); const L = legal(S, 2); need(S.turn === 2 && L.canCheck && L.canRaise, JSON.stringify(L));
    play(S, [[2, 'raise', 60]]); need(S.turn === 0 && legal(S, 0).canRaise, '레이즈 뒤 다시 열려야 한다');
  });
  T('모두 폴드하면 남은 사람이 가져가고, 받지 않은 베팅은 돌려받는다', () => {
    const S = setup([[0, 1000], [2, 1000]], 0);
    play(S, [[0, 'raise', 100], [2, 'fold']]); need(S.street === 'done' && chips(S) === '[1020,null,980,null]', chips(S));
    const S2 = setup([[0, 1000], [1, 1000], [2, 1000]], 0);
    play(S2, [[0, 'fold'], [1, 'fold']]); need(chips(S2) === '[1000,990,1010,null]', '빅블라인드 ' + chips(S2));
  });
  T('사이드 팟: 짧은 칩이 메인 팟, 그다음이 사이드 팟, 남는 칩은 돌려받는다', () => {
    const S = setup([[0, 100], [1, 300], [2, 500]], 2, { 0: 'As Ah', 1: 'Ks Kh', 2: '7c 2d' }, '9s 8d 4c 3h Jd');
    play(S, [[2, 'allin'], [0, 'allin'], [1, 'allin']]);
    need(S.street === 'done' && chips(S) === '[300,400,200,null]', chips(S));
    need(S.log.some(e => e.type === 'reveal') && S.log.some(e => e.type === 'refund' && e.amount === 200), '공개·돌려받기');
  });
  T('비기면 나누고, 남는 5칩은 버튼 왼쪽에 가까운 사람에게', () => {
    need(JSON.stringify(splitPot(75, 2)) === '[40,35]' && JSON.stringify(splitPot(20, 3)) === '[10,5,5]', 'splitPot');
    const S = setup([[0, 1000], [1, 1000], [2, 1000]], 0, { 0: '2c 3d', 1: '4h 5h', 2: '2d 3c' }, 'As Kd Qh Jc Td', [5, 10]);
    play(S, [[0, 'call'], [1, 'fold'], [2, 'check']]);
    for (let i = 0; i < 3; i++) play(S, [[2, 'check'], [0, 'check']]);
    need(chips(S) === '[1000,995,1005,null]', chips(S));
  });
  T('빅블라인드가 모자라도 콜 금액은 빅블라인드 전부', () => {
    const S = setup([[0, 1000], [1, 1000], [2, 15]], 0);
    need(S.curBet === 20 && legal(S, 0).toCall === 20, JSON.stringify(legal(S, 0)));
    play(S, [[0, 'call'], [1, 'call']]); need(S.street === 'flop' && potTotal(S) === 55 && S.turn === 1, `${S.street} 팟 ${potTotal(S)} 차례 ${S.turn}`);
  });
  T('올인이면 패를 먼저 공개하고 리버까지 펼친다 (번 카드 3장)', () => {
    const S = setup([[0, 500], [2, 500]], 0);
    play(S, [[0, 'allin'], [2, 'call']]);
    need(S.street === 'done' && S.board.length === 5 && S.burned.length === 3 && S.log.some(e => e.type === 'reveal'), `${S.street} ${S.board.length} ${S.burned.length}`);
    need(S.seats[0].chips + S.seats[2].chips === 1000, '칩 총합');
  });
  T('잘못된 행동은 막는다', () => {
    const S = setup([[0, 1000], [1, 1000], [2, 1000]], 0);
    need(act(S, 1, { k: 'call' }) !== null, '차례가 아닌 사람'); need(act(S, 0, { k: 'check' }) !== null, '콜해야 할 때 체크');
    need(act(S, 0, { k: 'raise', to: 33 }) !== null, '최소 레이즈 미만'); need(act(S, 0, { k: 'raise', to: 63 }) !== null, '5칩 단위가 아님');
  });
  T(`무작위 ${N}판: 칩 총합 유지 · 판이 끝남 · 규칙 위반 없음`, () => {
    const r = mulberry(12345);
    for (let h = 0; h < N; h++) {
      const n = 2 + Math.floor(r() * 3), seatsAll = [0, 1, 2, 3].sort(() => r() - 0.5).slice(0, n);
      const players = seatsAll.map(seat => ({ seat, id: 'p' + seat, chips: UNIT * (1 + Math.floor(r() * 400)) }));
      const sum0 = players.reduce((s, p) => s + p.chips, 0);
      const S = startHand({ players, prevButton: Math.floor(r() * 4), deck: newDeck(r), sb: 10, bb: 20, hand: h });
      let steps = 0;
      while (S.street !== 'done') {
        need(++steps < 400, `${h}번째 판이 끝나지 않는다`);
        const k = S.turn, L = legal(S, k); need(L, `${h}번째 판: 차례 ${k} 인데 할 수 있는 행동이 없다`);
        const x = r(); let a;
        if (x < 0.12) a = { k: 'fold' };
        else if (L.canRaise && x < 0.3) a = { k: 'raise', to: L.minTo + UNIT * Math.floor(r() * (Math.floor((L.maxTo - L.minTo) / UNIT) + 1)) };
        else if (L.canRaise && x < 0.36) a = { k: 'allin' };
        else a = { k: L.canCheck ? 'check' : 'call' };
        const e = act(S, k, a); need(e === null, `${h}번째 판 ${k}번 자리 ${a.k} ${a.to || ''}: ${e}`);
      }
      const sum1 = S.seats.reduce((s, p) => s + (p ? p.chips : 0), 0);
      need(sum1 === sum0, `${h}번째 판: 칩 총합 ${sum0} → ${sum1}`);
      need(S.seats.every(p => !p || (p.chips >= 0 && p.chips % UNIT === 0)), `${h}번째 판: 칩이 음수거나 5칩 단위가 아니다`);
      need(S.result.fold || (S.board.length === 5 && S.burned.length === 3), `${h}번째 판: 쇼다운인데 바닥 ${S.board.length}장 · 번 ${S.burned.length}장`);
    }
  });

  console.log(`%c홀덤 엔진 시험: ${pass} 통과 · ${fail} 실패`, `font-weight:bold;color:${fail ? '#e06c5a' : '#6cbf7a'}`);
  lines.forEach(([m, name, msg]) => (m === '✘' ? console.warn : console.log)(`${m} ${name}${msg ? ' — ' + msg : ''}`));
  return { pass, fail };
}
/* 콘솔에서 바로 부를 수 있게 */
if (typeof window !== 'undefined') window.pokerTest = pokerTest;