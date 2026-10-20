import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { records } from './state.js';
import { BG } from './data.js';
import { FISH_SPECIES, fishModel } from './fish.js';
import { clockLabel } from './time.js';

/* ══ 물고기 도감 ══
   부두 끝 태클 상자 위의 노트를 바라보고 E 를 누르면 열린다 (game.js 가 열고 닫는다).
   카드: 잡은 종은 그림·이름·최고 크기, 아직 못 잡은 종은 흐린 실루엣과 "?".
   카드를 누르면 아래 칸에 두 줄로 기록이 나온다:
     붕어 / 3마리 잡음 / 최고 31cm(크기 : 15 ~ 40cm)
     처음 잡은 날 : 호수가 보이는 숲속, 14:03   (처음 잡은 곳을 모르는 예전 기록은 이 줄을 뺀다)
   그림: 낚을 때 쓰는 fishModel 을 처음 열 때 한 번씩 렌더해 둔다 (그림 파일 없음, 종을 추가하면 그림도 저절로 생긴다).
     잡았을 때 눈앞에 든 모습과 같게 — 가로로 누운 옆모습, 머리 쪽이 7° 내려가고 등이 살짝 보인다.
     기울인 물고기 전체가 그림의 가로 84%·세로 74% 안에 들어오도록 카메라를 맞추고, 카드의 그림 칸은 넘치는 부분을 자른다.
   창 모양은 트렁크와 같은 .modal / .box 를 쓰고, 도감에만 필요한 스타일은 아래 CSS 에 둔다 */

export const journalHooks = { close: null };

const TW = 320, TH = 160, LIFT = 0.18, TILT = -0.12, FILL_W = 0.84, FILL_H = 0.74;
let thumbs = null, el = null, sel = -1;

/* 그림의 알파만 남기고 흐린 밝은 색으로 칠한다 → 어두운 창 위에서 모양만 은은하게 보이는 실루엣 */
function silhouette(src) {
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(0, 0, TW, TH);
  return c.toDataURL('image/png');
}

/* 종마다 그림 한 장 + 실루엣 한 장. 작은 렌더러를 잠깐 만들어 쓰고 바로 버린다 (실패하면 그림 없이 글자만) */
function makeThumbs() {
  const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
  let r;
  try { r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true }); }
  catch (e) { console.warn('journal thumbs skipped', e); return FISH_SPECIES.map(() => null); }
  r.setPixelRatio(1); r.setSize(TW, TH, false); r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.AgXToneMapping; r.toneMappingExposure = 1.1;
  const scene = new THREE.Scene(), pm = new THREE.PMREMGenerator(r), env = pm.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture; scene.environmentIntensity = 0.6;
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1.5, 3, 4);
  scene.add(key, new THREE.HemisphereLight(0xdfe8f0, 0x3a3428, 0.8));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  const box = new THREE.Box3(), size = new THREE.Vector3(), mid = new THREE.Vector3();
  const out = FISH_SPECIES.map(sp => {
    const m = fishModel(sp); m.rotation.set(LIFT, 0, TILT); scene.add(m); m.updateMatrixWorld(true);
    box.setFromObject(m); box.getSize(size); box.getCenter(mid);
    /* 가로·세로 중 더 빠듯한 쪽에 맞춰 화면 폭을 정한다 → 어떤 종이든 그림 안에 여백을 두고 들어온다 */
    const halfW = Math.max(size.x / FILL_W, size.y / FILL_H * TW / TH) / 2, halfH = halfW * TH / TW;
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH; cam.updateProjectionMatrix();
    cam.position.set(mid.x, mid.y, mid.z + 5); cam.lookAt(mid);
    r.render(scene, cam);
    const t = { img: cv.toDataURL('image/png'), sil: silhouette(cv) };
    scene.remove(m); m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return t;
  });
  env.dispose(); pm.dispose(); r.dispose(); r.forceContextLoss();
  return out;
}

