import * as THREE from 'three';
import { ctx } from './state.js';
import { rnd, fbm, std, smoothM, METAL, shadowed, bar, jitter, softTex, shadowTex, canvasTex, NOISE_GLSL } from './util.js';
import { terrainH } from './terrain.js';
import { tex } from './textures.js';

const wood = (color, rx, ry, extra) => smoothM(color, Object.assign({ roughness: 0.75 }, tex('wood', rx, ry, 0.25), extra || {}));
const cloth = (color, rx, extra) => smoothM(color, Object.assign({ roughness: 0.95 }, tex('fabric', rx, rx, 0.3), extra || {}));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg || 28);
function sagPlane(w, h, sag, seg = 8) { const g = new THREE.PlaneGeometry(w, h, seg, seg); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) / w + 0.5, v = p.getY(i) / h + 0.5; p.setZ(i, sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)); } g.computeVertexNormals(); return g; }

/* 차 안 내비 화면: 간단한 지도 */
const naviTex = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#0d1522'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
  for (let x = 0; x <= w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y <= h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.fillStyle = '#1e4a66'; g.beginPath(); g.ellipse(196, 38, 58, 26, -0.35, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1b3222'; g.beginPath(); g.ellipse(48, 96, 46, 22, 0.25, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(110, 108, 34, 16, -0.2, 0, Math.PI * 2); g.fill();
  const road = (wd, col) => { g.strokeStyle = col; g.lineWidth = wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(-10, 112); g.bezierCurveTo(60, 104, 92, 60, 128, 64); g.bezierCurveTo(168, 68, 200, 102, 270, 92); g.stroke(); };
  road(8, '#3a4557'); road(3.5, '#8c96a8');
  g.strokeStyle = '#4c5668'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(128, 64); g.quadraticCurveTo(150, 30, 175, 6); g.stroke();
  g.fillStyle = 'rgba(90,168,255,0.22)'; g.beginPath(); g.arc(128, 64, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5aa8ff'; g.beginPath(); g.moveTo(128, 54); g.lineTo(135, 70); g.lineTo(128, 66); g.lineTo(121, 70); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, w, 18);
  g.fillStyle = 'rgba(255,255,255,0.88)'; g.font = 'bold 10px sans-serif'; g.textBaseline = 'middle';
  g.textAlign = 'left'; g.fillText('QUIET CAMP', 8, 9); g.textAlign = 'right'; g.fillText('2.4 km', w - 8, 9);
});
naviTex.colorSpace = THREE.SRGBColorSpace;

export function contactShadow(x, z, sx, sz, op) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: op || 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, terrainH(x, z, ctx.W.cfg) + 0.02, z); ctx.scene.add(m);
}

