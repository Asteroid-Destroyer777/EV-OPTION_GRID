// Вводная демонстрация — короткий атмосферный пролёт (~10–12 с): ночная панорама → приближение к ЗИЛ →
// проявляются подписи улиц → загорается ZIL-01 → появляются транспортные потоки → титр → управление пользователю.
// Полный пошаговый разбор продукта (GRID/INVESTMENT/timeline) — в ручном чек-листе «Сценарий защиты» (левая панель), не здесь.
import { state, setState } from '../state.js';
import * as A from '../actions.js';
import { dataset as ds } from '../data/dataset.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);

export function createDemo(twin) {
  let running = false, aborted = false;
  const app = document.getElementById('app');
  const check = () => { if (aborted) throw new Error('skip'); };

  async function run() {
    running = true; aborted = false;
    app.classList.add('demoing');
    const sk = document.createElement('button'); sk.className = 'btn skip'; sk.textContent = 'Пропустить · Esc'; sk.onclick = () => skip(); $('#ui').appendChild(sk);
    const it = document.createElement('div'); it.className = 'intro-title'; it.innerHTML = `<div class="it"><small>Международные транспортные проектные соревнования · Проблема № 03</small><h1>EV-OPTION GRID</h1><p>ЗИЛ / Москва · инвестиционное планирование зарядной инфраструктуры</p></div>`;
    document.body.appendChild(it);
    setState({ demo: true, year: 2026, activeLayer: 'city', decisions: [], selectedStation: null, selectedNode: null, selectedFlow: null, view: 'map', walkMode: false }, { sync: true });
    const o = twin.orbit; const hero = ds.byId['ZIL-01'];
    const fly = async (to, dur, hold = 0) => { await Promise.all([o.flyTo(to, dur), wait(hold)]); check(); };
    try {
      // 1. Ночная панорама района — широкий статичный план, вступает титр
      o.snap({ tx: 560, ty: 0, tz: 120, dist: 4600, az: -0.95, pol: 0.62 });
      await wait(500); check();
      // 2. Камера медленно приближается к ЗИЛ; на подлёте проявляются подписи улиц (дистанционный порог) и станции
      const approach = fly({ tx: hero.pos.x - 30, ty: 0, tz: hero.pos.z + 60, dist: 980, az: -0.42, pol: 0.92 }, 6.2, 0);
      approach.catch(() => {}); // не даём предупреждению об unhandled rejection всплыть раньше основного catch, если пользователь нажмёт «Пропустить» во время wait ниже
      await wait(2600); check();
      it.style.opacity = 0;
      // 3. Загораются потоки спроса на подходе к станции
      A.setLayer('demand');
      await approach;
      // 4. Финальный композиционный план: ZIL-01 хорошо виден, потоки движутся, город живёт
      await fly({ tx: hero.pos.x + 6, ty: 0, tz: hero.pos.z + 4, dist: 340, az: -0.05, pol: 0.98 }, 2.0, 1500);
      A.setLayer('city');
      await wait(400); check();
    } catch (e) { if (e.message !== 'skip') console.error(e); }
    await finish(sk, it);
  }
  async function finish(sk, it) {
    sk.remove(); it.remove();
    setState({ decisions: [], year: 2026, activeLayer: 'city', selectedStation: null, selectedNode: null, panelTab: 'passport', investmentOption: null, focusOption: null, demo: false }, { sync: true });
    app.classList.remove('demoing');
    twin.orbit.flyTo({ tx: 700, ty: 0, tz: 260, dist: 1350, az: 0.05, pol: 0.95 }, 1.6);
    running = false; aborted = false;
    A.ctx.toast('Управление ваше: выберите ЭЗС ZIL-01 или нажмите 6 — войти в город', 4500);
  }
  function skip() { if (running) aborted = true; }
  return { start: () => { if (!running) run(); }, skip, get running() { return running; } };
}
