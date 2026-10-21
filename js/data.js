/* ── 자체 제작 SVG 아이콘: 얇은 선, currentColor ── */
const svg = inner => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
export const ICON = {
  beach: svg('<path d="M3 15c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/><path d="M3 19c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/><path d="M8 11a4 4 0 0 1 8 0"/><path d="M12 4v1.5M6.3 6.5l1 1M17.7 6.5l-1 1"/>'),
  lake:  svg('<path d="M12 3l4 6h-2.5l3 4.5H14l3 4.5H7l3-4.5H8.5l3-4.5H9z"/><path d="M12 18v3"/><path d="M2.5 21c1.5-1 3-1 4.5 0"/><path d="M17 21c1.5-1 3-1 4.5 0"/>'),
  snow:  svg('<path d="M2 20L9 7l3 5 2-3 8 11z"/><path d="M6.8 11.2l1.1 1.3 1.1-1.5 1.1 1.5"/><path d="M14 9l1.2 1.4 1-1.4 1.2 1.4"/>'),
  dawn:      svg('<path d="M4 15h16"/><path d="M7.5 15a4.5 4.5 0 0 1 9 0"/><path d="M12 6v2M5.6 9.6l1.4 1.4M18.4 9.6l-1.4 1.4"/><path d="M6 19h5M13 19h5"/>'),
  afternoon: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
  sunset:    svg('<path d="M3 16h18"/><path d="M7 16a5 5 0 0 1 10 0"/><path d="M12 6v2M6 9l1.4 1.4M18 9l-1.4 1.4"/><path d="M9 20h6"/>'),
  night:     svg('<path d="M15.5 3.5a8 8 0 1 0 5 13.5 7 7 0 0 1-5-13.5z"/><path d="M6 4l.6 1.4L8 6l-1.4.6L6 8l-.6-1.4L4 6l1.4-.6z"/>'),
  coffee:   svg('<path d="M5 9h11v5a5 5 0 0 1-10 0z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M4 21h14"/><path d="M8.5 3.5c-.8 1 .8 2 0 3M11.5 3.5c-.8 1 .8 2 0 3"/>'),
  whisky:   svg('<path d="M6 4h12l-1 16H7z"/><path d="M6.8 12h10.4"/><path d="M9.5 14.5h3v3h-3z"/>'),
  smoke:    svg('<path d="M3 18l13-6 1.5 3.2-13 6z"/><path d="M13.6 13.8l1.5 3.2"/><path d="M17.5 8c-1 1 1 2 0 3M20 6c-1 1 1 2 0 3"/>'),
  sparkler: svg('<path d="M6 21l7-9"/><path d="M13 12l-4-2M13 12l4-2M13 12l-2-5M13 12l2-5M13 12l5 1M13 12l-5 1M13 12l1 6M13 12l4 4"/>'),
  /* 도끼: 거의 세로인 자루 위쪽 한편에 머리, 바깥으로 휘어 벌어진 날 (자루와 같은 축에 날이 붙으면 삽처럼 보인다) */
  axe:      svg('<path d="M10.6 2.8c-.3 6-1 12-2.2 18.4"/><path d="M9.4 4.2h5l4.2-2.2c1.6 3 1.6 6.2 0 9.2l-4.2-2.2h-5z"/>'),
  /* 낚싯대: 비스듬한 대, 늘어진 줄 끝의 찌, 손잡이 쪽 릴 */
  rod:      svg('<path d="M4 20L19 4"/><path d="M19 4c1.6 3.5 1.6 7.5.4 11"/><circle cx="19.4" cy="16.6" r="1.3"/><circle cx="7.2" cy="15.2" r="1.7"/>'),
  /* 마시멜로 꼬치: 비스듬한 꼬치 끝에 꿰인 둥근 마시멜로 */
  marsh:    svg('<path d="M3 21L20.3 3.7"/><rect x="13.4" y="4.5" width="6.4" height="5.8" rx="2" transform="rotate(-45 16.6 7.4)"/>'),
};

/* haze: 장소별 안개 배율. 시간대의 fogDen 에 곱한다 — 해변은 바다 습기로 조금 더, 설산은 맑은 고산 공기라 조금 덜
   호수 숲: 활엽수 420 · 덤불 240 (예전 260 · 90). 소나무 총 개수는 그대로 두고 vegetation.js 가 가까운 숲(10~50m)에 60% 를 모은다 */
