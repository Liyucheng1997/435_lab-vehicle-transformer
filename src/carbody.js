// 载具形态：参数化车身曲面 → 切分为可独立运动的面板
import * as THREE from 'three';
import { Builder, X, D, rbox, cyl, lathe, disc, plate, tube, strut, spline, smooth, boltRing } from './kit.js';

/* ---------------- 关键尺寸（米） ---------------- */
export const CAR = {
  ZW_F: 1.38,   // 前轴
  ZW_R: -1.32,  // 后轴
  YW: 0.355,    // 轮心高
  RW: 0.355,    // 轮胎半径
  RA: 0.418,    // 轮拱半径
  XW: 0.79,     // 轮心横向位置
};
const { ZW_F, ZW_R, YW, RA, XW } = CAR;

const N = 5;                       // 车身截面超椭圆指数
const HS = Math.pow(0.5, 1 / N);
const NG = 2.7;                    // 座舱截面指数
const HSG = Math.pow(0.5, 1 / NG);

// 俯视半宽
const Wf = spline([[-2.3, 0.80], [-2.2, 0.86], [-2.0, 0.93], [-1.7, 0.975], [-1.32, 1.0], [-0.85, 0.975],
  [-0.2, 0.955], [0.5, 0.955], [1.0, 0.975], [1.38, 0.99], [1.8, 0.955], [2.05, 0.90], [2.2, 0.82], [2.3, 0.74]]);
// 车身顶线（腰线/机盖/尾箱高度）
const yTf = spline([[-2.3, 0.84], [-2.2, 0.87], [-2.0, 0.93], [-1.5, 0.96], [-0.9, 0.95], [-0.45, 0.935],
  [0.2, 0.925], [0.8, 0.91], [1.38, 0.87], [1.9, 0.74], [2.2, 0.60], [2.3, 0.55]]);
// 车身底线
const yBf = spline([[-2.3, 0.35], [-2.2, 0.33], [-1.9, 0.25], [-1.0, 0.17], [0.9, 0.17], [1.9, 0.19], [2.2, 0.21], [2.3, 0.22]]);
// 座舱高度（相对顶线）
const hgf = spline([[-1.64, 0], [-1.3, 0.085], [-0.8, 0.235], [-0.3, 0.315], [0.12, 0.31], [0.5, 0.17], [0.88, 0]]);

function sect(t, n, hs) {
  if (t <= 1) {
    const h = t * hs;
    return [Math.pow(1 - Math.pow(h, n), 1 / n), h];
  }
  const xn = Math.max(0, (2 - t) * hs);
  return [xn, Math.pow(1 - Math.pow(xn, n), 1 / n)];
}

/** 车身曲面：z 纵向，t∈[0,4]（0=右门槛，2=顶部中线，4=左门槛） */
export function body(z, t) {
  const neg = t > 2;
  const tt = neg ? 4 - t : t;
  const [xn, h] = sect(tt, N, HS);
  const W = Wf(z), yb = yBf(z), yt = yTf(z);
  const tuck = 1 - 0.085 * (1 - smooth(0, 0.45, h)) ** 2;
  let x = W * xn * tuck;
  // 车门处的导流凹槽
  x -= 0.03 * Math.exp(-(((h - 0.42) / 0.15) ** 2)) * smooth(-1.05, -0.55, z) * (1 - smooth(0.7, 1.15, z));
  let y = yb + (yt - yb) * h;
  const top = smooth(0.8, 1.0, h);
  y += 0.03 * (1 - xn * xn) * top;
  // 机盖中央隆起
  y += 0.022 * (1 - smooth(0.2, 0.36, x)) * smooth(0.9, 1.15, z) * (1 - smooth(1.6, 2.0, z)) * top;
  return [neg ? -x : x, y, z];
}

function tFromY(z, y) {
  const yb = yBf(z), yt = yTf(z);
  const h = Math.min(0.9995, Math.max(0, (y - yb) / (yt - yb)));
  if (h <= HS) return h / HS;
  return 2 - Math.pow(1 - Math.pow(h, N), 1 / N) / HS;
}

/** 座舱曲面：从腰线(t=1)升起的玻璃舱盖 */
export function cabin(z, s) {
  const neg = s > 2;
  const ss = neg ? 4 - s : s;
  const [xn, h] = sect(ss, NG, HSG);
  const B = body(z, 1.0);
  const yTop = yTf(z) + 0.03 + Math.max(0, hgf(z));
  const x = B[0] * xn;
  const y = B[1] + (yTop - B[1]) * h;
  return [neg ? -x : x, y, z];
}

