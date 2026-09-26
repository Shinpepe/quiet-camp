/* ── 자체 제작 SVG 아이콘: 얇은 선, currentColor. 기기·폰트와 무관하게 같은 모양 ── */
const svg = inner => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
export const ICON = {
  beach: svg('<path d="M3 15c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/><path d="M3 19c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/><path d="M8 11a4 4 0 0 1 8 0"/><path d="M12 4v1.5M6.3 6.5l1 1M17.7 6.5l-1 1"/>'),
  lake:  svg('<path d="M12 3l4 6h-2.5l3 4.5H14l3 4.5H7l3-4.5H8.5l3-4.5H9z"/><path d="M12 18v3"/><path d="M2.5 21c1.5-1 3-1 4.5 0"/><path d="M17 21c1.5-1 3-1 4.5 0"/>'),
  snow:  svg('<path d="M2 20L9 7l3 5 2-3 8 11z"/><path d="M6.8 11.2l1.1 1.3 1.1-1.5 1.1 1.5"/><path d="M14 9l1.2 1.4 1-1.4 1.2 1.4"/>'),
  dawn:      svg('<path d="M4 15h16"/><path d="M7.5 15a4.5 4.5 0 0 1 9 0"/><path d="M12 6v2M5.6 9.6l1.4 1.4M18.4 9.6l-1.4 1.4"/><path d="M6 19h5M13 19h5"/>'),
  afternoon: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
  sunset:    svg('<path d="M3 16h18"/><path d="M7 16a5 5 0 0 1 10 0"/><path d="M12 6v2M6 9l1.4 1.4M18 9l-1.4 1.4"/><path d="M9 20h6"/>'),
  night:     svg('<path d="M15.5 3.5a8 8 0 1 0 5 13.5 7 7 0 0 1-5-13.5z"/><path d="M6 4l.6 1.4L8 6l-1.4.6L6 8l-.6-1.4L4 6l1.4-.6z"/>'),
  coffee: svg('<path d="M5 9h11v5a5 5 0 0 1-10 0z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M4 21h14"/><path d="M8.5 3.5c-.8 1 .8 2 0 3M11.5 3.5c-.8 1 .8 2 0 3"/>'),
  whisky: svg('<path d="M6 4h12l-1 16H7z"/><path d="M6.8 12h10.4"/><path d="M9.5 14.5h3v3h-3z"/>'),
  smoke:  svg('<path d="M3 18l13-6 1.5 3.2-13 6z"/><path d="M13.6 13.8l1.5 3.2"/><path d="M17.5 8c-1 1 1 2 0 3M20 6c-1 1 1 2 0 3"/>'),
};

export const BG = {
  beach: { key: 'beach', name: '바다가 보이는 모래사장', ic: ICON.beach, ground: 0xead9ad, rock: 0x8a7a66, amp: 0.7, mtAmp: 120, mtBase: 6, bloomMul: 0.45,
    water: { deep: 0x1c6d9c, shallow: 0x62c3d9, z: -9, size: 1200, wave: 1.0, wobble: 5 }, grass: { n: 2600, color: 0xbdaa6c, zmin: -4 }, palms: 16, bushes: 14, bushZmin: 6, rocks: 0, pines: 0, leafs: 0, birds: true, snow: false, fireflies: false, ambience: 'waves' },
  lake:  { key: 'lake', name: '호수가 보이는 숲속', ic: ICON.lake, ground: 0x4b8038, rock: 0x5c5a55, amp: 2.4, mtAmp: 300, mtBase: 25, bloomMul: 1.0,
    water: { deep: 0x173f52, shallow: 0x3c8a8c, z: -9, size: 600, wave: 0.28, wobble: 9 }, grass: { n: 9000, color: 0x58a03c, zmin: -8 }, palms: 0, bushes: 90, rocks: 14, pines: 1400, leafs: 260, birds: true, snow: false, fireflies: true, dock: true, ambience: 'forest' },
  snow:  { key: 'snow', name: '경치가 좋은 설산', ic: ICON.snow, ground: 0xf3f6fb, rock: 0x7d8792, amp: 6, mtAmp: 420, mtBase: 70, bloomMul: 0.35,
    water: null, grass: null, palms: 0, bushes: 0, rocks: 12, pines: 480, leafs: 0, birds: false, snow: true, fireflies: false, ambience: 'wind' },
};

