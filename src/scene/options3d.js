// 3D-объекты инвестиционных опций (в локальных координатах станции: x — вдоль улицы, z — к улице, y — вверх).
// Каждый объект различим по форме: EXPANSION — новые посты и навес, STORAGE — контейнеры, GRID UPGRADE — трансформаторный двор,
// LOCAL GEN — солнечный навес, DEFER — подготовленная площадка, PILOT — модульный киоск, NEW STATION — отдельная станция.
import * as THREE from 'three';
import { Assembly } from './assembly.js';

export const POST_DX = 2.75;
export const postX = (i) => -23.6 + i * POST_DX;
export const MAX_SHOWN_POSTS = 14;

/** Посты с индексами [from,to) под навесом. accent — фиолетовая подложка «новых» постов. */
export function addPosts(A, from, to, accent = false) {
  for (let i = from; i < Math.min(to, MAX_SHOWN_POSTS); i++) {
    const x = postX(i);
    A.box('post', x, 0.98, -4.6, 0.56, 1.96, 0.44);
    A.box('screen', x, 1.45, -4.37, 0.38, 0.55, 0.05);
    A.box('dark', x + 0.24, 0.72, -4.36, 0.1, 0.32, 0.07);
    if (accent) A.box('accent', x, 0.05, -3.6, 0.9, 0.05, 1.5);
  }
}
export function addCanopy(A, from, to, withColumns = true) {
  const x0 = postX(from) - (from === 0 ? 1.6 : 1.4), x1 = postX(Math.min(to, MAX_SHOWN_POSTS) - 1) + 1.6;
  const L = x1 - x0, cx = (x0 + x1) / 2;
  A.box('canopy', cx, 5.7, 0, L, 0.42, 12.2);
  A.box('led', cx, 5.42, 6.0, L, 0.16, 0.14);
  A.box('steel', cx, 5.46, -6.0, L, 0.12, 0.12);
  if (withColumns) {
    const n = Math.max(2, Math.round(L / 11) + 1);
    for (let k = 0; k < n; k++) {
      const x = x0 + 0.5 + (L - 1) * (k / (n - 1));
      A.box('steel', x, 2.78, -5.4, 0.34, 5.56, 0.34);
      A.box('steel', x, 2.78, 5.4, 0.34, 5.56, 0.34);
    }
  }
}

/** Расширение: новые посты и навес, начиная с индекса from. */
export function buildExpansion(from, count) {
  const A = new Assembly();
  addCanopy(A, from, from + count, true);
  addPosts(A, from, from + count, true);
  return A;
}

/** Накопитель: два контейнера + кабельная трасса. */
export function buildStorage(units = 2) {
  const A = new Assembly();
  for (let k = 0; k < units; k++) {
    const x = 15 + k * 7.6;
    A.box('container', x, 1.5, -11.3, 6.1, 2.7, 2.5);
    A.box('containerDark', x, 2.0, -10.02, 5.3, 0.9, 0.06);          // вентиляционная панель
    A.box('containerDark', x, 1.5, -12.6, 6.1, 2.72, 0.06);
    A.box('accent', x, 2.95, -11.3, 5.2, 0.12, 1.1);                 // светодиодная линия SoC
    A.box('amber', x - 2.2, 1.0, -10.0, 0.24, 0.24, 0.05);
    A.box('steel', x + 3.1, 1.45, -11.3, 0.1, 2.5, 2.3);
    for (let j = 0; j < 6; j++) A.box('dark', x - 2.3 + j * 0.92, 2.0, -9.98, 0.55, 0.62, 0.02);
  }
  A.box('dark', 6, 0.16, -8.6, 18, 0.16, 0.5);                       // кабельный лоток к навесу
  A.box('accent', 6, 0.28, -8.6, 18, 0.05, 0.14);
  return A;
}

