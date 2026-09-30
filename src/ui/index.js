// Оркестрация интерфейса: события, горячие клавиши, подсказки, тосты, чек-лист «Сценарий защиты».
import { state, setState } from '../state.js';
import { dataset as ds } from '../data/dataset.js';
import * as A from '../actions.js';
import { USER_TYPES, OPTIONS, YEARS } from '../simulation/params.js';
import { recommendedPlan } from '../simulation/policies.js';
import { renderRail, renderTopbar, renderDock, renderLegend, renderHud, renderChain, updateTimeline, updateDock, updateLegend } from './chrome.js';
import { renderPanel } from './panel.js';
import { renderSheet, replaySteps, clearCompareCache } from './sheets.js';
import { esc, pct, TAG } from './format.js';

const $ = (s) => document.querySelector(s);
let playTimer = null, toastTimer = null;

export function initUI() {
  window.__types = USER_TYPES;
  renderRail(); renderTopbar(); renderDock(); renderLegend(); renderHud();
  window.__act = A;
  document.addEventListener('click', onClick);
  document.addEventListener('mouseover', e => { const h = e.target.closest?.('[data-hover]'); if (h) A.hoverOption(h.dataset.hover); });
  document.addEventListener('mouseout', e => { const h = e.target.closest?.('[data-hover]'); if (h && !h.contains(e.relatedTarget)) A.hoverOption(null); });
  document.addEventListener('keydown', onKey);
  A.bind({ toast });
}

function onClick(e) {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, arg = el.dataset.arg;
  switch (act) {
    case 'view': A.setView(arg); break;
    case 'year': A.setYear(+arg); break;
    case 'scenario': A.setScenario(arg); break;
    case 'layer': A.setLayer(arg); break;
    case 'walk': toggleWalk(); break;
    case 'play': togglePlay(); break;
    case 'station': A.selectStation(arg); break;
    case 'node': A.selectNode(arg); break;
    case 'close': A.clearSelection(); break;
    case 'tab': if (arg === 'options' && state.panelTab === 'passport') { setState({ panelTab: arg }); A.setLayer('investment'); } else setState({ panelTab: arg }); break;
    case 'apply-rec': A.applyRecommended(); break;
    case 'reset-pkg': A.setPackage(state.selectedStation, state.year, []); break;
    case 'opt': A.toggleOption(arg); break;
    case 'opt-focus': A.focusOption(arg); break;
    case 'rm-dec': { const [s, y] = arg.split(':'); A.removeDecision(s, +y); break; }
    case 'pkg': A.setPackage(state.selectedStation, state.year, [arg]); setState({ panelTab: 'decision' }); break;
    case 'plan-rec': { toast('Считаю рекомендованную траекторию…'); setTimeout(() => { const n = A.applyRecommendedPlan(); toast(`Траектория применена: ${n.length} шаг(ов)`); }, 30); break; }
    case 'plan-clear': A.clearDecisions(); break;
    case 'cmp-replay': replaySteps(); break;
    case 'demo': window.__demo?.start(); break;
    case 'guide': setState({ guideOpen: !state.guideOpen }); break;
    case 'chain': onChain(arg); break;
    case 'flowtype': { const f = ds.flows.find(x => x.type === arg); if (f) A.selectFlow(f.id); break; }
    case 'guide-do': guideDo(+arg); break;
    case 'guide-close': setState({ guideOpen: false }); break;
    case 'teleport': window.__teleport?.(arg); break;
    case 'panel-toggle': document.querySelector('#panel').classList.toggle('collapsed'); break;
    case 'toast-x': break;
  }
}
function onChain(arg) {
  if (arg === 'plan') return A.setView('plan');
  if (arg === 'economics') { if (!state.selectedStation) A.selectStation('ZIL-01'); return setState({ panelTab: 'economics', view: 'map' }); }
  if (state.view !== 'map') A.setView('map');
  if (arg === 'city' && !state.selectedStation) A.selectStation('ZIL-01', { fly: true });
  A.setLayer(arg);
}
export function toggleWalk() { state.walkMode ? A.exitWalk() : A.enterWalk(); }
function togglePlay() {
  if (state.playing) { clearInterval(playTimer); setState({ playing: false }); return; }
  setState({ playing: true });
  let i = YEARS.indexOf(state.year); if (i >= YEARS.length - 1) { i = -1; }
  const step = () => { i++; if (i >= YEARS.length) { clearInterval(playTimer); setState({ playing: false }); return; } A.setYear(YEARS[i]); };
  step(); playTimer = setInterval(step, 2600);
}
export function stopPlay() { if (state.playing) { clearInterval(playTimer); setState({ playing: false }); } }

