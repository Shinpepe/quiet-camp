import { ctx } from './state.js';

/* ── 화면 문구: 역할마다 자리·모양이 하나씩 ──
   신호  banner()  화면 가운데 큰 글씨. 지금 바로 반응해야 하는 것만 (낚시 입질 "!")
   판정  gauge     게이지 옆 세리프 글씨. 대성공·성공·빗나감, 연속이면 "3연속 대성공" (G.label)
   소식  toast()   위쪽 유리 알약. 행동의 결과와 막힌 이유 전부 (불·랜턴·마시기·낚시 실패·무게 등)
   안내  guide()   소식과 같은 자리에 거둘 때까지 떠 있는 한 줄 (캠핑 메모 안내). 소식이 오면 잠깐 비켜 줬다가 돌아온다
   기록  card      소식 아래 유리 카드. 드물고 남겨 둘 만한 순간 (잡은 물고기)
   말투: 결과는 "~했다", 막혔을 때는 "~하자", 진행 중은 "~하는 중"(아이템 상자 안내 줄), 판정은 두세 글자 명사

   ── 공통 타이밍 게이지 (장작 패기·낚시) ──
   생김새: HUD 의 아이템 상자와 같은 반투명 유리 막대.
   빈 트랙 = 빗나감, 밝은 띠 = 성공, 금색 = 대성공, 흰 점 = 지금 위치. 누른 순간의 점 위치로 판정한다.
   판정 문구는 점 높이에서 막대 왼쪽에 세리프 글씨로 잠깐 뜬다.
   도구(도끼·낚싯대) 오른쪽 옆에 작게. 모바일 버튼(#mobile .b)과 겹치면 버튼 왼쪽으로 비켜 선다.
   일시정지 중에는 숨는다.
   한 번 판정하면 0.5초 쉬었다가 성공 구간이 새 자리로 옮겨 간다 (같은 자리만 노리는 방식이 통하지 않게).
   요소는 처음 쓸 때 #hud 안에 만든다 (토스트는 index.html 의 #toast) */
const POS = { right: '13%', top: '44%', h: 'min(24vh, 180px)' };   // 기본 위치(화면 오른쪽에서, 세로 가운데)·길이
let el = null, toastT = null, backT = null, guideMsg = null;
const pill = () => document.getElementById('toast');
function showPill(t, msg) { t.textContent = msg; t.classList.add('on'); }

/* 소식: 2.2초 보였다가 사라진다. 새 소식이 오면 바로 바꿔 쓴다.
   안내가 떠 있었다면 소식이 잠깐 그 자리를 덮고, 소식이 사라진 뒤 0.5초 있다 안내가 돌아온다 */
export function toast(msg) {
  const t = pill(); if (!t) return;
  clearTimeout(toastT); clearTimeout(backT); showPill(t, msg);
  toastT = setTimeout(() => {
    toastT = null; t.classList.remove('on');
    if (guideMsg) backT = setTimeout(() => { if (guideMsg && !toastT) showPill(t, guideMsg); }, 500);
  }, 2200);
}
/* 안내: 거둘 때까지(null) 소식 자리에 떠 있는 한 줄. 같은 글이면 아무것도 하지 않는다.
   소식이 떠 있는 동안 바뀌면 글만 기억해 두고, 소식이 끝난 뒤에 보여 준다 */
export function guide(msg) {
  msg = msg || null; if (msg === guideMsg) return; guideMsg = msg;
  if (toastT) return;
  const t = pill(); if (!t) return; clearTimeout(backT);
  if (msg) showPill(t, msg); else t.classList.remove('on');
}

/* 기본 자리에 둔 뒤, 화면에 보이는 모바일 버튼과 겹치면 그 버튼 왼쪽으로 옮긴다 */
function fit(e) {
  const root = e.root; root.style.right = POS.right; root.style.top = POS.top; root.style.height = POS.h; e.dirty = false;
  const mob = document.getElementById('mobile'); if (!mob) return;
  const g = root.getBoundingClientRect();
  for (const b of mob.querySelectorAll('.b')) {
    const r = b.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (g.left < r.right + 12 && g.right > r.left - 12 && g.top < r.bottom + 12 && g.bottom > r.top - 12) { root.style.right = (innerWidth - r.left + 30) + 'px'; return; }
  }
}
function ensure() {
  if (el && el.root.isConnected) return el;
  const hud = document.querySelector('#hud'); if (!hud) return null;
  /* 유리 테두리(root) 안에 트랙(tr). 성공 띠·대성공 띠·점·판정 문구는 트랙 기준 % 로 놓인다 */
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;width:20px;padding:6px;border-radius:10px;background:rgba(10,12,18,.45);border:1px solid var(--line);' +
    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transform:translateY(-50%);opacity:0;transition:opacity .2s;pointer-events:none;z-index:5';
  root.innerHTML =
    '<div data-k="tr" style="position:relative;width:100%;height:100%;border-radius:4px;background:rgba(255,255,255,.1)">' +
    '<div data-k="ok" style="position:absolute;left:0;right:0;border-radius:4px;background:rgba(255,255,255,.3)"></div>' +
    '<div data-k="gr" style="position:absolute;left:0;right:0;border-radius:3px;background:var(--accent)"></div>' +
    '<div data-k="mk" style="position:absolute;left:50%;width:10px;height:10px;border-radius:50%;background:#fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.25);transform:translate(-50%,50%)"></div>' +
    '<div data-k="fb" style="position:absolute;right:24px;transform:translateY(50%);font-family:var(--serif);font-size:15px;letter-spacing:.06em;white-space:nowrap;text-shadow:0 1px 6px #000;opacity:0;transition:opacity .15s"></div>' +
    '</div>';
  /* 신호: 화면 가운데 위 큰 글씨 */
  const ban = document.createElement('div');
  ban.style.cssText = 'position:absolute;left:0;right:0;top:17%;text-align:center;font-size:28px;font-weight:500;color:#f3d27a;opacity:0;transition:opacity .25s;pointer-events:none;text-shadow:0 1px 6px rgba(0,0,0,.45);z-index:5';
  /* 기록 카드: 소식(토스트) 아래, 아이템 상자와 같은 어두운 유리. 들어 올린 물고기를 가리지 않게 위쪽에 둔다 */
  const card = document.createElement('div');
  card.style.cssText = 'position:absolute;left:50%;top:calc(124px + var(--sat));transform:translateX(-50%);background:rgba(12,14,20,.72);border:1px solid var(--line);' +
    'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:var(--ink);padding:12px 22px;border-radius:14px;text-align:center;opacity:0;transition:opacity .25s;pointer-events:none;min-width:180px;z-index:5';
  hud.append(root, ban, card);
  const q = k => root.querySelector(`[data-k="${k}"]`);
  el = { root, fb: q('fb'), mk: q('mk'), ok: q('ok'), gr: q('gr'), ban, card, banT: null, dirty: true };
  const mark = () => { el.dirty = true; };
  addEventListener('resize', mark); addEventListener('orientationchange', mark);
  return el;
}

