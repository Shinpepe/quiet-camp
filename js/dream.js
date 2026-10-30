import * as THREE from 'three';
import { ctx, state, records, saveSettings } from './state.js';
import { DREAM } from './data.js';
import { rnd, clamp, softTex, canvasTex, isTouch } from './util.js';
import { paramsAt } from './time.js';
import { applyTime, rebakeEnv } from './scene.js';
import { sfx, setDream } from './audio.js';
import { showCard, hideCard } from './gauge.js';
/* game.js 도 이 파일을 불러오지만, 서로 실행 중에만 부르므로 순환해도 괜찮다 (snowman.js 와 같은 방식) */
import { updateHUD, startSleep } from './game.js';

/* ══ 꿈: 운석 막기 ══
   텐트에서 잠들 때 꿈을 꾸면(game.js 의 updateSleep → pickDream), 시계가 0:00 에 멈춘 채 보랏빛 밤에 깨어난다.
   단계: 'off'(꿈이 아님) → 'idle'(깨어남, 트렁크 안내) → 'shoot'(총을 들고 운석 막기) → 'end'(점수 카드) → 'wake'(깨어나는 중)
   트렁크를 열면 game.js 가 총을 쥐여 주고, 길이 뻗어 나가는 쪽 하늘(road.js roadYaw)로 돌아서 올려다본 뒤 beginShoot 를 부른다.
   운석은 정면 하늘에서 캠프 쪽으로 비스듬히 떨어지고, DREAM.floor 아래로 내려오면 스스로 사그라든다 (실패 없음).
   판정은 시선과 운석 사이의 각도 (currentTarget 과 같은 방식). 맞히면 번쩍 + 불티.
   DREAM.dur 초가 지나면 점수 카드를 띄우고 game.js 의 startSleep(true) 로 깨어난다.
   침낭에 다시 눕거나(startSleep) 메뉴로 나가면(resetDream) 언제든 꿈이 풀린다 */

const V3 = THREE.Vector3;
const D = { on: false, phase: 'off', t: 0, left: 0, score: 0, spawnT: 0, cool: 0, kick: 0, lastSec: -1, yaw0: 0 };
let pool = [], flashes = [], tracer = null;
const _f = new V3(), _v = new V3(), _a = new V3(), _b = new V3(), _t = new V3(), _p = new V3(), _x = new V3(), _y = new V3(), _z = new V3(), _m = new THREE.Matrix4();

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
  Object.assign(D, { on: false, phase: 'off', score: 0, kick: 0 });
  const scene = ctx.scene; pool = []; flashes = [];
  for (let i = 0; i < DREAM.pool; i++) {
    const head = new THREE.Group(), glow = new THREE.Sprite(glowMat(0xff9a4a)), core = new THREE.Sprite(glowMat(0xfff4d8));
    glow.scale.setScalar(DREAM.size * 4); core.scale.setScalar(DREAM.size * 1.4); head.add(glow, core);
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: streakTex, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    head.visible = trail.visible = false; trail.frustumCulled = false;
    [head, glow, core, trail].forEach(o => { o.userData.noAO = true; });
    scene.add(head, trail);
    pool.push({ head, glow, core, trail, pos: new V3(), dir: new V3(), speed: 0, live: false, dying: false, fade: 1 });
  }
  for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(glowMat(0xffe2a8)); s.visible = false; s.userData.noAO = true; scene.add(s); flashes.push({ s, t: 9 }); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  tracer = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  tracer.frustumCulled = false; tracer.visible = false; tracer.userData.noAO = true; tracer.userData.t = 9; scene.add(tracer);
}

/* ── game.js·scene.js·main.js 가 부르는 것 ── */
export const dreamOn = () => D.on;
export const dreamCenter = () => D.yaw0;
export const dreamGuide = () => D.phase === 'idle' ? '차 트렁크를 확인해 보자' : null;
/* 처음 잠들 때는 반드시, 그 뒤로는 DREAM.chance */
export const pickDream = () => records.dreams === 0 || Math.random() < DREAM.chance;
/* HUD 아이템 상자 [이름 아래 줄, 안내 줄] */
export function dreamHint(btn) {
  if (D.phase === 'shoot') return [`막아 낸 운석 ${D.score}`, `${btn} 쏘기 / 남은 시간 ${Math.ceil(D.left)}초`];
  if (D.phase === 'end') return [`막아 낸 운석 ${D.score}`, '꿈이 흐려진다'];
  return ['', ''];
}

/* 꿈속의 하늘: paramsAt 이 매 프레임 새로 채운 값을 덮어쓴다 (main.js) */
export function tintDream(tm) {
  if (!D.on) return;
  tm.top.setHex(0x140c33); tm.bottom.setHex(0x3d2363); tm.fog.setHex(0x1d1440); tm.sunColor.setHex(0xb59aff); tm.disc.setHex(0xf4e6ff);
  tm.cloudLit.setHex(0x7a5aa8); tm.cloudShade.setHex(0x0b0716); tm.cloudCover = 0.3;
  tm.stars = 1; tm.exposure = 1.18; tm.fogDen = 0.0012;
  const g = tm.grade; g.tint[0] = 1.05; g.tint[1] = 0.95; g.tint[2] = 1.1; g.sat = 1.15; g.bloom = 0.75;
}

