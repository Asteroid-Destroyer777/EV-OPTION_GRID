// Рабочие листы: сценарии, план развития, паспорт расчёта, сравнение подходов, данные и допущения.
import { state } from '../state.js';
import { dataset as ds } from '../data/dataset.js';
import { evaluate } from '../simulation/engine.js';
import { seriesCached, marginPerSession } from '../simulation/economics.js';
import { recommend } from '../simulation/recommend.js';
import { recommendedPlan, traditionalPlan, planKpis } from '../simulation/policies.js';
import { recommendation } from '../actions.js';
import { MODEL, OPTIONS, SCENARIOS, ALL_YEARS, YEARS, growthAt, assumptionRows, USER_TYPES } from '../simulation/params.js';
import { num, int, pct, mln, sgn, TAG, PROV, pkCode, pkText, lineChart, chipStatus, ICONS, riskCls, RISK_RU } from './format.js';

const $ = (s) => document.querySelector(s);
let compareTimer = null, compareCache = {}, compareRun = 0;

export function renderSheet() {
  const el = $('#sheet');
  if (state.view === 'map') { el.hidden = true; el.innerHTML = ''; stopCompare(); return; }
  el.hidden = false;
  const v = state.view;
  const body = v === 'scenarios' ? scenariosSheet() : v === 'plan' ? planSheet() : v === 'passport' ? passportSheet() : v === 'compare' ? compareSheet() : dataSheet();
  el.innerHTML = `<div class="sheet-in">${body}</div><button class="btn sheet-x" data-act="view" data-arg="map">${ICONS.x}&nbsp; К карте</button>`;
  if (v === 'compare') startCompare();
}
const H = (kicker, title, text, right = '') => `<div class="sheet-h"><div><div class="mn" style="color:#c6bdff">${kicker}</div><h1>${title}</h1><p>${text}</p></div><div>${right}</div></div>`;

/* ---------- 01. СЦЕНАРИИ ---------- */
function scenariosSheet() {
  const scs = Object.values(SCENARIOS);
  const chart = lineChart({ w: 1100, h: 210, pad: [16, 20, 26, 44], yMin: 1, yMax: 4.5, yFmt: (v) => '×' + v.toFixed(1).replace('.', ','), xTicks: [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035], cur: state.year,
    series: scs.map(s => ({ pts: ALL_YEARS.map(y => [y, growthAt(s.id, y)]), color: s.color, w: s.id === state.scenario ? 3 : 1.6, dots: s.id === state.scenario })) });
  const cards = scs.map(s => {
    const S30 = evaluate(ds, { year: 2030, scenario: s.id, decisions: state.decisions }), S35 = evaluate(ds, { year: 2035, scenario: s.id, decisions: state.decisions });
    const S35n = evaluate(ds, { year: 2035, scenario: s.id, decisions: [] });
    const r = recommend(ds, { station: 'ZIL-01', year: state.year < 2030 ? state.year : 2027, baseline: [], scenario: s.id });
    return `<div class="card ${s.id === state.scenario ? 'on' : ''}">
      <div class="mn" style="color:${s.color}">■ ${s.short.toUpperCase()}</div><h3>${s.name}</h3><p>${s.note}</p>
      <div class="kpirow"><div><b>×${num(growthAt(s.id, 2030), 2)}</b><span>парк EV 2030</span></div><div><b>×${num(growthAt(s.id, 2035), 2)}</b><span>парк EV 2035</span></div></div>
      <table class="tbl" style="margin:10px 0 12px"><tbody>
        <tr><td>Загрузка сети 2035</td><td class="r num">${pct(S35.totals.util)}</td></tr>
        <tr><td>Станций в очереди 2035</td><td class="r num">${S35.totals.queuing} из ${S35.stations.length}</td></tr>
        <tr><td>Узлов в ограничении 2035</td><td class="r num">${S35.totals.constrainedNodes}</td></tr>
        <tr><td>Потери спроса «без решений»</td><td class="r num neg">${int(S35n.totals.lost)} сессий/мес</td></tr></tbody></table>
      <div class="mn" style="margin-bottom:6px">Лучший первый шаг для ZIL-01</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${pkCode(r.best.options)}</div>
      <button class="btn ${s.id === state.scenario ? '' : 'primary'} block" data-act="scenario" data-arg="${s.id}">${s.id === state.scenario ? '✓ Выбран' : 'Выбрать сценарий'}</button></div>`;
  }).join('');
  return H('02 · СЦЕНАРИИ', 'Три сценария неопределённости спроса', 'Смена сценария меняет транспортные потоки, загрузку ЭЗС, очереди, нагрузку сети и инвестиционные решения — и в 3D, и в расчётах. Значения — сценарные допущения.', TAG.scn) +
    `<div class="chart-box" style="margin-bottom:18px"><div class="sec-h"><h3 class="mono">Индекс роста парка EV (2026 = ×1,0)</h3><div class="legend" style="margin:0">${scs.map(s => `<span style="--c:${s.color}"><i></i>${s.name}</span>`).join('')}</div></div>${chart}</div><div class="cards3">${cards}</div>`;
}

