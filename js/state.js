// 모듈 사이에서 공유하는 가변 상태. 씬을 다시 만들면 ctx.scene / ctx.W 가 교체된다.
export const ctx = { renderer: null, camera: null, hand: null, post: null, scene: null, W: {}, running: false, paused: false };
export const state = { bg: 'lake', time: 'sunset', item: null, mode: 'seated', seat: 'car' };   // mode: walk | seated | trunk
export const settings = { vol: 0.5, sens: 1, shadow: true, bloom: true };
