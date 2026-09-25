import * as THREE from 'three';

export const $ = s => document.querySelector(s);
export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapPI = a => Math.atan2(Math.sin(a), Math.cos(a));
export const isTouch = 'ontouchstart' in window && !matchMedia('(pointer:fine)').matches;
export const SEED = Math.random() * 100;
/* 큰 TypedArray 를 spread 로 push 하면 호출 스택 한계에 걸릴 수 있어 루프로 복사한다 */
export function pushAll(dst, src) { for (let i = 0; i < src.length; i++) dst.push(src[i]); }

export function hash(x, y) { const n = Math.sin(x * 127.1 + y * 311.7 + SEED) * 43758.5453; return n - Math.floor(n); }
export function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
export function fbm(x, y, o) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < (o || 4); i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.1; } return s; }
export function ridge(x, y) { let s = 0, a = 0.55, f = 1, w = 1; for (let i = 0; i < 5; i++) { let n = 1 - Math.abs(2 * vnoise(x * f + 31, y * f + 17) - 1); n *= n; s += n * a * w; w = clamp(n * 1.2, 0, 1); a *= 0.5; f *= 2.05; } return s; }

export const NOISE_GLSL = `
float hashg(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hashg(i),hashg(i+vec2(1,0)),f.x),mix(hashg(i+vec2(0,1)),hashg(i+vec2(1,1)),f.x),f.y);}`;

export function canvasTex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); return new THREE.CanvasTexture(cv); }
export const softTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
export const shadowTex = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.5, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
export const cloudTex = canvasTex(256, 128, (g) => { for (let i = 0; i < 14; i++) { const x = 40 + Math.random() * 176, y = 50 + Math.random() * 40, r = 22 + Math.random() * 30; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128); } });

export const std = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, flatShading: true }, extra || {}));
export const smoothM = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6 }, extra || {}));
export const METAL = () => new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.65, roughness: 0.35 });
export function shadowed(o) { o.traverse(x => { if (x.isMesh) { x.castShadow = !(x.material.transparent); x.receiveShadow = true; } }); return o; }
export function bar(a, b, r, mat, seg) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), len = from.distanceTo(to);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 6), mat);
  m.position.copy(from).add(to).multiplyScalar(0.5); m.lookAt(to); m.rotateX(Math.PI / 2); return m;
}
export function jitter(geo, amt) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + (hash(Math.round(x * 97) + Math.round(y * 13), Math.round(z * 97)) - 0.5) * amt; p.setX(i, x * k); p.setZ(i, z * k); } return geo; }
/* 파츠 병합 — 정점색과 uv 를 함께 유지 (uv 는 p.uvs 배수로 타일링) */
export function mergeParts(parts) {
  const pos = [], col = [], uv = [];
  parts.forEach(p => {
    const g = p.geo.toNonIndexed(); const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0)), new THREE.Vector3(p.s || 1, p.sy || p.s || 1, p.s || 1));
    const pa = g.attributes.position, ua = g.attributes.uv, k = p.uvs || 1; let minY = 1e9, maxY = -1e9; for (let i = 0; i < pa.count; i++) { minY = Math.min(minY, pa.getY(i)); maxY = Math.max(maxY, pa.getY(i)); }
    const c = new THREE.Color(p.color);
    for (let i = 0; i < pa.count; i++) { const sh = p.grad ? 0.7 + 0.4 * (pa.getY(i) - minY) / (maxY - minY + 1e-6) : 1; col.push(c.r * sh, c.g * sh, c.b * sh); if (ua) uv.push(ua.getX(i) * k, ua.getY(i) * k); else uv.push(0, 0); }
    g.applyMatrix4(m); pushAll(pos, g.attributes.position.array);
  });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals(); return geo;
}
export const tintOf = (v, hueShift) => [rnd(0.85, 1.15) * (1 + (hueShift || 0)), rnd(0.85, 1.15), rnd(0.85, 1.15) * (1 - (hueShift || 0))];