export const BG = {
  beach: { key: 'beach', name: '바다가 보이는 모래사장', ic: ICON.beach, ground: 0xead9ad, rock: 0x8a7a66, amp: 0.7, mtAmp: 120, mtBase: 6, bloomMul: 0.45, haze: 1.3,
    water: { deep: 0x1c6d9c, shallow: 0x62c3d9, z: -9, size: 1200, wave: 1.0, wobble: 5 }, grass: { n: 2600, color: 0xbdaa6c, zmin: -4 }, palms: 16, bushes: 14, bushZmin: 6, rocks: 0, pines: 0, leafs: 0, birds: true, snow: false, fireflies: false, ambience: 'waves' },
  lake:  { key: 'lake', name: '호수가 보이는 숲속', ic: ICON.lake, ground: 0x4b8038, rock: 0x5c5a55, amp: 2.4, mtAmp: 300, mtBase: 25, bloomMul: 1.0, haze: 1.0,
    water: { deep: 0x173f52, shallow: 0x3c8a8c, z: -9, size: 600, wave: 0.28, wobble: 9 }, grass: { n: 9000, color: 0x58a03c, zmin: -8 }, palms: 0, bushes: 240, rocks: 14, pines: 1400, leafs: 420, birds: true, snow: false, fireflies: true, dock: true, ambience: 'forest' },
  snow:  { key: 'snow', name: '경치가 좋은 설산', ic: ICON.snow, ground: 0xf3f6fb, rock: 0x7d8792, amp: 6, mtAmp: 420, mtBase: 70, bloomMul: 0.35, haze: 0.7,
    water: null, grass: null, palms: 0, bushes: 0, rocks: 12, pines: 480, leafs: 0, birds: false, snow: true, fireflies: false, ambience: 'wind' },
};

/* 시간대 키프레임.
   fogDen: 지면 높이에서의 안개 밀도(1m 당). 거리 d 에서 대략 1 - exp(-fogDen·d) 만큼 흐려진다
           (0.0004 → 1km 에서 약 33%, 0.0035 → 300m 에서 약 65%). 예전엔 fogFar 에서 거꾸로 계산해 낮에도 300m 에서 절반이 뿌옇었다
   fogH: 안개가 위로 옅어지는 높이 스케일, insc: 해/달 쪽 산란 세기 */
export const TIME = {
  dawn: { key: 'dawn', name: '안개 낀 새벽', ic: ICON.dawn, clock: 0.27, top: 0x3a4f86, bottom: 0xf0b892, sunColor: 0xffd2a8, sunI: 2.4, amb: 0.5, hemi: 0.8, ibl: 0.45, stars: 0.12, sunSize: 18, disc: 0xffd8a8, glow: 0.8, lantern: 3, tentLamp: 1.5, fireI: 10, fog: 0xe6c2ae, fogDen: 0.0035, fogH: 40, insc: 0.6, exposure: 1.0, waterMul: 0.8, cloudCover: 0.62, cloudLit: 0xffd8c0, cloudShade: 0x6a6a8a,
    grade: { tint: [1.0, 0.98, 1.02], sat: 0.95, con: 1.0, bloom: 0.28 } },
  afternoon: { key: 'afternoon', name: '화창한 오후', ic: ICON.afternoon, clock: 0.58, top: 0x2b6fd6, bottom: 0xd8edff, sunColor: 0xfff3dc, sunI: 3.6, amb: 0.9, hemi: 1.3, ibl: 0.6, stars: 0, sunSize: 10, disc: 0xfff9e0, glow: 0.35, lantern: 0, tentLamp: 0, fireI: 6, fog: 0xd8edff, fogDen: 0.0004, fogH: 120, insc: 0.3, exposure: 0.92, waterMul: 1, cloudCover: 0.45, cloudLit: 0xffffff, cloudShade: 0x8a96a8,
    grade: { tint: [1, 1, 1], sat: 1.04, con: 1.0, bloom: 0.12 } },
  sunset: { key: 'sunset', name: '노을지는 저녁', ic: ICON.sunset, clock: 0.735, top: 0x2b2557, bottom: 0xff8c4c, sunColor: 0xffa25a, sunI: 3.4, amb: 0.5, hemi: 0.75, ibl: 0.5, stars: 0.3, sunSize: 24, disc: 0xffa040, glow: 1.1, lantern: 6, tentLamp: 3, fireI: 18, fog: 0xf7925e, fogDen: 0.0007, fogH: 80, insc: 0.8, exposure: 1.0, waterMul: 0.75, cloudCover: 0.5, cloudLit: 0xffb08a, cloudShade: 0x5a4a6a,
    grade: { tint: [1.03, 0.99, 0.96], sat: 1.08, con: 1.02, bloom: 0.34 } },
  night: { key: 'night', name: '별이 빛나는 밤', ic: ICON.night, clock: 0.0, top: 0x030614, bottom: 0x18243b, sunColor: 0x93aaff, sunI: 1.0, amb: 0.18, hemi: 0.35, ibl: 0.3, stars: 1, sunSize: 8, disc: 0xf0f3ff, glow: 0.3, lantern: 14, tentLamp: 6, fireI: 28, fog: 0x0c1426, fogDen: 0.0008, fogH: 80, insc: 0.3, exposure: 1.12, waterMul: 0.3, cloudCover: 0.35, cloudLit: 0x2a3550, cloudShade: 0x05070f,
    grade: { tint: [0.96, 0.98, 1.05], sat: 0.97, con: 1.02, bloom: 0.5 } },
};
/* 자정부터 4시 30분(0.19)까지는 밤을 유지하고, 그 뒤 해 뜨기 직전에 새벽으로 넘어간다.
   예전엔 0.0 → 0.27 을 바로 보간해서 새벽 3시에 이미 하늘이 절반쯤 밝았다 */
