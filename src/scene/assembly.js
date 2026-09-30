// Сборка «по ролям»: много мелких деталей → по одному слитому мешу на роль материала (мало draw-calls, смена состояния по ролям).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = (seg) => new THREE.CylinderGeometry(1, 1, 1, seg, 1, false);
const cylCache = {};

export class Assembly {
  constructor() { this.parts = new Map(); }
  _add(role, geo, cx, cy, cz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    const g = geo.clone(); g.applyMatrix4(_m);
    g.deleteAttribute('uv');
    if (!this.parts.has(role)) this.parts.set(role, []);
    this.parts.get(role).push(g);
    return this;
  }
  box(role, cx, cy, cz, sx, sy, sz, ry = 0, rx = 0, rz = 0) { return this._add(role, unitBox, cx, cy, cz, sx, sy, sz, rx, ry, rz); }
  cyl(role, cx, cy, cz, r, h, seg = 8, ry = 0, rx = 0, rz = 0) { const g = cylCache[seg] || (cylCache[seg] = unitCyl(seg)); return this._add(role, g, cx, cy, cz, r, h, r, rx, ry, rz); }
  /** Возвращает Group из мешей по ролям; getMat(role) выдаёт материал. */
  build(getMat) {
    const grp = new THREE.Group();
    for (const [role, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geo, getMat(role, 'built'));
      mesh.userData.role = role;
      grp.add(mesh);
      list.forEach(g => g.dispose());
    }
    return grp;
  }
}
