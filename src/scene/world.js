// Рендерер, камера, свет, небо.
import * as THREE from 'three';
import { U, makeSkyMaterial } from './materials.js';

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(U.uFogColor.value, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(U.uFogColor.value.clone(), U.uFogDensity.value);

  const camera = new THREE.PerspectiveCamera(42, 1, 2, 16000);
  camera.position.set(1200, 900, 1300);

  // ночной свет для «обычных» материалов (станции, опции, техника): холодный лунный ключевой + тёплая подсветка снизу от города
  const hemi = new THREE.HemisphereLight(0x5c74b0, 0x14151c, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xaebfff, 0.95);
  sun.position.copy(U.uSunDir.value).multiplyScalar(500);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffb877, 0.22);
  fill.position.set(0.4, -0.15, 0.55).multiplyScalar(500);
  scene.add(fill);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 24, 12), makeSkyMaterial());
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  let W = 1, H = 1, shiftX = 0;
  function applyViewOffset() {
    if (Math.abs(shiftX) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(W, H, -shiftX, 0, W, H);
  }
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    W = Math.max(2, Math.round(r.width)); H = Math.max(2, Math.round(r.height));
    renderer.setSize(W, H, false);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    camera.aspect = W / H;
    applyViewOffset();
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    renderer, scene, camera, sky, hemi, sun, resize,
    get size() { return { w: W, h: H }; },
    /** Сдвиг центра проекции (px, вправо>0) — чтобы фокус не прятался под боковыми панелями. */
    setViewShift(px) { shiftX = px; applyViewOffset(); camera.updateProjectionMatrix(); },
    setFogDensity(d) { U.uFogDensity.value = d; scene.fog.density = d; },
  };
}
