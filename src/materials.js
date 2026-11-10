// PBR 材质库（全程序化贴图）
import * as THREE from 'three';

function canvasTex(w, h, draw, { repeat = [1, 1], srgb = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 伪随机
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 金属漆闪粉法线贴图 */
function flakeNormal() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const r = rng(7);
    for (let i = 0; i < w * h; i++) {
      const a = r() * Math.PI * 2, m = r() * 0.55;
      img.data[i * 4] = 128 + Math.cos(a) * m * 127;
      img.data[i * 4 + 1] = 128 + Math.sin(a) * m * 127;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: [14, 14] });
}

/** 拉丝/磨损粗糙度贴图 */
function wearRough(seed = 3) {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(0, 0, w, h);
    const r = rng(seed);
    for (let i = 0; i < 2600; i++) {
      const x = r() * w, y = r() * h, l = 10 + r() * 90;
      const g = 110 + Math.floor(r() * 110);
      ctx.strokeStyle = `rgba(${g},${g},${g},${0.10 + r() * 0.2})`;
      ctx.lineWidth = 0.5 + r() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + l, y + (r() - 0.5) * 8);
      ctx.stroke();
    }
    for (let i = 0; i < 160; i++) {
      const x = r() * w, y = r() * h, rad = 6 + r() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const v = r() > 0.5 ? 200 : 90;
      g.addColorStop(0, `rgba(${v},${v},${v},0.16)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }, { repeat: [2, 2] });
}

/** 碳纤维编织 */
function carbonTex() {
  const draw = (normal) => (ctx, w, h) => {
    const n = 8, s = w / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const horiz = ((x + Math.floor(y / 2) * 1) % 4) < 2 ? (y % 2 === 0) : (y % 2 === 1);
        const g = ctx.createLinearGradient(x * s, y * s, horiz ? x * s : (x + 1) * s, horiz ? (y + 1) * s : y * s);
        if (normal) {
          g.addColorStop(0, horiz ? 'rgb(128,80,255)' : 'rgb(80,128,255)');
          g.addColorStop(1, horiz ? 'rgb(128,176,255)' : 'rgb(176,128,255)');
        } else {
          g.addColorStop(0, '#16181b');
          g.addColorStop(0.5, '#3a3d42');
          g.addColorStop(1, '#141518');
        }
        ctx.fillStyle = g;
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  };
  return {
    map: canvasTex(128, 128, draw(false), { repeat: [10, 10], srgb: true }),
    normalMap: canvasTex(128, 128, draw(true), { repeat: [10, 10] }),
  };
}

/** 轮胎：u 绕圆周，v 沿断面（中段为胎面） */
function tireBump() {
  return canvasTex(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    const t0 = h * 0.33, t1 = h * 0.67;
    // 胎面
    ctx.fillStyle = '#b0b0b0';
    ctx.fillRect(0, t0, w, t1 - t0);
    ctx.strokeStyle = '#101010';
    ctx.lineWidth = 5;
    const n = 48;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * w;
      ctx.beginPath();
      ctx.moveTo(x, t0 - 6);
      ctx.lineTo(x + 14, (t0 + t1) / 2);
      ctx.lineTo(x, t1 + 6);
      ctx.stroke();
    }
    ctx.fillStyle = '#080808';
    for (const f of [0.42, 0.5, 0.58]) ctx.fillRect(0, h * f - 3, w, 6);
    // 胎侧环线与字样
    ctx.strokeStyle = '#a8a8a8';
    ctx.lineWidth = 2;
    for (const f of [0.1, 0.14, 0.86, 0.9]) {
      ctx.beginPath(); ctx.moveTo(0, h * f); ctx.lineTo(w, h * f); ctx.stroke();
    }
    ctx.fillStyle = '#c8c8c8';
    ctx.font = 'bold 26px Arial';
    for (let i = 0; i < 4; i++) {
      ctx.fillText('AURORA  R-ZERO  305/30', 20 + i * 256, h * 0.25);
      ctx.fillText('AURORA  R-ZERO  305/30', 20 + i * 256, h * 0.80);
    }
  }, { repeat: [1, 1] });
}

/** 蜂窝格栅 */
function meshTex() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#030303';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3c4046';
    ctx.lineWidth = 5;
    const r = 30;
    const hex = (cx, cy) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 1.22;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    };
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2]]) hex(x, y);
  }, { repeat: [1, 1], srgb: true });
}

/** 车门编号贴花 */
function numberDecal() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 300;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 300);
  ctx.save();
  ctx.transform(1, 0, -0.22, 1, 40, 0);
  ctx.fillStyle = '#eef3f8';
  ctx.font = '900 230px "Arial Black", Impact, Arial';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('07', 70, 222);
  ctx.fillStyle = '#5fd8ff';
  ctx.fillRect(60, 240, 330, 10);
  ctx.fillStyle = '#eef3f8';
  ctx.fillRect(60, 258, 200, 5);
  ctx.font = '700 26px Arial';
  ctx.fillText('AURORA', 280, 284);
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 警示条 + 色块标识（左右镜像后依然成立，不含文字） */
function labelDecal() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = '#e9a23b';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(8 + i * 18, 56); ctx.lineTo(20 + i * 18, 56); ctx.lineTo(32 + i * 18, 8); ctx.lineTo(20 + i * 18, 8);
    ctx.fill();
  }
  ctx.fillStyle = '#e8eef4';
  const r = rng(5);
  let x = 132;
  while (x < 244) { const w = 2 + Math.floor(r() * 7); ctx.fillRect(x, 10, w, 30); x += w + 2 + Math.floor(r() * 4); }
  ctx.fillRect(132, 46, 112, 4);
  ctx.fillRect(132, 54, 60, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createMaterials() {
  const flakes = flakeNormal();
  const wear = wearRough(3);
  const wear2 = wearRough(11);
  const carbon = carbonTex();
  const P = THREE.MeshPhysicalMaterial;
  const S = THREE.MeshStandardMaterial;

  const M = {
    // 主车漆：钴蓝金属漆 + 清漆层
    paint: new P({
      color: 0x0c3fdc, metalness: 0.62, roughness: 0.32,
      clearcoat: 1, clearcoatRoughness: 0.06,
      normalMap: flakes, normalScale: new THREE.Vector2(0.11, 0.11),
      envMapIntensity: 1.15,
    }),
    // 面板内侧
    paintInner: new S({ color: 0x0a1a44, metalness: 0.8, roughness: 0.55, roughnessMap: wear }),
    // 赛车条纹：珍珠银
    stripe: new P({
      color: 0xdfe5ee, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05,
      normalMap: flakes, normalScale: new THREE.Vector2(0.08, 0.08),
    }),
    gun: new S({ color: 0x4a505a, metalness: 1, roughness: 0.42, roughnessMap: wear }),
    dark: new S({ color: 0x1b1e23, metalness: 0.92, roughness: 0.5, roughnessMap: wear2 }),
    steel: new S({ color: 0xb9c0c9, metalness: 1, roughness: 0.26, roughnessMap: wear }),
    chrome: new S({ color: 0xffffff, metalness: 1, roughness: 0.06 }),
    copper: new S({ color: 0xd9813a, metalness: 1, roughness: 0.3, roughnessMap: wear2 }),
    black: new S({ color: 0x08090a, metalness: 0.2, roughness: 0.72 }),
    rubber: new S({ color: 0x0b0b0c, metalness: 0, roughness: 0.88 }),
    carbon: new P({
      color: 0xffffff, map: carbon.map, normalMap: carbon.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      metalness: 0.4, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08,
    }),
    mesh: new S({ color: 0xffffff, map: meshTex(), metalness: 0.7, roughness: 0.5 }),
    glass: new P({
      color: 0x04070b, metalness: 0.0, roughness: 0.09,
      clearcoat: 1, clearcoatRoughness: 0.1,
      transparent: true, opacity: 0.93, envMapIntensity: 1.7,
    }),
    lens: new P({
      color: 0xffffff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.28,
      clearcoat: 1, envMapIntensity: 1.5,
    }),
    // 发光
    glow: new S({ color: 0x06141c, emissive: 0x35d6ff, emissiveIntensity: 4.5, roughness: 0.4 }),
    eye: new S({ color: 0x06141c, emissive: 0x58e4ff, emissiveIntensity: 0, roughness: 0.3 }),
    head: new S({ color: 0x1a1c20, emissive: 0xdff2ff, emissiveIntensity: 9, roughness: 0.3 }),
    tail: new S({ color: 0x200404, emissive: 0xff0a06, emissiveIntensity: 5, roughness: 0.3 }),
    brake: new P({ color: 0xe0661a, metalness: 0.5, roughness: 0.35, clearcoat: 1 }),
  };
  M.tire = new S({
    color: 0x0c0c0d, metalness: 0, roughness: 0.86,
    bumpMap: tireBump(), bumpScale: 2.2,
  });
  M.disc = new S({ color: 0x8d9299, metalness: 1, roughness: 0.34, roughnessMap: wear });
  const decalOpts = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, metalness: 0.3, roughness: 0.45 };
  M.decal = new S({ map: numberDecal(), ...decalOpts });
  M.label = new S({ map: labelDecal(), ...decalOpts });
  M.decal.userData.noShadow = true;
  M.label.userData.noShadow = true;
  M.glass.userData.noShadow = false;
  M.lens.userData.noShadow = true;
  for (const k of ['glow', 'eye', 'head', 'tail']) M[k].userData.noShadow = true;
  return M;
}

export const PAINTS = [
  { name: '钴蓝', color: 0x0c3fdc, inner: 0x0a1a44 },
  { name: '熔岩橙', color: 0xd9430b, inner: 0x3a1206 },
  { name: '翡翠绿', color: 0x0a7a4a, inner: 0x052a1c },
  { name: '珍珠白', color: 0xe8ecf0, inner: 0x3a3f47 },
  { name: '曜石黑', color: 0x101216, inner: 0x0a0b0d },
];
