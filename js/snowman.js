import * as THREE from 'three';
import { ctx, state } from './state.js';
import { SNOW, BLOCKS } from './data.js';
import { smoothM, std, softTex, clamp, smooth, rnd, NOISE_GLSL } from './util.js';
import { terrainH } from './terrain.js';
import { tex } from './textures.js';
import { applyGear } from './props.js';
import { sfx, setSnowRoll } from './audio.js';
import { toast } from './gauge.js';
/* game.js 도 이 파일을 불러오지만, 서로 실행 중에만 부르므로 순환해도 괜찮다 (scene.js 와 같은 방식) */
import { player, updateHUD } from './game.js';

/* ── 눈사람 만들기 (설산 전용) ──
   발밑 눈밭을 보고 E → 눈 뭉치기. 걸으면 앞의 눈덩이가 굴러가며 커진다 (dr ∝ ds / r — 클수록 더디게).
   굴리는 중 E → 내려놓기, 다른 눈덩이에 붙어 있으면 E → 눈사람 만들기 (굴리던 것이 머리, 바닥의 것이 몸통).
   내려놓은 눈덩이를 보고 E → 다시 굴리기, 빈손 클릭 → 부수기. 눈사람도 빈손 클릭 → 부수기.
   크기: 최소 SNOW.min (이보다 작으면 눈사람이 안 된다) · 최대 SNOW.max (머리·몸통 같다. 최대가 되면 더 커지지 않고 천천히 굴러간다).
   눈사람이 되면 돌 눈·당근 코·잔가지 팔·단추 두 개·텐트 색 목도리가 크기에 맞춰 톡톡 붙는다.
   내려놓은 눈덩이와 눈사람은 W.trees(걷기 충돌)와 W.interact(조준)에 들어간다.
   굴린 자국은 하나로 이어진 띠(Track) — 바닥 색에 배율을 곱해 조명을 그대로 따르고, SNOW.trackLife 초 뒤 사라진다 ── */

const V3 = THREE.Vector3, UP = new V3(0, 1, 0), FWD = new V3(0, 0, 1);
const spw = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
const backOut = q => 1 + 2.7 * Math.pow(q - 1, 3) + 1.7 * Math.pow(q - 1, 2);
const remove = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); };
const isMax = o => o.r >= SNOW.max - 1e-4;
/* 눈덩이는 무게로 눈에 살짝 눌려 앉는다 */
const sinkOf = r => Math.min(0.02, r * 0.06);
const groundAt = (x, z) => terrainH(x, z, ctx.W.cfg);
const disposeGeo = o => o.traverse(c => { if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose(); });
const shade = (g, v) => { g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(v), 3)); return g; };

/* 모듈 상태: buildSnowman 이 씬마다 새로 채운다 */
const S = { on: false, balls: [], men: [], active: null, mounds: [], track: null, fx: null };
let M = null, seq = 0;

/* ── 공유 지오메트리 (씬이 바뀌어도 재사용 — userData.shared 라 scene.js 의 정리에서 빠진다) ── */
let G = null;
function geos() {
  if (G) return G;
  const shared = g => { g.userData.shared = true; return g; };
  /* 납작한 조약돌: 다면체를 위아래로 눌러 한쪽이 평평하다 (평평한 쪽을 표면 바깥으로 박는다) */
  const stone = sd => { const g = new THREE.DodecahedronGeometry(1, 0), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.16 * Math.sin(x * 12.9 + y * 78.2 + z * 37.7 + sd); p.setXYZ(i, x * k, y * k * 0.62, z * k); }
    g.computeVertexNormals(); return shared(g); };
  const lathe = pts => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 32);
  /* 코트 단추: 도톰한 테두리, 오목한 가운데 (구멍 네 개는 hole 을 얹는다) */
  const btn = shared(lathe([[0, 0], [0.97, 0], [1, 0.07], [0.99, 0.18], [0.9, 0.27], [0.76, 0.26], [0.66, 0.2], [0.4, 0.16], [0, 0.15]]));
  const hole = shared(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10));
  /* 당근: 마디가 있고 끝으로 갈수록 살짝 휜다. 밑동 y 0, 끝 y 1 */
  const pts = [[0, 0]];
  for (let i = 0; i <= 16; i++) { const y = i / 16; pts.push([i === 16 ? 0.001 : Math.pow(1 - y, 0.85) * (1 + 0.06 * Math.sin(y * 44)) * (i === 0 ? 0.92 : 1), y]); }
  const carrot = lathe(pts), cp = carrot.attributes.position;
  for (let i = 0; i < cp.count; i++) { const y = cp.getY(i); cp.setX(i, cp.getX(i) + 0.1 * y * y); }
  carrot.computeVertexNormals(); shared(carrot);
  /* 부서진 자리에 남는 눈 더미 */
  const mound = shared(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  return G = { stone: [stone(1.3), stone(4.7)], btn, hole, carrot, mound };
}
function makeMats() {
  return {
    snow: smoothM(0xf6f8fc, Object.assign({ roughness: 0.92 }, tex('snow', 3, 2, 0.6))),
    stone: std(0x2c2c30, Object.assign({ roughness: 0.7 }, tex('rock', 1, 1, 0.6))),
    carrot: smoothM(0xe2701f, { roughness: 0.55, side: THREE.DoubleSide }),
    twig: smoothM(0x5b3e29, Object.assign({ roughness: 0.95 }, tex('bark', 1, 2, 0.5))),
    btn: smoothM(0x262a31, { roughness: 0.38, metalness: 0.05, side: THREE.DoubleSide }),
    hole: smoothM(0x0a0b0d, { roughness: 1 }),
    /* 목도리: 니트 결은 정점색, 천 질감은 텐트와 같은 fabric. 색은 applyGear 가 텐트 몸체 색으로 칠한다 */
    scarf: smoothM(0xffffff, Object.assign({ roughness: 0.97, vertexColors: true, side: THREE.DoubleSide }, tex('fabric', 1, 1, 0.45))),
  };
}

