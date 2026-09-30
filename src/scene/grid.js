// Энергосистема (режим GRID): подземные узлы, кабельные трассы с бегущими импульсами, «столбики» допустимой и желаемой мощности,
// точки подключения ЭЗС, а также маркеры подстанций на поверхности. ВСЕ мощности — сценарные допущения, не инженерные данные.
import * as THREE from 'three';
import { geo } from '../data/geo.js';
import { makeFlowMaterial, makeGlowMaterial, makeRoadMaterial, PAL } from './materials.js';
import { RibbonBuf, addRibbon } from './roads.js';
import { Path } from './traffic.js';

export const NODE_COL = { ok: '#59d8e6', warn: '#ffb83d', constraint: '#e2d9ff' };
const MW_H = 6.5;         // высота 1 МВт на столбике, м
const VAULT_Y = -15;

function tube(a, b, color, r = 0.5) {
  const d = new THREE.Vector3().subVectors(b, a); const L = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 8, 1, false), new THREE.MeshBasicMaterial({ color }));
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}
const manhattan = (a, b, y) => [[a.x, y, a.z], [b.x, y, a.z], [b.x, y, b.z]];

export class GridView {
  constructor(ds, graph, parent) {
    this.ds = ds; this.graph = graph;
    this.group = new THREE.Group(); this.group.visible = false; parent.add(this.group);
    this.surface = new THREE.Group(); parent.add(this.surface);     // маркеры подстанций видны всегда
    this.nodes = {}; this.cables = []; this.risers = []; this.pickables = [];
    this._buildUpstream();
    this._buildNodes();
    this._buildFeeders();
    this._buildMetro();
    this.setLayerBoost(0);
  }

