import * as THREE from 'three';
import { createStage } from './stage.js';
import { createMaterials, PAINTS } from './materials.js';
import { Rig } from './rig.js';
import { Sparks, Sound } from './fx.js';
import { smooth } from './kit.js';

const $ = (id) => document.getElementById(id);
const stage = createStage($('view'));
const M = createMaterials();
const rig = new Rig(M);
stage.scene.add(rig.root);
const sparks = new Sparks(stage.scene);
const sound = new Sound();

const state = {
  p: 0, target: 0,
  duration: 5.6,
  lights: true,
  scrubbing: false,
  wasMoving: false,
};

/* ---------------- 镜头 ---------------- */
const VIEWS = {
  car: {
    hero: [[5.4, 1.9, 6.4], [0, 0.6, 0]],
    front: [[0.01, 1.2, 8.6], [0, 0.6, 0]],
    side: [[9.2, 1.2, 0.01], [0, 0.6, 0]],
    back: [[-4.6, 2.3, -7.0], [0, 0.6, 0]],
    detail: [[2.7, 0.95, 3.5], [0.5, 0.55, 1.2]],
  },
  mech: {
    hero: [[6.2, 3.3, 13.6], [0, 3.25, 0]],
    front: [[0.01, 3.6, 15.5], [0, 3.25, 0]],
    side: [[15.5, 3.6, 0.01], [0, 3.25, 0]],
    back: [[-6.5, 4.6, -13.5], [0, 3.25, 0]],
    detail: [[2.4, 6.0, 5.4], [0, 5.5, 0]],
  },
};
const camTween = { active: false, t: 0, dur: 1.1, p0: new THREE.Vector3(), p1: new THREE.Vector3(), t0: new THREE.Vector3(), t1: new THREE.Vector3() };
function flyTo(pos, target, dur = 1.1) {
  camTween.active = true; camTween.t = 0; camTween.dur = dur;
  camTween.p0.copy(stage.camera.position); camTween.t0.copy(stage.controls.target);
  camTween.p1.set(...pos); camTween.t1.set(...target);
}
function setView(name, dur) {
  const set = state.p > 0.5 ? VIEWS.mech : VIEWS.car;
  flyTo(set[name][0], set[name][1], dur);
}
const _dir = new THREE.Vector3();
const _pel = new THREE.Vector3();
function followTransform(dt) {
  // 变形过程中镜头目标跟随机体实际高度，距离随体型拉远，保留用户当前的环绕方向
  const c = stage.controls, cam = stage.camera;
  rig.byName.pelvis.obj.getWorldPosition(_pel);
  const ty = 0.1 + _pel.y * 0.9;
  const radius = 8.6 + (15.4 - 8.6) * smooth(0, 0.6, state.p);
  _dir.subVectors(cam.position, c.target).normalize();
  const k = 1 - Math.pow(0.02, dt);
  _dir.y += (0.17 - _dir.y) * k * 0.6;
  _dir.normalize();
  c.target.x += (0 - c.target.x) * k;
  c.target.z += (0 - c.target.z) * k;
  c.target.y += (ty - c.target.y) * Math.min(1, k * 2.5);
  const cur = cam.position.distanceTo(c.target);
  cam.position.copy(c.target).addScaledVector(_dir, cur + (radius - cur) * Math.min(1, k * 2));
}

/* ---------------- 变形控制 ---------------- */
function toggle() {
  sound.unlock();
  camTween.active = false;
  const goingUp = state.target < 0.5 ? true : false;
  state.target = goingUp ? 1 : 0;
  const remain = Math.abs(state.target - state.p) * state.duration;
  if (remain > 0.3) sound.bed(remain, goingUp);
}
$('btn-transform').addEventListener('click', toggle);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
});

const scrub = $('scrub');
scrub.addEventListener('input', () => {
  state.scrubbing = true;
  state.p = state.target = scrub.value / 1000;
});
scrub.addEventListener('change', () => { state.scrubbing = false; });

const _wp = new THREE.Vector3();
rig.onServo = (node, kind) => {
  if (state.scrubbing) return;
  node.obj.getWorldPosition(_wp);
  if (kind === 'start') {
    sound.servo(state.target > 0.5);
  } else {
    sound.clank(0.6 + Math.random() * 0.5);
    sparks.emit(_wp, 10 + Math.floor(Math.random() * 10), 2.4);
  }
};

