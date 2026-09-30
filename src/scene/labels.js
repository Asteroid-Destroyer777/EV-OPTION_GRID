// HTML-подписи, привязанные к 3D-точкам (станции, узлы, районы, ориентиры).
import * as THREE from 'three';

export class Labels {
  constructor(container, camera, world) {
    this.el = container; this.camera = camera; this.world = world; this.items = new Map(); this.v = new THREE.Vector3();
    this.blockers = []; this._bk = 0;
  }
  add(id, { html, cls = '', pos, min = 0, max = 1e9, onClick, order = 0, layers = null }) {
    let it = this.items.get(id);
    if (!it) {
      const el = document.createElement('div'); el.className = 'lbl ' + cls; el.dataset.id = id;
      this.el.appendChild(el);
      it = { el, pos, min, max, layers, order, last: '' };
      if (onClick) { el.style.pointerEvents = 'auto'; el.addEventListener('click', (e) => { e.stopPropagation(); onClick(id); }); }
      this.items.set(id, it);
    }
    it.pos = pos; it.min = min; it.max = max; it.layers = layers; it.order = order;
    if (html !== undefined && html !== it.last) { it.el.innerHTML = html; it.last = html; }
    return it;
  }
  setHTML(id, html) { const it = this.items.get(id); if (it && it.last !== html) { it.el.innerHTML = html; it.last = html; } }
  setClass(id, cls) { const it = this.items.get(id); if (it) it.el.className = 'lbl ' + cls; }
  remove(id) { const it = this.items.get(id); if (it) { it.el.remove(); this.items.delete(id); } }
  refreshBlockers() {
    this.blockers = [];
    for (const sel of ['#rail', '#topbar', '#chain', '#panel', '#dock', '#sheet', '#legend3d', '#guide']) {
      const el = document.querySelector(sel); if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      this.blockers.push(r);
    }
  }
  update(layer, extra = {}) {
    if ((this._bk++ % 20) === 0) this.refreshBlockers();
    const cam = this.camera, { w, h } = this.world.size;
    const shift = extra.shift || 0;
    for (const it of this.items.values()) {
      const p = typeof it.pos === 'function' ? it.pos() : it.pos;
      if (!p) { it.el.style.display = 'none'; continue; }
      if (it.layers && !it.layers.includes(layer)) { it.el.style.display = 'none'; continue; }
      const d = cam.position.distanceTo(p);
      if (d < it.min || d > it.max) { it.el.style.display = 'none'; continue; }
      this.v.copy(p).project(cam);
      if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.1) { it.el.style.display = 'none'; continue; }
      const x = (this.v.x * 0.5 + 0.5) * w + shift, y = (-this.v.y * 0.5 + 0.5) * h;
      if (this.blockers.some(r => x > r.left - 6 && x < r.right + 6 && y > r.top && y < r.bottom + 30)) { it.el.style.display = 'none'; continue; }
      it.el.style.display = '';
      it.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%)`;
      const fade = 1 - Math.max(0, Math.min(1, (d - it.max * 0.75) / (it.max * 0.25 + 1)));
      it.el.style.opacity = fade.toFixed(2);
      it.el.style.zIndex = Math.round(1000 - d * 0.1 + it.order);
    }
  }
  setAllVisible(v) { this.el.style.display = v ? '' : 'none'; }
}
