// 建模工具箱：几何体助手 + 按材质合并的 Builder
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** 生成变换矩阵：位置 + 欧拉角(XYZ, 弧度) + 缩放 */
export function X(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'XYZ'));
  return new THREE.Matrix4().compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
}
export const D = Math.PI / 180;

/** 由三个基向量（车体/局部轴的像）构造旋转矩阵 */
export function basis(x, y, z, pos) {
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...x).normalize(),
    new THREE.Vector3(...y).normalize(),
    new THREE.Vector3(...z).normalize()
  );
  if (pos) m.setPosition(...pos);
  return m;
}

function normalize(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.morphAttributes = {};
  return g;
}

function flipWinding(g) {
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k];
    const n = a.itemSize;
    const arr = a.array;
    for (let i = 0; i < a.count; i += 3) {
      for (let c = 0; c < n; c++) {
        const i1 = (i + 1) * n + c, i2 = (i + 2) * n + c;
        const t = arr[i1]; arr[i1] = arr[i2]; arr[i2] = t;
      }
    }
  }
}

/** 按材质分桶、最后合并成少量 Mesh 的构建器 */
export class Builder {
  constructor() {
    this.buckets = new Map();
    this.stack = [new THREE.Matrix4()];
  }
  /** 在一个局部变换下批量添加 */
  with(m, fn) {
    const top = this.stack[this.stack.length - 1];
    this.stack.push(top.clone().multiply(m));
    fn(this);
    this.stack.pop();
    return this;
  }
  add(geo, mat, m) {
    const g = normalize(geo);
    const full = this.stack[this.stack.length - 1].clone();
    if (m) full.multiply(m);
    g.applyMatrix4(full);
    if (full.determinant() < 0) flipWinding(g);
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
    return this;
  }
  /** 左右对称添加：fn 只需建 +x 一侧 */
  sym(fn) {
    fn(this);
    this.with(new THREE.Matrix4().makeScale(-1, 1, 1), fn);
    return this;
  }
  box(w, h, d, mat, m, r = 0.012) {
    return this.add(rbox(w, h, d, r), mat, m);
  }
  /** 把另一个 builder 的内容并进来 */
  merge(other, m) {
    for (const [mat, list] of other.buckets) {
      for (const g of list) this.add(g, mat, m);
    }
    return this;
  }
  bounds() {
    const box = new THREE.Box3();
    for (const list of this.buckets.values()) {
      for (const g of list) {
        g.computeBoundingBox();
        box.union(g.boundingBox);
      }
    }
    return box;
  }
  /** 输出 Group；offset 用于把几何整体平移（重设枢轴） */
  build(name = '', offset = null) {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, list] of this.buckets) {
      const geo = mergeGeometries(list, false);
      if (!geo) continue;
      if (offset) geo.translate(-offset.x, -offset.y, -offset.z);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !mat.userData.noShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/* ---------------- 基础几何 ---------------- */

export function rbox(w, h, d, r = 0.012, seg = 2) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  return new RoundedBoxGeometry(w, h, d, seg, Math.max(rr, 1e-4));
}

/** 圆柱（沿 Y）。axis: 'x' | 'y' | 'z' */
export function cyl(r, h, axis = 'y', seg = 28, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, h, seg, 1);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/**
 * 硬边旋转体。profile: [[r, y], ...] 沿 Y 轴旋转。
 * smooth=true 时沿母线方向平滑法线（轮胎等曲面）。
 */
