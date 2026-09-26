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

/* 하늘 색 함수 — 하늘 돔과 물 반사가 같은 함수를 쓴다. cloudK 로 구름 세기를 조절(물은 흐리게). 별은 여기 없으니 물에 비치지 않는다. */
export const SKY_GLSL = `
float cloudD(vec2 p,float cover){float n=vnoise(p)*0.5+vnoise(p*2.1+vec2(3.1,7.3))*0.25+vnoise(p*4.3+vec2(9.7,1.3))*0.125+vnoise(p*8.9+vec2(4.2,5.5))*0.0625;return smoothstep(0.66-cover*0.4,0.74,n);}
vec3 skyColor(vec3 d,vec3 top,vec3 bottom,vec3 sunDir,vec3 moonDir,vec3 sunCol,vec3 cloudLit,vec3 cloudShade,float glow,float moonK,float cover,float time,float cloudK){
  float h=d.y;float t=pow(max(h,0.0),0.45);vec3 col=mix(bottom,top,t);
  float s=max(dot(d,sunDir),0.0);col+=sunCol*glow*(pow(s,6.0)*0.35+pow(s,40.0)*0.9)*(1.0-t*0.6);
  float ms=max(dot(d,moonDir),0.0);col+=vec3(0.5,0.6,0.85)*moonK*(pow(ms,8.0)*0.12+pow(ms,120.0)*0.4);
  col=mix(col,bottom*0.9,smoothstep(0.03,-0.2,h));
  if(h>0.0&&cloudK>0.0){vec2 p=d.xz/(h+0.12)*2.2+vec2(time*0.006,time*0.0025);float dens=cloudD(p,cover);
    vec3 L=sunDir.y>-0.05?sunDir:moonDir;vec2 ts=(L.xz/(max(L.y,0.05)+0.12))*0.12;float d2=cloudD(p+ts,cover);
    vec3 cc=mix(cloudShade,cloudLit,1.0-0.75*d2);col=mix(col,cc,dens*smoothstep(0.0,0.2,h)*cloudK);}
  return col;}`;

/* ── 대기 원근 안개: three 의 fog 셰이더 조각을 통째로 바꿔 모든 재질에 적용.
   uFog[0]=(광원 방향 xyz, 산란 세기)  uFog[1]=(밀도, 1/높이스케일, 기준 높이, 0)  uFog[2]=(산란 색 rgb, 0) ── */
export const FOG = new Float32Array(12);
export const FOG_GLSL = `
float fogAmount(vec3 wpos,vec4 f1){vec3 d=wpos-cameraPosition;float dist=length(d);float y0=clamp(cameraPosition.y-f1.z,-20.0,600.0),y1=clamp(wpos.y-f1.z,-20.0,600.0);float dy=y1-y0;float hi=abs(dy)>0.05?(exp(-f1.y*y0)-exp(-f1.y*y1))/(f1.y*dy):exp(-f1.y*y0);return clamp(1.0-exp(-f1.x*dist*hi),0.0,1.0);}
vec3 fogTint(vec3 wpos,vec3 fc,vec4 f0,vec4 f2){vec3 dir=normalize(wpos-cameraPosition);float s=max(dot(dir,f0.xyz),0.0);return mix(fc,f2.rgb,pow(s,8.0)*f0.w);}`;
THREE.UniformsLib.fog.uFog = { value: FOG };
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\nvarying vec3 vFogW;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\nvFogW=cameraPosition+transpose(mat3(viewMatrix))*mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\nuniform vec3 fogColor;varying vec3 vFogW;uniform vec4 uFog[3];\n#ifdef FOG_EXP2\nuniform float fogDensity;\n#else\nuniform float fogNear;uniform float fogFar;\n#endif\n' + FOG_GLSL + '\n#endif';
THREE.ShaderChunk.fog_fragment = '#ifdef USE_FOG\ngl_FragColor.rgb=mix(gl_FragColor.rgb,fogTint(vFogW,fogColor,uFog[0],uFog[2]),fogAmount(vFogW,uFog[1]));\n#endif';

export function canvasTex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); return new THREE.CanvasTexture(cv); }
export const softTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
export const shadowTex = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.5, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });

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
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0)), new THREE.Vector3(p.s || 1, p.sy || p.s || 1, p.s || 1));
    const pa = g.attributes.position, ua = g.attributes.uv, k = p.uvs || 1; let minY = 1e9, maxY = -1e9; for (let i = 0; i < pa.count; i++) { minY = Math.min(minY, pa.getY(i)); maxY = Math.max(maxY, pa.getY(i)); }
    const c = new THREE.Color(p.color);
    for (let i = 0; i < pa.count; i++) { const sh = p.grad ? 0.7 + 0.4 * (pa.getY(i) - minY) / (maxY - minY + 1e-6) : 1; col.push(c.r * sh, c.g * sh, c.b * sh); if (ua) uv.push(ua.getX(i) * k, ua.getY(i) * k); else uv.push(0, 0); }
    g.applyMatrix4(m); pushAll(pos, g.attributes.position.array);
  });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals(); return geo;
}
export const tintOf = (v, hueShift) => [rnd(0.85, 1.15) * (1 + (hueShift || 0)), rnd(0.85, 1.15), rnd(0.85, 1.15) * (1 - (hueShift || 0))];
