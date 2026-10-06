import * as THREE from 'three';
import { TIME, KEYS } from './data.js';

/* fogDen 은 여기 없다 — 몇 배씩 차이 나는 값이라 paramsAt 이 로그 공간에서 따로 섞는다 */
const NUM = ['sunI', 'amb', 'hemi', 'ibl', 'stars', 'sunSize', 'glow', 'lantern', 'tentLamp', 'fireI', 'fogH', 'insc', 'exposure', 'waterMul', 'cloudCover'];
const COL = ['top', 'bottom', 'sunColor', 'disc', 'fog', 'cloudLit', 'cloudShade'];
const _a = new THREE.Color(), _b = new THREE.Color();
const ss = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/* 시각 t(0..1) 에서의 모든 조명/색 파라미터. out 을 주면 그 객체를 갱신(할당 없음). */
export function paramsAt(t, out) {
  t = ((t % 1) + 1) % 1; out = out || {};
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= t) i++;
  const [t0, k0] = KEYS[i], [t1, k1] = KEYS[i + 1], A = TIME[k0], B = TIME[k1], f = ss((t - t0) / (t1 - t0));
  NUM.forEach(k => out[k] = A[k] + (B[k] - A[k]) * f);
  /* 안개 밀도는 로그 공간에서 섞는다 → 새벽 안개가 아침에 자연스럽게 걷힌다
     (그냥 섞으면 짙은 쪽이 오래 남아 오전 내내 뿌옇다) */
  out.fogDen = Math.exp(Math.log(A.fogDen) + (Math.log(B.fogDen) - Math.log(A.fogDen)) * f);
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
/* 분 단위로 먼저 바꾼 뒤 나눈다 — 7/24 같은 값의 부동소수 오차 때문에 7:00 이 6:59 로 찍히던 문제 방지 */
export function clockLabel(t) {
  const total = Math.floor((((t % 1) + 1) % 1) * 1440 + 1e-6) % 1440, h = Math.floor(total / 60), m = total % 60;
  return `${h}:${m < 10 ? '0' : ''}${m}`;
}