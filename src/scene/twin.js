// Цифровой двойник: сборка сцены и синхронизация 3D с состоянием приложения и результатами симуляции.
import * as THREE from 'three';
import { geo, polyBounds, polyCentroid } from '../data/geo.js';
import { dataset as ds, findLand } from '../data/dataset.js';
import { createWorld } from './world.js';
import { buildTerrain } from './terrain.js';
import { buildRoads, bridgeHeightAt } from './roads.js';
import { buildBuildings, makeBuildingMesh } from './buildings.js';
import { buildChimneys, buildTrees } from './landmarks.js';
import { buildStreetLights } from './streetlights.js';
import { makePlacer, placeDataset } from './placement.js';
import { StationView, SiteView, makeStationContext, STATUS_COL } from './stations.js';
import { RoadGraph, Traffic } from './traffic.js';
import { GridView } from './grid.js';
import { OptionRing } from './optionRing.js';
import { Labels } from './labels.js';
import { U, setGridMix } from './materials.js';
import { OrbitRig } from '../controls/orbit.js';
import { OPTIONS, OPTION_LIST, USER_TYPES } from '../simulation/params.js';
import { growthAt } from '../simulation/params.js';

const tick = () => new Promise(r => { let d = false; const f = () => { if (!d) { d = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 40); });

export async function createTwin({ canvas, labelsEl, onStep }) {
  const step = async (t, p) => { onStep?.(t, p); await tick(); };
  const world = createWorld(canvas);
  const { scene, camera } = world;

  await step('Рельеф, вода, землепользование', 0.15);
  const terrain = buildTerrain(); scene.add(terrain.group);
  await step('Улицы, мосты, МЦК', 0.3);
  const roads = buildRoads(); scene.add(roads.group);
  await step('Здания и застройка', 0.45);
  const bld = buildBuildings(roads.struct);
  const bm = makeBuildingMesh(bld.buffers); scene.add(bm);
  const placer = makePlacer({ buildingGrid: bld.grid, roadGrid: roads.roadGrid, buildings: bld.list });
  await step('Размещение станций на свободных площадках', 0.58);
  placeDataset(ds, placer);
  await step('Озеленение и ориентиры', 0.66);
  const trees = buildTrees(scene, placer, roads.roadGrid);
  const chim = buildChimneys(scene);
  const lights = buildStreetLights(scene);

  await step('Станции ЭЗС и площадки', 0.74);
  const ctx = makeStationContext();
  const views = new Map(), sites = new Map();
  const stationRoot = new THREE.Group(); scene.add(stationRoot);
  for (const s of ds.stations) {
    const v = new StationView(s, ctx); v.place(s.pos); stationRoot.add(v.group); views.set(s.id, v);
    const sv = new SiteView(s, ctx); stationRoot.add(sv.group); sites.set(s.id, sv);
  }
  const newViews = new Map();

  await step('Транспортные потоки и маршруты', 0.82);
  const graph = new RoadGraph(geo.data.graph);
  const traffic = new Traffic(graph, scene);
  traffic.buildFlows(ds.flows, (id) => ds.byId[id]?.pos);
  await step('Энергосистема (подземный слой)', 0.92);
  const grid = new GridView(ds, graph, scene);
  const ring = new OptionRing(scene, ctx); scene.add(ring.group);
  const labels = new Labels(labelsEl, camera, world);
  const orbit = new OrbitRig(camera, canvas);
  orbit.bounds = { x: geo.meta.halfW, z: geo.meta.halfH };

  const twin = {
    world, scene, camera, orbit, labels, terrain, roads, bld, placer, graph, traffic, grid, ring, views, sites, newViews, ctx, stationRoot, lights,
    ds, sim: null, state: null, layer: 'city', gridTarget: 0, gridMix: 0, hoverOption: null, hoverId: null, time: 0,
    pickables: [], viewShift: 0,
  };

  /* -------------------- подписи -------------------- */
  const distLabel = (id, html, cls, x, z, min, max, y = 0) => labels.add(id, { html, cls, pos: new THREE.Vector3(x, y, z), min, max });
  const named = new Map(geo.data.land.filter(l => l[3]).map(l => [l[3], polyCentroid(l[1])]));
  const nameOf = (q) => { for (const [k, v] of named) if (k.includes(q)) return v; return null; };
  const areaLabels = [
    ['ЗИЛ · редевелопмент', 'Комплексный редевелопмент промзоны ЗИЛ', 'area'],
    ['Тюфелева роща', 'Парк «Тюфелева роща»', 'area park'],
    ['Остров мечты', 'Тематический парк «Остров мечты»', 'area'],
    ['Nagatino i-Land', 'Технопарк Nagatino i-Land', 'area'],
    ['Симоновский', 'Деловой квартал «Симоновский»', 'area'],
    ['ЖК Shagal', 'Жилой квартал Shagal', 'area'],
    ['Кожухово', 'Народный парк "Кожухово"', 'area park'],
  ];
  areaLabels.forEach(([txt, key, cls], i) => { const p = nameOf(key); if (p) labels.add('area-' + i, { html: `<span>${txt}</span>`, cls, pos: new THREE.Vector3(p.x, 6, p.z), min: 500, max: 4200, layers: ['city', 'demand', 'investment', 'future'] }); });
  // река
  const river = geo.data.water.reduce((a, w) => (w.o.length > (a?.o.length || 0) ? w : a), null);
  if (river) {
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < river.o.length; i += 2) if (river.o[i] > -1350 && river.o[i] < -700 && river.o[i + 1] > 250 && river.o[i + 1] < 800) { sx += river.o[i]; sz += river.o[i + 1]; n++; }
    if (n) labels.add('river', { html: '<span>Москва-река</span>', cls: 'area river', pos: new THREE.Vector3(sx / n, 3, sz / n), min: 400, max: 4200, layers: ['city', 'demand', 'investment', 'future'] });
  }
  const poi = geo.data.poi;
  const pl = (arr, q) => arr.find(p => (p.name || '').includes(q));
  const tec = pl(poi.plants, 'ТЭЦ-9'); if (tec) labels.add('tec9', { html: '<span>ТЭЦ-9</span>', cls: 'lm', pos: new THREE.Vector3(tec.x, 75, tec.z), min: 200, max: 2600, layers: ['city', 'demand', 'grid', 'investment', 'future'] });
  const avt = poi.stations.find(s => s.name === 'Автозаводская' && s.x > 600 && s.x < 900); if (avt) labels.add('avt', { html: '<span class="ic">M</span><span>Автозаводская</span>', cls: 'lm metro', pos: new THREE.Vector3(avt.x, 14, avt.z), min: 100, max: 2200 });
  const tp = poi.stations.find(s => s.name === 'Технопарк'); if (tp) labels.add('tp', { html: '<span class="ic">M</span><span>Технопарк</span>', cls: 'lm metro', pos: new THREE.Vector3(tp.x, 14, tp.z), min: 100, max: 2200 });
  const zm = poi.stations.find(s => s.name === 'ЗИЛ' && s.kind === 'metro') || poi.stations.find(s => s.name === 'ЗИЛ'); if (zm) labels.add('zilm', { html: '<span class="ic">M</span><span>ЗИЛ</span>', cls: 'lm metro', pos: new THREE.Vector3(zm.x, 14, zm.z), min: 100, max: 2200 });
  const zmcc = poi.stations.find(s => s.name === 'ЗИЛ' && s.kind === 'mcc'); if (zmcc) labels.add('zilmcc', { html: '<span class="ic mcc">МЦК</span><span>ЗИЛ</span>', cls: 'lm metro mcc', pos: new THREE.Vector3(zmcc.x, 14, zmcc.z), min: 100, max: 2200 });
  const bridge = poi.bridges.find(b => b.name === 'Автозаводский мост'); if (bridge) labels.add('avm', { html: '<span>Автозаводский мост</span>', cls: 'lm road', pos: new THREE.Vector3(bridge.x, 16, bridge.z), min: 100, max: 2400 });

  // подписи улиц — из реальных данных OSM (roads.labels), отсортированы по суммарной длине; ключевые улицы ЗИЛа получают акцент
  const shortenRoad = (n) => n
    .replace(/^улица /i, '').replace(/ улица$/i, ' ул.').replace(/^проспект /i, 'просп. ').replace(/^проезд /i, 'пр-д ')
    .replace(/Третье транспортное кольцо/i, 'ТТК').replace(/(\d)-(й|я) /i, '$1-$2 ');
  const KEY_STREETS = ['Автозаводская улица', 'проспект Лихачёва', '1-й Автозаводский проезд', '1-й Кожуховский проезд', 'Восточная улица'];
  for (const l of roads.labels) {
    const major = KEY_STREETS.includes(l.name) || l.cls <= 1;
    labels.add('rd-' + l.name, {
      html: `<span>${shortenRoad(l.name)}</span>`, cls: 'lm road' + (major ? ' major' : ''),
      pos: new THREE.Vector3(l.x, major ? 9 : 7, l.z),
      min: 0, max: major ? 1900 : 560,
      layers: ['city', 'demand', 'investment', 'future', 'grid'],
    });
  }

  // станции
  for (const s of ds.stations) {
    labels.add('st-' + s.id, { html: '', cls: 'stn', pos: () => views.get(s.id).worldAnchor(new THREE.Vector3(), 76), min: 0, max: 5200, order: 100, onClick: (id) => twin.onLabelClick?.({ kind: 'station', id: s.id }), layers: ['city', 'demand', 'investment', 'future', 'grid'] });
  }
  for (const n of ds.nodes) {
    labels.add('nd-' + n.id, { html: '', cls: 'ndl', pos: () => new THREE.Vector3(n.pos.x, 58, n.pos.z), min: 0, max: 4800, order: 90, onClick: () => twin.onLabelClick?.({ kind: 'node', id: n.id }), layers: ['grid', 'investment'] });
  }
  for (const u of ds.upstream) labels.add('up-' + u.id, { html: `<b>${u.name}</b><span>${u.volt} · OSM</span>`, cls: 'ndl up', pos: new THREE.Vector3(u.x, -28, u.z), min: 0, max: 4200, layers: ['grid'] });
  // подписи вариантов вокруг станции (режим INVESTMENT)
  for (const o of OPTION_LIST) {
    const it = labels.add('pod-' + o.id, { html: `<div class="pn">0${o.n}</div><div class="pc">${o.code}</div>`, cls: 'pod', pos: () => (ring.group.visible ? ring.podWorld(o.id, 30) : null), min: 0, max: 2200, order: 120, layers: ['investment'], onClick: () => twin.onLabelClick?.({ kind: 'pod', option: o.id }) });
    it.el.style.setProperty('--c', o.color);
  }
  const flowLabels = ds.flows.map(f => f.id);

  /* -------------------- синхронизация состояния -------------------- */
  const stationLabelHTML = (st) => {
    const pct = Math.round(st.load * 100);
    const flag = st.status === 'constraint' ? '<em>GRID CONSTRAINT</em>' : st.queueRisk === 'high' ? `<em class="q">очередь ~${Math.round(st.wait)} мин</em>` : '';
    return `<i class="dot"></i><b>${st.id}</b><span class="pct">${pct}%</span>${flag}`;
  };
  const nodeLabelHTML = (n) => {
    const st = n.status === 'constraint' ? 'constraint' : n.status;
    return `<b>${n.id.replace('SUB-', 'ПС ')}</b><span class="mw">${n.desired.toFixed(2)} / ${n.H.toFixed(2)} МВт</span>${n.status === 'constraint' ? '<em>GRID CONSTRAINT</em>' : ''}<small>сценарное допущение</small>`;
  };

  twin.applyState = function (state, sim) {
    this.state = state; this.sim = sim;
    const layer = state.activeLayer;
    // станции существующие
    const previewOpt = state.hoverOption || state.focusOption || null;
    const selSt = state.selectedStation;
    for (const st of sim.stations) {
      if (st.isNew) continue;
      const v = views.get(st.id); if (!v) continue;
      v.setSim(st);
      const pendingPosts = st.pending.filter(p => p.option === 'expansion').reduce((a, p) => a + OPTIONS.expansion.addPosts, 0);
      const pend = {}; for (const p of st.pending) pend[p.option] = (pend[p.option] || 0) + 1;
      const showPrev = (selSt === st.id && layer === 'investment') || (state.previewStation === st.id);
      v.setAddons({ built: st.built, pending: pend, pendingPosts, preview: showPrev && previewOpt !== 'new_station' && previewOpt !== 'defer' && previewOpt !== 'none' ? previewOpt : null });
      labels.setHTML('st-' + st.id, stationLabelHTML(st));
      labels.setClass('st-' + st.id, `stn s-${st.status}${ds.byId[st.id].hero ? ' hero' : ''}${selSt === st.id ? ' sel' : ''}`);
      // площадка
      const sv = sites.get(st.id);
      const anchorNew = sim.stations.filter(x => x.isNew && x.anchor === st.id).length > 0;
      const pendingNew = st.pending.some(p => p.option === 'new_station');
      const prepared = st.prepared ? 'built' : null;
      const ghost = anchorNew ? null : pendingNew ? 'building' : (showPrev && previewOpt === 'new_station') ? 'preview' : null;
      const prepPrev = !prepared && showPrev && previewOpt === 'defer' ? 'preview' : prepared;
      sv.set({ prepared: prepPrev, ghost, showMarker: layer === 'investment' && selSt === st.id });
    }
    // новые станции (построенные)
    const alive = new Set();
    for (const st of sim.stations) {
      if (!st.isNew) continue;
      alive.add(st.id);
      let v = newViews.get(st.id);
      if (!v) {
        const def = { ...st.def, hero: false };
        v = new StationView(def, ctx, { isNew: true }); const a = ds.byId[st.anchor]; v.place(a.site); stationRoot.add(v.group); newViews.set(st.id, v);
        labels.add('st-' + st.id, { html: '', cls: 'stn', pos: () => v.worldAnchor(new THREE.Vector3(), 70), min: 0, max: 5200, order: 100, onClick: () => twin.onLabelClick?.({ kind: 'station', id: st.id }), layers: ['city', 'demand', 'investment', 'future', 'grid'] });
      }
      v.setSim(st);
      labels.setHTML('st-' + st.id, `<i class="dot"></i><b>${st.id}</b><span class="pct">${Math.round(st.load * 100)}%</span><em class="new">новая</em>`);
      labels.setClass('st-' + st.id, `stn s-${st.status} newst${selSt === st.id ? ' sel' : ''}`);
    }
    for (const [id, v] of newViews) if (!alive.has(id)) { v.dispose(); newViews.delete(id); labels.remove('st-' + id); }

    // сеть
    grid.setSim(sim);
    for (const n of Object.values(sim.nodes)) labels.setHTML('nd-' + n.id, nodeLabelHTML(n)), labels.setClass('nd-' + n.id, `ndl n-${n.status}${state.selectedNode === n.id ? ' sel' : ''}`);

    // потоки: интенсивность растёт с ростом парка и перегрузкой станции назначения
    const F = sim.F;
    const map = {};
    for (const f of ds.flows) {
      const st = sim.byId[f.to]; const boost = st ? 1 + 0.9 * Math.max(0, st.rho - 0.75) : 1;
      map[f.id] = (0.55 + 0.45 * ((F - 1) * f.growth + 1)) * boost * 0.9;
    }
    traffic.setIntensities(map);
    traffic.setAmbient(200 + 70 * Math.min(3, F - 1), Math.min(0.72, 0.1 + 0.15 * (F - 1)));
    traffic.setLayer(layer);
    traffic.highlight(state.selectedFlow);

    // кольцо опций
    const selected = new Set();
    const cur = state.decisions.find(d => d.station === selSt && d.year === state.year);
    if (cur) cur.options.forEach(o => selected.add(o));
    ring.show(layer === 'investment' && selSt ? ds.byId[selSt] : null);
    ring.setState(selected, state.hoverOption, state.recommended ? new Set(state.recommended) : null);
    const recSet = state.recBest ? new Set(state.recBest) : new Set();
    for (const o of OPTION_LIST) labels.setClass('pod-' + o.id, `pod${selected.has(o.id) ? ' on' : ''}${recSet.has(o.id) ? ' rec' : ''}`);

    // слой
    this.setLayer(layer);
  };

  twin.setLayer = function (layer) {
    if (this.layer !== layer) {
      const was = this.layer; this.layer = layer;
      this.gridTarget = layer === 'grid' ? 1 : 0;
      orbit.limits.maxPol = layer === 'grid' ? 1.9 : 1.5;
      orbit.limits.minY = layer === 'grid' ? -55 : 1.5;
      world.setFogDensity(layer === 'grid' ? 0.00008 : 0.00013);
      document.getElementById('app').dataset.layer = layer;
    }
  };

  twin.frame = function (dt, walk) {
    this.time += dt; U.uTime.value = this.time;
    // плавный переход режима GRID
    const k = 1 - Math.exp(-dt * 4.5);
    this.gridMix += (this.gridTarget - this.gridMix) * k;
    if (Math.abs(this.gridMix - this.gridTarget) < 0.002) this.gridMix = this.gridTarget;
    setGridMix(this.gridMix);
    // фонари и пятна света приглушаются вместе с городом в режиме GRID, чтобы не спорить с подсветкой данных
    if (lights.count) {
      const k2 = 1 - this.gridMix * 0.55;
      lights.haloMesh.material.opacity = 0.26 * k2; lights.poolMesh.material.opacity = 0.5 * k2;
    }
    if (!walk?.active) orbit.update(dt);
    world.sky.position.copy(camera.position);
    for (const v of views.values()) v.update(dt, this.time);
    for (const v of newViews.values()) v.update(dt, this.time);
    traffic.update(dt);
    grid.update(dt, this.time, this.gridMix);
    ring.update(dt, this.time);
    labels.update(this.layer, { shift: this.viewShift });
    world.renderer.render(scene, camera);
  };

  /* -------------------- выбор объектов -------------------- */
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  twin.pick = function (clientX, clientY, opts = {}) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return this._pickRay(ray, opts);
  };
  twin.pickCenter = function (maxDist = 45) {
    ndc.set(0, 0); ray.setFromCamera(ndc, camera); ray.far = maxDist;
    const res = this._pickRay(ray, {}); ray.far = Infinity; return res;
  };
  twin._pickRay = function (ray, opts) {
    const targets = [];
    for (const v of views.values()) targets.push(v.hit);
    for (const v of newViews.values()) targets.push(v.hit);
    for (const n of grid.pickables) targets.push(n);
    for (const s of sites.values()) if (this.layer === 'investment' || this.layer === 'city') targets.push(s.hit);
    if (this.layer === 'investment' && ring.group.visible) targets.push(...ring.pickables);
    if (this.layer !== 'grid') targets.push(...traffic.pickables);
    const hits = ray.intersectObjects(targets, false);
    if (!hits.length) return null;
    // приоритет: pod > station > node > site > flow
    const prio = { pod: 0, station: 1, node: 2, site: 3, flow: 4 };
    hits.sort((a, b) => (prio[a.object.userData.kind] - prio[b.object.userData.kind]) || a.distance - b.distance);
    const h = hits[0];
    return { ...h.object.userData, point: h.point, distance: h.distance };
  };

  /** Положение цели (для перелётов камеры). */
  twin.stationPos = (id) => { const s = ds.byId[id] || (twin.sim?.byId?.[id] && ds.byId[twin.sim.byId[id].anchor]?.site); const p = s?.pos || s; return new THREE.Vector3(p.x, 0, p.z); };
  twin.groundY = (x, z) => bridgeHeightAt(roads.bridgeGrid, x, z);

  // первоначальный кадр: ЗИЛ, река, магистрали и часть skyline видны без движения камеры
  orbit.snap({ tx: 640, ty: 0, tz: 200, dist: 2150, az: -0.58, pol: 1.01 });
  return twin;
}