/* 시간대 키프레임. fogH: 안개 높이 스케일, insc: 해/달 쪽 산란 세기 */
export const TIME = {
  dawn: { key: 'dawn', name: '안개 낀 새벽', ic: ICON.dawn, clock: 0.27, top: 0x3a4f86, bottom: 0xf0b892, sunColor: 0xffd2a8, sunI: 2.4, amb: 0.5, hemi: 0.8, ibl: 0.45, stars: 0.12, sunSize: 18, disc: 0xffd8a8, glow: 0.8, lantern: 3, tentLamp: 1.5, fireI: 10, fog: 0xe6c2ae, fogFar: 650, fogH: 40, insc: 0.6, exposure: 1.0, waterMul: 0.8, cloudCover: 0.62, cloudLit: 0xffd8c0, cloudShade: 0x6a6a8a, mist: 0,
    grade: { tint: [1.0, 0.98, 1.02], sat: 0.95, con: 1.0, bloom: 0.28 } },
  afternoon: { key: 'afternoon', name: '화창한 오후', ic: ICON.afternoon, clock: 0.58, top: 0x2b6fd6, bottom: 0xd8edff, sunColor: 0xfff3dc, sunI: 3.6, amb: 0.9, hemi: 1.3, ibl: 0.6, stars: 0, sunSize: 10, disc: 0xfff9e0, glow: 0.35, lantern: 0, tentLamp: 0, fireI: 6, fog: 0xd8edff, fogFar: 950, fogH: 90, insc: 0.3, exposure: 0.92, waterMul: 1, cloudCover: 0.45, cloudLit: 0xffffff, cloudShade: 0x8a96a8, mist: 0,
    grade: { tint: [1, 1, 1], sat: 1.04, con: 1.0, bloom: 0.12 } },
  sunset: { key: 'sunset', name: '노을지는 저녁', ic: ICON.sunset, clock: 0.735, top: 0x2b2557, bottom: 0xff8c4c, sunColor: 0xffa25a, sunI: 3.4, amb: 0.5, hemi: 0.75, ibl: 0.5, stars: 0.3, sunSize: 24, disc: 0xffa040, glow: 1.1, lantern: 6, tentLamp: 3, fireI: 18, fog: 0xf7925e, fogFar: 880, fogH: 60, insc: 0.8, exposure: 1.0, waterMul: 0.75, cloudCover: 0.5, cloudLit: 0xffb08a, cloudShade: 0x5a4a6a, mist: 0,
    grade: { tint: [1.03, 0.99, 0.96], sat: 1.08, con: 1.02, bloom: 0.34 } },
  night: { key: 'night', name: '별이 빛나는 밤', ic: ICON.night, clock: 0.0, top: 0x030614, bottom: 0x18243b, sunColor: 0x93aaff, sunI: 1.0, amb: 0.18, hemi: 0.35, ibl: 0.3, stars: 1, sunSize: 8, disc: 0xf0f3ff, glow: 0.3, lantern: 14, tentLamp: 6, fireI: 28, fog: 0x0c1426, fogFar: 720, fogH: 70, insc: 0.3, exposure: 1.12, waterMul: 0.3, cloudCover: 0.35, cloudLit: 0x2a3550, cloudShade: 0x05070f, mist: 0,
    grade: { tint: [0.96, 0.98, 1.05], sat: 0.97, con: 1.02, bloom: 0.5 } },
};
export const KEYS = [[0.0, 'night'], [0.27, 'dawn'], [0.58, 'afternoon'], [0.735, 'sunset'], [0.86, 'night'], [1.0, 'night']];

export const ITEMS = {
  coffee: { name: '커피', ic: ICON.coffee, act: '한 모금', ds: '따뜻한 김이 천천히 올라온다' },
  whisky: { name: '위스키', ic: ICON.whisky, act: '한 잔', ds: '얼음이 잔에 부딪히는 소리' },
  smoke:  { name: '담배', ic: ICON.smoke, act: '한 모금', ds: '연기가 바람에 흩어진다' },
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
