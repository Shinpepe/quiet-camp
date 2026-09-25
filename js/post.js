import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { settings } from './state.js';

/* RenderPass → GTAO(주변광 차폐) → Bokeh(사진 찍을 때만) → Bloom → OutputPass(톤매핑+sRGB) → Grade */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, vig: { value: 0.35 }, grain: { value: 0.04 }, sat: { value: 1 }, con: { value: 1 }, tint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uTime,vig,grain,sat,con;uniform vec3 tint;varying vec2 vUv;
    float hashg(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
    void main(){vec3 col=texture2D(tDiffuse,vUv).rgb;
      float l=dot(col,vec3(0.299,0.587,0.114));col=mix(vec3(l),col,sat);col=(col-0.5)*con+0.5;col*=tint;
      float d=distance(vUv,vec2(0.5));col*=1.0-vig*smoothstep(0.45,1.0,d*1.4);
      col+=(hashg(vUv*vec2(1920.0,1080.0)+fract(uTime)*7.0)-0.5)*grain;
      gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);}`,
};

export function createPost(renderer, camera) {
  const composer = new EffectComposer(renderer);
  const dummy = new THREE.Scene();
  const renderPass = new RenderPass(dummy, camera);

  const gtao = new GTAOPass(dummy, camera, innerWidth, innerHeight);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1, thickness: 1, scale: 1.2, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 12 });
  gtao.blendIntensity = 0.75;
  gtao.enabled = settings.ao;
  if (gtao.overrideVisibility) {   // 구름·태양 스프라이트는 깊이 패스에서 제외
    const ov = gtao.overrideVisibility.bind(gtao);
    gtao.overrideVisibility = function () { ov(); this.scene.traverse(o => { if (o.isSprite) o.visible = false; }); };
  }

  const bokeh = new BokehPass(dummy, camera, { focus: 0.002, aperture: 1.6, maxblur: 0.012 }); bokeh.enabled = false;
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.55, 1.0);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  composer.addPass(renderPass); composer.addPass(gtao); composer.addPass(bokeh); composer.addPass(bloom); composer.addPass(output); composer.addPass(grade);

  return {
    composer, bloom, gtao, bokeh,
    setScene(scene) { renderPass.scene = scene; gtao.scene = scene; bokeh.scene = scene; },
    setTime(tm) { const g = tm.grade; grade.uniforms.tint.value.set(...g.tint); grade.uniforms.sat.value = g.sat; grade.uniforms.con.value = g.con; bloom.strength = g.bloom; },
    setBloom(on) { bloom.enabled = on; },
    setAO(on) { gtao.enabled = on; },
    resize(w, h) { composer.setSize(w, h); },
    update(T) { grade.uniforms.uTime.value = T; },
    render() { composer.render(); },
    /* 사진: 화면 중앙 대상 거리에 초점, 배경 흐림 */
    renderPhoto(focusDist) {
      bokeh.uniforms.focus.value = Math.max(0, (focusDist - camera.near) / (camera.far - camera.near));
      bokeh.enabled = true; composer.render(); bokeh.enabled = false;
    },
  };
}