/* ── 랜턴 ── */
export function makeLantern(lit) {
  const g = new THREE.Group(), frame = METAL();
  g.add(new THREE.Mesh(lathe([[0, 0], [0.075, 0], [0.08, 0.02], [0.07, 0.04], [0, 0.04]]), frame));
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.14, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x7a6a58, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); glass.position.y = 0.09; g.add(glass);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), new THREE.MeshBasicMaterial({ color: 0x8a7a62 })); core.position.y = 0.09; g.add(core);
  g.add(at(new THREE.Mesh(lathe([[0, 0], [0.078, 0], [0.06, 0.03], [0.03, 0.05], [0, 0.05]]), frame), 0, 0.16, 0));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.005, 6, 16, Math.PI), frame); handle.position.y = 0.21; g.add(handle);
  g.userData.lit = null;
  g.userData.setLit = on => { on = !!on; if (on === g.userData.lit) return; g.userData.lit = on; core.material.color.setHex(on ? 0xfff0c8 : 0x8a7a62); if (on) { glass.material.color.setHex(0xffd9a0).multiplyScalar(1.5); glass.material.opacity = 0.55; } else { glass.material.color.setHex(0x7a6a58); glass.material.opacity = 0.35; } };
  g.userData.setLit(!!lit);
  return g;
}
export function makeTent() {
  const W = ctx.W, g = new THREE.Group(), Wd = 2.4, H = 1.7, L = 2.6, linings = [];
  const clothM = cloth(0xe0783a, 8), flyM = cloth(0xc4602a, 8), liningM = cloth(0xc9673a, 8, { side: THREE.BackSide }), pole = METAL(), cord = smoothM(0xbfb7a8);
  const slab = (m, halfW, h, y0, len, sag, inner) => { const side = Math.hypot(halfW, h), ang = Math.atan2(h, halfW); [-1, 1].forEach(sx => {
    const geo = sagPlane(side, len, -sag, 10); geo.rotateX(-Math.PI / 2); const w = new THREE.Mesh(geo, m); w.position.set(sx * halfW / 2, y0 + h / 2, 0); w.rotation.z = -sx * ang; g.add(w);
    if (inner) { const li = new THREE.Mesh(geo, inner); li.position.copy(w.position); li.rotation.copy(w.rotation); li.translateY(-0.035); g.add(li); linings.push(li); }
  }); };
  slab(clothM, Wd / 2, H, 0, L, 0.05, liningM); slab(flyM, Wd / 2 + 0.12, H + 0.02, 0.06, L + 0.4, 0.07, null);
  g.add(bar([0, H + 0.04, -L / 2 - 0.28], [0, H + 0.04, L / 2 + 0.28], 0.025, pole, 8));
  [-L / 2 - 0.05, L / 2 + 0.05].forEach(z => [-1, 1].forEach(sx => g.add(bar([sx * (Wd / 2 + 0.12), 0, z], [0, H + 0.03, z], 0.018, pole, 8))));
  const sh = new THREE.Shape(); sh.moveTo(-Wd / 2, 0); sh.lineTo(Wd / 2, 0); sh.lineTo(0, H);
  const backGeo = new THREE.ShapeGeometry(sh);
  const back = new THREE.Mesh(backGeo, cloth(0xb8562a, 4)); back.position.z = L / 2; g.add(back);
  const backIn = new THREE.Mesh(backGeo, cloth(0xa8502a, 4, { side: THREE.BackSide })); backIn.position.z = L / 2 - 0.035; g.add(backIn); linings.push(backIn);
  [-1, 1].forEach(sx => g.add(bar([sx * 1.05, 0.22, -L / 2 - 0.03], [sx * 0.38, 1.17, -L / 2 - 0.03], 0.045, cloth(0xd46a30, 2), 8)));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.05, L), cloth(0x3a2d24, 6)); floor.position.y = 0.025; g.add(floor);
  const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.35, 4, 14), cloth(0x2c4a7a, 4)); bag.rotation.x = Math.PI / 2; bag.scale.set(1.05, 1, 0.3); bag.position.set(0.5, 0.15, 0.05); g.add(bag);
  const pillow = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.28, 4, 10), cloth(0xd9d2c5, 3)); pillow.rotation.z = Math.PI / 2; pillow.scale.set(1, 1, 0.55); pillow.position.set(0.5, 0.3, 0.98); g.add(pillow);
  const mat2 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.02, 0.45), cloth(0x6b5a45, 3)); mat2.position.set(0, 0.01, -L / 2 - 0.4); g.add(mat2);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { g.add(bar([0, H + 0.04, sz * (L / 2 + 0.28)], [sx * 1.95, 0.02, sz * 1.75], 0.004, cord, 4)); const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), pole); stake.position.set(sx * 1.95, 0.04, sz * 1.75); stake.rotation.z = -sx * 0.45; g.add(stake); });
  const lamp = makeLantern(W.tentLampLit); lamp.scale.setScalar(0.7); lamp.position.set(-0.75, 0.05, 0.9); g.add(lamp); W.tentLampObj = lamp;
  W.tentLamp = new THREE.PointLight(0xffc890, W.tentLampLit ? W.tm.tentLamp : 0, 4.5, 2); W.tentLamp.position.set(-0.6, 0.35, 0.8); g.add(W.tentLamp);
  shadowed(g); linings.forEach(li => { li.castShadow = false; }); return g;
}
export function makeChair() {
  const g = new THREE.Group(), fabric = cloth(0x2f4f6a, 3, { side: THREE.DoubleSide }), frame = METAL(), arm = wood(0x8a6a48, 2, 1);
  const seatG = sagPlane(0.56, 0.5, -0.035); seatG.rotateX(-Math.PI / 2); const seat = new THREE.Mesh(seatG, fabric); seat.position.set(0, 0.46, 0); g.add(seat);
  const back = new THREE.Mesh(sagPlane(0.56, 0.62, 0.03), fabric); back.position.set(0, 0.76, 0.28); back.rotation.x = 0.28; g.add(back);
  [-0.29, 0.29].forEach(x => { g.add(bar([x, 0.02, -0.26], [x, 0.66, 0.26], 0.015, frame)); g.add(bar([x, 0.02, 0.26], [x, 0.66, -0.26], 0.015, frame)); g.add(bar([x, 0.66, -0.26], [x, 0.66, 0.26], 0.015, frame)); const a = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.5), arm); a.position.set(x, 0.685, 0); g.add(a); g.add(bar([x, 0.66, 0.26], [x, 1.06, 0.38], 0.015, frame)); });
  g.add(bar([-0.29, 0.02, -0.26], [0.29, 0.02, -0.26], 0.015, frame)); g.add(bar([-0.29, 0.02, 0.26], [0.29, 0.02, 0.26], 0.015, frame)); g.add(bar([-0.29, 1.06, 0.38], [0.29, 1.06, 0.38], 0.015, frame)); g.add(bar([-0.29, 0.46, -0.25], [0.29, 0.46, -0.25], 0.012, frame)); g.add(bar([-0.29, 0.46, 0.25], [0.29, 0.46, 0.25], 0.012, frame));
  return shadowed(g);
}
export function makeTable() {
  const W = ctx.W, g = new THREE.Group(), frame = METAL();
  for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.1), wood(new THREE.Color(0x7a5636).multiplyScalar(rnd(0.9, 1.08)), 2, 0.5)); s.position.set(0, 0.5, -0.24 + i * 0.12); g.add(s); }
  [-0.26, 0.26].forEach(x => { g.add(bar([x, 0, -0.22], [x, 0.485, 0.22], 0.012, frame)); g.add(bar([x, 0, 0.22], [x, 0.485, -0.22], 0.012, frame)); });
  g.add(bar([-0.26, 0.24, 0], [0.26, 0.24, 0], 0.012, frame));
  const lamp = makeLantern(W.lanternLit); lamp.position.set(0.05, 0.515, 0); g.add(lamp); W.lanternObj = lamp;
  return shadowed(g);
}
export function makeFire() {
  const W = ctx.W, g = new THREE.Group(), char = smoothM(0x3d2a1c, Object.assign({ roughness: 1 }, tex('bark', 1, 1, 0.5)));
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const s = new THREE.Mesh(jitter(new THREE.DodecahedronGeometry(rnd(0.11, 0.16), 0), 0.3), std(new THREE.Color(0x6f6a64).multiplyScalar(rnd(0.85, 1.1)), tex('rock', 1, 1, 0.45))); s.position.set(Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5); s.rotation.set(rnd(0, 3), rnd(0, 3), 0); g.add(s); }
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.3; g.add(bar([Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32], [Math.cos(a + 2.4) * 0.05, 0.42, Math.sin(a + 2.4) * 0.05], 0.045, char, 8)); }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.34, 14), std(0x2b2724)); ash.rotation.x = -Math.PI / 2; ash.position.y = 0.03; g.add(ash);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0x2a1c14 })); core.position.y = 0.15; core.scale.y = 0.6; g.add(core); W.emberCore = core;
  W.fireLight = new THREE.PointLight(0xff8a3a, 0, 13, 2); W.fireLight.position.y = 0.55; g.add(W.fireLight);
  W.fireLight.shadow.mapSize.set(512, 512); W.fireLight.shadow.camera.near = 0.15; W.fireLight.shadow.camera.far = 16; W.fireLight.shadow.bias = -0.003; W.fireLight.shadow.normalBias = 0.02;
  const pole = METAL(), iron = smoothM(0x3b3b3f, { metalness: 0.7, roughness: 0.4 });
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.5; g.add(bar([Math.cos(a) * 0.62, 0.02, Math.sin(a) * 0.62], [0, 1.28, 0], 0.012, pole)); }
  g.add(bar([0, 1.28, 0], [0, 1.0, 0], 0.005, pole, 4));
  const kettle = new THREE.Group();
  kettle.add(new THREE.Mesh(lathe([[0, 0], [0.075, 0], [0.105, 0.02], [0.115, 0.07], [0.1, 0.12], [0.06, 0.145], [0.045, 0.15], [0.045, 0.165], [0, 0.165]]), iron));
  kettle.add(at(new THREE.Mesh(lathe([[0, 0], [0.05, 0], [0.055, 0.01], [0.02, 0.03], [0.012, 0.045], [0, 0.045]]), iron), 0, 0.165, 0));
  kettle.add(bar([0.1, 0.04, 0], [0.19, 0.12, 0], 0.014, iron, 8));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 6, 16, Math.PI), pole); handle.position.y = 0.16; kettle.add(handle);
  kettle.position.y = 0.85; g.add(kettle);
  shadowed(g);
  /* 불꽃: 노이즈로 일렁이는 판 4장을 45° 간격으로 */
  const flameMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: W.uTime, uK: { value: 0 }, uPh: { value: 0 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: NOISE_GLSL + `uniform float uTime,uK,uPh;varying vec2 vUv;
      void main(){float x=vUv.x*2.0-1.0;float y=clamp(vUv.y,0.0,1.0);float t=uTime+uPh;
        float n=vnoise(vec2(vUv.x*3.0+uPh,y*4.0-t*2.4))*0.6+vnoise(vec2(vUv.x*7.0+3.0,y*9.0-t*3.8))*0.4;
        float w=(1.0-y)*0.85+0.12;
        float shape=1.0-smoothstep(w*0.4,w*0.95,abs(x)+(n-0.5)*0.55);
        float body=shape*(1.0-smoothstep(0.45,1.0,y+(n-0.5)*0.4))*smoothstep(0.0,0.1,y);
        float core=smoothstep(0.45,1.0,body);
        vec3 col=mix(vec3(1.0,0.22,0.02),vec3(1.0,0.72,0.18),core);col=mix(col,vec3(1.0,0.95,0.62),pow(core,3.0)*0.85);
        float a=clamp(body*uK,0.0,1.0);gl_FragColor=vec4(col*a*1.5,a);}`,
  });
  W.flames = [];
  for (let i = 0; i < 4; i++) { const m = flameMat.clone(); m.uniforms.uTime = W.uTime; m.uniforms.uPh.value = i * 1.7; const f = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), m); f.position.set(0, 0.62, 0); f.rotation.y = i * Math.PI / 4; f.userData.noAO = true; f.frustumCulled = false; f.castShadow = false; g.add(f); W.flames.push(f); }
  W.logGlow = [];
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.3; const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0 })); s.position.set(Math.cos(a + 2.4) * 0.08, 0.38, Math.sin(a + 2.4) * 0.08); s.userData.noAO = true; s.castShadow = false; g.add(s); W.logGlow.push(s); }
  return g;
}

