// 展台：渲染器、环境光照、反射地面、后期处理
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

function emissivePanel(w, h, color, intensity) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

/** 摄影棚环境：柔光箱 + 灯带，烘焙成 PMREM 环境贴图 */
function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(60, 30, 60),
    new THREE.MeshBasicMaterial({ color: 0x07090d, side: THREE.BackSide })
  );
  room.position.y = 10;
  env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x14171c }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4.9;
  env.add(floor);

  const add = (w, h, color, intensity, pos, look = [0, 2, 0]) => {
    const p = emissivePanel(w, h, color, intensity);
    p.position.set(...pos);
    p.lookAt(...look);
    env.add(p);
  };
  // 顶部大柔光箱
  add(16, 9, 0xffffff, 1.9, [0, 16, 2]);
  // 两条长灯带（车漆上的高光线）
  add(26, 1.2, 0xdfeaff, 7, [-12, 9, 0]);
  add(26, 1.2, 0xfff0dd, 6, [12, 8, -2]);
  // 前后补光
  add(10, 5, 0xffffff, 3.2, [0, 6, 20]);
  add(14, 3, 0x66d8ff, 5, [0, 7, -22]);
  // 中位竖向柔光箱：给立面拉出长高光
  add(5, 13, 0xffffff, 3.2, [-15, 5, 13]);
  add(5, 13, 0xfff4e6, 2.8, [15, 5, 11]);
  add(4, 11, 0xd8ecff, 2.4, [-16, 5, -12]);
  add(9, 5, 0xffffff, 1.4, [0, 2.5, 24]);
  // 低位暖色点缀
  add(6, 2.5, 0xff8a3a, 4, [-18, 1.5, 12]);
  add(6, 2.5, 0x4aa8ff, 4, [18, 1.5, 12]);
  // 竖向灯柱
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    add(0.5, 12, 0xcfe6ff, 4, [Math.cos(a) * 24, 6, Math.sin(a) * 24]);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

