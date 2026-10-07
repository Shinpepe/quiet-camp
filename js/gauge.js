/* ── 공통 타이밍 게이지 (장작 패기·낚시) + 화면 가운데 문구 + 결과 카드 ──
   막대: 실패(빨강)가 성공(초록)을 감싸고, 성공이 대성공(금색)을 감싼다. 삼각형이 좌우로 오가고, 누른 순간의 위치로 판정한다.
   한 번 판정하면 0.5초 쉬었다가 성공 구간이 새 자리로 옮겨 간다 (같은 자리만 노리는 방식이 통하지 않게).
   요소는 처음 쓸 때 #hud 안에 만든다 (index.html 은 고치지 않는다) */
const BOTTOM = '13%';   // 게이지 높이 (화면 아래에서)
let el = null;

function ensure() {
  if (el && el.root.isConnected) return el;
  const hud = document.querySelector('#hud'); if (!hud) return null;
  const root = document.createElement('div');
  root.style.cssText = `position:absolute;left:50%;bottom:${BOTTOM};width:min(46vw,520px);transform:translateX(-50%);opacity:0;transition:opacity .2s;pointer-events:none;z-index:5`;
  root.innerHTML =
    '<div data-k="fb" style="position:absolute;bottom:34px;transform:translateX(-50%);font-size:17px;font-weight:500;white-space:nowrap;padding:2px 10px;border-radius:8px;background:rgba(0,0,0,.4);opacity:0;transition:opacity .15s"></div>' +
    '<div data-k="mk" style="position:absolute;bottom:16px;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:13px solid #fff;margin-left:-8px"></div>' +
    '<div style="position:relative;height:14px;border-radius:7px;background:#b9655a;overflow:hidden;box-shadow:0 0 0 1.5px rgba(0,0,0,.35)">' +
    '<div data-k="ok" style="position:absolute;top:0;bottom:0;background:#6aa85a"></div><div data-k="gr" style="position:absolute;top:0;bottom:0;background:#f0c24f"></div></div>';
  const ban = document.createElement('div');
  ban.style.cssText = 'position:absolute;left:0;right:0;top:17%;text-align:center;font-size:28px;font-weight:500;color:#f3d27a;opacity:0;transition:opacity .25s;pointer-events:none;text-shadow:0 1px 6px rgba(0,0,0,.45);z-index:5';
  const card = document.createElement('div');
  card.style.cssText = 'position:absolute;left:50%;bottom:24%;transform:translateX(-50%);background:rgba(255,255,255,.94);color:#1f2a2c;padding:10px 18px;border-radius:12px;text-align:center;opacity:0;transition:opacity .25s;pointer-events:none;min-width:180px;z-index:5';
  hud.append(root, ban, card);
  const q = k => root.querySelector(`[data-k="${k}"]`);
  el = { root, fb: q('fb'), mk: q('mk'), ok: q('ok'), gr: q('gr'), ban, card, banT: null };
  return el;
}

/* speed: 초당 막대를 지나는 비율, okW·greatW: 성공·대성공 구간 폭(막대 대비) */
export function makeGauge(speed, okW, greatW) { const G = { p: 0, dir: 1, speed, ok: okW, great: greatW, c: 0.5, pause: 0, flash: null, ft: 0 }; place(G); return G; }
function place(G) { G.c = G.ok / 2 + 0.04 + Math.random() * Math.max(0, 1 - G.ok - 0.08); }
export function gaugeUpdate(G, dt) {
  if (G.pause > 0) { G.pause -= dt; if (G.pause <= 0) place(G); }
  else { G.p += G.dir * G.speed * dt; if (G.p > 1) { G.p = 2 - G.p; G.dir = -1; } if (G.p < 0) { G.p = -G.p; G.dir = 1; } }
  if (G.ft > 0) G.ft -= dt;
}
/* 판정: 'great' | 'ok' | 'fail'. 쉬는 중이면 null (연타 방지) */
export function gaugeJudge(G) {
  if (G.pause > 0) return null;
  const d = Math.abs(G.p - G.c), r = d < G.great / 2 ? 'great' : d < G.ok / 2 ? 'ok' : 'fail';
  G.flash = r; G.ft = 0.8; G.pause = 0.5; return r;
}
const FB = { great: ['대성공!', '#f3d27a'], ok: ['성공', '#a8e08c'], fail: ['실패', '#f0a090'] };
export function gaugeShow(G) {
  const e = ensure(); if (!e) return;
  e.root.style.opacity = 1;
  e.ok.style.left = (G.c - G.ok / 2) * 100 + '%'; e.ok.style.width = G.ok * 100 + '%';
  e.gr.style.left = (G.c - G.great / 2) * 100 + '%'; e.gr.style.width = G.great * 100 + '%';
  e.mk.style.left = G.p * 100 + '%';
  if (G.ft > 0) { const m = FB[G.flash]; e.fb.textContent = m[0]; e.fb.style.color = m[1]; e.fb.style.left = G.p * 100 + '%'; e.fb.style.opacity = Math.min(1, G.ft / 0.3); }
  else e.fb.style.opacity = 0;
}
export function gaugeHide() { if (el) el.root.style.opacity = 0; }
/* 화면 가운데 큰 문구 (대성공 n연속, 입질 "!", 도망갔다 등) */
export function banner(text, dur = 1.4, color = '#f3d27a') {
  const e = ensure(); if (!e) return;
  e.ban.textContent = text; e.ban.style.color = color; e.ban.style.opacity = 1;
  clearTimeout(e.banT); e.banT = setTimeout(() => { e.ban.style.opacity = 0; }, dur * 1000);
}
export function showCard(html) { const e = ensure(); if (!e) return; e.card.innerHTML = html; e.card.style.opacity = 1; }
export function hideCard() { if (el) el.card.style.opacity = 0; }
export function hideAllFx() { if (!el) return; el.root.style.opacity = 0; el.card.style.opacity = 0; el.ban.style.opacity = 0; clearTimeout(el.banT); }