/* ── 자동차 (앞이 -z). 실내 z -1.0 ~ 1.7, 트렁크 z 1.7 ~ 2.4. 뒷유리는 좌석 뒤 35cm, 사이에 뒷선반 ── */
export function makeCar() {
  const W = ctx.W, g = new THREE.Group(), body = new THREE.MeshPhysicalMaterial({ color: 0x8f2b28, roughness: 0.38, metalness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.1 }), dark = std(0x24252a, { roughness: 0.8 }), chrome = std(0xb8bcc2, { metalness: 0.85, roughness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x7f9fb8, transparent: true, opacity: 0.28, roughness: 0.03, metalness: 0.0, envMapIntensity: 1.6, side: THREE.DoubleSide });
  const add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; };
  add(new THREE.BoxGeometry(1.9, 0.5, 1.4), body, 0, 0.66, -1.7);
  add(new THREE.BoxGeometry(1.9, 0.5, 0.875), body, 0, 0.66, 2.0);
  add(new THREE.BoxGeometry(1.9, 0.08, 2.7), dark, 0, 0.47, 0.35);
  add(new THREE.BoxGeometry(1.94, 0.12, 4.75), dark, 0, 0.44, 0.05);
  add(new THREE.BoxGeometry(1.85, 0.28, 1.5), body, 0, 1.0, -1.55);
  add(new THREE.BoxGeometry(1.8, 0.07, 2.3), body, 0, 1.86, 0.46); add(new THREE.BoxGeometry(1.7, 0.02, 2.2), dark, 0, 1.815, 0.46);
  add(new THREE.BoxGeometry(1.75, 0.05, 0.9), dark, 0, 0.9, 2.0); add(new THREE.BoxGeometry(1.75, 0.35, 0.08), body, 0, 1.06, 2.49);
  [-0.84, 0.84].forEach(x => add(new THREE.BoxGeometry(0.08, 0.35, 0.8), body, x, 1.06, 2.1));
  [-0.88, 0.88].forEach(x => {
    add(new THREE.BoxGeometry(0.09, 0.95, 0.09), dark, x, 1.45, -0.9, 0.55);
    add(new THREE.BoxGeometry(0.09, 0.75, 0.09), dark, x, 1.5, 0.7);
    add(new THREE.BoxGeometry(0.09, 0.8, 0.09), dark, x, 1.5, 1.75, -0.49);
    add(new THREE.BoxGeometry(0.1, 0.9, 2.9), body, x, 0.7, 0.4); add(new THREE.BoxGeometry(0.05, 0.85, 2.8), dark, x * 0.93, 0.7, 0.4);
    add(new THREE.PlaneGeometry(1.35, 0.65), glass, x, 1.48, 0.0, 0, Math.PI / 2);
    add(new THREE.PlaneGeometry(0.85, 0.62), glass, x, 1.47, 1.2, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.18), chrome, x * 1.06, 1.0, 0.1); add(new THREE.BoxGeometry(0.03, 0.03, 0.18), chrome, x * 1.06, 1.0, 1.3);
    add(new THREE.BoxGeometry(0.22, 0.12, 0.08), dark, x * 1.1, 1.22, -0.65);
    add(new THREE.BoxGeometry(0.28, 0.14, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff1c4 }), x * 0.65, 0.85, -2.31);
    add(new THREE.BoxGeometry(0.34, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2a2a }), x * 0.62, 0.9, 2.55);
  });
  add(new THREE.PlaneGeometry(1.7, 0.95), glass, 0, 1.48, -0.95, 0.6);
  add(new THREE.PlaneGeometry(1.6, 0.74), glass, 0, 1.525, 1.775, -0.49);
  add(new THREE.BoxGeometry(1.7, 0.05, 0.36), dark, 0, 1.18, 1.775);
  add(new THREE.BoxGeometry(0.5, 0.12, 0.02), smoothM(0xe8e8e8), 0, 0.7, 2.56);
  add(new THREE.BoxGeometry(1.9, 0.12, 0.1), chrome, 0, 0.5, -2.33); add(new THREE.BoxGeometry(1.9, 0.12, 0.1), chrome, 0, 0.5, 2.55); add(new THREE.BoxGeometry(0.9, 0.22, 0.04), dark, 0, 0.82, -2.33);
  [[-1.02, -1.55], [1.02, -1.55], [-1.02, 1.75], [1.02, 1.75]].forEach(([x, z]) => { add(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18), std(0x141414, { roughness: 0.95 }), x, 0.36, z, 0, 0, Math.PI / 2); add(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10), chrome, x, 0.36, z, 0, 0, Math.PI / 2); });

  const D = -0.45, P = 0.45;
  const trim = std(0x2e3036, { roughness: 0.85 }), seatM = cloth(0x3a3f47, 2), carpet = cloth(0x1e2024, 4), ivory = std(0xd8dfe8, { roughness: 0.6 }), black = std(0x141416, { roughness: 0.5 });
  [D, P].forEach(x => {
    add(new THREE.BoxGeometry(0.45, 0.01, 0.5), carpet, x, 0.515, -0.25);
    add(new THREE.BoxGeometry(0.5, 0.35, 0.5), seatM, x, 0.68, 0.45); add(new THREE.BoxGeometry(0.5, 0.75, 0.15), seatM, x, 1.2, 0.75);
    add(new THREE.BoxGeometry(0.26, 0.15, 0.1), seatM, x, 1.7, 0.76);
    [-0.1, 0.1].forEach(dx => g.add(bar([x + dx, 1.57, 0.76], [x + dx, 1.63, 0.76], 0.008, chrome, 6)));
    add(new THREE.BoxGeometry(0.4, 0.02, 0.18), trim, x, 1.78, -0.55);
    add(new THREE.BoxGeometry(0.45, 0.01, 0.4), carpet, x, 0.515, 1.05);
  });
  add(new THREE.BoxGeometry(1.4, 0.35, 0.55), seatM, 0, 0.68, 1.27); add(new THREE.BoxGeometry(1.4, 0.6, 0.15), seatM, 0, 1.1, 1.52);
  [-0.4, 0.4].forEach(x => add(new THREE.BoxGeometry(0.26, 0.15, 0.1), seatM, x, 1.475, 1.52));
  add(new THREE.BoxGeometry(0.34, 0.3, 0.9), trim, 0, 0.66, 0.3);
  add(new THREE.BoxGeometry(0.3, 0.05, 0.3), seatM, 0, 0.835, 0.62);
  [-0.08, 0.08].forEach(x => add(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), black, x, 0.815, 0.2));
  g.add(bar([0, 0.8, -0.05], [0.02, 0.98, -0.12], 0.012, chrome, 8)); add(new THREE.SphereGeometry(0.035, 10, 8), black, 0.02, 0.99, -0.12);
  add(new THREE.BoxGeometry(1.8, 0.32, 0.5), dark, 0, 0.99, -0.95);
  add(new THREE.BoxGeometry(0.55, 0.16, 0.02), trim, P, 0.95, -0.685);
  add(new THREE.BoxGeometry(0.46, 0.26, 0.02), black, 0, 0.97, -0.685);
  add(new THREE.PlaneGeometry(0.42, 0.22), new THREE.MeshBasicMaterial({ map: naviTex }), 0, 0.97, -0.672);
  [-0.3, 0.3].forEach(x => add(new THREE.BoxGeometry(0.06, 0.05, 0.02), black, x, 1.115, -0.685));
  add(new THREE.BoxGeometry(0.5, 0.18, 0.03), black, D, 1.06, -0.675);
  [D - 0.1, D + 0.1].forEach(x => add(new THREE.CylinderGeometry(0.055, 0.055, 0.01, 16), ivory, x, 1.06, -0.652, Math.PI / 2));
  g.add(bar([D, 0.98, -0.7], [D, 1.05, -0.45], 0.03, dark, 8));
  add(new THREE.TorusGeometry(0.18, 0.025, 8, 24), dark, D, 1.05, -0.45, -0.45);
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12), dark, D, 1.05, -0.45, Math.PI / 2 - 0.45);
  [[D - 0.18, 1.05, -0.45], [D + 0.18, 1.05, -0.45], [D, 0.888, -0.372]].forEach(p => g.add(bar([D, 1.05, -0.45], p, 0.012, dark, 6)));
  [D - 0.1, D + 0.1].forEach(x => add(new THREE.BoxGeometry(0.08, 0.12, 0.02), black, x, 0.6, -0.85, -0.5));
  add(new THREE.BoxGeometry(0.3, 0.08, 0.03), dark, 0, 1.66, -0.55);
  [-1, 1].forEach(s => { add(new THREE.BoxGeometry(0.1, 0.06, 0.55), trim, s * 0.8, 1.02, 0.3); add(new THREE.BoxGeometry(0.03, 0.03, 0.12), chrome, s * 0.78, 1.12, -0.1); add(new THREE.BoxGeometry(0.1, 0.06, 0.5), trim, s * 0.8, 1.02, 1.25); });
  add(new THREE.BoxGeometry(0.36, 0.06, 0.32), cloth(0x4b5a3f, 3), P, 0.885, 0.42, 0, 0.2);

  const lid = new THREE.Group(); lid.position.set(0, 1.245, 1.95); const lidM = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.06, 0.62), body); lidM.position.z = 0.31; lid.add(lidM); g.add(lid); W.trunkLid = lid;
  const cooler = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.35), smoothM(0x3d6f9e)); cooler.position.set(-0.4, 1.06, 2.15); g.add(cooler);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.4), cloth(0x6b5a3e, 3)); bag.position.set(0.4, 1.04, 2.2); g.add(bag);
  shadowed(g); g.traverse(o => { if (o.material === glass) o.castShadow = false; }); return g;
}

