// Транспорт: маршрутизация по реальному уличному графу OSM, фоновый трафик (доля EV растёт со сценарием/годом),
// направленные потоки спроса (частные EV, такси, корпоративный, электробусы, коммунальная техника) в ЭЗС.
import * as THREE from 'three';
import { geo, SpatialGrid } from '../data/geo.js';
import { carGeometry, busGeometry, truckGeometry } from './vehicleGeo.js';
import { makeVehicleMaterial, makeFlowMaterial } from './materials.js';
import { RibbonBuf, addRibbon } from './roads.js';
import { USER_TYPES } from '../simulation/params.js';

/* ---------------- граф и маршрутизация ---------------- */
class MinHeap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}
const SPEED = [1.7, 1.5, 1.3, 1.05, 0.8, 0.6];

export class RoadGraph {
  constructor(g) {
    this.nodes = g.nodes; this.edges = g.edges;
    this.adj = this.nodes.map(() => []);
    g.edges.forEach((e, i) => {
      const [a, b, cls, ow, len] = e;
      const cost = len / SPEED[Math.min(5, cls)];
      if (ow !== -1) this.adj[a].push({ to: b, cost, len, edge: i, fwd: true });
      if (ow !== 1) this.adj[b].push({ to: a, cost, len, edge: i, fwd: false });
    });
    this.grid = new SpatialGrid(120);
    this.nodes.forEach((n, i) => this.grid.insert(i, n[0], n[1], n[0], n[1]));
  }
  nearest(x, z, maxR = 400) {
    let best = -1, bd = Infinity;
    for (let r = 120; r <= maxR + 120; r += 120) {
      for (const i of this.grid.query(x, z, r)) { const n = this.nodes[i]; const d = Math.hypot(n[0] - x, n[1] - z); if (d < bd && this.adj[i].length) { bd = d; best = i; } }
      if (best >= 0) break;
    }
    return best;
  }
  route(a, b) {
    if (a === b) return [a];
    const dist = new Map([[a, 0]]), prev = new Map(), h = new MinHeap();
    h.push(0, a);
    while (h.size) {
      const [d, u] = h.pop();
      if (u === b) break;
      if (d > (dist.get(u) ?? Infinity)) continue;
      for (const arc of this.adj[u]) {
        const nd = d + arc.cost;
        if (nd < (dist.get(arc.to) ?? Infinity)) { dist.set(arc.to, nd); prev.set(arc.to, { u, arc }); h.push(nd, arc.to); }
      }
    }
    if (!prev.has(b)) return null;
    const arcs = []; let c = b;
    while (c !== a) { const p = prev.get(c); arcs.push(p.arc); c = p.u; }
    arcs.reverse();
    return arcs.map((arc, i) => ({ arc, from: i === 0 ? a : arcs[i - 1].to }));
  }
  /** Ломаная маршрута: массив [x,y,z]. */
  polyline(steps, a) {
    const pts = []; const n0 = this.nodes[a];
    pts.push([n0[0], n0[2], n0[1]]);
    for (const { arc, from } of steps) {
      const e = this.edges[arc.edge]; const mid = e[5], my = e[6];
      const nTo = this.nodes[arc.to];
      const m = mid.length / 2;
      if (arc.fwd) for (let k = 0; k < m; k++) pts.push([mid[k * 2], my && my.length ? my[k] : 0, mid[k * 2 + 1]]);
      else for (let k = m - 1; k >= 0; k--) pts.push([mid[k * 2], my && my.length ? my[k] : 0, mid[k * 2 + 1]]);
      pts.push([nTo[0], nTo[2], nTo[1]]);
    }
    return pts;
  }
}

/* ---------------- путь (с длинами) ---------------- */
export class Path {
  constructor(pts) {
    // убираем дубли
    const p = [pts[0]];
    for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0] - p[p.length - 1][0], pts[i][2] - p[p.length - 1][2]) > 0.3) p.push(pts[i]);
    this.pts = p; this.cum = [0];
    for (let i = 1; i < p.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]));
    this.len = this.cum[this.cum.length - 1];
  }
  /** Позиция на расстоянии s; seg — подсказка индекса сегмента; возвращает индекс. */
  sample(s, out, seg = 0, lane = 0) {
    const p = this.pts, c = this.cum; let i = seg;
    if (s < c[i]) i = 0;
    while (i < p.length - 2 && s > c[i + 1]) i++;
    const L = c[i + 1] - c[i] || 1, t = Math.min(1, Math.max(0, (s - c[i]) / L));
    const ax = p[i][0], ay = p[i][1], az = p[i][2], bx = p[i + 1][0], by = p[i + 1][1], bz = p[i + 1][2];
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    out.x = ax + (bx - ax) * t - dz * lane; out.z = az + (bz - az) * t + dx * lane; out.y = ay + (by - ay) * t; out.dx = dx; out.dz = dz;
    return i;
  }
}

