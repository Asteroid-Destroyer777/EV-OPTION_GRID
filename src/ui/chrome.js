// Каркас интерфейса: левая колонка, шкала времени + сценарий, цепочка решений, док слоёв, легенда, HUD.
import { state } from '../state.js';
import { YEARS, SCENARIOS, OPTIONS, MODEL, USER_TYPES } from '../simulation/params.js';
import { dataset as ds } from '../data/dataset.js';
import { recommendation } from '../actions.js';
import { int, num, pct, mln, TAG, ICONS, pkText } from './format.js';

const $ = (s) => document.querySelector(s);
const NAV = [['map', 'Карта сети'], ['scenarios', 'Сценарии'], ['plan', 'План развития'], ['passport', 'Паспорт расчёта'], ['compare', 'Сравнение подходов'], ['data', 'Данные и допущения']];
const MS_CAP = { 2026: 'существующая сеть', 2027: 'рост спроса · пилот', 2030: 'расширение сети', 2035: 'зрелая сеть' };

export function renderRail() {
  $('#rail').innerHTML = `
    <div class="brand">
      <div class="brand-row">
        <svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 2l10.5 6v14L15 28 4.5 22V8z" fill="none" stroke="#8b7bff" stroke-width="1.5"/><path d="M16.5 8l-5.5 8.5h4.2L14 22l5.6-8.6h-4.2z" fill="#ece8de"/></svg>
        <div class="brand-name">EV-OPTION<br><i>GRID</i></div>
      </div>
      <div class="brand-sub">Инвестиционное планирование зарядной инфраструктуры</div>
    </div>
    <div class="city"><b>Москва</b><span class="mn">ЗИЛ · Даниловский</span></div>
    <nav class="nav">${NAV.map(([k, t], i) => `<button data-act="view" data-arg="${k}" data-n="0${i + 1}"><span class="ix">0${i + 1}</span><span class="t">${t}</span></button>`).join('')}</nav>
    <div class="rail-sp"></div>
    <div class="rail-block">
      <div class="mn">Показ</div>
      <button class="rail-btn" data-act="demo">▶&nbsp; Вводный пролёт</button>
      <button class="rail-btn" data-act="guide">☰&nbsp; Сценарий защиты</button>
    </div>
    <div class="rail-block">
      <div class="mn">Происхождение данных</div>
      <div class="legend-row">${TAG.osm}<span>реальные объекты</span></div>
      <div class="legend-row">${TAG.scn}</div>
      <div class="legend-row">${TAG.demo}</div>
    </div>
    <div class="credit">Международные транспортные проектные соревнования · Проблема № 03<br>Заказчик — ООО «Росатом Сеть зарядных станций»</div>`;
}

export function renderTopbar() {
  const milestones = YEARS;
  const pos = (y) => { const i = milestones.indexOf(y); return (i / (milestones.length - 1)) * 100; };
  const ticks = [];
  for (let i = 0; i < milestones.length - 1; i++) {
    const a = milestones[i], b = milestones[i + 1];
    for (let y = a + 1; y < b; y++) ticks.push(`<i class="tl-tick" style="left:${pos(a) + ((y - a) / (b - a)) * (pos(b) - pos(a))}%"></i>`);
  }
  $('#topbar').innerHTML = `
    <div class="place">
      <div class="place-row">
        <svg class="compass" id="compass" viewBox="0 0 34 34" title="Направление на север">
          <circle cx="17" cy="17" r="15.5" fill="none" stroke="currentColor" stroke-opacity=".35"/>
          <g id="compassNeedle">
            <path d="M17 5.5L20.4 17 17 15.2 13.6 17z" fill="#ff6b6b"/>
            <path d="M17 28.5L20.4 17 17 18.8 13.6 17z" fill="currentColor" fill-opacity=".55"/>
          </g>
          <text x="17" y="4.6" text-anchor="middle" font-size="5.5" fill="currentColor" font-family="IBM Plex Mono">N</text>
        </svg>
        <div><div class="pt">ЗИЛ · Автозаводская</div><div class="pc mn">55.705° N · 37.657° E &nbsp;·&nbsp; Даниловский р-н, ЮАО</div></div>
      </div>
    </div>
    <div class="tl" id="tl">
      <button class="tl-play" data-act="play" title="Перемотка времени" id="tlplay">${ICONS.play}</button>
      <div class="tl-years">${milestones.map(y => `<div class="tl-y" data-act="year" data-arg="${y}" style="left:${pos(y)}%"><b>${y}</b><small>${MS_CAP[y]}</small></div>`).join('')}</div>
      <div class="tl-track" id="tltrack">
        <div class="tl-line"></div><div class="tl-fill" id="tlfill"></div>
        ${ticks.join('')}${milestones.map(y => `<i class="tl-tick ms" style="left:${pos(y)}%"></i>`).join('')}
        <div id="tlflags"></div>
        <div class="tl-thumb" id="tlthumb"></div>
      </div>
    </div>
    <div class="scn">
      <div class="mn"><span>Сценарий</span><span id="scnnote">${TAG.scn}</span></div>
      <div class="seg" id="scnseg">${Object.values(SCENARIOS).map(s => `<button data-act="scenario" data-arg="${s.id}">${s.name}</button>`).join('')}</div>
    </div>`;
  bindTimelineDrag();
}

