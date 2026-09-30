// Дороги, мосты и путепроводы, железная дорога и МЦК — ленточная геометрия по реальным трассам OSM.
import * as THREE from 'three';
import { geo, SpatialGrid, ROAD_W, distSegPoint, lerp } from '../data/geo.js';
import { makeRoadMaterial, makeRailMaterial, PAL } from './materials.js';
import { BuildingBuffers } from './buildings.js';

export class RibbonBuf {
  constructor() { this.P = []; this.UV = []; this.I = []; this.n = 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    return g;
  }
}

/** Лента вдоль ломаной с mitre-соединениями. flat = [x,z,x,z…], ys — необязательные высоты. */
export function addRibbon(buf, flat, ys, width, y0) {
  const n = flat.length / 2;
  if (n < 2) return;
  const dx = new Float32Array(n - 1), dz = new Float32Array(n - 1), ln = new Float32Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const ex = flat[i * 2 + 2] - flat[i * 2], ez = flat[i * 2 + 3] - flat[i * 2 + 1];
    const L = Math.hypot(ex, ez) || 1e-6;
    dx[i] = ex / L; dz[i] = ez / L; ln[i] = L;
  }
  const base = buf.n;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    let rx, rz, s = 1;
    if (i === 0) { rx = -dz[0]; rz = dx[0]; }
    else if (i === n - 1) { rx = -dz[n - 2]; rz = dx[n - 2]; }
    else {
      const r0x = -dz[i - 1], r0z = dx[i - 1], r1x = -dz[i], r1z = dx[i];
      let mx = r0x + r1x, mz = r0z + r1z; const ml = Math.hypot(mx, mz);
      if (ml < 1e-3) { mx = r1x; mz = r1z; } else { mx /= ml; mz /= ml; }
      const dt = Math.max(0.42, mx * r1x + mz * r1z);
      s = Math.min(2.4, 1 / dt); rx = mx; rz = mz;
    }
    const hw = (width / 2) * s;
    const x = flat[i * 2], z = flat[i * 2 + 1], y = y0 + (ys ? ys[i] : 0);
    buf.P.push(x - rx * hw, y, z - rz * hw, x + rx * hw, y, z + rz * hw);
    buf.UV.push(-1, cum, 1, cum);
    if (i < n - 1) cum += ln[i];
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
    buf.I.push(a, b, c, b, d, c);
  }
  buf.n += n * 2;
}

function decorateBridge(struct, flat, ys, width) {
  const n = flat.length / 2;
  let maxY = 0; for (const y of ys) maxY = Math.max(maxY, y);
  if (maxY < 1.2) return;
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = flat[i * 2], az = flat[i * 2 + 1], bx = flat[i * 2 + 2], bz = flat[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
    const ym = (ys[i] + ys[i + 1]) / 2;
    const rot = Math.atan2(bz - az, bx - ax);
    struct.box((ax + bx) / 2, ym - 0.82, (az + bz) / 2, L + 0.25, 1.5, width + 1.4, rot, '#2b2d35');
    // парапеты
    const nx = -(bz - az) / L, nz = (bx - ax) / L, off = width / 2 + 0.55;
    for (const sg of [-1, 1]) struct.box((ax + bx) / 2 + nx * off * sg, ym + 0.32, (az + bz) / 2 + nz * off * sg, L + 0.2, 0.9, 0.35, rot, '#3a3d47');
    acc += L;
    if (acc > 24 && ym > 2.4) {
      acc = 0;
      struct.box((ax + bx) / 2, ym / 2 - 0.7, (az + bz) / 2, 2.2, ym - 1.4, width * 0.5, rot, '#23252b');
    }
  }
}

// Точка, рядом с которой предпочтительно ставить подпись улицы (ядро пилотной территории ЗИЛ) —
// чтобы названия попадали в поле зрения у станций, а не на случайном дальнем отрезке той же улицы.
const LABEL_FOCUS = { x: 760, z: 120 };