/* ── 쿨러, 배낭, 장작더미(4-3-2 피라미드), 도끼 박힌 그루터기, 잔가지 ── */
export function makeProps() {
  const scene = ctx.scene, cooler = new THREE.Group();
  const cb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.38), smoothM(0x3d6f9e, { roughness: 0.6 })); cb.position.y = 0.19; cooler.add(cb);
  const cl = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.07, 0.4), smoothM(0xdde6ee, { roughness: 0.5 })); cl.position.y = 0.415; cooler.add(cl);
  cooler.add(bar([-0.2, 0.46, 0], [0.2, 0.46, 0], 0.012, METAL())); cooler.position.set(2.4, 0, 0.6); cooler.rotation.y = 0.2; scene.add(shadowed(cooler));
  const pack = new THREE.Group(), pm = cloth(0x4d6b3a, 3), pm2 = cloth(0x3e5730, 3);
  const pb = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.26, 4, 12), pm); pb.scale.set(1.1, 1, 0.65); pb.position.y = 0.28; pack.add(pb);
  const pl = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.14, 4, 12), pm2); pl.rotation.z = Math.PI / 2; pl.scale.set(1, 1, 0.7); pl.position.set(0, 0.5, 0.02); pack.add(pl);
  const pp = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.12, 4, 10), pm2); pp.scale.set(1.2, 1, 0.5); pp.position.set(0, 0.2, 0.14); pack.add(pp);
  [-0.1, 0.1].forEach(x => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.02), smoothM(0x2b2b2b)); s.position.set(x, 0.28, -0.12); pack.add(s); });
  pack.position.set(2.95, 0, 0.3); pack.rotation.set(0, -0.6, 0.12); scene.add(shadowed(pack));

  const bark = smoothM(0x5a3d28, Object.assign({ roughness: 0.95 }, tex('bark', 1, 1, 0.5))), cut = smoothM(0xc9a97c, Object.assign({ roughness: 0.85 }, tex('wood', 1, 1, 0.3)));
  const pile = new THREE.Group();
  [[-0.24, -0.08, 0.08, 0.24], [-0.16, 0, 0.16], [-0.08, 0.08]].forEach((zs, r) => zs.forEach(z => {
    const rad = rnd(0.068, 0.082), l = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, rnd(0.5, 0.6), 10), [bark, cut, cut]);
    l.rotation.set(rnd(0, 6.3), rnd(-0.05, 0.05), Math.PI / 2); l.position.set(rnd(-0.03, 0.03), 0.075 + r * 0.139, z); pile.add(l);
  }));
  pile.position.set(1.85, 0, -2.55); pile.rotation.y = -0.35; scene.add(shadowed(pile)); contactShadow(1.85, -2.55, 0.95, 0.8, 0.6);
  const stump = new THREE.Group();
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.32, 12), [bark, cut, cut]); st.position.y = 0.16; stump.add(st);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.075, 0.025), std(0x3a3d42, { metalness: 0.7, roughness: 0.35 })); head.position.set(0.02, 0.35, 0); head.rotation.z = 0.15; stump.add(head);
  stump.add(bar([0.06, 0.34, 0.01], [0.3, 0.62, 0.05], 0.014, wood(0x9a7a52, 1, 1), 8));
  stump.position.set(2.55, 0, -1.95); stump.rotation.y = 0.5; scene.add(shadowed(stump)); contactShadow(2.55, -1.95, 0.55, 0.55, 0.6);
  for (let i = 0; i < 6; i++) { const x = rnd(1.5, 2.5), z = rnd(-2.95, -2.15), a = rnd(0, 6.3), L = rnd(0.18, 0.32); scene.add(shadowed(bar([x - Math.cos(a) * L / 2, 0.012, z - Math.sin(a) * L / 2], [x + Math.cos(a) * L / 2, 0.012, z + Math.sin(a) * L / 2], rnd(0.008, 0.014), bark, 6))); }
  for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(rnd(0.06, 0.12), 0.012, rnd(0.03, 0.06)), bark); c.position.set(rnd(1.6, 2.6), 0.008, rnd(-2.9, -2.1)); c.rotation.set(rnd(-0.2, 0.2), rnd(0, 6.3), 0); scene.add(shadowed(c)); }
}
export function makeDock() {
  const W = ctx.W, g = new THREE.Group(), rail = wood(0x7a5636, 6, 1), post = smoothM(0x55402e, Object.assign({ roughness: 0.9 }, tex('bark', 1, 2, 0.5))), rope = smoothM(0xc9b48a, { roughness: 1 });
  for (let i = 0; i < 13; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 0.8), wood(new THREE.Color(0x7a5636).multiplyScalar(rnd(0.88, 1.08)), 2, 1)); p.position.set(5.7, 0.33, -8.3 - i * 0.87); g.add(p); }
  for (let i = 0; i < 5; i++) [4.98, 6.42].forEach(x => { const po = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 9), post); po.position.set(x, -0.4, -8.5 - i * 2.6); g.add(po); });
  g.add(bar([6.42, 0.95, -8.2], [6.42, 0.95, -19.0], 0.025, rail, 6));
  for (let i = 0; i < 5; i++) g.add(bar([6.42, 0.36, -8.5 - i * 2.6], [6.42, 0.95, -8.5 - i * 2.6], 0.025, rail, 6));
  g.add(bar([6.42, 0.36, -19.1], [6.42, 1.55, -19.1], 0.03, post, 7));
  const lamp = makeLantern(W.tm.lantern > 0.5); lamp.scale.setScalar(0.8); lamp.position.set(6.42, 1.57, -19.1); g.add(lamp); W.dockLampObj = lamp;
  W.dockLight = new THREE.PointLight(0xffc07a, W.tm.lantern * 0.8, 8, 2); W.dockLight.position.set(6.42, 1.7, -19.1); g.add(W.dockLight);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 16), rope); coil.rotation.x = Math.PI / 2; coil.position.set(5.15, 0.4, -18.6); g.add(coil);
  const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.06), METAL()); cleat.position.set(5.05, 0.39, -12.0); g.add(cleat);
  return shadowed(g);
}
/* ── 손에 드는 것 ── */
export function makeItem(type) {
  const g = new THREE.Group(); const emitter = new THREE.Object3D(); g.userData.emitter = emitter; g.userData.amount = 1;
  if (type === 'coffee') {
    const cer = smoothM(0xf2ede4, { roughness: 0.3, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(lathe([[0, -0.045], [0.034, -0.045], [0.04, -0.041], [0.044, -0.02], [0.046, 0.02], [0.047, 0.045], [0.042, 0.045], [0.041, 0.02], [0.039, -0.02], [0.036, -0.033], [0, -0.033]], 30), cer));
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.041, 30), smoothM(0x2c1a10, { roughness: 0.2 })); coffee.rotation.x = -Math.PI / 2; g.add(coffee);
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.0075, 10, 20, 3.52), cer); h.position.set(0.05, 0.003, 0); h.rotation.z = -1.76; g.add(h);
    g.userData.setAmount = a => { coffee.position.y = -0.03 + 0.06 * a; coffee.scale.setScalar(0.88 + 0.12 * a); coffee.visible = a > 0.02; emitter.position.y = coffee.position.y + 0.01; };
  } else if (type === 'whisky') {
    const gm = new THREE.MeshStandardMaterial({ color: 0xdfefff, transparent: true, opacity: 0.32, roughness: 0.04, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false });
    const glass = new THREE.Mesh(lathe([[0, -0.042], [0.034, -0.042], [0.04, -0.036], [0.041, 0.043], [0.037, 0.043], [0.036, -0.024], [0, -0.024]], 30), gm); glass.renderOrder = 3; g.add(glass);
    const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.0355, 0.034, 0.038, 30), smoothM(0xb8641a, { roughness: 0.12 })); liq.renderOrder = 1; g.add(liq);
    const ice = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 0.05, depthWrite: false }), ices = [];
    [[0.008, 0.012, 0.005, 0.4, 0.5], [-0.012, 0.018, -0.006, 0.9, 1.6]].forEach(([x, y, z, rx, ry]) => { const c = new THREE.Mesh(jitter(new THREE.BoxGeometry(0.026, 0.026, 0.026, 2, 2, 2), 0.15), ice); c.position.set(x, y, z); c.rotation.set(rx, ry, 0.2); c.renderOrder = 2; c.userData.y0 = y; ices.push(c); g.add(c); });
    emitter.position.y = 0.04;
    g.userData.setAmount = a => { liq.scale.y = Math.max(0.03, a); liq.position.y = -0.023 + 0.019 * a; liq.visible = a > 0.02; ices.forEach(c => { c.position.y = Math.max(-0.014, c.userData.y0 - (1 - a) * 0.034); }); };
  } else {
    const paper = smoothM(0xf4f1ea, { roughness: 0.9 });
    const cig = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 12), paper); cig.rotation.z = Math.PI / 2; g.add(cig);
    const filt = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.022, 12), smoothM(0xd9a15a, { roughness: 0.9 })); filt.rotation.z = Math.PI / 2; filt.position.x = -0.041; g.add(filt);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.002, 12), smoothM(0xc08a3a)); ring.rotation.z = Math.PI / 2; ring.position.x = -0.03; g.add(ring);
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.004, 0.008, 12), smoothM(0x8e8a84, { roughness: 1 })); ash.rotation.z = Math.PI / 2; g.add(ash);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5a1a })); g.add(tip); g.userData.tip = tip;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xff7a2a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(0.022); g.add(glow); g.userData.glow = glow;
    emitter.position.set(0, 0.003, 0);
    g.userData.setAmount = a => { const end = -0.03 + 0.07 * a; cig.scale.y = Math.max(0.05, a); cig.position.x = -0.03 + 0.035 * a; ash.position.x = end + 0.004; tip.position.x = end + 0.008; glow.position.x = end + 0.008; emitter.position.x = end + 0.008; };
  }
  g.userData.setAmount(1); g.add(emitter); return g;
}

