// Форматирование, бирки происхождения данных, SVG-графики.
import { USER_TYPES, OPTIONS, SCENARIOS, ALL_YEARS } from '../simulation/params.js';

export const num = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d).replace('.', ','));
export const int = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('ru-RU').replace(/[  ]/g, ' '));
export const pct = (v, d = 0) => (v == null ? '—' : (v * 100).toFixed(d) + '%');
export const mln = (v, d = 0) => (v == null ? '—' : (v >= 0 ? '' : '−') + Math.abs(v).toFixed(d).replace('.', ',') + ' млн ₽');
export const sgn = (v, d = 0) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace('.', ','));
export const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const TAG = {
  verified: '<span class="tag verified" title="Адрес-ориентир задан командой проекта, положение геокодировано (OSM)">Адрес-ориентир</span>',
  osm: '<span class="tag osm" title="Открытые данные OpenStreetMap (ODbL)">OSM</span>',
  scn: '<span class="tag scn" title="Сценарное допущение — не данные РСЗС и не инженерные данные">Сценарное допущение</span>',
  demo: '<span class="tag demo" title="Демонстрационные значения MVP">Демо-значения MVP</span>',
  demoScn: '<span class="tag demo" title="DEMONSTRATION SCENARIO — не фактические данные">Demonstration scenario</span>',
  model: '<span class="tag scn">Demo model</span>',
  rszs: '<span class="tag verified" title="Публично заявлено в описании задачи">РСЗС · заявлено</span>',
};
export const PROV = { scenario: TAG.scn, demo: TAG.demo, osm: TAG.osm, team: '<span class="tag team">Задано командой</span>', rszs: TAG.rszs };

export const STATUS_RU = { low: 'Низкая загрузка', mid: 'Нормальная', high: 'Высокая загрузка', constraint: 'Ограничение сети' };
export const STATUS_SHORT = { low: 'LOW', mid: 'MEDIUM', high: 'HIGH', constraint: 'GRID' };
export const chipStatus = (s) => `<span class="chip ${s}"><i></i>${STATUS_RU[s]}</span>`;
export const RISK_RU = { low: 'низкий', mid: 'средний', high: 'высокий' };
export const riskCls = (r) => r === 'high' ? 'bad' : r === 'mid' ? 'warn' : 'ok';
export const optColor = (id) => OPTIONS[id].color;
export const pkCode = (opts, ghost) => opts.map(o => `<span class="pk ${ghost || ''}" style="--c:${OPTIONS[o].color}"><i></i>${OPTIONS[o].code}</span>`).join('');
export const pkText = (opts) => opts.map(o => OPTIONS[o].code).join(' + ');
export const pkRu = (opts) => opts.map(o => OPTIONS[o].name).join(' + ');
export const scnName = (id) => SCENARIOS[id].name;

/* ---------------- SVG ---------------- */
export function lineChart({ w = 340, h = 150, pad = [14, 14, 22, 30], series, yMax = 1, yMin = 0, xMin = 2026, xMax = 2035, yFmt = (v) => Math.round(v * 100) + '%', marks = [], areaTo = null, xTicks = [2026, 2027, 2030, 2035], yTicks = 4, cur = null }) {
  const [pt, pr, pb, pl] = pad, iw = w - pl - pr, ih = h - pt - pb;
  const X = (x) => pl + ((x - xMin) / (xMax - xMin)) * iw, Y = (y) => pt + ih - ((y - yMin) / (yMax - yMin)) * ih;
  let s = `<svg class="ch" viewBox="0 0 ${w} ${h}" role="img">`;
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    s += `<line x1="${pl}" x2="${w - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(236,232,222,.08)"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end" font-family="IBM Plex Mono" font-size="8.5" fill="rgba(236,232,222,.4)">${yFmt(v)}</text>`;
  }
  for (const x of xTicks) s += `<line x1="${X(x)}" x2="${X(x)}" y1="${pt}" y2="${pt + ih}" stroke="rgba(236,232,222,.06)"/><text x="${X(x)}" y="${h - 7}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="rgba(236,232,222,.5)">${x}</text>`;
  if (cur) s += `<line x1="${X(cur)}" x2="${X(cur)}" y1="${pt}" y2="${pt + ih}" stroke="#8b7bff" stroke-width="1.5"/>`;
  for (const m of marks) s += `<rect x="${X(m.x0)}" y="${pt}" width="${X(m.x1) - X(m.x0)}" height="${ih}" fill="${m.color || 'rgba(139,123,255,.08)'}"/>`;
  for (const ser of series) {
    const pts = ser.pts.map(p => `${X(p[0]).toFixed(1)},${Y(Math.max(yMin, Math.min(yMax, p[1]))).toFixed(1)}`).join(' ');
    if (ser.area) s += `<polygon points="${pts} ${X(ser.pts[ser.pts.length - 1][0])},${Y(yMin)} ${X(ser.pts[0][0])},${Y(yMin)}" fill="${ser.color}" opacity=".12"/>`;
    s += `<polyline points="${pts}" fill="none" stroke="${ser.color}" stroke-width="${ser.w || 2}" ${ser.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`;
    if (ser.dots) for (const p of ser.pts) s += `<rect x="${X(p[0]) - 2.5}" y="${Y(Math.max(yMin, Math.min(yMax, p[1]))) - 2.5}" width="5" height="5" fill="${ser.color}"/>`;
  }
  return s + '</svg>';
}

