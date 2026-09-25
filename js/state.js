const fine = matchMedia('(pointer:fine)').matches;   // 데스크톱이면 무거운 효과 기본 켜기
export const ctx = { renderer: null, camera: null, hand: null, post: null, scene: null, W: {}, running: false, paused: false };
export const state = { bg: 'lake', time: 'sunset', item: null, mode: 'seated', seat: 'car' };
export const settings = { vol: 0.5, sens: 1, shadow: true, bloom: true, ao: fine, reflect: fine };
