// 3D-станции ЭЗС: навес, посты, автомобили, очередь, световая колонна и кольцо загрузки — всё управляется состоянием симуляции.
import * as THREE from 'three';
import { Assembly } from './assembly.js';
import { carGeometry } from './vehicleGeo.js';
import { makeGlowMaterial, makeVehicleMaterial, PAL } from './materials.js';
import { makeKit, makePadTexture } from './kit.js';
import { addPosts, addCanopy, buildExpansion, buildStorage, buildGridUpgrade, buildLocalGen, buildPilot, buildPreparedSite, postX, MAX_SHOWN_POSTS } from './options3d.js';
import { poolTexture } from './streetlights.js';
import { USER_TYPES } from '../simulation/params.js';

export const STATUS_COL = { low: '#35d08f', mid: '#ffb83d', high: '#ff4d5e', constraint: '#e2d9ff' };
const CAR_COLORS = {
  private_ev: ['#b9c6db', '#8497b8', '#e6e3da', '#56627a', '#9fb7d8'], taxi: ['#ffd23a'], corporate: ['#d9d3ff', '#f1eefc'],
  ebus: ['#6f86ff'], municipal: ['#ff8a3d'],
};
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export class StationView {
  constructor(def, ctx, { isNew = false } = {}) {
    this.def = def; this.ctx = ctx; this.isNew = isNew; this.id = def.id;
    this.group = new THREE.Group();
    this.group.userData = { kind: 'station', id: def.id, isNew };
    this.postsShown = -1; this.status = 'low'; this.load = -1; this.state = null;
    this.addons = {};
    const kit = ctx.kit;

    // площадка
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(51, 29), new THREE.MeshStandardMaterial({ map: ctx.padTex, roughness: 0.95, metalness: 0 }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.12; pad.receiveShadow = false;
    this.group.add(pad); this.pad = pad;

    // цифровое пятно света под навесом — статусный цвет (физический город светится тепло, инфраструктура данных — своим цветом)
    this.poolMat = new THREE.MeshBasicMaterial({ map: poolTexture('120,216,232'), color: STATUS_COL.low, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    const poolGeo = new THREE.PlaneGeometry(def.hero ? 34 : 24, def.hero ? 20 : 15); poolGeo.rotateX(-Math.PI / 2);
    this.pool = new THREE.Mesh(poolGeo, this.poolMat); this.pool.position.set(0, 0.14, 0); this.pool.renderOrder = 6.6;
    this.group.add(this.pool);

    this.ledMat = new THREE.MeshBasicMaterial({ color: STATUS_COL.low });
    this.core = null;

    // hero-детали: фирменная вывеска-тотем и технический шкаф (только для ZIL-01 — самого проработанного объекта демо)
    if (def.hero) {
      const kitH = ctx.kit;
      const A = new Assembly();
      const sx = -27.5, sz = -8.4;
      A.box('steel', sx, 1.55, sz, 0.28, 3.1, 0.28);
      A.box('dark', sx, 2.55, sz, 2.6, 1.55, 0.12);
      A.box('sign', sx, 2.55, sz + 0.09, 2.3, 1.2, 0.03);
      A.box('accent', sx, 1.86, sz + 0.09, 2.3, 0.08, 0.03);
      // технический шкаф у колонны
      A.box('containerDark', sx + 3.2, 0.75, sz + 0.6, 0.9, 1.5, 0.7);
      A.box('amber', sx + 3.2, 1.32, sz + 0.96, 0.16, 0.16, 0.03);
      A.box('dark', sx + 3.2, 0.7, sz + 0.96, 0.5, 0.5, 0.03);
      const heroGrp = A.build((role) => kitH.mat(role, 'built'));
      this.group.add(heroGrp);
      this.heroSign = heroGrp;
    }

    // автомобили на станции (инстансы)
    this.cars = new THREE.InstancedMesh(ctx.carGeo, ctx.vehicleMat, 34);
    this.cars.frustumCulled = false; this.cars.count = 0;
    this.cars.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(34 * 3), 3);
    this.group.add(this.cars);

    // световая колонна, метка, кольцо загрузки
    const H = def.hero ? 96 : 70;
    this.beamMat = makeGlowMaterial(STATUS_COL.low, { height: H, alpha: 0.75 });
    const beamGeo = new THREE.CylinderGeometry(0.7, 1.6, H, 12, 1, true); beamGeo.translate(0, H / 2, 0);
    this.beam = new THREE.Mesh(beamGeo, this.beamMat); this.beam.position.set(-12, 0, -11);
    this.beam.renderOrder = 40;
    this.group.add(this.beam);
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(2.4, 0), new THREE.MeshBasicMaterial({ color: STATUS_COL.low }));
    this.gem.position.set(-12, H + 3, -11); this.group.add(this.gem);
    this.ringMat = new THREE.MeshBasicMaterial({ color: STATUS_COL.low, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -40 });
    this.trackMat = new THREE.MeshBasicMaterial({ color: '#ece8de', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -38 });
    const track = new THREE.Mesh(new THREE.RingGeometry(21.2, 22.2, 72), this.trackMat); track.rotation.x = -Math.PI / 2; track.position.y = 0.3;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(21, 22.4, 72, 1, 0, 0.01), this.ringMat); this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.32;
    this.ringGroup = new THREE.Group(); this.ringGroup.add(track, this.ring); this.group.add(this.ringGroup);

    // «попадание» для выбора
    const hit = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 36), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(-2, 15, 0); hit.userData = { kind: 'station', id: def.id };
    this.hit = hit; this.group.add(hit);

    this.tag = isNew ? 'NEW' : '';
    this.rebuildCore(Math.min(def.posts, MAX_SHOWN_POSTS));
  }

  place(pos) { this.group.position.set(pos.x, 0, pos.z); this.group.rotation.y = pos.rot || 0; }

  rebuildCore(n) {
    if (this.core) { this.group.remove(this.core); this.core.traverse(o => o.geometry?.dispose?.()); }
    const A = new Assembly();
    const nn = Math.max(2, n);
    addCanopy(A, 0, nn, true);
    addPosts(A, 0, nn, this.isNew);
    const getMat = (role) => role === 'led' ? this.ledMat : this.ctx.kit.mat(role, 'built');
    this.core = A.build(getMat);
    this.group.add(this.core);
    this.postsShown = n;
  }

  /** Состояние из симуляции (engine.evaluate → station state). */
  setSim(st, time = 0) {
    this.state = st;
    const pilotBuilt = (st.built?.pilot || 0);
    const coreN = Math.min(MAX_SHOWN_POSTS, Math.max(2, st.posts - pilotBuilt * 2));
    if (coreN !== this.postsShown) this.rebuildCore(coreN);
    const col = STATUS_COL[st.status] || STATUS_COL.low;
    if (st.status !== this.status) {
      this.status = st.status;
      this.beamMat.uniforms.uColor.value.set(col); this.gem.material.color.set(col);
      this.ringMat.color.set(col); this.ledMat.color.set(col); this.poolMat.color.set(col);
      this.beamMat.uniforms.uPulse.value = st.status === 'constraint' ? 1.6 : st.status === 'high' ? 1.0 : 0.2;
      this.beamMat.uniforms.uAlpha.value = st.status === 'low' ? 0.55 : 0.85;
    }
    if (Math.abs(st.load - this.load) > 0.004) {
      this.load = st.load;
      this.ring.geometry.dispose();
      this.ring.geometry = new THREE.RingGeometry(21, 22.4, 72, 1, Math.PI / 2, -Math.max(0.02, Math.PI * 2 * Math.min(1, st.load)));
    }
    this._layoutCars(st);
  }

  _layoutCars(st) {
    const r = rng(this.def.id.split('').reduce((a, c) => a + c.charCodeAt(0) * 31, 7) + Math.round(st.load * 100));
    const mix = this.def.mix || { private_ev: 1 };
    const pick = () => { let t = r(), acc = 0; for (const k of Object.keys(mix)) { acc += mix[k]; if (t <= acc) return k; } return 'private_ev'; };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
    let n = 0;
    const put = (x, z, ry, type) => {
      const arr = CAR_COLORS[type] || CAR_COLORS.private_ev;
      c.set(arr[Math.floor(r() * arr.length)]);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry); p.set(x, 0.12, z);
      m.compose(p, q, s); this.cars.setMatrixAt(n, m); this.cars.setColorAt(n, c); n++;
    };
    const shown = Math.min(MAX_SHOWN_POSTS, Math.max(2, this.postsShown));
    const busy = Math.min(shown, Math.round(Math.min(1, st.served / Math.max(1, st.capPosts)) * shown + 0.001));
    for (let i = 0; i < busy; i++) put(postX(i), -1.05, Math.PI / 2, pick());
    const qn = Math.min(9, st.queueCars);
    for (let i = 0; i < qn; i++) put(22 - i * 5.5, 10.6, Math.PI, pick());
    this.cars.count = n;
    this.cars.instanceMatrix.needsUpdate = true;
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;
  }

  /** Опции: built — построено, pending — в реализации (каркас), preview — голограмма выбранной опции. */
  setAddons({ built = {}, pending = {}, preview = null, pendingPosts = 0 }) {
    const kit = this.ctx.kit;
    const want = (key) => (built[key] > 0 ? 'built' : pending[key] > 0 ? 'building' : preview === key ? 'preview' : null);
    const specs = {
      storage: () => buildStorage(Math.min(4, 2 * Math.max(1, built.storage || pending.storage || 1))),
      grid_upgrade: () => buildGridUpgrade(),
      local_gen: () => buildLocalGen(),
      pilot: () => buildPilot(),
    };
    for (const key of Object.keys(specs)) {
      const st = want(key);
      const cur = this.addons[key];
      const sig = key === 'storage' ? (built.storage || pending.storage || 1) : 1;
      if (!st) { if (cur) cur.group.visible = false; continue; }
      if (!cur || cur.sig !== sig) {
        if (cur) this.group.remove(cur.group);
        const A = specs[key]();
        const grp = A.build((role) => (role === 'led' ? kit.roles.accent : kit.mat(role, 'built')));
        this.group.add(grp);
        this.addons[key] = { group: grp, state: null, sig };
      }
      const a = this.addons[key];
      a.group.visible = true;
      if (a.state !== st) { kit.apply(a.group, st); a.state = st; }
    }
    // расширение: показываем ещё не построенные посты
    const expSt = pendingPosts > 0 ? 'building' : preview === 'expansion' ? 'preview' : null;
    const cur = this.addons.expansion;
    if (!expSt) { if (cur) cur.group.visible = false; }
    else {
      const from = this.postsShown, count = pendingPosts > 0 ? pendingPosts : 6;
      const sig = from + ':' + count;
      if (from >= MAX_SHOWN_POSTS) { if (cur) cur.group.visible = false; }
      else {
        if (!cur || cur.sig !== sig) {
          if (cur) this.group.remove(cur.group);
          const grp = buildExpansion(from, Math.min(count, MAX_SHOWN_POSTS - from)).build((role) => kit.mat(role === 'led' ? 'accent' : role, 'built'));
          this.group.add(grp); this.addons.expansion = { group: grp, state: null, sig };
        }
        const a = this.addons.expansion; a.group.visible = true;
        if (a.state !== expSt) { kit.apply(a.group, expSt); a.state = expSt; }
      }
    }
  }

  update(dt, t) {
    this.gem.rotation.y += dt * 1.4;
    this.gem.position.y += Math.sin(t * 2 + this.def.id.length) * 0.02;
    if (this.status === 'constraint') {
      const on = Math.floor(t * 3.2) % 2 === 0;
      this.ledMat.color.set(on ? '#ffffff' : '#8b7bff');
      this.ringGroup.scale.setScalar(1 + 0.04 * Math.sin(t * 6));
    } else if (this.status === 'high') {
      this.ringGroup.scale.setScalar(1 + 0.035 * Math.sin(t * 3.4));
    } else this.ringGroup.scale.setScalar(1);
  }
  worldAnchor(target = new THREE.Vector3(), y = 12) { return this.group.localToWorld(target.set(-6, y, -2)); }
  dispose() { this.group.parent?.remove(this.group); this.group.traverse(o => { o.geometry?.dispose?.(); }); }
}