export const KEYS = [[0.0, 'night'], [0.19, 'night'], [0.27, 'dawn'], [0.58, 'afternoon'], [0.735, 'sunset'], [0.86, 'night'], [1.0, 'night']];

/* 트렁크 아이템. hold: 길게 누르면 계속 (마시는 것) / 아니면 클릭 한 번 */
export const ITEMS = {
  coffee:   { name: '커피', ic: ICON.coffee, act: '한 모금', hold: true, ds: '따뜻한 김이 천천히 올라온다' },
  whisky:   { name: '위스키', ic: ICON.whisky, act: '한 잔', hold: true, ds: '얼음이 잔에 살짝 부딪힌다' },
  smoke:    { name: '담배', ic: ICON.smoke, act: '한 모금', hold: true, ds: '연기가 바람에 흩어진다' },
  sparkler: { name: '스파클라', ic: ICON.sparkler, act: '불붙이기', hold: false, ds: '어둠 속에서 불티가 사방으로 튄다' },
  /* trunk: false — 트렁크 목록에 나오지 않는다 (아이스박스에서 꺼낸다) */
  marsh:    { name: '마시멜로 꼬치', ic: ICON.marsh, act: '먹기', hold: true, ds: '모닥불에 노릇하게 굽는다', trunk: false },
};

/* 캠핑 메모(조수석 담요 위의 줄노트)에 적힌 할 일
   key: 읽음 기록(state.js 의 records.memoRead)에 남는 이름표 — 한 번 정하면 바꾸지 않는다
   only: 이 장소에서만 메모에 적힌다 (없으면 모든 장소)
   새 콘텐츠를 넣을 때 여기에 한 줄 더하면, 그 장소 메모에 안 읽은 줄이 생겨 "조수석 메모를 보자" 안내가 다시 뜬다 */
export const MEMO = [
  { key: 'trunk', text: '차 트렁크를 열어 짐 꺼내기' },
  { key: 'chop',  text: '모닥불 옆 장작 패기' },
  { key: 'fire',  text: '모닥불 피우기' },
  { key: 'marsh', text: '아이스박스에서 마시멜로 꺼내 구워 먹기' },
  { key: 'chair', text: '의자에 앉아 한숨 돌리기' },
  { key: 'fish',  text: '부두 끝에서 낚시하기', only: ['lake'] },
  { key: 'snowman', text: '눈덩이를 굴려 눈사람 만들기', only: ['snow'] },
  { key: 'stars', text: '바닷가 돗자리에 누워 별 보기', only: ['beach'] },
  { key: 'sleep', text: '텐트 안 침낭에서 하룻밤 자기' },
];
/* 이 장소의 메모에 적힐 줄 */
export const memoFor = bg => MEMO.filter(m => !m.only || m.only.includes(bg));

/* 눈사람 만들기 (설산 전용, snowman.js)
   start: 처음 뭉친 반지름 · min: 눈사람이 되는 최소 반지름 · max: 최대 반지름(머리·몸통 같다)
   grow: 커지는 빠르기 — 반지름² 이 굴러간 거리 × 2·grow 만큼 늘어난다 (0.18m 약 3m, 0.45m 약 25m)
   near: 두 눈덩이 사이가 이 안이면 "눈사람 만들기" · slow: 최대 크기일 때 걷는 속도 배율
   maxBalls·maxMen: 바닥 눈덩이·눈사람 최대 개수 · trackLife: 굴린 자국이 사라지는 시간(초) · range: 캠프에서 굴릴 수 있는 거리(m) */
