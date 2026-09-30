// Сценарный движок сети ЭЗС: спрос → загрузка → очередь → ограничение узла → переток спроса между станциями.
// Это прединвестиционная сценарная модель (НЕ моделирование физических режимов электросети).
import { MODEL, OPTIONS, growthAt, ALL_YEARS } from './params.js';

const K = MODEL.sessionsPerPost;
const PK = MODEL.peakKWPerBusyPost / 1000; // МВт на занятый пост

/* ---------- решения → активы ---------- */
/** decisions: [{ station, year, options:[optionId…] }]. Возвращает построенные и находящиеся в реализации активы на год y. */
export function collectAssets(decisions, y) {
  const built = [], pending = [];
  for (const d of decisions) {
    const prepared = decisions.some(x => x.station === d.station && x.year < d.year && x.options.includes('defer'));
    for (const oid of d.options) {
      if (oid === 'none') continue;
      const o = OPTIONS[oid];
      let lead = o.lead;
      const discounted = prepared && (oid === 'new_station' || oid === 'expansion');
      if (discounted) lead = Math.max(0, lead - OPTIONS.defer.nextLeadCut);
      const item = { station: d.station, option: oid, decisionYear: d.year, effYear: d.year + lead, prepared: discounted, capex: o.capex * (discounted ? 1 - OPTIONS.defer.nextDiscount : 1) };
      if (d.year <= y) (item.effYear <= y ? built : pending).push(item);
    }
  }
  return { built, pending };
}

export function queueMetrics(rho, c, S) {
  if (c < 0.5) return { wait: 90, cars: 9 };
  let wait;
  if (rho >= 1) wait = Math.min(90, 45 + (rho - 1) * 60);
  else {
    const r = Math.min(rho, 0.95);
    wait = Math.min(75, 0.55 * S * Math.pow(r, Math.sqrt(2 * (c + 1)) - 1) / (c * (1 - r)));
  }
  return { wait, cars: Math.min(9, wait / 9) };
}

const riskOf = (rho) => rho < 0.7 ? 'low' : rho < 0.88 ? 'mid' : 'high';

