// Демонстрационная экономика опций: CAPEX, OPEX, выручка, NPV, IRR, окупаемость, риски.
// ДЕМО-МОДЕЛЬ: все значения — сценарные допущения MVP, не данные РСЗС.
import { MODEL, OPTIONS, ALL_YEARS, YEAR_MIN, YEAR_MAX, SCENARIOS } from './params.js';
import { evaluate, evaluateSeries, collectAssets, decisionsKey } from './engine.js';

export const marginPerSession = () => MODEL.kwhPerSession * (MODEL.tariff - MODEL.energyCost);
export const revenuePerSession = () => MODEL.kwhPerSession * MODEL.tariff;

const cache = new Map();
export function seriesCached(ds, scenario, decisions) {
  const k = scenario + '#' + decisionsKey(decisions);
  let v = cache.get(k);
  if (!v) { v = evaluateSeries(ds, scenario, decisions); cache.set(k, v); if (cache.size > 900) cache.delete(cache.keys().next().value); }
  return v;
}
export function clearEconCache() { cache.clear(); }

const sig = (a) => `${a.station}|${a.option}|${a.decisionYear}`;
function allItems(decisions) { const { built, pending } = collectAssets(decisions, YEAR_MAX + 10); return [...built, ...pending]; }

function marginOf(state) {
  const m0 = marginPerSession();
  const bonus = OPTIONS.local_gen.marginPerKwh * OPTIONS.local_gen.energyShare * MODEL.kwhPerSession;
  let sum = 0;
  for (const s of state.stations) sum += s.served * 12 * (m0 + (s.built.local_gen ? bonus : 0));
  return sum / 1e6;
}
const revenueOf = (state) => state.stations.reduce((a, s) => a + s.served, 0) * 12 * revenuePerSession() / 1e6;
const lostOf = (state) => state.totals.lost * 12;

export function irr(cf) {
  const hasNeg = cf.some(v => v < -1e-9), hasPos = cf.some(v => v > 1e-9);
  if (!hasNeg || !hasPos) return null;
  const f = (r) => cf.reduce((a, v, t) => a + v / Math.pow(1 + r, t), 0);
  let lo = -0.85, hi = 4;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

/**
 * Экономика набора решений `decisions` относительно `baseline` в сценарии `scenario`.
 * Возвращает денежные потоки по годам, NPV, IRR, окупаемость.
 */
export function economics(ds, scenario, decisions, baseline = []) {
  const A = seriesCached(ds, scenario, decisions), B = seriesCached(ds, scenario, baseline);
  const baseSig = new Set(allItems(baseline).map(sig));
  const items = allItems(decisions).filter(a => !baseSig.has(sig(a)));
  const cash = [], flows = [];
  let capexTotal = 0;
  for (let t = 0; t < ALL_YEARS.length; t++) {
    const y = ALL_YEARS[t];
    const dMargin = marginOf(A[t]) - marginOf(B[t]);
    const dRev = revenueOf(A[t]) - revenueOf(B[t]);
    const dLost = lostOf(B[t]) - lostOf(A[t]);
    let opex = 0, capex = 0;
    for (const a of items) {
      const o = OPTIONS[a.option];
      if (a.effYear <= y) opex += o.opex;
      if (a.decisionYear === y) capex += a.capex;
    }
    capexTotal += capex;
    let c = dMargin - opex - capex;
    if (y === YEAR_MAX) c += MODEL.residual * items.reduce((s, a) => s + a.capex, 0);
    const good = dLost * MODEL.goodwillPerLost / 1e6;
    cash.push(c);
    flows.push({ year: y, dMargin, dRev, opex, capex, cash: c, goodwill: good, dLost });
  }
  const npv = cash.reduce((a, v, t) => a + v / Math.pow(1 + MODEL.discount, t), 0);
  const goodPV = flows.reduce((a, f, t) => a + f.goodwill / Math.pow(1 + MODEL.discount, t), 0);
  // окупаемость без остаточной стоимости
  let cum = 0, payback = null;
  const firstY = items.length ? Math.min(...items.map(a => a.decisionYear)) : YEAR_MIN;
  for (const f of flows) {
    const c = f.cash - (f.year === YEAR_MAX ? MODEL.residual * items.reduce((s, a) => s + a.capex, 0) : 0);
    cum += c;
    if (payback === null && cum >= 0 && f.year >= firstY && items.length) payback = f.year - firstY + 1;
  }
  return { flows, npv, npvAdj: npv + goodPV, goodPV, irr: irr(cash), payback, capex: capexTotal, items };
}

/** Сводка по опции/пакету для конкретной станции и года решения — во всех сценариях. */
export function evaluatePackage(ds, { station, year, options, baseline, weights }) {
  const others = baseline.filter(d => !(d.station === station && d.year === year));
  const mine = { station, year, options: [...options] };
  const withPkg = [...others, mine];
  const out = { options, byScenario: {}, year, station };
  for (const sc of Object.keys(SCENARIOS)) {
    const e = economics(ds, sc, withPkg, others);
    const A = seriesCached(ds, sc, withPkg), B = seriesCached(ds, sc, others);
    const i30 = ALL_YEARS.indexOf(2030), i35 = ALL_YEARS.indexOf(2035), iy = ALL_YEARS.indexOf(Math.min(2035, Math.max(year, 2027)));
    const st = (S, i) => S[i].byId[station];
    const newId = A[i30].stations.filter(s => s.anchor === station).map(s => s.id);
    const focusLoad = (S, i) => { const s = st(S, i); const nn = S[i].stations.filter(x => x.anchor === station); return nn.length ? Math.max(s.load, ...nn.map(x => x.load)) : s.load; };
    out.byScenario[sc] = {
      econ: e, npv: e.npv, npvAdj: e.npvAdj, irr: e.irr, payback: e.payback, capex: e.capex,
      load2030: st(A, i30).load, load2035: st(A, i35).load, loadBase2030: st(B, i30).load, loadBase2035: st(B, i35).load,
      wait2030: st(A, i30).wait, waitBase2030: st(B, i30).wait,
      queue2030: st(A, i30).queueRisk, queueBase2030: st(B, i30).queueRisk,
      net2030: A[i30].totals, net2035: A[i35].totals, netB2030: B[i30].totals, netB2035: B[i35].totals,
      focusLoad2030: focusLoad(A, i30), focusLoad2035: focusLoad(A, i35),
      dRev2030: e.flows[i30].dRev, dMargin2030: e.flows[i30].dMargin, opex2030: e.flows[i30].opex,
      gridStatus2030: A[i30].nodes[ds.byId[station].node].status,
      gridUtil2030: A[i30].nodes[ds.byId[station].node].util,
      newStationLoad2030: newId.length ? A[i30].byId[newId[0]].load : null,
    };
  }
  const P = weights || MODEL.probs;
  const sc = out.byScenario;
  out.expNpv = Object.keys(sc).reduce((a, k) => a + P[k] * sc[k].npv, 0);
  out.expScore = Object.keys(sc).reduce((a, k) => a + P[k] * sc[k].npvAdj, 0);
  out.capex = sc.base.capex;
  // риск недозагрузки: как загружена целевая ёмкость при низком росте в 2030
  const lowLoad = sc.low.focusLoad2030;
  const added = options.some(o => ['new_station', 'expansion', 'pilot'].includes(o));
  out.riskUnder = !added ? 'low' : lowLoad < 0.45 ? 'high' : lowLoad < 0.62 ? 'mid' : 'low';
  out.lead = Math.max(0, ...options.map(o => OPTIONS[o].lead));
  return out;
}
