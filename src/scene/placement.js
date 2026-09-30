// Поиск свободных площадок для ЭЗС и площадок-кандидатов: вне зданий, дорог и воды, фронтом к ближайшей улице.
import { geo, pointInPoly, polyBounds, distSegPoint, ROAD_W } from '../data/geo.js';
import { nearestRoad } from './roads.js';

function ringDist(x, z, ring) {
  let best = Infinity; const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = distSegPoint(x, z, ring[j * 2], ring[j * 2 + 1], ring[i * 2], ring[i * 2 + 1]).d;
    if (d < best) best = d;
  }
  return best;
}

export function makePlacer({ buildingGrid, roadGrid, buildings }) {
  const water = geo.data.water.map(w => ({ o: w.o, h: w.h || [], bb: polyBounds(w.o) }));
  // растровая маска занятости (ячейка 2.5 м): здания, улицы, вода, рельсы — проверка «свободно» за O(1)
  const CELL = 2.5, hw = geo.meta.halfW, hh = geo.meta.halfH;
  const NX = Math.ceil((hw * 2) / CELL) + 2, NZ = Math.ceil((hh * 2) / CELL) + 2;
  const raw = new Uint8Array(NX * NZ);
  const ix = (x) => Math.floor((x + hw) / CELL) + 1, iz = (z) => Math.floor((z + hh) / CELL) + 1;
  const fillPoly = (ring, holes = []) => {
    const bb = polyBounds(ring);
    for (let a = ix(bb.x0); a <= ix(bb.x1); a++) for (let b = iz(bb.z0); b <= iz(bb.z1); b++) {
      if (a < 0 || b < 0 || a >= NX || b >= NZ) continue;
      const x = (a - 1) * CELL - hw + CELL / 2, z = (b - 1) * CELL - hh + CELL / 2;
      if (pointInPoly(x, z, ring) && !holes.some(h => pointInPoly(x, z, h))) raw[a + b * NX] = 1;
    }
  };
  const stampLine = (ax, az, bx, bz, r) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / (CELL * 0.6)));
    const rc = Math.ceil(r / CELL);
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      const cx = ix(x), cz = iz(z);
      for (let a = -rc; a <= rc; a++) for (let b = -rc; b <= rc; b++) {
        if (a * a + b * b > (rc + 0.5) * (rc + 0.5)) continue;
        const X = cx + a, Z = cz + b; if (X < 0 || Z < 0 || X >= NX || Z >= NZ) continue;
        raw[X + Z * NX] = 1;
      }
    }
  };
  for (const b of buildings) fillPoly(b.ring);
  for (const w of water) fillPoly(w.o, w.h);
  for (const r of geo.data.roads) {
    const [cls, flags, f, , lanes, ys] = r;
    if (cls > 5 || (flags & 2)) continue;
    const w = ROAD_W[cls] / 2 + 0.8;
    for (let i = 0; i < f.length / 2 - 1; i++) { if (flags & 1 && Array.isArray(ys) && ys[i] > 0.3) continue; stampLine(f[i * 2], f[i * 2 + 1], f[i * 2 + 2], f[i * 2 + 3], w); }
  }
  for (const r of geo.data.rail) { if (r[0] === 1 || (r[1] & 2)) continue; const f = r[2]; for (let i = 0; i < f.length / 2 - 1; i++) stampLine(f[i * 2], f[i * 2 + 1], f[i * 2 + 2], f[i * 2 + 3], 6); }
  const dil = new Uint8Array(NX * NZ);
  for (let b = 1; b < NZ - 1; b++) for (let a = 1; a < NX - 1; a++) {
    const o = a + b * NX;
    if (raw[o] || raw[o - 1] || raw[o + 1] || raw[o - NX] || raw[o + NX] || raw[o - NX - 1] || raw[o - NX + 1] || raw[o + NX - 1] || raw[o + NX + 1]) dil[o] = 1;
  }

  function free(x, z, margin = 1.5) {
    const a = ix(x), b = iz(z);
    if (a < 1 || b < 1 || a >= NX - 1 || b >= NZ - 1) return false;
    return !(margin > 1.6 ? dil : raw)[a + b * NX];
  }
  function railNear() { return false; }

  /** Свободен ли прямоугольник w×d с центром (cx,cz), повёрнутый так, что локальная +z направлена в (fx,fz). */
  function rectFree(cx, cz, w, d, fx, fz, margin) {
    const ux = fz, uz = -fx; // локальная ось x
    for (let a = -w / 2; a <= w / 2 + 0.01; a += 2.6)
      for (let b = -d / 2; b <= d / 2 + 0.01; b += 2.6) {
        const x = cx + ux * a + fx * b, z = cz + uz * a + fz * b;
        if (!free(x, z, margin)) return false;
      }
    return true;
  }

  /**
   * Ищет ближайшее к (x,z) свободное место. Возвращает {x,z,rot,fx,fz,w,d} — rot: поворот вокруг Y так, что локальная +z (фронт) смотрит на улицу.
   */
  function find(x, z, { w = 52, d = 30, minR = 0, maxR = 140, step = 6, margin = 1.6, avoid = [] } = {}) {
    for (let r = minR; r <= maxR; r += step) {
      const n = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / step));
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + r * 0.37;
        const cx = x + Math.cos(ang) * r, cz = z + Math.sin(ang) * r;
        if (!free(cx, cz, margin)) continue;
        if (avoid.some(a => Math.hypot(cx - a.x, cz - a.z) < a.r)) continue;
        const nr = nearestRoad(roadGrid, cx, cz, 70, 4);
        if (!nr) continue;
        let fx = nr.x - cx, fz = nr.z - cz; const L = Math.hypot(fx, fz);
        if (L < 1 || L > 60) continue;
        fx /= L; fz /= L;
        if (!rectFree(cx, cz, w, d, fx, fz, margin)) continue;
        return { x: cx, z: cz, rot: Math.atan2(fx, fz), fx, fz, w, d, r, roadDist: L };
      }
    }
    return null;
  }
  return { free, find, rectFree, mask: raw };
}

