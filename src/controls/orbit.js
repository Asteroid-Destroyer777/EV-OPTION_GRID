// Собственная орбитальная камера: вращение, панорама, зум к курсору, плавные перелёты.
import * as THREE from 'three';

const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export class OrbitRig {
  constructor(camera, dom) {
    this.camera = camera; this.dom = dom;
    this.cur = { tx: 700, ty: 0, tz: 300, dist: 1500, az: -0.55, pol: 0.9 };
    this.goal = { ...this.cur };
    this.limits = { minDist: 22, maxDist: 5600, minPol: 0.1, maxPol: 1.5, minY: 1.5 };
    this.enabled = true; this.idleSpin = 0; this.tween = null;
    this.bounds = { x: 2383, z: 2211 };
    this.onUserInput = null;
    this._drag = null; this._ray = new THREE.Raycaster(); this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._bind();
  }
  _bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', e => e.preventDefault());
    d.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      this._drag = { x: e.clientX, y: e.clientY, mode: (e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey) ? 'pan' : 'rot', moved: 0, id: e.pointerId, btn: e.button };
      d.setPointerCapture?.(e.pointerId);
    });
    d.addEventListener('pointermove', e => {
      const s = this._drag; if (!s || !this.enabled || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y; s.x = e.clientX; s.y = e.clientY; s.moved += Math.abs(dx) + Math.abs(dy);
      if (s.moved > 3) this._input();
      if (s.mode === 'rot') { this.goal.az -= dx * 0.0052; this.goal.pol = THREE.MathUtils.clamp(this.goal.pol - dy * 0.0046, this.limits.minPol, this.limits.maxPol); }
      else this._pan(dx, dy);
    });
    const end = e => { if (this._drag && this._drag.id === e.pointerId) { this.dragMoved = this._drag.moved; this._drag = null; } };
    d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
    d.addEventListener('wheel', e => {
      if (!this.enabled) return; e.preventDefault(); this._input();
      const f = Math.exp(THREE.MathUtils.clamp(e.deltaY, -240, 240) * 0.0013);
      this._zoomAt(f, e.clientX, e.clientY);
    }, { passive: false });
    // жесты на сенсорных экранах
    let pinch = null;
    d.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = this._pd(e); }, { passive: true });
    d.addEventListener('touchmove', e => { if (e.touches.length === 2 && pinch) { const n = this._pd(e); this._zoomAt(pinch / n, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2); pinch = n; this._input(); } }, { passive: true });
    d.addEventListener('touchend', () => { pinch = null; }, { passive: true });
    window.addEventListener('keydown', e => {
      if (!this.enabled || e.target.closest?.('input,textarea,select')) return;
      const k = e.key; const step = this.goal.dist * 0.05;
      if (k === 'ArrowLeft') { this._pan(-step * 3, 0, true); this._input(); }
      else if (k === 'ArrowRight') { this._pan(step * 3, 0, true); this._input(); }
      else if (k === 'ArrowUp') { this._pan(0, -step * 3, true); this._input(); }
      else if (k === 'ArrowDown') { this._pan(0, step * 3, true); this._input(); }
    });
  }
  _pd(e) { return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
  _input() { const t = this.tween; this.tween = null; t?.done?.(); this.idleSpin = 0; this.onUserInput?.(); }
  _pan(dx, dy, raw = false) {
    const g = this.goal, k = raw ? 1 : g.dist * 0.0016;
    const sa = Math.sin(g.az), ca = Math.cos(g.az);
    // вправо по экрану / вперёд по земле
    g.tx += (-ca * dx * k * (raw ? 0.33 : 1)) + (sa * dy * k * (raw ? 0.33 : 1));
    g.tz += (sa * dx * k * (raw ? 0.33 : 1)) + (ca * dy * k * (raw ? 0.33 : 1));
    this._clampTarget();
  }
  _clampTarget() { const g = this.goal; g.tx = THREE.MathUtils.clamp(g.tx, -this.bounds.x, this.bounds.x); g.tz = THREE.MathUtils.clamp(g.tz, -this.bounds.z, this.bounds.z); }
  _zoomAt(f, cx, cy) {
    const g = this.goal, nd = THREE.MathUtils.clamp(g.dist * f, this.limits.minDist, this.limits.maxDist);
    const real = nd / g.dist;
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(ndc, this.camera);
    this._plane.constant = -g.ty;
    const p = new THREE.Vector3();
    if (this._ray.ray.intersectPlane(this._plane, p) && real < 1) {
      g.tx += (p.x - g.tx) * (1 - real) * 0.85; g.tz += (p.z - g.tz) * (1 - real) * 0.85;
      this._clampTarget();
    }
    g.dist = nd;
  }
  /** Плавный перелёт камеры. to: {tx,ty,tz,dist,az,pol} (частично). */
  flyTo(to, duration = 1.8, opts = {}) {
    const old = this.tween; this.tween = null; old?.done?.();
    const from = { ...this.cur };
    const dest = { ...this.goal, ...to };
    if (to.az !== undefined) dest.az = from.az + angDiff(from.az, to.az);
    this.tween = { t: 0, dur: Math.max(0.01, duration), from, to: dest, ease: opts.ease || ease, done: opts.onDone };
    if (duration <= 0.02) this.snap(dest);
    return new Promise(res => { const prev = this.tween.done; this.tween.done = () => { prev?.(); res(); }; });
  }
  snap(to) { Object.assign(this.cur, to); Object.assign(this.goal, to); this.tween = null; this.apply(); }
  update(dt) {
    const c = this.cur, g = this.goal;
    if (this.tween) {
      const tw = this.tween; tw.t += dt; const k = Math.min(1, tw.t / tw.dur), e = tw.ease(k);
      for (const key of ['tx', 'ty', 'tz', 'az', 'pol']) c[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * e;
      c.dist = Math.exp(Math.log(tw.from.dist) + (Math.log(tw.to.dist) - Math.log(tw.from.dist)) * e);
      Object.assign(g, c);
      if (k >= 1) { const d = tw.done; this.tween = null; d?.(); }
    } else {
      if (this.idleSpin) g.az += this.idleSpin * dt;
      g.pol = THREE.MathUtils.clamp(g.pol, this.limits.minPol, this.limits.maxPol);
      const a = 1 - Math.exp(-dt * 9);
      for (const key of ['tx', 'ty', 'tz', 'az', 'pol']) c[key] += (g[key] - c[key]) * a;
      c.dist += (g.dist - c.dist) * a;
    }
    this.apply();
  }
  apply() {
    const c = this.cur, sp = Math.sin(c.pol);
    const cam = this.camera;
    cam.position.set(c.tx + c.dist * sp * Math.sin(c.az), c.ty + c.dist * Math.cos(c.pol), c.tz + c.dist * sp * Math.cos(c.az));
    if (cam.position.y < this.limits.minY && this.limits.minY > -100) cam.position.y = this.limits.minY;
    cam.lookAt(c.tx, c.ty, c.tz);
    cam.near = Math.max(0.6, Math.min(6, c.dist * 0.01)); cam.far = 16000;
    cam.updateProjectionMatrix();
  }
}