/* ---------------- 曲面分片（带厚度） ---------------- */

function normalAt(f, z, t, out) {
  const e = 1.5e-3;
  const a = f(z + e, t), b = f(z - e, t), c = f(z, t + e), d = f(z, t - e);
  const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2];
  const vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
  let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  const p = f(z, t);
  if (nx * p[0] + ny * (p[1] - 0.5) < 0) { nx = -nx; ny = -ny; nz = -nz; }
  out[0] = nx; out[1] = ny; out[2] = nz;
  return p;
}

/**
 * 生成曲面片。返回 { outer, inner }（inner 含内表面与侧壁）
 * arch: 轮拱中心 z（在侧围上挖出轮拱）
 */
function patch(f, z0, z1, t0, t1, { th = 0.02, off = 0, arch = null, dz = 0.028, dt = 0.04, fit = null } = {}) {
  const nu = Math.max(2, Math.ceil((z1 - z0) / dz));
  const nv = Math.max(2, Math.ceil((t1 - t0) / dt));
  const cols = nv + 1;
  const count = (nu + 1) * cols;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const snapped = new Uint8Array(count);
  const n = [0, 0, 0];
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      let z = z0 + ((z1 - z0) * i) / nu;
      let t = t0 + ((t1 - t0) * j) / nv;
      const k = i * cols + j;
      if (arch !== null) {
        const p0 = f(z, t);
        let dzw = p0[2] - arch, dyw = p0[1] - YW;
        const d2 = dzw * dzw + dyw * dyw;
        if (d2 < RA * RA) {
          snapped[k] = 1;
          if (dyw >= 0) {
            const d = Math.sqrt(d2);
            if (d < 1e-5) { dzw = 0; dyw = RA; } else { dzw *= RA / d; dyw *= RA / d; }
          } else {
            dzw = (dzw >= 0 ? 1 : -1) * Math.sqrt(RA * RA - dyw * dyw);
          }
          z = arch + dzw;
          const tt = tFromY(z, YW + dyw);
          t = t > 2 ? 4 - tt : tt;
        }
      }
      const p = normalAt(f, z, t, n);
      pos[k * 3] = p[0] + n[0] * off; pos[k * 3 + 1] = p[1] + n[1] * off; pos[k * 3 + 2] = p[2] + n[2] * off;
      nor[k * 3] = n[0]; nor[k * 3 + 1] = n[1]; nor[k * 3 + 2] = n[2];
      if (fit) { uv[k * 2] = fit[0] ? 1 - i / nu : i / nu; uv[k * 2 + 1] = fit[1] ? 1 - j / nv : j / nv; }
      else { uv[k * 2] = z; uv[k * 2 + 1] = t * 0.5; }
    }
  }
  // 三角形
  const tris = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * cols + j, b = a + cols, c = a + 1, d = b + 1;
      tris.push([a, b, c], [c, b, d]);
    }
  }
  // 统一绕序为从外侧看逆时针
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), E1 = new THREE.Vector3(), E2 = new THREE.Vector3();
  const getP = (i, v) => v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  let flip = false;
  for (const tr of tris) {
    if (snapped[tr[0]] || snapped[tr[1]] || snapped[tr[2]]) continue;
    getP(tr[0], A); getP(tr[1], B); getP(tr[2], C);
    E1.subVectors(B, A).cross(E2.subVectors(C, A));
    if (E1.lengthSq() < 1e-12) continue;
    flip = E1.x * nor[tr[0] * 3] + E1.y * nor[tr[0] * 3 + 1] + E1.z * nor[tr[0] * 3 + 2] < 0;
    break;
  }
  const kept = [];
  for (const tr of tris) {
    if (snapped[tr[0]] && snapped[tr[1]] && snapped[tr[2]]) continue;
    kept.push(flip ? [tr[0], tr[2], tr[1]] : tr);
  }
  const outer = new THREE.BufferGeometry();
  outer.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  outer.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  outer.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  outer.setIndex(kept.flat());
  if (!th) return { outer, inner: null };

  // 内表面 + 边缘侧壁
  const ip = [], inn = [], iuv = [];
  const inner = (i) => [pos[i * 3] - nor[i * 3] * th, pos[i * 3 + 1] - nor[i * 3 + 1] * th, pos[i * 3 + 2] - nor[i * 3 + 2] * th];
  for (const tr of kept) {
    for (const i of [tr[0], tr[2], tr[1]]) {
      ip.push(...inner(i));
      inn.push(-nor[i * 3], -nor[i * 3 + 1], -nor[i * 3 + 2]);
      iuv.push(uv[i * 2], uv[i * 2 + 1]);
    }
  }
  const edges = new Map();
  for (const tr of kept) {
    for (let e = 0; e < 3; e++) {
      const a = tr[e], b = tr[(e + 1) % 3];
      const key = a < b ? a * count + b : b * count + a;
      if (edges.has(key)) edges.set(key, null);
      else edges.set(key, [a, b]);
    }
  }
  for (const e of edges.values()) {
    if (!e) continue;
    const [a, b] = e;
    getP(a, A); getP(b, B);
    const ai = inner(a), bi = inner(b);
    // 侧壁法线 = (b-a) × n
    E1.subVectors(B, A);
    E2.set(nor[a * 3] + nor[b * 3], nor[a * 3 + 1] + nor[b * 3 + 1], nor[a * 3 + 2] + nor[b * 3 + 2]);
    E1.cross(E2).normalize();
    const quad = [B.toArray(), A.toArray(), ai, B.toArray(), ai, bi];
    for (const q of quad) { ip.push(...q); inn.push(E1.x, E1.y, E1.z); iuv.push(0, 0); }
  }
  const ig = new THREE.BufferGeometry();
  ig.setAttribute('position', new THREE.Float32BufferAttribute(ip, 3));
  ig.setAttribute('normal', new THREE.Float32BufferAttribute(inn, 3));
  ig.setAttribute('uv', new THREE.Float32BufferAttribute(iuv, 2));
  return { outer, inner: ig };
}