/* 손으로 뭉친 듯 울퉁불퉁한 공. 낮은 주파수 덩어리 + 잔 요철 (눈마다 모양이 다르다) */
function ballGeo() {
  const g = new THREE.SphereGeometry(1, 48, 32), p = g.attributes.position, s = Math.random() * 50;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.018 * Math.sin(x * 3.7 + s) * Math.sin(y * 4.3 + s * 1.3) * Math.sin(z * 4.1 + s * 0.7) + 0.009 * Math.sin(x * 9 + y * 7 + z * 8 + s) + 0.004 * Math.sin(x * 23 + y * 19 - z * 21 + s);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals(); return g;
}
/* 격자 함수 fn(u,v) → [x, y, z, 밝기] 로 면을 만든다. uv 는 (u·ru, v·rv) — 천 질감 반복 횟수 */
function param(nu, nv, ru, rv, fn) {
  const pos = [], col = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const r = fn(i / nu, j / nv); pos.push(r[0], r[1], r[2]); col.push(r[3], r[3], r[3]); uv.push(i / nu * ru, j / nv * rv); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); return g;
}
/* 지오메트리 가운데를 원점으로 옮긴다 — 장식이 톡 하고 커질 때 제자리에서 커지게 */
function centered(m) { const g = m.geometry; g.computeBoundingBox(); const c = new V3(); g.boundingBox.getCenter(c); g.translate(-c.x, -c.y, -c.z); m.position.add(c); return m; }
/* 잔가지: 밑동(a)이 원점 — 몸통에서 바깥으로 자라 나오며 붙는다 */
function twig(a, b, r0, r1) {
  const d = new V3().subVectors(b, a), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L, 6); g.translate(0, L / 2, 0);
  const m = new THREE.Mesh(g, M.twig); m.position.copy(a); m.quaternion.setFromUnitVectors(UP, d.normalize()); return m;
}
function makeButton(R) {
  const b = new THREE.Group(); b.add(new THREE.Mesh(G.btn, M.btn));
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([x, z]) => { const h = new THREE.Mesh(G.hole, M.hole); h.position.set(x * 0.2, 0.16, z * 0.2); b.add(h); });
  b.scale.setScalar(R); return b;
}

/* ── 굴린 자국: 눈덩이가 지나간 길을 따라 이어지는 띠 (링 버퍼) ──
   가운데는 다져진 바닥, 양쪽은 안으로 기운 벽, 바깥 가장자리는 밀려나 솟은 눈.
   결과 = 바닥 색 × 배율 (발자국과 같은 곱하기) — 그래서 낮·밤·노을·모닥불 빛을 그대로 따른다.
   벽·가장자리 배율은 해(밤에는 달) 방향과 기울기로 정한다: 빛을 등진 벽은 어둡고, 빛을 받는 가장자리는 밝다.
   섹션마다 태어난 시각을 적어 두고, 수명의 절반이 지나면 옅어지기 시작해 수명이 끝나면 사라진다 */
