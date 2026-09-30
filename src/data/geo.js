// Геоданные пилотной территории (OpenStreetMap, запечено tools/build_data.py) и пространственные помощники.
// Локальная система координат: x — на восток, z — на юг, y — вверх; 1 единица = 1 м.

export const geo = { meta: null, data: null };

export async function loadGeo(url = 'data/zil.json', onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось загрузить ' + url);
  const total = +res.headers.get('content-length') || 0;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProgress(got / total);
    }
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    geo.data = JSON.parse(new TextDecoder().decode(buf));
  } else {
    geo.data = await res.json();
  }
  geo.meta = geo.data.meta;
  return geo.data;
}

export function project(lat, lon) {
  const m = geo.meta;
  return { x: (lon - m.lon0) * m.kx, z: -(lat - m.lat0) * m.kz };
}

export function pointInPoly(x, z, flat) {
  let inside = false;
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[i * 2], zi = flat[i * 2 + 1], xj = flat[j * 2], zj = flat[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polyBounds(flat) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i], z = flat[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, z0, x1, z1 };
}

export function polyCentroid(flat) {
  let x = 0, z = 0; const n = flat.length / 2;
  for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; }
  return { x: x / n, z: z / n };
}

export function distSegPoint(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  let t = L ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cz = az + t * dz;
  return { d: Math.hypot(px - cx, pz - cz), t, x: cx, z: cz };
}

/** Равномерная сетка для быстрых пространственных запросов. */
export class SpatialGrid {
  constructor(cell = 60) { this.cell = cell; this.map = new Map(); }
  _k(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  insert(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++)
      for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
        const k = this._k(ix, iz);
        let a = this.map.get(k);
        if (!a) this.map.set(k, a = []);
        a.push(item);
      }
  }
  query(x, z, r = 0, out = []) {
    const c = this.cell, qid = (this._qid = (this._qid || 0) + 1);
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++)
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const a = this.map.get(this._k(ix, iz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const it = a[i];
          if (typeof it === 'object') { if (it._q === qid) continue; it._q = qid; }
          out.push(it);
        }
      }
    return out;
  }
}

export const ROAD_W = [24, 18, 14, 10.5, 7.5, 4.5, 1.8];
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
