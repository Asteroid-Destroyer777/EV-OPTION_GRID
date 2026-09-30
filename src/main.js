// EV-Option Grid — точка входа: данные → 3D-двойник → состояние → интерфейс → вводная демонстрация.
import * as THREE from 'three';
import { loadGeo, geo, polyBounds } from './data/geo.js';
import { initDataset, dataset } from './data/dataset.js';
import { createTwin } from './scene/twin.js';
import { state, setState, subscribe, flush } from './state.js';
import { evaluate } from './simulation/engine.js';
import { recommend } from './simulation/recommend.js';
import * as A from './actions.js';
import { initUI, updateUI, toast, renderGuide } from './ui/index.js';
import { WalkController } from './controls/walk.js';
import { initInteraction } from './controls/interaction.js';
import { createDemo } from './controls/demo.js';

const $ = (s) => document.querySelector(s);

async function boot() {
  const t0 = performance.now();
  await loadGeo('data/zil.json', p => { $('#bootbar').style.width = (p * 10) + '%'; });
  initDataset();
  initUI();
  const twin = await createTwin({ canvas: $('#gl'), labelsEl: $('#labels'), onStep: (t, p) => { $('#bootstep').textContent = t; $('#bootbar').style.width = (10 + p * 90) + '%'; } });
  twin.waterPolys = geo.data.water.map(w => ({ o: w.o, h: w.h || [], bb: polyBounds(w.o) }));

  /* ---------- ходьба ---------- */
  const prompt = $('#prompt'), pausebox = $('#pausebox');
  const mark = (k, v = true) => { state._seen = { ...state._seen, [k]: v }; setState({ guideTick: state.guideTick + 1 }); };
  const walk = new WalkController(twin, $('#gl'), {
    onEnter: () => { toast('WASD — движение · Mouse — обзор · Shift — бег · Space — прыжок · E — взаимодействие · Esc — выйти', 6000); },
    onExit: () => A.exitWalk(),
    onExitDone: () => { prompt.classList.remove('on'); pausebox.classList.remove('on'); $('#depthind').style.display = 'none'; },
    onPause: (p) => pausebox.classList.toggle('on', p),
    onToast: (m) => toast(m),
    onNear: (n) => {
      prompt.classList.toggle('on', !!n);
      if (n) { $('#promptlbl').textContent = n.label; if (n.kind === 'station') mark('near'); }
    },
    onInteract: (n) => {
      mark('interact');
      if (n.kind === 'station') A.selectStation(n.id, { fly: false, tab: 'passport' });
      else if (n.kind === 'node') A.selectNode(n.id, { fly: false });
      else if (n.kind === 'site') A.selectSite(n.id, { fly: false });
      prompt.classList.remove('on');
    },
    onTeleportMenu: () => showTeleport(),
  });
  A.bind({ twin, walk, toast });
  initInteraction(twin, $('#gl'));
  const demo = createDemo(twin); window.__demo = demo;

  function showTeleport() {
    walk.expectUnlock = true; if (document.pointerLockElement) document.exitPointerLock(); else { walk.paused = true; pausebox.classList.add('on'); }
    let el = $('#tp'); if (el) el.remove();
    el = document.createElement('div'); el.id = 'tp'; el.className = 'pnl';
    el.innerHTML = `<div class="mn" style="margin-bottom:8px">Телепорт · T</div>${dataset.stations.map(s => `<button class="btn block" data-act="teleport" data-arg="${s.id}">${s.id} · ${s.address}</button>`).join('')}${dataset.nodes.map(n => `<button class="btn block" data-act="teleport" data-arg="${n.id}">ПС ${n.id.replace('SUB-', '')}</button>`).join('')}<button class="btn block" data-act="teleport" data-arg="__close">Закрыть</button>`;
    $('#ui').appendChild(el);
  }
  window.__teleport = (id) => {
    const el = $('#tp'); if (el) el.remove();
    if (id !== '__close') {
      const s = dataset.byId[id]; const n = dataset.nodeById[id];
      const target = s || { pos: { x: n.pos.x, z: n.pos.z, fx: 0, fz: 1 } };
      const sp = A.spawnPoint(target);
      walk.pos.set(sp.x, 0, sp.z); walk.yaw = sp.yaw; walk.pitch = -0.05;
    }
    walk.resume();
  };

  /* ---------- синхронизация состояния ---------- */
  let shiftKey = '';
  function updateShift() {
    const rail = state.walkMode ? 0 : $('#rail').getBoundingClientRect().width;
    const panelEl = $('#panel');
    const panel = (state.view === 'map' && !panelEl.hidden) ? panelEl.getBoundingClientRect().width + 20 : 0;
    const k = rail + '|' + panel; if (k === shiftKey) return; shiftKey = k;
    twin.world.setViewShift((rail - panel) / 2);
  }
  subscribe((st, changed) => {
    if (changed.has('year') || changed.has('scenario') || changed.has('decisions') || !st.networkState) A.recompute();
    if (changed.has('year')) { if (st.year === 2030) mark('y2030'); if (st.year === 2035) mark('y2035'); }
    if (changed.has('hoverOption') && st.hoverOption) { const set = new Set(st._seen.opts || []); set.add(st.hoverOption); st._seen.opts = set; }
    if (changed.has('focusOption') && st.focusOption) { const set = new Set(st._seen.opts || []); set.add(st.focusOption); st._seen.opts = set; }
    if (st.selectedStation && st.activeLayer === 'investment' && dataset.byId[st.selectedStation]) { const r = A.recommendation(st.selectedStation, st.year); st.recBest = r ? r.best.options : []; } else st.recBest = [];
    twin.applyState(st, st.networkState);
    updateUI(changed);
    updateShift();
    if (changed.has('activeLayer') && st.activeLayer === 'grid') mark('grid');
    if (changed.has('activeLayer') && st.activeLayer === 'demand') mark('demand');
  });
  window.addEventListener('resize', () => { shiftKey = ''; updateShift(); });

  // первый проход
  A.recompute();
  twin.applyState(state, state.networkState);
  updateUI(new Set(['year', 'scenario', 'decisions', 'activeLayer', 'view', 'selectedStation', 'panelTab', 'networkState', 'guideOpen']));
  updateShift();
  // прогрев рекомендаций (чтобы первый клик по ZIL-01 был мгновенным)
  setTimeout(() => { try { recommend(dataset, { station: 'ZIL-01', year: 2026, baseline: [], scenario: 'base' }); recommend(dataset, { station: 'ZIL-01', year: 2027, baseline: [], scenario: 'base' }); } catch (e) { console.warn(e); } }, 400);

  window.__ev = { twin, ds: dataset, state, setState, A, walk, demo, evaluate };

  const compassNeedle = $('#compassNeedle');
  let last = performance.now(), depthOn = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    walk.update(dt);
    twin.frame(dt, walk);
    const under = twin.camera.position.y < -1;
    if (under !== depthOn) { depthOn = under; $('#depthind').style.display = under ? 'block' : 'none'; if (under) mark('under'); }
    if (compassNeedle) { const az = state.walkMode ? -walk.yaw : twin.orbit.cur.az; compassNeedle.style.transform = `rotate(${(-az * 180 / Math.PI).toFixed(1)}deg)`; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  console.log(`EV-Option Grid: загрузка ${Math.round(performance.now() - t0)} мс`);
  const boot = $('#boot'); boot.style.opacity = 0; setTimeout(() => boot.remove(), 700);
  if (!/nodemo|debug/.test(location.hash + location.search)) setTimeout(() => demo.start(), 500);
}
boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', '<pre style="position:fixed;top:0;left:0;right:0;color:#f88;background:#000;padding:14px;z-index:999;white-space:pre-wrap;font:12px monospace">' + e.stack + '</pre>'); });