/** Площадка-кандидат: подготовленная площадка (DEFER) и призрак новой станции (NEW STATION в реализации / предпросмотр). */
export class SiteView {
  constructor(st, ctx) {
    this.stationId = st.id; this.ctx = ctx;
    this.group = new THREE.Group(); this.group.userData = { kind: 'site', id: st.id };
    this.group.position.set(st.site.x, 0, st.site.z); this.group.rotation.y = st.site.rot || 0;
    this.prepared = null; this.ghost = null; this.pState = null; this.gState = null;
    // маркер потенциальной площадки: тонкий контур
    const kit = ctx.kit;
    const A = new Assembly();
    const w = 36, d = 24;
    for (let x = -w / 2; x < w / 2; x += 4) { A.box('accent', x + 1, 0.16, -d / 2, 2, 0.04, 0.22); A.box('accent', x + 1, 0.16, d / 2, 2, 0.04, 0.22); }
    for (let z = -d / 2; z < d / 2; z += 4) { A.box('accent', -w / 2, 0.16, z + 1, 0.22, 0.04, 2); A.box('accent', w / 2, 0.16, z + 1, 0.22, 0.04, 2); }
    this.marker = A.build((role) => kit.mat(role, 'built'));
    this.marker.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; } });
    this.group.add(this.marker);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 28), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 10; hit.userData = { kind: 'site', id: st.id }; this.group.add(hit); this.hit = hit;
    this.markerVisible = false; this.marker.visible = false;
  }
  set({ prepared = null, ghost = null, showMarker = false }) {
    const kit = this.ctx.kit;
    this.marker.visible = showMarker && !prepared;
    if (prepared) {
      if (!this.prepared) { this.prepared = buildPreparedSite().build((r) => kit.mat(r, 'built')); this.group.add(this.prepared); }
      this.prepared.visible = true;
      if (this.pState !== prepared) { kit.apply(this.prepared, prepared); this.pState = prepared; }
    } else if (this.prepared) this.prepared.visible = false;
    if (ghost) {
      if (!this.ghost) {
        const A = new Assembly(); addCanopy(A, 0, 6, true); addPosts(A, 0, 6, true);
        A.box('concrete', -6, 0.09, 0, 34, 0.1, 22);
        this.ghost = A.build((r) => kit.mat(r === 'led' ? 'accent' : r, 'built')); this.ghost.position.x = 4;
        this.group.add(this.ghost);
      }
      this.ghost.visible = true;
      if (this.gState !== ghost) { kit.apply(this.ghost, ghost); this.gState = ghost; }
    } else if (this.ghost) this.ghost.visible = false;
  }
}

export function makeStationContext() {
  return { kit: makeKit(), padTex: makePadTexture(), carGeo: carGeometry(), vehicleMat: makeVehicleMaterial() };
}
