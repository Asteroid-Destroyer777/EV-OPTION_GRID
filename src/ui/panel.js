// Правая контекстная панель: паспорт ЭЗС, варианты, паспорт решения, экономика; паспорт подстанции, площадки, потока спроса, обзор кластера.
import { state } from '../state.js';
import { dataset as ds } from '../data/dataset.js';
import { evaluate } from '../simulation/engine.js';
import { seriesCached } from '../simulation/economics.js';
import { recommendation, currentPackage } from '../actions.js';
import { explain } from '../simulation/explain.js';
import { pkgKey } from '../simulation/recommend.js';
import { OPTIONS, OPTION_LIST, USER_TYPES, SCENARIOS, MODEL, ALL_YEARS, YEARS, growthAt } from '../simulation/params.js';
import { num, int, pct, mln, sgn, esc, TAG, chipStatus, STATUS_RU, RISK_RU, riskCls, pkCode, pkText, pkRu, lineChart, nodeBars, demandCurve, ICONS } from './format.js';

const $ = (s) => document.querySelector(s);
let lastKey = '';
let lastSelId = undefined;

/** Узкий экран: панель превращается в нижний лист и может закрыть карту — добавляем «ручку» сворачивания. */
const GRABBER = `<div class="grabber" data-act="panel-toggle" title="Свернуть / развернуть"><i></i></div>`;

export function renderPanel() {
  const p = $('#panel');
  const anySel = state.selectedStation || state.selectedNode || state.selectedFlow;
  if (state.view !== 'map' || (state.walkMode && !anySel)) { p.hidden = true; return; }
  p.hidden = false; p.classList.add('pnl');
  // новый объект выбран — разворачиваем лист, даже если до этого пользователь его сворачивал; переключение вкладок того же объекта состояние не трогает
  const selId = state.selectedStation || state.selectedNode || state.selectedFlow || null;
  if (selId !== lastSelId) { p.classList.remove('collapsed'); lastSelId = selId; }
  const key = `${state.selectedStation}|${state.selectedNode}|${state.selectedFlow}|${state.panelTab}`;
  const body = p.querySelector('.pbody'); const scroll = body && key === lastKey ? body.scrollTop : 0;
  let html;
  if (state.selectedStation && ds.byId[state.selectedStation]) html = stationPanel();
  else if (state.selectedStation && state.networkState?.byId[state.selectedStation]) html = newStationPanel();
  else if (state.selectedNode) html = nodePanel();
  else if (state.selectedFlow) html = flowPanel();
  else html = clusterPanel();
  p.innerHTML = GRABBER + html;
  lastKey = key;
  const nb = p.querySelector('.pbody'); if (nb) nb.scrollTop = scroll;
}

const head = (tagHTML, title, sub, closable = true) => `<div class="ph"><div class="row">${tagHTML}</div><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}${closable ? `<button class="x" data-act="close" title="Закрыть">${ICONS.x}</button>` : ''}</div>`;
const sec = (title, inner, right = '') => `<div class="sec"><div class="sec-h"><h3>${title}</h3>${right}</div>${inner}</div>`;