const CSS = `
#journal .box{width:min(640px,94%)}
.jgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.jcard{display:block;width:100%;padding:8px 8px 10px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--ink);font:inherit;font-family:var(--sans);text-align:center;overflow:hidden;transition:.2s}
.jcard.open{cursor:pointer}
.jcard.open:hover{background:rgba(233,197,138,.08);border-color:rgba(233,197,138,.35)}
.jcard.sel{background:rgba(233,197,138,.1);border-color:var(--accent)}
.jpic{position:relative;width:100%;aspect-ratio:2/1;overflow:hidden}
.jpic img{display:block;width:100%;height:100%;object-fit:contain}
.jq{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:22px;color:var(--mute)}
.jnm{font-family:var(--serif);font-size:14px;letter-spacing:.04em;margin-top:4px}
.jcard.lock .jnm{color:var(--mute)}
.jsz{font-size:11px;color:var(--mute);margin-top:2px}
.jdet{margin-top:14px;min-height:58px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.03);font-size:12.5px;line-height:1.75;color:var(--mute)}
.jdet b{font-weight:500;color:var(--ink)}
@media (max-width:700px){.jgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}`;

/* 창은 처음 열 때 #hud 안에 만든다 (트렁크 창과 같은 자리) */
function ensure() {
  if (el && el.isConnected) return el;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  el = document.createElement('div'); el.className = 'modal'; el.id = 'journal';
  el.innerHTML = '<div class="box"><h2>물고기 도감</h2><div class="sub" data-k="sub"></div>' +
    '<div class="jgrid" data-k="grid"></div><div class="jdet" data-k="det"></div>' +
    '<div class="row"><button class="b" data-k="close">닫기 <kbd>E</kbd></button></div></div>';
  document.querySelector('#hud').append(el);
  const close = () => { if (journalHooks.close) journalHooks.close(); };
  el.querySelector('[data-k=close]').onclick = close;
  el.addEventListener('click', e => { if (e.target === el) close(); });
  return el;
}

/* 아래 칸: 고른 종의 기록 두 줄 */
function detail(caught) {
  if (sel < 0) return caught ? '카드를 누르면 기록을 볼 수 있다' : '아직 잡은 물고기가 없다. 부두 끝에 앉아 낚싯대를 드리워 보자';
  const sp = FISH_SPECIES[sel], r = records.fish[sp.n];
  const l1 = `<div><b>${sp.n}</b> / ${r.count}마리 잡음 / 최고 ${r.best}cm(크기 : ${sp.s[0]} ~ ${sp.s[1]}cm)</div>`;
  const l2 = r.first && BG[r.first.bg] ? `<div>처음 잡은 날 : ${BG[r.first.bg].name}, ${clockLabel(r.first.clock)}</div>` : '';
  return l1 + l2;
}

function render() {
  const grid = el.querySelector('[data-k=grid]'); grid.innerHTML = '';
  let caught = 0;
  FISH_SPECIES.forEach((sp, i) => {
    const r = records.fish[sp.n], t = thumbs[i], open = !!r; if (open) caught++;
    const c = document.createElement(open ? 'button' : 'div');
    c.className = 'jcard' + (open ? ' open' : ' lock') + (i === sel ? ' sel' : '');
    c.innerHTML = `<div class="jpic">${t ? `<img src="${open ? t.img : t.sil}" alt="">` : ''}${open ? '' : '<span class="jq">?</span>'}</div>` +
      `<div class="jnm">${open ? sp.n : '???'}</div><div class="jsz">${open ? '최고 ' + r.best + 'cm' : '—'}</div>`;
    if (open) c.onclick = () => { sel = i; render(); };
    grid.append(c);
  });
  el.querySelector('[data-k=sub]').textContent = `${caught} / ${FISH_SPECIES.length}`;
  el.querySelector('[data-k=det]').innerHTML = detail(caught);
}

export function showJournal() {
  const e = ensure();
  if (!thumbs) thumbs = makeThumbs();
  sel = -1; render(); e.classList.add('on');
}
export function hideJournal() { if (el) el.classList.remove('on'); }