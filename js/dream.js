import * as THREE from 'three';
import { ctx, state, records, saveSettings, session } from './state.js';
import { DREAM } from './data.js';
import { rnd, clamp, softTex, canvasTex, isTouch } from './util.js';
import { paramsAt } from './time.js';
import { applyTime, rebakeEnv } from './scene.js';
import { sfx, setDream } from './audio.js';
import { showCard, hideCard } from './gauge.js';
import { roadYaw } from './road.js';
/* game.js 도 이 파일을 불러오지만, 서로 실행 중에만 부르므로 순환해도 괜찮다 (snowman.js 와 같은 방식) */
import { updateHUD, startSleep } from './game.js';

/* ══ 꿈: 운석 막기 ══
   텐트에서 잠들 때 꿈을 꾸면(game.js 의 updateSleep → pickDream), 시계가 0:00 에 멈춘 채 보랏빛 밤에 깨어난다.
   단계: 'off'(꿈이 아님) → 'idle'(깨어남, 트렁크 안내) → 'shoot'(총을 들고 운석 막기) → 'end'(점수 카드) → 'wake'(깨어나는 중)
   트렁크를 열면 game.js 가 총을 쥐여 주고, 길이 뻗어 나가는 쪽 하늘(road.js roadYaw)로 돌아서 올려다본 뒤 beginShoot 를 부른다.
   운석은 정면 하늘에서 캠프 쪽으로 비스듬히 떨어지고, DREAM.floor 아래로 내려오면 스스로 사그라든다 (실패 없음).
   판정은 시선과 운석 사이의 각도 (currentTarget 과 같은 방식). 맞히면 번쩍 + 불티.
   DREAM.dur 초가 지나면 점수 카드를 띄우고 game.js 의 startSleep(true) 로 깨어난다.
   침낭에 다시 눕거나(startSleep) 메뉴로 나가면(resetDream) 언제든 꿈이 풀린다

   ── 멀티 ──
   함께 잠들 때 방장이 꿈 여부를 정한다 (net.js hostNap). 모두 각자 자기 침낭에서 꿈속 밤에 깨어난다.
   단계에 'ready'(총을 들고 다른 사람을 기다리는 중)가 더해진다. 방장은 자리 비움이 아닌 사람이 모두 총을 들거나,
   첫 사람이 총을 든 지 30초가 지나면 운석 막기를 시작한다 (net.js hostGuns → dreamGo). live = 시작했는지.
   늦게 총을 든 사람은 남은 시간만큼 함께한다.
   운석은 방장만 띄우고(모두 같은 기준 자리 ANCHOR 의 정면 하늘) 모두에게 보낸다.
   쏘아 맞히면 내 화면은 바로 번쩍이고, 방장이 먼저 도착한 쪽을 점수로 인정해 모두에게 알린다 (kill).
   남은 시간은 방장 시계를 따른다 (net.js world 의 dm → dreamSync).
   끝나면 방장이 순위표를 보내고, 모두 같은 카드(함께 막은 운석·각자 순위)를 본 뒤 각자 깨어난다.
   함께 막은 운석 최고 기록은 records.dreamTeamBest (1인 기록 dreamBest 는 그대로).
   꿈속에서는 혼자 깰 수 없다 (game.js startSleep). 방장이 꿈에서 나가 있으면(dm 없음) 친구도 깨어난다.
   방장과 이어 주는 것(보내기·내 id·이름·총 든 사람 수)은 net.js 가 dreamNet 에 채운다 */

const V3 = THREE.Vector3;
/* 멀티 꿈의 기준 자리: 트렁크 뒤에 선 사람의 눈. 모두의 하늘에 같은 운석이 떨어지도록 여기서 정면을 잡는다 */
const ANCHOR = new V3(0, 1.6, 11.3);
/* 멀티 결과 카드는 순위를 읽을 시간만큼 조금 더 띄워 둔다 (초) */
const MULTI_CARD = 3;
const D = { on: false, phase: 'off', t: 0, left: 0, score: 0, spawnT: 0, cool: 0, kick: 0, lastSec: -1, yaw0: 0,
  multi: false, live: false, scores: {}, names: {}, nextId: 0 };
