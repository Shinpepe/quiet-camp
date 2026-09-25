import * as THREE from 'three';
import { smooth, fbm, ridge, NOISE_GLSL, SRGB_GLSL } from './util.js';

const _c = new THREE.Color(), _c2 = new THREE.Color();

function localBase(x, z, cfg) {
  if (!cfg.water) return 0;
  const s = z - cfg.water.z; let h;
  if (s >= 0) h = 0.25 * (1 - smooth(0, 6, s));
  else { const dd = -s; h = 0.25 - Math.min(dd * 0.22, 1.6) - Math.min(Math.max(dd - 7, 0) * 0.08, 3.2); }
  if (cfg.key === 'lake' && z < -110) h += 9 * (1 - Math.exp(-(-110 - z) * 0.03));
  return h;
}
function localNoise(x, z, cfg) {
  const d = Math.hypot(x, z - 3), fall = smooth(12, 42, d);
  let n = (fbm(x * 0.025, z * 0.025) - 0.5) * 2 * cfg.amp * fall + (fbm(x * 0.007 + 50, z * 0.007 + 50, 3) - 0.5) * cfg.amp * 3 * smooth(20, 70, d);
  if (cfg.water) n *= smooth(0, 12, z - cfg.water.z);
  return n;
}
function mountainH(x, z, cfg) {
  const d = Math.hypot(x, z); let m = smooth(200, 340, d); if (m <= 0) return 0;
  if (cfg.key === 'beach') m *= Math.max(smooth(30, 150, z), smooth(300, 450, Math.abs(x)));
  else { const ang = Math.abs(Math.atan2(x, -z)); m *= 0.22 + 0.78 * smooth(0.35, 1.0, ang); }
  const r = ridge(x * 0.0026, z * 0.0026);
  return (Math.pow(r, 1.4) * cfg.mtAmp + cfg.mtBase) * m;
}
export function terrainH(x, z, cfg) {
  const d = Math.hypot(x, z);
  return localBase(x, z, cfg) + localNoise(x, z, cfg) * (1 - smooth(150, 230, d)) + mountainH(x, z, cfg);
}
export function slopeUp(x, z, cfg) { const h = terrainH(x, z, cfg); const gx = terrainH(x + 0.7, z, cfg) - h, gz = terrainH(x, z + 0.7, cfg) - h; return 1 / Math.sqrt(1 + (gx / 0.7) ** 2 + (gz / 0.7) ** 2); }

function groundColor(cfg, x, z, h, ny, d) {
  _c.set(cfg.ground); const n = fbm(x * 0.06 + 7, z * 0.06 + 3, 3), n2 = fbm(x * 0.012 + 90, z * 0.012 + 40, 3);
  if (cfg.key === 'lake') {
    _c.lerp(_c2.set(0x8c7a46), smooth(0.5, 0.72, n) * 0.55);
    if (d > 120) _c.lerp(_c2.set(0x2f4a30), smooth(120, 200, d) * (0.4 + 0.5 * smooth(0.4, 0.7, n2)));
    _c.lerp(_c2.set(0x6a6d70), smooth(110, 170, h));
    _c.lerp(_c2.set(0xe3e9f0), smooth(185, 240, h) * smooth(0.45, 0.8, ny));
    if (cfg.water && z < cfg.water.z + 2.2 && d < 150) _c.set(0x5c4c3a);
  } else if (cfg.key === 'beach') {
    _c.multiplyScalar(0.92 + n * 0.16);
    if (cfg.water && z < cfg.water.z + 2.5 && d < 150) _c.multiplyScalar(0.7);
    _c.lerp(_c2.set(0x7c8a55), smooth(2.5, 12, h) * (0.5 + 0.5 * n2));
    _c.lerp(_c2.set(0x8a7a66), smooth(45, 90, h) * 0.6);
  } else {
    _c.lerp(_c2.set(0xdfe7f1), (1 - n2) * 0.35);
    _c.lerp(_c2.set(0xc9d6e6), (1 - smooth(0.7, 0.95, ny)) * 0.5);
  }
  return _c;
}

