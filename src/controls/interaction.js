// Выбор объектов курсором: наведение (подсказки), клик по ЭЗС / подстанции / площадке / потоку / варианту.
import { state, setState } from '../state.js';
import * as A from '../actions.js';
import { showTip, tipFor } from '../ui/index.js';

export function initInteraction(twin, canvas) {
  let down = null, raf = 0, last = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointermove', e => {
    if (state.walkMode || e.buttons) { if (e.buttons) showTip(0, 0, null); return; }
    last = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0; if (!last) return;
      const hit = twin.pick(last.clientX, last.clientY);
      canvas.style.cursor = hit ? 'pointer' : '';
      showTip(last.clientX, last.clientY, hit ? tipFor(hit) : null);
      const hp = hit?.kind === 'pod' ? hit.option : null;
      if (hp !== (state.hoverOption)) { if (hit?.kind === 'pod' || (!hit && state.hoverOption && twin.layer === 'investment' && state._hoverFrom3d)) { state._hoverFrom3d = !!hp; A.hoverOption(hp); } }
      const id = hit?.kind === 'flow' ? hit.id : null;
      if (id !== twin.hoverId) { twin.hoverId = id; twin.traffic.highlight(id || state.selectedFlow); }
    });
  });
  canvas.addEventListener('pointerleave', () => { showTip(0, 0, null); });
  canvas.addEventListener('click', e => {
    if (state.walkMode) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const hit = twin.pick(e.clientX, e.clientY);
    if (!hit) return;
    dispatchHit(hit);
  });
  twin.onLabelClick = (h) => dispatchHit(h);
}

export function dispatchHit(hit) {
  if (hit.kind === 'pod') A.toggleOption(hit.option);
  else if (hit.kind === 'station') A.selectStation(hit.id, { tab: state.activeLayer === 'investment' ? 'options' : undefined });
  else if (hit.kind === 'node') A.selectNode(hit.id);
  else if (hit.kind === 'site') A.selectSite(hit.id);
  else if (hit.kind === 'flow') A.selectFlow(hit.id);
}