/* ---------- 03. ПЛАН ---------- */
function planSheet() {
  const dec = state.decisions;
  const rows = ds.stations.map(s => `<div class="rowh"><b>${s.id}</b><span>${s.address}</span></div>` + YEARS.map(y => {
    const d = dec.find(x => x.station === s.id && x.year === y);
    const lead = d ? Math.max(...d.options.map(o => OPTIONS[o].lead)) : 0;
    return `<div class="cell ${y === state.year ? 'now' : ''}">${d ? pkCode(d.options) + (lead ? `<span class="note" style="width:100%">ввод ${y + lead}</span>` : '') : '<span class="note">—</span>'}</div>`;
  }).join('')).join('');
  const S = seriesCached(ds, state.scenario, dec), S0 = seriesCached(ds, state.scenario, []);
  const kpi = YEARS.map(y => { const i = ALL_YEARS.indexOf(y), a = S[i], b = S0[i]; return { y, a, b }; });
  const cell = (f) => kpi.map(k => `<div>${f(k)}</div>`).join('');
  const lostSer = (X) => X.map((s, i) => [ALL_YEARS[i], s.totals.lost]);
  const chart = lineChart({ w: 520, h: 190, yMax: Math.max(1000, ...S0.map(s => s.totals.lost)) * 1.1, yFmt: (v) => Math.round(v / 1000) + ' тыс.', cur: state.year, series: [{ pts: lostSer(S0), color: '#ff6b78', dash: true, w: 1.8 }, { pts: lostSer(S), color: '#8b7bff', w: 2.6, area: true }] });
  const util = lineChart({ w: 520, h: 190, yMax: 1, cur: state.year, series: [{ pts: S0.map((s, i) => [ALL_YEARS[i], s.totals.availability]), color: '#ff6b78', dash: true, w: 1.8 }, { pts: S.map((s, i) => [ALL_YEARS[i], s.totals.availability]), color: '#8b7bff', w: 2.6, area: true }], yMin: 0.4 });
  return H('03 · ПЛАН РАЗВИТИЯ', 'Последовательность инвестиционных шагов', 'Решение принимается не «где поставить ЭЗС», а «где, когда и какой шаг». Шаг 2027 меняет исходные данные для 2030 и 2035 — поэтому план строится как последовательность, а не как разовая точка.',
    `<div style="display:flex;gap:8px"><button class="btn violet" data-act="plan-rec">★ Рекомендованная траектория</button><button class="btn" data-act="plan-clear" ${dec.length ? '' : 'disabled'}>Очистить план</button></div>`) +
    `<div class="plan"><div class="hd">ЭЗС / адрес</div>${YEARS.map(y => `<div class="hd yr">${y}</div>`).join('')}${rows}</div>
    <div class="cards2" style="margin-top:22px">
      <div class="chart-box"><div class="sec-h"><h3 class="mono">Потерянный спрос, сессий/мес</h3>${TAG.scn}</div>${chart}<div class="legend"><span style="--c:#8b7bff"><i></i>с планом</span><span style="--c:#ff6b78"><i class="dash"></i>без решений</span></div></div>
      <div class="chart-box"><div class="sec-h"><h3 class="mono">Доступность зарядки (доля обслуженного спроса)</h3>${TAG.scn}</div>${util}<div class="legend"><span style="--c:#8b7bff"><i></i>с планом</span><span style="--c:#ff6b78"><i class="dash"></i>без решений</span></div></div>
    </div>
    <div class="plan" style="grid-template-columns:150px repeat(4,1fr);margin-top:22px"><div class="hd">Показатель · план / без решений</div>${YEARS.map(y => `<div class="hd yr">${y}</div>`).join('')}
      <div class="rowh"><b>Загрузка сети</b></div>${cell(k => `<span class="num">${pct(k.a.totals.util)}</span> <span class="note">/ ${pct(k.b.totals.util)}</span>`)}
      <div class="rowh"><b>Доступность</b></div>${cell(k => `<span class="num ${k.a.totals.availability > k.b.totals.availability ? 'pos' : ''}">${pct(k.a.totals.availability)}</span> <span class="note">/ ${pct(k.b.totals.availability)}</span>`)}
      <div class="rowh"><b>Станций в очереди</b></div>${cell(k => `<span class="num">${k.a.totals.queuing}</span> <span class="note">/ ${k.b.totals.queuing}</span>`)}
      <div class="rowh"><b>Узлов в ограничении</b></div>${cell(k => `<span class="num">${k.a.totals.constrainedNodes}</span> <span class="note">/ ${k.b.totals.constrainedNodes}</span>`)}
      <div class="rowh"><b>CAPEX накопленный</b></div>${cell(k => `<span class="num">${int(k.a.totals.capexCum)}</span> <span class="note">млн ₽</span>`)}
    </div>`;
}

