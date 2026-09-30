// Здания: реальные контуры OSM → один слитый BufferGeometry (низкополигональный), плюс сетка коллизий.
import * as THREE from 'three';
import { geo, SpatialGrid, polyBounds, hash2 } from '../data/geo.js';
import { makeBuildingMaterial, PAL } from './materials.js';

const V2 = THREE.Vector2;

/** Накопитель геометрии зданий (стены + крыши); в него же дописываются опоры мостов и т.п. */
export class BuildingBuffers {
  constructor() { this.P = []; this.N = []; this.C = []; this.UV = []; this.S = []; this.K = []; this.NW = []; }
  vert(x, y, z, nx, ny, nz, c, u, v, seed, kind, isNew) {
    this.P.push(x, y, z); this.N.push(nx, ny, nz); this.C.push(c.r, c.g, c.b); this.UV.push(u, v);
    this.S.push(seed); this.K.push(kind); this.NW.push(isNew);
  }
  /** Ориентированный параллелепипед без нижней грани (для опор, ограждений, малых объектов). */
  box(cx, cy, cz, sx, sy, sz, rotY, color, kind = 5) {
    const c = new THREE.Color(color), cs = Math.cos(rotY), sn = Math.sin(rotY);
    const hx = sx / 2, hz = sz / 2;
    const corner = (lx, lz) => [cx + lx * cs - lz * sn, cz + lx * sn + lz * cs];
    const p = [corner(-hx, -hz), corner(hx, -hz), corner(hx, hz), corner(-hx, hz)];
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const quad = (a, b, cc, d, n) => {
      const idx = [a, b, cc, a, cc, d];
      for (const i of idx) this.vert(i[0], i[1], i[2], n[0], n[1], n[2], c, 0, -1, 0.5, kind, 0);
    };
    // верх
    quad([p[0][0], y1, p[0][1]], [p[3][0], y1, p[3][1]], [p[2][0], y1, p[2][1]], [p[1][0], y1, p[1][1]], [0, 1, 0]);
    // стороны
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4];
      const nx = b[1] - a[1], nz = -(b[0] - a[0]); const L = Math.hypot(nx, nz) || 1;
      quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [nx / L, 0, nz / L]);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(this.S, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.K, 1));
    g.setAttribute('aNew', new THREE.Float32BufferAttribute(this.NW, 1));
    return g;
  }
}

function ringOrient(flat) {
  let a = 0; const n = flat.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1]; }
  return a; // >0 — «по часовой» в системе (x вправо, z вниз)
}

