import { session, state } from './state.js';
import { $ } from './util.js';
import { sfx } from './audio.js';
/* game.js 와 서로 불러오지만, 실행 중에만 부르므로 순환해도 괜찮다 */
import { openMenu } from './game.js';

/* ══ 홈 화면 ══
   처음 열면 나오는 화면. 1인 캠핑 / 멀티 캠핑을 고른다.
   멀티 캠핑은 캠핑장 초대하기(방장 — 초대 코드를 새로 만든다) / 캠핑장 놀러가기(친구 — 받은 코드를 넣는다).
   고르고 나면 session(state.js)에 방식과 코드를 적고 메뉴를 연다 (game.js openMenu).
   초대 링크(?code=AB3K9)로 열면 코드가 채워진 채 놀러가기 화면에서 시작한다.
   아직 연결은 없다 — 친구로 들어가면 대기실에서 방장을 기다리는 상태로 멈춘다 (net.js 에서 이어 붙인다) */

/* 초대 코드 글자: 헷갈리는 O·I·L·0·1 은 뺀다 (31자 × 5자리 ≈ 2천8백만 가지) */
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 5;
export const newCode = () => Array.from({ length: CODE_LEN }, () => ABC[Math.floor(Math.random() * ABC.length)]).join('');
export const validCode = c => c.length === CODE_LEN && [...c].every(ch => ABC.includes(ch));
const cleanCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
export const inviteLink = code => location.origin + location.pathname + '?code=' + code;

function step(name) {
  document.querySelectorAll('#home .homeStep').forEach(s => s.classList.toggle('on', s.dataset.step === name));
  if (name === 'join') setTimeout(() => $('#hCode').focus(), 60);
}
/* 홈으로 돌아온다 (메뉴의 "처음으로", 친구가 캠핑장을 나갈 때). 캠핑 방식은 지운다 */
export function showHome(at = 'start') {
  session.mode = 'solo'; session.code = null;
  $('#menu').classList.add('hidden'); $('#home').classList.remove('hidden'); step(at);
}
function enter(mode, code) {
  session.mode = mode; session.code = code;
  $('#home').classList.add('hidden'); openMenu();
}

export function bindHome() {
  $('#hSolo').onclick = () => { sfx('ui'); enter('solo', null); };
  $('#hMulti').onclick = () => { sfx('ui'); step('multi'); };
  $('#hHost').onclick = () => { sfx('ui'); enter('host', newCode()); };
  $('#hJoin').onclick = () => { sfx('ui'); step('join'); };
  document.querySelectorAll('#home [data-back]').forEach(b => { b.onclick = () => { sfx('ui'); step(b.dataset.back); }; });
  /* 코드 입력: 대문자로 바꾸고 글자·숫자만 남긴다. Enter 로 들어간다 (게임 쪽 키 처리로 넘기지 않는다) */
  const inp = $('#hCode'), err = $('#hErr');
  inp.oninput = () => { const c = cleanCode(inp.value); if (inp.value !== c) inp.value = c; err.textContent = ''; };
  const submit = () => {
    const c = inp.value;
    if (c.length < CODE_LEN) { err.textContent = '초대 코드 5자리를 넣자'; return; }
    if (!validCode(c)) { err.textContent = 'O·I·L·0·1 은 코드에 쓰지 않는다. 다시 확인하자'; return; }
    sfx('uiGo'); enter('guest', c);
  };
  $('#hEnter').onclick = submit;
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  const q = new URLSearchParams(location.search).get('code');
  if (q) { inp.value = cleanCode(q); step('join'); } else step('start');
}