  _buildUpstream() {
    this.up = {};
    for (const u of this.ds.upstream) {
      const g = new THREE.Group(); g.position.set(u.x, VAULT_Y - 6, u.z);
      const box = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 20), new THREE.MeshBasicMaterial({ color: '#6d6ff2', transparent: true, opacity: 0.16, depthWrite: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: '#a7a2ff', transparent: true, opacity: 0.9 }));
      g.add(box, edges);
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(3.2, 0), new THREE.MeshBasicMaterial({ color: u.kind === 'generation' ? '#ffb83d' : '#a7a2ff' }));
      g.add(core); this.group.add(g); this.up[u.id] = { def: u, group: g, core };
    }
  }

  _buildNodes() {
    for (const n of this.ds.nodes) {
      const g = new THREE.Group(); g.position.set(n.pos.x, 0, n.pos.z);
      // хранилище/вольт: полупрозрачный бокс с рёбрами
      const vault = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 16), new THREE.MeshBasicMaterial({ color: '#59d8e6', transparent: true, opacity: 0.14, depthWrite: false }));
      vault.position.y = VAULT_Y;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(vault.geometry), new THREE.LineBasicMaterial({ color: '#59d8e6', transparent: true, opacity: 0.95 }));
      edges.position.y = VAULT_Y;
      // трансформаторы внутри
      const trafoMat = new THREE.MeshBasicMaterial({ color: '#2b3c4d' });
      for (const dx of [-6, 0, 6]) { const t = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 5), trafoMat); t.position.set(dx, VAULT_Y - 1.2, 0); const e = new THREE.LineSegments(new THREE.EdgesGeometry(t.geometry), new THREE.LineBasicMaterial({ color: '#7fdff0' })); e.position.copy(t.position); g.add(t, e); }
      // столбики: допустимая (H) и желаемая (D) мощность, отсчёт от потолка узла
      const barGeo = new THREE.BoxGeometry(3.6, 1, 3.6); barGeo.translate(0, 0.5, 0);
      const H = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: '#59d8e6', transparent: true, opacity: 0.35, depthWrite: false }));
      const D = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: '#59d8e6', transparent: true, opacity: 0.85 }));
      const U = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }));
      H.position.set(-9.5, VAULT_Y + 4.5, 7); D.position.set(-9.5, VAULT_Y + 4.5, 7); U.position.set(-13.5, VAULT_Y + 4.5, 7);
      const hEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.8, 1, 3.8).translate(0, 0.5, 0)), new THREE.LineBasicMaterial({ color: '#59d8e6' }));
      hEdges.position.copy(H.position);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.25, 6.4), new THREE.MeshBasicMaterial({ color: '#ffffff' })); // отметка допустимого уровня
      cap.position.set(-9.5, VAULT_Y + 4.5, 7);
      // накопитель (значок) появляется, если построен
      const batt = new THREE.Group();
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.4, 5, 3.4), new THREE.MeshBasicMaterial({ color: '#ffb83d', transparent: true, opacity: 0.85 })); b.position.set(i * 4.4 - 4.4, VAULT_Y + 8.4, -5.5); batt.add(b, new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), new THREE.LineBasicMaterial({ color: '#ffe3a6' })).translateX(i * 4.4 - 4.4).translateY(VAULT_Y + 8.4).translateZ(-5.5)); }
      batt.visible = false;
      const upg = new THREE.Group();
      const ut = new THREE.Mesh(new THREE.BoxGeometry(5, 6, 5), new THREE.MeshBasicMaterial({ color: '#7aa7ff', transparent: true, opacity: 0.85 })); ut.position.set(11.5, VAULT_Y + 0.5, 0);
      upg.add(ut, new THREE.LineSegments(new THREE.EdgesGeometry(ut.geometry), new THREE.LineBasicMaterial({ color: '#cfe0ff' })).translateX(11.5).translateY(VAULT_Y + 0.5)); upg.visible = false;
      // вертикальная связь узла с поверхностью
      const rise = tube(new THREE.Vector3(0, VAULT_Y + 4.5, 0), new THREE.Vector3(0, 0.3, 0), '#59d8e6', 0.55);
      const beamMat = makeGlowMaterial(NODE_COL.ok, { height: 60, alpha: 0.6 });
      const beamGeo = new THREE.CylinderGeometry(0.6, 1.2, 46, 10, 1, true); beamGeo.translate(0, 23, 0);
      const beam = new THREE.Mesh(beamGeo, beamMat); beam.renderOrder = 40;
      const gem = new THREE.Mesh(new THREE.TetrahedronGeometry(2.6), new THREE.MeshBasicMaterial({ color: NODE_COL.ok })); gem.position.y = 50;
      // контур подстанции OSM на поверхности
      let outline = null;
      if (n.poly && n.poly.length >= 6) {
        const buf = new RibbonBuf(); const f = [...n.poly, n.poly[0], n.poly[1]].map((v, i) => (i % 2 === 0 ? v - n.pos.x : v - n.pos.z));
        addRibbon(buf, f, null, 1.4, 0.55);
        const ol = new THREE.Mesh(buf.geometry(), new THREE.MeshBasicMaterial({ color: NODE_COL.ok, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -60 }));
        ol.renderOrder = 45; outline = ol;
      }
      const hit = new THREE.Mesh(new THREE.BoxGeometry(34, 30, 26), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 6; hit.userData = { kind: 'node', id: n.id };
      this.pickables.push(hit);
      const under = new THREE.Group(); under.add(vault, edges, H, hEdges, D, U, cap, batt, upg, rise, ...g.children);
      g.children.slice().forEach(c => g.remove(c));
      g.add(under);
      const surf = new THREE.Group(); surf.position.set(n.pos.x, 0, n.pos.z);
      surf.add(beam, gem, hit); if (outline) surf.add(outline);
      this.group.add(g); this.surface.add(surf);
      this.nodes[n.id] = { def: n, group: g, under, surf, vault, edges, H, D, U, hEdges, cap, batt, upg, beamMat, gem, outline, rise, trafoMat };
    }
  }

  _buildFeeders() {
    const g = this.graph;
    const flowMat = (c, s = 0.8) => makeFlowMaterial(c, { speed: s, dash: 22, core: 0.6, alpha: 1.0, depthTest: false });
    const addPath = (pts, width, color, meta, speed) => {
      const flat = [], ys = [];
      for (const p of pts) { flat.push(p[0], p[2]); ys.push(p[1]); }
      const buf = new RibbonBuf(); addRibbon(buf, flat, ys, width, 0);
      const mat = flowMat(color, speed);
      const m = new THREE.Mesh(buf.geometry(), mat); m.frustumCulled = false; m.renderOrder = 60;
      this.group.add(m);
      this.cables.push({ mesh: m, mat, meta });
      return m;
    };
    // магистральные связи (условно): источники → узлы
    for (const u of this.ds.upstream) for (const nid of u.feeds) {
      const n = this.ds.nodeById[nid]; if (!n) continue;
      addPath(manhattan({ x: u.x, z: u.z }, n.pos, -19), 2.6, '#8f8bff', { kind: 'trunk', from: u.id, to: nid }, 0.55);
    }
    // связь между узлами
    const N = this.ds.nodes;
    [[0, 1], [1, 2]].forEach(([a, b]) => { if (N[a] && N[b]) addPath(manhattan(N[a].pos, N[b].pos, -17), 2.2, '#8f8bff', { kind: 'trunk', from: N[a].id, to: N[b].id }, 0.5); });
    // фидеры узел → станция по улицам
    this.feeder = {};
    for (const st of this.ds.stations) {
      const n = this.ds.nodeById[st.node];
      const a = g.nearest(n.pos.x, n.pos.z, 300), b = g.nearest(st.pos.x + st.pos.fx * 14, st.pos.z + st.pos.fz * 14, 300);
      let pts = null;
      if (a >= 0 && b >= 0 && a !== b) { const r = g.route(a, b); if (r) pts = g.polyline(r, a).map(p => [p[0], -7.5, p[2]]); }
      if (!pts) pts = manhattan(n.pos, st.pos, -7.5);
      pts.unshift([n.pos.x, -7.5, n.pos.z]); pts.push([st.pos.x, -7.5, st.pos.z]);
      const path = new Path(pts);
      const cab = addPath(pts, 1.9, '#59d8e6', { kind: 'feeder', node: n.id, station: st.id }, 0.8);
      this.feeder[st.id] = { path, cab };
      // точка подключения на станции: вертикальный стояк + кольцо
      const riser = tube(new THREE.Vector3(st.pos.x, -7.5, st.pos.z), new THREE.Vector3(st.pos.x, 0.4, st.pos.z), '#59d8e6', 0.5);
      this.group.add(riser);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.4, 24), new THREE.MeshBasicMaterial({ color: '#59d8e6', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(st.pos.x, 0.5, st.pos.z);
      this.group.add(ring);
      this.risers.push({ riser, ring, id: st.id });
    }
  }

  _buildMetro() {
    const buf = new RibbonBuf();
    for (const r of geo.data.rail) if (r[0] === 1 && !r[2].some(isNaN)) addRibbon(buf, r[2], null, 7, -28);
    if (!buf.n) return;
    const m = new THREE.Mesh(buf.geometry(), new THREE.MeshBasicMaterial({ color: '#3a3f63', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    m.renderOrder = 55; m.frustumCulled = false; this.group.add(m);
  }

  /** Обновление по состоянию сети. */
  setSim(state, time = 0) {
    this.state = state;
    const c = new THREE.Color();
    for (const [id, nv] of Object.entries(this.nodes)) {
      const n = state.nodes[id]; if (!n) continue;
      const col = NODE_COL[n.status] || NODE_COL.ok;
      // столбики
      nv.H.scale.y = Math.max(0.2, n.H * MW_H); nv.hEdges.scale.y = nv.H.scale.y;
      const dScale = Math.max(0.2, n.desired * MW_H); nv.D.scale.y = dScale;
      nv.cap.position.y = VAULT_Y + 4.5 + n.H * MW_H;
      nv.U.scale.y = Math.max(0.2, n.used * MW_H);
      nv.D.material.color.set(n.status === 'constraint' ? '#ff4d5e' : n.status === 'warn' ? '#ffb83d' : '#59d8e6');
      nv.beamMat.uniforms.uColor.value.set(col); nv.gem.material.color.set(col); if (nv.outline) nv.outline.material.color.set(col);
      nv.beamMat.uniforms.uPulse.value = n.status === 'constraint' ? 1.6 : 0.3;
      nv.vault.material.color.set(col); nv.edges.material.color.set(col);
      nv.batt.visible = n.storage > 0; nv.upg.visible = n.upgrade > 0;
      nv.status = n.status;
    }
    // кабели: цвет/скорость по загрузке узла
    for (const cab of this.cables) {
      const m = cab.meta;
      if (m.kind === 'feeder') {
        const n = state.nodes[m.node]; const st = state.byId[m.station]; if (!n) continue;
        const u = n.usedUtil ?? n.util; const dem = Math.max(n.util, st ? st.load * 0.9 : 0);
        c.set('#59d8e6').lerp(new THREE.Color('#ffb83d'), Math.min(1, Math.max(0, (dem - 0.55) / 0.4))).lerp(new THREE.Color('#ff4d5e'), Math.min(1, Math.max(0, (n.util - 0.95) / 0.5)));
        cab.mat.uniforms.uColor.value.copy(c);
        cab.mat.uniforms.uSpeed.value = 0.6 + 1.6 * Math.min(1.6, dem);
        cab.mat.uniforms.uAlpha.value = 0.55 + 0.6 * Math.min(1.3, dem);
      }
    }
    for (const r of this.risers) {
      const st = state.byId[r.id]; const n = st && state.nodes[st.node];
      if (n) { const col = n.status === 'constraint' ? '#ff4d5e' : n.status === 'warn' ? '#ffb83d' : '#59d8e6'; r.ring.material.color.set(col); r.riser.material.color.set(col); }
    }
  }
  setLayerBoost(k) { this.boost = k; }
  update(dt, t, gridMix) {
    this.group.visible = gridMix > 0.01;
    for (const nv of Object.values(this.nodes)) {
      nv.gem.rotation.y += dt * 1.6; nv.gem.rotation.x += dt * 0.6;
      if (nv.status === 'constraint') { const on = Math.floor(t * 3) % 2 === 0; nv.edges.material.color.set(on ? '#ff4d5e' : '#e2d9ff'); }
    }
    for (const u of Object.values(this.up)) u.core.rotation.y += dt;
  }
  worldNodeAnchor(id, y = 30) { const n = this.ds.nodeById[id]; return new THREE.Vector3(n.pos.x, y, n.pos.z); }
  worldNodeVault(id) { const n = this.ds.nodeById[id]; return new THREE.Vector3(n.pos.x, VAULT_Y, n.pos.z); }
}