class Track {
  constructor(W, n) {
    this.N = n; this.head = 0;
    this.pos = new Float32Array(n * 6); this.u = new Float32Array(n * 2); this.b = new Float32Array(n * 2).fill(-1e9); this.d = new Float32Array(n * 4); this.idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) { this.u[i * 2] = 1; this.u[i * 2 + 1] = -1; }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aU', new THREE.BufferAttribute(this.u, 1));
    g.setAttribute('aB', new THREE.BufferAttribute(this.b, 1)); g.setAttribute('aD', new THREE.BufferAttribute(this.d, 2)); g.setIndex(new THREE.BufferAttribute(this.idx, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: W.uTime, uLife: { value: SNOW.trackLife }, uLight: W.uSunV },
      vertexShader: `attribute float aU,aB;attribute vec2 aD;varying float vU,vB;varying vec2 vD;varying vec3 vW;
        void main(){vU=aU;vB=aB;vD=aD;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: NOISE_GLSL + `uniform float uT,uLife;uniform vec3 uLight;varying float vU,vB;varying vec2 vD;varying vec3 vW;
        void main(){
          float life=1.0-smoothstep(uLife*0.5,uLife,uT-vB);
          float far=1.0-smoothstep(30.0,70.0,length(vW-cameraPosition));
          float a=abs(vU);float e=a+(vnoise(vW.xz*6.0)*0.6+vnoise(vW.xz*19.0)*0.4-0.5)*0.2;
          float trough=1.0-smoothstep(0.6,0.74,e);
          float rim=smoothstep(0.62,0.76,e)*(1.0-smoothstep(0.8,0.97,e));
          float wall=smoothstep(0.32,0.66,e)*trough;
          float sl=sign(vU)*(-0.9*wall+0.5*rim);
          vec3 nV=normalize((viewMatrix*vec4(normalize(vec3(vD.x*sl,1.0,vD.y*sl)),0.0)).xyz);
          vec3 upV=normalize((viewMatrix*vec4(0.0,1.0,0.0,0.0)).xyz);
          float shade=clamp((0.6+0.4*max(dot(nV,uLight),0.0))/(0.6+0.4*max(dot(upV,uLight),0.0)),0.75,1.12);
          float m=mix(1.0,0.9,trough)*shade*(0.96+0.08*vnoise(vW.xz*40.0));
          m=mix(m,max(m,1.06),rim);
          float f=max(trough,rim*0.8)*life*far*0.8;
          if(f<0.003)discard;
          gl_FragColor=vec4(vec3(f*m),f);}`,
      /* 결과 = 바닥 × (f·m) + 바닥 × (1 − f) = 바닥 × mix(1, m, f) */
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.userData.noAO = true; this.mesh.userData.noRefl = true;
  }
  quad(a, b, on) { const o = a * 6; if (on) this.idx.set([a * 2, b * 2, a * 2 + 1, a * 2 + 1, b * 2, b * 2 + 1], o); else this.idx.fill(0, o, o + 6); }
  /* 단면 하나를 더한다. link = 직전 단면과 잇는다 (새로 굴리기 시작한 첫 단면은 잇지 않는다) */
  push(x, z, dx, dz, hw, link) {
    const j = this.head; this.head = (j + 1) % this.N;
    const l = Math.hypot(dx, dz) || 1, ax = -dz / l, az = dx / l, x1 = x + ax * hw, z1 = z + az * hw, x2 = x - ax * hw, z2 = z - az * hw;
    this.pos.set([x1, groundAt(x1, z1) + 0.012, z1, x2, groundAt(x2, z2) + 0.012, z2], j * 6);
    this.b[j * 2] = this.b[j * 2 + 1] = ctx.W.uTime.value;
    this.d.set([ax, az, ax, az], j * 4);
    this.quad((j - 1 + this.N) % this.N, j, link); this.quad(j, (j + 1) % this.N, false);
    const at = this.geo.attributes; at.position.needsUpdate = at.aB.needsUpdate = at.aD.needsUpdate = true; this.geo.index.needsUpdate = true;
  }
  clear() { this.b.fill(-1e9); this.idx.fill(0); this.geo.attributes.aB.needsUpdate = true; this.geo.index.needsUpdate = true; }
}

/* ── 부서질 때 흩어지는 눈가루: 중력으로 떨어져 바닥에 멈췄다가 사라진다.
   PointsMaterial 은 조명을 받지 않으므로 밤에 혼자 빛나지 않게 하늘빛·햇빛 세기로 밝기를 맞춘다 ── */
class SnowBurst {
  constructor(n) {
    this.n = n; this.i = 0; this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.l = new Float32Array(n); this.g = new Float32Array(n);
    for (let i = 0; i < n; i++) this.p[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.mesh = new THREE.Points(geo, new THREE.PointsMaterial({ map: softTex, color: 0xffffff, size: 0.07, transparent: true, depthWrite: false }));
    this.mesh.frustumCulled = false; this.mesh.userData.noAO = true;
  }
  spawn(c, r) {
    const n = Math.round(60 + 240 * r), gy = groundAt(c.x, c.z) + 0.01;
    for (let k = 0; k < n; k++) {
      const i = this.i; this.i = (i + 1) % this.n;
      let ux = Math.random() * 2 - 1, uy = Math.random() * 2 - 1, uz = Math.random() * 2 - 1; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const d = Math.random() * r, s = rnd(0.5, 2.0);
      this.p[i * 3] = c.x + ux * d; this.p[i * 3 + 1] = c.y + uy * d; this.p[i * 3 + 2] = c.z + uz * d;
      this.v[i * 3] = ux * s; this.v[i * 3 + 1] = Math.abs(uy) * s + 0.8; this.v[i * 3 + 2] = uz * s;
      this.l[i] = rnd(0.7, 1.3); this.g[i] = gy;
    }
  }
  update(dt) {
    const W = ctx.W, P = this.p, V = this.v;
    this.mesh.material.color.setScalar(clamp(0.25 + 0.15 * W.hemi.intensity + 0.12 * W.sun.intensity, 0.2, 1));
    if (dt <= 0) return;
    for (let i = 0; i < this.n; i++) {
      if (this.l[i] <= 0) continue;
      this.l[i] -= dt; V[i * 3 + 1] -= 7 * dt;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < this.g[i]) { P[i * 3 + 1] = this.g[i]; V[i * 3] *= 0.3; V[i * 3 + 1] = 0; V[i * 3 + 2] *= 0.3; }
      if (this.l[i] <= 0) P[i * 3 + 1] = -999;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
  clear() { this.l.fill(0); for (let i = 0; i < this.n; i++) this.p[i * 3 + 1] = -999; this.mesh.geometry.attributes.position.needsUpdate = true; }
}

/* ── 씬마다: 재질·자국·눈가루를 만들고, 셰이더를 미리 만들 견본을 숨겨 둔다 ──
   scene.js 의 buildScene 이 장소와 상관없이 부른다 (설산이 아니면 상태만 비운다) */
export function buildSnowman(cfg) {
  S.on = false; S.balls = []; S.men = []; S.active = null; S.mounds = []; S.track = null; S.fx = null;
  if (!cfg.snow) return;
  const W = ctx.W, scene = ctx.scene; geos(); M = makeMats();
  W.tentMats.push([M.scarf, 1]); applyGear();
  S.track = new Track(W, 2400); scene.add(S.track.mesh);
  S.fx = new SnowBurst(600); scene.add(S.fx.mesh);
  /* 견본: precompileScene 이 숨긴 것도 잠깐 보이게 해 컴파일하므로, 처음 만들 때 멈칫하지 않는다 */
  const warm = new THREE.Group(); warm.visible = false; warm.userData.noRefl = true;
  warm.add(new THREE.Mesh(G.mound, M.snow), new THREE.Mesh(G.stone[0], M.stone), new THREE.Mesh(G.carrot, M.carrot), makeButton(1),
    twig(new V3(), new V3(0, 0.1, 0), 0.01, 0.005), new THREE.Mesh(param(2, 2, 1, 1, (u, v) => [u, v, 0, 1]), M.scarf));
  warm.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(warm);
  S.on = true;
}
/* 메뉴로 나가거나 같은 씬으로 다시 시작할 때: 눈덩이·눈사람·자국을 모두 치운다 */
export function clearSnowman() {
  if (!S.on) return;
  const W = ctx.W, sc = ctx.scene;
  [...S.balls].forEach(b => { unregister(b); sc.remove(b.mesh); disposeGeo(b.mesh); });
  S.men.forEach(m => {
    remove(W.trees, m.slot); remove(W.interact, m.it);
    if (m.head.mesh.parent === sc) { sc.remove(m.head.mesh); disposeGeo(m.head.mesh); }
    sc.remove(m.group); disposeGeo(m.group);
  });
  S.men = [];
  if (S.active) { sc.remove(S.active.mesh); disposeGeo(S.active.mesh); S.active = null; }
  S.mounds.forEach(o => sc.remove(o.m)); S.mounds = [];
  S.track.clear(); S.fx.clear(); setSnowRoll(0);
}

/* ── 눈덩이 ── */
function place(b) { b.mesh.scale.setScalar(b.r); b.mesh.position.set(b.x, groundAt(b.x, b.z) + b.r - sinkOf(b.r), b.z); }
function newBall(r, x, z) {
  const m = new THREE.Mesh(ballGeo(), M.snow); m.castShadow = m.receiveShadow = true;
  const b = { kind: 'ball', id: ++seq, mesh: m, r, x, z, slot: null, it: null, attachT: 0, tx: x, tz: z, trackNew: true };
  place(b); ctx.scene.add(m); return b;
}
/* 바닥에 내려놓은 눈덩이: 걷기 충돌(W.trees)과 조준(W.interact)에 넣는다 */
function register(b) {
  const W = ctx.W;
  b.slot = [b.x, b.z, b.r]; W.trees.push(b.slot);
  b.it = { id: 'snowball' + b.id, pos: [b.x, groundAt(b.x, b.z) + b.r, b.z], r: b.r + 1.6, hit: b.r, from: ['walk'],
    label: () => '굴리기', act: () => grab(b), click: () => breakBall(b), clickLabel: () => '부수기' };
  W.interact.push(b.it); S.balls.push(b);
}
function unregister(b) { const W = ctx.W; remove(W.trees, b.slot); remove(W.interact, b.it); remove(S.balls, b); b.slot = b.it = null; }
/* 눈덩이가 그 자리에 있을 수 있는지: 캠프 소품(BLOCKS)·나무와 다른 눈덩이·눈사람(W.trees)·부두에 닿으면 안 된다 */
function blockedFor(x, z, r) {
  const W = ctx.W;
  if (Math.hypot(x, z) > SNOW.range) return true;
  for (const b of BLOCKS) {
    if (b.round) { const rr = (b.x[1] - b.x[0]) / 2; if (Math.hypot(x - b.x[0] - rr, z - b.z[0] - rr) < rr + r) return true; continue; }
    const dx = Math.max(b.x[0] - x, 0, x - b.x[1]), dz = Math.max(b.z[0] - z, 0, z - b.z[1]);
    if (dx * dx + dz * dz < r * r) return true;
  }
  for (const t of W.trees) if (Math.hypot(x - t[0], z - t[1]) < t[2] + r) return true;
  for (const p of W.platforms) if (x > p.x[0] - r && x < p.x[1] + r && z > p.z[0] - r && z < p.z[1] + r) return true;
  return false;
}
/* 굴리는 눈덩이 자리: 플레이어 앞, 몸(반지름 0.35)에서 20cm 떨어진 곳 */
const aheadOf = (px, pz, yaw, r) => { const d = r + 0.55; return [px - Math.sin(yaw) * d, pz - Math.cos(yaw) * d]; };
const handsFull = () => { if (!state.item) return false; toast('손에 든 것을 먼저 내려놓자'); return true; };

/* ── game.js 가 부르는 것 ── */
export const snowRolling = () => !!S.active;
/* 걷는 속도 배율: 클수록 느려지고(최대 55%), 최대 크기가 되면 SNOW.slow */
export function snowSpeed() { const a = S.active; if (!a) return 1; return isMax(a) ? SNOW.slow : 1 - 0.45 * a.r / SNOW.max; }
/* 플레이어가 (nx, nz) 로 가면 앞의 눈덩이가 막히는지 */
export function rollBlocked(nx, nz) { const a = S.active; if (!a) return false; const [bx, bz] = aheadOf(nx, nz, player.yaw, a.r); return blockedFor(bx, bz, a.r); }
/* 발밑을 내려다보고 있고, 눈을 뭉칠 자리가 비어 있으면 "E 눈 뭉치기" */
export function snowStartable() {
  if (!S.on || S.active || state.mode !== 'walk' || player.pitch > -0.55) return false;
  const [x, z] = aheadOf(player.x, player.z, player.yaw, SNOW.start); return !blockedFor(x, z, SNOW.start);
}
export function startSnowball() {
  if (handsFull()) return;
  if (S.balls.length >= SNOW.maxBalls) { toast('눈덩이가 너무 많다'); return; }
  const [x, z] = aheadOf(player.x, player.z, player.yaw, SNOW.start);
  S.active = newBall(SNOW.start, x, z); sfx('snowPack'); toast('눈을 뭉쳤다'); updateHUD();
}
/* 내려놓은 눈덩이를 다시 굴린다. 처음 0.35초는 발 앞으로 끌려오기만 하고 커지지 않는다 */
function grab(b) {
  if (handsFull()) return;
  unregister(b); b.attachT = 0.35; b.trackNew = true; S.active = b;
  sfx('snowPack', 'grab'); if (isMax(b)) toast('눈덩이가 너무 무겁다'); updateHUD();
}
function nearBall() {
  const a = S.active; if (!a) return null; let best = null, gap = SNOW.near;
  for (const b of S.balls) { const g = Math.hypot(b.x - a.x, b.z - a.z) - b.r - a.r; if (g < gap) { gap = g; best = b; } }
  return best;
}
/* 눈사람이 이미 최대 개수면 붙어 있어도 "내려놓기" — 내려놓으면서 이유를 알려 준다 */
export const rollLabel = () => nearBall() && S.men.length < SNOW.maxMen ? '눈사람 만들기' : '내려놓기';
/* 굴리는 중 E: 다른 눈덩이에 붙어 있으면 눈사람, 아니면 내려놓기 */
export function rollAct() {
  const nb = nearBall();
  if (nb && S.men.length < SNOW.maxMen) combine(nb);
  else { dropBall(); if (nb) toast('눈사람은 세 개까지 만들 수 있다'); }
}
function dropBall() { const b = S.active; S.active = null; register(b); sfx('snowDrop', b.r); toast('눈덩이를 내려놓았다'); updateHUD(); }
function combine(body) {
  const head = S.active;
  if (S.men.length >= SNOW.maxMen) { toast('눈사람은 세 개까지 만들 수 있다'); return; }
  if (head.r < SNOW.min || body.r < SNOW.min) { toast('눈덩이가 너무 작다'); return; }
  unregister(body); S.active = null; S.men.push(buildMan(body, head));
  sfx('snowLift'); toast('눈사람을 만들었다'); updateHUD();
}
function breakBall(b) {
  unregister(b); S.fx.spawn(b.mesh.position, b.r); addMound(b.x, b.z, b.r);
  ctx.scene.remove(b.mesh); disposeGeo(b.mesh);
  sfx('snowBreak', b.r); toast('눈덩이를 부쉈다'); updateHUD();
}

/* ── 눈사람: 몸통 그룹을 만들고, 머리는 0.55초 동안 호를 그리며 올라간 뒤 그룹에 붙는다.
   장식은 0.5초부터 차례로 톡톡 커진다. 앞(+z)이 만든 사람을 본다 ── */
function buildMan(body, head) {
  const rb = body.r, rh = head.r, ov = 0.15 * Math.min(rb, rh), d = rb + rh - ov, by = rb - sinkOf(rb);
  const g = new THREE.Group(), decor = [], W = ctx.W;
  g.position.set(body.x, groundAt(body.x, body.z), body.z); g.rotation.y = Math.atan2(player.x - body.x, player.z - body.z);
  ctx.scene.add(g); g.updateMatrixWorld(true);
  g.add(body.mesh); body.mesh.position.set(0, by, 0);
  const bc = new V3(0, by, 0), hc = new V3(0, by + d, 0);
  const add = (m, delay, sound) => { m.userData.s0 = m.scale.clone(); m.scale.setScalar(1e-4); g.add(m); decor.push({ m, delay, sound, popped: false }); return m; };

  /* 눈: 납작한 조약돌 두 개 */
  [-1, 1].forEach((s, i) => {
    const dir = new V3(s * 0.32, 0.3, 0.9).normalize(), m = new THREE.Mesh(G.stone[i], M.stone);
    m.scale.setScalar(rh * 0.1); m.quaternion.setFromUnitVectors(UP, dir); m.rotateY(rnd(0, 6.3));
    m.position.copy(hc).addScaledVector(dir, rh * 0.985); add(m, 0.05 * i, true);
  });
  /* 코: 당근, 살짝 아래로 */
  { const dir = new V3(0, 0.04, 1).normalize(), tip = new V3(0, -0.12, 1).normalize(), m = new THREE.Mesh(G.carrot, M.carrot);
    m.scale.set(rh * 0.095, rh * 0.62, rh * 0.095); m.quaternion.setFromUnitVectors(UP, tip); m.rotateY(rnd(0, 6.3));
    m.position.copy(hc).addScaledVector(dir, rh * 0.9); add(m, 0.12, true); }
  /* 단추 두 개 */
  [0.42, 0.08].forEach((yy, i) => {
    const dir = new V3(0, yy, 1).normalize(), b = makeButton(rb * 0.1);
    b.quaternion.setFromUnitVectors(UP, dir); b.rotateY(0.3 + i); b.position.copy(bc).addScaledVector(dir, rb * 0.99); add(b, 0.22 + 0.07 * i, true);
  });
  /* 팔: 잔가지 + 곁가지 두 개 */
  [-1, 1].forEach(s => {
    const st = bc.clone().addScaledVector(new V3(s * 0.93, 0.35, 0.08).normalize(), rb * 0.92), dir = new V3(s, 0.5, 0.05).normalize(), L = 0.13 + rb * 0.45;
    add(twig(st, st.clone().addScaledVector(dir, L), 0.012, 0.006), 0.36, s > 0);
    const f1 = st.clone().addScaledVector(dir, L * 0.62); add(twig(f1, f1.clone().addScaledVector(new V3(s * 0.55, 1, 0.15).normalize(), L * 0.32), 0.006, 0.003), 0.4);
    const f2 = st.clone().addScaledVector(dir, L * 0.84); add(twig(f2, f2.clone().addScaledVector(new V3(s * 0.9, -0.25, -0.45).normalize(), L * 0.2), 0.005, 0.0025), 0.4);
  });
  /* 목도리: 두 공이 만나는 원(목) 둘레를 감는 니트 띠 + 매듭 + 몸통을 따라 흘러내리다 늘어지는 끝자락 두 개 + 술.
     띠 단면은 둥근 직사각형, 니트 골은 정점색. 머리가 몸통보다 커도 목 둘레를 계산하므로 맞게 감긴다 */
  const xN = (d * d + rb * rb - rh * rh) / (2 * d), a = Math.sqrt(Math.max(1e-4, rb * rb - xN * xN));
  const sc = clamp(Math.min(rb, rh) / 0.25, 0.7, 1.4), t = 0.04 * sc, yN = by + xN, a0 = Math.atan2(a, xN);
  const rib = c => 0.8 + 0.2 * Math.pow(Math.abs(Math.sin(c * Math.PI * 2.5)), 0.6);
  add(centered(new THREE.Mesh(param(96, 22, 14, 2, (u, v) => {
    const ph = u * Math.PI * 2, vv = v * Math.PI * 2, cx = spw(Math.cos(vv), 0.6), cy = spw(Math.sin(vv), 0.6);
    const r = a + t * 0.62 + t * 0.12 * Math.sin(3 * ph + 1) + t * 0.55 * cx, y = yN + t * 0.22 * Math.sin(ph + 0.4) + t * 1.35 * cy;
    return [Math.sin(ph) * r, y, Math.cos(ph) * r, rib(cy) * (0.96 + 0.04 * Math.sin(ph * 120)) * (cx < 0 ? 0.8 : 1)];
  }), M.scarf)), 0.46, true);
  const dirAt = (al, th) => new V3(Math.sin(al) * Math.sin(th), Math.cos(al), Math.sin(al) * Math.cos(th)), AM = 1.2;
  const tail = (th0, L, offA, ph, delay) => {
    /* u 를 따라 몸통 표면을 타고 내려가다(AM 까지) 그 뒤로는 곧게 늘어진다 */
    const at = u => {
      const s = u * L, al = Math.min(a0 + s / rb, AM), ex = Math.max(0, s - (AM - a0) * rb), th = th0 + 0.1 * u + 0.05 * Math.sin(u * 6 + ph);
      const dir = dirAt(al, th), ew = new V3(Math.cos(th), 0, -Math.sin(th)), off = t * (1.25 - 0.55 * Math.min(1, u * 2)) + offA, sw = t * 0.35 * Math.sin(u * 3.5 + ph) * u;
      return { c: bc.clone().addScaledVector(dir, rb + off).add(new V3(0, -ex, 0)).addScaledVector(ew, sw), dir, ew, w: t * 1.2 * (1 + 0.14 * u) };
    };
    add(centered(new THREE.Mesh(param(30, 14, 3, 1, (u, v) => {
      const q = at(u), vv = v * Math.PI * 2, cx = spw(Math.cos(vv), 0.35), cy = spw(Math.sin(vv), 0.35), th = t * 0.34 * Math.max(0.04, 1 - smooth(0.93, 1, u));
      const p = q.c.clone().addScaledVector(q.ew, q.w * cx).addScaledVector(q.dir, th * cy);
      return [p.x, p.y, p.z, rib(cx * 0.8) * (0.96 + 0.04 * Math.sin(u * L * 320)) * (cy < 0 ? 0.82 : 1)];
    }), M.scarf)), delay, true);
    const e = at(1);
    for (let i = 0; i < 7; i++) {
      const cx = -0.85 + i * 1.7 / 6, st = e.c.clone().addScaledVector(e.ew, e.w * cx), dd = new V3(0, -1, 0).addScaledVector(e.dir, 0.18).normalize();
      const fr = new THREE.Mesh(shade(new THREE.CylinderGeometry(t * 0.07, t * 0.1, t * (1.2 + 0.3 * Math.sin(i * 2.3)), 5), 0.85), M.scarf);
      fr.position.copy(st).addScaledVector(dd, t * 0.65); fr.quaternion.setFromUnitVectors(UP, dd); add(fr, delay + 0.06);
    }
  };
  tail(0.48, 0.16 + 0.12 * sc, 0, 0.3, 0.54); tail(0.78, (0.16 + 0.12 * sc) * 0.8, t * 0.45, 2.1, 0.58);
  { const out = dirAt(a0 + 0.04, 0.62), k = new THREE.Mesh(shade(new THREE.SphereGeometry(t * 1.25, 14, 10), 0.88), M.scarf);
    k.scale.set(1.25, 0.9, 0.75); k.quaternion.setFromUnitVectors(FWD, out); k.position.copy(bc).addScaledVector(out, rb + t * 1.5); add(k, 0.54); }

  g.traverse(c => { if (c.isMesh) c.castShadow = c.receiveShadow = true; });
  const m = { kind: 'man', id: ++seq, group: g, body, head, x: body.x, z: body.z, rb, rh, hH: by + d + rh, slot: [body.x, body.z, Math.max(rb, rh * 0.9)], it: null,
    anim: { t: 0, from: head.mesh.position.clone(), to: g.localToWorld(hc.clone()), decor, attached: false } };
  W.trees.push(m.slot);
  return m;
}
/* 다 만들어진 뒤에야 조준에 넣는다 (만드는 도중에는 부술 수 없다). E 는 아무 일도 하지 않고, 빈손 클릭으로 부순다 */
function regMan(m) {
  m.it = { id: 'snowman' + m.id, pos: [m.x, groundAt(m.x, m.z) + m.hH * 0.5, m.z], r: Math.max(m.rb, m.rh) + 1.7, hit: m.hH * 0.45, from: ['walk'],
    label: () => null, act: () => {}, click: () => breakMan(m), clickLabel: () => '눈사람 부수기' };
  ctx.W.interact.push(m.it);
}
function breakMan(m) {
  const W = ctx.W, c1 = new V3(), c2 = new V3();
  remove(W.trees, m.slot); remove(W.interact, m.it); remove(S.men, m);
  m.body.mesh.getWorldPosition(c1); m.head.mesh.getWorldPosition(c2);
  S.fx.spawn(c1, m.rb); S.fx.spawn(c2, m.rh); addMound(m.x, m.z, m.rb * 1.15);
  ctx.scene.remove(m.group); disposeGeo(m.group);
  sfx('snowBreak', Math.max(m.rb, m.rh)); toast('눈사람을 부쉈다'); updateHUD();
}
function updateMen(dt) {
  for (const m of S.men) {
    const a = m.anim; if (!a) continue;
    a.t += dt; const k = Math.min(1, a.t / 0.55), e = k * k * (3 - 2 * k);
    if (!a.attached) {
      m.head.mesh.position.lerpVectors(a.from, a.to, e); m.head.mesh.position.y += Math.sin(Math.PI * k) * 0.35;
      if (k >= 1) { a.attached = true; m.group.attach(m.head.mesh); sfx('snowDrop', m.rh); }
    }
    for (const dc of a.decor) {
      const q = clamp((a.t - 0.5 - dc.delay) / 0.25, 0, 1);
      if (q > 0 && !dc.popped) { dc.popped = true; if (dc.sound) sfx('snowPop'); }
      dc.m.scale.copy(dc.m.userData.s0).multiplyScalar(q <= 0 ? 1e-4 : backOut(q));
    }
    if (a.t > 1.6) { a.decor.forEach(dc => dc.m.scale.copy(dc.m.userData.s0)); m.anim = null; regMan(m); }
  }
}

/* 부서진 자리의 눈 더미: 4초 뒤부터 8초에 걸쳐 내려앉아 사라진다 */
function addMound(x, z, r) {
  const m = new THREE.Mesh(G.mound, M.snow); m.position.set(x, groundAt(x, z) - 0.01, z); m.scale.set(r * 1.15, r * 0.32, r * 1.15); m.rotation.y = rnd(0, 6.3);
  m.receiveShadow = true; ctx.scene.add(m); S.mounds.push({ m, t: 0, y0: r * 0.32 });
}
function updateMounds(dt) {
  S.mounds = S.mounds.filter(o => {
    o.t += dt; o.m.scale.y = Math.max(1e-3, o.y0 * (1 - smooth(4, 12, o.t)));
    if (o.t > 12) { ctx.scene.remove(o.m); return false; } return true;
  });
}

/* ── 굴리기: 눈덩이가 발 앞 자리로 따라온다. 한 프레임에 초당 4m 이상 움직이지 않는다 (시선을 휙 돌려도 순간이동하지 않게) ── */
const _ax = new V3(), _q = new THREE.Quaternion();
function rollTo(o, nx, nz, grow) {
  const dx = nx - o.x, dz = nz - o.z, ds = Math.hypot(dx, dz); if (ds < 1e-6) return 0;
  _ax.set(dz, 0, -dx).divideScalar(ds); _q.setFromAxisAngle(_ax, ds / o.r); o.mesh.quaternion.premultiply(_q);
  if (grow) { const was = isMax(o); o.r = Math.min(SNOW.max, Math.sqrt(o.r * o.r + 2 * SNOW.grow * ds)); if (!was && isMax(o)) toast('눈덩이가 너무 무겁다'); }
  o.x = nx; o.z = nz; place(o);
  if (grow) {
    const tdx = nx - o.tx, tdz = nz - o.tz;
    if (o.trackNew || Math.hypot(tdx, tdz) > 0.06) {
      S.track.push(nx, nz, o.trackNew ? dx : tdx, o.trackNew ? dz : tdz, o.r * 0.6 * rnd(0.94, 1.06), !o.trackNew);
      o.trackNew = false; o.tx = nx; o.tz = nz;
    }
  }
  return ds;
}

/* ── 매 프레임 (main.js). 멈춘 동안에는 dt = 0 으로 불러 굴리는 소리도 잦아든다 ── */
export function updateSnowman(dt) {
  if (!S.on) return;
  const a = S.active; let lv = 0;
  if (a && dt > 0) {
    const [tx, tz] = aheadOf(player.x, player.z, player.yaw, a.r), dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    if (d > 1e-5) {
      const k = Math.min(d, (a.attachT > 0 ? 6 : 4) * dt) / d, nx = a.x + dx * k, nz = a.z + dz * k;
      if (!blockedFor(nx, nz, a.r)) { const ds = rollTo(a, nx, nz, a.attachT <= 0); if (a.attachT <= 0) lv = ds / dt / 2.6; }
    }
    if (a.attachT > 0) a.attachT -= dt;
  }
  setSnowRoll(clamp(lv, 0, 1), a ? a.r / SNOW.max : 0);
  updateMen(dt); updateMounds(dt); S.fx.update(dt);
}

/* 눈덩이가 굴러가거나 눈사람이 만들어지는 중 — main.js 가 그동안 그림자맵을 매 프레임 갱신한다 */
export const snowMoving = () => !!S.active || S.men.some(m => m.anim);