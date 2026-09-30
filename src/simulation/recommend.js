// Подбор пакета инвестиционных шагов с «реальными опционами»:
//   первый шаг (2026/2027) оценивается вместе с оптимальным ответом в 2030, когда неопределённость сценария уже раскрыта.
//   Ценность ожидания = ценность гибкости: дешёвый быстрый шаг сегодня + решение о крупном CAPEX позже.
// Не «чёрный ящик»: NPV по сценариям, регрет, ответный шаг и ограничения сети доступны для каждого пакета.
import { COMBINABLE, EXCLUSIVE, SCENARIOS, MODEL } from './params.js';
import { evaluatePackage, economics } from './economics.js';
import { decisionsKey } from './engine.js';

export const RECOURSE_YEAR = 2030;
const SECOND = [['none'], ['expansion'], ['storage'], ['expansion', 'storage'], ['new_station'], ['new_station', 'storage'], ['grid_upgrade'], ['expansion', 'grid_upgrade'], ['new_station', 'expansion', 'storage'], ['new_station', 'grid_upgrade']];

export function candidatePackages() {
  const res = [];
  const n = COMBINABLE.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const pkg = COMBINABLE.filter((_, i) => mask & (1 << i));
    if (pkg.length <= 3) res.push(pkg);
  }
  for (const e of EXCLUSIVE) res.push([e]);
  return res;
}
export const pkgKey = (options) => [...options].sort().join('+');

export function weightsFor(scenario, year) {
  if (year < RECOURSE_YEAR) return { ...MODEL.probs };
  const w = {};
  for (const k of Object.keys(SCENARIOS)) w[k] = k === scenario ? 0.7 : 0.15;
  return w;
}

const memo = new Map();
export function recommend(ds, { station, year, baseline, scenario = 'base' }) {
  const others = baseline.filter(d => !(d.station === station && d.year === year));
  const W = weightsFor(scenario, year);
  const key = `${station}@${year}|${W.low}/${W.base}/${W.high}|${decisionsKey(others)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const scs = Object.keys(SCENARIOS);
  const pk = candidatePackages().map(options => evaluatePackage(ds, { station, year, options, baseline, weights: W }));
  const fixedLater = others.some(d => d.station === station && d.year >= RECOURSE_YEAR);
  const useRecourse = year < RECOURSE_YEAR && !fixedLater;
  for (const p of pk) {
    p.stage = {};
    for (const sc of scs) {
      let val = p.byScenario[sc].npvAdj, resp = null;
      if (useRecourse) {
        val = -Infinity;
        for (const p2 of SECOND) {
          const dec = [...others, { station, year, options: [...p.options] }, ...(p2[0] === 'none' ? [] : [{ station, year: RECOURSE_YEAR, options: p2 }])];
          const e = economics(ds, sc, dec, others);
          if (e.npvAdj > val) { val = e.npvAdj; resp = p2; }
        }
      }
      p.stage[sc] = { value: val, response: resp };
    }
    p.exp = scs.reduce((a, k) => a + W[k] * p.stage[k].value, 0);
  }
  const best = {};
  for (const sc of scs) best[sc] = Math.max(...pk.map(p => p.stage[sc].value));
  for (const p of pk) {
    p.regret = {}; let mr = 0;
    for (const sc of scs) { p.regret[sc] = best[sc] - p.stage[sc].value; mr = Math.max(mr, p.regret[sc]); }
    p.maxRegret = mr;
    p.score = p.exp - 0.35 * mr;
    p.useRecourse = useRecourse;
  }
  pk.sort((a, b) => b.score - a.score);
  const res = { ranked: pk, best: pk[0], byKey: Object.fromEntries(pk.map(p => [pkgKey(p.options), p])), weights: W, useRecourse };
  memo.set(key, res);
  if (memo.size > 300) memo.delete(memo.keys().next().value);
  return res;
}
export function clearRecommendCache() { memo.clear(); }
