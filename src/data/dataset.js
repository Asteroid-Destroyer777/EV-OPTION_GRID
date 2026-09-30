// Демонстрационный датасет: станции, узлы сети, площадки, потоки спроса.
// Позиции ЭЗС-ориентиров — по адресам, заданным командой (геокодированы OSM Nominatim). Загрузка/сессии — DEMO SCENARIO.
// Узлы сети привязаны к реальным объектам power=substation в OSM; их мощности и резервы — СЦЕНАРНЫЕ допущения.
import { geo, project, polyCentroid } from './geo.js';

// Сессии/мес откалиброваны так, чтобы не превышать физический потолок поста (30 сут × 1440 мин / avgMin)
// даже при работе 24/7 без единого простоя — см. MODEL.sessionsPerPost в params.js. ZIL-01 как «горячая» точка
// редевелопмента задан заметно выше средней загрузки, остальные станции — ближе к среднегородским значениям.
export const STATION_DEFS = [
  { id: 'ZIL-01', address: '1-й Автозаводский проезд, 5', lat: 55.70483, lon: 37.65729, zone: 'Автозаводская · ЗИЛ',
    posts: 8, sessions: 2800, avgMin: 48, sens: 1.0, node: 'SUB-ZIL-01', hero: true,
    mix: { private_ev: 0.40, taxi: 0.32, corporate: 0.14, ebus: 0.04, municipal: 0.10 } },
  { id: 'ZIL-02', address: 'Автозаводская улица, 7', lat: 55.70787, lon: 37.66034, zone: 'Автозаводская',
    posts: 6, sessions: 700, avgMin: 44, sens: 0.85, node: 'SUB-ZIL-02',
    mix: { private_ev: 0.46, taxi: 0.26, corporate: 0.18, ebus: 0.02, municipal: 0.08 } },
  { id: 'ZIL-03', address: 'Автозаводская улица, 5', lat: 55.70886, lon: 37.66273, zone: 'Автозаводская',
    posts: 4, sessions: 300, avgMin: 41, sens: 0.95, node: 'SUB-ZIL-02',
    mix: { private_ev: 0.52, taxi: 0.16, corporate: 0.24, ebus: 0.0, municipal: 0.08 } },
  { id: 'ZIL-04', address: '1-й Кожуховский проезд', lat: 55.70686, lon: 37.66297, zone: 'Кожухово',
    posts: 6, sessions: 750, avgMin: 46, sens: 0.75, node: 'SUB-ZIL-02',
    mix: { private_ev: 0.44, taxi: 0.28, corporate: 0.10, ebus: 0.10, municipal: 0.08 } },
  { id: 'ZIL-05', address: 'Восточная улица', lat: 55.71727, lon: 37.66271, zone: 'Восточная',
    posts: 4, sessions: 320, avgMin: 43, sens: 0.70, node: 'SUB-ZIL-03',
    mix: { private_ev: 0.50, taxi: 0.22, corporate: 0.14, ebus: 0.06, municipal: 0.08 } },
  { id: 'ZIL-06', address: 'Мытная улица', lat: 55.72312, lon: 37.61682, zone: 'Замоскворечье (вне ядра)',
    posts: 6, sessions: 350, avgMin: 45, sens: 0.60, node: 'SUB-ZIL-04',
    mix: { private_ev: 0.48, taxi: 0.24, corporate: 0.16, ebus: 0.04, municipal: 0.08 } },
];

export const NODE_DEFS = [
  { id: 'SUB-ZIL-01', headroom: 0.9, nominal: 5.0, near: ['ZIL-01'] },
  { id: 'SUB-ZIL-02', headroom: 2.1, nominal: 8.0, near: ['ZIL-02', 'ZIL-03', 'ZIL-04'] },
  { id: 'SUB-ZIL-03', headroom: 0.9, nominal: 4.0, near: ['ZIL-05'] },
  { id: 'SUB-ZIL-04', headroom: 1.4, nominal: 5.0, near: ['ZIL-06'] },
];

/** Потоки спроса: origin — реальные названные территории OSM; route строится по улично-дорожному графу. */
export const FLOW_DEFS = [
  { id: 'F-01', type: 'private_ev', to: 'ZIL-01', w: 1.00, growth: 1.30, from: { land: 'Комплексный редевелопмент промзоны ЗИЛ' }, label: 'Кварталы редевелопмента ЗИЛ → ЭЗС' },
  { id: 'F-02', type: 'private_ev', to: 'ZIL-01', w: 0.60, growth: 1.00, from: { land: 'Жилой комплекс «Резиденции композиторов»' }, label: 'Жилые кварталы → ЭЗС' },
  { id: 'F-03', type: 'corporate', to: 'ZIL-01', w: 0.55, growth: 1.05, from: { land: 'Деловой квартал «Симоновский»' }, label: 'Деловой квартал → ЭЗС' },
  { id: 'F-04', type: 'taxi', to: 'ZIL-01', w: 0.90, growth: 1.10, from: { bridge: 'Эстакада Автозаводская—ТТК' }, label: 'ТТК / магистраль → зарядный хаб такси' },
  { id: 'F-05', type: 'taxi', to: 'ZIL-02', w: 0.50, growth: 1.00, from: { station: 'Автозаводская' }, label: 'Метро «Автозаводская» → ЭЗС' },
  { id: 'F-06', type: 'ebus', to: 'ZIL-04', w: 0.35, growth: 1.20, from: { land: 'Филиал Южный ГУП «Мосгортранс»' }, label: 'Электробусный парк → зарядная инфраструктура' },
  { id: 'F-07', type: 'municipal', to: 'ZIL-01', w: 0.30, growth: 1.00, from: { land: 'Снегоплавильный пункт' }, label: 'База коммунальной техники → ЭЗС' },
  { id: 'F-08', type: 'private_ev', to: 'ZIL-04', w: 0.50, growth: 1.10, from: { land: 'Технопарк Nagatino i-Land' }, label: 'Nagatino i-Land → ЭЗС' },
  { id: 'F-09', type: 'corporate', to: 'ZIL-03', w: 0.40, growth: 1.10, from: { land: 'Технопарк Nagatino i-Land' }, label: 'Технопарк → ЭЗС (корпоративный)' },
  { id: 'F-10', type: 'private_ev', to: 'ZIL-05', w: 0.55, growth: 1.00, from: { land: 'Жилой комплекс 4River' }, label: 'ЖК на набережной → ЭЗС' },
  { id: 'F-11', type: 'taxi', to: 'ZIL-05', w: 0.40, growth: 1.00, from: { land: 'Жилой комплекс RiverSky' }, label: 'Такси → ЭЗС Восточная' },
  { id: 'F-12', type: 'private_ev', to: 'ZIL-06', w: 0.45, growth: 0.9, from: { land: 'Деловой квартал "Даниловская мануфактура' }, label: 'Жилые кварталы → ЭЗС Мытная' },
];