/** Усиление сети: трансформаторный двор с ограждением и опорой. */
export function buildGridUpgrade() {
  const A = new Assembly();
  // ограждение
  A.box('steel', -16.5, 0.9, -8.2, 15.5, 1.8, 0.06); A.box('steel', -16.5, 0.9, -13.8, 15.5, 1.8, 0.06);
  A.box('steel', -24.3, 0.9, -11, 0.06, 1.8, 5.7); A.box('steel', -8.6, 0.9, -11, 0.06, 1.8, 5.7);
  A.box('hatch', -16.5, 0.06, -11, 15.4, 0.08, 5.6);
  for (const x of [-21.5, -15.5]) {
    A.box('trafo', x, 1.55, -11, 3.6, 2.5, 2.6);
    A.box('steel', x, 0.34, -11, 4.2, 0.3, 3.2);
    A.box('dark', x + 1.9, 1.5, -11, 0.4, 2.0, 2.2);           // радиатор
    for (const dx of [-1.1, 0, 1.1]) { A.cyl('dark', x + dx, 3.35, -11, 0.2, 1.3, 8); A.cyl('steel', x + dx, 4.1, -11, 0.27, 0.2, 8); }
    A.box('amber', x - 1.85, 1.2, -9.7, 0.06, 0.22, 0.22);
  }
  // опора и провод
  A.cyl('steel', -10.6, 4.6, -11, 0.22, 9.2, 8);
  A.box('steel', -10.6, 8.6, -11, 0.2, 0.2, 4.2);
  for (const dz of [-1.7, 0, 1.7]) A.cyl('dark', -10.6, 8.9, -11 + dz, 0.09, 0.5, 6);
  A.box('accent', -13.4, 0.28, -11, 5, 0.06, 0.14);
  return A;
}

/** Локальная генерация: солнечный навес над проездом + панели на крыше. */
export function buildLocalGen() {
  const A = new Assembly();
  for (let k = 0; k < 8; k++) {
    const x = 1 + k * 3.15;
    A.box('solar', x, 4.3, 9.4, 2.95, 0.08, 5.2, 0, -0.16);
  }
  for (const x of [1, 10.5, 19.5]) { A.box('steel', x, 2.05, 11.8, 0.28, 4.1, 0.28); A.box('steel', x, 2.6, 7, 0.28, 5.2, 0.28); }
  A.box('steel', 12.5, 4.05, 11.85, 25, 0.12, 0.12);
  for (let k = 0; k < 6; k++) A.box('solar', -21 + k * 3.4, 6.05, -1, 3.1, 0.07, 4.8, 0, -0.14);
  A.box('amber', 24.6, 0.3, 8.5, 0.5, 0.4, 0.3);
  return A;
}

/** Пилот: модульный киоск на 2 поста с малым навесом. */
export function buildPilot() {
  const A = new Assembly();
  const cx = -22.5, cz = 9.2;
  A.box('canopy', cx, 3.2, cz, 6.2, 0.26, 4.4);
  A.box('led', cx, 3.02, cz + 2.2, 6.2, 0.1, 0.1);
  for (const dx of [-2.8, 2.8]) { A.box('steel', cx + dx, 1.5, cz - 1.9, 0.2, 3.0, 0.2); A.box('steel', cx + dx, 1.5, cz + 1.9, 0.2, 3.0, 0.2); }
  for (const dx of [-1.4, 1.4]) { A.box('post', cx + dx, 0.9, cz - 1.6, 0.5, 1.8, 0.4); A.box('screen', cx + dx, 1.35, cz - 1.38, 0.34, 0.5, 0.04); }
  A.box('container', cx, 0.9, cz - 2.3, 2.4, 1.8, 0.9);
  A.box('accent', cx, 0.05, cz, 6.4, 0.05, 4.6);
  return A;
}

/** Подготовленная площадка (DEFER): разметка, столбики, знак, кабельный ввод. Размещается в позиции площадки. */
export function buildPreparedSite(w = 34, d = 22) {
  const A = new Assembly();
  A.box('hatch', 0, 0.06, 0, w, 0.1, d);
  const hx = w / 2, hz = d / 2;
  for (let i = -hx + 1.5; i < hx; i += 3) { A.box('accent', i, 0.13, -hz + 0.2, 1.6, 0.05, 0.25); A.box('accent', i, 0.13, hz - 0.2, 1.6, 0.05, 0.25); }
  for (let j = -hz + 1.5; j < hz; j += 3) { A.box('accent', -hx + 0.2, 0.13, j, 0.25, 0.05, 1.6); A.box('accent', hx - 0.2, 0.13, j, 0.25, 0.05, 1.6); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { A.cyl('steel', sx * (hx - 0.6), 0.55, sz * (hz - 0.6), 0.14, 1.1, 6); A.box('amber', sx * (hx - 0.6), 1.1, sz * (hz - 0.6), 0.22, 0.12, 0.22); }
  A.box('dark', 0, 0.2, -hz + 2.2, 2.4, 0.3, 1.3);                     // закладная под трансформатор / ввод
  A.box('accent', -hx * 0.4, 0.16, -hz * 0.55, hx * 0.6, 0.04, 0.14);  // трасса кабельной канализации
  A.box('steel', hx - 4.5, 1.4, hz - 0.8, 0.14, 2.8, 0.14);            // знак
  A.box('sign', hx - 4.5, 2.9, hz - 0.8, 4.4, 1.3, 0.1);
  return A;
}
