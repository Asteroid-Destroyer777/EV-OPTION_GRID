// Объяснение решения (PASSPORT OF DECISION): показатели «почему» и связный текст строятся из чисел модели, а не из шаблонной заглушки.
import { OPTIONS, SCENARIOS, MODEL, growthAt } from './params.js';
import { evaluate } from './engine.js';
import { recommend, pkgKey } from './recommend.js';
import { int, num, pct, mln } from '../ui/format.js';

const level = (v, lo, hi) => v < lo ? 'low' : v < hi ? 'mid' : 'high';

export function explain(ds, { station, year, scenario, decisions, options }) {
  const others = decisions.filter(d => !(d.station === station && d.year === year));
  const rec = recommend(ds, { station, year, baseline: decisions, scenario });
  const pkg = rec.byKey[pkgKey(options)] || rec.best;
  const s0 = evaluate(ds, { year, scenario, decisions: others });
  const s30 = evaluate(ds, { year: Math.max(year, 2030), scenario, decisions: others });
  const st0 = s0.byId[station], st30 = s30.byId[station];
  const node0 = s0.nodes[st0.node], node30 = s30.nodes[st0.node];
  const st = ds.byId[station];
  const gRise = st30.D0 / Math.max(1, st0.D0);
  const sc = pkg.byScenario[scenario];
  const single = (k) => rec.byKey[k];
  const capexNew = OPTIONS.new_station.capex;
  const pkgCapex = pkg.capex;
  const capexLevel = level(pkgCapex, 20, 60);
  const opts = new Set(options);

  const indicators = {
    demand: { v: gRise > 1.5 ? 'высокий ↑' : gRise > 1.15 ? 'растёт ↑' : 'умеренный →', cls: gRise > 1.5 ? 'bad' : gRise > 1.15 ? 'warn' : 'ok', note: `×${num(gRise, 2)} к ${Math.max(year, 2030)}` },
    load: { v: pct(st0.load), cls: st0.load >= 0.8 ? 'bad' : st0.load >= 0.5 ? 'warn' : 'ok', note: `${int(st0.D)} сессий/мес` },
    grid: { v: node30.status === 'constraint' ? 'ограничена' : node30.status === 'warn' ? 'на пределе' : 'достаточна', cls: node30.status === 'constraint' ? 'bad' : node30.status === 'warn' ? 'warn' : 'ok', note: `${num(node30.desired, 2)} из ${num(node30.H, 2)} МВт` },
    queue: { v: st0.queueRisk === 'high' ? 'высокий' : st0.queueRisk === 'mid' ? 'средний' : 'низкий', cls: st0.queueRisk === 'high' ? 'bad' : st0.queueRisk === 'mid' ? 'warn' : 'ok', note: `ожидание ~${Math.round(st0.wait)} мин` },
    capex: { v: capexLevel === 'high' ? 'высокий' : capexLevel === 'mid' ? 'средний' : 'низкий', cls: capexLevel === 'high' ? 'bad' : capexLevel === 'mid' ? 'warn' : 'ok', note: mln(pkgCapex) },
    risk: { v: pkg.riskUnder === 'high' ? 'высокий' : pkg.riskUnder === 'mid' ? 'средний' : 'низкий', cls: pkg.riskUnder === 'high' ? 'bad' : pkg.riskUnder === 'mid' ? 'warn' : 'ok', note: 'риск избыточных вложений' },
  };

  const gridYear = (() => { for (const y of [2027, 2030, 2035]) { const s = evaluate(ds, { year: y, scenario, decisions: others }); if (s.nodes[st0.node].status === 'constraint') return y; } return null; })();
  const parts = [];
  parts.push(`Существующая ЭЗС ${station} загружена на <em>${pct(st0.load)}</em>${st0.queueRisk === 'high' ? `, в пик ожидание около ${Math.round(st0.wait)} мин` : ''}; спрос растёт — <em>×${num(gRise, 2)}</em> к ${Math.max(year, 2030)}.`);
  if (gridYear) parts.push(`Допустимая EV-мощность узла (${num(node0.H, 2)} МВт, сценарное допущение) ниже планового спроса — ограничение сети проявится к <em>${gridYear}</em>, поэтому просто добавить посты недостаточно.`);
  else parts.push(`Мощности узла (${num(node0.H, 2)} МВт) в расчётном горизонте пока достаточно.`);
  // обоснование пакета
  const has = (k) => opts.has(k);
  if (has('expansion') && has('storage') && !has('new_station')) parts.push(`Поэтапное расширение в сочетании с накопителем увеличивает число постов и пиковую мощность <em>без немедленного масштабного усиления сети</em> и без капитальных затрат новой станции (${mln(capexNew)}).`);
  else if (has('new_station') && has('expansion') && has('storage')) parts.push(`Пакет закрывает и ёмкость, и мощность, но фиксирует крупный CAPEX (${mln(pkgCapex)}) до раскрытия сценария — при низком росте он окупается заметно хуже.`);
  else if (has('new_station') && options.length === 1) parts.push(`Новая станция добавляет независимую ёмкость и перехватывает переток спроса, но требует ${mln(capexNew)} и не снимает ограничения узла.`);
  else if (has('expansion') && options.length === 1) parts.push(`Расширение быстро снимает очередь, но растёт пиковая мощность на узле — без накопителя или усиления сети станция упрётся в допустимую мощность.`);
  else if (has('storage') && options.length === 1) parts.push(`Накопитель срезает пик и повышает допустимую мощность узла, но сам по себе не добавляет постов — очередь сохранится.`);
  else if (has('grid_upgrade')) parts.push(`Усиление сети снимает ограничение надолго, но это самый дорогой и долгий шаг (${OPTIONS.grid_upgrade.lead} года) — оправдан при устойчиво высоком росте.`);
  else if (has('local_gen')) parts.push(`Локальная генерация снижает стоимость энергии, но слабо влияет на вечерний пик — ограничение сети она не снимает.`);
  else if (has('defer')) parts.push(`Подготовка площадки — дешёвый способ «купить опцию»: следующий шаг станет на ${Math.round(OPTIONS.defer.nextDiscount * 100)}% дешевле и на год быстрее, но очередь сегодня не уменьшится.`);
  else if (has('pilot')) parts.push(`Пилот быстро снимает часть очереди и даёт данные о реальном спросе без крупного CAPEX, но ёмкость невелика.`);
  else if (has('none')) parts.push(`Отказ от инвестиций сохраняет капитал, но очереди растут, спрос уходит (потери ~${int(st30.lost)} сессий/мес к ${Math.max(year, 2030)}), а следующий шаг обойдётся дороже.`);
  const rob = `Ожидаемый NPV по сценариям ${mln(pkg.expNpv)} (демо), максимальное сожаление ${mln(pkg.maxRegret)}.`;
  parts.push(rob);
  const en = has('none') ? 'Not investing preserves capital but lets queues and lost demand compound.' : (options.length > 1 || has('pilot') || has('defer'))
    ? 'EV-Option Grid recommends a staged investment because demand is growing, while immediate full-scale expansion creates a higher risk of premature CAPEX.'
    : 'A single-step decision keeps CAPEX low but leaves either capacity or power headroom unresolved.';

  // альтернативы
  const alts = rec.ranked.slice(0, 5).map(p => ({ options: p.options, expNpv: p.expNpv, capex: p.capex, regret: p.maxRegret, score: p.score, chosen: pkgKey(p.options) === pkgKey(options), best: p === rec.best }));
  if (!alts.some(a => a.chosen)) alts.push({ options, expNpv: pkg.expNpv, capex: pkg.capex, regret: pkg.maxRegret, score: pkg.score, chosen: true });
  // ответные шаги (реальные опционы)
  const responses = Object.keys(SCENARIOS).map(k => ({ scenario: k, response: pkg.stage?.[k]?.response || null }));
  return { rec, pkg, indicators, text: parts, en, alts, responses, st0, st30, node0, node30, gridYear, sc };
}