/** Оценка сети на год `year` при сценарии `scenario` и наборе решений `decisions`. */
export function evaluate(ds, { year, scenario, decisions = [] }) {
  const F = growthAt(scenario, year);
  const { built, pending } = collectAssets(decisions, year);
  const nodeAdd = {};
  for (const n of ds.nodes) nodeAdd[n.id] = { storage: 0, upgrade: 0, gen: 0 };
  const addPosts = {}, info = {}, newDefs = [];
  const bump = (id, k) => { (info[id] ||= {})[k] = ((info[id] || {})[k] || 0) + 1; };
  let newIdx = {};
  for (const a of built) {
    const s = ds.byId[a.station], o = OPTIONS[a.option];
    bump(a.station, a.option);
    if (a.option === 'expansion' || a.option === 'pilot') addPosts[a.station] = (addPosts[a.station] || 0) + o.addPosts;
    else if (a.option === 'storage') nodeAdd[s.node].storage += o.peakMW;
    else if (a.option === 'grid_upgrade') nodeAdd[s.node].upgrade += o.addMW;
    else if (a.option === 'local_gen') nodeAdd[s.node].gen += o.peakMW;
    else if (a.option === 'new_station') {
      const k = newIdx[a.station] = (newIdx[a.station] || 0) + 1;
      newDefs.push({ id: `${a.station}-N${k > 1 ? k : ''}`, anchor: a.station, node: s.node, posts: o.addPosts, sens: s.sens, avgMin: s.avgMin, mix: s.mix, pos: s.site ? { x: s.site.x, z: s.site.z } : s.pos, sessions: 0, isNew: true, effYear: a.effYear });
    }
  }
  // площадка «подготовлена»
  const prepared = new Set(decisions.filter(d => d.year <= year && d.options.includes('defer')).map(d => d.station));

  const list = [];
  const mk = (def) => {
    const posts = def.posts + (addPosts[def.id] || 0);
    const Fi = 1 + (F - 1) * def.sens;
    const s = {
      id: def.id, def, isNew: !!def.isNew, anchor: def.anchor || null, node: def.node, posts, basePosts: def.posts,
      x: def.pos.x, z: def.pos.z, growth: Fi,
      D0: def.sessions * Fi, D: 0, capPosts: posts * K, effPosts: posts, capEff: posts * K,
      served: 0, unserved: 0, spillIn: 0, spillOut: 0, lost: 0, load: 0, rho: 0, wait: 0, queueCars: 0,
      queueRisk: 'low', status: 'low', limiter: 'none', built: info[def.id] || {}, prepared: prepared.has(def.id), pending: [],
    };
    return s;
  };
  for (const d of ds.stations) list.push(mk(d));
  for (const d of newDefs) list.push(mk(d));
  const byId = Object.fromEntries(list.map(s => [s.id, s]));
  for (const p of pending) { const s = byId[p.station]; if (s) s.pending.push(p); }

  // приток индуцированного спроса и перехват у соседей для новых станций
  for (const n of list.filter(s => s.isNew)) {
    const a = byId[n.anchor];
    let captured = 0;
    for (const j of list) {
      if (j.isNew || j === n) continue;
      const d = Math.hypot(j.x - n.x, j.z - n.z);
      const share = 0.14 * Math.exp(-d / 320);
      if (share < 0.004) continue;
      const take = j.D0 * share; j.D0 -= take; captured += take;
    }
    n.D0 = captured + 0.10 * a.def.sessions * Math.max(0, a.growth - 1);
  }
  for (const s of list) s.D = s.D0;

  // узлы: допустимая мощность, планово-желаемая мощность
  const nodes = {};
  for (const n of ds.nodes) {
    const add = nodeAdd[n.id];
    nodes[n.id] = { id: n.id, def: n, base: n.headroom, storage: add.storage, upgrade: add.upgrade, gen: add.gen, H: n.headroom + add.storage + add.upgrade + add.gen, desired: 0, used: 0, util: 0, status: 'low', stations: [] };
  }
  for (const s of list) nodes[s.node].stations.push(s.id);

  // эффективная ёмкость станции: посты ∧ доля мощности узла
  for (const n of Object.values(nodes)) {
    const sumPosts = n.stations.reduce((a, id) => a + byId[id].posts, 0) || 1;
    for (const id of n.stations) {
      const s = byId[id];
      const powerPosts = (n.H * (s.posts / sumPosts)) / PK;
      s.effPosts = Math.min(s.posts, powerPosts);
      s.capEff = s.effPosts * K;
      s.throttle = s.posts ? s.effPosts / s.posts : 1;
    }
    n.desired = n.stations.reduce((a, id) => a + (byId[id].D0 / K) * PK, 0);
  }
  for (const s of list) { s.served = Math.min(s.D, s.capEff); s.unserved = s.D - s.served; }

  // переток неудовлетворённого спроса к соседям со свободной ёмкостью
  const spare = Object.fromEntries(list.map(s => [s.id, Math.max(0, s.capEff - s.served)]));
  const order = list.filter(s => s.unserved > 1).sort((a, b) => b.unserved - a.unserved);
  for (const i of order) {
    const spillable = i.unserved * (1 - MODEL.leak);
    const cand = [];
    let tw = 0;
    for (const j of list) {
      if (j === i || spare[j.id] < 1) continue;
      const d = Math.hypot(i.x - j.x, i.z - j.z);
      if (d > MODEL.spillMaxM) continue;
      const w = spare[j.id] * Math.exp(-d / MODEL.spillDecayM);
      cand.push([j, w]); tw += w;
    }
    let given = 0;
    if (tw > 0) for (const [j, w] of cand) {
      const g = Math.min(spare[j.id], spillable * (w / tw));
      spare[j.id] -= g; j.spillIn += g; j.served += g; given += g;
    }
    i.spillOut = given; i.lost = i.unserved - given;
  }

  // метрики станций
  for (const s of list) {
    s.load = s.capEff > 0 ? Math.min(1, s.served / s.capEff) : 0;
    s.loadInstalled = s.capPosts > 0 ? s.served / s.capPosts : 0;
    const present = s.D + s.spillIn;
    s.rho = s.capEff > 0 ? present / s.capEff : 2;
    const q = queueMetrics(s.rho, s.effPosts, s.def.avgMin);
    s.wait = q.wait; s.queueCars = Math.round(q.cars);
    s.queueRisk = riskOf(s.rho);
    s.limiter = s.D > s.capEff + 1 ? (s.capEff < s.capPosts - 1 ? 'power' : 'posts') : 'none';
    s.powerMW = (s.served / K) * PK;
  }
  // узлы: итоги и статус
  for (const n of Object.values(nodes)) {
    n.used = n.stations.reduce((a, id) => a + byId[id].powerMW, 0);
    n.util = n.desired / n.H;
    n.status = n.util >= MODEL.gridCrit ? 'constraint' : n.util >= MODEL.gridWarn ? 'warn' : 'ok';
    n.usedUtil = n.used / n.H;
  }
  for (const s of list) {
    const n = nodes[s.node];
    if (n.status === 'constraint') s.status = 'constraint';
    else s.status = s.load >= MODEL.loadHigh ? 'high' : s.load >= MODEL.loadMid ? 'mid' : 'low';
    s.gridUtil = n.util;
  }

  const totalD = list.reduce((a, s) => a + s.D, 0);
  const served = list.reduce((a, s) => a + s.served, 0);
  const posts = list.reduce((a, s) => a + s.posts, 0);
  const capexCum = [...built, ...pending].reduce((a, b) => a + b.capex, 0);
  return {
    year, scenario, F, stations: list, byId, nodes, built, pending,
    totals: {
      demand: totalD, served, lost: totalD - served, posts,
      util: posts ? served / (posts * K) : 0,            // загрузка установленной ёмкости сети
      availability: totalD ? served / totalD : 1,        // доля спроса, обслуженного без отказа
      capexCum,
      queuing: list.filter(s => s.queueRisk === 'high').length,
      constrainedNodes: Object.values(nodes).filter(n => n.status === 'constraint').length,
    },
  };
}

export function evaluateSeries(ds, scenario, decisions, years = ALL_YEARS) {
  return years.map(y => evaluate(ds, { year: y, scenario, decisions }));
}

/** Сигнатура набора решений — ключ кэша. */
export function decisionsKey(decisions) {
  return decisions.map(d => `${d.station}@${d.year}:${[...d.options].sort().join('+')}`).sort().join('|');
}
