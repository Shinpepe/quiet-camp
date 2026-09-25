import * as THREE from 'three';
import { SEED } from './util.js';

/*
  주기(periodic) 값 노이즈 — 타일 경계가 이어지도록 격자 좌표를 주기로 감싼다.
  모든 텍스처는 로드 시 한 번 생성해 씬이 바뀌어도 재사용.
*/
const S = 256;
const ph = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7 + SEED) * 43758.5453; return n - Math.floor(n); };
function pnoise(x, y, Px, Py) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const X0 = ((xi % Px) + Px) % Px, X1 = (X0 + 1) % Px, Y0 = ((yi % Py) + Py) % Py, Y1 = (Y0 + 1) % Py;
  const a = ph(X0, Y0), b = ph(X1, Y0), c = ph(X0, Y1), d = ph(X1, Y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pfbm(u, v, Px, Py, o) { let s = 0, a = 0.5, px = Px, py = Py; for (let i = 0; i < o; i++) { s += a * pnoise(u * px, v * py, px, py); a *= 0.5; px *= 2; py *= 2; } return s; }
const TAU = Math.PI * 2;

function makeTex(data, srgb) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t;
}
/* fn(u,v) → { h: 높이 0..1, c: [r,g,b] 0..1, r: 거칠기 0..1(옵션) } */
function gen(fn, strength, hasRough) {
  const H = new Float32Array(S * S), col = new Uint8Array(S * S * 4), nrm = new Uint8Array(S * S * 4), rough = hasRough ? new Uint8Array(S * S * 4) : null;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, r = fn(x / S, y / S); H[i] = r.h;
    col[i * 4] = r.c[0] * 255; col[i * 4 + 1] = r.c[1] * 255; col[i * 4 + 2] = r.c[2] * 255; col[i * 4 + 3] = 255;
    if (rough) { const g = (r.r === undefined ? 1 : r.r) * 255; rough[i * 4] = g; rough[i * 4 + 1] = g; rough[i * 4 + 2] = g; rough[i * 4 + 3] = 255; }
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, xl = H[y * S + (x + S - 1) % S], xr = H[y * S + (x + 1) % S], yu = H[((y + S - 1) % S) * S + x], yd = H[((y + 1) % S) * S + x];
    let nx = -(xr - xl) * strength * S * 0.5, ny = -(yd - yu) * strength * S * 0.5, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    nrm[i * 4] = (nx * 0.5 + 0.5) * 255; nrm[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; nrm[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; nrm[i * 4 + 3] = 255;
  }
  return { map: makeTex(col, true), normalMap: makeTex(nrm, false), roughnessMap: rough ? makeTex(rough, false) : null };
}
const gray = (k, t) => [k, k, k].map(v => v * t);

export const T = {
  bark: gen((u, v) => { const ridge = pfbm(u, v, 24, 3, 4), crack = pfbm(u + 0.3, v, 3, 6, 3); const h = ridge * (0.55 + 0.45 * crack); return { h, c: gray(1, 0.6 + 0.55 * h) }; }, 0.035),
  foliage: gen((u, v) => { const h = pfbm(u, v, 10, 10, 4); return { h, c: gray(1, 0.8 + 0.4 * h) }; }, 0.02),
  fabric: gen((u, v) => { const w = 0.5 + 0.22 * Math.sin(u * TAU * 24) + 0.22 * Math.sin(v * TAU * 24), n = pfbm(u, v, 8, 8, 3); const h = w * 0.7 + n * 0.3; return { h, c: gray(1, 0.88 + 0.22 * (h - 0.5)) }; }, 0.012),
  sand: gen((u, v) => { const rip = 0.5 + 0.3 * Math.sin((v * 6 + 0.35 * pfbm(u, v, 4, 4, 3)) * TAU), grain = pfbm(u, v, 40, 40, 2); const h = rip * 0.75 + grain * 0.25; return { h, c: gray(1, 0.9 + 0.2 * (h - 0.5)) }; }, 0.02),
  dirt: gen((u, v) => { const h = pfbm(u, v, 12, 12, 4); return { h, c: gray(1, 0.82 + 0.36 * h) }; }, 0.028),
  snow: gen((u, v) => { const h = 0.5 + 0.28 * (pfbm(u, v, 18, 18, 4) - 0.5) + 0.25 * (pfbm(u, v, 3, 3, 2) - 0.5); const sp = ph(Math.floor(u * S), Math.floor(v * S)) > 0.982; return { h, c: gray(1, 0.95 + 0.1 * (h - 0.5)), r: sp ? 0.12 : 0.92 }; }, 0.014, true),
  wood: gen((u, v) => { const d = u * 3 + 0.2 * pfbm(u, v, 2, 8, 3); const h = 0.5 + 0.28 * Math.sin(d * TAU * 2.5) + 0.18 * (pfbm(u, v, 3, 40, 3) - 0.5); return { h, c: gray(1, 0.78 + 0.44 * h) }; }, 0.015),
  rock: gen((u, v) => { const n = pfbm(u, v, 6, 6, 5); const h = 1 - Math.abs(2 * n - 1); return { h, c: gray(1, 0.75 + 0.5 * h) }; }, 0.045),
  leaf: gen((u, v) => { const h = 0.5 + 0.3 * Math.sin(v * TAU * 30 + u * 3.0) + 0.12 * (pfbm(u, v, 6, 6, 3) - 0.5); return { h, c: gray(1, 0.9 + 0.2 * (h - 0.5)) }; }, 0.012),
  ripple: gen((u, v) => { const h = pfbm(u, v, 6, 6, 4); return { h, c: [0.5, 0.5, 0.5] }; }, 0.03),
};

/* 재질 옵션 묶음: 반복 횟수와 노멀 강도를 지정해 map/normalMap/(roughnessMap) 을 돌려준다 */
export function tex(name, rx, ry, strength, withMap = true) {
  const t = T[name], o = {};
  const clone = (x) => { if (!x) return null; const c = x.clone(); c.repeat.set(rx, ry || rx); c.needsUpdate = true; return c; };
  if (withMap) o.map = clone(t.map);
  o.normalMap = clone(t.normalMap); o.normalScale = new THREE.Vector2(strength, strength);
  if (t.roughnessMap) o.roughnessMap = clone(t.roughnessMap);
  return o;
}