/* =================== ЭЗС =================== */
function stationPanel() {
  const sim = state.networkState, id = state.selectedStation, def = ds.byId[id], st = sim.byId[id];
  const tabs = [['passport', 'Паспорт'], ['options', 'Варианты'], ['decision', 'Решение'], ['economics', 'Экономика']];
  const tab = state.panelTab;
  let body = '';
  if (tab === 'options') body = optionsTab(def, st);
  else if (tab === 'decision') body = decisionTab(def, st);
  else if (tab === 'economics') body = economicsTab(def, st);
  else body = passportTab(def, st);
  return `${head(`<span class="tag">EV STATION</span>${TAG.verified}${TAG.demoScn}`, `ЭЗС ${id}`, `${esc(def.address)} · ${esc(def.zone)}`)}
    <div class="tabs">${tabs.map(([k, t]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${t}</button>`).join('')}</div>
    <div class="pbody">${body}</div>`;
}

function newStationPanel() {
  const st = state.networkState.byId[state.selectedStation];
  const def = { ...st.def, address: 'Площадка-кандидат рядом с ' + st.anchor, zone: 'новая станция' };
  return `${head(`<span class="tag">EV STATION</span><span class="tag scn">Новая · сценарий</span>`, `ЭЗС ${st.id}`, esc(def.address))}<div class="pbody">${passportTab(def, st, true)}</div>`;
}

function passportTab(def, st, isNew = false) {
  const sim = state.networkState;
  const node = sim.nodes[st.node];
  const base = evaluate(ds, { year: state.year, scenario: state.scenario, decisions: [] });
  const s30 = evaluate(ds, { year: Math.max(2030, state.year), scenario: state.scenario, decisions: state.decisions });
  const node30 = s30.nodes[st.node];
  // соседи
  const neigh = sim.stations.filter(x => x.id !== st.id).map(x => ({ x, d: Math.hypot(x.x - st.x, x.z - st.z), b: base.byId[x.id] })).sort((a, b) => a.d - b.d).slice(0, 4);
  const nearest = neigh[0];
  const dl = st.load - (base.byId[st.id]?.load ?? st.load);
  const rec = !isNew ? recommendation(st.id, state.year) : null;
  const pending = st.pending.map(p => `<span class="pk prog" style="--c:${OPTIONS[p.option].color}"><i></i>${OPTIONS[p.option].code} · ввод ${p.effYear}</span>`).join('');
  const builtChips = Object.entries(st.built).filter(([k]) => k !== 'none').map(([k, n]) => `<span class="pk done" style="--c:${OPTIONS[k].color}"><i></i>${OPTIONS[k].code}${n > 1 ? ' ×' + n : ''}</span>`).join('');
  const mixRows = Object.entries(st.def.mix).filter(([, v]) => v > 0).map(([k, v]) => { const t = USER_TYPES[k]; return `<div class="mixrow" style="--c:${t.color}"><div><span class="sw"></span>${t.name}</div><div class="bar"><i style="width:${v * 100}%"></i></div><div class="num mn" style="color:var(--paper-2)">${Math.round(v * 100)}%</div><div class="pk mn">пик ${t.peak}</div></div>`; }).join('');
  const gridCls = node.status === 'constraint' ? 'bad' : node.status === 'warn' ? 'warn' : '';
  const ser = seriesCached(ds, state.scenario, state.decisions), ser0 = seriesCached(ds, state.scenario, []);
  const chart = lineChart({
    series: [
      ...(state.decisions.length ? [{ pts: ser0.map((s, i) => [ALL_YEARS[i], s.byId[st.id]?.load ?? 0]), color: '#ff6b78', dash: true, w: 1.6 }] : []),
      { pts: ser.map((s, i) => [ALL_YEARS[i], s.byId[st.id]?.load ?? 0]), color: '#8b7bff', w: 2.4, area: true },
    ], cur: state.year, yMax: 1,
  });
  return `
    <div class="sec">
      <div class="bigload">
        <div class="n num">${Math.round(st.load * 100)}<small>%</small></div>
        <div class="d">${chipStatus(st.status)}<div class="note" style="margin-top:8px">Загрузка ЭЗС в расчётный пик · ${state.year} · ${SCENARIOS[state.scenario].short.toLowerCase()} сценарий${Math.abs(dl) > 0.005 ? ` · <span class="${dl < 0 ? 'pos' : 'neg'}">${sgn(dl * 100, 0)} п.п. к «без решений»</span>` : ''}</div></div>
      </div>
      ${(builtChips || pending) ? `<div class="rt" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">${builtChips}${pending}</div>` : ''}
    </div>
    ${sec('Ключевые параметры', `<div class="kv">
      <div><div class="mn">Сессии / мес</div><b class="num">${int(st.served)}<small>спрос ${int(st.D)}</small></b></div>
      <div><div class="mn">Средняя сессия</div><b class="num">${st.def.avgMin}<small>мин</small></b></div>
      <div><div class="mn">Посты</div><b class="num">${st.posts}<small>× ${MODEL.postKW} кВт</small></b></div>
      <div><div class="mn">Очередь (пик)</div><b class="num ${riskCls(st.queueRisk)}">${st.queueRisk === 'low' ? '<2' : '~' + Math.round(st.wait)}<small>мин · ${RISK_RU[st.queueRisk]}</small></b></div>
      <div><div class="mn">Свободная мощность узла</div><b class="num ${gridCls}">${num(Math.max(0, node.H - node.desired), 1)}<small>/ ${num(node.def.nominal, 0)} МВт</small></b></div>
      <div><div class="mn">Ближайшая ЭЗС</div><b class="num">${nearest ? num(nearest.d / 1000, 2) : '—'}<small>км · ${nearest ? nearest.x.id : ''}</small></b></div>
    </div>
    <div class="note" style="margin-top:6px">${TAG.demoScn} загрузка, сессии и время сессии — демонстрационные; принадлежность и текущая загрузка адреса не подтверждены.</div>`)}
    ${sec('Структура спроса', mixRows)}
    ${sec('Узел подключения', `<div class="grid-card">
        <div style="display:flex;justify-content:space-between;align-items:center"><b class="mono" style="color:var(--cyan)">${node.id.replace('SUB-', 'ПС ')}</b>${node.status === 'constraint' ? '<span class="chip constraint"><i></i>GRID CONSTRAINT</span>' : node.status === 'warn' ? '<span class="chip warn"><i></i>нагрев</span>' : '<span class="chip ok"><i></i>норма</span>'}</div>
        <div class="gauge2">${(() => { const max = Math.max(node.H, node.desired, node30.desired, 0.1) * 1.2; return `<div class="trk"></div><div class="fill ${node.status === 'constraint' ? 'bad' : node.status === 'warn' ? 'warn' : ''}" style="width:${(node.desired / max) * 100}%"></div><div class="cap" data-l="доп. ${num(node.H, 2)} МВт" style="left:${(node.H / max) * 100}%"></div><div class="scale"><span>0</span><span>${num(max, 1)} МВт</span></div>`; })()}</div>
        <div class="note">Текущий пик EV ${num(node.desired, 2)} МВт · прогноз ${Math.max(2030, state.year)}: <b style="color:${node30.desired > node30.H ? 'var(--st-high)' : 'var(--paper)'}">${num(node30.desired, 2)} МВт</b> (${sgn((node30.desired / Math.max(0.01, node.desired) - 1) * 100, 0)}%)</div>
        <div class="note scn" style="margin-top:8px">Сценарная модель — не инженерные данные.${node.def.osm.volt ? '' : ''}</div>
        <div style="margin-top:8px;display:flex;gap:8px"><button class="btn sm" data-act="node" data-arg="${node.id}">Паспорт узла</button><button class="btn sm" data-act="layer" data-arg="grid">Смотреть под землёй</button></div>
      </div>`)}
    ${neigh.length ? sec('Соседние станции · переток спроса', `<table class="tbl"><thead><tr><th>ЭЗС</th><th class="r">Расст.</th><th class="r">Загрузка</th><th class="r">К «без решений»</th></tr></thead><tbody>
      ${neigh.map(({ x, d, b }) => { const dd = b ? x.load - b.load : 0; return `<tr class="click" data-act="station" data-arg="${x.id}"><td><span class="chip ${x.status}" style="border:0;padding:0"><i></i></span>&nbsp;${x.id}${x.isNew ? ' <span class="star">NEW</span>' : ''}</td><td class="r num">${num(d / 1000, 2)} км</td><td class="r num">${pct(x.load)}</td><td class="r num ${dd < -0.005 ? 'pos' : dd > 0.005 ? 'neg' : ''}">${Math.abs(dd) > 0.005 ? sgn(dd * 100, 0) + ' п.п.' : '—'}</td></tr>`; }).join('')}</tbody></table>
      <div class="note" style="margin-top:6px">Неудовлетворённый спрос перетекает к соседям со свободной ёмкостью; после расширения или новой станции нагрузка перераспределяется.</div>`) : ''}
    ${sec('Динамика загрузки', chart + `<div class="legend"><span style="--c:#8b7bff"><i></i>${state.decisions.length ? 'с планом' : 'без решений'}</span>${state.decisions.length ? '<span style="--c:#ff6b78"><i class="dash"></i>без проекта</span>' : ''}</div>`, TAG.scn)}
    ${rec ? `<div class="sec"><div class="rec"><div class="mn" style="color:#c6bdff">Рекомендация EV-Option Grid · ${state.year}</div><div class="rt">${pkCode(rec.best.options)}</div><div class="note" style="color:var(--paper-2)">${rec.useRecourse ? 'Первый шаг оценивается вместе с ответным решением в 2030 — ценность гибкости.' : 'Оценка по трём сценариям с минимизацией сожаления.'}</div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn violet" data-act="apply-rec">Применить</button><button class="btn" data-act="tab" data-arg="options">Все 8 вариантов →</button></div></div></div>` : ''}`;
}

/* =================== ВАРИАНТЫ =================== */
function optionsTab(def, st) {
  const rec = recommendation(st.id, state.year);
  const cur = currentPackage();
  const bestSet = new Set(rec.best.options);
  const hist = state.decisions.filter(d => d.station === st.id).sort((a, b) => a.year - b.year);
  const cards = OPTION_LIST.map(o => {
    const p = rec.byKey[o.id]; const sc = p.byScenario[state.scenario];
    const isOn = cur.includes(o.id), isRec = bestSet.has(o.id);
    return `<button class="opt ${isOn ? 'on' : ''} ${isRec ? 'rec-o' : ''}" data-act="opt" data-arg="${o.id}" data-hover="${o.id}" style="--c:${o.color}">
      <div class="no">0${o.n}</div>
      <div>
        <div class="tt"><span class="cd" style="color:${o.color}">${o.code}</span>${isRec ? '<span class="star">★ В РЕКОМЕНДАЦИИ</span>' : ''}</div>
        <div class="nm">${o.name}</div>
        <div class="ds">${o.short}</div>
        <div class="mt"><span><small>CAPEX</small>${o.capex ? int(o.capex) : '0'} млн</span><span><small>NPV баз.</small><b class="${sc.npv >= 0 ? 'pos' : 'neg'}" style="font-weight:500">${sgn(sc.npv, 0)}</b></span><span><small>Ввод</small>${o.lead === 0 ? 'сразу' : '+' + o.lead + ' г.'}</span><span><small>Риск</small>${RISK_RU[p.riskUnder]}</span></div>
      </div><i class="ck"></i></button>`;
  }).join('');
  return `
    <div class="pkgbar">
      <div class="sec-h" style="margin-bottom:6px"><h3>Пакет решения · ${state.year}</h3>${TAG.scn}</div>
      <div style="min-height:24px">${cur.length ? pkCode(cur) : '<span class="note">Кликайте варианты — сцена меняется сразу. Совместимые варианты объединяются в пакет.</span>'}</div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-act="apply-rec">★ Рекомендуемый пакет</button><button class="btn" data-act="reset-pkg" ${cur.length ? '' : 'disabled'}>Сбросить</button></div>
      <div class="note" style="margin-top:9px">Год решения — ${state.year} (шкала времени). Решение 2027 года влияет на сеть 2030 и 2035.</div>
    </div>
    ${cards}
    ${hist.length ? sec('Принятые решения по станции', `<div class="hist">${hist.map(d => `<div class="h"><span class="y">${d.year}</span><span style="flex:1">${pkCode(d.options)}</span><button class="btn sm" data-act="rm-dec" data-arg="${d.station}:${d.year}">×</button></div>`).join('')}</div>`) : ''}`;
}

/* =================== ПАСПОРТ РЕШЕНИЯ =================== */
function decisionTab(def, st) {
  const cur = currentPackage();
  if (!cur.length) {
    const rec = recommendation(st.id, state.year);
    return `<div class="sec"><div class="explain">Решение ещё не выбрано. Откройте варианты и кликните один или несколько — система построит паспорт решения: <em>почему</em> этот пакет, что он даёт по спросу, сети и экономике.</div>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" data-act="apply-rec">★ Показать рекомендацию</button><button class="btn" data-act="tab" data-arg="options">Варианты</button></div>
      <div class="rec" style="margin-top:14px"><div class="mn" style="color:#c6bdff">Система предлагает · ${state.year}</div><div class="rt">${pkCode(rec.best.options)}</div></div></div>`;
  }
  const ex = explain(ds, { station: st.id, year: state.year, scenario: state.scenario, decisions: state.decisions, options: cur });
  const ind = ex.indicators;
  const wi = (k, l) => `<div><div class="mn">${l}</div><b class="${ind[k].cls}">${ind[k].v}</b><div class="note" style="margin-top:2px">${ind[k].note}</div></div>`;
  const ser = seriesCached(ds, state.scenario, state.decisions), ser0 = seriesCached(ds, state.scenario, state.decisions.filter(d => !(d.station === st.id && d.year === state.year)));
  const chart = lineChart({ series: [{ pts: ser0.map((s, i) => [ALL_YEARS[i], s.byId[st.id]?.rho ?? 0]), color: '#ff6b78', dash: true, w: 1.6 }, { pts: ser.map((s, i) => [ALL_YEARS[i], s.byId[st.id]?.rho ?? 0]), color: '#8b7bff', w: 2.4, area: true }], cur: state.year, yMax: 2, yFmt: (v) => Math.round(v * 100) + '%', marks: [{ x0: 2026, x1: 2035, color: 'rgba(0,0,0,0)' }] });
  const stairs = state.decisions.filter(d => d.station === st.id).sort((a, b) => a.year - b.year);
  const resp = ex.responses.find(r => r.scenario === state.scenario)?.response;
  return `
    <div class="sec">
      <div class="mn" style="color:#c6bdff">PASSPORT OF DECISION</div>
      <div class="rt" style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px">${pkCode(cur)}</div>
      <div class="note">${pkRu(cur)} · решение ${state.year} · ${SCENARIOS[state.scenario].name}</div>
    </div>
    ${sec('Почему? · WHY THIS OPTION', `<div class="why">${wi('demand', 'Demand')}${wi('load', 'Station load')}${wi('grid', 'Grid capacity')}${wi('queue', 'Queue risk')}${wi('capex', 'CAPEX')}${wi('risk', 'Risk')}</div>`, TAG.scn)}
    <div class="sec"><div class="explain">${ex.text.join(' ')}<div class="note" style="margin-top:9px;color:#b7acff;font-style:italic">${ex.en}</div></div></div>
    ${sec('Что это меняет · давление спроса на ёмкость', chart + '<div class="legend"><span style="--c:#8b7bff"><i></i>с этим решением</span><span style="--c:#ff6b78"><i class="dash"></i>без него</span></div><div class="note">Значение выше 100% — спрос превышает ёмкость: очередь и потерянные сессии.</div>')}
    ${sec('Последовательность решений', `<div class="stairs">${(stairs.length ? stairs : []).map(d => `<div class="stair"><div class="y num">${d.year}</div><div class="o"><b>${pkText(d.options)}</b><br>${d.year <= state.year ? 'принято' : 'запланировано'}${(() => { const l = Math.max(...d.options.map(o => OPTIONS[o].lead)); return l ? ` · ввод ${d.year + l}` : ' · ввод сразу'; })()}</div></div>`).join('')}
      ${resp && state.year < 2030 ? `<div class="stair"><div class="y num">2030</div><div class="o">Ответный шаг при сценарии «${SCENARIOS[state.scenario].short}»: <b>${resp[0] === 'none' ? 'ничего не добавлять' : pkText(resp)}</b><br><span class="note">решение принимается, когда неопределённость спроса раскрыта</span></div></div>` : ''}</div>`)}
    ${sec('Сравнение альтернатив', `<table class="tbl"><thead><tr><th>Пакет</th><th class="r">E[NPV]</th><th class="r">CAPEX</th><th class="r">Сожал.</th></tr></thead><tbody>${ex.alts.map(a => `<tr class="${a.chosen ? 'hi' : ''}"><td style="font:500 10px var(--f-mono);letter-spacing:.04em">${a.best ? '★ ' : ''}${pkText(a.options)}</td><td class="r num">${sgn(a.expNpv, 0)}</td><td class="r num">${int(a.capex)}</td><td class="r num">${int(a.regret)}</td></tr>`).join('')}</tbody></table><div class="note" style="margin-top:6px">млн ₽ · демо-модель. Сожаление — насколько пакет хуже лучшего в худшем сценарии.</div>`, TAG.demo)}`;
}

/* =================== ЭКОНОМИКА =================== */
function economicsTab(def, st) {
  const rec = recommendation(st.id, state.year);
  const cur = currentPackage();
  const focus = cur.length ? rec.byKey[pkgKey(cur)] : rec.best;
  const sc = focus.byScenario;
  const b = sc.base;
  const fl = b.econ.flows;
  const i30 = ALL_YEARS.indexOf(2030);
  const npvBar = (k) => { const v = sc[k].npv; const m = Math.max(60, ...Object.values(sc).map(s => Math.abs(s.npv))); return `<div class="brow ev" style="grid-template-columns:78px 1fr 62px"><span>${SCENARIOS[k].short}</span><div class="bar" style="background:linear-gradient(90deg,transparent 50%,var(--line) 50%)"><i style="left:${v >= 0 ? 50 : 50 + (v / m) * 50}%;width:${Math.abs(v) / m * 50}%;background:${v >= 0 ? '#8b7bff' : '#ff6b78'}"></i></div><span class="num" style="text-align:right">${sgn(v, 0)}</span></div>`; };
  const rows = OPTION_LIST.map(o => { const p = rec.byKey[o.id], s = p.byScenario.base; return `<tr class="click ${cur.length === 1 && cur[0] === o.id ? 'hi' : ''}" data-act="opt-focus" data-arg="${o.id}"><td style="font:500 10px var(--f-mono);letter-spacing:.05em;color:${o.color}">${o.code}</td><td class="r num">${o.capex ? int(o.capex) : 0}</td><td class="r num ${s.npv >= 0 ? 'pos' : 'neg'}">${sgn(s.npv, 0)}</td><td class="r num">${s.irr == null ? '—' : pct(s.irr)}</td><td class="r num">${s.payback ? s.payback + ' г.' : '—'}</td></tr>`; }).join('');
  return `
    <div class="note warn">ДЕМО-МОДЕЛЬ · сценарное допущение. Значения не являются данными РСЗС. NPV/IRR — от нетто-CAPEX оператора после софинансирования (${Math.round(MODEL.capexSubsidyShare * 100)}% полной стоимости — см. «Данные и допущения»).</div>
    ${sec(cur.length ? 'Выбранный пакет · ' + pkText(cur) : 'Рекомендуемый пакет · ' + pkText(rec.best.options), `<div class="kv">
      <div><div class="mn">CAPEX оператора</div><b class="num">${int(b.capex)}<small>млн ₽</small></b></div>
      <div><div class="mn">CAPEX полный (gross)</div><b class="num">${int((cur.length ? cur : rec.best.options).reduce((s, o) => s + (OPTIONS[o].grossCapex || 0), 0))}<small>млн ₽</small></b></div>
      <div><div class="mn">OPEX в год</div><b class="num">${num(b.opex2030 ?? 0, 1)}<small>млн ₽</small></b></div>
      <div><div class="mn">Доп. выручка 2030</div><b class="num">${num(b.dRev2030, 1)}<small>млн ₽/г</small></b></div>
      <div><div class="mn">NPV (база)</div><b class="num ${b.npv >= 0 ? 'pos' : 'neg'}">${sgn(b.npv, 1)}<small>млн ₽</small></b></div>
      <div><div class="mn">IRR</div><b class="num">${b.irr == null ? '—' : pct(b.irr)}</b></div>
      <div><div class="mn">Окупаемость</div><b class="num">${b.payback ? b.payback + '<small>лет</small>' : '> горизонта'}</b></div>
      <div><div class="mn">Загрузка станции 2030</div><b class="num">${pct(b.focusLoad2030)}<small>до: ${pct(b.loadBase2030)}</small></b></div>
      <div><div class="mn">Риск недозагрузки</div><b class="${riskCls(focus.riskUnder)}">${RISK_RU[focus.riskUnder]}</b></div>
      <div class="wide"><div class="mn">Срок реализации</div><b>${focus.lead === 0 ? 'немедленно' : '+' + focus.lead + ' г. после решения'}<small>ввод ${state.year + focus.lead}</small></b></div>
    </div>`, TAG.demo)}
    ${sec('NPV по сценариям (млн ₽)', `<div class="bars">${['low', 'base', 'high'].map(npvBar).join('')}</div><div class="note" style="margin-top:8px">Ожидаемый NPV ${sgn(focus.expNpv, 1)} · вес сценариев 25 / 50 / 25%. Разброс показывает неопределённость роста EV.</div>`)}
    ${sec('Денежные потоки, млн ₽', lineChart({ series: [{ pts: fl.map(f => [f.year, f.cash]), color: '#8b7bff', w: 2, dots: true, area: true }], yMax: Math.max(20, ...fl.map(f => f.cash)) * 1.1, yMin: Math.min(-10, ...fl.map(f => f.cash)) * 1.1, yFmt: (v) => Math.round(v), xTicks: [2026, 2027, 2030, 2035] }))}
    ${sec('Все варианты (база)', `<table class="tbl"><thead><tr><th>Вариант</th><th class="r">CAPEX</th><th class="r">NPV</th><th class="r">IRR</th><th class="r">Окуп.</th></tr></thead><tbody>${rows}</tbody></table>`)}`;
}

/* =================== ПОДСТАНЦИЯ =================== */
function nodePanel() {
  const sim = state.networkState, id = state.selectedNode, nd = ds.nodeById[id], n = sim.nodes[id];
  const data = YEARS.map(y => { const s = evaluate(ds, { year: y, scenario: state.scenario, decisions: state.decisions }); const nn = s.nodes[id]; return { year: y, H: nn.H, desired: nn.desired, cur: y === state.year }; });
  const s30 = data.find(d => d.year === 2030);
  const reserve = n.H - n.desired;
  const osm = nd.osm.name || nd.osm.volt || nd.osm.kind;
  const status = n.status === 'constraint' ? '<span class="chip constraint"><i></i>GRID CONSTRAINT</span>' : n.status === 'warn' ? '<span class="chip warn"><i></i>нагрев узла</span>' : '<span class="chip ok"><i></i>в норме</span>';
  return `${head(`<span class="tag">SUBSTATION</span>${TAG.osm}${TAG.scn}`, `ПС ${id.replace('SUB-', '')} — сценарный объект`, `Положение — по объекту OSM (power=substation${nd.osm.volt ? ', ' + nd.osm.volt.split(';').map(v => v / 1000).join('/') + ' кВ' : ''}); мощности — сценарные`)}
    <div class="pbody">
      <div class="note scn">Сценарное допущение, не инженерные данные. Прединвестиционная модель выявляет ограничение и передаёт варианты на инженерную проверку.</div>
      ${sec('Мощность узла · ' + state.year, `<div style="margin:2px 0 10px">${status}</div><div class="kv">
        <div><div class="mn">Доступная мощность</div><b class="num">${num(n.H, 2)}<small>МВт</small></b></div>
        <div><div class="mn">Текущая EV-нагрузка</div><b class="num">${num(n.desired, 2)}<small>МВт</small></b></div>
        <div><div class="mn">Резерв</div><b class="num ${reserve < 0 ? 'bad' : reserve < 0.3 ? 'warn' : 'ok'}">${num(reserve, 2)}<small>МВт</small></b></div>
        <div><div class="mn">Прогноз нагрузки 2030</div><b class="num ${s30.desired > s30.H ? 'bad' : ''}">${num(s30.desired, 2)}<small>МВт · ${sgn((s30.desired / Math.max(0.01, n.desired) - 1) * 100, 0)}%</small></b></div>
        <div class="wide"><div class="mn">Номинал узла (условный)</div><b class="num">${num(nd.nominal, 1)}<small>МВт · из них EV-допустимо ${num(nd.headroom, 1)} в базовом состоянии</small></b></div></div>`, TAG.scn)}
      ${sec('Допустимая vs желаемая мощность', nodeBars({ data, max: Math.max(...data.map(d => Math.max(d.H, d.desired))) * 1.25 }) + '<div class="legend"><span style="--c:#59d8e6"><i class="dash"></i>допустимая EV-мощность</span><span style="--c:#ffb83d"><i></i>плановая EV-нагрузка</span></div>')}
      ${sec('Питает станции', `<table class="tbl"><tbody>${n.stations.map(sid => { const s = sim.byId[sid]; return `<tr class="click" data-act="station" data-arg="${sid}"><td>${sid}</td><td class="r num">${s.posts} постов</td><td class="r num">${pct(s.load)}</td></tr>`; }).join('')}</tbody></table>`)}
      ${(n.storage || n.upgrade || n.gen) ? sec('Вложения в узел', `<div class="rt" style="display:flex;flex-wrap:wrap;gap:6px">${n.storage ? `<span class="pk done" style="--c:${OPTIONS.storage.color}"><i></i>STORAGE +${num(n.storage, 1)} МВт</span>` : ''}${n.upgrade ? `<span class="pk done" style="--c:${OPTIONS.grid_upgrade.color}"><i></i>GRID UPGRADE +${num(n.upgrade, 1)} МВт</span>` : ''}${n.gen ? `<span class="pk done"><i></i>LOCAL GEN</span>` : ''}</div>`) : ''}
      <div style="display:flex;gap:8px;margin-top:16px"><button class="btn" data-act="layer" data-arg="grid">Подземный слой</button><button class="btn primary" data-act="station" data-arg="${n.stations.find(s => !s.includes('-N'))}">Варианты для станций</button></div>
    </div>`;
}

/* =================== ПЛОЩАДКА =================== */
function sitePanel() { return ''; }
export function siteBlock(def) {
  const rec = recommendation(def.id, state.year);
  const ns = rec.byKey.new_station, b = ns.byScenario[state.scenario];
  const node = state.networkState.nodes[def.node];
  const s30 = evaluate(ds, { year: 2030, scenario: state.scenario, decisions: state.decisions });
  const n30 = s30.nodes[def.node];
  const demandLvl = state.networkState.byId[def.id].rho;
  const item = (l, v, c) => `<div><div class="mn">${l}</div><b class="${c || ''}">${v}</b></div>`;
  return `<div class="sec">${sec('INVESTMENT SITE · потенциальная площадка', `<div class="kv">
      ${item('Спрос', demandLvl > 0.9 ? 'высокий' : demandLvl > 0.65 ? 'растущий' : 'умеренный', demandLvl > 0.9 ? 'bad' : demandLvl > 0.65 ? 'warn' : 'ok')}
      ${item('Сетевая мощность', n30.status === 'constraint' ? 'ограничена' : n30.status === 'warn' ? 'на пределе' : 'достаточна', n30.status === 'constraint' ? 'bad' : n30.status === 'warn' ? 'warn' : 'ok')}
      ${item('CAPEX новой ЭЗС', OPTIONS.new_station.capex > 45 ? 'высокий' : 'средний', 'warn')}
      ${item('Риск ошибочной инвестиции', RISK_RU[ns.riskUnder], riskCls(ns.riskUnder))}
      </div>`, TAG.scn)}
    <div class="sec"><div class="sec-h"><h3>Варианты для площадки</h3></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn" data-act="pkg" data-arg="new_station">Построить сейчас</button><button class="btn" data-act="pkg" data-arg="defer">Подготовить площадку</button>
      <button class="btn" data-act="pkg" data-arg="storage">Установить накопитель</button><button class="btn" data-act="pkg" data-arg="none">Не инвестировать</button></div></div></div>`;
}

/* =================== ПОТОК СПРОСА =================== */
function flowPanel() {
  const f = ds.flows.find(x => x.id === state.selectedFlow); const t = USER_TYPES[f.type];
  const sim = state.networkState; const st = sim.byId[f.to];
  const yr = (y, sc) => growthAt(sc, y);
  const k = (0.55 + 0.45 * ((sim.F - 1) * f.growth + 1));
  return `${head(`<span class="tag">DEMAND FLOW</span>${TAG.scn}`, `${t.name}`, esc(f.label))}
    <div class="pbody">
      <div class="kv">
        <div><div class="mn">Пиковый спрос</div><b style="color:${t.color}">${t.peak}</b></div>
        <div><div class="mn">Относительная интенсивность</div><b class="num">×${num(k * f.w, 2)}<small>сейчас</small></b></div>
        <div><div class="mn">Назначение</div><b>${f.to}<small>загрузка ${pct(st.load)}</small></b></div>
        <div><div class="mn">Рост к 2035 (${SCENARIOS[state.scenario].short})</div><b class="num">×${num(1 + (growthAt(state.scenario, 2035) - 1) * f.growth, 2)}</b></div>
      </div>
      ${sec('Суточный профиль (иллюстративный)', demandCurve(f.type), TAG.demo)}
      ${sec('Требования к инфраструктуре', `<div class="note" style="color:var(--paper-2);font-size:12px">${t.need}</div>`)}
      ${sec('Рост по сценариям (2035)', `<table class="tbl"><tbody>${Object.values(SCENARIOS).map(s => `<tr><td>${s.name}</td><td class="r num">×${num(1 + (growthAt(s.id, 2035) - 1) * f.growth, 2)}</td></tr>`).join('')}</tbody></table>`)}
      <div class="note scn" style="margin-top:14px">SCENARIO DEMAND MODEL — демонстрационные значения; не фактическое число автомобилей.</div>
      <div style="margin-top:14px"><button class="btn" data-act="station" data-arg="${f.to}">Открыть станцию ${f.to}</button></div>
    </div>`;
}

/* =================== ОБЗОР КЛАСТЕРА =================== */
function clusterPanel() {
  const sim = state.networkState, T = sim.totals;
  const list = sim.stations.filter(s => !s.isNew).sort((a, b) => (b.rho + (b.status === 'constraint' ? 1 : 0)) - (a.rho + (a.status === 'constraint' ? 1 : 0)));
  return `${head(`<span class="tag">CLUSTER</span>${TAG.osm}${TAG.demoScn}`, 'Кластер ЗИЛ · Автозаводская', 'Где, когда и какой шаг сделать дальше?', false)}
    <div class="pbody">
      <div class="kv">
        <div><div class="mn">ЭЗС / постов</div><b class="num">${sim.stations.length}<small>/ ${T.posts}</small></b></div>
        <div><div class="mn">Загрузка сети</div><b class="num">${pct(T.util)}</b></div>
        <div><div class="mn">Доступность</div><b class="num ${T.availability < 0.9 ? 'bad' : ''}">${pct(T.availability)}</b></div>
        <div><div class="mn">Узлы в ограничении</div><b class="num ${T.constrainedNodes ? 'bad' : 'ok'}">${T.constrainedNodes}<small>из ${ds.nodes.length}</small></b></div>
      </div>
      ${sec('Приоритет внимания', `<table class="tbl"><thead><tr><th>ЭЗС</th><th class="r">Загрузка</th><th class="r">Очередь</th><th class="r">Сеть</th></tr></thead><tbody>${list.map(s => `<tr class="click" data-act="station" data-arg="${s.id}"><td><span class="chip ${s.status}" style="border:0;padding:0"><i></i></span>&nbsp;<b>${s.id}</b></td><td class="r num">${pct(s.load)}</td><td class="r num ${riskCls(s.queueRisk)}">${s.queueRisk === 'low' ? '—' : '~' + Math.round(s.wait) + ' мин'}</td><td class="r"><span class="chip ${sim.nodes[s.node].status === 'constraint' ? 'constraint' : sim.nodes[s.node].status === 'warn' ? 'warn' : 'ok'}" style="border:0;padding:0"><i></i></span></td></tr>`).join('')}</tbody></table>`)}
      <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
        <button class="btn primary block" data-act="station" data-arg="ZIL-01">Начать с проблемной зоны ZIL-01 →</button>
        <button class="btn block" data-act="layer" data-arg="demand">Показать транспортный спрос</button>
      </div>
      <div class="note scn" style="margin-top:16px"><b>Прединвестиционная сценарная модель.</b> Она выявляет варианты развития и передаёт их на последующую инженерную проверку; физический режим электросети Москвы не моделируется.</div>
    </div>`;
}