/* ── 점 파티클 (김·불티·불꽃 잔입자) ── */
export class Particles {
  constructor(n, opt) {
    this.n = n; this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.i = 0;
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.Points(g, new THREE.PointsMaterial(Object.assign({ map: softTex, size: 0.06, transparent: true, opacity: 0.35, depthWrite: false }, opt))); this.mesh.frustumCulled = false;
  }
  spawn(p, v, spread, life, vs) {
    const i = this.i; this.i = (i + 1) % this.n; vs = vs || 0.08;
    this.pos[i * 3] = p.x + (Math.random() - .5) * spread; this.pos[i * 3 + 1] = p.y + (Math.random() - .5) * spread * 0.3; this.pos[i * 3 + 2] = p.z + (Math.random() - .5) * spread;
    this.vel[i * 3] = v.x + (Math.random() - .5) * vs; this.vel[i * 3 + 1] = v.y + Math.random() * vs * 0.8; this.vel[i * 3 + 2] = v.z + (Math.random() - .5) * vs;
    this.life[i] = 0; this.max[i] = life * rnd(0.7, 1.3);
  }
  update(dt, wind) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] < this.max[i]) { this.life[i] += dt; this.vel[i * 3] += (Math.sin(this.life[i] * 3 + i) * 0.02 + (wind || 0)) * dt; this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt; }
      else this.pos[i * 3 + 1] = -999;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