function bindTimelineDrag() {
  const track = $('#tlthumb'), tl = $('#tltrack');
  let drag = false;
  const xToYear = (cx) => { const r = tl.getBoundingClientRect(); const t = Math.max(0, Math.min(1, (cx - r.left) / r.width)); const i = Math.round(t * (YEARS.length - 1)); return YEARS[i]; };
  const move = (e) => { if (!drag) return; const r = tl.getBoundingClientRect(); const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); track.style.left = t * 100 + '%'; $('#tlfill').style.width = t * 100 + '%'; const y = xToYear(e.clientX); if (y !== state.year) window.__act?.setYear(y); };
  track.addEventListener('pointerdown', e => { drag = true; track.classList.add('drag'); track.setPointerCapture(e.pointerId); });
  track.addEventListener('pointermove', move);
  const up = (e) => { if (!drag) return; drag = false; track.classList.remove('drag'); updateTimeline(); };
  track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
  tl.addEventListener('pointerdown', e => { if (e.target === track) return; const y = xToYear(e.clientX); window.__act?.setYear(y); });
}

export function updateTimeline() {
  const i = YEARS.indexOf(state.year); const t = (i / (YEARS.length - 1)) * 100;
  const th = $('#tlthumb'); if (!th || th.classList.contains('drag')) return;
  th.style.left = t + '%'; $('#tlfill').style.width = t + '%';
  document.querySelectorAll('.tl-y').forEach(el => { const y = +el.dataset.arg; el.classList.toggle('on', y === state.year); el.classList.toggle('past', y < state.year); });
  // флажки решений
  const cnt = {}; for (const d of state.decisions) cnt[d.year] = (cnt[d.year] || 0) + 1;
  $('#tlflags').innerHTML = Object.entries(cnt).map(([y, n]) => { const i2 = YEARS.indexOf(+y); return i2 < 0 ? '' : `<span class="tl-flag" style="left:${(i2 / (YEARS.length - 1)) * 100}%;top:20px" title="Решений в ${y}: ${n}">◆ ${n}</span>`; }).join('');
  document.querySelectorAll('#scnseg button').forEach(b => b.classList.toggle('on', b.dataset.arg === state.scenario));
  const pl = $('#tlplay'); if (pl) pl.innerHTML = state.playing ? ICONS.pause : ICONS.play;
}

export function renderDock() {
  const L = [['city', 'CITY', '1'], ['demand', 'DEMAND', '2'], ['grid', 'GRID', '3'], ['investment', 'INVESTMENT', '4'], ['future', 'FUTURE', '5']];
  $('#dock').innerHTML = L.map(([k, n, h]) => `<button class="dk" data-act="layer" data-arg="${k}"><span class="kk">${h}</span><span class="nn">${ICONS[k]}${n}</span></button>`).join('') +
    `<button class="dk walk" data-act="walk"><span class="kk">6 · WASD</span><span class="nn">${ICONS.walk}WALK</span></button>`;
}
export function updateDock() {
  document.getElementById('app').dataset.view = state.view;
  document.querySelectorAll('#dock .dk[data-act="layer"]').forEach(b => b.classList.toggle('on', b.dataset.arg === state.activeLayer));
  document.querySelectorAll('#rail .nav button').forEach(b => b.classList.toggle('on', b.dataset.arg === state.view));
}