export const SNOW = { start: 0.08, min: 0.18, max: 0.45, grow: 0.0039, near: 0.35, slow: 0.3, maxBalls: 6, maxMen: 3, trackLife: 30, range: 45 };

/* 마시멜로 굽기
   fire: 꼬치 끝이 닿을 불꽃 자리 — 모닥불 가운데 x·z(scene.js 의 모닥불 위치)와 불꽃 높이 y
   near: 모닥불 가운데까지 수평 거리가 이 안이어야 굽는다 (m). 모닥불 충돌 때문에 가장 가까이 서도 약 1.05m
   aim: 시선과 불꽃 자리 사이 각도가 이보다 작으면 "불을 바라본다" (rad)
   at: 익음 단계가 바뀌는 시각(불에 댄 초) — 덜 익음 < 4 ≤ 잘 익음 < 8 ≤ 완벽 < 11 ≤ 탐. 11초를 넘겨 불에 대고 있으면 불이 붙는다
   eat: 단계별로 먹었을 때의 소식 */
export const ROAST = {
  fire: [0.3, 0.72, -1.4], near: 1.55, aim: 0.6, at: [4, 8, 11],
  eat: ['아직 속은 차갑다', '달달한 맛이 느껴진다', '겉은 바삭하고 속은 촉촉하다', '쓴맛이 느껴진다'],
};
export const roastStage = c => c < ROAST.at[0] ? 0 : c < ROAST.at[1] ? 1 : c < ROAST.at[2] ? 2 : 3;

/* 해변 돗자리·파라솔 (beach.js). 호수의 부두처럼 캠프 오른쪽 앞, 해안선(z −9)에서 2.5m 떨어진 자리
   mat: 가운데·크기 (w 가로, l 길이 — 길이 방향 z, 발 = 바다 쪽)
   parasol: 기둥 자리 · tilt [x, z] 기울기(바다 쪽, 돗자리 쪽) · yaw 돌린 각
   head: 누운 머리 자리 · eye: 누운 눈높이(지면 위) · lie: 누울 때 올려다보는 각도
   look: 누운 동안 시선 [좌우, 아래, 위] (rad) · lantern: 머리맡 랜턴 자리 */
export const BEACH = {
  mat: { x: 5.5, z: -5.5, w: 1.3, l: 1.9 }, parasol: { x: 6.2, z: -4.9, tilt: [-0.12, 0.1], yaw: 0.2 },
  head: [5.5, -4.8], eye: 0.32, lie: 0.9, look: [1.75, -0.1, 1.3], lantern: [4.72, -4.65],
};

/* 부두 끝 자리는 dock.js 의 DOCK(끝 z −19.2, 윗면 0.36)에 맞춘다: 끝 판자 가장자리에 걸터앉은 눈높이 */
export const SEAT = {
  car:   { pos: [-0.45, 1.28, 8.15], stand: [-2.1, 8.2], name: '운전석', up: '차에서 내리기' },
  chair: { pos: [1.5, 1.05, 0.95], stand: [1.5, -0.1], name: '의자', up: '일어나기' },
  tent:  { pos: [-1.6, 0.72, 1.85], stand: [-1.6, -1.3], name: '텐트 안', up: '텐트에서 나가기' },
  bed:   { pos: [-1.1, 0.45, 1.95], yaw: Math.PI, pitch: 1.15, stand: [-1.6, -1.3], name: '침낭', up: '일어나기' },
  dock:  { pos: [5.7, 1.12, -18.95], stand: [5.7, -17.8], name: '부두 끝', up: '일어나기' },
  /* 해변 돗자리: pos 는 beach.js 가 땅 높이에 맞춰 채운다 */
  mat:   { pos: [5.5, 0.4, -4.8], stand: [4.6, -5.3], name: '돗자리', up: '일어나기' },
};
/* ── 걷기 충돌 ──
   규칙: 모양은 보이는 바닥 윤곽에 약 3cm 를 더한 것, 둥근 물건은 원(circle).
   플레이어는 몸 반지름 PR(0.35m)만큼 떨어져 멈추고 네모의 모서리는 둥글게 돌아 나간다(game.js blockedAt)
   → 어떤 사물이든 보이는 표면에서 약 0.4m 앞에 선다.
   원도 x·z 범위로 적어 두어 풀 배치(vegetation.js)는 지금처럼 네모로 읽는다.
   부두 소품처럼 한 맵에만 있는 것은 scene.js 가 W.trees 에 원으로 넣는다 */