/* ── 연기: 뭉게구름 텍스처, 자라면서 옅어지고 회전, 어릴 땐 불빛에 주황빛 ── */
const puffTex = canvasTex(128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 28, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, rr = 18 + Math.random() * 22; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  g.globalCompositeOperation = 'destination-in'; const m = g.createRadialGradient(64, 64, 18, 64, 64, 64); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = m; g.fillRect(0, 0, w, h);
});
export class Smoke {
  constructor(n, opt = {}) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.rs = new Float32Array(n);
    this.age = new Float32Array(n); this.size = new Float32Array(n); this.rot = new Float32Array(n); this.op = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.pos[i * 3 + 1] = -999; this.life[i] = 1; this.max[i] = 1; this.age[i] = 1; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1)); g.setAttribute('aOp', new THREE.BufferAttribute(this.op, 1));
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uMap: { value: puffTex }, uCol: { value: new THREE.Color(opt.color || 0xb9bdc5) }, uWarm: { value: new THREE.Color(0xff9a50) }, uWarmK: { value: opt.warm || 0 }, uPx: { value: 500 } },
      vertexShader: `attribute float aAge,aSize,aRot,aOp;varying float vAge,vRot,vOp;uniform float uPx;
        void main(){vAge=aAge;vRot=aRot;vOp=aOp;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=min(aSize*uPx/max(-mv.z,0.05),900.0);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform sampler2D uMap;uniform vec3 uCol,uWarm;uniform float uWarmK;varying float vAge,vRot,vOp;
        void main(){vec2 c=gl_PointCoord-0.5;float s=sin(vRot),co=cos(vRot);vec2 uv=vec2(co*c.x-s*c.y,s*c.x+co*c.y)+0.5;
          float a=texture2D(uMap,uv).a;float fade=smoothstep(0.0,0.1,vAge)*(1.0-smoothstep(0.3,1.0,vAge));
          vec3 col=mix(uCol,uWarm,pow(1.0-vAge,3.0)*uWarmK);gl_FragColor=vec4(col,a*fade*vOp);}`,
    }));
    this.mesh.frustumCulled = false; this.mesh.userData.noAO = true;
  }
  /* p 위치, v 초기 속도, spread 퍼짐, life 수명(초), vs 속도 편차, s0→s1 크기(m), op 진하기 */
  spawn(p, v, spread, life, vs, s0, s1, op) {
    const i = this.i; this.i = (i + 1) % this.n; vs = vs || 0.08;
    this.pos[i * 3] = p.x + (Math.random() - .5) * spread; this.pos[i * 3 + 1] = p.y + (Math.random() - .5) * spread * 0.3; this.pos[i * 3 + 2] = p.z + (Math.random() - .5) * spread;
    this.vel[i * 3] = v.x + (Math.random() - .5) * vs; this.vel[i * 3 + 1] = v.y + Math.random() * vs * 0.8; this.vel[i * 3 + 2] = v.z + (Math.random() - .5) * vs;
    this.life[i] = 0; this.max[i] = life * rnd(0.7, 1.3); this.age[i] = 0;
    this.s0[i] = s0 === undefined ? 0.04 : s0; this.s1[i] = s1 === undefined ? 0.2 : s1; this.op[i] = op === undefined ? 0.25 : op;
    this.size[i] = this.s0[i]; this.rot[i] = rnd(0, 6.28); this.rs[i] = rnd(-0.5, 0.5);
  }
  update(dt, wind) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] < this.max[i]) {
        this.life[i] += dt; const a = this.age[i] = this.life[i] / this.max[i], L = this.life[i];
        V[i * 3] += (Math.sin(L * 2.1 + i) * 0.05 + (wind || 0)) * dt; V[i * 3 + 1] += (0.28 - V[i * 3 + 1]) * 0.45 * dt; V[i * 3 + 2] += Math.cos(L * 1.7 + i * 0.7) * 0.04 * dt;
        P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
        this.rot[i] += this.rs[i] * dt; this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(a);
      } else if (P[i * 3 + 1] > -900) { P[i * 3 + 1] = -999; this.age[i] = 1; }
    }
    const at = this.mesh.geometry.attributes; at.position.needsUpdate = at.aAge.needsUpdate = at.aSize.needsUpdate = at.aRot.needsUpdate = at.aOp.needsUpdate = true;
    if (ctx.renderer) this.mesh.material.uniforms.uPx.value = ctx.renderer.domElement.height * 0.5;
  }
}

