import * as THREE from 'three';
import { TIME, KEYS } from './data.js';

const NUM = ['sunI', 'amb', 'hemi', 'ibl', 'stars', 'sunSize', 'glow', 'lantern', 'tentLamp', 'fireI', 'fogFar', 'fogH', 'insc', 'exposure', 'waterMul', 'cloudCover', 'mist'];
const COL = ['top', 'bottom', 'sunColor', 'disc', 'fog', 'cloudLit', 'cloudShade'];
const _a = new THREE.Color(), _b = new THREE.Color();
const ss = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/* 시각 t(0..1) 에서의 모든 조명/색 파라미터. out 을 주면 그 객체를 갱신(할당 없음). */
export function paramsAt(t, out) {
  t = ((t % 1) + 1) % 1; out = out || {};
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= t) i++;
  const [t0, k0] = KEYS[i], [t1, k1] = KEYS[i + 1], A = TIME[k0], B = TIME[k1], f = ss((t - t0) / (t1 - t0));
  NUM.forEach(k => out[k] = A[k] + (B[k] - A[k]) * f);
  COL.forEach(k => { if (!out[k]) out[k] = new THREE.Color(); out[k].copy(_a.set(A[k])).lerp(_b.set(B[k]), f); });
  const g = out.grade || (out.grade = { tint: [1, 1, 1] });
  for (let j = 0; j < 3; j++) g.tint[j] = A.grade.tint[j] + (B.grade.tint[j] - A.grade.tint[j]) * f;
  g.sat = A.grade.sat + (B.grade.sat - A.grade.sat) * f; g.con = A.grade.con + (B.grade.con - A.grade.con) * f; g.bloom = A.grade.bloom + (B.grade.bloom - A.grade.bloom) * f;
  out.key = f < 0.5 ? k0 : k1; out.t = t; return out;
}
/* 태양 궤도: 0.25 에 왼쪽 앞에서 떠서 0.75 에 오른쪽 앞으로 진다. 달은 반대편. */
export function sunDirAt(t, v) {
  const th = ((t - 0.25) / 0.5) * Math.PI;
  return (v || new THREE.Vector3()).set(-Math.cos(th) * 0.45, Math.sin(th), -0.85 + 0.3 * Math.abs(Math.sin(th))).normalize();
}
export function clockLabel(t) { const h = Math.floor(t * 24), m = Math.floor((t * 24 - h) * 60); return `${h}:${m < 10 ? '0' : ''}${m}`; }
