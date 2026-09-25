import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/* 최종 패스: ACES 톤매핑(Three.js와 동일) + 색 보정 + 비네트 + 그레인 + sRGB */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, exposure: { value: 1 }, vig: { value: 0.42 }, grain: { value: 0.04 }, sat: { value: 1 }, con: { value: 1 }, tint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uTime,exposure,vig,grain,sat,con;uniform vec3 tint;varying vec2 vUv;
    float hashg(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
    vec3 aces(vec3 x){x*=exposure/0.6;return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
    void main(){vec3 col=aces(texture2D(tDiffuse,vUv).rgb);
      float l=dot(col,vec3(0.299,0.587,0.114));col=mix(vec3(l),col,sat);col=(col-0.5)*con+0.5;col*=tint;
      float d=distance(vUv,vec2(0.5));col*=1.0-vig*smoothstep(0.35,0.95,d);
      col+=(hashg(vUv*vec2(1920.0,1080.0)+fract(uTime)*7.0)-0.5)*grain;
      col=pow(max(col,0.0),vec3(1.0/2.2));
      gl_FragColor=vec4(col,1.0);}`,
};

export function createPost(renderer, camera) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(new THREE.Scene(), camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.6, 0.7);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(grade);
  return {
    composer, bloom,
    setScene(scene) { renderPass.scene = scene; },
    setTime(tm) { const g = tm.grade; grade.uniforms.exposure.value = tm.exposure; grade.uniforms.tint.value.set(...g.tint); grade.uniforms.sat.value = g.sat; grade.uniforms.con.value = g.con; bloom.strength = g.bloom; },
    setBloom(on) { bloom.enabled = on; },
    resize(w, h) { composer.setSize(w, h); bloom.setSize(w, h); },
    update(T) { grade.uniforms.uTime.value = T; },
    render() { composer.render(); },
  };
}