/* ---------------- 界面 ---------------- */
function toggleBtn(id, get, set) {
  const el = $(id);
  el.addEventListener('click', () => { set(!get()); el.classList.toggle('on', get()); });
}
toggleBtn('btn-rotate', () => stage.controls.autoRotate, (v) => { stage.controls.autoRotate = v; });
toggleBtn('btn-lights', () => state.lights, (v) => { state.lights = v; });
toggleBtn('btn-sound', () => sound.enabled, (v) => { sound.enabled = v; });
stage.controls.autoRotate = true;

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

const sw = $('swatches');
PAINTS.forEach((pnt, i) => {
  const b = document.createElement('button');
  b.title = pnt.name;
  b.style.background = '#' + pnt.color.toString(16).padStart(6, '0');
  if (i === 0) b.classList.add('on');
  b.addEventListener('click', () => {
    M.paint.color.setHex(pnt.color);
    M.paintInner.color.setHex(pnt.inner);
    sw.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
  });
  sw.appendChild(b);
});

const modeEl = $('mode'), labelEl = $('btn-label');
let lastMode = '';
function updateHud() {
  const moving = state.p !== state.target;
  const mode = moving ? '变形中' : state.p > 0.5 ? '机甲形态' : '载具形态';
  if (mode !== lastMode) {
    lastMode = mode;
    modeEl.textContent = mode;
    modeEl.classList.toggle('busy', moving);
    labelEl.textContent = state.target > 0.5 ? '还原' : '变形';
  }
  if (!state.scrubbing) scrub.value = Math.round(state.p * 1000);
}

/* ---------------- 主循环 ---------------- */
const clock = new THREE.Clock();
const _v = new THREE.Vector3();
let shake = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  const moving = state.p !== state.target;
  if (moving) {
    const dir = Math.sign(state.target - state.p);
    state.p += (dir * dt) / state.duration;
    if ((dir > 0 && state.p >= state.target) || (dir < 0 && state.p <= state.target)) {
      state.p = state.target;
      // 变形完成：落地冲击
      shake = 1;
      sound.clank(1.4);
      if (state.target > 0.5) sound.powerUp();
      for (const name of ['foot_L', 'foot_R', 'wheelF_L', 'wheelF_R', 'wheelR_L', 'wheelR_R']) {
        rig.byName[name].obj.getWorldPosition(_v);
        if (state.target > 0.5 ? name.startsWith('foot') : name.startsWith('wheel')) { _v.y = 0.05; sparks.emit(_v, 26, 3.2); }
      }
    }
  }
  rig.setProgress(state.p);
  rig.update(dt);

  // 灯光随形态切换
  const on = state.lights ? 1 : 0;
  const robot = smooth(0.9, 1, state.p);
  const flick = robot > 0 && robot < 1 ? 0.6 + 0.4 * Math.sin(t * 60) : 1;
  M.eye.emissiveIntensity = 10 * robot * flick;
  M.head.emissiveIntensity = on * (9 - 4 * smooth(0.1, 0.5, state.p));
  M.tail.emissiveIntensity = on * 5;
  M.glow.emissiveIntensity = on * (3.6 + 1.2 * Math.sin(t * 2.2) + 2.5 * Math.sin(Math.PI * state.p));

  // 镜头
  if (camTween.active) {
    camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
    const k = camTween.t * camTween.t * (3 - 2 * camTween.t);
    stage.camera.position.lerpVectors(camTween.p0, camTween.p1, k);
    stage.controls.target.lerpVectors(camTween.t0, camTween.t1, k);
    if (camTween.t >= 1) camTween.active = false;
  } else if (moving || state.scrubbing) {
    followTransform(dt);
  }
  stage.controls.update();
  if (shake > 0.001) {
    shake *= Math.pow(0.002, dt);
    stage.camera.position.x += (Math.random() - 0.5) * 0.09 * shake;
    stage.camera.position.y += (Math.random() - 0.5) * 0.09 * shake;
  }

  sparks.update(dt);
  stage.finish.uniforms.uTime.value = t;
  updateHud();
  stage.composer.render();
  state.wasMoving = moving;
  requestAnimationFrame(loop);
}

setView('hero', 0.01);
loop();
$('loading').classList.add('hide');

// 调试入口
window.__app = { stage, rig, state, M, flyTo, setView };
