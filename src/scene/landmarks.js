// Ориентиры и озеленение: трубы ТЭЦ-9, деревья (инстансы) — реальные положения из OSM.
import * as THREE from 'three';
import { geo, pointInPoly, polyBounds, polyCentroid, hash2 } from '../data/geo.js';
import { Assembly } from './assembly.js';
import { makeKit } from './kit.js';
import { ROAD_W } from '../data/geo.js';

export function buildChimneys(parent, kit) {
  const A = new Assembly();
  const lights = [];
  const list = geo.data.poi.chimneys.filter(c => c.h > 0 || (Math.hypot(c.x - 250, c.z - 330) < 260));
  for (const c of list) {
    const h = c.h > 0 ? c.h : 62;
    const segs = 5, r0 = 3.4, r1 = 1.9;
    for (let i = 0; i < segs; i++) {
      const y0 = (h / segs) * i, y1 = (h / segs) * (i + 1);
      const r = r0 + (r1 - r0) * ((i + 0.5) / segs);
      A.cyl(i % 2 ? 'accentRed' : 'chimney', c.x, (y0 + y1) / 2, c.z, r, y1 - y0, 12);
    }
    lights.push(new THREE.Vector3(c.x, h + 1.2, c.z));
  }
  const g = A.build((role) => role === 'accentRed' ? new THREE.MeshStandardMaterial({ color: '#8f3a44', roughness: 0.7 }) : new THREE.MeshStandardMaterial({ color: '#7d8494', roughness: 0.7, metalness: 0.2 }));
  parent.add(g);
  const lg = new THREE.SphereGeometry(1.1, 8, 6); const lm = new THREE.MeshBasicMaterial({ color: '#ff3b3b' });
  const im = new THREE.InstancedMesh(lg, lm, lights.length);
  lights.forEach((p, i) => { im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)); });
  parent.add(im);
  return { lights: im };
}

/** Деревья: парки/лес (реальные полигоны OSM) + аллеи вдоль улиц. Два инстанс-меша (крона и ствол). */
export function buildTrees(parent, placer, roadGrid, maxTrees = 5200) {
  const pts = [];
  const cats = new Set([5, 6, 9, 10]);
  for (const l of geo.data.land) {
    if (!cats.has(l[0])) continue;
    const ring = l[1]; const bb = polyBounds(ring);
    const area = (bb.x1 - bb.x0) * (bb.z1 - bb.z0) * 0.55;
    const n = Math.min(300, Math.floor(area / (l[0] === 6 ? 300 : 380)));
    let tries = 0, got = 0;
    while (got < n && tries < n * 6) {
      tries++;
      const x = bb.x0 + Math.random() * (bb.x1 - bb.x0), z = bb.z0 + Math.random() * (bb.z1 - bb.z0);
      if (!pointInPoly(x, z, ring)) continue;
      if (l[2] && l[2].some(h => pointInPoly(x, z, h))) continue;
      if (!placer.free(x, z, 2.5)) continue;
      pts.push([x, z, 5 + Math.random() * 5]); got++;
    }
  }
  // уличные деревья вдоль магистралей
  for (const r of geo.data.roads) {
    const [cls, flags, flat] = r;
    if (cls < 1 || cls > 4 || (flags & 3)) continue;
    const w = ROAD_W[cls];
    let acc = 0;
    for (let i = 0; i < flat.length / 2 - 1; i++) {
      const ax = flat[i * 2], az = flat[i * 2 + 1], bx = flat[i * 2 + 2], bz = flat[i * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let s = (acc % 24) ? 24 - (acc % 24) : 0; s < L; s += 24) {
        const t = s / L; const side = (Math.floor(s / 24) + i) % 2 ? 1 : -1;
        const x = ax + (bx - ax) * t + nx * (w / 2 + 3.6) * side, z = az + (bz - az) * t + nz * (w / 2 + 3.6) * side;
        if (Math.random() < 0.45 && placer.free(x, z, 1.4)) pts.push([x, z, 4.2 + Math.random() * 3.6]);
      }
      acc += L;
    }
  }
  const n = Math.min(maxTrees, pts.length);
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  const crown = new THREE.IcosahedronGeometry(1, 0); crown.translate(0, 0.9, 0); crown.scale(1, 1.25, 1);
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 1, 5); trunk.translate(0, 0.5, 0);
  const cm = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
  const tm = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: '#2a2622' }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const greens = ['#1e3a2b', '#254532', '#2c5039', '#1a3326', '#35563a', '#2f4a2e'];
  for (let i = 0; i < n; i++) {
    const [x, z, h] = pts[i]; const rad = 1.6 + (h - 4) * 0.35;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
    p.set(x, h * 0.32, z); s.set(rad, h * 0.62, rad); m.compose(p, q, s); cm.setMatrixAt(i, m);
    c.set(greens[Math.floor(hash2(i, 7) * greens.length)]); cm.setColorAt(i, c);
    p.set(x, 0, z); s.set(1, h * 0.36, 1); m.compose(p, q, s); tm.setMatrixAt(i, m);
  }
  cm.instanceMatrix.needsUpdate = true; if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
  cm.frustumCulled = false; tm.frustumCulled = false;
  parent.add(cm, tm);
  return { crowns: cm, trunks: tm, count: n };
}