/** Размещает станции и площадки-кандидаты в датасете. */
export function placeDataset(ds, placer) {
  const taken = [];
  const put = (s, { w, d }) => {
    let p = placer.find(s.anchor.x, s.anchor.z, { w, d, maxR: 160 })
      || placer.find(s.anchor.x, s.anchor.z, { w: 40, d: 24, maxR: 260, step: 8 })
      || placer.find(s.anchor.x, s.anchor.z, { w: 30, d: 20, maxR: 420, step: 10, margin: 1 });
    if (!p) p = { x: s.anchor.x, z: s.anchor.z, rot: 0, fx: 0, fz: 1, w, d };
    s.pos = { x: p.x, z: p.z, rot: p.rot, fx: p.fx, fz: p.fz };
    taken.push({ x: p.x, z: p.z, r: 62 });
  };
  for (const s of ds.stations) put(s, { w: 52, d: 30 });
  // площадки-кандидаты для NEW STATION / DEFER: ближе 90…380 м, не пересекаются со станциями и друг с другом
  for (const s of ds.stations) {
    let p = placer.find(s.pos.x, s.pos.z, { w: 40, d: 26, minR: 80, maxR: 380, step: 8, avoid: taken })
      || placer.find(s.pos.x, s.pos.z, { w: 30, d: 22, minR: 70, maxR: 520, step: 10, avoid: taken, margin: 1 });
    if (!p) p = { x: s.pos.x + 90 * s.pos.fz, z: s.pos.z - 90 * s.pos.fx, rot: s.pos.rot, fx: s.pos.fx, fz: s.pos.fz };
    s.site = { x: p.x, z: p.z, rot: p.rot, fx: p.fx, fz: p.fz };
    taken.push({ x: p.x, z: p.z, r: 55 });
  }
  return ds;
}