/* speed: 초당 막대를 지나는 비율, okW·greatW: 성공·대성공 구간 폭(막대 대비) */
export function makeGauge(speed, okW, greatW) { const G = { p: 0, dir: 1, speed, ok: okW, great: greatW, c: 0.5, pause: 0, flash: null, label: null, ft: 0 }; place(G); return G; }
function place(G) { G.c = G.ok / 2 + 0.04 + Math.random() * Math.max(0, 1 - G.ok - 0.08); }
export function gaugeUpdate(G, dt) {
  if (G.pause > 0) { G.pause -= dt; if (G.pause <= 0) place(G); }
  else { G.p += G.dir * G.speed * dt; if (G.p > 1) { G.p = 2 - G.p; G.dir = -1; } if (G.p < 0) { G.p = -G.p; G.dir = 1; } }
  if (G.ft > 0) G.ft -= dt;
}
/* 판정: 'great' | 'ok' | 'fail'. 쉬는 중이면 null (연타 방지).
   부르는 쪽이 판정 직후 G.label 에 글자를 넣으면 기본 판정 글자 대신 그것을 띄운다 (예: "3연속 대성공") */
export function gaugeJudge(G) {
  if (G.pause > 0) return null;
  const d = Math.abs(G.p - G.c), r = d < G.great / 2 ? 'great' : d < G.ok / 2 ? 'ok' : 'fail';
  G.flash = r; G.label = null; G.ft = 0.8; G.pause = 0.5; return r;
}
/* 판정 문구: 실패는 "빗나감"으로 부드럽게 */
const FB = { great: ['대성공', '#f3d27a'], ok: ['성공', '#cfe8c0'], fail: ['빗나감', '#e8b4a8'] };
/* p 0 = 막대 아래, 1 = 위. 대성공 띠는 아주 좁아도 4px 은 보이게 */
export function gaugeShow(G) {
  const e = ensure(); if (!e) return;
  if (ctx.paused) { e.root.style.opacity = 0; return; }
  if (e.dirty) fit(e);
  e.root.style.opacity = 1;
  e.ok.style.bottom = (G.c - G.ok / 2) * 100 + '%'; e.ok.style.height = G.ok * 100 + '%';
  e.gr.style.bottom = (G.c - G.great / 2) * 100 + '%'; e.gr.style.height = `max(4px, ${G.great * 100}%)`;
  e.mk.style.bottom = G.p * 100 + '%';
  if (G.ft > 0) { const m = FB[G.flash]; e.fb.textContent = G.label || m[0]; e.fb.style.color = m[1]; e.fb.style.bottom = G.p * 100 + '%'; e.fb.style.opacity = Math.min(1, G.ft / 0.3); }
  else e.fb.style.opacity = 0;
}
export function gaugeHide() { if (el) el.root.style.opacity = 0; }
/* 신호: 화면 가운데 큰 글씨. 지금 바로 반응해야 하는 것에만 쓴다 (낚시 입질 "!") */
export function banner(text, dur = 1.4, color = '#f3d27a') {
  const e = ensure(); if (!e) return;
  e.ban.textContent = text; e.ban.style.color = color; e.ban.style.opacity = 1;
  clearTimeout(e.banT); e.banT = setTimeout(() => { e.ban.style.opacity = 0; }, dur * 1000);
}
/* 신호를 바로 거둔다 — 입질에 챔질했을 때처럼, 반응하고 나면 더 띄워 둘 이유가 없을 때 */
export function hideBanner() { if (!el) return; clearTimeout(el.banT); el.ban.style.opacity = 0; }
export function showCard(html) { const e = ensure(); if (!e) return; e.card.innerHTML = html; e.card.style.opacity = 1; }
export function hideCard() { if (el) el.card.style.opacity = 0; }
export function hideAllFx() { if (!el) return; el.root.style.opacity = 0; el.card.style.opacity = 0; el.ban.style.opacity = 0; clearTimeout(el.banT); }