function setPose(arr, i, x, y, z, dx, dz, sc = 1) {
  const c = dx * sc, s = -dz * sc, o = i * 16;
  arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -s; arr[o + 3] = 0;
  arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = s; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}
const HIDE = (arr, i) => { const o = i * 16; arr.fill(0, o, o + 16); arr[o + 15] = 1; arr[o + 13] = -9999; };

/* ---------------- трафик ---------------- */
export class Traffic {
  constructor(graph, parent) {
    this.graph = graph; this.group = new THREE.Group(); parent.add(this.group);
    this.mat = makeVehicleMaterial();
    this.carGeo = carGeometry(); this.busGeo = busGeometry(); this.truckGeo = truckGeometry();
    this.tmp = { x: 0, y: 0, z: 0, dx: 1, dz: 0 };
    this.flows = [];
    this.layerAlpha = 0.2;
    this._buildAmbient(320);
    this.ribbons = new THREE.Group(); this.group.add(this.ribbons);
    this.pickables = [];
  }

  /* --- фоновый поток --- */
  _buildAmbient(n) {
    this.amb = { n, mesh: new THREE.InstancedMesh(this.carGeo, this.mat, n), v: [] };
    this.amb.mesh.frustumCulled = false;
    this.amb.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.group.add(this.amb.mesh);
    this.ambActive = 240;
    this.evShare = 0.12;
    const N = this.graph.nodes.length;
    for (let i = 0; i < n; i++) {
      const v = { path: null, s: 0, seg: 0, speed: 8 + Math.random() * 6, lane: 1.7, ev: Math.random(), sc: 0.95 + Math.random() * 0.2, wait: Math.random() * 3 };
      this._newRoute(v, Math.floor(Math.random() * N), true);
      this.amb.v.push(v);
    }
    this._recolorAmbient();
  }
  _newRoute(v, from, randomStart = false) {
    const g = this.graph, N = g.nodes.length;
    for (let tries = 0; tries < 6; tries++) {
      const to = Math.floor(Math.random() * N);
      const a = g.nodes[from], b = g.nodes[to];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d < 500 || d > 2600) continue;
      const r = g.route(from, to);
      if (!r || r.length < 3) continue;
      v.path = new Path(g.polyline(r, from)); v.s = randomStart ? Math.random() * v.path.len * 0.8 : 0; v.seg = 0; v.node = to;
      return true;
    }
    v.path = null; v.node = from; return false;
  }
  _recolorAmbient() {
    const c = new THREE.Color();
    const ice = ['#d5f3ff', '#a9e6ff', '#ffffff'], dark = ['#3d404b', '#565a66', '#2b2e38', '#6d5f5a', '#4a5468', '#7a7d88'];
    this.amb.v.forEach((v, i) => {
      const ev = v.ev < this.evShare;
      const arr = ev ? ice : dark;
      c.set(arr[Math.floor((v.ev * 977) % arr.length)]);
      this.amb.mesh.setColorAt(i, c);
    });
    this.amb.mesh.instanceColor.needsUpdate = true;
  }
  /** Плотность и доля EV в фоновом потоке. */
  setAmbient(count, evShare) {
    this.ambActive = Math.max(60, Math.min(this.amb.n, Math.round(count)));
    if (Math.abs(evShare - this.evShare) > 0.004) { this.evShare = evShare; this._recolorAmbient(); }
  }

  /* --- потоки спроса --- */
  buildFlows(defs, stationPos) {
    const g = this.graph;
    const types = {
      private_ev: { geo: this.carGeo, cap: 90 }, taxi: { geo: this.carGeo, cap: 90 }, corporate: { geo: this.carGeo, cap: 60 },
      ebus: { geo: this.busGeo, cap: 24 }, municipal: { geo: this.truckGeo, cap: 24 },
    };
    this.typeMesh = {};
    for (const [k, t] of Object.entries(types)) {
      const m = new THREE.InstancedMesh(t.geo, this.mat, t.cap);
      m.frustumCulled = false; m.count = 0;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(t.cap * 3), 3);
      this.group.add(m); this.typeMesh[k] = { mesh: m, cap: t.cap, used: 0 };
    }
    for (const d of defs) {
      const sp = stationPos(d.to); if (!sp) continue;
      const a = g.nearest(d.origin.x, d.origin.z, 700);
      const entry = { x: sp.x + sp.fx * 16, z: sp.z + sp.fz * 16 };
      const b = g.nearest(entry.x, entry.z, 400);
      if (a < 0 || b < 0) continue;
      const r = g.route(a, b);
      if (!r) continue;
      const pts = g.polyline(r, a);
      pts.unshift([d.origin.x, 0, d.origin.z]);
      pts.push([entry.x, 0, entry.z]);
      const path = new Path(pts);
      if (path.len < 40) continue;
      const type = USER_TYPES[d.type];
      const flat = [], ys = [];
      for (const p of path.pts) { flat.push(p[0], p[2]); ys.push(p[1]); }
      const buf = new RibbonBuf(); addRibbon(buf, flat, ys, d.type === 'ebus' ? 5.2 : 4.0, 0.5);
      const mat = makeFlowMaterial(type.color, { speed: 0.9, dash: 34, core: 0.42, alpha: 0.9 });
      const mesh = new THREE.Mesh(buf.geometry(), mat); mesh.frustumCulled = false; mesh.renderOrder = 30;
      mesh.userData = { kind: 'flow', id: d.id };
      this.ribbons.add(mesh);
      const hb = new RibbonBuf(); addRibbon(hb, flat, ys, 16, 0.5);
      const hit = new THREE.Mesh(hb.geometry(), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })); hit.userData = { kind: 'flow', id: d.id }; hit.frustumCulled = false;
      this.ribbons.add(hit); this.pickables.push(hit);
      const color = new THREE.Color(type.color);
      this.flows.push({ def: d, path, mesh, hit, mat, count: 0, veh: [], color, type: d.type, intensity: 1, hi: 0 });
    }
    this._layoutFlowVehicles();
  }
  _layoutFlowVehicles() {
    for (const t of Object.values(this.typeMesh)) t.used = 0;
    const c = new THREE.Color();
    for (const f of this.flows) {
      const t = this.typeMesh[f.type];
      f.veh = [];
      for (let i = 0; i < f.count && t.used < t.cap; i++) {
        const idx = t.used++;
        f.veh.push({ idx, s: (f.path.len * (i + Math.random() * 0.5)) / Math.max(1, f.count), seg: 0, speed: (f.type === 'ebus' ? 8 : 10) + Math.random() * 3 });
        const palette = f.type === 'private_ev' ? ['#cfe9ff', '#8fc9e8', '#ffffff', '#7fd6e8'] : f.type === 'taxi' ? ['#ffe14d'] : f.type === 'corporate' ? ['#e6e0ff'] : f.type === 'ebus' ? ['#6f86ff'] : ['#ff8a3d'];
        c.set(palette[i % palette.length]); t.mesh.setColorAt(idx, c);
      }
    }
    for (const t of Object.values(this.typeMesh)) { t.mesh.count = t.used; if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true; }
  }
  /** intensities: { flowId: 0..2.5 } — относительная интенсивность (растёт с годом/сценарием и перегрузкой станции). */
  setIntensities(map) {
    let changed = false;
    for (const f of this.flows) {
      const k = map[f.def.id] ?? 1;
      const cnt = Math.max(1, Math.min(f.type === 'ebus' || f.type === 'municipal' ? 5 : 22, Math.round((f.def.w * 8 + 1) * k)));
      f.intensity = k;
      if (cnt !== f.count) { f.count = cnt; changed = true; }
      f.mat.uniforms.uSpeed.value = 0.6 + 0.8 * Math.min(2, k);
    }
    if (changed) this._layoutFlowVehicles();
  }
  setLayer(layer) {
    // CITY — приглушённо, DEMAND — ярко, GRID — скрыто
    const a = { city: 0.28, demand: 1.0, grid: 0.0, investment: 0.5, future: 0.55 }[layer] ?? 0.3;
    this.layerAlpha = a;
    for (const f of this.flows) { f.mat.uniforms.uAlpha.value = a * 0.95; f.mesh.visible = a > 0.01; }
    this.ribbons.visible = a > 0.01;
  }
  highlight(id) { for (const f of this.flows) f.mat.uniforms.uHi.value = f.def.id === id ? 1 : 0; }

  update(dt) {
    const tmp = this.tmp;
    const arr = this.amb.mesh.instanceMatrix.array;
    for (let i = 0; i < this.amb.v.length; i++) {
      const v = this.amb.v[i];
      if (i >= this.ambActive || !v.path) { HIDE(arr, i); continue; }
      v.s += v.speed * dt;
      if (v.s >= v.path.len) { this._newRoute(v, v.node); if (!v.path) { HIDE(arr, i); continue; } }
      v.seg = v.path.sample(v.s, tmp, v.seg, v.lane);
      setPose(arr, i, tmp.x, tmp.y + 0.1, tmp.z, tmp.dx, tmp.dz, v.sc);
    }
    this.amb.mesh.instanceMatrix.needsUpdate = true;
    this.amb.mesh.count = this.amb.v.length;
    for (const f of this.flows) {
      const a = this.typeMesh[f.type].mesh.instanceMatrix.array;
      for (const v of f.veh) {
        v.s += v.speed * dt * (0.7 + 0.5 * Math.min(2, f.intensity));
        if (v.s >= f.path.len) { v.s = 0; v.seg = 0; }
        v.seg = f.path.sample(v.s, tmp, v.seg, 1.6);
        setPose(a, v.idx, tmp.x, tmp.y + 0.1, tmp.z, tmp.dx, tmp.dz);
      }
    }
    for (const t of Object.values(this.typeMesh)) t.mesh.instanceMatrix.needsUpdate = true;
  }
}