function addPatch(b, f, z0, z1, t0, t1, matOuter, matInner, opts) {
  const p = patch(f, z0, z1, t0, t1, opts);
  b.add(p.outer, matOuter);
  if (p.inner) b.add(p.inner, matInner || matOuter);
}

/** 轮拱内衬 + 拱沿饰条（+x 侧） */
function wheelWell(b, M, zc) {
  const pos = [], nor = [], idx = [];
  const seg = 36, a0 = -0.42, a1 = Math.PI + 0.42;
  const xin = 0.5;
  const lip = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    const c = Math.cos(a), s = Math.sin(a);
    const z = zc + (RA + 0.004) * c, y = YW + (RA + 0.004) * s;
    const xs = body(z, tFromY(z, y))[0];
    pos.push(xs - 0.012, y, z, xin, y, z);
    nor.push(0, -s, -c, 0, -s, -c);
    lip.push([xs + 0.002, YW + RA * s, zc + RA * c]);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
    }
  }
  // 内端封板
  const base = pos.length / 3;
  pos.push(xin, YW, zc); nor.push(1, 0, 0);
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    pos.push(xin, YW + (RA + 0.004) * Math.sin(a), zc + (RA + 0.004) * Math.cos(a));
    nor.push(1, 0, 0);
    if (i < seg) idx.push(base, base + 1 + i, base + 2 + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  // 绕序校正：让几何法线与给定法线一致
  const gg = g.toNonIndexed();
  const P = gg.attributes.position, Nn = gg.attributes.normal;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < P.count; i += 3) {
    A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i + 1); C.fromBufferAttribute(P, i + 2);
    B.sub(A); C.sub(A); B.cross(C);
    if (B.x * Nn.getX(i) + B.y * Nn.getY(i) + B.z * Nn.getZ(i) < 0) {
      for (const attr of [P, Nn]) {
        const x = attr.getX(i + 1), y = attr.getY(i + 1), z = attr.getZ(i + 1);
        attr.setXYZ(i + 1, attr.getX(i + 2), attr.getY(i + 2), attr.getZ(i + 2));
        attr.setXYZ(i + 2, x, y, z);
      }
    }
  }
  b.add(gg, M.black);
  b.add(tube(lip, 0.011, 6, 48), M.black);
}

/* ---------------- 车轮 ---------------- */