function onKey(e) {
  if (e.target.closest?.('input,textarea,select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (state.demo) { if (k === 'Escape') window.__demo?.skip(); return; }
  if (['1', '2', '3', '4', '5'].includes(k)) { A.setLayer(['city', 'demand', 'grid', 'investment', 'future'][+k - 1]); return; }
  if (k === '6') { toggleWalk(); return; }
  if (state.walkMode) return;
  if (k === 'Escape') { if (state.view !== 'map') A.setView('map'); else if (state.selectedStation || state.selectedNode || state.selectedFlow) A.clearSelection(); return; }
  if (k === ',' || k === '<') { const i = YEARS.indexOf(state.year); if (i > 0) A.setYear(YEARS[i - 1]); }
  if (k === '.' || k === '>') { const i = YEARS.indexOf(state.year); if (i < YEARS.length - 1) A.setYear(YEARS[i + 1]); }
}

export function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- всплывающая подсказка над объектами 3D ---------- */
export function showTip(x, y, html) {
  const t = $('#tooltip'); if (!html) { t.hidden = true; return; }
  t.innerHTML = html; t.hidden = false;
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.min(window.innerWidth - w - 10, x + 16) + 'px'; t.style.top = Math.min(window.innerHeight - h - 10, y + 16) + 'px';
}
export function tipFor(hit) {
  const sim = state.networkState; if (!hit || !sim) return null;
  if (hit.kind === 'station') { const s = sim.byId[hit.id]; if (!s) return null; return `<b>ЭЗС ${s.id}</b>Загрузка ${pct(s.load)} · ${s.posts} постов${s.queueRisk === 'high' ? '<br><span style="color:var(--st-high)">очередь ~' + Math.round(s.wait) + ' мин</span>' : ''}${s.status === 'constraint' ? '<br><span style="color:#c6bdff">GRID CONSTRAINT</span>' : ''}<br><span class="mn">клик — паспорт</span>`; }
  if (hit.kind === 'node') { const n = sim.nodes[hit.id]; return `<b>ПС ${hit.id.replace('SUB-', '')}</b>Допустимая ${n.H.toFixed(2)} МВт · плановая ${n.desired.toFixed(2)} МВт<br>${TAG.scn}<br><span class="mn">клик — энергетический паспорт</span>`; }
  if (hit.kind === 'site') return `<b>Потенциальная площадка</b>Рядом с ${hit.id}<br><span class="mn">клик — варианты инвестиций</span>`;
  if (hit.kind === 'flow') { const f = ds.flows.find(x => x.id === hit.id); const t = USER_TYPES[f.type]; return `<b style="color:${t.color}">${t.name}</b>Пик: ${t.peak}<br><span class="mn">клик — профиль спроса</span>`; }
  if (hit.kind === 'pod') { const o = OPTIONS[hit.option]; return `<b style="color:${o.color}">${o.code}</b>${o.short}<br><span class="mn">клик — добавить в пакет</span>`; }
  return null;
}

/* ---------- сценарий защиты: чек-лист ---------- */
const GUIDE = [
  ['Открыть ЗИЛ', 'Общий вид района на цифровом двойнике', () => true],
  ['Увидеть высокий спрос', 'Режим DEMAND (клавиша 2)', () => state.activeLayer === 'demand' || state._seen?.demand, () => A.setLayer('demand')],
  ['Подойти к ZIL-01', 'WALK (клавиша 6) — подойдите к станции', () => state._seen?.near, () => A.enterWalk('ZIL-01')],
  ['Нажать E', 'Взаимодействие у станции', () => state._seen?.interact, () => { if (!state.walkMode) A.selectStation('ZIL-01'); state._seen = { ...(state._seen || {}), interact: true }; }],
  ['Увидеть загрузку станции', 'Паспорт ЭЗС ZIL-01', () => state.selectedStation === 'ZIL-01', () => A.selectStation('ZIL-01')],
  ['Включить GRID', 'Режим GRID (клавиша 3)', () => state.activeLayer === 'grid' || state._seen?.grid, () => A.setLayer('grid')],
  ['Опуститься под землю', 'Камера ниже уровня земли (в WALK — клавиша Q)', () => state._seen?.under, () => { A.setLayer('grid'); const t = A.ctx.twin; t.orbit.flyTo({ tx: ds.byId['ZIL-01'].pos.x, ty: -12, tz: ds.byId['ZIL-01'].pos.z, dist: 160, pol: 1.7 }, 1.6); }],
  ['Увидеть GRID CONSTRAINT', 'Узел ZIL-01: плановая мощность выше допустимой', () => state.networkState?.nodes['SUB-ZIL-01']?.status === 'constraint' && state.activeLayer === 'grid', () => { A.setYear(2030); A.setLayer('grid'); }],
  ['Открыть INVESTMENT OPTIONS', 'Режим INVESTMENT (клавиша 4)', () => state.activeLayer === 'investment', () => A.setLayer('investment')],
  ['Сравнить варианты', 'Наведите на 3+ из 8 вариантов', () => (state._seen?.opts?.size || 0) >= 3, () => {}],
  ['Выбрать EXPANSION + STORAGE', 'Кликните оба варианта', () => state.decisions.some(d => d.station === 'ZIL-01' && d.options.includes('expansion') && d.options.includes('storage')), () => { A.selectStation('ZIL-01', { fly: false }); A.setYear(2027); A.setPackage('ZIL-01', 2027, ['expansion', 'storage']); }],
  ['3D-модель изменилась', 'Новые посты и накопитель на площадке', () => state.decisions.some(d => d.station === 'ZIL-01'), () => {}],
  ['Переключить 2030', 'Шкала времени', () => state.year === 2030 || state._seen?.y2030, () => A.setYear(2030)],
  ['Увидеть эффект решения', 'Вкладка «Решение»', () => state.panelTab === 'decision' && state.decisions.length > 0, () => setState({ panelTab: 'decision' })],
  ['Переключить 2035', 'Шкала времени', () => state.year === 2035 || state._seen?.y2035, () => A.setYear(2035)],
  ['Увидеть итоговую сеть', 'Режим FUTURE (клавиша 5) — только выбранные объекты', () => state.activeLayer === 'future' && state.decisions.length > 0, () => A.setLayer('future')],
];
export function renderGuide() {
  let el = $('#guide');
  if (!state.guideOpen) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'guide'; el.className = 'pnl'; $('#ui').appendChild(el); }
  const done = GUIDE.map(g => !!g[2]());
  const cur = done.findIndex(d => !d);
  el.innerHTML = `<div class="gh"><div><div class="mn" style="color:#c6bdff">Сценарий защиты</div><b>${done.filter(Boolean).length} / ${GUIDE.length}</b></div><button class="x" data-act="guide-close">×</button></div>
    <div class="gl">${GUIDE.map((g, i) => `<div class="gi ${done[i] ? 'ok' : i === cur ? 'cur' : ''}"><i>${done[i] ? '✓' : i + 1}</i><div><b>${g[0]}</b><span>${g[1]}</span></div>${g[3] && !done[i] ? `<button class="btn sm" data-act="guide-do" data-arg="${i}">▶</button>` : ''}</div>`).join('')}</div>`;
}
function guideDo(i) { const g = GUIDE[i]; if (g && g[3]) g[3](); }

export function updateUI(changed) {
  const has = (...k) => k.some(x => changed.has(x));
  updateTimeline(); updateDock(); updateLegend();
  renderChain();
  if (has('selectedStation', 'selectedNode', 'selectedFlow', 'selectedSite', 'panelTab', 'view', 'year', 'scenario', 'decisions', 'activeLayer', 'networkState', 'walkMode')) renderPanel();
  if (has('view', 'year', 'scenario', 'decisions', 'selectedStation', 'networkState')) renderSheet();
  if (has('guideOpen', 'year', 'scenario', 'decisions', 'activeLayer', 'selectedStation', 'panelTab', 'walkMode', 'focusOption')) renderGuide();
  if (has('decisions', 'scenario')) clearCompareCache();
}
