export const BG = {
  beach: { key: 'beach', name: '바다가 보이는 모래사장', ic: '🌊', ds: '파도 소리, 야자수, 갈매기', ground: 0xead9ad, rock: 0x8a7a66, amp: 0.7, mtAmp: 120, mtBase: 6, bloomMul: 0.45,
    water: { deep: 0x1c6d9c, shallow: 0x62c3d9, z: -9, size: 1200, wave: 1.0, wobble: 5 }, grass: { n: 2600, color: 0xbdaa6c, zmin: -4 }, palms: 16, bushes: 14, bushZmin: 6, rocks: 0, pines: 0, leafs: 0, birds: true, snow: false, fireflies: false, ambience: 'waves' },
  lake:  { key: 'lake', name: '호수가 보이는 숲속', ic: '🌲', ds: '새소리, 나무 부두, 밤엔 반딧불', ground: 0x4b8038, rock: 0x5c5a55, amp: 2.4, mtAmp: 300, mtBase: 25, bloomMul: 1.0,
    water: { deep: 0x173f52, shallow: 0x3c8a8c, z: -9, size: 600, wave: 0.28, wobble: 9 }, grass: { n: 9000, color: 0x58a03c, zmin: -8 }, palms: 0, bushes: 90, rocks: 14, pines: 1400, leafs: 260, birds: true, snow: false, fireflies: true, dock: true, ambience: 'forest' },
  snow:  { key: 'snow', name: '경치가 좋은 설산', ic: '🏔️', ds: '바람 소리, 내리는 눈, 뽀드득 발소리', ground: 0xf3f6fb, rock: 0x7d8792, amp: 6, mtAmp: 420, mtBase: 70, bloomMul: 0.35,
    water: null, grass: null, palms: 0, bushes: 0, rocks: 12, pines: 480, leafs: 0, birds: false, snow: true, fireflies: false, ambience: 'wind' },
};

/* 시간대 키프레임. fogH: 안개 높이 스케일(m, 클수록 위까지 안개), insc: 해/달 쪽을 볼 때 안개가 밝게 빛나는 세기 */
export const TIME = {
  dawn: { key: 'dawn', name: '안개 낀 새벽', ic: '🌄', clock: 0.27, top: 0x3a4f86, bottom: 0xf0b892, sunColor: 0xffd2a8, sunI: 2.4, amb: 0.5, hemi: 0.8, ibl: 0.45, stars: 0.12, sunSize: 18, disc: 0xffd8a8, glow: 0.8, lantern: 3, tentLamp: 1.5, fireI: 10, fog: 0xe6c2ae, fogFar: 650, fogH: 40, insc: 0.6, exposure: 1.0, waterMul: 0.8, cloudCover: 0.62, cloudLit: 0xffd8c0, cloudShade: 0x6a6a8a, mist: 0,
    grade: { tint: [1.0, 0.98, 1.02], sat: 0.95, con: 1.0, bloom: 0.28 } },
  afternoon: { key: 'afternoon', name: '화창한 오후', ic: '☀️', clock: 0.58, top: 0x2b6fd6, bottom: 0xd8edff, sunColor: 0xfff3dc, sunI: 3.6, amb: 0.9, hemi: 1.3, ibl: 0.6, stars: 0, sunSize: 10, disc: 0xfff9e0, glow: 0.35, lantern: 0, tentLamp: 0, fireI: 6, fog: 0xd8edff, fogFar: 950, fogH: 90, insc: 0.3, exposure: 0.92, waterMul: 1, cloudCover: 0.45, cloudLit: 0xffffff, cloudShade: 0x8a96a8, mist: 0,
    grade: { tint: [1, 1, 1], sat: 1.04, con: 1.0, bloom: 0.12 } },
  sunset: { key: 'sunset', name: '노을지는 저녁', ic: '🌇', clock: 0.735, top: 0x2b2557, bottom: 0xff8c4c, sunColor: 0xffa25a, sunI: 3.4, amb: 0.5, hemi: 0.75, ibl: 0.5, stars: 0.3, sunSize: 24, disc: 0xffa040, glow: 1.1, lantern: 6, tentLamp: 3, fireI: 18, fog: 0xf7925e, fogFar: 880, fogH: 60, insc: 0.8, exposure: 1.0, waterMul: 0.75, cloudCover: 0.5, cloudLit: 0xffb08a, cloudShade: 0x5a4a6a, mist: 0,
    grade: { tint: [1.03, 0.99, 0.96], sat: 1.08, con: 1.02, bloom: 0.34 } },
  night: { key: 'night', name: '별이 빛나는 밤', ic: '🌌', clock: 0.0, top: 0x030614, bottom: 0x18243b, sunColor: 0x93aaff, sunI: 1.0, amb: 0.18, hemi: 0.35, ibl: 0.3, stars: 1, sunSize: 8, disc: 0xf0f3ff, glow: 0.3, lantern: 14, tentLamp: 6, fireI: 28, fog: 0x0c1426, fogFar: 720, fogH: 70, insc: 0.3, exposure: 1.12, waterMul: 0.3, cloudCover: 0.35, cloudLit: 0x2a3550, cloudShade: 0x05070f, mist: 0,
    grade: { tint: [0.96, 0.98, 1.05], sat: 0.97, con: 1.02, bloom: 0.5 } },
};
export const KEYS = [[0.0, 'night'], [0.27, 'dawn'], [0.58, 'afternoon'], [0.735, 'sunset'], [0.86, 'night'], [1.0, 'night']];

export const ITEMS = {
  coffee: { name: '커피', ic: '☕', act: '한 모금', ds: '따뜻한 김이 천천히 올라온다' },
  whisky: { name: '위스키', ic: '🥃', act: '한 잔', ds: '얼음이 잔에 부딪히는 소리' },
  smoke:  { name: '담배', ic: '🚬', act: '한 모금', ds: '연기가 바람에 흩어진다' },
};
export const SEAT = {
  car:   { pos: [-0.45, 1.28, 8.15], stand: [-2.1, 8.2], name: '운전석', up: '차에서 내리기' },
  chair: { pos: [1.5, 1.05, 0.95], stand: [1.5, 2.4], name: '의자', up: '일어나기' },
  tent:  { pos: [-1.6, 0.72, 1.85], stand: [-1.6, -1.3], name: '텐트 안', up: '텐트에서 나가기' },
  dock:  { pos: [5.7, 1.05, -19.4], stand: [5.7, -18.0], name: '부두 끝', up: '일어나기' },
};
export const BLOCKS = [
  { x: [-1.15, 1.15], z: [5.5, 10.7] }, { x: [-2.95, -0.25], z: [-0.15, 2.6] },
  { x: [1.1, 1.9], z: [0.4, 1.2] }, { x: [0.2, 1.0], z: [0.1, 0.9] },
  { x: [-0.45, 1.05], z: [-2.15, -0.7] }, { x: [2.1, 3.2], z: [0.05, 0.85] }, { x: [1.2, 2.1], z: [-2.9, -2.0] },
];
export const EYE = 1.6, PR = 0.35;