const circle = (cx, cz, r) => ({ x: [cx - r, cx + r], z: [cz - r, cz + r], round: true });
export const BLOCKS = [
  /* 자동차: 차체·범퍼 (바퀴는 옆으로 1.13m 까지 나오지만 서 있는 눈높이에서는 닿지 않는다) */
  { x: [-0.98, 0.98], z: [5.52, 10.5] },
  /* 텐트: 플라이 양옆 + 뒤 플라이 끝. 앞은 문(z −0.13)에서 약 0.4m 앞에 서도록 */
  { x: [-2.95, -0.25], z: [-0.18, 2.73] },
  /* 의자(등받이 꼭대기까지) · 테이블 · 아이스박스(돌려 놓은 모양 그대로) · 장작더미 */
  { x: [1.15, 1.85], z: [0.5, 1.22] }, { x: [0.26, 0.94], z: [0.18, 0.82] },
  { x: [2.12, 2.68], z: [0.24, 0.96] }, { x: [1.43, 2.27], z: [-2.97, -2.13] },
  /* 둥근 것: 모닥불(돌 둘레·삼각대 다리) · 그루터기 · 박힌 도끼 자루(무릎 높이) · 배낭(머그·물병 포함) */
  circle(0.3, -1.4, 0.7), circle(2.55, -1.95, 0.22), circle(2.9, -1.95, 0.2), circle(3.05, 0.15, 0.32),
  /* 텐트 말뚝 네 개 (줄은 통과한다) */
  circle(0.35, -0.55, 0.06), circle(-3.55, -0.55, 0.06), circle(0.35, 2.95, 0.06), circle(-3.55, 2.95, 0.06),
];
export const EYE = 1.6, PR = 0.35;
/* 텐트에서 자고 일어나는 시각 (아침 7시) */
export const WAKE = 7 / 24;
/* 장작 패기: 그루터기 위치, 서는 거리(그루터기에서 플레이어 쪽으로 1.2m — 방향은 E 를 누른 자리에서 정한다),
   다음 장작을 집어 오는 장작더미, 내려다보는 각도, 시선 허용 범위(좌우·상하 rad) */
export const CHOP = { stump: [2.55, -1.95], dist: 1.2, pile: [1.85, -2.55], pitch: -0.64, look: [0.32, 0.22] };
/* 장작 패기 게이지: 삼각형 속도(초당 막대 비율), 성공·대성공 구간 폭, 쪼개는 데 필요한 성공 횟수 */
export const CHOP_GAUGE = { speed: 1.15, ok: 0.34, great: 0.08, hits: 3 };
/* 부두 낚시
   biteWin: 입질 후 챔질 가능 시간(초) · wait: 던진 뒤 입질까지(초) · nibbles: 헛입질 횟수 범위
   cast: 던지는 거리(m) — 시선이 낮으면 가까이, 수평선 근처면 멀리
   yaw: 물 쪽(정면 −z)에서 좌우로 돌아볼 수 있는 각도 · pitch: 내려볼 수 있는 한계(낚싯대가 물·부두에 닿지 않게)와 올려볼 수 있는 한계
   fails: 이만큼 실패하면 줄이 풀려 도망간다 */
export const FISHING = { biteWin: 2.0, wait: [3, 7], nibbles: [1, 3], cast: [6, 18], yaw: Math.PI / 2, pitch: [-0.35, 1.3], fails: 3 };

/* 캠핑 장비 색: 차와 텐트가 같은 이름의 색을 공유한다.
   car 는 도장이라 조금 깊고 차분하게, tent 는 천이라 조금 밝고 부드럽게. 메뉴 견본도 줄마다 각자의 값을 쓴다
   (화이트는 설산의 눈에 묻혀 빠졌다 — 다시 넣으려면 이 목록에 한 줄만 추가하면 된다) */
export const GEAR = [
  { key: 'burgundy', name: '버건디', car: 0x8f2b28, tent: 0x9a3a36 },
  { key: 'orange',   name: '오렌지', car: 0xc8642a, tent: 0xe0783a },
  { key: 'forest',   name: '포레스트', car: 0x34503f, tent: 0x56704a },
  { key: 'sky',      name: '스카이', car: 0x8fb3cc, tent: 0x7fa9c8 },
  { key: 'navy',     name: '네이비', car: 0x26384f, tent: 0x34496a },
  { key: 'black',    name: '블랙', car: 0x1c1d20, tent: 0x2a2b2d },
];
/* 처음 시작할 때의 색 (저장된 값이 목록에 없을 때도 이 값으로 돌아간다) */
export const GEAR_DEFAULT = { car: 'burgundy', tent: 'orange' };