// Кольцо из 8 инвестиционных вариантов вокруг выбранной станции (режим INVESTMENT): «голограммы»-миниатюры, кликабельные.
import * as THREE from 'three';
import { Assembly } from './assembly.js';
import { addPosts, addCanopy, buildExpansion, buildStorage, buildGridUpgrade, buildLocalGen, buildPilot, buildPreparedSite } from './options3d.js';
import { OPTION_LIST, OPTIONS } from '../simulation/params.js';

const RADIUS = 78;
const MINI = 0.42;

function miniFor(id) {
  // возвращает [Assembly, центр(локальный)] для миниатюры
  switch (id) {
    case 'new_station': { const A = new Assembly(); addCanopy(A, 0, 6, true); addPosts(A, 0, 6, true); return [A, [-12.5, 0, 0]]; }
    case 'expansion': return [buildExpansion(6, 6), [-4, 0, 0]];
    case 'storage': return [buildStorage(2), [18.6, 0, -11.3]];
    case 'grid_upgrade': return [buildGridUpgrade(), [-16.5, 0, -11]];
    case 'local_gen': return [buildLocalGen(), [3, 0, 6]];
    case 'defer': return [buildPreparedSite(26, 18), [0, 0, 0]];
    case 'pilot': return [buildPilot(), [-22.5, 0, 9.2]];
    default: return [null, [0, 0, 0]];
  }
}

export class OptionRing {
  constructor(parent, ctx) {
    this.ctx = ctx; this.group = new THREE.Group(); this.group.visible = false; parent.add(this.group);
    this.pods = {}; this.pickables = [];
    const kit = ctx.kit;
    OPTION_LIST.forEach((o, i) => {
      const pod = new THREE.Group(); pod.userData = { kind: 'pod', option: o.id };
      const base = new THREE.Mesh(new THREE.CylinderGeometry(13, 14.5, 1.2, 40), new THREE.MeshBasicMaterial({ color: '#181a24', transparent: true, opacity: 0.86 }));
      base.position.y = 0.6;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(13.6, 0.35, 6, 64), new THREE.MeshBasicMaterial({ color: o.color }));
      rim.rotation.x = Math.PI / 2; rim.position.y = 1.3;
      const [A, c] = miniFor(o.id);
      let model = null;
      if (A) {
        model = A.build((r) => kit.mat(r === 'led' ? 'accent' : r, 'built'));
        kit.apply(model, 'preview');
        const wrap = new THREE.Group(); wrap.add(model); model.position.set(-c[0], 0, -c[2]);
        wrap.scale.setScalar(MINI); wrap.position.y = 1.2;
        pod.add(wrap); model = wrap;
      } else {
        // NO INVESTMENT — «перечёркнутая» площадка
        const g = new THREE.Group();
        const bar = new THREE.MeshBasicMaterial({ color: '#8b8f9c' });
        const a = new THREE.Mesh(new THREE.BoxGeometry(16, 0.8, 1.6), bar), b = a.clone();
        a.rotation.y = Math.PI / 4; b.rotation.y = -Math.PI / 4; a.position.y = b.position.y = 3;
        g.add(a, b); g.position.y = 1.2; pod.add(g); model = g;
      }
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 30, 16), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 14; hit.userData = { kind: 'pod', option: o.id };
      pod.add(base, rim, hit);
      const ang = -Math.PI / 2 + (i / 8) * Math.PI * 2;
      pod.position.set(Math.cos(ang) * RADIUS, 0, Math.sin(ang) * RADIUS);
      this.group.add(pod); this.pickables.push(hit);
      this.pods[o.id] = { pod, base, rim, model, hit, opt: o, ang, hover: false, active: false };
    });
    // связующее кольцо
    const ring = new THREE.Mesh(new THREE.RingGeometry(RADIUS - 0.5, RADIUS + 0.5, 96), new THREE.MeshBasicMaterial({ color: '#8b7bff', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.4; this.group.add(ring);
    this.link = ring;
  }
  show(station) {
    this.group.visible = !!station;
    if (!station) return;
    this.group.position.set(station.pos.x, 0, station.pos.z);
    this.group.rotation.y = 0;
  }
  /** selected: Set<optionId>; hover: optionId|null; recommended: Set */
  setState(selected, hover, recommended) {
    const kit = this.ctx.kit;
    for (const [id, p] of Object.entries(this.pods)) {
      const active = selected.has(id), hov = hover === id;
      if (p.model && (p.active !== active || p.hover !== hov)) kit.apply(p.model, active ? 'hi' : 'preview');
      p.rim.material.color.set(active ? '#ffffff' : p.opt.color);
      p.rim.scale.setScalar(hov ? 1.06 : 1);
      p.base.material.opacity = active ? 0.98 : hov ? 0.94 : 0.86;
      p.active = active; p.hover = hov;
      p.recommended = recommended?.has(id);
    }
  }
  update(dt, t) {
    for (const p of Object.values(this.pods)) {
      if (p.model) p.model.rotation.y += dt * (p.active ? 0.9 : 0.35);
      p.pod.position.y = Math.sin(t * 1.6 + p.ang * 3) * 0.5 + (p.hover ? 1.4 : 0);
    }
  }
  podWorld(id, y = 26) { const p = this.pods[id]; return p.pod.localToWorld(new THREE.Vector3(0, y, 0)); }
}