function floorTexture() {
  const S = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.translate(S / 2, S / 2);
  const R = S / 2;
  const ring = (r, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(0, 0, r * R, 0, Math.PI * 2); ctx.stroke(); };
  ring(0.50, 5, 'rgba(70,215,255,0.95)');
  ring(0.515, 1.5, 'rgba(70,215,255,0.5)');
  ring(0.36, 1.5, 'rgba(160,200,230,0.28)');
  ring(0.22, 1.5, 'rgba(160,200,230,0.22)');
  ring(0.70, 2, 'rgba(160,200,230,0.2)');
  ring(0.94, 3, 'rgba(255,150,60,0.5)');
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    const long = i % 15 === 0, mid = i % 5 === 0;
    const r0 = 0.50, r1 = long ? 0.47 : mid ? 0.482 : 0.49;
    ctx.strokeStyle = long ? 'rgba(70,215,255,0.95)' : 'rgba(150,200,230,0.5)';
    ctx.lineWidth = long ? 4 : 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0 * R, Math.sin(a) * r0 * R);
    ctx.lineTo(Math.cos(a) * r1 * R, Math.sin(a) * r1 * R);
    ctx.stroke();
  }
  // 十字准线
  ctx.strokeStyle = 'rgba(150,200,230,0.16)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 0.05 * R, Math.sin(a) * 0.05 * R);
    ctx.lineTo(Math.cos(a) * 0.94 * R, Math.sin(a) * 0.94 * R);
    ctx.stroke();
  }
  // 环形文字
  ctx.fillStyle = 'rgba(180,225,245,0.65)';
  ctx.font = '600 22px "Segoe UI", Arial';
  const text = 'AURORA-7  ·  TRANSFORM BAY 04  ·  VEHICLE ⇄ MECH  ·  CLEARANCE 6.5 M  ·  ';
  const full = text.repeat(3);
  const rr = 0.545 * R;
  for (let i = 0; i < full.length; i++) {
    const a = (i / full.length) * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -rr);
    ctx.fillText(full[i], 0, 0);
    ctx.restore();
  }
  // 警示斜纹段
  for (let k = 0; k < 4; k++) {
    const base = (k / 4) * Math.PI * 2 + Math.PI / 4;
    for (let i = 0; i < 9; i++) {
      const a = base + (i - 4) * 0.02;
      ctx.strokeStyle = 'rgba(255,160,60,0.8)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 0.63 * R, Math.sin(a) * 0.63 * R);
      ctx.lineTo(Math.cos(a + 0.012) * 0.67 * R, Math.sin(a + 0.012) * 0.67 * R);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.9 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // 轻微色散
      vec2 off = d * r2 * 0.012;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= mix(1.0, smoothstep(0.75, 0.15, r2 * 1.6), uVignette);
      col += (hash(vUv * 900.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070a);
  scene.fog = new THREE.FogExp2(0x05070a, 0.011);
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 1.1;

  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(6.2, 2.2, 7.4);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0, 0.6, 0);
  controls.minDistance = 3;
  controls.maxDistance = 30;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.autoRotateSpeed = 0.9;

  /* ---- 灯光 ---- */
  const key = new THREE.DirectionalLight(0xfff2e2, 1.5);
  key.position.set(7, 14, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  const sc = key.shadow.camera;
  sc.left = -8; sc.right = 8; sc.top = 9; sc.bottom = -4; sc.near = 1; sc.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 5;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x78c8ff, 1.6);
  rim.position.set(-9, 8, -10);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffa860, 1.2);
  rim2.position.set(10, 4, -8);
  scene.add(rim2);
  scene.add(new THREE.HemisphereLight(0x9bb8d8, 0x101214, 0.35));

  /* ---- 地面 ---- */
  const mirror = new Reflector(new THREE.CircleGeometry(60, 64), {
    textureWidth: Math.min(2048, window.innerWidth * 1.2),
    textureHeight: Math.min(2048, window.innerHeight * 1.2),
    color: 0x5a6068,
    multisample: 4,
  });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);

  const ftex = floorTexture();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(60, 96),
    new THREE.MeshStandardMaterial({
      color: 0x090b0e, roughness: 0.55, metalness: 0.2, envMapIntensity: 0.16,
      transparent: true, opacity: 0.84,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.003;
  floor.receiveShadow = true;
  scene.add(floor);

  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(19, 19),
    new THREE.MeshBasicMaterial({ map: ftex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 })
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.y = 0.006;
  scene.add(decal);

  /* ---- 远景灯柱 ---- */
  const pillars = new THREE.Group();
  const pm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8fd4ff).multiplyScalar(2.2) });
  const pm2 = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.6, metalness: 0.6 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.22;
    const r = 21;
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.4, 16, 1.4), pm2);
    col.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
    col.lookAt(0, 8, 0);
    pillars.add(col);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 13, 0.05), pm);
    bar.position.set(Math.cos(a) * (r - 0.75), 7, Math.sin(a) * (r - 0.75));
    bar.lookAt(0, 7, 0);
    pillars.add(bar);
  }
  const ringGeo = new THREE.TorusGeometry(21, 0.06, 6, 120);
  ringGeo.rotateX(Math.PI / 2);
  for (const y of [14.5, 0.25]) {
    const t = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(y > 1 ? 0x8fd4ff : 0xff9a4a).multiplyScalar(1.6) }));
    t.position.y = y;
    pillars.add(t);
  }
  scene.add(pillars);

  /* ---- 后期 ---- */
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let gtao = null;
  try {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: 0.42, distanceExponent: 1.4, thickness: 1.4, scale: 1.25, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtao.blendIntensity = 1.0;
    composer.addPass(gtao);
  } catch (e) {
    console.warn('GTAO 不可用，已跳过', e);
  }
  // 压住过亮的镜面高光，避免辉光炸成一团
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: FinishShader.vertexShader,
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(min(c.rgb, vec3(5.0)), c.a); }',
  }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.5, 2.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, controls, composer, bloom, gtao, finish, key, floor, mirror, decal };
}
