// 特效：变形火花 + 程序合成的机械音效
import * as THREE from 'three';

export class Sparks {
  constructor(scene, max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const mat = new THREE.PointsMaterial({
      size: 0.075, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p, count = 14, power = 2.6) {
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u), sp = power * (0.3 + Math.random());
      this.vel[k * 3] = Math.cos(a) * s * sp;
      this.vel[k * 3 + 1] = u * sp + 1.2;
      this.vel[k * 3 + 2] = Math.sin(a) * s * sp;
      this.ttl[k] = this.life[k] = 0.35 + Math.random() * 0.65;
    }
  }
  update(dt) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        this.col[k * 3] = this.col[k * 3 + 1] = this.col[k * 3 + 2] = 0;
        continue;
      }
      this.vel[k * 3 + 1] -= 6.5 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      if (this.pos[k * 3 + 1] < 0.02) { this.pos[k * 3 + 1] = 0.02; this.vel[k * 3 + 1] *= -0.35; }
      const f = this.life[k] / this.ttl[k];
      const b = f * f * 3.5;
      // 白 → 橙 → 红
      this.col[k * 3] = b;
      this.col[k * 3 + 1] = b * (0.35 + 0.5 * f);
      this.col[k * 3 + 2] = b * (0.1 + 0.6 * f * f);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.lastServo = 0;
  }
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }
  unlock() { this._ensure(); }
  /** 伺服电机：锯齿波滑音 */
  servo(up = true) {
    if (!this.enabled || !this._ensure()) return;
    const t = this.ctx.currentTime;
    if (t - this.lastServo < 0.05) return;
    this.lastServo = t;
    const dur = 0.22 + Math.random() * 0.3;
    const f0 = 140 + Math.random() * 260;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (up ? 2.2 : 0.5), t + dur);
    const o2 = this.ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(f0 * 3.01, t);
    o2.frequency.exponentialRampToValueAtTime(f0 * 3.01 * (up ? 1.8 : 0.6), t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + Math.random() * 1400;
    f.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g).connect(this.master);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  /** 金属锁止：噪声脉冲 + 低频冲击 */
  clank(strength = 1) {
    if (!this.enabled || !this._ensure()) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700 + Math.random() * 1600;
    f.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.32 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random()); n.stop(t + 0.2);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0.42 * strength, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g2).connect(this.master);
    o.start(t); o.stop(t + 0.25);
  }
  /** 变形全程的底噪：缓慢扫频的气流 + 低鸣 */
  bed(duration, up = true) {
    if (!this.enabled || !this._ensure()) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.2;
    f.frequency.setValueAtTime(up ? 220 : 1800, t);
    f.frequency.exponentialRampToValueAtTime(up ? 2200 : 200, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.4);
    g.gain.setValueAtTime(0.1, t + duration - 0.5);
    g.gain.linearRampToValueAtTime(0, t + duration);
    n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + duration + 0.1);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(up ? 48 : 96, t);
    o.frequency.exponentialRampToValueAtTime(up ? 96 : 44, t + duration);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.16, t + 0.5);
    g2.gain.linearRampToValueAtTime(0, t + duration);
    o.connect(lp).connect(g2).connect(this.master);
    o.start(t); o.stop(t + duration + 0.1);
  }
  /** 完成时的能量充能音 */
  powerUp() {
    if (!this.enabled || !this._ensure()) return;
    const t = this.ctx.currentTime;
    for (const [mult, vol] of [[1, 0.12], [1.5, 0.07], [2, 0.05]]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(160 * mult, t);
      o.frequency.exponentialRampToValueAtTime(640 * mult, t + 0.6);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 1.2);
    }
  }
}