/* ---------- 04. ПАСПОРТ РАСЧЁТА ---------- */
function passportSheet() {
  const id = state.selectedStation && ds.byId[state.selectedStation] ? state.selectedStation : 'ZIL-01';
  const sim = state.networkState, st = sim.byId[id], def = ds.byId[id], node = sim.nodes[st.node];
  const rec = recommendation(id, state.year);
  const F = sim.F;
  const K = MODEL.sessionsPerPost;
  const pk = MODEL.peakKWPerBusyPost;
  const step = (n, t, p, formula, live) => `<div class="calc"><div class="cn">${n}</div><div><h4>${t}</h4><p>${p}</p>${formula ? `<div class="formula">${formula}</div>` : ''}<div class="live">${live.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('')}</div></div></div>`;
  return H('04 · ПАСПОРТ РАСЧЁТА', `Как получено решение для ${id}`, `Прозрачная цепочка расчёта: каждый шаг показывает формулу и текущие числа (год ${state.year}, сценарий «${SCENARIOS[state.scenario].name}»). Это прединвестиционная сценарная модель, а не инженерный расчёт сети.`, TAG.model) +
    step('01', 'Транспортный спрос', 'Спрос станции = базовые сессии × рост парка EV с поправкой на чувствительность района (редевелопмент ЗИЛ усиливает рост).', 'D = base × (1 + (F − 1) × sens)', [[int(def.sessions), 'база 2026, сессий/мес'], [`×${num(F, 2)}`, `рост парка F (${state.year})`], [num(def.sens, 2), 'чувствительность'], [int(st.D0), 'спрос D, сессий/мес']]) +
    step('02', 'Ёмкость станции', `Пропускная способность поста — ${K} сессий/мес в пик; мощность на пост ${MODEL.postKW} кВт. Эффективная ёмкость ограничена и постами, и долей допустимой мощности узла.`, 'cap = min(posts, H_node·(posts/Σposts) / P_пик) × K', [[st.posts, 'постов'], [int(st.capPosts), 'ёмкость по постам'], [int(st.capEff), 'эффективная ёмкость'], [st.limiter === 'power' ? 'мощность' : st.limiter === 'posts' ? 'посты' : '—', 'что ограничивает']]) +
    step('03', 'Загрузка, очередь, ожидание', 'Загрузка = обслуженный спрос / ёмкость. Ожидание — приближённая формула для многоканальной очереди (пиковый час). Риск очереди: ρ < 0,70 низкий; < 0,88 средний; иначе высокий.', 'load = served / cap;  ρ = (D + переток) / cap;  Wq ≈ 0,55·S·ρ^(√(2(c+1))−1) / (c·(1−ρ))', [[pct(st.load), 'загрузка'], [num(st.rho, 2), 'ρ (давление спроса)'], [`~${Math.round(st.wait)} мин`, 'ожидание в пик'], [{ low: 'низкий', mid: 'средний', high: 'высокий' }[st.queueRisk], 'риск очереди']]) +
    step('04', 'Ограничения энергосистемы', `Плановая EV-мощность узла сравнивается с допустимой (сценарное допущение). Статус: < ${MODEL.gridWarn * 100}% — норма, до ${MODEL.gridCrit * 100}% — нагрев, выше — GRID CONSTRAINT. Накопитель, усиление сети и генерация меняют допустимую мощность.`, 'P_желаемая = Σ (D/K)·P_пост;   util = P_желаемая / H;   H = H₀ + storage + upgrade + gen', [[num(node.desired, 2) + ' МВт', 'желаемая мощность узла'], [num(node.H, 2) + ' МВт', 'допустимая H'], [pct(node.util), 'util узла'], [node.status === 'constraint' ? 'CONSTRAINT' : node.status === 'warn' ? 'нагрев' : 'норма', 'статус']]) +
    step('05', 'Переток спроса между станциями', `Неудовлетворённый спрос: ${Math.round((1 - MODEL.leak) * 100)}% перетекает к соседям со свободной ёмкостью (вес — свободная ёмкость × e^(−расстояние/${MODEL.spillDecayM} м)), остальное теряется. Новая станция дополнительно перехватывает часть спроса вблизи.`, 'Δ_j = spill_i · w_ij / Σw;   w_ij = spare_j · exp(−d_ij / λ)', [[int(st.spillIn), 'принято от соседей'], [int(st.spillOut), 'передано соседям'], [int(st.lost), 'потеряно, сессий/мес'], [`${Math.round(MODEL.leak * 100)}%`, 'доля ухода']]) +
    step('06', 'Экономика опции', `Маржа на сессию = ${MODEL.kwhPerSession} кВт·ч × (${MODEL.tariff} − ${MODEL.energyCost}) ₽ = ${int(marginPerSession())} ₽. NPV — по годам 2026–2035 при ставке ${Math.round(MODEL.discount * 100)}%, остаточная стоимость ${Math.round(MODEL.residual * 100)}% CAPEX.`, 'NPV = Σ (ΔМаржа − OPEX − CAPEX) / (1+r)^t  + остаточная стоимость', [[int(marginPerSession()) + ' ₽', 'маржа / сессия'], [Math.round(MODEL.discount * 100) + '%', 'дисконт'], [mln(rec.best.byScenario[state.scenario].npv), `NPV рекоменд. (${state.scenario})`], [rec.best.byScenario[state.scenario].irr == null ? '—' : pct(rec.best.byScenario[state.scenario].irr), 'IRR']]) +
    step('07', 'Выбор пакета: реальные опции и сожаление', `Первый шаг (${state.year < 2030 ? '2026/2027' : 'текущий год'}) оценивается вместе с оптимальным ответом в 2030. Пакеты сравниваются по ожидаемому NPV минус 0,35 × максимальное сожаление в трёх сценариях.`, 'score = Σ p_s·V_s − 0,35 · max_s(V*_s − V_s)', [[pkText(rec.best.options), 'рекомендованный пакет'], [mln(rec.best.expNpv), 'ожидаемый NPV'], [mln(rec.best.maxRegret), 'макс. сожаление'], [Object.values(rec.weights).map(v => Math.round(v * 100)).join(' / ') + ' %', 'веса сценариев']]) +
    `<div class="sec" style="margin-top:26px"><div class="sec-h"><h3 class="mono">Что модель НЕ делает</h3></div><div class="note warn">Не моделируются физические режимы электросети Москвы, реальные загрузки и мощности подстанций, фактические тарифы и CAPEX РСЗС. Результат — набор вариантов развития, который передаётся на последующую инженерную проверку.</div></div>`;
}