/* 꿈에 들어간다 (잠자기 화면이 검은 동안 game.js 가 부른다). 하늘과 주변광을 바로 꿈 색으로 맞춘다 */
export function startDream() {
  Object.assign(D, { on: true, phase: 'idle', t: 0, score: 0, kick: 0, cool: 0 });
  records.dreams++; saveSettings(); setDream(true);
  const W = ctx.W; paramsAt(state.clock, W.tm); tintDream(W.tm); applyTime(); rebakeEnv();
}
/* 총을 쥐었다: yaw0 = 바라보는 정면 (시선 제한·운석이 떨어지는 방향의 기준) */
export function beginShoot(yaw0) {
  if (!D.on) return;
  Object.assign(D, { phase: 'shoot', t: 0, left: DREAM.dur, spawnT: 1.5, cool: 0, lastSec: -1, yaw0 });
}
/* 꿈을 끝낸다: 깨어날 때(game.js)와 메뉴로 나갈 때 */
export function endDream() {
  if (!D.on) return;
  D.on = false; D.phase = 'off';
  pool.forEach(kill); flashes.forEach(f => { f.t = 9; f.s.visible = false; }); if (tracer) tracer.visible = false;
  hideCard(); setDream(false);
}
export const resetDream = endDream;

/* 쏘기: 시선에서 허용 각도 안에 있는 운석 중 가장 가까운 것을 맞힌다 */
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
  if (best) hit(best);
}
function tracerTo(a, b) {
  const p = tracer.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
  tracer.userData.t = 0; tracer.visible = true;
}
function hit(m) {
  D.score++; const W = ctx.W;
  const f = flashes.find(o => o.t >= 0.4) || flashes[0]; f.t = 0; f.s.position.copy(m.pos); f.s.visible = true;
  for (let i = 0; i < 28; i++) W.sparks.spawn(m.pos, rnd(18, 40), rnd(0.35, 0.8));
  kill(m); sfx('meteorHit'); if (navigator.vibrate) navigator.vibrate(15); updateHUD();
}
function kill(m) { m.live = false; m.head.visible = m.trail.visible = false; }

/* 운석 하나: 정면 하늘(좌우 DREAM.spread) 80~115m 앞 60~85m 높이에서, 플레이어 앞 25~45m 땅을 향해 떨어진다 */
function spawn(k) {
  const m = pool.find(o => !o.live); if (!m) return;
  const c = ctx.camera.position, th = D.yaw0 + rnd(-DREAM.spread, DREAM.spread);
  const fx = -Math.sin(th), fz = -Math.cos(th), sx = -fz, sz = fx, dist = rnd(80, 115), side = rnd(-25, 25);
  m.pos.set(c.x + fx * dist + sx * side, rnd(60, 85), c.z + fz * dist + sz * side);
  const td = rnd(25, 45), ts = side * 0.4 + rnd(-15, 15);
  _t.set(c.x + fx * td + sx * ts, 0, c.z + fz * td + sz * ts);
  m.dir.subVectors(_t, m.pos).normalize(); m.speed = rnd(DREAM.speed[0], DREAM.speed[1]) * (1 + 0.5 * k);
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
/* 시간이 다 됐다: 남은 운석은 사그라들고, 점수 카드를 띄운다 */
function finish() {
  D.phase = 'end'; D.t = 0;
  pool.forEach(m => { if (m.live) m.dying = true; });
  const prev = records.dreamBest, rec = D.score > prev;
  if (rec) { records.dreamBest = D.score; saveSettings(); }
  const note = rec ? (prev ? `새 기록, 이전 ${prev}개` : '첫 기록') : `최고 ${prev}개`;
  showCard(`<div style="font-family:var(--serif);font-size:18px;letter-spacing:.04em">막아 낸 운석 ${D.score}개</div><div style="font-size:12px;color:${rec ? 'var(--accent)' : 'var(--mute)'};margin-top:3px">${note}</div>`);
  updateHUD();
}

/* ── 매 프레임 (main.js). 멈춘 동안·메뉴에서는 dt = 0 ── */
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
  if (D.phase === 'shoot' && dt > 0) {
    D.t += dt; D.left = Math.max(0, DREAM.dur - D.t);
    const k = D.t / DREAM.dur;
    D.spawnT -= dt;
    if (D.spawnT <= 0) { spawn(k); D.spawnT = (DREAM.every[0] + (DREAM.every[1] - DREAM.every[0]) * k) * rnd(0.7, 1.3); }
    const sec = Math.ceil(D.left); if (sec !== D.lastSec) { D.lastSec = sec; updateHUD(); }
    if (D.left <= 0) finish();
  } else if (D.phase === 'end' && dt > 0) {
    D.t += dt;
    if (D.t > DREAM.endWait && state.mode !== 'sleep') { D.phase = 'wake'; startSleep(true); }
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