/** Столбики мощности узла по годам: допустимая (контур) и желаемая (заливка). */
export function nodeBars({ w = 340, h = 130, data, max }) {
  const pad = [14, 8, 22, 8], iw = w - pad[1] - pad[3], ih = h - pad[0] - pad[2];
  const bw = iw / data.length;
  const Y = (v) => pad[0] + ih - (v / max) * ih;
  let s = `<svg class="ch" viewBox="0 0 ${w} ${h}">`;
  data.forEach((d, i) => {
    const x = pad[3] + i * bw + bw * 0.2, ww = bw * 0.6;
    const over = d.desired > d.H;
    s += `<rect x="${x}" y="${Y(d.H)}" width="${ww}" height="${Y(0) - Y(d.H)}" fill="none" stroke="rgba(89,216,230,.75)" stroke-dasharray="3 2"/>`;
    s += `<rect x="${x + 3}" y="${Y(d.desired)}" width="${ww - 6}" height="${Y(0) - Y(d.desired)}" fill="${over ? '#ff4d5e' : d.desired / d.H > 0.6 ? '#ffb83d' : '#59d8e6'}" opacity=".9"/>`;
    s += `<text x="${x + ww / 2}" y="${Y(Math.max(d.desired, d.H)) - 4}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="rgba(236,232,222,.8)">${d.desired.toFixed(1).replace('.', ',')}</text>`;
    s += `<text x="${x + ww / 2}" y="${h - 7}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="${d.cur ? '#c6bdff' : 'rgba(236,232,222,.5)'}">${d.year}</text>`;
  });
  return s + '</svg>';
}

/** 24-часовой профиль спроса по типу пользователей (иллюстративный). */
export function demandCurve(type, w = 340, h = 120) {
  const t = USER_TYPES[type];
  const val = (hr) => {
    let v = 0.14 + 0.06 * Math.sin((hr / 24) * Math.PI * 2 - 1.2);
    for (const [a, b] of t.peakHours) {
      const mid = (a + b) / 2, sd = Math.max(0.9, (b - a) / 2.4);
      for (const m of [mid, mid - 24, mid + 24]) v += 0.82 * Math.exp(-Math.pow(hr - m, 2) / (2 * sd * sd));
    }
    return Math.min(1, v);
  };
  const pts = Array.from({ length: 97 }, (_, i) => [i / 4, val(i / 4)]);
  const pl = 26, pr = 8, pt = 8, pb = 20, iw = w - pl - pr, ih = h - pt - pb;
  const X = (x) => pl + (x / 24) * iw, Y = (y) => pt + ih - y * ih;
  let s = `<svg class="ch" viewBox="0 0 ${w} ${h}">`;
  for (const [a, b] of t.peakHours) s += `<rect x="${X(a)}" y="${pt}" width="${X(b) - X(a)}" height="${ih}" fill="${t.color}" opacity=".12"/>`;
  for (const hr of [0, 6, 12, 18, 24]) s += `<line x1="${X(hr)}" x2="${X(hr)}" y1="${pt}" y2="${pt + ih}" stroke="rgba(236,232,222,.07)"/><text x="${X(hr)}" y="${h - 6}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="rgba(236,232,222,.45)">${String(hr).padStart(2, '0')}</text>`;
  s += `<polygon points="${pts.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')} ${X(24)},${Y(0)} ${X(0)},${Y(0)}" fill="${t.color}" opacity=".16"/>`;
  s += `<polyline points="${pts.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}" fill="none" stroke="${t.color}" stroke-width="2"/>`;
  return s + '</svg>';
}

export function growthChart(w = 330, h = 150, curScn = 'base') {
  const yrs = ALL_YEARS;
  return { yrs };
}

/** Небольшой индикатор-стрелка тренда. */
export const trend = (a, b) => (b > a * 1.04 ? '<span class="arr neg">↑</span>' : b < a * 0.96 ? '<span class="arr pos">↓</span>' : '<span class="arr">→</span>');

export const ICONS = {
  city: '<svg viewBox="0 0 16 16"><path d="M2 14V6l4-2v10M6 14V3l5 2v9M11 14V8l3 1v5M1 14h14"/></svg>',
  demand: '<svg viewBox="0 0 16 16"><path d="M2 12c3 0 3-8 6-8s3 8 6 8M2 8h12"/><circle cx="8" cy="8" r="1"/></svg>',
  grid: '<svg viewBox="0 0 16 16"><path d="M9 1L4 9h4l-1 6 5-8H8z"/></svg>',
  investment: '<svg viewBox="0 0 16 16"><path d="M8 1.5l5.5 3.2v6.6L8 14.5l-5.5-3.2V4.7z"/><path d="M8 5v6M5 8h6"/></svg>',
  future: '<svg viewBox="0 0 16 16"><path d="M2 12l4-4 3 2 5-6M10 4h4v4"/></svg>',
  walk: '<svg viewBox="0 0 16 16"><circle cx="9" cy="3" r="1.5"/><path d="M8 6l-2 3 2 2v4M8 6l2 2 2 1M6 9l-2 1"/></svg>',
  play: '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.4"/></svg>',
};
