// Низкополигональные модели транспорта (кузов окрашивается instanceColor, огни/стёкла — вершинными цветами).
import * as THREE from 'three';

export class MeshBuilder {
  constructor() { this.P = []; this.N = []; this.C = []; this.E = []; }
  _face(n, corners, col, emit, cx, cy, cz, cs, sn) {
    const idx = [0, 1, 2, 0, 2, 3];
    const nx = n[0] * cs + n[2] * sn, nz = -n[0] * sn + n[2] * cs;
    for (const i of idx) {
      const c = corners[i];
      const x = c[0] * cs + c[2] * sn, z = -c[0] * sn + c[2] * cs;
      this.P.push(cx + x, cy + c[1], cz + z); this.N.push(nx, n[1], nz); this.C.push(col.r, col.g, col.b); this.E.push(emit);
    }
  }
  /** Ось x — вперёд. rotY — поворот боксa вокруг вертикальной оси (локально). */
  box(cx, cy, cz, sx, sy, sz, color, emit = 0, rotY = 0) {
    const c = new THREE.Color(color), hx = sx / 2, hy = sy / 2, hz = sz / 2, cs = Math.cos(rotY), sn = Math.sin(rotY);
    const F = (n, k) => this._face(n, k, c, emit, cx, cy, cz, cs, sn);
    F([1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]);
    F([-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]);
    F([0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]);
    F([0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]);
    F([0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]);
    F([0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]);
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aEmit', new THREE.Float32BufferAttribute(this.E, 1));
    return g;
  }
}
const WHITE = '#ffffff', GLASS = '#0b0e15', TYRE = '#07080b', HEAD = '#fff3d6', TAIL = '#ff2d3d';

function wheels(b, xs, z, r = 0.34, w = 0.24) { for (const x of xs) for (const s of [-1, 1]) b.box(x, r, s * z, r * 2, r * 2, w, TYRE, 2); }

export function carGeometry() {
  const b = new MeshBuilder();
  b.box(0, 0.63, 0, 4.3, 0.62, 1.78, WHITE, 0);
  b.box(-0.3, 1.13, 0, 2.5, 0.42, 1.62, GLASS, 2);
  b.box(-0.3, 1.36, 0, 2.05, 0.06, 1.5, WHITE, 0);
  b.box(1.4, 0.98, 0, 1.2, 0.08, 1.6, WHITE, 0);
  wheels(b, [-1.35, 1.35], 0.85);
  for (const s of [-1, 1]) { b.box(2.16, 0.72, s * 0.62, 0.06, 0.13, 0.42, HEAD, 1); b.box(-2.16, 0.72, s * 0.62, 0.06, 0.13, 0.42, TAIL, 1); }
  return b.geometry();
}
export function busGeometry() {
  const b = new MeshBuilder();
  b.box(0, 1.85, 0, 11.8, 2.5, 2.5, WHITE, 0);
  b.box(0, 2.35, 0, 11.6, 0.95, 2.53, GLASS, 2);
  b.box(1.2, 3.18, 0, 3.4, 0.14, 1.0, '#151820', 2);
  wheels(b, [-3.6, 3.6], 1.1, 0.5, 0.3);
  b.box(5.92, 2.95, 0, 0.05, 0.22, 1.5, '#ffb84d', 1);
  for (const s of [-1, 1]) { b.box(5.92, 0.75, s * 0.95, 0.05, 0.14, 0.45, HEAD, 1); b.box(-5.92, 0.85, s * 0.95, 0.05, 0.14, 0.45, TAIL, 1); }
  return b.geometry();
}
export function truckGeometry() {
  const b = new MeshBuilder();
  b.box(2.8, 1.55, 0, 2.2, 2.1, 2.3, WHITE, 0);
  b.box(3.35, 1.95, 0, 1.2, 0.85, 2.32, GLASS, 2);
  b.box(-1.5, 1.85, 0, 5.4, 2.4, 2.4, WHITE, 0);
  b.box(-1.5, 0.75, 0, 5.4, 0.3, 2.2, '#15171d', 2);
  b.box(2.6, 2.82, 0, 0.25, 0.16, 0.5, '#ff9a1f', 1);
  wheels(b, [-3.4, -1.4, 3.1], 1.05, 0.5, 0.3);
  for (const s of [-1, 1]) { b.box(3.92, 0.85, s * 0.9, 0.05, 0.14, 0.4, HEAD, 1); b.box(-4.2, 0.85, s * 0.9, 0.05, 0.14, 0.4, TAIL, 1); }
  return b.geometry();
}