export const dataset = { ready: false, stations: [], nodes: [], flows: [], upstream: [], byId: {}, nodeById: {} };

function areaOf(flat) { let a = 0; const n = flat.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1]; } return Math.abs(a / 2); }

export function findLand(q) {
  let best = null;
  for (const l of geo.data.land) {
    if (!l[3] || !l[3].includes(q)) continue;
    const a = areaOf(l[1]);
    if (!best || a > best.a) best = { a, flat: l[1] };
  }
  if (!best) return null;
  const c = polyCentroid(best.flat);
  return { x: c.x, z: c.z };
}
function findPoi(list, q) { const r = geo.data.poi[list].find(p => (p.name || '').includes(q)); return r ? { x: r.x, z: r.z } : null; }

export function initDataset() {
  const P = geo.data.poi;
  dataset.stations = STATION_DEFS.map(d => {
    const p = project(d.lat, d.lon);
    return { ...d, anchor: { x: p.x, z: p.z }, pos: { x: p.x, z: p.z, rot: 0 }, site: null, verified: true };
  });
  dataset.byId = Object.fromEntries(dataset.stations.map(s => [s.id, s]));

  // узлы сети → ближайшие реальные подстанции OSM (положение), мощности — сценарные
  const used = new Set();
  const subs = P.substations.filter(s => s.poly && ['minor_distribution', 'distribution', '', 'transmission'].includes(s.kind) && !/тяг|traction/i.test(s.kind));
  dataset.nodes = NODE_DEFS.map(d => {
    const tg = d.near.map(id => dataset.byId[id].anchor);
    const cx = tg.reduce((a, t) => a + t.x, 0) / tg.length, cz = tg.reduce((a, t) => a + t.z, 0) / tg.length;
    let best = null;
    subs.forEach((s, i) => {
      if (used.has(i)) return;
      const dd = Math.hypot(s.x - cx, s.z - cz);
      if (!best || dd < best.d) best = { d: dd, i, s };
    });
    used.add(best.i);
    const s = best.s;
    return { ...d, feeds: dataset.stations.filter(x => x.node === d.id).map(x => x.id), pos: { x: s.x, z: s.z }, poly: s.poly, osm: { name: s.name || '', volt: s.volt || '', kind: s.kind || '' } };
  });
  dataset.nodeById = Object.fromEntries(dataset.nodes.map(n => [n.id, n]));

  // вышестоящие источники (реальные объекты OSM, для схемы «условная»)
  const tec = P.plants.find(p => (p.name || '').includes('ТЭЦ-9'));
  const psA = P.substations.find(s => (s.name || '') === 'Автозаводская' && /220000/.test(s.volt));
  const psK = P.substations.find(s => (s.name || '') === 'Кожухово');
  dataset.upstream = [
    tec && { id: 'UP-TEC9', name: 'ТЭЦ-9 (Мосэнерго)', kind: 'generation', x: tec.x, z: tec.z, volt: '110 кВ', feeds: ['SUB-ZIL-01'] },
    psK && { id: 'UP-KOJ', name: 'ПС «Кожухово»', kind: 'substation', x: psK.x, z: psK.z, volt: psK.volt ? psK.volt.split(';').map(v => v / 1000).join('/') + ' кВ' : '110/10/6 кВ', feeds: ['SUB-ZIL-01', 'SUB-ZIL-02'] },
    psA && { id: 'UP-AVT', name: 'ПС «Автозаводская»', kind: 'substation', x: psA.x, z: psA.z, volt: '220/110/10 кВ', feeds: ['SUB-ZIL-02', 'SUB-ZIL-03'] },
  ].filter(Boolean);

  // потоки
  dataset.flows = FLOW_DEFS.map(d => {
    const f = d.from;
    let o = null;
    if (f.land) o = findLand(f.land);
    else if (f.bridge) o = findPoi('bridges', f.bridge);
    else if (f.station) o = findPoi('stations', f.station);
    if (!o) { const s = dataset.byId[d.to].anchor; o = { x: s.x + 500, z: s.z + 300 }; }
    return { ...d, origin: o };
  });
  dataset.ready = true;
  return dataset;
}
