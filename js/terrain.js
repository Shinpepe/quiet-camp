import * as THREE from 'three';
import { settings } from './state.js';
import { smooth, fbm, ridge, NOISE_GLSL, SKY_GLSL } from './util.js';
import { T } from './textures.js';

const _c = new THREE.Color(), _c2 = new THREE.Color();

/* 해안선을 x 방향 노이즈로 구불구불하게. 부두 근처(x 5.7 ± 2.5)는 흔들지 않는다 */
function shoreOff(x, cfg) {
  const w = cfg.water.wobble !== undefined ? cfg.water.wobble : (cfg.key === 'lake' ? 9 : 5);
  let o = (fbm(x * 0.018 + 11, 4.2, 3) - 0.5) * 2 * w;
  if (cfg.dock) o *= smooth(2.5, 7.5, Math.abs(x - 5.7));
  return o;
}
function localBase(x, z, cfg) {
  if (!cfg.water) return 0;
  const s = z - cfg.water.z - shoreOff(x, cfg); let h;
  if (s >= 0) h = 0.25 * (1 - smooth(0, 6, s));
  else { const dd = -s; h = 0.25 - Math.min(dd * 0.22, 1.6) - Math.min(Math.max(dd - 7, 0) * 0.08, 3.2); }
  if (cfg.key === 'lake' && z < -110) h += 9 * (1 - Math.exp(-(-110 - z) * 0.03));
  return h;
}
function localNoise(x, z, cfg) {
  const d = Math.hypot(x, z - 3), fall = smooth(12, 42, d);
  let n = (fbm(x * 0.025, z * 0.025) - 0.5) * 2 * cfg.amp * fall + (fbm(x * 0.007 + 50, z * 0.007 + 50, 3) - 0.5) * cfg.amp * 3 * smooth(20, 70, d);
  if (cfg.water) n *= smooth(0, 12, z - cfg.water.z - shoreOff(x, cfg));
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

/* 지형 높이맵: ±R 범위를 N×N 으로 구워 물 셰이더가 픽셀마다 수심을 알게 한다. 값은 (h+8)/16 을 0..255 로 */
export const HMAP_R = 160;
export function bakeHeightMap(cfg) {
  const N = 256, R = HMAP_R, d = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i / (N - 1) - 0.5) * 2 * R, z = (j / (N - 1) - 0.5) * 2 * R; d[j * N + i] = Math.max(0, Math.min(255, Math.round((terrainH(x, z, cfg) + 8) / 16 * 255))); }
  const t = new THREE.DataTexture(d, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
}

function groundColor(cfg, x, z, h, ny, d) {
  _c.set(cfg.ground); const n = fbm(x * 0.06 + 7, z * 0.06 + 3, 3), n2 = fbm(x * 0.012 + 90, z * 0.012 + 40, 3);
  if (cfg.key === 'lake') {
    _c.lerp(_c2.set(0x8c7a46), smooth(0.5, 0.72, n) * 0.55);
    if (d > 120) _c.lerp(_c2.set(0x2f4a30), smooth(120, 200, d) * (0.4 + 0.5 * smooth(0.4, 0.7, n2)));
    _c.lerp(_c2.set(0x6a6d70), smooth(110, 170, h));
    _c.lerp(_c2.set(0xe3e9f0), smooth(185, 240, h) * smooth(0.45, 0.8, ny));
    if (cfg.water && d < 150) _c.lerp(_c2.set(0x5c4c3a), 1 - smooth(0.05, 0.45, h));
  } else if (cfg.key === 'beach') {
    _c.multiplyScalar(0.92 + n * 0.16);
    if (cfg.water && d < 150) _c.multiplyScalar(1 - 0.25 * (1 - smooth(0.0, 0.4, h)));
    _c.lerp(_c2.set(0x7c8a55), smooth(2.5, 12, h) * (0.5 + 0.5 * n2));
    _c.lerp(_c2.set(0x8a7a66), smooth(45, 90, h) * 0.6);
  } else {
    _c.lerp(_c2.set(0xdfe7f1), (1 - n2) * 0.35);
    _c.lerp(_c2.set(0xc9d6e6), (1 - smooth(0.7, 0.95, ny)) * 0.5);
  }
  return _c;
}