/* ---------- 05. СРАВНЕНИЕ ---------- */
const TR = [['Найти дефицит', 'Загрузка ЭЗС выше порога, очереди'], ['Построить ЭЗС', 'Новая станция рядом — независимо от сети и соседей'], ['Дождаться проблем сети', 'Ограничение мощности выявляется постфактум'], ['Дорогая модернизация', 'Реактивное усиление сети, простой станции']];
const EV = [['Спрос', 'Потоки по типам пользователей, сценарный рост'], ['Существующая сеть', 'Загрузка, очереди, переток между станциями'], ['Энергосеть', 'Допустимая мощность узла, накопители'], ['Сценарии', 'Низкий / базовый / высокий рост EV'], ['Инвестиционные варианты', '8 шагов: от «не строить» до новой ЭЗС'], ['Экономика и риск', 'NPV, IRR, сожаление по сценариям'], ['Инвестиционный шаг → следующий год', 'Решение меняет исходные данные будущего']];
function compareSheet() {
  return H('05 · СРАВНЕНИЕ ПОДХОДОВ', 'Traditional approach vs EV-Option Grid', 'Слева — привычная логика «определить дефицит → построить ЭЗС». Справа — цепочка, которая связывает спрос, сеть, экономику и последовательность шагов. Ниже — результат на тех же трёх сценариях.',
    `<button class="btn" data-act="cmp-replay">↻ Повторить анимацию</button>`) +
    `<div class="flowchart">
      <div class="col bad"><div class="mn" style="color:var(--st-high)">TRADITIONAL APPROACH</div><h3>Точка за точкой</h3><div class="lead">Определить дефицит → построить станцию</div><div class="steps">${TR.map((s, i) => `<div class="step" data-i="${i}"><div class="sn">${i + 1}</div><div><b>${s[0]}</b><span>${s[1]}</span></div></div>`).join('')}</div></div>
      <div class="col good"><div class="mn" style="color:#c6bdff">EV-OPTION GRID</div><h3>Последовательность решений</h3><div class="lead">Спрос → сеть → сценарии → варианты → шаг → следующий год</div><div class="steps">${EV.map((s, i) => `<div class="step" data-i="${i}"><div class="sn">${i + 1}</div><div><b>${s[0]}</b><span>${s[1]}</span></div></div>`).join('')}</div></div>
    </div>
    <div class="sec-h" style="margin-top:28px"><h3 class="mono">Результат траекторий 2026–2035 · критерии из постановки задачи</h3>${TAG.model}</div>
    <div id="cmpres" class="cmp-kpi"><div class="note">Считаю траектории для трёх сценариев…</div></div>
    <div class="note" style="margin-top:14px">Традиционная траектория: при загрузке ≥ 80% строится новая ЭЗС, сеть усиливается постфактум. EV-Option Grid: на каждой контрольной точке выбирается пакет с лучшим ожидаемым NPV и минимальным сожалением. Демо-модель — значения сценарные.</div>`;
}
export function stopCompare() { compareRun++; clearTimeout(compareTimer); }
function startCompare() {
  const my = ++compareRun;
  playSteps(my);
  computeCompare(my);
}
export function replaySteps() { const my = ++compareRun; document.querySelectorAll('#sheet .step').forEach(s => s.classList.remove('on')); playSteps(my); if (compareCache.html) computeCompare(my, true); }
function playSteps(my) {
  const cols = [...document.querySelectorAll('#sheet .col')];
  const max = Math.max(TR.length, EV.length);
  let i = 0;
  const tick = () => {
    if (my !== compareRun) return;
    cols.forEach(c => c.querySelector(`.step[data-i="${i}"]`)?.classList.add('on'));
    if (++i <= max) compareTimer = setTimeout(tick, 650);
  };
  tick();
}
async function computeCompare(my, again) {
  const out = $('#cmpres'); if (!out) return;
  if (compareCache.html && !again) { out.innerHTML = compareCache.html; return; }
  const res = {};
  for (const sc of Object.keys(SCENARIOS)) {
    await new Promise(r => setTimeout(r, 30)); if (my !== compareRun) return;
    const tp = traditionalPlan(ds, sc), rp = recommendedPlan(ds, sc);
    res[sc] = { tr: planKpis(ds, sc, tp), ev: planKpis(ds, sc, rp), tp, rp };
  }
  if (my !== compareRun) return;
  const block = (title, sub, get, fmt, better) => {
    const rows = Object.keys(SCENARIOS).map(sc => {
      const a = get(res[sc].tr), b = get(res[sc].ev); const mx = Math.max(a, b, 1e-6);
      return `<div class="brow tr"><span>${SCENARIOS[sc].short}</span><div class="bar"><i style="width:${(a / mx) * 100}%"></i></div><span class="num" style="text-align:right">${fmt(a)}</span></div>
              <div class="brow ev"><span></span><div class="bar"><i style="width:${(b / mx) * 100}%"></i></div><span class="num" style="text-align:right;color:#c6bdff">${fmt(b)}</span></div>`;
    }).join('<div style="height:6px"></div>');
    const d = (get(res.base.ev) - get(res.base.tr));
    return `<div class="card"><div class="mn">${sub}</div><h3>${title}</h3><div class="bars">${rows}</div><div class="note" style="margin-top:12px">Базовый сценарий: <b style="color:${better(d) ? 'var(--st-low)' : 'var(--st-high)'}">${better(d) ? '✓' : '✗'} EV-Option Grid ${d >= 0 ? '+' : '−'}${fmtDelta(title, Math.abs(d))}</b></div></div>`;
  };
  const fmtDelta = (t, v) => t.includes('издерж') ? int(v) + ' млн ₽' : (v * 100).toFixed(1).replace('.', ',') + ' п.п.';
  const html = block('Загрузка сети', 'Критерий 1 · выше — лучше', k => k.util, v => pct(v, 0), d => d > 0) +
    block('Инфраструктурные издержки', 'Критерий 2 · ниже — лучше', k => k.capex, v => int(v) + ' млн', d => d < 0) +
    block('Доступность зарядки', 'Критерий 3 · выше — лучше', k => k.availability, v => pct(v, 0), d => d > 0);
  const legend = `<div class="legend" style="grid-column:1/-1;margin-top:-4px"><span style="--c:#ff6b78"><i></i>Traditional approach</span><span style="--c:#8b7bff"><i></i>EV-Option Grid</span></div>`;
  compareCache.html = html + legend;
  if ($('#cmpres')) $('#cmpres').innerHTML = compareCache.html;
}
export function clearCompareCache() { compareCache = {}; }

