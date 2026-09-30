// Плита территории: базовая земля, землепользование (жилая/деловая/промзона/парки), Москва-река, разрез грунта.
import * as THREE from 'three';
import { geo } from '../data/geo.js';
import { makeGroundMaterial, makeLayerMaterial, makeWaterMaterial, makeSlabMaterial, PAL } from './materials.js';
import { RibbonBuf, addRibbon } from './roads.js';

const V2 = THREE.Vector2;
export const SLAB_DEPTH = 70;

function toV2(flat) { const a = []; for (let i = 0; i < flat.length; i += 2) a.push(new V2(flat[i], flat[i + 1])); return a; }

/** Триангуляция контура с дырами → массивы position/color (плоский слой y=0). */
function pushPoly(P, C, outer, holes, color, y = 0) {
  const contour = toV2(outer);
  const hs = holes.map(toV2);
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = contour.concat(...hs);
  for (const t of tris) {
    let [a, b, c] = t;
    const pa = all[a], pb = all[b], pc = all[c];
    const ny = (pb.y - pa.y) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.y - pa.y);
    if (ny < 0) { const tmp = b; b = c; c = tmp; }
    for (const k of [a, b, c]) { P.push(all[k].x, y, all[k].y); C.push(color.r, color.g, color.b); }
  }
}

export function buildTerrain() {
  const { halfW, halfH } = geo.meta;
  const group = new THREE.Group();

  // базовая плита
  const gg = new THREE.PlaneGeometry(halfW * 2, halfH * 2); gg.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(gg, makeGroundMaterial(halfW, halfH));
  ground.renderOrder = 0; ground.userData.isGround = true;
  group.add(ground);

  // землепользование по категориям (собственный polygonOffset у каждой)
  const order = [1, 2, 3, 4, 8, 5, 6, 9, 7, 10];
  const byCat = new Map(order.map(c => [c, { P: [], C: [] }]));
  const tmp = new THREE.Color();
  let seedI = 0;
  for (const l of geo.data.land) {
    const [cat, outer, holes] = l;
    const b = byCat.get(cat); if (!b) continue;
    tmp.set(PAL.land[cat]);
    const v = 0.92 + ((seedI++ * 0.6180339) % 1) * 0.16;
    tmp.multiplyScalar(v);
    pushPoly(b.P, b.C, outer, holes || [], tmp);
  }
  order.forEach((cat, i) => {
    const b = byCat.get(cat);
    if (!b.P.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.P, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(b.C, 3));
    const noise = (cat === 5 || cat === 6 || cat === 9 || cat === 10) ? 0.55 : 0.18;
    const m = new THREE.Mesh(g, makeLayerMaterial(-(i + 1), 0.16, noise));
    m.renderOrder = 1 + i * 0.01; m.frustumCulled = false; m.userData.landCat = cat;
    group.add(m);
  });

  // вода + набережные
  const WP = [], WC = [];
  const wc = new THREE.Color(PAL.water);
  const shore = new RibbonBuf();
  const nearEdge = (x, z) => Math.abs(Math.abs(x) - halfW) < 1.2 || Math.abs(Math.abs(z) - halfH) < 1.2;
  for (const w of geo.data.water) {
    pushPoly(WP, WC, w.o, w.h || [], wc);
    for (const ring of [w.o, ...(w.h || [])]) {
      const n = ring.length / 2;
      let run = [];
      const flush = () => { if (run.length >= 4) addRibbon(shore, run, null, 4.2, 0.02); run = []; };
      for (let i = 0; i <= n; i++) {
        const j = i % n, k = (i + 1) % n;
        const x = ring[j * 2], z = ring[j * 2 + 1], x2 = ring[k * 2], z2 = ring[k * 2 + 1];
        if (i < n && nearEdge(x, z) && nearEdge(x2, z2)) { flush(); continue; }
        run.push(x, z);
      }
      flush();
    }
  }
  if (WP.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(WP, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(WC, 3));
    const m = new THREE.Mesh(g, makeWaterMaterial(-12));
    m.renderOrder = 2; m.frustumCulled = false; m.userData.isWater = true;
    group.add(m);
    if (shore.n) {
      const sm = new THREE.Mesh(shore.geometry(), makeLayerMaterialShore());
      sm.renderOrder = 2.5; sm.frustumCulled = false; group.add(sm);
    }
  }

  // разрез грунта
  const sm = makeSlabMaterial();
  const mkSide = (w, x, z, ry) => {
    const g = new THREE.PlaneGeometry(w, SLAB_DEPTH);
    const m = new THREE.Mesh(g, sm);
    m.position.set(x, -SLAB_DEPTH / 2, z); m.rotation.y = ry; m.renderOrder = 0.5;
    group.add(m);
  };
  mkSide(halfW * 2, 0, halfH, 0);
  mkSide(halfW * 2, 0, -halfH, Math.PI);
  mkSide(halfH * 2, -halfW, 0, -Math.PI / 2);
  mkSide(halfH * 2, halfW, 0, Math.PI / 2);
  const bg = new THREE.PlaneGeometry(halfW * 2, halfH * 2); bg.rotateX(Math.PI / 2);
  const bottom = new THREE.Mesh(bg, sm); bottom.position.y = -SLAB_DEPTH; group.add(bottom);

  return { group, ground };
}

function makeLayerMaterialShore() {
  const m = makeLayerMaterial(-13, 0.2, 0);
  return m;
}

/** Регион-подписи: центроиды именованных территорий (реальные названия OSM). */
export function namedAreas() {
  const out = [];
  for (const l of geo.data.land) {
    if (!l[3]) continue;
    const f = l[1]; let x = 0, z = 0; const n = f.length / 2;
    for (let i = 0; i < f.length; i += 2) { x += f[i]; z += f[i + 1]; }
    out.push({ cat: l[0], name: l[3], x: x / n, z: z / n });
  }
  return out;
}
