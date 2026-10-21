/* ══ 캠핑 메모 ══
   차 조수석 담요 위에 놓인 크림색 줄노트. 운전석에서 바라보고 E 를 누르면 열린다 (game.js 가 열고 닫는다).
   적힌 할 일은 data.js 의 memoFor 가 지금 장소에 맞는 줄만 골라 넘겨준다 (번호는 목록이 저절로 다시 매긴다).
   체크 표시는 아직 없다 — 글자로만 적는다.
   창은 트렁크·도감과 같은 .modal 을 쓰고, 안의 상자를 종이처럼 꾸민다.
   종이의 줄(32px 간격)과 글줄 높이(line-height 32px)를 맞춰 글이 줄 위에 앉는다 */

export const memoHooks = { close: null };
let el = null;

const CSS = `
#memo .box{width:min(400px,92%);padding:0;background:none;border:none;box-shadow:none;overflow:visible;max-height:none}
.mpaper{position:relative;transform:rotate(-1.2deg);padding:20px 24px 28px 52px;border-radius:4px;color:#3b3328;line-height:32px;
  background-color:#efe6d1;
  background-image:linear-gradient(90deg,transparent 38px,rgba(200,96,84,.4) 38px,rgba(200,96,84,.4) 39px,transparent 39px),
    repeating-linear-gradient(180deg,transparent 0,transparent 31px,rgba(70,104,150,.22) 31px,rgba(70,104,150,.22) 32px);
  background-position:0 0,0 20px;
  box-shadow:0 18px 50px rgba(0,0,0,.45),0 2px 0 rgba(0,0,0,.08)}
.mpaper h3{margin:0;font-family:var(--serif);font-weight:500;font-size:17px;letter-spacing:.12em}
.mpaper ol{margin:0;padding-left:1.3em;font-family:var(--serif);font-size:14.5px;letter-spacing:.02em;word-break:keep-all}
.mpaper li::marker{color:#8c7b5e}
#memo .row{justify-content:center;margin-top:22px}
#memo .row .b{flex:0 0 auto;min-width:140px}
@media (max-height:440px){
.mpaper{line-height:26px;padding:12px 22px 16px 50px;
  background-image:linear-gradient(90deg,transparent 38px,rgba(200,96,84,.4) 38px,rgba(200,96,84,.4) 39px,transparent 39px),
    repeating-linear-gradient(180deg,transparent 0,transparent 25px,rgba(70,104,150,.22) 25px,rgba(70,104,150,.22) 26px);
  background-position:0 0,0 12px}
#memo .row{margin-top:12px}}`;

/* 창은 처음 열 때 #hud 안에 만든다 (트렁크·도감 창과 같은 자리) */
function ensure() {
  if (el && el.isConnected) return el;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  el = document.createElement('div'); el.className = 'modal'; el.id = 'memo';
  el.innerHTML = '<div class="box"><div class="mpaper"><h3>캠핑 메모</h3><ol data-k="list"></ol></div>' +
    '<div class="row"><button class="b" data-k="close">닫기 <kbd>E</kbd></button></div></div>';
  document.querySelector('#hud').append(el);
  const close = () => { if (memoHooks.close) memoHooks.close(); };
  el.querySelector('[data-k=close]').onclick = close;
  el.addEventListener('click', e => { if (e.target === el) close(); });
  return el;
}

/* list: data.js 의 memoFor(장소) 결과 */
export function showMemo(list) {
  const e = ensure();
  e.querySelector('[data-k=list]').innerHTML = list.map(m => `<li>${m.text}</li>`).join('');
  e.classList.add('on');
}
export function hideMemo() { if (el) el.classList.remove('on'); }