export function lathe(profile, seg = 40, { smooth = false, axis = 'y', arc = Math.PI * 2, arcStart = 0 } = {}) {
  const pos = [], nor = [], uv = [], idx = [];
  const n = profile.length;
  // 母线各段法线
  const segN = [];
  for (let i = 0; i < n - 1; i++) {
    const dr = profile[i + 1][0] - profile[i][0];
    const dy = profile[i + 1][1] - profile[i][1];
    const l = Math.hypot(dr, dy) || 1;
    segN.push([dy / l, -dr / l]);
  }
  let len = 0;
  const lens = [0];
  for (let i = 0; i < n - 1; i++) {
    len += Math.hypot(profile[i + 1][0] - profile[i][0], profile[i + 1][1] - profile[i][1]);
    lens.push(len);
  }
  const ring = (r, y, nr, ny, v) => {
    const start = pos.length / 3;
    for (let j = 0; j <= seg; j++) {
      const a = arcStart + (j / seg) * arc;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(r * c, y, r * s);
      nor.push(nr * c, ny, nr * s);
      uv.push(j / seg, v);
    }
    return start;
  };
  if (smooth) {
    const starts = [];
    for (let i = 0; i < n; i++) {
      const a = segN[Math.max(i - 1, 0)], b = segN[Math.min(i, n - 2)];
      let nr = a[0] + b[0], ny = a[1] + b[1];
      const l = Math.hypot(nr, ny) || 1;
      starts.push(ring(profile[i][0], profile[i][1], nr / l, ny / l, lens[i] / len));
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = starts[i] + j, b = starts[i + 1] + j;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  } else {
    for (let i = 0; i < n - 1; i++) {
      const s0 = ring(profile[i][0], profile[i][1], segN[i][0], segN[i][1], lens[i] / len);
      const s1 = ring(profile[i + 1][0], profile[i + 1][1], segN[i][0], segN[i][1], lens[i + 1] / len);
      for (let j = 0; j < seg; j++) {
        const a = s0 + j, b = s1 + j;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/** 带倒角的圆盘/轴套：半径 r，高 h，倒角 c；可带中心孔 hole */
export function disc(r, h, c = 0.01, axis = 'y', seg = 32, hole = 0) {
  const y = h / 2;
  const p = [];
  if (hole > 0) p.push([hole, -y]);
  else p.push([0, -y]);
  p.push([r - c, -y], [r, -y + c], [r, y - c], [r - c, y]);
  if (hole > 0) p.push([hole, y], [hole, -y]);
  else p.push([0, y]);
  return lathe(p, seg, { axis });
}

/** 由 2D 轮廓挤出的装甲板。pts: [[x,y],...]，厚度沿 Z，居中 */
export function plate(pts, depth = 0.03, bevel = 0.006, holes = null) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  if (holes) {
    for (const h of holes) {
      const path = new THREE.Path();
      path.moveTo(h[0][0], h[0][1]);
      for (let i = 1; i < h.length; i++) path.lineTo(h[i][0], h[i][1]);
      path.closePath();
      shape.holes.push(path);
    }
  }
  const b = Math.min(bevel, depth / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.translate(0, 0, -(depth - 2 * b) / 2);
  return g;
}

/** 左右对称轮廓：给出右半边（x>=0，自下而上），自动镜像 */
export function symPts(half) {
  const out = half.slice();
  for (let i = half.length - 1; i >= 0; i--) {
    if (Math.abs(half[i][0]) > 1e-6) out.push([-half[i][0], half[i][1]]);
  }
  return out;
}

/** 沿路径的管线 */
export function tube(points, radius = 0.012, radial = 8, tubular = 0) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular || Math.max(8, points.length * 8), radius, radial, false);
}

/** 两点之间的圆杆 */
export function strut(a, b, r = 0.012, seg = 12, r2 = r) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** 液压杆：缸体 + 活塞杆 + 两端耳环 */
export function piston(b, a, c, r, matBody, matRod, matCap = matBody, split = 0.55) {
  const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c);
  const mid = va.clone().lerp(vc, split);
  const m1 = va.clone().lerp(vc, 0.06);
  b.add(strut(m1.toArray(), mid.toArray(), r, 14), matBody);
  b.add(strut(mid.toArray(), mid.clone().lerp(vc, 0.06).toArray(), r * 1.18, 14), matCap);
  b.add(strut(m1.toArray(), va.clone().lerp(vc, 0.1).toArray(), r * 1.18, 14), matCap);
  b.add(strut(mid.toArray(), vc.toArray(), r * 0.52, 10), matRod);
  b.add(new THREE.SphereGeometry(r * 1.05, 12, 8), matCap, X(a[0], a[1], a[2]));
  b.add(new THREE.SphereGeometry(r * 0.9, 12, 8), matCap, X(c[0], c[1], c[2]));
}

/** 一圈螺栓 */
export function boltRing(b, mat, cx, cy, cz, radius, count, axis = 'x', br = 0.012, bh = 0.012) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const u = Math.cos(a) * radius, v = Math.sin(a) * radius;
    const g = cyl(br, bh, axis, 6);
    if (axis === 'x') b.add(g, mat, X(cx, cy + u, cz + v));
    else if (axis === 'z') b.add(g, mat, X(cx + u, cy + v, cz));
    else b.add(g, mat, X(cx + u, cy, cz + v));
  }
}

/** 一排百叶：在 (w × h) 区域内生成 n 条斜片，法线朝 +Z */
export function slats(b, mat, w, h, n, m, depth = 0.02, tilt = 0.5) {
  for (let i = 0; i < n; i++) {
    const y = -h / 2 + ((i + 0.5) / n) * h;
    b.add(rbox(w, (h / n) * 0.55, depth, 0.003, 1), mat, m.clone().multiply(X(0, y, 0, tilt, 0, 0)));
  }
}

/** 一维样条（Catmull-Rom / Hermite），pts: [[x, y], ...] 按 x 升序 */
export function spline(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const m = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) m[i] = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    else if (i === n - 1) m[i] = (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
    else m[i] = 0.5 * ((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) + (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]));
  }
  return (x) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
