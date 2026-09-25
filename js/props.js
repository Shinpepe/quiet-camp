import * as THREE from 'three';
import { ctx } from './state.js';
import { rnd, std, smoothM, METAL, shadowed, bar, jitter, softTex, shadowTex } from './util.js';
import { terrainH } from './terrain.js';

export function contactShadow(x, z, sx, sz, op) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: op || 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, terrainH(x, z, ctx.W.cfg) + 0.02, z); ctx.scene.add(m);
}
export function makeLantern(lit) {
  const g = new THREE.Group(), frame = METAL();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 14), frame));
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.14, 14), new THREE.MeshStandardMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.35, roughness: 0.1 })); glass.position.y = 0.09; g.add(glass);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), new THREE.MeshBasicMaterial({ color: lit ? 0xffd9a0 : 0x8a7a62 })); core.position.y = 0.09; g.add(core);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.078, 0.05, 14), frame); cap.position.y = 0.185; g.add(cap);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.005, 6, 16, Math.PI), frame); handle.position.y = 0.21; g.add(handle);
  return g;
}
export function makeTent() {
  const W = ctx.W, g = new THREE.Group(), Wd = 2.4, H = 1.7, L = 2.6;
  const cloth = std(0xe0783a, { side: THREE.DoubleSide, roughness: 0.95 }), flyM = std(0xc4602a, { side: THREE.DoubleSide, roughness: 0.9 }), pole = METAL(), cord = smoothM(0xbfb7a8);
  const slab = (m, halfW, h, y0, len, thick) => { const side = Math.hypot(halfW, h), ang = Math.atan2(h, halfW); [-1, 1].forEach(sx => { const w = new THREE.Mesh(new THREE.BoxGeometry(side, thick, len), m); w.position.set(sx * halfW / 2, y0 + h / 2, 0); w.rotation.z = -sx * ang; g.add(w); }); };
  slab(cloth, Wd / 2, H, 0, L, 0.02); slab(flyM, Wd / 2 + 0.12, H + 0.02, 0.06, L + 0.4, 0.02);
  g.add(bar([0, H + 0.04, -L / 2 - 0.28], [0, H + 0.04, L / 2 + 0.28], 0.025, pole, 8));
  [-L / 2 - 0.05, L / 2 + 0.05].forEach(z => [-1, 1].forEach(sx => g.add(bar([sx * (Wd / 2 + 0.12), 0, z], [0, H + 0.03, z], 0.018, pole, 8))));
  const sh = new THREE.Shape(); sh.moveTo(-Wd / 2, 0); sh.lineTo(Wd / 2, 0); sh.lineTo(0, H);
  const back = new THREE.Mesh(new THREE.ShapeGeometry(sh), std(0xb8562a, { side: THREE.DoubleSide })); back.position.z = L / 2; g.add(back);
  [-1, 1].forEach(sx => g.add(bar([sx * 1.05, 0.22, -L / 2 - 0.03], [sx * 0.38, 1.17, -L / 2 - 0.03], 0.045, std(0xd46a30), 8)));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.05, L), std(0x3a2d24)); floor.position.y = 0.025; g.add(floor);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 1.8), smoothM(0x2c4a7a, { roughness: 0.9 })); bag.position.set(0.55, 0.16, 0.1); g.add(bag);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.35), smoothM(0xd9d2c5, { roughness: 1 })); pillow.position.set(0.55, 0.33, 0.85); g.add(pillow);
  const mat2 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.02, 0.45), std(0x6b5a45)); mat2.position.set(0, 0.01, -L / 2 - 0.4); g.add(mat2);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { g.add(bar([0, H + 0.04, sz * (L / 2 + 0.28)], [sx * 1.95, 0.02, sz * 1.75], 0.004, cord, 4)); const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), pole); stake.position.set(sx * 1.95, 0.04, sz * 1.75); stake.rotation.z = -sx * 0.45; g.add(stake); });
  const lamp = makeLantern(W.tm.tentLamp > 0); lamp.scale.setScalar(0.7); lamp.position.set(-0.75, 0.05, 0.9); g.add(lamp);
  W.tentLamp = new THREE.PointLight(0xffc890, W.tm.tentLamp, 4.5, 2); W.tentLamp.position.set(-0.6, 0.35, 0.8); g.add(W.tentLamp);
  return shadowed(g);
}
export function makeChair() {
  const g = new THREE.Group(), fabric = smoothM(0x2f4f6a, { roughness: 0.95 }), frame = METAL(), wood = smoothM(0x8a6a48, { roughness: 0.7 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.04, 0.5), fabric); seat.position.set(0, 0.45, 0); seat.rotation.x = 0.08; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.04), fabric); back.position.set(0, 0.76, 0.28); back.rotation.x = 0.28; g.add(back);
  [-0.29, 0.29].forEach(x => { g.add(bar([x, 0.02, -0.26], [x, 0.66, 0.26], 0.015, frame)); g.add(bar([x, 0.02, 0.26], [x, 0.66, -0.26], 0.015, frame)); g.add(bar([x, 0.66, -0.26], [x, 0.66, 0.26], 0.015, frame)); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.5), wood); arm.position.set(x, 0.685, 0); g.add(arm); g.add(bar([x, 0.66, 0.26], [x, 1.06, 0.38], 0.015, frame)); });
  g.add(bar([-0.29, 0.02, -0.26], [0.29, 0.02, -0.26], 0.015, frame)); g.add(bar([-0.29, 0.02, 0.26], [0.29, 0.02, 0.26], 0.015, frame)); g.add(bar([-0.29, 1.06, 0.38], [0.29, 1.06, 0.38], 0.015, frame));
  return shadowed(g);
}
export function makeTable() {
  const g = new THREE.Group(), frame = METAL();
  for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.1), smoothM(new THREE.Color(0x7a5636).multiplyScalar(rnd(0.88, 1.1)), { roughness: 0.7 })); s.position.set(0, 0.5, -0.24 + i * 0.12); g.add(s); }
  [-0.26, 0.26].forEach(x => { g.add(bar([x, 0, -0.22], [x, 0.485, 0.22], 0.012, frame)); g.add(bar([x, 0, 0.22], [x, 0.485, -0.22], 0.012, frame)); });
  g.add(bar([-0.26, 0.24, 0], [0.26, 0.24, 0], 0.012, frame));
  const lamp = makeLantern(ctx.W.tm.lantern > 0); lamp.position.set(0.05, 0.515, 0); g.add(lamp);
  return shadowed(g);
}
export function makeFire() {
  const W = ctx.W, g = new THREE.Group(), char = std(0x3d2a1c, { roughness: 1 });
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const s = new THREE.Mesh(jitter(new THREE.DodecahedronGeometry(rnd(0.11, 0.16), 0), 0.3), std(new THREE.Color(0x6f6a64).multiplyScalar(rnd(0.85, 1.1)))); s.position.set(Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5); s.rotation.set(rnd(0, 3), rnd(0, 3), 0); g.add(s); }
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.3; g.add(bar([Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32], [Math.cos(a + 2.4) * 0.05, 0.42, Math.sin(a + 2.4) * 0.05], 0.045, char, 6)); }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.34, 14), std(0x2b2724)); ash.rotation.x = -Math.PI / 2; ash.position.y = 0.03; g.add(ash);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0x2a1c14 })); core.position.y = 0.15; core.scale.y = 0.6; g.add(core); W.emberCore = core;
  W.fireLight = new THREE.PointLight(0xff8a3a, 0, 13, 2); W.fireLight.position.y = 0.55; g.add(W.fireLight);
  const pole = METAL(), iron = std(0x3b3b3f, { metalness: 0.7, roughness: 0.4, flatShading: false });
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.5; g.add(bar([Math.cos(a) * 0.62, 0.02, Math.sin(a) * 0.62], [0, 1.28, 0], 0.012, pole)); }
  g.add(bar([0, 1.28, 0], [0, 0.92, 0], 0.005, pole, 4));
  const kettle = new THREE.Group(); kettle.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 14), iron));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.03, 14), iron); lid.position.y = 0.085; kettle.add(lid);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), iron); knob.position.y = 0.11; kettle.add(knob);
  kettle.add(bar([0.09, 0.0, 0], [0.19, 0.08, 0], 0.014, iron, 6));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 6, 16, Math.PI), pole); handle.position.y = 0.09; kettle.add(handle);
  kettle.position.y = 0.85; g.add(kettle);
  return shadowed(g);
}
export function makeCar() {
  const W = ctx.W, g = new THREE.Group(), body = std(0x8f2b28, { roughness: 0.45, metalness: 0.3 }), dark = std(0x24252a, { roughness: 0.8 }), chrome = std(0xb8bcc2, { metalness: 0.85, roughness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9dbfdc, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.4, side: THREE.DoubleSide });
  const add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; };
  add(new THREE.BoxGeometry(1.9, 0.5, 4.7), body, 0, 0.66, 0.05); add(new THREE.BoxGeometry(1.94, 0.12, 4.75), dark, 0, 0.44, 0.05);
  add(new THREE.BoxGeometry(1.85, 0.28, 1.5), body, 0, 1.0, -1.55); add(new THREE.BoxGeometry(1.8, 0.07, 2.35), body, 0, 1.86, 0.35); add(new THREE.BoxGeometry(1.7, 0.02, 2.25), dark, 0, 1.815, 0.35);
  add(new THREE.BoxGeometry(1.75, 0.05, 1.15), dark, 0, 0.9, 1.95); add(new THREE.BoxGeometry(1.75, 0.35, 0.08), body, 0, 1.06, 2.49);
  [-0.84, 0.84].forEach(x => add(new THREE.BoxGeometry(0.08, 0.35, 1.15), body, x, 1.06, 1.95));
  [-0.88, 0.88].forEach(x => {
    add(new THREE.BoxGeometry(0.09, 0.95, 0.09), dark, x, 1.45, -0.9, 0.55); add(new THREE.BoxGeometry(0.09, 0.75, 0.09), dark, x, 1.5, 0.55); add(new THREE.BoxGeometry(0.09, 0.85, 0.09), dark, x, 1.48, 1.45, -0.35);
    add(new THREE.BoxGeometry(0.1, 0.9, 2.7), body, x, 0.7, 0.35); add(new THREE.BoxGeometry(0.05, 0.85, 2.6), dark, x * 0.93, 0.7, 0.35);
    add(new THREE.PlaneGeometry(1.25, 0.65), glass, x, 1.48, 0.35, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.18), chrome, x * 1.06, 1.0, 0.1); add(new THREE.BoxGeometry(0.03, 0.03, 0.18), chrome, x * 1.06, 1.0, 1.15);
    add(new THREE.BoxGeometry(0.22, 0.12, 0.08), dark, x * 1.1, 1.22, -0.65);
    add(new THREE.BoxGeometry(0.28, 0.14, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff1c4 }), x * 0.65, 0.85, -2.31);
    add(new THREE.BoxGeometry(0.34, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2a2a }), x * 0.62, 0.9, 2.55);
  });
  add(new THREE.PlaneGeometry(1.7, 0.95), glass, 0, 1.48, -0.95, 0.6); add(new THREE.PlaneGeometry(1.6, 0.8), glass, 0, 1.5, 1.5, -0.35);
  add(new THREE.BoxGeometry(0.5, 0.12, 0.02), smoothM(0xe8e8e8), 0, 0.7, 2.56);
  add(new THREE.BoxGeometry(1.9, 0.12, 0.1), chrome, 0, 0.5, -2.33); add(new THREE.BoxGeometry(1.9, 0.12, 0.1), chrome, 0, 0.5, 2.55); add(new THREE.BoxGeometry(0.9, 0.22, 0.04), dark, 0, 0.82, -2.33);
  add(new THREE.BoxGeometry(1.8, 0.35, 0.7), dark, 0, 1.0, -0.75); add(new THREE.BoxGeometry(0.42, 0.22, 0.02), new THREE.MeshBasicMaterial({ color: 0x8fc6ff }), 0, 1.06, -0.4);
  add(new THREE.TorusGeometry(0.18, 0.025, 8, 24), dark, 0.45, 1.08, -0.5, 0.45); add(new THREE.BoxGeometry(0.3, 0.08, 0.03), dark, 0, 1.66, -0.55);
  [[-0.45, 0.45], [0.45, 0.45]].forEach(([x, z]) => { add(new THREE.BoxGeometry(0.5, 0.45, 0.5), dark, x, 0.62, z); add(new THREE.BoxGeometry(0.5, 0.75, 0.15), dark, x, 1.15, z + 0.3); });
  add(new THREE.BoxGeometry(1.4, 0.4, 0.5), dark, 0, 0.6, 1.3); add(new THREE.BoxGeometry(1.4, 0.7, 0.15), dark, 0, 1.12, 1.55);
  [[-1.02, -1.55], [1.02, -1.55], [-1.02, 1.55], [1.02, 1.55]].forEach(([x, z]) => { add(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18), std(0x141414, { roughness: 0.95 }), x, 0.36, z, 0, 0, Math.PI / 2); add(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10), chrome, x, 0.36, z, 0, 0, Math.PI / 2); });
  const lid = new THREE.Group(); lid.position.set(0, 1.245, 1.38); const lidM = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.06, 1.2), body); lidM.position.z = 0.6; lid.add(lidM); g.add(lid); W.trunkLid = lid;
  const cooler = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.35), smoothM(0x3d6f9e)); cooler.position.set(-0.4, 1.06, 1.9); g.add(cooler);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.4), smoothM(0x6b5a3e, { roughness: 0.95 })); bag.position.set(0.4, 1.04, 2.0); g.add(bag);
  shadowed(g); g.traverse(o => { if (o.material === glass) o.castShadow = false; }); return g;
}
export function makeProps() {
  const scene = ctx.scene, cooler = new THREE.Group();
  const cb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.38), smoothM(0x3d6f9e, { roughness: 0.6 })); cb.position.y = 0.19; cooler.add(cb);
  const cl = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.07, 0.4), smoothM(0xdde6ee, { roughness: 0.5 })); cl.position.y = 0.415; cooler.add(cl);
  cooler.add(bar([-0.2, 0.46, 0], [0.2, 0.46, 0], 0.012, METAL())); cooler.position.set(2.4, 0, 0.6); cooler.rotation.y = 0.2; scene.add(shadowed(cooler));
  const pack = new THREE.Group(), pm = smoothM(0x4d6b3a, { roughness: 0.95 }), pm2 = smoothM(0x3e5730, { roughness: 0.95 });
  const pb = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.22), pm); pb.position.y = 0.27; pack.add(pb);
  const pl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.26), pm2); pl.position.set(0, 0.55, 0.01); pl.rotation.x = 0.15; pack.add(pl);
  const pp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.06), pm2); pp.position.set(0, 0.2, 0.13); pack.add(pp);
  [-0.1, 0.1].forEach(x => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.02), smoothM(0x2b2b2b)); s.position.set(x, 0.28, -0.12); pack.add(s); });
  pack.position.set(-3.25, 0, 1.4); pack.rotation.set(0, 0.4, -0.3); scene.add(shadowed(pack));
  for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 7), std(new THREE.Color(0x5a3d28).multiplyScalar(rnd(0.8, 1.15)))); l.rotation.z = Math.PI / 2; l.rotation.y = rnd(-0.08, 0.08); l.position.set(1.65 + (i % 3) * 0.13 - 0.13, 0.06 + Math.floor(i / 3) * 0.12, -2.45); scene.add(shadowed(l)); }
}
export function makeDock() {
  const W = ctx.W, g = new THREE.Group(), wood = smoothM(0x7a5636, { roughness: 0.8 }), post = smoothM(0x55402e, { roughness: 0.9 }), rope = smoothM(0xc9b48a, { roughness: 1 });
  for (let i = 0; i < 13; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 0.8), smoothM(new THREE.Color(0x7a5636).multiplyScalar(rnd(0.82, 1.1)), { roughness: 0.8 })); p.position.set(5.7, 0.33, -8.3 - i * 0.87); g.add(p); }
  for (let i = 0; i < 5; i++) [4.98, 6.42].forEach(x => { const po = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 7), post); po.position.set(x, -0.4, -8.5 - i * 2.6); g.add(po); });
  g.add(bar([6.42, 0.95, -8.2], [6.42, 0.95, -19.0], 0.025, wood, 6));
  for (let i = 0; i < 5; i++) g.add(bar([6.42, 0.36, -8.5 - i * 2.6], [6.42, 0.95, -8.5 - i * 2.6], 0.025, wood, 6));
  g.add(bar([6.42, 0.36, -19.1], [6.42, 1.55, -19.1], 0.03, post, 7));
  const lamp = makeLantern(W.tm.lantern > 0); lamp.scale.setScalar(0.8); lamp.position.set(6.42, 1.57, -19.1); g.add(lamp);
  W.dockLight = new THREE.PointLight(0xffc07a, W.tm.lantern * 0.8, 8, 2); W.dockLight.position.set(6.42, 1.7, -19.1); g.add(W.dockLight);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 16), rope); coil.rotation.x = Math.PI / 2; coil.position.set(5.15, 0.4, -18.6); g.add(coil);
  const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.06), METAL()); cleat.position.set(5.05, 0.39, -12.0); g.add(cleat);
  return shadowed(g);
}
export function makeItem(type) {
  const g = new THREE.Group(); const emitter = new THREE.Object3D(); g.userData.emitter = emitter;
  if (type === 'coffee') {
    const cer = smoothM(0xf2ede4, { roughness: 0.35, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.09, 24, 1, true), cer));
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.038, 24), cer); bottom.rotation.x = Math.PI / 2; bottom.position.y = -0.045; g.add(bottom);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.042, 24), cer); inner.rotation.x = -Math.PI / 2; inner.position.y = -0.03; g.add(inner);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.043, 24), smoothM(0x2c1a10, { roughness: 0.25 })); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.032; g.add(coffee);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.004, 8, 24), cer); rim.rotation.x = Math.PI / 2; rim.position.y = 0.045; g.add(rim);
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.007, 8, 16), cer); h.position.set(0.05, 0, 0); g.add(h);
    emitter.position.y = 0.04;
  } else if (type === 'whisky') {
    const gm = new THREE.MeshStandardMaterial({ color: 0xdfefff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.037, 0.085, 24, 1, true), gm); wall.renderOrder = 3; g.add(wall);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.035, 0.018, 24), smoothM(0xbfd3e0, { roughness: 0.1, metalness: 0.1 })); base.position.y = -0.036; g.add(base);
    const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.038, 24), smoothM(0xb8641a, { roughness: 0.15 })); liq.position.y = -0.005; liq.renderOrder = 1; g.add(liq);
    const ice = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 0.05, depthWrite: false });
    [[0.008, 0.012, 0.005, 0.4, 0.5], [-0.012, 0.018, -0.006, 0.9, 1.6]].forEach(([x, y, z, rx, ry]) => { const c = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.026), ice); c.position.set(x, y, z); c.rotation.set(rx, ry, 0.2); c.renderOrder = 2; g.add(c); });
    emitter.position.y = 0.04;
  } else {
    const paper = smoothM(0xf4f1ea, { roughness: 0.9 });
    const cig = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 10), paper); cig.rotation.z = Math.PI / 2; cig.position.x = 0.005; g.add(cig);
    const filt = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.022, 10), smoothM(0xd9a15a, { roughness: 0.9 })); filt.rotation.z = Math.PI / 2; filt.position.x = -0.041; g.add(filt);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.002, 10), smoothM(0xc08a3a)); ring.rotation.z = Math.PI / 2; ring.position.x = -0.03; g.add(ring);
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.004, 0.008, 10), smoothM(0x8e8a84, { roughness: 1 })); ash.rotation.z = Math.PI / 2; ash.position.x = 0.044; g.add(ash);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5a1a })); tip.position.x = 0.048; g.add(tip); g.userData.tip = tip;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xff7a2a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(0.022); glow.position.x = 0.048; g.add(glow); g.userData.glow = glow;
    emitter.position.set(0.048, 0.003, 0);
  }
  g.add(emitter); return g;
}

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
export const wingGeo = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.6, 0.04, 0.24, 0.6, 0.04, -0.24]), 3)); g.computeVertexNormals(); return g; })();
export const birdMat = new THREE.MeshBasicMaterial({ color: 0x1c1c22, side: THREE.DoubleSide });
export function spawnFlock() {
  const g = new THREE.Group(), n = 3 + Math.floor(Math.random() * 5), side = Math.random() < 0.5 ? -1 : 1;
  g.position.set(side * 170, rnd(22, 42), rnd(-90, -15)); g.userData.vel = new THREE.Vector3(-side * rnd(5, 8), 0, rnd(-1, 1)); g.userData.birds = [];
  for (let i = 0; i < n; i++) { const b = new THREE.Group(); b.position.set(i * 1.6 * side + rnd(-0.4, 0.4), rnd(-0.6, 0.6), Math.abs(i - n / 2) * 1.4 + rnd(-0.3, 0.3)); const l = new THREE.Mesh(wingGeo, birdMat), r = new THREE.Mesh(wingGeo, birdMat); r.scale.x = -1; b.add(l, r); b.userData = { ph: Math.random() * 6, l, r }; b.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; g.add(b); g.userData.birds.push(b); }
  ctx.scene.add(g); ctx.W.flocks.push(g);
}
