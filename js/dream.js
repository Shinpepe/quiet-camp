import * as THREE from 'three';
import { ctx, state, records, saveSettings, session } from './state.js';
import { DREAM } from './data.js';
import { rnd, clamp, softTex, canvasTex, isTouch } from './util.js';
import { terrainH } from './terrain.js';
import { paramsAt } from './time.js';
import { applyTime, rebakeEnv } from './scene.js';
import { sfx, setDream } from './audio.js';
import { showCard, hideCard } from './gauge.js';
import { roadYaw } from './road.js';
/* game.js 도 이 파일을 불러오지만, 서로 실행 중에만 부르므로 순환해도 괜찮다 (snowman.js 와 같은 방식) */
import { updateHUD, startSleep } from './game.js';

/* ══ 꿈: 운석 막기 ══
   텐트에서 잠들 때 꿈을 꾸면(game.js 의 updateSleep → pickDream), 시계가 0:00 에 멈춘 채 보랏빛 밤에 깨어난다.
   단계: 'off'(꿈이 아님) → 'idle'(깨어남, 트렁크 안내) → 'shoot'(총을 들고 운석 막기) → 'end'(점수 카드) 또는 'night'(악몽) → 'wake'(깨어나는 중)
   트렁크를 열면 game.js 가 총을 쥐여 주고, 길이 뻗어 나가는 쪽 하늘(road.js roadYaw)로 돌아서 올려다본 뒤 beginShoot 를 부른다.
   운석은 정면 하늘에서 캠프 앞 땅(DREAM.land — 기준 자리에서 9~30m)으로 비스듬히 떨어진다.
     떨어질 땅에는 붉은 고리가 생기고, 운석이 내려올수록 진해지며 좁혀진다 (땅 높낮이를 따라 붙는다).
   막지 못한 운석은 땅에 부딪혀 터진다: 번쩍임 · 불기둥 · 땅을 따라 퍼지는 충격파 · 위로 솟는 불티 · 흙먼지 · 그을린 자국과 불씨 · 주변을 비추는 불빛
     · 화면 흔들림(가까울수록 크게, dreamCamera) · 쿵 소리(멀수록 작고, 소리 빠르기만큼 늦게, 떨어진 쪽에서).
   부딪힐 때마다 캠프가 버티는 횟수(DREAM.hp)가 하나 줄고 화면 가장자리가 붉게 번쩍인다.
   다 줄면 악몽에서 깬다('night'): 하얗게 번쩍인 뒤 잠자기 화면을 거쳐 아침에 깨고 "악몽을 꾸었다" 소식이 뜬다 (game.js 가 takeNightmare 로 묻는다).
     막아 낸 운석 기록은 그대로 남는다.
   판정은 시선과 운석 사이의 각도 (currentTarget 과 같은 방식). 맞히면 번쩍 + 불티.
   DREAM.dur 초를 버티면 점수 카드를 띄우고 game.js 의 startSleep(true) 로 깨어난다.
   침낭에 다시 눕거나(startSleep) 메뉴로 나가면(resetDream) 언제든 꿈이 풀린다

   ── 멀티 ──
   함께 잠들 때 방장이 꿈 여부를 정한다 (net.js hostNap). 모두 각자 자기 침낭에서 꿈속 밤에 깨어난다.
   단계에 'ready'(총을 들고 다른 사람을 기다리는 중)가 더해진다. 방장은 자리 비움이 아닌 사람이 모두 총을 들거나,
   첫 사람이 총을 든 지 30초가 지나면 운석 막기를 시작한다 (net.js hostGuns → dreamGo). live = 시작했는지.
   늦게 총을 든 사람은 남은 시간만큼 함께한다.
   운석은 방장만 띄우고(모두 같은 기준 자리 ANCHOR 의 정면 하늘, 떨어질 자리까지) 모두에게 보낸다.
   쏘아 맞히면 내 화면은 바로 번쩍이고, 방장이 먼저 도착한 쪽을 점수로 인정해 모두에게 알린다 (kill).
   부딪히는 모습은 각자 화면에서 그리고, 캠프가 버티는 횟수는 방장이 세어 모두에게 알린다 (hp, 방장 시계에도 실린다). 0 이 되면 모두 악몽에서 깬다.
   남은 시간은 방장 시계를 따른다 (net.js world 의 dm → dreamSync).
   시간을 다 버티면 방장이 순위표를 보내고, 모두 같은 카드(함께 막은 운석·각자 순위)를 본 뒤 각자 깨어난다.
   함께 막은 운석 최고 기록은 records.dreamTeamBest (1인 기록 dreamBest 는 그대로).
   꿈속에서는 혼자 깰 수 없다 (game.js startSleep). 방장이 꿈에서 나가 있으면(dm 없음) 친구도 깨어난다.
   방장과 이어 주는 것(보내기·내 id·이름·총 든 사람 수)은 net.js 가 dreamNet 에 채운다 */

const V3 = THREE.Vector3;
/* 멀티 꿈의 기준 자리: 트렁크 뒤에 선 사람의 눈. 모두의 하늘에 같은 운석이 떨어지도록 여기서 정면을 잡는다 */
const ANCHOR = new V3(0, 1.6, 11.3);
/* 멀티 결과 카드는 순위를 읽을 시간만큼 조금 더 띄워 둔다 (초) */
const MULTI_CARD = 3;
/* 부딪힌 자리를 비추는 불빛의 처음 세기 · 떨어질 자리 고리의 반지름(m) · 그을린 자국 반지름 범위(m) */
const BLAST_LIGHT = 600, MARK_R = 7, SCORCH_R = [2.2, 3];
const D = { on: false, phase: 'off', t: 0, left: 0, score: 0, spawnT: 0, cool: 0, kick: 0, lastSec: -1, yaw0: 0,
  multi: false, live: false, scores: {}, names: {}, nextId: 0, hp: 0, trauma: 0, shT: 0, clock: 0, lightT: 9, sc: 0 };
