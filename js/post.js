import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ctx, settings } from './state.js';

const FINE = matchMedia('(pointer:fine)').matches;
/* AgX 는 ACES 보다 채도·대비가 낮게 나온다. 시간대별 grade 값은 그대로 두고 여기서 한꺼번에 보정 */
const AGX_SAT = 0.1, AGX_CON = 0.04;

/* RenderPass → GTAO → Bloom → OutputPass → SMAA → Grade
   사진은 화면에 보이는 그대로 찍는다 (예전의 보케 패스는 제거)
   SMAA: MSAA 가 못 잡는 표면 하이라이트 앨리어싱(얇은 크롬·clearcoat 반짝임)을 화면 공간에서 부드럽게. LDR 인 OutputPass 뒤에 둔다
   Grade: 채도·대비·틴트 + 스플릿 토닝(그림자는 하늘 색, 하이라이트는 햇빛 색) + 완만한 필름 커브 + 비네트 + 그레인(밝은 곳에서는 약하게) */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, vig: { value: 0.35 }, grain: { value: 0.02 }, sat: { value: 1 }, con: { value: 1 }, tint: { value: new THREE.Vector3(1, 1, 1) }, sTint: { value: new THREE.Vector3(1, 1, 1) }, hTint: { value: new THREE.Vector3(1, 1, 1) }, filmK: { value: 0.3 } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uTime,vig,grain,sat,con,filmK;uniform vec3 tint,sTint,hTint;varying vec2 vUv;
    float hashg(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
    void main(){vec3 col=texture2D(tDiffuse,vUv).rgb;
      float l=dot(col,vec3(0.299,0.587,0.114));col=mix(vec3(l),col,sat);col=(col-0.5)*con+0.5;col*=tint;
      col*=mix(sTint,hTint,smoothstep(0.1,0.85,l));
      vec3 sc=col*col*(3.0-2.0*col);col=mix(col,sc,filmK);
      float d=distance(vUv,vec2(0.5));col*=1.0-vig*smoothstep(0.45,1.0,d*1.4);
      col+=(hashg(vUv*vec2(1920.0,1080.0)+fract(uTime)*7.0)-0.5)*grain*(1.0-0.55*l);
      gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);}`,
};
const _s = new THREE.Color();
const lum = c => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
function hueTint(out, c, k) { _s.copy(c); const L = Math.max(lum(_s), 1e-3); _s.multiplyScalar(1 / L); _s.r = Math.min(_s.r, 1.8); _s.g = Math.min(_s.g, 1.8); _s.b = Math.min(_s.b, 1.8); out.set(1 + (_s.r - 1) * k, 1 + (_s.g - 1) * k, 1 + (_s.b - 1) * k); }

/* GTAO 합성 셰이더: 원래 합성(AO 를 화면에 곱하기)에 깊이 비교를 더한다.
   GTAO 는 화면과 따로 장면을 다시 그린다 — 흔들림 없는 노멀 재질로, noAO 물체(흔들리는 나무·덤불·갈대 등)는 숨기고.
   그래서 그대로 합성하면 숨긴 나무 위에 뒤쪽 물체의 AO 가 비치고, 바람에 흔들린 풀 옆에 멈춘 자리의 풀 AO 가 남는다.
   화면 깊이(zs)와 GTAO 가 본 깊이(za)가 거리의 1.5~5% 이상 다르면 GTAO 가 다른 면을 본 것이므로 그 픽셀에는 AO 를 칠하지 않는다.
   풀 뿌리·텐트 모서리처럼 두 깊이가 같은 곳의 AO 는 그대로 남는다 */
const BLEND_FS = `#include <packing>
  uniform float intensity,cameraNear,cameraFar;uniform sampler2D tDiffuse,tSceneDepth,tAODepth;varying vec2 vUv;
  void main(){
    vec4 texel=texture2D(tDiffuse,vUv);
    float zs=-perspectiveDepthToViewZ(texture2D(tSceneDepth,vUv).x,cameraNear,cameraFar);
    float za=-perspectiveDepthToViewZ(texture2D(tAODepth,vUv).x,cameraNear,cameraFar);
    float keep=1.0-smoothstep(0.015,0.05,abs(za-zs)/max(zs,1e-3));
    gl_FragColor=vec4(mix(vec3(1.0),texel.rgb,intensity*keep),texel.a);}`;

export function createPost(renderer, camera) {
  /* 화면 깊이를 GTAO 합성에서 읽을 수 있게 깊이 텍스처를 붙인다 (MSAA 면 three 가 깊이도 함께 풀어 준다) */
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
    type: THREE.HalfFloatType, samples: FINE ? 4 : 0, depthTexture: new THREE.DepthTexture(innerWidth, innerHeight),
  });
  const composer = new EffectComposer(renderer, rt);
  /* 컴포저는 rt 를 복제해 두 번째 버퍼를 만든다. 깊이 텍스처를 같이 쓰지 않도록 따로 준다 */
  composer.renderTarget2.depthTexture = new THREE.DepthTexture(innerWidth, innerHeight);
  /* 직접 만든 RT를 넘기면 컴포저가 setSize 를 부르지 않아 DPR 이 반영되지 않는다 → 명시적으로 한 번 */
  composer.setSize(innerWidth, innerHeight);
  const dummy = new THREE.Scene();
  const renderPass = new RenderPass(dummy, camera);
  const gtao = new GTAOPass(dummy, camera, innerWidth, innerHeight);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.updateGtaoMaterial({ radius: 0.4, distanceExponent: 1, thickness: 1, scale: 1.2, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 9, radiusExponent: 1, rings: 4, samples: 16 });
  gtao.blendIntensity = 0.6; gtao.enabled = settings.ao;
  if (gtao.normalMaterial) gtao.normalMaterial.side = THREE.DoubleSide;
  if (gtao.overrideVisibility) { const ov = gtao.overrideVisibility.bind(gtao); gtao.overrideVisibility = function () { ov(); this.scene.traverse(o => { if (o.isSprite || o.userData.noAO) o.visible = false; }); }; }
  /* GTAO 합성에 깊이 비교를 넣는다 (BLEND_FS 설명 참고).
     three r169 GTAOPass 의 내부 이름(blendMaterial · depthTexture)에 기대므로, three 를 올리면 여기를 다시 확인한다 */
  if (gtao.blendMaterial) {
    const bm = gtao.blendMaterial;
    Object.assign(bm.uniforms, {
      tSceneDepth: { value: null }, tAODepth: { value: null },
      cameraNear: { value: camera.near }, cameraFar: { value: camera.far },
    });
    bm.fragmentShader = BLEND_FS; bm.needsUpdate = true;
    /* 이번 프레임의 화면 깊이 = GTAO 가 받는 readBuffer(RenderPass 가 장면을 그린 버퍼)의 깊이 */
    const render = gtao.render.bind(gtao);
    gtao.render = (r, wb, rb, dt, mask) => {
      bm.uniforms.tSceneDepth.value = rb.depthTexture; bm.uniforms.tAODepth.value = gtao.depthTexture;
      bm.uniforms.cameraNear.value = camera.near; bm.uniforms.cameraFar.value = camera.far;
      render(r, wb, rb, dt, mask);
    };
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.4, 1.25);
  const output = new OutputPass();
  const pr = renderer.getPixelRatio();
  const smaa = new SMAAPass(innerWidth * pr, innerHeight * pr); smaa.enabled = FINE;
  const grade = new ShaderPass(GradeShader);
  composer.addPass(renderPass); composer.addPass(gtao); composer.addPass(bloom); composer.addPass(output); composer.addPass(smaa); composer.addPass(grade);
  return {
    composer, bloom, gtao, smaa,
    setScene(scene) { renderPass.scene = scene; gtao.scene = scene; },
    setTime(tm) {
      const g = tm.grade, mul = ctx.W.cfg ? (ctx.W.cfg.bloomMul || 1) : 1;
      grade.uniforms.tint.value.set(...g.tint); grade.uniforms.sat.value = g.sat + AGX_SAT; grade.uniforms.con.value = g.con + AGX_CON; bloom.strength = g.bloom * mul;
      hueTint(grade.uniforms.sTint.value, tm.top, 0.16); hueTint(grade.uniforms.hTint.value, tm.sunColor, 0.2);
    },
    setBloom(on) { bloom.enabled = on; }, setAO(on) { gtao.enabled = on; },
    resize(w, h) { composer.setSize(w, h); },
    update(T) { grade.uniforms.uTime.value = T; },
    render() { composer.render(); },
  };
}