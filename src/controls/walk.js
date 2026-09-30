// WALK MODE: вид от первого лица по цифровому двойнику. WASD, Shift — бег, Space — прыжок, E — взаимодействие, Esc — выход.
// Коллизии: здания (контуры OSM), вода (кроме мостов), границы плиты. Под землёй (режим GRID) можно «спуститься» клавишей Q.
import * as THREE from 'three';
import { pointInPoly, distSegPoint } from '../data/geo.js';
import { bridgeHeightAt } from '../scene/roads.js';

const EYE = 1.72, RADIUS = 0.5, WALK = 4.8, RUN = 10.5, GRAV = 24, JUMP = 7.4, UNDER_Y = -13;

export class WalkController {
  constructor(twin, dom, hooks = {}) {
    this.twin = twin; this.dom = dom; this.hooks = hooks;
    this.active = false; this.paused = false; this.locked = false; this.underground = false;
    this.pos = new THREE.Vector3(); this.vy = 0; this.yaw = 0; this.pitch = 0; this.onGround = true; this.eyeY = EYE;
    this.keys = new Set(); this.near = null; this.dragLook = null; this.expectUnlock = false;
    this.water = twin.placer && null;
    this._bind();
  }
  _bind() {
    window.addEventListener('keydown', e => {
      if (!this.active) return;
      if (e.target.closest?.('input,textarea,select')) return;
      const k = e.code;
      if (k === 'Escape') { if (!this.locked) this.hooks.onExit?.(); return; }
      if (k === 'KeyE') { e.preventDefault(); this.interact(); return; }
      if (k === 'KeyQ') { this.toggleUnderground(); return; }
      if (k === 'KeyT') { this.hooks.onTeleportMenu?.(); return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { this.keys.add(k); if (k === 'Space') e.preventDefault(); }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', e => {
      if (!this.active || !this.locked) return;
      this.yaw -= e.movementX * 0.0022; this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.45, 1.45);
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked; this.locked = document.pointerLockElement === this.dom;
      if (this.active && was && !this.locked) {
        if (this.expectUnlock) { this.expectUnlock = false; this.paused = true; this.hooks.onPause?.(true); }
        else this.hooks.onExit?.();   // Esc в режиме захвата курсора
      }
      if (this.locked) { this.paused = false; this.hooks.onPause?.(false); }
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    // запасной вариант без pointer lock: перетаскивание мышью
    this.dom.addEventListener('pointerdown', e => {
      if (!this.active) return;
      if (this.paused || this.lockFailed) { this.dragLook = { x: e.clientX, y: e.clientY, moved: 0 }; }
    });
    window.addEventListener('pointermove', e => {
      if (!this.active || !this.dragLook) return;
      const dx = e.clientX - this.dragLook.x, dy = e.clientY - this.dragLook.y; this.dragLook.x = e.clientX; this.dragLook.y = e.clientY; this.dragLook.moved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.0035; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0035, -1.45, 1.45);
    });
    window.addEventListener('pointerup', () => {
      if (!this.active) return;
      const d = this.dragLook; this.dragLook = null;
      if (this.paused && (!d || d.moved < 5) && !this.lockFailed) this.resume();
    });
  }
  resume() { this.paused = false; this.hooks.onPause?.(false); try { const r = this.dom.requestPointerLock?.(); r?.catch?.(() => { this.lockFailed = true; }); } catch (e) { this.lockFailed = true; } }

  enter(spawn) {
    const t = this.twin;
    this.active = true; this.paused = false; this.underground = false; this.lockFailed = false;
    this.pos.set(spawn.x, 0, spawn.z); this.yaw = spawn.yaw ?? 0; this.pitch = -0.05; this.vy = 0; this.eyeY = EYE;
    t.orbit.enabled = false;
    t.camera.fov = 74; t.camera.near = 0.15; t.camera.far = 9000; t.camera.updateProjectionMatrix();
    t.world.setFogDensity(0.00055);
    t.world.setViewShift(0);
    this.keys.clear();
    // без pointer lock (встроенные браузеры, iframe) ходьба работает, обзор — перетаскиванием мыши
    try { const r = this.dom.requestPointerLock?.(); r?.catch?.(() => { this.lockFailed = true; }); if (!this.dom.requestPointerLock) this.lockFailed = true; } catch (e) { this.lockFailed = true; }
    this.hooks.onEnter?.();
  }
  exit() {
    if (!this.active) return;
    const t = this.twin;
    this.active = false; this.expectUnlock = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.locked = false; this.keys.clear();
    t.camera.fov = 42; t.camera.far = 16000; t.camera.updateProjectionMatrix();
    t.orbit.enabled = true;
    t.orbit.snap({ tx: this.pos.x, ty: 0, tz: this.pos.z, dist: 95, az: this.yaw + Math.PI, pol: 1.15 });
    t.world.setFogDensity(t.layer === 'grid' ? 0.00008 : 0.00013);
    this.hooks.onExitDone?.();
  }
  toggleUnderground() {
    if (this.twin.layer !== 'grid' && !this.underground) { this.hooks.onToast?.('Подземный слой доступен в режиме GRID — нажмите 3'); return; }
    this.underground = !this.underground;
    this.hooks.onToast?.(this.underground ? 'Вы под землёй: видны узлы, кабели, столбики мощности (Q — подняться)' : 'Вы на поверхности');
  }
  /** Ближайший интерактивный объект в радиусе. */
  findNear() {
    const t = this.twin; let best = null;
    const p = this.pos;
    const test = (kind, id, x, z, r, label) => { const d = Math.hypot(p.x - x, p.z - z); if (d < r && (!best || d < best.d)) best = { kind, id, d, label }; };
    for (const s of t.ds.stations) test('station', s.id, s.pos.x, s.pos.z, 32, `ЭЗС ${s.id}`);
    if (t.sim) for (const s of t.sim.stations) if (s.isNew) { const a = t.ds.byId[s.anchor]; test('station', s.id, a.site.x, a.site.z, 24, `ЭЗС ${s.id}`); }
    for (const n of t.ds.nodes) test('node', n.id, n.pos.x, n.pos.z, 22, `Подстанция ${n.id.replace('SUB-', '')}`);
    if (t.layer === 'investment' || t.layer === 'city') for (const s of t.ds.stations) if (s.site) test('site', s.id, s.site.x, s.site.z, 22, `Потенциальная площадка · ${s.id}`);
    return best;
  }
  interact() {
    if (!this.near) return;
    if (this.paused || this.lockFailed) { this.hooks.onInteract?.(this.near); return; }
    // освобождаем курсор, чтобы пользователь мог кликать по панели паспорта
    this.expectUnlock = true;
    if (document.pointerLockElement) document.exitPointerLock(); else { this.paused = true; this.hooks.onPause?.(true); }
    this.hooks.onInteract?.(this.near);
  }
  collide(x, z) {
    const t = this.twin;
    // границы плиты
    const hw = t.bld ? 2383 : 0, hh = 2211; let px = x, pz = z;
    px = THREE.MathUtils.clamp(px, -hw + 2, hw - 2); pz = THREE.MathUtils.clamp(pz, -hh + 2, hh - 2);
    if (this.underground) return [px, pz];
    for (const b of t.bld.grid.query(px, pz, 6)) {
      const bb = b.bb;
      if (px < bb.x0 - RADIUS || px > bb.x1 + RADIUS || pz < bb.z0 - RADIUS || pz > bb.z1 + RADIUS) continue;
      const r = b.ring; const n = r.length / 2;
      if (pointInPoly(px, pz, r)) {
        // внутри — вытолкнуть через ближайшее ребро
        let best = null;
        for (let i = 0, j = n - 1; i < n; j = i++) { const q = distSegPoint(px, pz, r[j * 2], r[j * 2 + 1], r[i * 2], r[i * 2 + 1]); if (!best || q.d < best.d) best = q; }
        if (best) { const dx = best.x - px, dz = best.z - pz, L = Math.hypot(dx, dz) || 1; px = best.x + (dx / L) * (RADIUS + 0.05); pz = best.z + (dz / L) * (RADIUS + 0.05); }
        continue;
      }
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const q = distSegPoint(px, pz, r[j * 2], r[j * 2 + 1], r[i * 2], r[i * 2 + 1]);
        if (q.d < RADIUS) { const dx = px - q.x, dz = pz - q.z, L = Math.hypot(dx, dz) || 1; px = q.x + (dx / L) * RADIUS; pz = q.z + (dz / L) * RADIUS; }
      }
    }
    return [px, pz];
  }
  blockedByWater(x, z) {
    const t = this.twin; if (this.underground) return false;
    if (bridgeHeightAt(t.roads.bridgeGrid, x, z) > 0.25) return false;
    for (const w of t.waterPolys) {
      if (x < w.bb.x0 || x > w.bb.x1 || z < w.bb.z0 || z > w.bb.z1) continue;
      if (pointInPoly(x, z, w.o) && !w.h.some(h => pointInPoly(x, z, h))) return true;
    }
    return false;
  }
  update(dt) {
    if (!this.active) return;
    const cam = this.twin.camera;
    const k = this.keys;
    if (!this.paused) {
      let fx = 0, fz = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
      if (k.has('KeyA')) fx -= 1;
      if (k.has('KeyD')) fx += 1;
      if (k.has('ArrowLeft')) this.yaw += 1.8 * dt;
      if (k.has('ArrowRight')) this.yaw -= 1.8 * dt;
      const sp = (k.has('ShiftLeft') || k.has('ShiftRight')) ? RUN : WALK;
      const L = Math.hypot(fx, fz);
      if (L > 0) {
        fx /= L; fz /= L;
        const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        // локальные оси: вперёд = (-sin, -cos)
        const dx = (fx * c + fz * s) * sp * dt, dz = (-fx * s + fz * c) * sp * dt;
        let [nx, nz] = this.collide(this.pos.x + dx, this.pos.z);
        if (this.blockedByWater(nx, this.pos.z)) nx = this.pos.x;
        this.pos.x = nx;
        [nx, nz] = this.collide(this.pos.x, this.pos.z + dz);
        if (this.blockedByWater(this.pos.x, nz)) nz = this.pos.z;
        this.pos.z = nz;
      }
      // вертикаль
      const gy = this.underground ? UNDER_Y : this.twin.groundY(this.pos.x, this.pos.z);
      if (this.underground) { this.pos.y += (UNDER_Y - this.pos.y) * (1 - Math.exp(-dt * 4)); this.vy = 0; this.onGround = true; if (k.has('Space')) this.pos.y += 8 * dt; }
      else {
        if (this.pos.y < gy - 0.01 || (this.onGround && this.pos.y > gy)) { const d = gy - this.pos.y; this.pos.y += Math.sign(d) * Math.min(Math.abs(d), 14 * dt + 0.3); if (Math.abs(gy - this.pos.y) < 0.05) this.pos.y = gy; }
        if (k.has('Space') && this.onGround) { this.vy = JUMP; this.onGround = false; }
        if (!this.onGround) {
          this.vy -= GRAV * dt; this.pos.y += this.vy * dt;
          if (this.pos.y <= gy) { this.pos.y = gy; this.vy = 0; this.onGround = true; }
        } else if (this.pos.y > gy + 0.02) this.onGround = false;
      }
      // выход из подземелья при смене слоя
      if (this.underground && this.twin.layer !== 'grid') this.underground = false;
    }
    cam.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const near = this.findNear();
    if (!this.near !== !near || (near && this.near && (near.id !== this.near.id))) this.hooks.onNear?.(near);
    this.near = near;
  }
}
