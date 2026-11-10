// 变形绑定：每个部件有“载具姿态（世界）”与“机甲姿态（父级局部）”，按各自时间窗插值
import * as THREE from 'three';
import { buildCarParts, buildWheel, CAR } from './carbody.js';
import { buildMech, addShinCore } from './mech.js';
import { Builder, D, basis, smooth, clamp01 } from './kit.js';

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RX = (a) => new THREE.Matrix4().makeRotationX(a);
const RY = (a) => new THREE.Matrix4().makeRotationY(a);
const RZ = (a) => new THREE.Matrix4().makeRotationZ(a);
const SC = (s) => new THREE.Matrix4().makeScale(s, s, s);
const mul = (...ms) => ms.reduce((a, b) => a.clone().multiply(b));
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const I4 = new THREE.Matrix4();

// 骨骼在载具形态中的朝向：机体俯卧、头朝车头（骨骼 y → 车 z，骨骼 z → 车 -y）
const RP = RX(Math.PI / 2);

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Rig {
  constructor(M) {
    this.M = M;
    this.root = new THREE.Group();
    this.nodes = [];
    this.byName = {};
    this.markers = [];
    this.wheels = [];
    this.progress = 0;
    this.time = 0;
    this.onServo = null;
    this._build();
    this.setProgress(0);
  }

  /**
   * 注册节点
   * car: 载具形态世界矩阵；rob: 机甲形态相对父级矩阵，或 'rigid'（与父级刚性相连）
   */
  _node(name, parent, obj, car, rob, win, opts = {}) {
    const p = parent ? this.byName[parent] : null;
    const object = obj || new THREE.Group();
    object.name = name;
    const carLocal = p ? p.car.clone().invert().multiply(car) : car.clone();
    const robLocal = rob === 'rigid' ? carLocal.clone() : rob;
    const n = {
      name, parent: p, obj: object, car,
      cp: new THREE.Vector3(), cq: new THREE.Quaternion(), cs: new THREE.Vector3(),
      rp: new THREE.Vector3(), rq: new THREE.Quaternion(), rs: new THREE.Vector3(),
      t0: win[0], t1: win[1],
      arc: opts.arc ? new THREE.Vector3(...opts.arc) : null,
      rigid: rob === 'rigid',
      last: -1,
    };
    carLocal.decompose(n.cp, n.cq, n.cs);
    robLocal.decompose(n.rp, n.rq, n.rs);
    (p ? p.obj : this.root).add(object);
    this.nodes.push(n);
    this.byName[name] = n;
    if (opts.marker) {
      const box = new THREE.Box3();
      object.traverse((o) => {
        if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox); }
      });
      const c = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) c.push(new THREE.Vector3(x, y, z));
      this.markers.push({ node: n, corners: c });
    }
    return n;
  }

  _build() {
    const M = this.M;
    const carParts = buildCarParts(M);
    const mech = buildMech(M);
    const wheelProto = buildWheel(M);

    // 后翼子板并入小腿机体
    {
      const b = carParts._quarterBuilder;
      addShinCore(b, M);
      const pv = new THREE.Vector3(0.5, 0.55, -1.25);
      carParts.quarter_p = { group: b.build('quarter_p', pv), pivot: pv };
      const bn = new Builder().merge(b, MIRROR);
      const pn = new THREE.Vector3(-0.5, 0.55, -1.25);
      carParts.quarter_n = { group: bn.build('quarter_n', pn), pivot: pn };
    }
    const part = (key) => carParts[key];
    const carOf = (key) => T(part(key).pivot.x, part(key).pivot.y, part(key).pivot.z);

    /* ---------- 躯干骨骼 ---------- */
    const bone = (name, parent, carM, robM, win, opts) => this._node(name, parent, null, carM, robM, win, opts);
    const flesh = (boneName, obj, s, win, rs = 1) =>
      this._node(boneName + '_flesh', boneName, obj, mul(this.byName[boneName].car, SC(s)), SC(rs), win, { marker: boneName.startsWith('foot') });

    bone('pelvis', null, mul(T(0, 0.5, -0.3), RP), T(0, 3.2, 0), [0.03, 0.5]);
    flesh('pelvis', mech.pelvis, 0.7, [0.25, 0.6]);
    bone('abdomen', 'pelvis', mul(T(0, 0.5, 0.02), RP), T(0, 0.2, 0), [0.22, 0.6]);
    flesh('abdomen', mech.abdomen, 0.7, [0.3, 0.65]);
    bone('chest', 'abdomen', mul(T(0, 0.5, 0.45), RP), T(0, 0.78, 0), [0.26, 0.66]);
    flesh('chest', mech.chest, 0.7, [0.4, 0.75]);
    bone('head', 'chest', mul(T(0, 0.46, 1.42), RP), T(0, 1.1, 0.03), [0.76, 0.95], { arc: [0, 0.12, 0] });
    flesh('head', mech.head, 0.6, [0.76, 0.93], 1.28);

    /* ---------- 车顶 → 背包 ---------- */
    this._node('roof', 'chest', part('roof').group, carOf('roof'), mul(T(0, 0.12, -0.74), RX(-Math.PI / 2)), [0.3, 0.7], { arc: [0, 0, -0.25] });
    {
      const d = part('windshield').pivot.clone().sub(part('roof').pivot);
      this._node('windshield', 'roof', part('windshield').group, carOf('windshield'),
        mul(T(d.x, d.y + 0.2, d.z - 0.62), RX(-0.4)), [0.08, 0.42], { arc: [0, 0.18, 0] });
    }

    /* ---------- 左右对称部分 ---------- */
    for (const sx of [1, -1]) {
      const S = sx > 0 ? 'L' : 'R';
      const cs = sx > 0 ? '_p' : '_n';
      const mm = (m) => (sx > 0 ? m : mul(MIRROR, m, MIRROR));
      const g = (pair) => (sx > 0 ? pair.L : pair.R);
      const n = (name) => name + '_' + S;

      // 腿
      bone(n('thigh'), 'pelvis', mm(mul(T(0.3, 0.45, -0.35), RP)), mm(mul(T(0.6, -0.08, 0), RZ(3 * D))), [0.1, 0.55]);
      flesh(n('thigh'), g(mech.thigh), 0.7, [0.2, 0.6], 1.22);
      bone(n('shin'), n('thigh'), mm(mul(T(0.5, 0.55, -0.58), RP)), mm(mul(T(0, -1.366, 0), RZ(-3 * D))), [0.1, 0.55]);
      this._node(n('quarter'), n('shin'), part('quarter' + cs).group, carOf('quarter' + cs), 'rigid', [0, 1], { marker: true });
      bone(n('foot'), n('shin'), mm(mul(T(0.42, 0.58, -1.72), RP)), mm(T(0, -1.74, 0.03)), [0.36, 0.66]);
      flesh(n('foot'), g(mech.foot), 0.6, [0.36, 0.66], 1.4);
      this._node(n('tail'), n('shin'), part('tail' + cs).group, carOf('tail' + cs), mm(T(-0.07, -1.5, -0.58)), [0.42, 0.78],
        { marker: true, arc: sx > 0 ? [0.1, 0, -0.5] : [-0.1, 0, -0.5] });

      // 后轮
      this._wheel(n('wheelR'), n('shin'), wheelProto, sx, CAR.ZW_R);

      // 胯甲 ← 车鼻
      this._node(n('nose'), 'pelvis', part('nose' + cs).group, carOf('nose' + cs),
        mm(mul(T(0.66, -0.16, 0.2), RY(58 * D), RX(-6 * D))), [0.4, 0.84], { marker: true, arc: sx > 0 ? [0.5, 0.2, 0.6] : [-0.5, 0.2, 0.6] });

      // 胸甲 ← 引擎盖
      this._node(n('hood'), 'chest', part('hood' + cs).group, carOf('hood' + cs),
        mm(mul(T(0.45, 0.5, 0.47), RY(15 * D), RX(72 * D))), [0.46, 0.86], { arc: [0, 0.75, 0.25] });

      // 翼 ← 车门
      {
        const a = 34 * D, s = Math.sin(a), c = Math.cos(a);
        const m = basis([0, 0, 1], [c, -s, 0], [s, c, 0], [0.8, 1.02, -0.52]);
        this._node(n('door'), 'chest', part('door' + cs).group, carOf('door' + cs), mm(m), [0.28, 0.72], { arc: sx > 0 ? [0.6, 0, -0.2] : [-0.6, 0, -0.2] });
      }

      // 肩 + 前翼子板 + 前轮
      bone(n('shoulder'), 'chest', mm(mul(T(0.49, CAR.YW, CAR.ZW_F), RP)), mm(T(1.1, 0.66, -0.05)), [0.44, 0.82]);
      flesh(n('shoulder'), g(mech.shoulder), 0.6, [0.5, 0.82]);
      this._node(n('fender'), n('shoulder'), part('fender' + cs).group, carOf('fender' + cs), 'rigid', [0, 1]);
      this._wheel(n('wheelF'), n('shoulder'), wheelProto, sx, CAR.ZW_F);

      // 手臂
      bone(n('upperArm'), n('shoulder'), mm(mul(T(0.5, 0.42, 0.9), RP)), mm(mul(T(-0.04, -0.1, 0), RZ(7 * D), RX(5 * D))), [0.54, 0.88]);
      flesh(n('upperArm'), g(mech.upperArm), 0.72, [0.54, 0.88], 1.14);
      bone(n('forearm'), n('upperArm'), mm(mul(T(0.5, 0.68, 0.25), RX(-Math.PI / 2))), mm(mul(T(0, -1.083, 0), RX(-16 * D))), [0.6, 0.93]);
      flesh(n('forearm'), g(mech.forearm), 0.72, [0.6, 0.93], 1.14);
      bone(n('hand'), n('forearm'), mm(mul(T(0.5, 0.68, 0.97), RX(-Math.PI / 2))), mm(T(0, -1.14, 0)), [0.68, 0.96]);
      flesh(n('hand'), g(mech.hand), 0.6, [0.7, 0.97], 1.3);

      // 臂刃 ← 门槛
      this._node(n('sill'), n('forearm'), part('sill' + cs).group, carOf('sill' + cs),
        mm(basis([1, 0, 0], [0, 0, 1], [0, -1, 0], [0.215, -0.58, -0.02])), [0.56, 0.9], { marker: true, arc: sx > 0 ? [0.4, 0, 0] : [-0.4, 0, 0] });
    }
  }

  _wheel(name, parent, proto, sx, z) {
    const car = mul(T(sx * CAR.XW, CAR.YW, z), sx > 0 ? I4 : RY(Math.PI));
    const holder = new THREE.Group();
    const spin = proto.clone();
    holder.add(spin);
    const n = this._node(name, parent, holder, car, 'rigid', [0, 1]);
    this.wheels.push({ node: n, spin, sx });
    return n;
  }

  setProgress(p) {
    this.progress = clamp01(p);
  }

  /** 每帧调用：摆位 + 待机动画 + 贴地修正 */
  update(dt, extra = {}) {
    this.time += dt;
    const p = this.progress, t = this.time;
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const n of this.nodes) {
      const raw = clamp01((p - n.t0) / (n.t1 - n.t0));
      const s = n.rigid ? 0 : ease(raw);
      n.obj.position.lerpVectors(n.cp, n.rp, s);
      if (n.arc) n.obj.position.addScaledVector(n.arc, Math.sin(Math.PI * s));
      n.obj.quaternion.slerpQuaternions(n.cq, n.rq, s);
      n.obj.scale.lerpVectors(n.cs, n.rs, s);
      // 伺服事件（给音效/火花用）
      if (!n.rigid && this.onServo && n.last >= 0) {
        if ((n.last <= 0 && raw > 0) || (n.last < 1 && raw >= 1) || (n.last >= 1 && raw < 1) || (n.last > 0 && raw <= 0)) {
          this.onServo(n, raw >= 1 || raw <= 0 ? 'lock' : 'start');
        }
      }
      n.last = raw;
    }
    // 待机呼吸（仅机甲形态）
    const w = smooth(0.96, 1, p);
    if (w > 0) {
      const B = this.byName;
      const add = (name, x, y, z) => { q.setFromEuler(e.set(x * w, y * w, z * w)); B[name].obj.quaternion.multiply(q); };
      B.chest.obj.position.y += Math.sin(t * 1.3) * 0.012 * w;
      add('abdomen', Math.sin(t * 1.3) * 0.006, Math.sin(t * 0.45) * 0.02, 0);
      add('head', Math.sin(t * 0.7 + 1) * 0.03, Math.sin(t * 0.38) * 0.2, 0);
      add('upperArm_L', Math.sin(t * 1.3 + 0.5) * 0.02, 0, Math.sin(t * 0.9) * 0.012);
      add('upperArm_R', Math.sin(t * 1.3 + 1.1) * 0.02, 0, -Math.sin(t * 0.9 + 0.4) * 0.012);
      add('forearm_L', Math.sin(t * 1.1) * 0.03, 0, 0);
      add('forearm_R', Math.sin(t * 1.1 + 0.7) * 0.03, 0, 0);
      add('door_L', 0, 0, Math.sin(t * 0.8) * 0.025);
      add('door_R', 0, 0, -Math.sin(t * 0.8) * 0.025);
    }
    // 车轮
    if (extra.wheelSpin) {
      for (const wdef of this.wheels) wdef.spin.rotation.x += extra.wheelSpin * dt * wdef.sx;
    }
    // 贴地：让最低点正好落在地面
    this.root.position.y = 0;
    this.root.updateMatrixWorld(true);
    let minY = Infinity;
    const v = new THREE.Vector3();
    for (const wdef of this.wheels) {
      v.setFromMatrixPosition(wdef.node.obj.matrixWorld);
      minY = Math.min(minY, v.y - CAR.RW);
    }
    for (const m of this.markers) {
      for (const c of m.corners) {
        v.copy(c).applyMatrix4(m.node.obj.matrixWorld);
        if (v.y < minY) minY = v.y;
      }
    }
    this.root.position.y = -minY;
    this.root.updateMatrixWorld(true);
  }
}