let pool = [], flashes = [], tracer = null;
const _f = new V3(), _v = new V3(), _a = new V3(), _b = new V3(), _t = new V3(), _p = new V3(), _x = new V3(), _y = new V3(), _z = new V3(), _m = new THREE.Matrix4();
const r3 = v => Math.round(v * 1000) / 1000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* net.js 가 채운다 (1인에서는 쓰지 않는다) */
export const dreamNet = { host: () => false, self: () => null, send: null, claim: null, names: () => ({}), guns: () => ({ n: 0, of: 0 }) };

/* 운석 꼬리: 왼쪽(뒤)은 투명, 오른쪽(머리 쪽)으로 밝아지는 띠 */
const streakTex = canvasTex(128, 16, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const v = g.createLinearGradient(0, 0, 0, h); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = v; g.fillRect(0, 0, w, h);
});
const glowMat = c => new THREE.SpriteMaterial({ map: softTex, color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

/* ── 씬마다 한 번: 운석·번쩍임·탄도선을 만들어 숨겨 둔다 (사전 컴파일에 함께 들어간다) ── */
export function buildDream() {
  Object.assign(D, { on: false, phase: 'off', score: 0, kick: 0, multi: false, live: false, scores: {}, names: {} });
  const scene = ctx.scene; pool = []; flashes = [];
  for (let i = 0; i < DREAM.pool; i++) {
    const head = new THREE.Group(), glow = new THREE.Sprite(glowMat(0xff9a4a)), core = new THREE.Sprite(glowMat(0xfff4d8));
    glow.scale.setScalar(DREAM.size * 4); core.scale.setScalar(DREAM.size * 1.4); head.add(glow, core);
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: streakTex, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    head.visible = trail.visible = false; trail.frustumCulled = false;
    [head, glow, core, trail].forEach(o => { o.userData.noAO = true; });
    scene.add(head, trail);
    pool.push({ head, glow, core, trail, pos: new V3(), dir: new V3(), speed: 0, live: false, dying: false, fade: 1, id: -1 });
  }
  for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(glowMat(0xffe2a8)); s.visible = false; s.userData.noAO = true; scene.add(s); flashes.push({ s, t: 9 }); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  tracer = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  tracer.frustumCulled = false; tracer.visible = false; tracer.userData.noAO = true; tracer.userData.t = 9; scene.add(tracer);
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
/* HUD 아이템 상자 [이름 아래 줄, 안내 줄] */
export function dreamHint(btn) {
  if (D.phase === 'shoot') return [`막아 낸 운석 ${D.score}`, `${btn} 쏘기 / 남은 시간 ${Math.ceil(D.left)}초`];
  if (D.phase === 'ready') return ['', '모두 총을 들면 시작한다'];
  if (D.phase === 'end') return [`막아 낸 운석 ${D.score}`, '꿈이 흐려진다'];
  return ['', ''];
}
/* net.js: 방장이 "시작"을 정할 때 · 친구의 안내 줄 숫자를 새로 쓸 때 · 방장 시계에 실어 보낼 때 */
export const dreamWaiting = () => D.on && D.multi && !D.live && (D.phase === 'idle' || D.phase === 'ready');
export const dreamReady = () => D.on && D.phase === 'ready';
export const dreamStatus = () => D.on && D.multi ? { live: D.live ? 1 : 0, left: Math.round(D.left * 10) / 10 } : null;

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
  Object.assign(D, { on: true, phase: 'idle', t: 0, left: DREAM.dur, score: 0, kick: 0, cool: 0, lastSec: -1, multi, live: false, scores: {}, names: {}, nextId: 0 });
  if (multi) D.yaw0 = roadYaw(ANCHOR.x, ANCHOR.z);
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
  D.on = false; D.phase = 'off'; D.multi = false; D.live = false; D.scores = {}; D.names = {};
  pool.forEach(kill); flashes.forEach(f => { f.t = 9; f.s.visible = false; }); if (tracer) tracer.visible = false;
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
export function dreamClaim(id, who) { if (D.on && D.multi && D.live && D.phase !== 'end' && typeof id === 'number') judge(id, who); }
function kill(m) { m.live = false; m.head.visible = m.trail.visible = false; }

/* 운석 하나: 정면 하늘(좌우 DREAM.spread) 80~115m 앞 60~85m 높이에서, 기준 자리 앞 25~45m 땅을 향해 떨어진다.
   기준 자리는 1인이면 내 눈, 멀티면 ANCHOR (방장만 띄우고 같은 값을 모두에게 보낸다) */
function spawn(k) {
  const m = pool.find(o => !o.live); if (!m) return;
  const c = D.multi ? ANCHOR : ctx.camera.position, th = D.yaw0 + rnd(-DREAM.spread, DREAM.spread);
  const fx = -Math.sin(th), fz = -Math.cos(th), sx = -fz, sz = fx, dist = rnd(80, 115), side = rnd(-25, 25);
  m.pos.set(c.x + fx * dist + sx * side, rnd(60, 85), c.z + fz * dist + sz * side);
  const td = rnd(25, 45), ts = side * 0.4 + rnd(-15, 15);
  _t.set(c.x + fx * td + sx * ts, 0, c.z + fz * td + sz * ts);
  m.dir.subVectors(_t, m.pos).normalize(); m.speed = rnd(DREAM.speed[0], DREAM.speed[1]) * (1 + 0.5 * k);
  m.live = true; m.dying = false; m.fade = 1; m.head.visible = m.trail.visible = true;
  m.id = D.nextId++;
  if (D.multi && dreamNet.send) dreamNet.send({ op: 'm', id: m.id, p: [r3(m.pos.x), r3(m.pos.y), r3(m.pos.z)], d: [r3(m.dir.x), r3(m.dir.y), r3(m.dir.z)], s: r3(m.speed) });
}
/* 친구: 방장이 띄운 운석을 같은 자리에 띄운다 */
function spawnAt(d) {
  if (typeof d.id !== 'number' || !Array.isArray(d.p) || !Array.isArray(d.d) || typeof d.s !== 'number') return;
  const m = pool.find(o => !o.live); if (!m) return;
  m.id = d.id; m.pos.set(+d.p[0] || 0, +d.p[1] || 0, +d.p[2] || 0); m.dir.set(+d.d[0] || 0, +d.d[1] || -1, +d.d[2] || 0).normalize(); m.speed = d.s;
  m.live = true; m.dying = false; m.fade = 1; m.head.visible = m.trail.visible = true;
}
function updMeteor(m, dt) {
  if (dt > 0) {
    m.pos.addScaledVector(m.dir, m.speed * dt);
    if (!m.dying && m.pos.y < DREAM.floor) m.dying = true;
    if (m.dying) { m.fade -= dt * 2.5; if (m.fade <= 0) { kill(m); return; } }
  }
  const a = Math.max(0, m.fade), len = DREAM.trail * (0.4 + 0.6 * a);
  m.head.position.copy(m.pos); m.glow.material.opacity = 0.9 * a; m.core.material.opacity = a;
  /* 꼬리: 길이 축은 3D 진행 방향 그대로, 그 축을 중심으로 카메라를 향해 돌린다 (원통형 빌보드).
     화면에 눕힌 방향으로 펴면 카메라 쪽으로 다가오는 운석에서 밝은 끝이 머리를 지나쳐 삐져나온다 */
  _p.copy(m.pos).addScaledVector(m.dir, -len * 0.5); m.trail.position.copy(_p);
  _z.copy(ctx.camera.position).sub(_p).normalize(); _y.crossVectors(_z, m.dir).normalize(); _x.copy(m.dir); _z.crossVectors(_x, _y);
  m.trail.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z)); m.trail.scale.set(len, DREAM.size * 1.6, 1); m.trail.material.opacity = 0.8 * a;
}
/* 시간이 다 됐다: 남은 운석은 사그라들고, 점수 카드를 띄운다. 멀티는 방장이 순위표를 만들어 모두에게 보낸다 */
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
  else if (d.op === 'kill') {
    if (d.who && typeof d.n === 'number') D.scores[d.who] = d.n;
    const m = pool.find(o => o.live && o.id === d.id); if (m) hitFx(m, false);
    if (d.who === dreamNet.self() && typeof d.n === 'number') { D.score = d.n; updateHUD(); }
  } else if (d.op === 'end' && Array.isArray(d.list)) {
    if (D.phase === 'end' || D.phase === 'wake') return;
    D.phase = 'end'; D.t = 0; D.left = 0;
    pool.forEach(m => { if (m.live) m.dying = true; });
    showTeam(d.list.slice(0, 8).map(e => ({ id: String(e && e.id), name: e && typeof e.name === 'string' ? e.name.slice(0, 12) : '캠퍼', n: Math.max(0, Math.floor(+(e && e.n) || 0)) })));
  }
}
/* 방장 시계에 실려 오는 꿈 상태 (1초마다, 친구 쪽): 시작 여부·남은 시간을 맞춘다.
   방장이 꿈에 없으면(null) 나도 깨어난다 — 늦게 돌아왔는데 모두 이미 깨어난 경우 */
