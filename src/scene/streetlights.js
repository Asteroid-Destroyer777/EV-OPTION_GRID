// Уличное освещение вдоль основных дорог: имитация без реальных источников света —
// тёмные инстанс-опоры + тёплые emissive-плафоны + мягкое «пятно света» на асфальте (аддитивный billboard-декаль).
// Три draw call'а суммарно (столб, плафон+гало, пятна), независимо от количества фонарей — дёшево для FPS.
import * as THREE from 'three';
import { geo, ROAD_W } from '../data/geo.js';

/** Радиальная текстура мягкого пятна света; rgb — базовый цвет «255,214,150» (тёплый) и т.п. Переиспользуется станциями (кэш по цвету). */
const poolCache = new Map();
export function poolTexture(rgb = '255,214,150') {
  if (poolCache.has(rgb)) return poolCache.get(rgb);
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, `rgba(${rgb},0.85)`);
  grad.addColorStop(0.35, `rgba(${rgb},0.38)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  poolCache.set(rgb, t);
  return t;
}

/** Точки фонарей вдоль главных улиц (cls 0..3), смещённые от края проезжей части, стороны чередуются. */
function lampPoints(spacing, cap) {
  const pts = [];
  for (const r of geo.data.roads) {
    const [cls, flags, flat] = r;
    if (cls > 3) continue;
    if (flags & 3) continue; // мост/тоннель — фонари там даёт decorateBridge, не дублируем
    const w = ROAD_W[cls];
    const step = cls === 0 ? spacing * 1.4 : cls <= 1 ? spacing * 1.15 : spacing;
    let acc = 0;
    for (let i = 0; i < flat.length / 2 - 1; i++) {
      const ax = flat[i * 2], az = flat[i * 2 + 1], bx = flat[i * 2 + 2], bz = flat[i * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      const startS = (acc % step) ? step - (acc % step) : 0;
      for (let s = startS; s < L; s += step) {
        const t = s / L; const side = Math.floor((acc + s) / step) % 2 ? 1 : -1;
        const x = ax + (bx - ax) * t + nx * (w / 2 + 2.6) * side;
        const z = az + (bz - az) * t + nz * (w / 2 + 2.6) * side;
        const ang = Math.atan2(-nx * side, -nz * side); // «рука» фонаря смотрит на дорогу
        pts.push([x, z, ang, cls]);
      }
      acc += L;
    }
  }
  // перемешать и ограничить — чтобы освещение было равномерно распределено по всей территории, а не только на первых дорогах
  for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return pts.slice(0, cap);
}

export function buildStreetLights(parent, { spacing = 30, cap = 1400 } = {}) {
  const pts = lampPoints(spacing, cap);
  const n = pts.length;
  if (!n) return { count: 0 };

  const H = 6.6;
  const poleGeo = new THREE.CylinderGeometry(0.075, 0.11, H, 6); poleGeo.translate(0, H / 2, 0);
  const armGeo = new THREE.BoxGeometry(1.55, 0.08, 0.08); armGeo.translate(0.78, H - 0.06, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.55, metalness: 0.35 });
  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, n);
  const armMesh = new THREE.InstancedMesh(armGeo, poleMat, n);

  const headGeo = new THREE.SphereGeometry(0.24, 8, 6); headGeo.translate(1.5, H - 0.06, 0);
  const headMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0' });
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, n);

  const haloGeo = new THREE.IcosahedronGeometry(0.85, 0); haloGeo.translate(1.5, H - 0.06, 0);
  const haloMat = new THREE.MeshBasicMaterial({ color: '#ffcf8f', transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending });
  const haloMesh = new THREE.InstancedMesh(haloGeo, haloMat, n);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const [x, z, ang] = pts[i];
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    p.set(x, 0, z); m.compose(p, q, s);
    poleMesh.setMatrixAt(i, m); armMesh.setMatrixAt(i, m); headMesh.setMatrixAt(i, m); haloMesh.setMatrixAt(i, m);
  }
  for (const mesh of [poleMesh, armMesh, headMesh, haloMesh]) { mesh.frustumCulled = false; mesh.instanceMatrix.needsUpdate = true; }
  poleMesh.renderOrder = 6; armMesh.renderOrder = 6; headMesh.renderOrder = 41; haloMesh.renderOrder = 41;
  parent.add(poleMesh, armMesh, headMesh, haloMesh);

  // тёплые пятна света на асфальте под каждым фонарём — один общий draw call
  const poolTex = poolTexture();
  const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, n);
  const R = 7.5;
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i];
    p.set(x, 0.06, z); q.identity(); s.set(R, 1, R); m.compose(p, q, s);
    poolMesh.setMatrixAt(i, m);
  }
  poolMesh.frustumCulled = false; poolMesh.instanceMatrix.needsUpdate = true; poolMesh.renderOrder = 6.5;
  parent.add(poolMesh);

  return { count: n, poleMesh, armMesh, headMesh, haloMesh, poolMesh };
}