/* ── 새 ── */
export const birdMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.9, side: THREE.DoubleSide });
function wingPart(len, c0, c1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -c0 * 0.35, len, 0, -c1 * 0.3 - len * 0.12, len, 0, c1 * 0.7 - len * 0.12, 0, 0, -c0 * 0.35, len, 0, c1 * 0.7 - len * 0.12, 0, 0, c0 * 0.65], 3));
  g.computeVertexNormals(); return g;
}
function makeBird() {
  const b = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), birdMat); body.scale.set(0.75, 0.7, 2.4); b.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), birdMat); head.position.set(0, 0.025, -0.16); b.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 5), birdMat); beak.rotation.x = -Math.PI / 2; beak.position.set(0, 0.02, -0.21); b.add(beak);
  const tail = new THREE.Mesh(wingPart(0.14, 0.05, 0.1), birdMat); tail.rotation.y = -Math.PI / 2; tail.position.set(0, 0.01, 0.12); b.add(tail);
  const wings = [];
  [1, -1].forEach(sx => {
    const inner = new THREE.Mesh(wingPart(0.24, 0.16, 0.12), birdMat); inner.position.set(sx * 0.03, 0.02, -0.02);
    const outer = new THREE.Mesh(wingPart(0.3, 0.12, 0.03), birdMat); outer.position.x = 0.24; inner.add(outer);
    inner.scale.x = sx; b.add(inner); wings.push({ inner, outer, sx });
  });
  b.userData = { ph: rnd(0, 6), glide: rnd(0, 6), wings, body }; return b;
}
export function spawnFlock() {
  const g = new THREE.Group(), n = 3 + Math.floor(Math.random() * 5), side = Math.random() < 0.5 ? -1 : 1;
  g.position.set(side * 170, rnd(22, 42), rnd(-90, -15));
  const vel = new THREE.Vector3(-side * rnd(5, 8), 0, rnd(-1.5, 1.5)); g.userData.vel = vel; g.rotation.y = Math.atan2(-vel.x, -vel.z); g.userData.birds = [];
  for (let i = 0; i < n; i++) { const b = makeBird(); const k = Math.ceil(i / 2), sx = i % 2 ? 1 : -1; b.position.set(sx * k * 1.3 + rnd(-0.2, 0.2), rnd(-0.5, 0.5), k * 1.1 + rnd(-0.2, 0.2)); b.scale.setScalar(rnd(0.9, 1.3)); g.add(b); g.userData.birds.push(b); }
  ctx.scene.add(g); ctx.W.flocks.push(g);
}
export function updateFlocks(dt, T) {
  const W = ctx.W;
  W.flocks = W.flocks.filter(g => {
    g.position.addScaledVector(g.userData.vel, dt);
    g.userData.birds.forEach(b => {
      const u = b.userData, amp = 0.3 + 0.7 * Math.max(0, Math.min(1, Math.sin(T * 0.35 + u.glide) * 1.5 + 0.5));
      const a = Math.sin(T * 8 + u.ph) * 0.6 * amp, a2 = Math.sin(T * 8 + u.ph - 0.7) * 0.55 * amp;
      u.wings.forEach(w => { w.inner.rotation.z = w.sx * a; w.outer.rotation.z = w.sx * a2; });
      u.body.position.y = Math.sin(T * 8 + u.ph) * 0.012 * amp;
    });
    if (Math.abs(g.position.x) > 200) { ctx.scene.remove(g); return false; } return true;
  });
}