/* 극좌표 격자 지면. 물이 있으면 물가 젖은 띠 + 물속 커스틱을 셰이더에 끼워 넣는다 */
export function makeGround(cfg, uTime) {
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
    sh.uniforms.uTime = uTime || { value: 0 };
    sh.uniforms.uHasWater = { value: cfg.water ? 1 : 0 };
    sh.uniforms.uCaust = { value: 0 };
    mat.userData.shader = sh;
    sh.vertexShader = 'varying vec3 vWPos;varying vec3 vWNorm;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWNorm=normalize(mat3(modelMatrix)*objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos=(modelMatrix*vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = NOISE_GLSL + 'varying vec3 vWPos;varying vec3 vWNorm;uniform vec3 uRock;uniform float uTime,uHasWater,uCaust;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n1=vnoise(vWPos.xz*0.35);float n2=vnoise(vWPos.xz*1.7);float n3=vnoise(vWPos.xz*7.0);
        float det=(n1-0.5)*0.22+(n2-0.5)*0.12+(n3-0.5)*0.07;
        float up=clamp(vWNorm.y,0.0,1.0);float rockK=1.0-smoothstep(0.6,0.82,up+(n2-0.5)*0.18);
        diffuseColor.rgb=mix(diffuseColor.rgb,uRock*(0.8+n2*0.4),rockK);
        diffuseColor.rgb*=1.0+det;
        if(uHasWater>0.5){
          float wetTop=0.3+0.15*sin(uTime*1.1+vWPos.x*0.21+vnoise(vWPos.xz*0.3)*3.0);
          float wet=1.0-smoothstep(0.0,wetTop,vWPos.y);diffuseColor.rgb*=1.0-0.3*wet;
          float dpt=-vWPos.y;
          if(dpt>0.0){float c1=vnoise(vWPos.xz*2.6+vec2(uTime*0.35,uTime*0.2));float c2=vnoise(vWPos.xz*4.1-vec2(uTime*0.25,uTime*0.3));
            float ca=pow(c1*c2,1.6)*4.0;
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.72,0.88,1.0),smoothstep(0.0,2.0,dpt));
            diffuseColor.rgb+=ca*uCaust*exp(-dpt*0.9);}}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal=normalize(normal+vec3(n2-0.5,0.0,n3-0.5)*0.14);`);
  };
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; return m;
}

/* 물 — 정점: 큰 파도. 프래그먼트: 잔물결 노멀 + 높이맵 수심 + 하늘 반사(별 없음, 구름 흐리게) + 태양고도별 하이라이트 + 수심 거품.
   선형 색을 그대로 출력하고 톤매핑은 OutputPass 에 맡긴다. 시각 유니폼은 scene.js 의 applyTime() 이 매 프레임 덮어쓴다. */
export function makeWater(w, tm, uTime, heightTex) {
  const geo = new THREE.PlaneGeometry(w.size, w.size, 180, 180); geo.rotateX(-Math.PI / 2);
  const ripple = T.ripple.normalMap.clone(); ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping; ripple.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime, waveAmp: { value: w.wave }, shoreZ: { value: w.z }, uReflect: { value: settings.reflect ? 1 : 0 },
      uHeight: { value: heightTex }, uHR: { value: HMAP_R }, uRipple: { value: ripple }, uRip: { value: 0.45 + 0.55 * w.wave },
      deep: { value: new THREE.Color(w.deep).multiplyScalar(tm.waterMul) }, shallow: { value: new THREE.Color(w.shallow).multiplyScalar(tm.waterMul) },
      skyTop: { value: new THREE.Color(tm.top) }, skyBottom: { value: new THREE.Color(tm.bottom) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(tm.sunColor).multiplyScalar(tm.sunI) },
      uSunD: { value: new THREE.Vector3(0, 1, 0) }, moonDir: { value: new THREE.Vector3(0, -1, 0) }, disc: { value: new THREE.Color(tm.disc) },
      cloudLit: { value: new THREE.Color(tm.cloudLit) }, cloudShade: { value: new THREE.Color(tm.cloudShade) }, glow: { value: 0 }, uMoon: { value: tm.stars }, uCover: { value: tm.cloudCover },
      fogColor: { value: new THREE.Color(tm.fog) }, fogNear: { value: 40 }, fogFar: { value: tm.fogFar },
    },
    vertexShader: `uniform float shoreZ,fogNear,fogFar,uTime,waveAmp;varying vec3 vW,vN;
      float wave(vec2 p){return waveAmp*(0.06*sin(p.x*0.9+uTime*1.3)+0.05*sin(p.y*1.3-uTime*1.1)+0.03*sin((p.x+p.y)*2.7+uTime*2.2)+0.015*sin(p.x*6.1-uTime*3.0));}
      void main(){vec4 wp=modelMatrix*vec4(position,1.0);vec2 p=wp.xz;float h=wave(p);float e=0.6;float hx=wave(p+vec2(e,0.0));float hz=wave(p+vec2(0.0,e));
        vN=normalize(vec3(-(hx-h)/e,1.0,-(hz-h)/e));wp.y+=h;vW=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader: NOISE_GLSL + SKY_GLSL + `
      uniform vec3 deep,shallow,skyTop,skyBottom,sunDir,sunColor,fogColor,uSunD,moonDir,disc,cloudLit,cloudShade;
      uniform float shoreZ,fogNear,fogFar,uTime,uReflect,uHR,uRip,glow,uMoon,uCover;
      uniform sampler2D uHeight,uRipple;varying vec3 vW,vN;
      void main(){
        vec3 V=normalize(cameraPosition-vW);float dist=length(cameraPosition-vW);
        /* 잔물결: 노멀맵 두 겹을 다른 방향으로 흘린다. 멀어지면 사라짐 */
        vec2 u1=vW.xz*0.33+vec2(uTime*0.028,uTime*0.017);vec2 u2=vW.xz*0.19-vec2(uTime*0.02,uTime*0.024);
        vec3 r1=texture2D(uRipple,u1).xyz*2.0-1.0;vec3 r2=texture2D(uRipple,u2).xyz*2.0-1.0;
        float det=(1.0-smoothstep(25.0,160.0,dist))*uRip;
        vec3 N=normalize(normalize(vN)+vec3(r1.x+r2.x,0.0,r1.y+r2.y)*0.28*det);
        /* 수심: 높이맵. 범위 밖은 깊은 물 */
        vec2 hu=vW.xz/(2.0*uHR)+0.5;bool inH=hu.x>0.0&&hu.x<1.0&&hu.y>0.0&&hu.y<1.0;
        float ground=inH?texture2D(uHeight,hu).r*16.0-8.0:-6.0;float dpt=max(0.0,-ground);
        float dk=1.0-exp(-dpt*0.5);vec3 base=mix(shallow,deep,dk);
        /* 하늘 반사: 반사 벡터로 하늘 함수를 평가. 구름은 절반 세기. 프레넬로 섞되 상한을 둔다 */
        vec3 R=reflect(-V,N);R.y=max(R.y,0.04);R=normalize(R);
        vec3 sky=skyColor(R,skyTop,skyBottom,uSunD,moonDir,disc,cloudLit,cloudShade,glow,uMoon,uCover,uTime,0.45);
        float fres=pow(1.0-max(dot(N,V),0.0),4.0);float refl=mix(0.06,0.6,fres)*(0.75+0.25*uReflect);
        vec3 col=mix(base,sky,refl);
        /* 하이라이트: 광원이 낮을수록 넓고 길게 (노을 빛길, 달빛 길) */
        vec3 H=normalize(sunDir+V);float el=smoothstep(0.0,0.5,sunDir.y);float e=mix(40.0,240.0,el);
        float spec=pow(max(dot(N,H),0.0),e);col+=sunColor*spec*mix(2.2,1.0,el);
        /* 거품: 수심 0~50cm, 노이즈로 조각조각, 천천히 밀려왔다 물러남 */
        float fn=vnoise(vW.xz*0.9+vec2(uTime*0.15,0.0))*0.6+vnoise(vW.xz*2.8-vec2(0.0,uTime*0.22))*0.4;
        float surge=0.5+0.5*sin(uTime*1.1+vW.x*0.18+fn*2.0);
        float foam=smoothstep(0.5,0.0,dpt-0.12*surge)*smoothstep(0.38,0.68,fn);col=mix(col,vec3(0.93),foam*0.65);
        float f=smoothstep(fogNear,fogFar,dist);col=mix(col,fogColor,f);
        float alpha=mix(0.5,0.96,dk);alpha=max(alpha,foam*0.9);alpha=mix(alpha,1.0,f);
        gl_FragColor=vec4(col,alpha);}`,
  });
  const m = new THREE.Mesh(geo, mat); m.position.set(0, 0, w.z - w.size / 2 + 1); m.frustumCulled = false; return m;
}