export function buildWheel(M) {
  const b = new Builder();
  // 轮胎
  const tp = [[0.24, -0.125], [0.27, -0.14], [0.315, -0.142], [0.343, -0.128], [0.355, -0.1], [0.357, 0],
    [0.355, 0.1], [0.343, 0.128], [0.315, 0.142], [0.27, 0.14], [0.24, 0.125]];
  b.add(lathe(tp, 72, { smooth: true, axis: 'x' }), M.tire);
  // 轮辋外唇
  b.add(lathe([[0.224, 0.1], [0.246, 0.118], [0.25, 0.134], [0.238, 0.142], [0.224, 0.126]], 64, { axis: 'x' }), M.steel);
  b.add(lathe([[0.246, -0.118], [0.224, -0.1], [0.224, -0.126], [0.238, -0.142], [0.25, -0.134], [0.246, -0.118]], 48, { axis: 'x' }), M.dark);
  // 轮辋筒 + 背板
  b.add(lathe([[0.224, 0.126], [0.224, -0.11], [0.08, -0.11]], 64, { axis: 'x' }), M.dark);
  // 刹车盘 + 卡钳
  b.add(disc(0.195, 0.022, 0.003, 'x', 48, 0.085), M.disc, X(0.03, 0, 0));
  b.add(disc(0.09, 0.05, 0.006, 'x', 32), M.gun, X(0.045, 0, 0));
  b.add(lathe([[0.125, -0.03], [0.212, -0.03], [0.212, 0.05], [0.125, 0.05], [0.125, -0.03]], 10,
    { axis: 'x', arc: 1.05, arcStart: Math.PI * 0.5 - 0.2 }), M.brake, X(0.03, 0, 0));
  // Y 形轮辐 ×5
  const spoke = plate([[-0.03, 0.04], [0.03, 0.04], [0.024, 0.115], [0.082, 0.228], [0.05, 0.228], [0, 0.155],
    [-0.05, 0.228], [-0.082, 0.228], [-0.024, 0.115]], 0.032, 0.008);
  spoke.rotateY(Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    b.add(spoke, M.steel, X(0.098, 0, 0, (i / 5) * Math.PI * 2, 0, 0));
  }
  // 轮毂、螺栓、发光环、中心盖
  b.add(disc(0.078, 0.05, 0.008, 'x', 32), M.gun, X(0.105, 0, 0));
  boltRing(b, M.chrome, 0.134, 0, 0, 0.056, 5, 'x', 0.011, 0.014);
  const ring = new THREE.TorusGeometry(0.034, 0.0045, 8, 32);
  ring.rotateY(Math.PI / 2);
  b.add(ring, M.glow, X(0.131, 0, 0));
  b.add(disc(0.026, 0.012, 0.004, 'x', 24), M.chrome, X(0.135, 0, 0));
  return b.build('wheel');
}

/* ---------------- 车身各部件（车体坐标系） ---------------- */

const STRIPE_T = [1.70, 1.915];

function frontPlatePts(zc) {
  const pts = [[0.004, yBf(zc)]];
  for (let i = 0; i <= 30; i++) {
    const p = body(zc, (2 * i) / 30);
    pts.push([Math.max(p[0], 0.004), p[1]]);
  }
  return pts;
}

