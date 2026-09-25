import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/*
  색 파이프라인 (단일 파일 버전과 동일하게 맞춤):
  - 재질: Three.js 가 ACES 톤매핑을 적용해 선형값으로 렌더 타깃에 그림 (main.js: renderer.toneMapping = ACES)
  - 하늘/물: 셰이더가 원본 색을 sRGB→선형으로 바꿔 출력
  - 이 최종 패스: 선형→sRGB 변환 + 색 보정 + 비네트 + 그레인. 톤매핑은 여기서 하지 않음.
*/
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, vig: { value: 0.35 }, grain: { value: 0.045 }, sat: { value: 1 }, con: { value: 1 }, tint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uTime,vig,grain,sat,con;uniform vec3 tint;varying vec2 vUv;
    float hashg(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
    vec3 lin2srgb(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(0.0031308,c));}
    void main(){vec3 col=lin2srgb(clamp(texture2D(tDiffuse,vUv).rgb,0.0,1.0));
      float l=dot(col,vec3(0.299,0.587,0.114));col=mix(vec3(l),col,sat);col=(col-0.5)*con+0.5;col*=tint;
      float d=distance(vUv,vec2(0.5));col*=1.0-vig*smoothstep(0.45,1.0,d*1.4);
      col+=(hashg(vUv*vec2(1920.0,1080.0)+fract(uTime)*7.0)-0.5)*grain;
      gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);}`,
};

export function createPost(renderer, camera) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(new THREE.Scene(), camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.6, 0.85);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(grade);
  return {
    composer, bloom,
    setScene(scene) { renderPass.scene = scene; },
    setTime(tm) { const g = tm.grade; grade.uniforms.tint.value.set(...g.tint); grade.uniforms.sat.value = g.sat; grade.uniforms.con.value = g.con; bloom.strength = g.bloom; },
    setBloom(on) { bloom.enabled = on; },
    resize(w, h) { composer.setSize(w, h); bloom.setSize(w, h); },
    update(T) { grade.uniforms.uTime.value = T; },
    render() { composer.render(); },
  };
}