/* ── 설산: 차 위에 쌓인 눈 ── */
function snowCapGeo(w, d, h, slope, seed) {
  const sx = Math.max(6, Math.round(w * 14)), sz = Math.max(4, Math.round(d * 14));
  const g = new THREE.PlaneGeometry(w, d, sx, sz); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), u = Math.abs(x) / (w / 2), v = Math.abs(z) / (d / 2);
    const r = Math.pow(Math.pow(u, 5) + Math.pow(v, 5), 0.2), f = Math.max(0, Math.min(1, (1 - r) / 0.55)), dome = f * f * (3 - 2 * f);
    const n = 0.72 + 0.56 * fbm(x * 3.1 + seed, z * 3.1 + seed * 0.7, 2);
    p.setY(i, h * dome * n - Math.abs(x) * (slope || 0));
  }
  g.computeVertexNormals(); return g;
}
export function makeSnowCaps() {
  const scene = ctx.scene, snow = smoothM(0xf5f8fc, Object.assign({ roughness: 0.95 }, tex('snow', 2, 2, 0.35)));
  let seed = 1;
  const cap = (w, d, h, x, y, z, ry, slope) => { const m = new THREE.Mesh(snowCapGeo(w, d, h, slope, seed += 2.3), snow); m.position.set(x, y, z); m.rotation.y = ry || 0; m.castShadow = false; m.receiveShadow = true; scene.add(m); };
  cap(1.8, 2.3, 0.1, 0, 1.895, 8.46);
  cap(1.75, 1.35, 0.07, 0, 1.14, 6.45);
}
