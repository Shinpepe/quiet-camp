const fine = matchMedia('(pointer:fine)').matches;
export const ctx = { renderer: null, camera: null, hand: null, post: null, pmrem: null, scene: null, W: {}, running: false, paused: false };
/* clock: 하루를 0..1 로 (0 = 자정, 0.5 = 정오) */
export const state = { bg: 'lake', time: 'sunset', clock: 0.735, item: null, mode: 'seated', seat: 'car' };
export const settings = { vol: 0.5, sens: 1, shadow: true, bloom: true, ao: fine, reflect: fine, flow: true, dayMin: 30 };
