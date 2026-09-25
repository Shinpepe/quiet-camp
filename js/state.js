export const ctx = { renderer: null, camera: null, hand: null, post: null, scene: null, W: {}, running: false, paused: false };
export const state = { bg: 'lake', time: 'sunset', item: null, mode: 'seated', seat: 'car' };
/* post: false 이면 단일 파일 버전과 완전히 같은 렌더링 경로 (포스트 프로세싱 없음) */
export const settings = { vol: 0.5, sens: 1, shadow: true, post: false };