let pool = [], flashes = [], blasts = [], rings = [], scorches = [], tracer = null, light = null, nightmareAt = -1e9, fxEl = null;
const _f = new V3(), _v = new V3(), _a = new V3(), _b = new V3(), _t = new V3(), _p = new V3(), _x = new V3(), _y = new V3(), _z = new V3(), _m = new THREE.Matrix4();
const r3 = v => Math.round(v * 1000) / 1000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* 흔들림: 여러 주파수 사인 합 (chop.js 와 같은 식) */
const nz = (t, s) => Math.sin(t * 43.1 + s * 7.3) * 0.5 + Math.sin(t * 71.7 + s * 3.1) * 0.3 + Math.sin(t * 97.3 + s * 11.9) * 0.2;

/* net.js 가 채운다 (1인에서는 쓰지 않는다) */
export const dreamNet = { host: () => false, self: () => null, send: null, claim: null, names: () => ({}), guns: () => ({ n: 0, of: 0 }) };

/* 운석 꼬리: 왼쪽(뒤)은 투명, 오른쪽(머리 쪽)으로 밝아지는 띠 */
const streakTex = canvasTex(128, 16, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const v = g.createLinearGradient(0, 0, 0, h); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = v; g.fillRect(0, 0, w, h);
});
/* 그을린 자국: 가운데가 가장 검고 바깥으로 옅어진다. 사방으로 갈라진 금 */
const scorchTex = canvasTex(128, 128, g => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(6,3,8,.95)'); r.addColorStop(0.5, 'rgba(12,7,14,.85)'); r.addColorStop(1, 'rgba(12,7,14,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 2;
  for (let i = 0; i < 10; i++) { let a = Math.random() * 6.28, x = 64, y = 64; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { a += (Math.random() - 0.5) * 0.7; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); } g.stroke(); }
});
/* 그을린 자국 위의 달아오른 빛: 가운데가 밝은 주황, 바깥으로 붉게 사라진다 */
const glowTex = canvasTex(128, 128, g => {
  const r = g.createRadialGradient(64, 64, 6, 64, 64, 64); r.addColorStop(0, 'rgba(255,170,90,.9)'); r.addColorStop(0.3, 'rgba(255,120,50,.6)'); r.addColorStop(0.6, 'rgba(255,80,30,.25)'); r.addColorStop(1, 'rgba(255,60,20,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
glowTex.colorSpace = THREE.SRGBColorSpace;
const glowMat = c => new THREE.SpriteMaterial({ map: softTex, color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
/* 떨어질 자리 고리: uK = 지금 반지름 / MARK_R (1 → 0.5 로 좁혀진다), uOp = 진하기. 바깥 고리 + 점선 안쪽 고리 + 옅은 속 */
function markMat() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: { uK: { value: 1 }, uOp: { value: 0 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform float uK,uOp;varying vec2 vUv;
      void main(){vec2 p=(vUv-0.5)*2.0;float d=length(p)/uK;if(d>1.0)discard;
        float ring=smoothstep(0.84,0.9,d)*(1.0-smoothstep(0.95,1.0,d));
        float dash=step(0.5,fract(atan(p.y,p.x)*1.5915))*smoothstep(0.58,0.62,d)*(1.0-smoothstep(0.64,0.68,d));
        float a=(ring+dash*0.7+(1.0-d)*0.35)*uOp;
        gl_FragColor=vec4(vec3(1.0,0.36,0.28)*a,a);}`,
  });
}
/* 땅에 붙이는 판: 12×12 격자. fitGround 가 정점을 땅 높이에 맞춘다 (h = 땅에서 띄우는 높이, a = 돌린 각) */
const GN = 12;
function groundGeo() { const g = new THREE.PlaneGeometry(1, 1, GN, GN); g.rotateX(-Math.PI / 2); g.userData.base = g.attributes.position.array.slice(); return g; }
function fitGround(g, x, z, r, a, h) {
  const b = g.userData.base, p = g.attributes.position, c = Math.cos(a), s = Math.sin(a), cfg = ctx.W.cfg;
  for (let i = 0; i < p.count; i++) {
    const lx = b[i * 3] * 2 * r, lz = b[i * 3 + 2] * 2 * r, rx = lx * c - lz * s, rz = lx * s + lz * c;
    p.setXYZ(i, rx, terrainH(x + rx, z + rz, cfg) + h, rz);
  }
  p.needsUpdate = true; g.computeBoundingSphere();
}

/* ── 씬마다 한 번: 운석·떨어질 자리 고리·번쩍임·충격파·그을린 자국·불빛·탄도선을 만들어 숨겨 둔다 (사전 컴파일에 함께 들어간다).
   불빛은 개수가 고정이라 꿈속에서 켜고 꺼도 재컴파일이 없다 ── */
export function buildDream() {
  Object.assign(D, { on: false, phase: 'off', score: 0, kick: 0, multi: false, live: false, scores: {}, names: {}, hp: DREAM.hp, trauma: 0, lightT: 9, sc: 0 });
  const scene = ctx.scene; pool = []; flashes = []; blasts = []; rings = []; scorches = [];
  const hide = o => { o.visible = false; o.userData.noAO = true; scene.add(o); return o; };
  for (let i = 0; i < DREAM.pool; i++) {
    const head = new THREE.Group(), glow = new THREE.Sprite(glowMat(0xff9a4a)), core = new THREE.Sprite(glowMat(0xfff4d8));
    glow.scale.setScalar(DREAM.size * 4); core.scale.setScalar(DREAM.size * 1.4); head.add(glow, core);
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: streakTex, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    trail.frustumCulled = false; [glow, core].forEach(o => { o.userData.noAO = true; });
    hide(head); hide(trail);
    const mark = hide(new THREE.Mesh(groundGeo(), markMat())); mark.renderOrder = 2;
    pool.push({ head, glow, core, trail, mark, pos: new V3(), dir: new V3(), tgt: new V3(), gy: 0, speed: 0, live: false, dying: false, fade: 1, id: -1, wh: false });
  }
  for (let i = 0; i < 6; i++) flashes.push({ s: hide(new THREE.Sprite(glowMat(0xffe2a8))), t: 9 });
  /* 부딪힌 순간: 둥근 번쩍임 + 위로 솟는 불기둥 (바닥 기준으로 커진다) */
  for (let i = 0; i < 4; i++) { const s = hide(new THREE.Sprite(glowMat(0xffe2b0))), c = hide(new THREE.Sprite(glowMat(0xff9a50))); c.center.set(0.5, 0); blasts.push({ s, c, t: 9 }); }
  const rg = new THREE.RingGeometry(0.85, 1, 64); rg.rotateX(-Math.PI / 2);
  for (let i = 0; i < 4; i++) rings.push({ m: hide(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffd2a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }))), t: 9 });
  for (let i = 0; i < 8; i++) {
    const g = groundGeo();
    const base = hide(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    const glow = hide(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
    scorches.push({ base, glow, t: 99, x: 0, y: 0, z: 0, r: 2.5 });
  }
  light = new THREE.PointLight(0xff8a40, 0, 60, 2); scene.add(light);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  tracer = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  tracer.frustumCulled = false; tracer.userData.t = 9; hide(tracer);
}

/* ── game.js·scene.js·main.js·net.js 가 부르는 것 ── */
export const dreamOn = () => D.on;
export const dreamCenter = () => D.yaw0;
/* 안내 줄: 트렁크로 가자 / 총을 든 사람 (2/3) */
export const dreamGuide = () => {
  if (D.phase === 'idle') return D.live ? '운석이 떨어진다. 트렁크로 가자' : '차 트렁크를 확인해 보자';
  if (D.phase === 'ready') { const g = dreamNet.guns(); return `총을 든 사람 (${g.n}/${g.of})`; }
  return null;
};
/* 처음 잠들 때는 반드시, 그 뒤로는 DREAM.chance (1인. 멀티는 net.js 의 방장이 정한다) */
export const pickDream = () => records.dreams === 0 || Math.random() < DREAM.chance;
/* 캠프가 버티는 횟수: 남은 만큼 ◆, 줄어든 만큼 ◇ (\uFE0E 는 기기가 이모지로 바꾸지 않게 하는 표시) */
const pips = () => '◆\uFE0E'.repeat(Math.max(0, D.hp)) + '◇\uFE0E'.repeat(Math.max(0, DREAM.hp - D.hp));
/* HUD 아이템 상자 [이름 아래 줄, 안내 줄] */
export function dreamHint(btn) {
  if (D.phase === 'shoot') return [`막아 낸 운석 ${D.score} / 캠프 ${pips()}`, `${btn} 쏘기 / 남은 시간 ${Math.ceil(D.left)}초`];
  if (D.phase === 'ready') return [`캠프 ${pips()}`, '모두 총을 들면 시작한다'];
  if (D.phase === 'end') return [`막아 낸 운석 ${D.score}`, '꿈이 흐려진다'];
  if (D.phase === 'night') return [`막아 낸 운석 ${D.score}`, '꿈이 무너진다'];
  return ['', ''];
}
/* net.js: 방장이 "시작"을 정할 때 · 친구의 안내 줄 숫자를 새로 쓸 때 · 방장 시계에 실어 보낼 때 */
export const dreamWaiting = () => D.on && D.multi && !D.live && (D.phase === 'idle' || D.phase === 'ready');
export const dreamReady = () => D.on && D.phase === 'ready';
export const dreamStatus = () => D.on && D.multi ? { live: D.live ? 1 : 0, left: Math.round(D.left * 10) / 10, hp: D.hp } : null;
/* game.js: 방금 악몽에서 깼는지 (깨어난 소식을 "악몽을 꾸었다"로). 한 번 물으면 지워진다 */
export function takeNightmare() { const n = performance.now() - nightmareAt < 20000; nightmareAt = -1e9; return n; }

/* 꿈속의 하늘: paramsAt 이 매 프레임 새로 채운 값을 덮어쓴다 (main.js) */
export function tintDream(tm) {
  if (!D.on) return;
  tm.top.setHex(0x140c33); tm.bottom.setHex(0x3d2363); tm.fog.setHex(0x1d1440); tm.sunColor.setHex(0xb59aff); tm.disc.setHex(0xf4e6ff);
  tm.cloudLit.setHex(0x7a5aa8); tm.cloudShade.setHex(0x0b0716); tm.cloudCover = 0.3;
  tm.stars = 1; tm.exposure = 1.18; tm.fogDen = 0.0012;
  const g = tm.grade; g.tint[0] = 1.05; g.tint[1] = 0.95; g.tint[2] = 1.1; g.sat = 1.15; g.bloom = 0.75;
}

/* 꿈에 들어간다 (잠자기 화면이 검은 동안 game.js 가 부른다). 하늘과 주변광을 바로 꿈 색으로 맞춘다.
   멀티는 모두 같은 정면(기준 자리에서 길이 뻗어 나가는 쪽)을 쓴다 */
export function startDream() {
  const multi = session.mode !== 'solo';
  Object.assign(D, { on: true, phase: 'idle', t: 0, left: DREAM.dur, score: 0, kick: 0, cool: 0, lastSec: -1, multi, live: false, scores: {}, names: {}, nextId: 0, hp: DREAM.hp, trauma: 0 });
  if (multi) D.yaw0 = roadYaw(ANCHOR.x, ANCHOR.z);
  nightmareAt = -1e9;
  records.dreams++; saveSettings(); setDream(true);
  const W = ctx.W; paramsAt(state.clock, W.tm); tintDream(W.tm); applyTime(); rebakeEnv();
}
/* 총을 쥐었다: yaw0 = 바라보는 정면 (시선 제한·운석이 떨어지는 방향의 기준).
   멀티는 시작 전이면 기다리고(ready), 이미 시작했으면 남은 시간만큼 바로 함께한다 */
export function beginShoot(yaw0) {
  if (!D.on) return;
  if (!D.multi) { Object.assign(D, { phase: 'shoot', t: 0, left: DREAM.dur, spawnT: 1.5, cool: 0, lastSec: -1, yaw0 }); return; }
  D.cool = 0; D.phase = D.live ? 'shoot' : 'ready';
}
/* 멀티: 운석 막기가 시작됐다 (left = 남은 초) */
function goLive(left) {
  D.live = true; D.left = left; D.t = DREAM.dur - left; D.spawnT = 1.5; D.lastSec = -1;
  if (D.phase === 'ready') D.phase = 'shoot';
  updateHUD();
}
/* 방장: 시작한다 (net.js hostGuns). 이때 캠핑장에 있던 사람들의 이름을 기억해 둔다 (도중에 나가도 순위에 남게) */
export function dreamGo() {
  if (!D.on || !D.multi || D.live) return;
  D.names = Object.assign({}, dreamNet.names());
  goLive(DREAM.dur);
  if (dreamNet.send) dreamNet.send({ op: 'go', left: DREAM.dur });
}
/* 꿈을 끝낸다: 깨어날 때(game.js)와 메뉴로 나갈 때 */
export function endDream() {
  if (!D.on) return;
  D.on = false; D.phase = 'off'; D.multi = false; D.live = false; D.scores = {}; D.names = {}; D.trauma = 0;
  pool.forEach(kill); flashes.forEach(f => { f.t = 9; f.s.visible = false; }); if (tracer) tracer.visible = false;
  blasts.forEach(b => { b.t = 9; b.s.visible = b.c.visible = false; }); rings.forEach(r => { r.t = 9; r.m.visible = false; });
  scorches.forEach(s => { s.t = 99; s.base.visible = s.glow.visible = false; }); if (light) light.intensity = 0; D.lightT = 9;
  hideCard(); setDream(false);
}
export const resetDream = endDream;

/* 쏘기: 시선에서 허용 각도 안에 있는 운석 중 가장 가까운 것을 맞힌다.
   멀티: 방장은 바로 판정하고, 친구는 내 화면에서 먼저 번쩍인 뒤 방장에게 "맞혔다"를 보낸다 */
export function dreamShoot() {
  if (D.phase !== 'shoot' || D.cool > 0 || !ctx.W.item) return;
  D.cool = DREAM.cool; D.kick = 1; sfx('gunShot');
  const cam = ctx.camera; cam.getWorldDirection(_f);
  const tol = DREAM.aim[isTouch ? 1 : 0]; let best = null, bs = Infinity;
  for (const m of pool) {
    if (!m.live || m.dying) continue;
    _v.subVectors(m.pos, cam.position); const d = _v.length();
    const s = Math.acos(clamp(_v.dot(_f) / d, -1, 1)) - Math.atan(DREAM.size * 1.5 / d);
    if (s < tol && s < bs) { bs = s; best = m; }
  }
  ctx.W.item.userData.emitter.getWorldPosition(_a);
  tracerTo(_a, best ? best.pos : _b.copy(cam.position).addScaledVector(_f, 160));
  if (!best) return;
  if (!D.multi) { hit(best); return; }
  if (dreamNet.host()) judge(best.id, dreamNet.self());
  else { hitFx(best, true); if (dreamNet.claim) dreamNet.claim({ op: 'hit', id: best.id }); }
}
function tracerTo(a, b) {
  const p = tracer.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
  tracer.userData.t = 0; tracer.visible = true;
}
/* 번쩍 + 불티 + 운석 지우기. mine = 내가 맞힌 것 (소리·진동) */
function hitFx(m, mine) {
  const W = ctx.W;
  const f = flashes.find(o => o.t >= 0.4) || flashes[0]; f.t = 0; f.s.position.copy(m.pos); f.s.visible = true;
  for (let i = 0; i < 28; i++) W.sparks.spawn(m.pos, rnd(18, 40), rnd(0.35, 0.8));
  kill(m);
  if (mine) { sfx('meteorHit'); if (navigator.vibrate) navigator.vibrate(15); }
}
/* 1인: 맞힌 만큼 내 점수 */
function hit(m) { D.score++; hitFx(m, true); updateHUD(); }
/* 방장의 판정: 아직 살아 있는 운석이면 who 의 점수로 인정하고 모두에게 알린다. 이미 누가 맞혔거나 사라졌으면 넘어간다 */
function judge(id, who) {
  const m = pool.find(o => o.live && o.id === id); if (!m) return;
  const n = (D.scores[who] || 0) + 1; D.scores[who] = n;
  const mine = who === dreamNet.self();
  hitFx(m, mine);
  if (mine) { D.score = n; updateHUD(); }
  if (dreamNet.send) dreamNet.send({ op: 'kill', id, who, n });
}
/* net.js: 친구의 "맞혔다" (방장 쪽) */
export function dreamClaim(id, who) { if (D.on && D.multi && D.live && D.phase !== 'end' && D.phase !== 'night' && typeof id === 'number') judge(id, who); }
function kill(m) { m.live = false; m.head.visible = m.trail.visible = m.mark.visible = false; }

/* 운석 하나: 정면 하늘(좌우 DREAM.spread) 80~115m 앞 60~85m 높이에서, 기준 자리 앞 DREAM.land 의 땅을 향해 떨어진다.
   기준 자리는 1인이면 내 눈, 멀티면 ANCHOR (방장만 띄우고, 떨어질 자리까지 같은 값을 모두에게 보낸다) */
function spawn(k) {
  const m = pool.find(o => !o.live); if (!m) return;
  const c = D.multi ? ANCHOR : ctx.camera.position, th = D.yaw0 + rnd(-DREAM.spread, DREAM.spread);
  const fx = -Math.sin(th), fz = -Math.cos(th), sx = -fz, sz = fx, dist = rnd(80, 115), side = rnd(-25, 25);
  m.pos.set(c.x + fx * dist + sx * side, rnd(60, 85), c.z + fz * dist + sz * side);
  const td = rnd(DREAM.land[0], DREAM.land[1]), ts = side * 0.25 + rnd(-6, 6), tx = c.x + fx * td + sx * ts, tz = c.z + fz * td + sz * ts;
  aim(m, tx, tz, rnd(DREAM.speed[0], DREAM.speed[1]) * (1 + 0.5 * k));
  m.id = D.nextId++;
  if (D.multi && dreamNet.send) dreamNet.send({ op: 'm', id: m.id, p: [r3(m.pos.x), r3(m.pos.y), r3(m.pos.z)], t: [r3(tx), r3(tz)], s: r3(m.speed) });
}
/* 떨어질 자리(tx, tz)를 향해 날린다. 그 자리 땅에 고리를 깐다 */
function aim(m, tx, tz, speed) {
  m.gy = terrainH(tx, tz, ctx.W.cfg); m.tgt.set(tx, m.gy, tz);
  m.dir.subVectors(m.tgt, m.pos).normalize(); m.speed = speed;
  m.live = true; m.dying = false; m.fade = 1; m.wh = false; m.head.visible = m.trail.visible = true;
  fitGround(m.mark.geometry, tx, tz, MARK_R, rnd(0, 6.3), 0.08); m.mark.position.set(tx, 0, tz);
  m.mark.material.uniforms.uOp.value = 0; m.mark.visible = true;
}
/* 친구: 방장이 띄운 운석을 같은 자리에서, 같은 자리로 떨어뜨린다 */
function spawnAt(d) {
  if (typeof d.id !== 'number' || !Array.isArray(d.p) || !Array.isArray(d.t) || typeof d.s !== 'number') return;
  const m = pool.find(o => !o.live); if (!m) return;
  m.id = d.id; m.pos.set(+d.p[0] || 0, +d.p[1] || 0, +d.p[2] || 0);
  aim(m, +d.t[0] || 0, +d.t[1] || 0, d.s);
}
function updMeteor(m, dt) {
  if (dt > 0) {
    m.pos.addScaledVector(m.dir, m.speed * dt);
    if (m.dying) { m.fade -= dt * 2.5; if (m.fade <= 0) { kill(m); return; } }
    else if (m.pos.y <= m.gy + 0.3) { kill(m); impact(m.tgt); return; }
  }
  const a = Math.max(0, m.fade), h = m.pos.y - m.gy, near = 1 - clamp(h / 30, 0, 1), len = DREAM.trail * (0.4 + 0.6 * a);
  /* 땅에 가까워질수록 머리가 커지고 붉어진다 */
  m.head.position.copy(m.pos); m.glow.material.opacity = 0.9 * a; m.core.material.opacity = a;
  m.glow.scale.setScalar(DREAM.size * 4 * (1 + 0.7 * near)); m.glow.material.color.setHex(near > 0.5 ? 0xff7a30 : 0xff9a4a);
  /* 꼬리: 길이 축은 3D 진행 방향 그대로, 그 축을 중심으로 카메라를 향해 돌린다 (원통형 빌보드).
     화면에 눕힌 방향으로 펴면 카메라 쪽으로 다가오는 운석에서 밝은 끝이 머리를 지나쳐 삐져나온다 */
  _p.copy(m.pos).addScaledVector(m.dir, -len * 0.5); m.trail.position.copy(_p);
  _z.copy(ctx.camera.position).sub(_p).normalize(); _y.crossVectors(_z, m.dir).normalize(); _x.copy(m.dir); _z.crossVectors(_x, _y);
  m.trail.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z)); m.trail.scale.set(len, DREAM.size * 1.6, 1); m.trail.material.opacity = 0.8 * a;
  /* 떨어질 자리: 내려올수록 진해지고 고리가 좁혀진다 */
  const k = m.dying ? 0 : 1 - clamp(h / 55, 0, 1);
  m.mark.material.uniforms.uOp.value = (0.1 + 0.75 * k * k) * (0.8 + 0.2 * Math.sin(D.clock * 14)) * a;
  m.mark.material.uniforms.uK.value = 1 - 0.5 * k;
  /* 땅에 가까워지면 바람을 가르는 소리 (가까이 떨어질수록 크게) */
  if (!m.wh && !m.dying && h < 28) { m.wh = true; const c = ctx.camera.position; sfx('meteorFall', clamp(1.2 - Math.hypot(m.tgt.x - c.x, m.tgt.z - c.z) / 40, 0.2, 1)); }
}

/* ── 막지 못한 운석이 땅에 부딪혔다 ── */
function impact(p) {
  const W = ctx.W, cam = ctx.camera.position, d = Math.hypot(p.x - cam.x, p.z - cam.z);
  const b = blasts.find(o => o.t >= 0.55) || blasts[0]; b.t = 0; b.s.position.set(p.x, p.y + 1.2, p.z); b.c.position.copy(p); b.s.visible = b.c.visible = true;
  light.position.set(p.x, p.y + 2.5, p.z); D.lightT = 0;
  const r = rings.find(o => o.t >= 1) || rings[0]; r.t = 0; r.m.position.set(p.x, p.y + 0.15, p.z); r.m.visible = true;
  /* 불티: 위로 솟는 것만 (W.sparks 는 사방으로 튀므로 아래로 가는 것을 위로 뒤집는다) */
  const S = W.sparks;
  for (let i = 0; i < 90; i++) {
    S.spawn(_a.set(p.x, p.y + 0.3, p.z), rnd(4, 12), rnd(0.5, 1.4));
    const j = (S.i - 1 + S.n) % S.n; S.vel[j * 3 + 1] = Math.abs(S.vel[j * 3 + 1]) + rnd(3, 8);
  }
  /* 흙먼지: 낮게 퍼지며 천천히 오른다 */
  for (let i = 0; i < 10; i++) W.smoke.spawn(_a.set(p.x + rnd(-1, 1), p.y + rnd(0.5, 2), p.z + rnd(-1, 1)), { x: rnd(-2, 2), y: rnd(0.5, 2), z: rnd(-2, 2) }, 0.5, rnd(2.5, 4), 0.3, rnd(1.5, 2.5), rnd(6, 9), 0.22);
  /* 그을린 자국: 땅 높낮이를 따라 붙고 꿈이 끝날 때까지 남는다. 처음 몇 초는 달아올라 불씨가 오른다 */
  const sc = scorches[D.sc++ % scorches.length];
  sc.t = 0; sc.x = p.x; sc.y = p.y; sc.z = p.z; sc.r = rnd(SCORCH_R[0], SCORCH_R[1]);
  fitGround(sc.base.geometry, p.x, p.z, sc.r, rnd(0, 6.3), 0.05); sc.base.position.set(p.x, 0, p.z); sc.glow.position.set(p.x, 0, p.z);
  sc.base.visible = sc.glow.visible = true;
  /* 흔들림·소리: 가까울수록 크게. 소리는 거리만큼 늦게(340m/s), 떨어진 쪽에서 */
  D.trauma = Math.min(1, D.trauma + clamp(1.15 - d / 40, 0.25, 1));
  ctx.camera.getWorldDirection(_f);
  const pan = d > 0.1 ? clamp(((p.x - cam.x) * -_f.z + (p.z - cam.z) * _f.x) / d, -1, 1) * 0.6 : 0;
  sfx('meteorImpact', { k: clamp(1.25 - d / 45, 0.3, 1), delay: d / 340, pan });
  if (running()) hurt();
}
/* 운석 막기가 진행 중인지 (부딪히면 캠프가 버티는 횟수가 준다) */
const running = () => D.multi ? D.live && D.phase !== 'end' && D.phase !== 'night' && D.phase !== 'wake' : D.phase === 'shoot';
/* 캠프가 한 번 버텼다. 멀티는 방장만 세어 모두에게 알린다 (친구는 방장의 hp 를 기다린다) */
function hurt() {
  if (D.multi && !dreamNet.host()) return;
  setHp(D.hp - 1);
  if (D.multi && dreamNet.send) dreamNet.send({ op: 'hp', hp: D.hp });
}
/* 버티는 횟수를 줄인다 (늘리지는 않는다). 줄 때마다 화면 가장자리가 붉게 번쩍이고, 0 이면 악몽에서 깬다 */
function setHp(n) {
  if (!D.on || n >= D.hp) return;
  D.hp = Math.max(0, n); edgeFlash(); updateHUD();
  if (D.hp <= 0) nightmare();
}
/* 악몽: 남은 운석은 사그라들고, 기록을 남기고, 하얗게 번쩍인 뒤 0.5초 있다가 깨어난다 (updateDream) */
function nightmare() {
  if (D.phase === 'night' || D.phase === 'wake') return;
  D.phase = 'night'; D.t = 0; nightmareAt = performance.now();
  pool.forEach(m => { if (m.live) m.dying = true; });
  if (D.multi) { const total = Object.values(D.scores).reduce((s, v) => s + v, 0); if (total > records.dreamTeamBest) { records.dreamTeamBest = total; saveSettings(); } }
  else if (D.score > records.dreamBest) { records.dreamBest = D.score; saveSettings(); }
  whiteFlash(); updateHUD();
}
/* 화면 위의 번쩍임 층 (처음 쓸 때 한 번 만든다): 붉은 가장자리(캠프가 버텼다) · 하얀 번쩍임(악몽) */
function fx() {
  if (fxEl) return fxEl;
  fxEl = document.createElement('div');
  fxEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;z-index:4';
  document.body.appendChild(fxEl); return fxEl;
}
function pulse(bg, shadow, op, dur) {
  const e = fx(); e.style.transition = 'none'; e.style.background = bg; e.style.boxShadow = shadow; e.style.opacity = op;
  requestAnimationFrame(() => requestAnimationFrame(() => { e.style.transition = `opacity ${dur}s`; e.style.opacity = 0; }));
}
const edgeFlash = () => pulse('transparent', 'inset 0 0 160px 50px rgba(220,40,40,.55)', 1, 0.9);
const whiteFlash = () => pulse('#fff', 'none', 0.85, 1);
/* main.js: 부딪힌 충격만큼 화면을 흔든다 (회전만 — 위치는 건드리지 않는다) */
export function dreamCamera(camera, dt) {
  if (D.trauma <= 0) return;
  D.trauma = Math.max(0, D.trauma - dt * 1.5); D.shT += dt;
  const a = D.trauma * D.trauma, t = D.shT;
  camera.rotation.x += a * 0.035 * nz(t, 1); camera.rotation.y += a * 0.035 * nz(t, 2); camera.rotation.z += a * 0.045 * nz(t, 3);
}

/* 시간을 다 버텼다: 남은 운석은 사그라들고, 점수 카드를 띄운다. 멀티는 방장이 순위표를 만들어 모두에게 보낸다 */
function finish() {
  D.phase = 'end'; D.t = 0;
  pool.forEach(m => { if (m.live) m.dying = true; });
  if (D.multi) {
    const names = Object.assign({}, D.names, dreamNet.names());
    const ids = new Set([...Object.keys(names), ...Object.keys(D.scores)]);
    const list = [...ids].map(id => ({ id, name: names[id] || '캠퍼', n: D.scores[id] || 0 })).sort((a, b) => b.n - a.n);
    if (dreamNet.send) dreamNet.send({ op: 'end', list });
    showTeam(list); return;
  }
  const prev = records.dreamBest, rec = D.score > prev;
  if (rec) { records.dreamBest = D.score; saveSettings(); }
  const note = rec ? (prev ? `새 기록, 이전 ${prev}개` : '첫 기록') : `최고 ${prev}개`;
  showCard(`<div style="font-family:var(--serif);font-size:18px;letter-spacing:.04em">막아 낸 운석 ${D.score}개</div><div style="font-size:12px;color:${rec ? 'var(--accent)' : 'var(--mute)'};margin-top:3px">${note}</div>`);
  updateHUD();
}
/* 멀티 결과 카드: 함께 막은 운석(기록과 비교) + 각자 순위 (같은 개수는 같은 순위, 내 줄은 강조색) */
function showTeam(list) {
  const me = dreamNet.self(), total = list.reduce((s, e) => s + e.n, 0);
  const prev = records.dreamTeamBest, rec = total > prev;
  if (rec) { records.dreamTeamBest = total; saveSettings(); }
  const mine = list.find(e => e.id === me); if (mine) D.score = mine.n;
  const note = rec ? (prev ? `함께 새 기록, 이전 ${prev}개` : '함께 첫 기록') : `함께 최고 ${prev}개`;
  const rows = list.map(e => {
    const rank = 1 + list.filter(o => o.n > e.n).length;
    return `<div style="display:flex;justify-content:space-between;gap:24px;font-size:13px;margin-top:5px;color:${e.id === me ? 'var(--accent)' : 'var(--ink)'}"><span>${rank}위 ${esc(e.name)}</span><span>${e.n}개</span></div>`;
  }).join('');
  showCard(`<div style="font-family:var(--serif);font-size:18px;letter-spacing:.04em">함께 막아 낸 운석 ${total}개</div><div style="font-size:12px;color:${rec ? 'var(--accent)' : 'var(--mute)'};margin-top:3px">${note}</div><div style="margin-top:10px;text-align:left">${rows}</div>`);
  updateHUD();
}

/* ── 멀티: 방장이 보낸 꿈 신호 (net.js, 친구 쪽) ── */
export function dreamRemote(d) {
  if (!D.on || !D.multi || !d) return;
  if (d.op === 'go') { if (!D.live && typeof d.left === 'number') goLive(d.left); }
  else if (d.op === 'm') spawnAt(d);
  else if (d.op === 'hp' && typeof d.hp === 'number') setHp(d.hp);
  else if (d.op === 'kill') {
    if (d.who && typeof d.n === 'number') D.scores[d.who] = d.n;
    const m = pool.find(o => o.live && o.id === d.id); if (m) hitFx(m, false);
    if (d.who === dreamNet.self() && typeof d.n === 'number') { D.score = d.n; updateHUD(); }
  } else if (d.op === 'end' && Array.isArray(d.list)) {
    if (D.phase === 'end' || D.phase === 'wake' || D.phase === 'night') return;
    D.phase = 'end'; D.t = 0; D.left = 0;
    pool.forEach(m => { if (m.live) m.dying = true; });
    showTeam(d.list.slice(0, 8).map(e => ({ id: String(e && e.id), name: e && typeof e.name === 'string' ? e.name.slice(0, 12) : '캠퍼', n: Math.max(0, Math.floor(+(e && e.n) || 0)) })));
  }
}
/* 방장 시계에 실려 오는 꿈 상태 (1초마다, 친구 쪽): 시작 여부·남은 시간·캠프가 버티는 횟수를 맞춘다.
   방장이 꿈에 없으면(null) 나도 깨어난다 — 늦게 돌아왔는데 모두 이미 깨어난 경우 */
export function dreamSync(s, hostNapping) {
  if (!D.on || !D.multi || dreamNet.host() || D.phase === 'wake') return;
  if (!s) { if (hostNapping) return; if (state.mode !== 'sleep') { D.phase = 'wake'; startSleep(true); } return; }
  if (typeof s.hp === 'number') setHp(s.hp);
  if (s.live && !D.live) goLive(+s.left || 0);
  else if (D.live && D.phase !== 'end' && D.phase !== 'night' && typeof s.left === 'number' && Math.abs(D.left - s.left) > 0.5) { D.left = s.left; D.t = DREAM.dur - s.left; }
}

/* ── 매 프레임 (main.js). 1인은 멈춘 동안·메뉴에서 dt = 0, 멀티는 메뉴에서만 0 ── */
export function updateDream(dt) {
  if (!D.on) return;
  const W = ctx.W;
  D.clock += dt;
  if (dt > 0) D.cool = Math.max(0, D.cool - dt);
  /* 반동: 쏠 때마다 손이 뒤로 튀고 총구가 들렸다가 돌아온다. 총구 빛도 함께 */
  if (state.item === 'gun' && W.item) {
    D.kick *= Math.exp(-dt * 14); const h = ctx.hand, k = D.kick;
    h.position.set(0.2, -0.2 + 0.02 * k, -0.42 + 0.05 * k); h.rotation.set(0.05 + 0.35 * k, 0, 0);
    W.item.userData.flash.material.opacity = clamp(k * 1.6 - 0.6, 0, 1);
  }
  /* 시간이 흐르는 동안: 1인은 내가 쏘는 중일 때, 멀티는 시작된 뒤 끝날 때까지 (총을 들지 않았어도 하늘은 함께 흐른다).
     운석을 띄우고 끝을 정하는 것은 1인이면 나, 멀티면 방장 */
  if (running() && dt > 0) {
    D.t += dt; D.left = Math.max(0, DREAM.dur - D.t);
    const k = D.t / DREAM.dur, spawner = !D.multi || dreamNet.host();
    if (spawner) {
      D.spawnT -= dt;
      if (D.spawnT <= 0) { spawn(k); D.spawnT = (DREAM.every[0] + (DREAM.every[1] - DREAM.every[0]) * k) * rnd(0.7, 1.3); }
    }
    const sec = Math.ceil(D.left); if (sec !== D.lastSec) { D.lastSec = sec; updateHUD(); }
    if (D.left <= 0 && spawner) finish();
  } else if (D.phase === 'end' && dt > 0) {
    D.t += dt;
    if (D.t > DREAM.endWait + (D.multi ? MULTI_CARD : 0) && state.mode !== 'sleep') { D.phase = 'wake'; startSleep(true); }
  } else if (D.phase === 'night' && dt > 0) {
    /* 악몽: 하얀 번쩍임이 걷히는 동안 잠깐 두었다가 깨어난다 */
    D.t += dt;
    if (D.t > 0.5 && state.mode !== 'sleep') { D.phase = 'wake'; startSleep(true); }
  }
  for (const m of pool) if (m.live) updMeteor(m, dt);
  for (const f of flashes) {
    if (f.t >= 0.4) continue;
    f.t += dt; const u = Math.min(1, f.t / 0.4);
    f.s.scale.setScalar(DREAM.size * (2 + 7 * u)); f.s.material.opacity = 1 - u; if (u >= 1) f.s.visible = false;
  }
  /* 부딪힌 자리: 번쩍임·불기둥 → 불빛 → 충격파 → 그을린 자국의 달아오름과 불씨 */
  for (const b of blasts) {
    if (b.t >= 0.55) continue;
    b.t += dt; const u = Math.min(1, b.t / 0.55);
    b.s.scale.setScalar(6 + 26 * u); b.s.material.opacity = Math.pow(1 - u, 1.5);
    b.c.scale.set(5 + 4 * u, 14 * (1 - 0.3 * u), 1); b.c.material.opacity = 0.9 * Math.pow(1 - u, 2);
    if (u >= 1) b.s.visible = b.c.visible = false;
  }
  if (light) { D.lightT += dt; light.intensity = D.lightT < 3 ? BLAST_LIGHT * Math.exp(-D.lightT * 3.2) * (0.85 + 0.15 * Math.sin(D.clock * 30)) : 0; }
  for (const r of rings) {
    if (r.t >= 1) { r.m.visible = false; continue; }
    r.t += dt / 0.9; const u = Math.min(1, r.t), e = 1 - Math.pow(1 - u, 3);
    r.m.scale.setScalar(1 + 15 * e); r.m.material.opacity = 0.9 * Math.pow(1 - u, 1.5);
  }
  for (const s of scorches) {
    if (!s.base.visible) continue;
    s.t += dt;
    s.glow.material.opacity = Math.max(0, 1 - s.t / 6) * (0.75 + 0.25 * Math.sin(D.clock * 9 + s.r * 7));
    if (dt > 0 && s.t < 4 && Math.random() < dt * 10 * (1 - s.t / 4)) {
      const a = Math.random() * 6.283, rr = Math.random() * s.r * 0.35;
      W.fire.spawn(_a.set(s.x + Math.cos(a) * rr, s.y + 0.1, s.z + Math.sin(a) * rr), { x: 0, y: rnd(0.3, 0.8), z: 0 }, 0.15, rnd(0.4, 0.9), 0.1);
    }
  }
  if (tracer && tracer.visible) {
    tracer.userData.t += dt; tracer.material.opacity = Math.max(0, 0.9 - tracer.userData.t / 0.08);
    if (tracer.userData.t > 0.08) tracer.visible = false;
  }
}