export function dreamSync(s) {
  if (!D.on || !D.multi || dreamNet.host() || D.phase === 'wake') return;
  if (!s) { if (state.mode !== 'sleep') { D.phase = 'wake'; startSleep(true); } return; }
  if (s.live && !D.live) goLive(+s.left || 0);
  else if (D.live && D.phase !== 'end' && typeof s.left === 'number' && Math.abs(D.left - s.left) > 0.5) { D.left = s.left; D.t = DREAM.dur - s.left; }
}

/* ── 매 프레임 (main.js). 1인은 멈춘 동안·메뉴에서 dt = 0, 멀티는 메뉴에서만 0 ── */
export function updateDream(dt) {
  if (!D.on) return;
  const W = ctx.W;
  if (dt > 0) D.cool = Math.max(0, D.cool - dt);
  /* 반동: 쏠 때마다 손이 뒤로 튀고 총구가 들렸다가 돌아온다. 총구 빛도 함께 */
  if (state.item === 'gun' && W.item) {
    D.kick *= Math.exp(-dt * 14); const h = ctx.hand, k = D.kick;
    h.position.set(0.2, -0.2 + 0.02 * k, -0.42 + 0.05 * k); h.rotation.set(0.05 + 0.35 * k, 0, 0);
    W.item.userData.flash.material.opacity = clamp(k * 1.6 - 0.6, 0, 1);
  }
  /* 시간이 흐르는 동안: 1인은 내가 쏘는 중일 때, 멀티는 시작된 뒤 끝날 때까지 (총을 들지 않았어도 하늘은 함께 흐른다).
     운석을 띄우고 끝을 정하는 것은 1인이면 나, 멀티면 방장 */
  const running = D.multi ? D.live && D.phase !== 'end' && D.phase !== 'wake' : D.phase === 'shoot';
  if (running && dt > 0) {
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
  }
  for (const m of pool) if (m.live) updMeteor(m, dt);
  for (const f of flashes) {
    if (f.t >= 0.4) continue;
    f.t += dt; const u = Math.min(1, f.t / 0.4);
    f.s.scale.setScalar(DREAM.size * (2 + 7 * u)); f.s.material.opacity = 1 - u; if (u >= 1) f.s.visible = false;
  }
  if (tracer && tracer.visible) {
    tracer.userData.t += dt; tracer.material.opacity = Math.max(0, 0.9 - tracer.userData.t / 0.08);
    if (tracer.userData.t > 0.08) tracer.visible = false;
  }
}