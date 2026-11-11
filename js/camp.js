import { ctx, session } from './state.js';
import { CAMP } from './data.js';

/* ══ 지금 캠프의 배치 ══
   배치표(data.js 의 CAMP)는 1인·멀티 두 가지. 장면을 만들 때(scene.js) campForBuild() 로 골라 W.camp 에 남기고,
   그 뒤로는 모든 파일이 camp() 로 같은 배치를 읽는다 → 세션 모드가 바뀌어도 지금 보이는 세계와 어긋나지 않는다.
   장면이 아직 배치를 정하지 않았으면 1인 배치 */

/* 새 장면을 만들 때 쓸 배치: 멀티(방장·친구)면 멀티 배치 */
export const campForBuild = () => (session.mode === 'host' || session.mode === 'guest') ? CAMP.multi : CAMP.solo;
/* 지금 장면의 배치 */
export const camp = () => (ctx.W && ctx.W.camp) || CAMP.solo;
export const multiCamp = () => camp().multi;
/* 걷기 충돌 목록 */
export const blocks = () => camp().blocks;
/* 자리 정보 (pos · stand · at · name · up …). 없는 자리면 undefined */
export const seatOf = id => camp().seats[id];
/* 자리 종류: 'chair3' → 'chair', 'car2' → 'car', 'bed' → 'bed' */
export const seatKind = id => typeof id === 'string' ? id.replace(/\d+$/, '') : id;
/* 이 종류의 자리 이름들 (앞에서부터 순서대로): seatsOf('tent') → ['tent', 'tent2', 'tent3', 'tent4'] */
export const seatsOf = kind => Object.keys(camp().seats).filter(k => seatKind(k) === kind);
/* 모닥불 가운데 [x, y, z] */
export const fireAt = (y = 0) => { const f = camp().fire; return [f[0], y, f[1]]; };