/* ---------- 06. ДАННЫЕ ---------- */
function dataSheet() {
  const rows = assumptionRows();
  const groups = [...new Set(rows.map(r => r.g))];
  return H('06 · ДАННЫЕ И ДОПУЩЕНИЯ', 'Что подтверждено, а что — сценарий', 'Мы разделяем открытые данные и сценарные допущения. Ни одна демонстрационная цифра не выдаётся за данные РСЗС, ни один параметр сети — за инженерные данные.') +
    `<div class="cards3" style="margin-bottom:24px">
      <div class="card"><div style="margin-bottom:8px">${TAG.osm}</div><h3>Реальные объекты территории</h3><p>Здания, улицы, Москва-река, МЦК, ж/д, ТЭЦ-9 и подстанции — из OpenStreetMap: ${int(4002)} зданий, ${int(6133)} участков улиц. Положение узлов сети совпадает с объектами power=substation.</p></div>
      <div class="card"><div style="margin-bottom:8px">${TAG.verified}</div><h3>Адреса ЭЗС-ориентиров</h3><p>1-й Автозаводский проезд, 5 · Автозаводская ул., 5 и 7 · 1-й Кожуховский проезд · Восточная ул. · Мытная ул. Заданы командой, геокодированы; загрузка и принадлежность не подтверждены.</p></div>
      <div class="card"><div style="margin-bottom:8px">${TAG.scn}</div><h3>Сценарии и экономика</h3><p>Рост спроса, загрузка ЭЗС, мощность и резерв узлов, CAPEX/OPEX/NPV/IRR — демонстрационные значения MVP. Заменяются данными РСЗС и сетевой организации.</p></div></div>` +
    groups.map(g => `<div class="sec"><div class="sec-h"><h3 class="mono">${g}</h3></div><table class="tbl assum"><tbody>${rows.filter(r => r.g === g).map(r => `<tr><td>${r.g}</td><td>${r.k}</td><td>${r.v}</td><td>${PROV[r.p] || ''}</td><td>${r.note}</td></tr>`).join('')}</tbody></table></div>`).join('') +
    `<div class="sec" style="margin-top:24px"><div class="sec-h"><h3 class="mono">Об РСЗС (из описания задачи)</h3>${TAG.rszs}</div><div class="note" style="font-size:12px;max-width:820px;color:var(--paper-2)">ООО «Росатом Сеть зарядных станций» — дочерняя компания Росатома; на начало 2026 г. в контуре компании около 290 ЭЗС в 16 регионах, крупнейший кластер быстрых станций — в Москве; мощность станций до 150 кВт, стандарты GBT, CCS, CHAdeMO; ключевой поставщик оборудования — Парус Электро. Критерии проверки решения: рост загрузки сети, снижение инфраструктурных издержек, улучшение доступности зарядки; прогноз загрузки станции, влияние на соседние станции и сценарный анализ на несколько лет вперёд; экономическая модель и сравнение с традиционными подходами.</div></div>
    <div class="sec" style="margin-top:20px"><div class="note">© участники OpenStreetMap (лицензия ODbL). Геокодирование адресов — OSM Nominatim. Визуализация стилизована и не является инженерной GIS-моделью.</div></div>`;
}