export function buildBuildings(extra) {
  const B = extra || new BuildingBuffers();
  const grid = new SpatialGrid(80);
  const list = [];
  const bl = geo.data.buildings;
  const tmpC = new THREE.Color();

  for (let bi = 0; bi < bl.length; bi++) {
    const [kind, h, flags, ring, name] = bl[bi];
    const n = ring.length / 2;
    if (n < 3) continue;
    const seed = hash2(Math.round(ring[0] * 3), Math.round(ring[1] * 3));
    const isNew = (flags & 1) ? 1 : 0;
    tmpC.set(isNew ? PAL.bldgNew : PAL.bldg[kind] ?? PAL.bldg[0]);
    const v = 0.86 + seed * 0.28;
    const wall = tmpC.clone().multiplyScalar(v);
    const roofC = tmpC.clone().multiplyScalar(v * 1.18);
    const orient = ringOrient(ring);
    const sgn = orient > 0 ? 1 : -1;
    let cum = 0;
    // стены
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const nx = (dz / L) * sgn, nz = (-dx / L) * sgn;
      const u0 = cum, u1 = cum + L; cum = u1;
      if (sgn < 0) {
        B.vert(ax, 0, az, nx, 0, nz, wall, u0, 0, seed, kind, isNew);
        B.vert(bx, 0, bz, nx, 0, nz, wall, u1, 0, seed, kind, isNew);
        B.vert(bx, h, bz, nx, 0, nz, wall, u1, h, seed, kind, isNew);
        B.vert(ax, 0, az, nx, 0, nz, wall, u0, 0, seed, kind, isNew);
        B.vert(bx, h, bz, nx, 0, nz, wall, u1, h, seed, kind, isNew);
        B.vert(ax, h, az, nx, 0, nz, wall, u0, h, seed, kind, isNew);
      } else {
        B.vert(bx, 0, bz, nx, 0, nz, wall, u1, 0, seed, kind, isNew);
        B.vert(ax, 0, az, nx, 0, nz, wall, u0, 0, seed, kind, isNew);
        B.vert(ax, h, az, nx, 0, nz, wall, u0, h, seed, kind, isNew);
        B.vert(bx, 0, bz, nx, 0, nz, wall, u1, 0, seed, kind, isNew);
        B.vert(ax, h, az, nx, 0, nz, wall, u0, h, seed, kind, isNew);
        B.vert(bx, h, bz, nx, 0, nz, wall, u1, h, seed, kind, isNew);
      }
    }
    // крыша
    const contour = [];
    for (let i = 0; i < n; i++) contour.push(new V2(ring[i * 2], ring[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      let [a, b, c] = t;
      const pa = contour[a], pb = contour[b], pc = contour[c];
      const ny = (pb.y - pa.y) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.y - pa.y);
      if (ny < 0) { const tmp = b; b = c; c = tmp; }
      for (const k of [a, b, c]) B.vert(contour[k].x, h, contour[k].y, 0, 1, 0, roofC, 0, -1, seed, kind, isNew);
    }
    const bb = polyBounds(ring);
    // кровельное «железо»: технические короба, баки, антенны — тем же draw call'ом (B.box рендерится без окон)
    addRoofClutter(B, bb, h, kind, seed);
    const item = { ring, h, kind, name, bb, idx: bi };
    list.push(item);
    grid.insert(item, bb.x0, bb.z0, bb.x1, bb.z1);
  }
  return { buffers: B, grid, list };
}

/** Деталь силуэта крыши: HVAC-короба, бак, антенна/мачта — выборочно, детерминированно по seed. */
function addRoofClutter(B, bb, h, kind, seed) {
  if (h < 13 || kind === 5) return;
  const w = bb.x1 - bb.x0, d = bb.z1 - bb.z0;
  if (w < 9 || d < 9) return;
  const r1 = hash2(Math.round(bb.x0 * 7 + seed * 999), Math.round(bb.z1 * 7));
  if (r1 > 0.42) return; // не на каждой крыше — иначе силуэт станет шумным
  const cx = bb.x0 + w * (0.28 + 0.44 * hash2(Math.round(bb.x0 * 3), Math.round(bb.z0 * 5 + 1)));
  const cz = bb.z0 + d * (0.28 + 0.44 * hash2(Math.round(bb.x1 * 5), Math.round(bb.z1 * 3 + 2)));
  const r2 = hash2(Math.round(cx * 11), Math.round(cz * 11));
  if (kind === 3) { // промышленная — вентиляция/короб
    B.box(cx, h + 0.9, cz, 3.2, 1.8, 2.2, r2 * 6.28, '#3a3d43', 5);
    B.box(cx + 3.6, h + 0.6, cz + 1.4, 1.6, 1.2, 1.6, r2 * 3.1, '#33363c', 5);
  } else if (h > 46 && r2 > 0.65) { // высотная башня — тонкая мачта/антенна довершает силуэт
    B.box(cx, h + 3.6, cz, 0.4, 7.2, 0.4, 0, '#22242a', 5);
    B.box(cx, h + 0.7, cz, 1.6, 1.4, 1.6, r2 * 6.28, '#2e3138', 5);
  } else { // жилая/деловая/общественная — лифтовая/вентиляционная надстройка + бак
    B.box(cx, h + 1.1, cz, 2.6, 2.2, 2.6, r2 * 6.28, '#3c3f47', 5);
    if (r1 < 0.2) B.box(cx - 3.4, h + 0.7, cz + 2.0, 1.3, 1.4, 1.3, r2 * 4.2, '#34373e', 5);
  }
}

export function makeBuildingMesh(buffers) {
  const mesh = new THREE.Mesh(buffers.geometry(), makeBuildingMaterial());
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return mesh;
}
