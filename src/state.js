// Единое состояние приложения. Изменение любого поля обновляет 3D, симуляцию и UI.
export const state = {
  city: 'moscow',
  year: 2026,
  scenario: 'base',
  activeLayer: 'city',
  selectedZone: 'zil',
  selectedStation: null,
  selectedNode: null,
  selectedSite: null,
  selectedFlow: null,
  investmentOption: null,      // выбранная (сфокусированная) опция для паспорта решения
  focusOption: null,
  hoverOption: null,
  previewStation: null,
  decisions: [],               // [{ station, year, options:[…] }] — последовательность инвестиционных решений
  networkState: null,          // результат симуляции для текущих year/scenario/decisions
  walkMode: false,
  view: 'map',                 // map | scenarios | plan | passport | compare | data
  panelTab: 'passport',
  recommended: [],
  recBest: [],
  playing: false,
  demo: false,                 // идёт вводная последовательность
  prevYear: null,
  guideOpen: false,
  guideTick: 0,
  _seen: {},
  hoverFrom3d: false,
};

const subs = new Set();
let pending = null, scheduled = false;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function setState(patch, { sync = false } = {}) {
  let changed = false;
  for (const k of Object.keys(patch)) {
    if (state[k] !== patch[k]) { state[k] = patch[k]; (pending ||= new Set()).add(k); changed = true; }
  }
  if (!changed) return;
  if (sync) return flush();
  if (!scheduled) { scheduled = true; queueMicrotask(flush); }
}
export function flush() {
  scheduled = false;
  const keys = pending; pending = null;
  if (!keys) return;
  for (const fn of subs) { try { fn(state, keys); } catch (e) { console.error(e); } }
}