export function makeGround(cfg) {
  const R = 116, S = 200, radii = [];
  for (let i = 0; i < R; i++) radii.push(i < 50 ? i * 1.2 : 60 * Math.pow(1.05, i - 50));
  const pos = new Float32Array(R * S * 3), col = new Float32Array(R * S * 3), idx = [];
  for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) {
    const a = j / S * Math.PI * 2, x = Math.cos(a) * radii[i], z = Math.sin(a) * radii[i], k = (i * S + j) * 3;
    pos[k] = x; pos[k + 1] = terrainH(x, z, cfg); pos[k + 2] = z;
  }
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < S; j++) { const a = i * S + j, b = i * S + (j + 1) % S, c = (i + 1) * S + (j + 1) % S, d = (i + 1) * S + j; idx.push(a, b, c, a, c, d); }
  const geo = new THREE.BufferGeometry(); geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  for (let i = 0; i < R * S; i++) { const x = pos[i * 3], z = pos[i * 3 + 2]; const c = groundColor(cfg, x, z, pos[i * 3 + 1], nor.getY(i), Math.hypot(x, z)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uRock = { value: new THREE.Color(cfg.rock) };
    sh.vertexShader = 'varying vec3 vWPos;varying vec3 vWNorm;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWNorm=normalize(mat3(modelMatrix)*objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos=(modelMatrix*vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = NOISE_GLSL + 'varying vec3 vWPos;varying vec3 vWNorm;uniform vec3 uRock;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n1=vnoise(vWPos.xz*0.35);float n2=vnoise(vWPos.xz*1.7);float n3=vnoise(vWPos.xz*7.0);
        float det=(n1-0.5)*0.22+(n2-0.5)*0.12+(n3-0.5)*0.07;
        float up=clamp(vWNorm.y,0.0,1.0);float rockK=1.0-smoothstep(0.6,0.82,up+(n2-0.5)*0.18);
        diffuseColor.rgb=mix(diffuseColor.rgb,uRock*(0.8+n2*0.4),rockK);
        diffuseColor.rgb*=1.0+det;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal=normalize(normal+vec3(n2-0.5,0.0,n3-0.5)*0.14);`);
  };
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; return m;
}

/* 물. lin=0 이면 단일 파일과 같은 원본 출력, lin=1 이면 포스트 패스용으로 sRGB→선형 */
export function makeWater(w, tm, uTime, lin) {
  const geo = new THREE.PlaneGeometry(w.size, w.size, 180, 180); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime, waveAmp: { value: w.wave }, shoreZ: { value: w.z }, uLin: { value: lin || 0 },
      deep: { value: new THREE.Color(w.deep).multiplyScalar(tm.waterMul) }, shallow: { value: new THREE.Color(w.shallow).multiplyScalar(tm.waterMul) },
      skyTop: { value: new THREE.Color(tm.top) }, skyBottom: { value: new THREE.Color(tm.bottom) },
      sunDir: { value: new THREE.Vector3(...tm.sun).normalize() }, sunColor: { value: new THREE.Color(tm.sunColor).multiplyScalar(tm.sunI) },
      fogColor: { value: new THREE.Color(tm.fog) }, fogNear: { value: 40 }, fogFar: { value: tm.fogFar },
    },
    vertexShader: `uniform float uTime,waveAmp,shoreZ;varying vec3 vW,vN;
      float wave(vec2 p){float k=smoothstep(0.0,10.0,shoreZ-p.y);return waveAmp*k*(0.18*sin(p.x*0.25+uTime*1.1)+0.12*sin(p.y*0.35+uTime*0.8+p.x*0.1)+0.06*sin((p.x+p.y)*0.8-uTime*2.0)+0.035*sin(p.x*1.7-p.y*0.6-uTime*2.6));}
      void main(){vec4 wp=modelMatrix*vec4(position,1.0);vec2 p=wp.xz;float h=wave(p);float e=0.6;float hx=wave(p+vec2(e,0.0));float hz=wave(p+vec2(0.0,e));
        vN=normalize(vec3(-(hx-h)/e,1.0,-(hz-h)/e));wp.y+=h;vW=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader: SRGB_GLSL + `uniform vec3 deep,shallow,skyTop,skyBottom,sunDir,sunColor,fogColor;uniform float shoreZ,fogNear,fogFar,uTime,uLin;varying vec3 vW,vN;
      void main(){vec3 V=normalize(cameraPosition-vW);vec3 N=normalize(vN);float fres=pow(1.0-max(dot(N,V),0.0),3.0);
        float dist=shoreZ-vW.z;float depth=clamp(dist/14.0,0.0,1.0);vec3 base=mix(shallow,deep,depth);
        vec3 sky=mix(skyBottom,skyTop,0.4);vec3 col=mix(base,sky,fres*0.7+0.08);
        vec3 H=normalize(sunDir+V);float spec=pow(max(dot(N,H),0.0),160.0);col+=sunColor*spec*1.1;
        float foam=smoothstep(2.4,0.0,dist)*(0.55+0.45*sin(vW.x*0.6+uTime*1.4+sin(vW.x*0.13)*3.0));col=mix(col,vec3(0.95),clamp(foam,0.0,1.0)*0.5);
        float f=smoothstep(fogNear,fogFar,length(cameraPosition-vW));col=mix(col,fogColor,f);
        vec3 o=clamp(col,0.0,1.0);gl_FragColor=vec4(uLin>0.5?srgb2lin(o):o,mix(0.78,0.97,depth));}`,
  });
  const m = new THREE.Mesh(geo, mat); m.position.set(0, 0, w.z - w.size / 2 + 1); m.frustumCulled = false; return m;
}
