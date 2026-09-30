// Материалы «конструктора» станций и опций: built / building (каркас) / preview (голограмма).
import * as THREE from 'three';
import { makeHoloMaterial, PAL } from './materials.js';

export function makeKit() {
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...o });
  const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
  const roles = {
    steel: std('#9aa1b6', { metalness: 0.12, roughness: 0.5 }),
    dark: std('#2c303b', { roughness: 0.7, metalness: 0.05 }),
    concrete: std('#3b3e48', { roughness: 0.95, metalness: 0 }),
    hatch: std('#4a4d59', { roughness: 0.95, metalness: 0 }),
    post: std('#e9e5da', { roughness: 0.45, metalness: 0.1 }),
    canopy: std('#3a3f4e', { metalness: 0.1, roughness: 0.55 }),
    container: std('#e4e7ee', { roughness: 0.6, metalness: 0.05 }),
    containerDark: std('#3a3f4d', { roughness: 0.6 }),
    solar: std('#1a2a5c', { metalness: 0.3, roughness: 0.3, emissive: '#0d1a45', emissiveIntensity: 0.9 }),
    trafo: std('#a3acbb', { metalness: 0.12, roughness: 0.55 }),
    screen: basic('#a99bff'),
    accent: basic('#8b7bff'),
    amber: basic('#ffb83d'),
    cyan: basic('#59d8e6'),
    green: basic('#35d08f'),
    led: basic('#8b7bff'),
    sign: basic('#ece8de'),
  };
  const wire = new THREE.MeshBasicMaterial({ color: '#a99bff', wireframe: true, transparent: true, opacity: 0.6, depthWrite: false });
  const holo = makeHoloMaterial('#8b7bff', 0.5);
  const holoHi = makeHoloMaterial('#59d8e6', 0.55);
  function mat(role, state) {
    if (state === 'built') return roles[role] || roles.steel;
    if (state === 'building') return wire;
    if (state === 'hi') return holoHi;
    return holo;
  }
  function apply(group, state) {
    group.userData.state = state;
    group.traverse(o => { if (o.userData.role) o.material = mat(o.userData.role, state); });
  }
  return { roles, mat, apply, wire, holo, holoHi };
}

/** Текстура разметки площадки ЭЗС. */
export function makePadTexture(w = 52, d = 30) {
  const ppm = 18, c = document.createElement('canvas');
  c.width = Math.round(w * ppm); c.height = Math.round(d * ppm);
  const g = c.getContext('2d');
  g.fillStyle = '#1e2128'; g.fillRect(0, 0, c.width, c.height);
  // микро-фактура
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2); }
  const X = (x) => (x + w / 2) * ppm, Z = (z) => (z + d / 2) * ppm;
  g.strokeStyle = 'rgba(236,232,222,0.5)'; g.lineWidth = 2.4;
  g.strokeRect(X(-w / 2 + 0.6), Z(-d / 2 + 0.6), (w - 1.2) * ppm, (d - 1.2) * ppm);
  // парковочные места под навесом
  g.strokeStyle = 'rgba(236,232,222,0.42)'; g.lineWidth = 2;
  for (let i = 0; i <= 14; i++) { const x = -24.9 + i * 2.75; g.beginPath(); g.moveTo(X(x), Z(-4.0)); g.lineTo(X(x), Z(1.5)); g.stroke(); }
  // проезд и стрелки
  g.strokeStyle = 'rgba(139,123,255,0.55)'; g.setLineDash([16, 14]); g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(X(-24), Z(9.6)); g.lineTo(X(24), Z(9.6)); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(236,232,222,0.5)';
  for (let x = -18; x <= 18; x += 12) { g.beginPath(); g.moveTo(X(x), Z(9.6)); g.lineTo(X(x + 1.2), Z(9.0)); g.lineTo(X(x + 1.2), Z(10.2)); g.closePath(); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