export function buildCarParts(M) {
  const parts = {};
  const done = (name, b, pivot) => {
    const box = b.bounds();
    const pv = pivot ? new THREE.Vector3(...pivot) : box.getCenter(new THREE.Vector3());
    parts[name] = { group: b.build(name, pv), pivot: pv };
  };
  const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
  const both = (name, b, pivot, extra) => {
    const bn = new Builder().merge(b, mirror);
    if (extra) { extra(b, 1); extra(bn, -1); }
    done(name + '_p', b, pivot);
    done(name + '_n', bn, pivot ? [-pivot[0], pivot[1], pivot[2]] : null);
  };
  const G = 0.004; // 面板缝隙

  /* --- 引擎盖（半边） --- */
  {
    const b = new Builder();
    addPatch(b, body, 0.85, 2.03, 1.12 + G, 2 - G * 0.5, M.paint, M.paintInner, { th: 0.022 });
    // 赛车条纹
    addPatch(b, body, 0.86, 2.02, STRIPE_T[0], STRIPE_T[1], M.stripe, null, { th: 0, off: 0.0015 });
    // 散热口
    addPatch(b, body, 1.2, 1.52, 1.34, 1.58, M.black, null, { th: 0, off: 0.002 });
    for (let i = 0; i < 4; i++) {
      const z = 1.225 + i * 0.075;
      addPatch(b, body, z, z + 0.04, 1.35, 1.57, M.paint, M.paintInner, { th: 0.006, off: 0.009, dz: 0.02 });
    }
    // 内侧加强筋（变形后露出的机盖背面）
    for (const z of [1.05, 1.35, 1.65, 1.9]) {
      addPatch(b, body, z, z + 0.05, 1.2, 1.95, M.gun, null, { th: 0, off: -0.03, dz: 0.05 });
    }
    both('hood', b);
  }

  /* --- 前翼子板 --- */
  {
    const b = new Builder();
    addPatch(b, body, 0.78, 2.03, 0, 1.12 - G, M.paint, M.paintInner, { th: 0.022, arch: ZW_F });
    wheelWell(b, M, ZW_F);
    // 侧鳃 + 能量线
    addPatch(b, body, 0.815, 0.935, 0.34, 0.72, M.black, null, { th: 0, off: 0.002, dz: 0.03 });
    addPatch(b, body, 0.872, 0.88, 0.37, 0.69, M.glow, null, { th: 0, off: 0.005, dz: 0.02 });
    both('fender', b, [XW, YW, ZW_F]);
  }

  /* --- 车门（含侧窗、后视镜） --- */
  {
    const b = new Builder();
    addPatch(b, body, -0.45 + G, 0.75, 0.16 + G, 1.0 - G, M.paint, M.paintInner, { th: 0.03 });
    addPatch(b, cabin, -0.42, 0.13, 0.05, 0.93, M.glass, M.black, { th: 0.008, off: 0.001 });
    // 门把手
    addPatch(b, body, -0.34, -0.2, 0.80, 0.86, M.black, null, { th: 0, off: 0.002, dz: 0.03 });
    // 后视镜
    b.add(strut([0.84, 0.86, 0.3], [0.98, 0.93, 0.31], 0.014, 8), M.black);
    b.add(rbox(0.07, 0.085, 0.17, 0.03), M.paint, X(1.01, 0.945, 0.29, 0, 0.12, 0));
    b.box(0.05, 0.06, 0.01, M.chrome, X(1.012, 0.945, 0.203, 0, 0.12, 0), 0.004);
    // 门内侧骨架
    b.box(0.03, 0.42, 0.9, M.dark, X(0.86, 0.52, 0.15), 0.01);
    b.box(0.035, 0.08, 1.0, M.gun, X(0.85, 0.62, 0.15), 0.01);
    b.box(0.035, 0.08, 1.0, M.gun, X(0.85, 0.38, 0.15), 0.01);
    both('door', b, null, (bb, side) => {
      // 车门编号（左右分别生成，保证文字不被镜像）
      if (side > 0) addPatch(bb, body, -0.3, 0.26, 0.3, 0.74, M.decal, null, { th: 0, off: 0.003, fit: [true, false] });
      else addPatch(bb, body, -0.3, 0.26, 4 - 0.74, 4 - 0.3, M.decal, null, { th: 0, off: 0.003, fit: [false, true] });
    });
  }

  /* --- 门槛 --- */
  {
    const b = new Builder();
    addPatch(b, body, -0.45 + G, 0.75, 0, 0.16 - G, M.carbon, M.dark, { th: 0.03 });
    b.box(0.05, 0.09, 1.16, M.dark, X(0.86, 0.235, 0.15), 0.015);
    b.box(0.006, 0.008, 0.86, M.glow, X(0.908, 0.2, 0.15), 0.002);
    both('sill', b);
  }

  /* --- 后翼子板 + 半边尾箱盖 --- */
  {
    const b = new Builder();
    addPatch(b, body, -2.03, -0.48, 0, 1.0 - G, M.paint, M.paintInner, { th: 0.022, arch: ZW_R });
    addPatch(b, body, -2.03, -1.63, 1.0 + G, 2 - G * 0.5, M.paint, M.paintInner, { th: 0.022 });
    addPatch(b, body, -2.02, -1.64, STRIPE_T[0], STRIPE_T[1], M.stripe, null, { th: 0, off: 0.0015 });
    // 鸭尾
    addPatch(b, body, -2.03, -1.95, 1.06, 1.995, M.carbon, M.carbon, { th: 0.012, off: 0.016, dz: 0.02 });
    wheelWell(b, M, ZW_R);
    // 侧进气口
    addPatch(b, body, -0.88, -0.56, 0.3, 0.7, M.black, null, { th: 0, off: 0.002 });
    parts._quarterBuilder = b; // 小腿机械结构稍后并入
  }

  /* --- 车鼻（半边前保） --- */
  {
    const b = new Builder();
    addPatch(b, body, 2.03 + G * 2, 2.2, 0, 2 - G * 0.5, M.paint, M.paintInner, { th: 0.022 });
    addPatch(b, body, 2.04, 2.2, STRIPE_T[0], STRIPE_T[1], M.stripe, null, { th: 0, off: 0.0015 });
    // 日行灯带
    addPatch(b, body, 2.09, 2.17, 0.72, 1.42, M.black, null, { th: 0, off: 0.002, dz: 0.02 });
    addPatch(b, body, 2.12, 2.14, 0.76, 1.38, M.head, null, { th: 0, off: 0.005, dz: 0.02 });
    const zc = 2.2;
    const holes = [
      [[0.075, 0.265], [0.40, 0.265], [0.455, 0.31], [0.40, 0.405], [0.075, 0.405]],
      [[0.52, 0.262], [0.69, 0.275], [0.715, 0.40], [0.55, 0.425]],
      [[0.30, 0.468], [0.70, 0.452], [0.72, 0.492], [0.30, 0.508]],
    ];
    b.add(plate(frontPlatePts(zc), 0.1, 0.014, holes), M.paint, X(0, 0, zc + 0.045));
    b.box(0.74, 0.3, 0.02, M.black, X(0.39, 0.38, 2.2), 0.004);
    const mesh1 = new THREE.PlaneGeometry(0.42, 0.17);
    b.add(mesh1, M.mesh, X(0.265, 0.335, 2.232));
    b.add(new THREE.PlaneGeometry(0.21, 0.17), M.mesh, X(0.62, 0.345, 2.232));
    b.box(0.36, 0.014, 0.04, M.steel, X(0.25, 0.31, 2.262), 0.004);
    b.box(0.36, 0.014, 0.04, M.steel, X(0.25, 0.36, 2.262), 0.004);
    b.box(0.014, 0.15, 0.05, M.carbon, X(0.61, 0.345, 2.262, 0, 0, -0.12), 0.004);
    // 大灯
    b.box(0.4, 0.026, 0.02, M.head, X(0.505, 0.48, 2.248, 0, 0, -0.04), 0.006);
    b.box(0.42, 0.04, 0.006, M.lens, X(0.505, 0.48, 2.283, 0, 0, -0.04), 0.002);
    // 前铲
    const sp = plate([[0.004, 2.0], [0.82, 1.98], [0.9, 2.2], [0.62, 2.37], [0.004, 2.4]], 0.024, 0.006);
    b.add(sp, M.carbon, X(0, 0.178, 0, Math.PI / 2, 0, 0));
    b.box(0.014, 0.1, 0.3, M.carbon, X(0.86, 0.22, 2.16, 0, -0.3, 0), 0.004);
    // 半枚徽标
    b.add(plate([[0.004, 0], [0.05, 0.03], [0.05, 0.075], [0.004, 0.045]], 0.012, 0.003), M.chrome, X(0, 0.515, 2.3));
    both('nose', b);
  }

  /* --- 车尾（半边后保） --- */
  {
    const b = new Builder();
    addPatch(b, body, -2.2, -2.03 - G * 2, 0, 2 - G * 0.5, M.paint, M.paintInner, { th: 0.022 });
    addPatch(b, body, -2.2, -2.04, STRIPE_T[0], STRIPE_T[1], M.stripe, null, { th: 0, off: 0.0015 });
    addPatch(b, body, -2.15, -2.125, 0.8, 1.38, M.tail, null, { th: 0, off: 0.003, dz: 0.02 });
    const zc = -2.2;
    const holes = [
      [[0.075, 0.61], [0.69, 0.6], [0.735, 0.675], [0.715, 0.755], [0.075, 0.775]],
      [[0.2, 0.4], [0.66, 0.4], [0.7, 0.545], [0.2, 0.545]],
    ];
    b.add(plate(frontPlatePts(zc), 0.1, 0.014, holes), M.paint, X(0, 0, zc - 0.045));
    b.box(0.72, 0.45, 0.02, M.black, X(0.4, 0.6, -2.2), 0.004);
    b.box(0.6, 0.022, 0.02, M.tail, X(0.39, 0.728, -2.236, 0, 0, -0.03), 0.006);
    b.box(0.6, 0.012, 0.02, M.tail, X(0.385, 0.645, -2.236, 0, 0, -0.012), 0.004);
    for (const x of [0.16, 0.32, 0.48, 0.62]) b.box(0.012, 0.06, 0.03, M.gun, X(x, 0.688, -2.24), 0.003);
    b.box(0.7, 0.2, 0.012, M.carbon, X(0.38, 0.69, -2.222), 0.004);
    b.add(new THREE.PlaneGeometry(0.5, 0.15), M.mesh, X(0.45, 0.47, -2.232, 0, Math.PI, 0));
    // 排气
    for (const x of [0.36, 0.53]) {
      b.add(lathe([[0.04, -0.07], [0.052, -0.07], [0.056, 0.06], [0.05, 0.07], [0.04, 0.06], [0.04, -0.07]], 24, { axis: 'z' }), M.steel, X(x, 0.47, -2.27));
      b.add(disc(0.04, 0.01, 0.002, 'z', 20), M.black, X(x, 0.47, -2.25));
    }
    // 扩散器
    const df = plate([[0.004, -2.33], [0.8, -2.3], [0.84, -2.0], [0.004, -2.0]], 0.03, 0.006);
    b.add(df, M.carbon, X(0, 0.335, 0, Math.PI / 2, 0, 0));
    for (const x of [0.12, 0.34, 0.56, 0.76]) {
      b.box(0.014, 0.13, 0.3, M.carbon, X(x, 0.275, -2.17, 0.25, 0, 0), 0.004);
    }
    b.add(plate([[0.004, 0], [0.05, 0.03], [0.05, 0.075], [0.004, 0.045]], 0.012, 0.003), M.chrome, X(0, 0.8, -2.3));
    both('tail', b);
  }

  /* --- 车顶（含中/后舱骨架、后窗、三角窗） --- */
  {
    const b = new Builder();
    addPatch(b, cabin, -1.63, 0.15, 0.02, 3.98, M.black, M.black, { th: 0.02, off: -0.012, dz: 0.04, dt: 0.06 });
    addPatch(b, cabin, -0.78, 0.14, 1.0, 3.0, M.paint, M.paintInner, { th: 0.012, off: 0.002 });
    for (const s of [0, 1]) {
      const a = s ? 4 - STRIPE_T[1] + 0.1 : STRIPE_T[0] - 0.1, c = s ? 4 - STRIPE_T[0] + 0.1 : STRIPE_T[1] - 0.1;
      addPatch(b, cabin, -0.77, 0.13, Math.min(a, c), Math.max(a, c), M.stripe, null, { th: 0, off: 0.0045 });
    }
    addPatch(b, cabin, -0.78, -0.46, 0.05, 0.93, M.glass, M.black, { th: 0.008, off: 0.001 });
    addPatch(b, cabin, -0.78, -0.46, 3.07, 3.95, M.glass, M.black, { th: 0.008, off: 0.001 });
    addPatch(b, cabin, -1.6, -0.8, 0.05, 3.95, M.glass, M.black, { th: 0.008, off: 0.001 });
    // 后窗百叶
    for (let i = 0; i < 4; i++) {
      const z = -1.5 + i * 0.17;
      addPatch(b, cabin, z, z + 0.1, 1.2, 2.8, M.paint, M.paintInner, { th: 0.008, off: 0.016, dz: 0.03 });
    }
    // 鲨鱼鳍
    b.add(plate([[0, 0], [0.22, 0], [0.04, 0.07]], 0.02, 0.006), M.paint, X(0, 1.262, -0.72, 0, Math.PI / 2, 0));
    done('roof', b);
  }

  /* --- 前风挡 --- */
  {
    const b = new Builder();
    addPatch(b, cabin, 0.16, 0.86, 0.02, 3.98, M.black, M.black, { th: 0.02, off: -0.012, dz: 0.04, dt: 0.06 });
    addPatch(b, cabin, 0.165, 0.84, 0.05, 3.95, M.glass, M.black, { th: 0.008, off: 0.001 });
    // 雨刮
    b.add(strut([0.1, 0.94, 0.82], [0.5, 0.925, 0.8], 0.008, 6), M.black);
    b.add(strut([-0.45, 0.93, 0.8], [-0.05, 0.94, 0.82], 0.008, 6), M.black);
    done('windshield', b);
  }

  return parts;
}

export { addPatch, tFromY, yTf, yBf, Wf };