export function buildRoads() {
  const group = new THREE.Group();
  const struct = new BuildingBuffers();
  const roadGrid = new SpatialGrid(60);
  const bridgeGrid = new SpatialGrid(60);
  const labelAcc = new Map(); // name -> { name, cls, totalL, best:{score,x,z,ang,L} }

  const curb = new RibbonBuf(), walk = new RibbonBuf();
  const asph = Array.from({ length: 6 }, () => new RibbonBuf());
  const y0 = 0.02;

  for (const r of geo.data.roads) {
    const [cls, flags, flat, name, lanes, ysRaw] = r;
    if (flags & 2) continue; // тоннели не рисуем на поверхности
    const ys = flags & 1 && Array.isArray(ysRaw) ? ysRaw : null;
    let w = ROAD_W[cls];
    if (lanes >= 6 && cls <= 2) w += 4;
    if (cls === 6) { addRibbon(walk, flat, ys, w, y0); }
    else {
      if (cls <= 4) addRibbon(curb, flat, ys, w + (cls <= 3 ? 3.4 : 2.6), y0);
      addRibbon(asph[cls], flat, ys, w, y0);
    }
    if (ys) decorateBridge(struct, flat, ys, w);
    // пространственный индекс сегментов
    if (cls <= 5) {
      for (let i = 0; i < flat.length / 2 - 1; i++) {
        const ax = flat[i * 2], az = flat[i * 2 + 1], bx = flat[i * 2 + 2], bz = flat[i * 2 + 3];
        const seg = { ax, az, bx, bz, w, cls, ya: ys ? ys[i] : 0, yb: ys ? ys[i + 1] : 0 };
        const pad = w / 2 + 2;
        roadGrid.insert(seg, Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad);
        if (ys && (seg.ya > 0.3 || seg.yb > 0.3)) bridgeGrid.insert(seg, Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad);
      }
    }
    if (name && cls <= 3) {
      let L = 0; for (let i = 0; i < flat.length / 2 - 1; i++) L += Math.hypot(flat[i * 2 + 2] - flat[i * 2], flat[i * 2 + 3] - flat[i * 2 + 1]);
      if (L >= 18) {
        const m = Math.floor(flat.length / 4);
        const i0 = Math.max(0, m - 1), i1 = Math.min(flat.length / 2 - 1, m);
        const mx = (flat[i0 * 2] + flat[i1 * 2]) / 2, mz = (flat[i0 * 2 + 1] + flat[i1 * 2 + 1]) / 2;
        const dist = Math.hypot(mx - LABEL_FOCUS.x, mz - LABEL_FOCUS.z);
        // сегмент выбирается длиной И близостью к пилотному ядру — так подпись улицы оказывается там, где реально ходит пользователь
        const score = L - dist * 0.45;
        let a = labelAcc.get(name);
        if (!a) { a = { name, cls, totalL: 0, best: null }; labelAcc.set(name, a); }
        a.totalL += L; a.cls = Math.min(a.cls, cls);
        if (!a.best || score > a.best.score) a.best = { score, L, x: mx, z: mz, ang: Math.atan2(flat[i1 * 2 + 1] - flat[i0 * 2 + 1], flat[i1 * 2] - flat[i0 * 2]) };
      }
    }
  }

  // --- рельсы ---
  const railBuf = { 0: new RibbonBuf(), 5: new RibbonBuf(), 2: new RibbonBuf(), 3: new RibbonBuf() };
  const railW = { 0: 6.2, 5: 3.4, 2: 3.0, 3: 7.2 };
  for (const r of geo.data.rail) {
    const [kind, flags, flat, name, ysRaw] = r;
    if (kind === 1 || (flags & 2)) continue;
    const ys = flags & 1 && Array.isArray(ysRaw) ? ysRaw : null;
    const b = railBuf[kind]; if (!b) continue;
    addRibbon(b, flat, ys, railW[kind], y0);
    if (ys) decorateBridge(struct, flat, ys, railW[kind]);
  }

  const mk = (buf, mat, order) => {
    if (!buf.n) return;
    const m = new THREE.Mesh(buf.geometry(), mat);
    m.renderOrder = order; m.frustumCulled = false; group.add(m);
    return m;
  };
  mk(railBuf[5], makeRailMaterial({ color: '#1f2126', rail: '#4b4e59', units: -14 }), 3);
  mk(railBuf[0], makeRailMaterial({ color: '#23252b', rail: '#6d7180', units: -15 }), 3);
  mk(railBuf[2], makeRailMaterial({ color: '#202228', rail: '#575b68', units: -16 }), 3);
  mk(railBuf[3], makeRailMaterial({ color: '#24232e', rail: '#8a8fa6', glow: PAL.violet, units: -17 }), 3);
  mk(curb, makeRoadMaterial({ color: PAL.curb, units: -18, sidewalk: true }), 4);
  mk(walk, makeRoadMaterial({ color: '#30333c', units: -19, gridAlpha: 0.2 }), 4);
  const unitsByCls = [-30, -28, -26, -24, -22, -20];
  const mark = [true, true, true, false, false, false];
  const roadMeshes = [];
  for (let c = 5; c >= 0; c--) {
    const m = mk(asph[c], makeRoadMaterial({ color: PAL.asphalt[c], units: unitsByCls[c], marks: mark[c] }), 5 + (5 - c) * 0.1);
    if (m) roadMeshes.push(m);
  }

  // отбор: сортируем по суммарной длине улицы (не по одному сегменту) — так короткие, но реальные проезды
  // (1-й Автозаводский, 1-й Кожуховский…) не проигрывают одному длинному куску набережной вдалеке
  const labels = [...labelAcc.values()]
    .filter(a => a.best)
    .sort((a, b) => b.totalL - a.totalL)
    .slice(0, 40)
    .map(a => ({ name: a.name, cls: a.cls, L: a.totalL, x: a.best.x, z: a.best.z, ang: a.best.ang }));
  return { group, struct, roadGrid, bridgeGrid, labels };
}

/** Высота полотна моста в точке (для ходьбы/транспорта). Возвращает 0 вне мостов. */
export function bridgeHeightAt(bridgeGrid, x, z) {
  const segs = bridgeGrid.query(x, z, 3);
  let best = 0;
  for (const s of segs) {
    const r = distSegPoint(x, z, s.ax, s.az, s.bx, s.bz);
    if (r.d < s.w / 2 + 0.6) best = Math.max(best, lerp(s.ya, s.yb, r.t));
  }
  return best;
}

/** Ближайший сегмент дороги (для ориентации объектов вдоль улицы). */
export function nearestRoad(roadGrid, x, z, r = 80, maxCls = 4) {
  let best = null;
  for (const s of roadGrid.query(x, z, r)) {
    if (s.cls > maxCls) continue;
    const q = distSegPoint(x, z, s.ax, s.az, s.bx, s.bz);
    const d = q.d - s.w / 2;
    if (!best || d < best.d) best = { d, seg: s, x: q.x, z: q.z, ang: Math.atan2(s.bz - s.az, s.bx - s.ax) };
  }
  return best;
}