export function renderLegend() {
  const el = document.createElement('div'); el.className = 'legend-3d'; el.id = 'legend3d';
  $('#ui').appendChild(el);
}
export function updateLegend() {
  const el = $('#legend3d'); if (!el) return;
  const l = state.activeLayer;
  let h = `<div class="mn">Загрузка ЭЗС</div>
    <div class="lr"><i style="background:var(--st-low)"></i>&lt; 50% · низкая</div>
    <div class="lr"><i style="background:var(--st-mid)"></i>50–80% · нормальная</div>
    <div class="lr"><i style="background:var(--st-high)"></i>&gt; 80% · высокая, очередь</div>
    <div class="lr"><i class="sq"></i>сетевое ограничение</div>`;
  if (l === 'demand' || l === 'city') h += `<div class="mn" style="margin-top:8px">Транспортный спрос</div><div class="flowleg">${['private_ev', 'taxi', 'corporate', 'ebus', 'municipal'].map(k => { const t = USER_TYPES[k]; return `<span data-act="flowtype" data-arg="${k}" style="--c:${t.color}"><i></i>${t.name}</span>`; }).join('')}</div>`;
  if (l === 'grid') h += `<div class="mn" style="margin-top:8px">Энергосистема</div><div class="lr"><i style="background:var(--cyan)"></i>допустимая EV-мощность</div><div class="lr"><i style="background:var(--st-high)"></i>желаемая &gt; допустимой</div>`;
  h += `<div class="prov">Сценарная модель · демо-значения<br>не инженерные данные</div>`;
  el.innerHTML = h;
}

export function renderHud() {
  $('#hud').innerHTML = `
    <div class="xhair"></div>
    <div class="prompt" id="prompt"><div class="pe"><kbd>E</kbd><span>Press E to interact</span></div><small id="promptlbl"></small></div>
    <div class="pausebox" id="pausebox"><b>Курсор освобождён</b>Кликните по сцене, чтобы продолжить прогулку · Esc — выйти</div>
    <div class="walkbar"><span><kbd>WASD</kbd>движение</span><span><kbd>Mouse</kbd>обзор</span><span><kbd>Shift</kbd>бег</span><span><kbd>Space</kbd>прыжок</span><span><kbd>E</kbd>взаимодействие</span><span><kbd>Q</kbd>под землю (GRID)</span><span><kbd>Esc</kbd>выйти</span></div>
    <div class="depth" id="depthind">◇ ПОДЗЕМНЫЙ СЛОЙ</div>`;
}

/* ---------------- цепочка ---------------- */
export function renderChain() {
  const sim = state.networkState; if (!sim) return;
  const hero = sim.byId['ZIL-01'];
  const T = sim.totals;
  const st = state.selectedStation || 'ZIL-01';
  const pkg = state.decisions.filter(d => d.station === st && d.year === state.year)[0];
  const rec = state.selectedStation ? recommendation(st, state.year) : null;
  const ncap = Object.values(sim.nodes).filter(n => n.status === 'constraint').length;
  const totalCapex = sim.totals.capexCum;
  const steps = [
    ['TRANSPORT DEMAND', `парк EV ×${num(sim.F, 2)}`, sim.F > 2 ? 'warn' : '', 'demand'],
    ['CHARGING NETWORK', `${pct(T.util)} · ${sim.stations.length} ЭЗС`, T.util > 0.8 ? 'bad' : T.util > 0.55 ? 'warn' : 'ok', 'city'],
    ['GRID CONSTRAINTS', ncap ? `${ncap} узл. ограничено` : 'в норме', ncap ? 'bad' : 'ok', 'grid'],
    ['INVESTMENT OPTIONS', pkg ? pkg.options.map(o => OPTIONS[o].code.split(' ')[0]).join('+') : '8 вариантов', '', 'investment'],
    ['ECONOMICS + RISK', rec ? `NPV ${mln(rec.best.expNpv)}` : 'выберите ЭЗС', '', 'economics'],
    ['SEQUENTIAL PLAN', state.decisions.length ? `${state.decisions.length} шаг. · ${int(totalCapex)} млн ₽` : 'план не задан', '', 'plan'],
  ];
  const cur = state.view === 'plan' ? 5 : state.panelTab === 'economics' ? 4 : { city: 1, demand: 0, grid: 2, investment: 3, future: 5 }[state.activeLayer] ?? 1;
  $('#chain').innerHTML = steps.map((s, i) => `<button class="ch ${i === cur ? 'on' : ''}" data-act="chain" data-arg="${s[3]}"><span class="k">${String(i + 1).padStart(2, '0')} · ${s[0]}</span><span class="v ${s[2]}">${s[1]}</span></button>`).join('');
}
