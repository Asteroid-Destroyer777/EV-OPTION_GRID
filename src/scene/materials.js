// Общие uniform-переменные и шейдерные материалы сцены.
// Все «городские» материалы понимают режим GRID (uGrid 0..1): город становится призрачным, виден подземный слой.
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uGrid: { value: 0 },
  uNight: { value: 1 },
  uFuture: { value: 0 },
  uDim: { value: 0 },
  uFogColor: { value: new THREE.Color('#0a0e18') },
  uFogDensity: { value: 0.000115 },
  uSunDir: { value: new THREE.Vector3(-0.5, 0.42, 0.58).normalize() },
  uMoonColor: { value: new THREE.Color('#aebfff') },
};

export const PAL = {
  ground: '#12141b',
  land: { 1: '#181b21', 2: '#1a1d25', 3: '#1b1a1c', 4: '#17181c', 5: '#17251f', 6: '#152019', 7: '#1d2027', 8: '#1a1d24', 9: '#16261f', 10: '#141d18' },
  water: '#0a1f33',
  asphalt: ['#282b34', '#24272f', '#21242c', '#1e2128', '#1b1e24', '#181a1f', '#282a32'],
  curb: '#31343e',
  // палитра зданий: 0 общая · 1 жилая (тёплый серый) · 2 деловая (холодное стекло) · 3 промышленная ЗИЛ (кирпич) · 4 общественная · 5 малые формы
  bldg: { 0: '#484c57', 1: '#53575f', 2: '#3d4b5e', 3: '#4a3f3a', 4: '#5a5763', 5: '#393c43' },
  bldgNew: '#636a86',
  violet: '#8b7bff', cyan: '#59d8e6', ok: '#35d08f', warn: '#ffb83d', bad: '#ff4d5e',
};

const GLSL_HEAD = /* glsl */`
uniform float uTime; uniform float uGrid; uniform float uNight; uniform float uFuture; uniform float uDim;
uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uSunDir; uniform vec3 uMoonColor;
vec3 applyFog(vec3 c, float d){ float f = 1.0 - exp(-pow(uFogDensity*d, 2.0)); return mix(c, uFogColor, clamp(f,0.0,1.0)); }
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }
`;

const fadeMats = new Set();
function fade(mat, gridAlpha, depthWrite = true) {
  mat.userData.fade = true;
  mat.userData.baseDepthWrite = depthWrite;
  mat.userData.baseTransparent = mat.transparent;
  mat.uniforms.uFade = { value: gridAlpha };
  fadeMats.add(mat);
  return mat;
}
/** Плавное включение режима GRID (0..1). */
export function setGridMix(v) {
  U.uGrid.value = v;
  const t = v > 0.002;
  for (const m of fadeMats) {
    m.transparent = t || m.userData.baseTransparent;
    m.depthWrite = !t && m.userData.baseDepthWrite;
  }
}

function shader(opts) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, ...(opts.uniforms || {}) },
    vertexShader: opts.vertex, fragmentShader: opts.fragment,
    transparent: !!opts.transparent, depthWrite: opts.depthWrite !== false, depthTest: opts.depthTest !== false,
    side: opts.side ?? THREE.FrontSide, blending: opts.blending ?? THREE.NormalBlending,
    polygonOffset: opts.units != null, polygonOffsetFactor: opts.units != null ? -1 : 0, polygonOffsetUnits: opts.units || 0,
  });
  return m;
}

/* -------------------- здания -------------------- */
export function makeBuildingMaterial() {
  const m = shader({
    vertex: /* glsl */`
      attribute vec3 aColor; attribute float aSeed; attribute float aKind; attribute float aNew;
      varying vec3 vWorld; varying vec3 vN; varying vec3 vCol; varying vec2 vUv; varying float vSeed; varying float vKind; varying float vNew;
      void main(){
        vec4 w = modelMatrix * vec4(position,1.0);
        vWorld = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vCol = aColor; vUv = uv; vSeed = aSeed; vKind = aKind; vNew = aNew;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragment: GLSL_HEAD + /* glsl */`
      uniform float uFade;
      varying vec3 vWorld; varying vec3 vN; varying vec3 vCol; varying vec2 vUv; varying float vSeed; varying float vKind; varying float vNew;
      void main(){
        vec3 n = normalize(vN);
        bool roof = vUv.y < -0.5;
        float sun = max(dot(n, uSunDir), 0.0);
        float hemi = 0.5 + 0.5*n.y;
        // холодный лунный контровой свет снизу + тёплый уличный подсвет у земли (имитация фонарей без реальных источников)
        float streetGlow = (1.0 - smoothstep(0.0, 26.0, vWorld.y)) * max(0.0, dot(n, vec3(0.0,-1.0,0.0))*-1.0 + 0.35);
        float ao = roof ? 1.0 : mix(0.46, 1.0, smoothstep(0.0, 18.0, vWorld.y));
        vec3 col = vCol * (0.30*hemi + 0.58*sun*uMoonColor.r*1.05 + uMoonColor*sun*0.22) * ao;
        col += vCol * vec3(0.55,0.4,0.22) * streetGlow * 0.16;
        vec3 emis = vec3(0.0);
        if(!roof){
          vec2 cs = vec2(3.5, 3.1);
          float fill = 0.62;
          if(vKind > 1.5 && vKind < 2.5){ cs = vec2(2.4, 3.6); fill = 0.86; }
          else if(vKind > 2.5 && vKind < 3.5){ cs = vec2(7.0, 5.5); fill = 0.5; }
          else if(vKind > 4.5){ cs = vec2(9.0, 6.0); fill = 0.0; }
          // балконные пояса на жилых башнях: тонкая тёмная горизонтальная линия каждые ~3 этажа
          float balc = 0.0;
          if(vKind > 0.5 && vKind < 1.5){ float fl = vUv.y / cs.y; balc = (1.0 - smoothstep(0.0, 0.05, abs(fract(fl/3.0)-0.02))) * 0.35; }
          vec2 g = vUv / cs; vec2 cell = floor(g); vec2 f = fract(g);
          float m = (1.0-fill)*0.5;
          float win = step(m, f.x)*step(f.x, 1.0-m)*step(0.2, f.y)*step(f.y, 0.8);
          float r = hash21(cell + vSeed*31.7);
          float lit = step(0.90 - 0.12*vNew, r);
          float coolPick = step(0.76, hash21(cell + vSeed*77.3 + 5.0)); // часть окон — холодный (экран/ТВ), большинство — тёплый
          vec3 warmLight = vec3(0.88,0.68,0.42); vec3 coolLight = vec3(0.54,0.68,0.88);
          vec3 winLight = mix(warmLight, coolLight, coolPick);
          col = mix(col, col*0.42 + vec3(0.015,0.025,0.05), win*0.78);
          col -= balc*vCol*0.5;
          emis += win*lit*winLight*(0.55+0.3*hash21(cell+3.1))*uNight*0.9;
        }
        if(vNew > 0.5){ col += vec3(0.035,0.032,0.06)*hemi; if(roof) col += vec3(0.035,0.03,0.08); }
        col += emis;
        // GRID: город темнее (не прозрачный) — данные читаются на его фоне
        col *= mix(1.0, 0.62, uGrid);
        emis *= mix(1.0, 0.7, uGrid);
        float alpha = mix(1.0, uFade, uGrid*0.55);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - abs(dot(n,V)), 2.4);
        vec3 ghost = vec3(0.14,0.17,0.30)*(0.10+0.7*fres) + emis*0.5;
        col = mix(col, ghost, uGrid*0.30);
        alpha += uGrid*fres*0.10;
        float d = length(cameraPosition - vWorld);
        col = applyFog(col, d);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  return fade(m, 0.62, true);
}

/* -------------------- плоские слои земли (вершинные цвета) -------------------- */
export function makeLayerMaterial(units, gridAlpha = 0.16, noiseAmt = 0.0) {
  const m = shader({
    units,
    uniforms: { uNoise: { value: noiseAmt } },
    vertex: /* glsl */`
      attribute vec3 aColor; varying vec3 vCol; varying vec3 vWorld;
      void main(){ vec4 w = modelMatrix*vec4(position,1.0); vWorld=w.xyz; vCol=aColor; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragment: GLSL_HEAD + /* glsl */`
      uniform float uFade; uniform float uNoise;
      varying vec3 vCol; varying vec3 vWorld;
      void main(){
        vec3 col = vCol;
        float nz = vnoise(vWorld.xz*0.035)*0.6 + vnoise(vWorld.xz*0.21)*0.4;
        col *= 1.0 + (nz-0.5)*uNoise;
        float d = length(cameraPosition - vWorld);
        col = applyFog(col, d);
        float alpha = mix(1.0, uFade, uGrid);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  return fade(m, gridAlpha, true);
}

/* -------------------- базовая плита с координатной сеткой -------------------- */
export function makeGroundMaterial(halfW, halfH) {
  const m = shader({
    uniforms: { uHalf: { value: new THREE.Vector2(halfW, halfH) }, uBase: { value: new THREE.Color(PAL.ground) } },
    vertex: /* glsl */`varying vec3 vWorld; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragment: GLSL_HEAD + /* glsl */`
      uniform float uFade; uniform vec2 uHalf; uniform vec3 uBase; varying vec3 vWorld;
      float gridLine(vec2 p, float s, float w){ vec2 g = abs(fract(p/s+0.5)-0.5)*s; vec2 f = fwidth(p); vec2 l = smoothstep(f*w+f, f*w, g); return max(l.x,l.y); }
      void main(){
        vec3 col = uBase;
        float d = length(cameraPosition - vWorld);
        float far = 1.0 - smoothstep(1500.0, 4200.0, d);
        float minor = gridLine(vWorld.xz, 100.0, 0.5) * 0.045 * far;
        float major = gridLine(vWorld.xz, 500.0, 0.6) * 0.09;
        col += vec3(0.55,0.58,0.8)*(minor+major);
        vec2 e = uHalf - abs(vWorld.xz);
        float edge = 1.0 - smoothstep(0.0, 14.0, min(e.x,e.y));
        col += vec3(0.42,0.36,1.0)*edge*0.55;
        col = applyFog(col, d);
        gl_FragColor = vec4(col, mix(1.0, uFade, uGrid));
        #include <colorspace_fragment>
      }`,
  });
  return fade(m, 0.2, true);
}

/* -------------------- вода -------------------- */
export function makeWaterMaterial(units) {
  const m = shader({
    units,
    vertex: /* glsl */`varying vec3 vWorld; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragment: GLSL_HEAD + /* glsl */`
      uniform float uFade; varying vec3 vWorld;
      void main(){
        vec2 p = vWorld.xz;
        float t = uTime*0.055;
        float w1 = vnoise(p*0.018 + vec2(t, -t*0.7));
        float w2 = vnoise(p*0.07 + vec2(-t*1.6, t));
        float w3 = vnoise(p*0.006 + vec2(t*0.4, t*0.3));
        float streak = smoothstep(0.6, 0.92, w1*0.6 + w2*0.5);
        vec3 deep = vec3(0.016,0.06,0.11);
        vec3 col = mix(deep, deep*1.6 + vec3(0.01,0.02,0.03), w3);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(V.y,0.0,1.0), 2.6);
        // небо/зарево, зеркалящееся в воде + рябь бегущих бликов набережной
        col += vec3(0.09,0.13,0.21)*fres*0.85 + vec3(0.22,0.30,0.42)*streak*0.14;
        float shimmer = smoothstep(0.72, 0.97, vnoise(p*0.04 + vec2(-t*2.4, t*1.8)));
        col += vec3(0.55,0.46,0.30) * shimmer * fres * 0.22; // тёплые блики огней набережной
        float d = length(cameraPosition - vWorld);
        col = applyFog(col, d);
        gl_FragColor = vec4(col, mix(1.0, uFade, uGrid));
        #include <colorspace_fragment>
      }`,
  });
  return fade(m, 0.3, true);
}

/* -------------------- дороги -------------------- */
export function makeRoadMaterial({ color, line = '#c8c9d0', marks = false, units, sidewalk = false, gridAlpha = 0.3 }) {
  const m = shader({
    units,
    uniforms: { uColor: { value: new THREE.Color(color) }, uLine: { value: new THREE.Color(line) }, uMarks: { value: marks ? 1 : 0 }, uWalk: { value: sidewalk ? 1 : 0 } },
    vertex: /* glsl */`varying vec2 vUv; varying vec3 vWorld; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragment: GLSL_HEAD + /* glsl */`
      uniform float uFade; uniform vec3 uColor; uniform vec3 uLine; uniform float uMarks; uniform float uWalk;
      varying vec2 vUv; varying vec3 vWorld;
      void main(){
        vec3 col = uColor;
        float d = length(cameraPosition - vWorld);
        float near = 1.0 - smoothstep(250.0, 900.0, d);
        if(uMarks > 0.5){
          float a = vUv.x;
          float dash = step(fract(vUv.y/16.0), 0.5);
          float center = (1.0 - smoothstep(0.02, 0.05, abs(a))) * dash;
          float edge = 1.0 - smoothstep(0.02, 0.05, abs(abs(a)-0.88));
          col = mix(col, uLine, max(center*0.5, edge*0.32) * near);
        }
        if(uWalk > 0.5){ col *= 1.0 + 0.10*vnoise(vWorld.xz*1.3); }
        col = applyFog(col, d);
        gl_FragColor = vec4(col, mix(1.0, uFade, uGrid));
        #include <colorspace_fragment>
      }`,
  });
  return fade(m, gridAlpha, true);
}

/* -------------------- ж/д, МЦК -------------------- */
export function makeRailMaterial({ color = '#22242a', rail = '#6a6e7c', glow = null, units }) {
  const m = shader({
    units,
    uniforms: { uColor: { value: new THREE.Color(color) }, uRail: { value: new THREE.Color(rail) }, uGlow: { value: new THREE.Color(glow || '#000000') }, uHasGlow: { value: glow ? 1 : 0 } },
    vertex: /* glsl */`varying vec2 vUv; varying vec3 vWorld; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragment: GLSL_HEAD + /* glsl */`
      uniform float uFade; uniform vec3 uColor; uniform vec3 uRail; uniform vec3 uGlow; uniform float uHasGlow; varying vec2 vUv; varying vec3 vWorld;
      void main(){
        float a = abs(vUv.x);
        float d = length(cameraPosition - vWorld);
        float near = 1.0 - smoothstep(200.0, 800.0, d);
        vec3 col = uColor;
        float r = 1.0 - smoothstep(0.03, 0.09, abs(a-0.42));
        float sleeper = step(fract(vUv.y/1.6), 0.28) * step(a, 0.62);
        col = mix(col, uRail, r*0.65*near + sleeper*0.1*near);
        if(uHasGlow > 0.5){ float g = 1.0 - smoothstep(0.0, 0.34, a); col = mix(col, uGlow, g*0.85); col += uGlow*g*0.25; }
        col = applyFog(col, d);
        gl_FragColor = vec4(col, mix(1.0, uFade, uGrid));
        #include <colorspace_fragment>
      }`,
  });
  return fade(m, 0.25, true);
}

/* -------------------- небо: глубокий московский navy + тёплое зарево города + едва заметные звёзды -------------------- */
export function makeSkyMaterial() {
  return shader({
    depthWrite: false, side: THREE.BackSide,
    vertex: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w*0.9999; }`,
    fragment: GLSL_HEAD + /* glsl */`
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 zenith  = vec3(0.017, 0.023, 0.048);   // глубокий тёмно-синий верх
        vec3 midsky  = vec3(0.030, 0.050, 0.095);   // холодный синий
        vec3 horizon = vec3(0.075, 0.105, 0.165);   // светлее у горизонта
        vec3 glow    = vec3(0.62, 0.42, 0.22);      // тёплое световое загрязнение мегаполиса
        float tUp = smoothstep(0.0, 0.62, y);
        vec3 col = mix(midsky, zenith, tUp);
        float nearHor = 1.0 - smoothstep(0.0, 0.30, y);
        col = mix(col, horizon, nearHor*0.9);
        // неровное зарево огней по азимуту — читается как силуэт дальнего города
        float az = atan(d.z, d.x);
        float skylineNoise = hash21(vec2(floor(az*9.0), 0.0))*0.5 + hash21(vec2(floor(az*23.0), 1.0))*0.5;
        float band = smoothstep(-0.16, 0.0, y) * (1.0 - smoothstep(0.0, 0.16, y));
        col += glow * band * (0.30 + 0.55*skylineNoise) * 0.65;
        // атмосферная дымка над горизонтом
        col += vec3(0.10,0.12,0.16) * smoothstep(0.30, 0.0, y) * band * 0.5;
        // едва заметные звёзды выше горизонта, лёгкое мерцание
        float starMask = smoothstep(0.10, 0.55, y);
        float sh = hash21(floor(d.xz/max(abs(d.y),0.06)*280.0) + floor(d.y*55.0));
        float tw = 0.65 + 0.35*sin(uTime*0.5 + sh*62.0);
        col += vec3(0.72,0.78,0.95) * step(0.9974, sh) * starMask * tw * 0.55;
        // ниже горизонта (под ЗИЛом, когда смотрим вниз) — уходит в цвет тумана
        col = mix(col, uFogColor*0.62, smoothstep(0.0,-0.32,y));
        col = mix(col, col*vec3(0.62,0.74,1.18), uGrid*0.55);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/* -------------------- боковые грани плиты (разрез грунта) -------------------- */
export function makeSlabMaterial() {
  const m = shader({
    vertex: /* glsl */`varying vec3 vWorld; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragment: GLSL_HEAD + /* glsl */`
      varying vec3 vWorld;
      void main(){
        float depth = clamp(-vWorld.y/70.0, 0.0, 1.0);
        vec3 col = mix(vec3(0.115,0.125,0.16), vec3(0.03,0.032,0.045), pow(depth,0.7));
        float strata = vnoise(vec2((vWorld.x+vWorld.z)*0.02, vWorld.y*0.45));
        col *= 0.85 + 0.3*strata;
        float lines = 1.0 - smoothstep(0.0, 0.06, abs(fract(vWorld.y/10.0)-0.5+0.5) ); // отметки каждые 10 м
        lines = max(lines, 1.0 - smoothstep(0.0, 0.06, abs(fract(vWorld.y/10.0) - 1.0)));
        col += vec3(0.3,0.32,0.5)*lines*0.10*(0.3+uGrid);
        col += vec3(0.35,0.3,0.9)*(1.0 - smoothstep(0.0, 0.8, -vWorld.y))*0.55;
        col += vec3(0.05,0.28,0.32)*uGrid*(0.25 + 0.2*strata);
        float d = length(cameraPosition - vWorld);
        col = applyFog(col, d);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return m;
}

/* -------------------- транспорт (инстансы) -------------------- */
export function makeVehicleMaterial() {
  return shader({
    vertex: /* glsl */`
      attribute vec3 aColor; attribute float aEmit;
      varying vec3 vN; varying vec3 vCol; varying float vEmit; varying vec3 vWorld; varying vec3 vTint;
      void main(){
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec3 tint = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          tint = instanceColor;
        #endif
        vec4 w = modelMatrix * im * vec4(position,1.0);
        vWorld = w.xyz; vN = normalize(mat3(modelMatrix*im)*normal); vCol = aColor; vEmit = aEmit; vTint = tint;
        gl_Position = projectionMatrix*viewMatrix*w;
      }`,
    fragment: GLSL_HEAD + /* glsl */`
      varying vec3 vN; varying vec3 vCol; varying float vEmit; varying vec3 vWorld; varying vec3 vTint;
      void main(){
        vec3 n = normalize(vN);
        float sun = max(dot(n,uSunDir),0.0); float hemi = 0.5+0.5*n.y;
        // aEmit: 0 — окрашиваемый кузов, 1 — светящиеся огни, 2 — тёмные неокрашиваемые детали
        vec3 base = vCol;
        if(vEmit < 0.5) base = vCol * vTint;
        vec3 col = base*(0.5*hemi + 0.85*sun);
        if(vEmit > 0.5 && vEmit < 1.5) col = vCol*1.8;
        float d = length(cameraPosition - vWorld);
        col = applyFog(col, d);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/* -------------------- светящиеся ленты потоков / кабелей -------------------- */
export function makeFlowMaterial(color, { speed = 0.7, dash = 26, core = 0.5, alpha = 1.0, depthTest = true } = {}) {
  return shader({
    transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uSpeed: { value: speed }, uDash: { value: dash },
      uCore: { value: core }, uAlpha: { value: alpha }, uPulse: { value: 0 }, uHi: { value: 0 },
    },
    vertex: /* glsl */`varying vec2 vUv; varying vec3 vWorld; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragment: GLSL_HEAD + /* glsl */`
      uniform vec3 uColor; uniform float uSpeed; uniform float uDash; uniform float uCore; uniform float uAlpha; uniform float uPulse; uniform float uHi;
      varying vec2 vUv; varying vec3 vWorld;
      void main(){
        float a = abs(vUv.x);
        float across = 1.0 - smoothstep(0.0, 1.0, a);
        float coreL = 1.0 - smoothstep(0.0, uCore, a);
        float ph = fract((vUv.y - uTime*uSpeed*uDash*0.9)/uDash);
        float dashV = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.35, 0.62, ph));
        float base = 0.22 + 0.78*dashV;
        float k = (across*0.55 + coreL*0.9) * base;
        k *= uAlpha * (1.0 + uHi*0.8);
        float d = length(cameraPosition - vWorld);
        k *= 1.0 - smoothstep(2600.0, 6000.0, d)*0.7;
        vec3 col = uColor * (0.9 + 0.6*coreL);
        gl_FragColor = vec4(col*k, k);
        #include <colorspace_fragment>
      }`,
  });
}

/* -------------------- световые колонны, кольца (аддитивные) -------------------- */
export function makeGlowMaterial(color, { height = 60, alpha = 0.6 } = {}) {
  return shader({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uH: { value: height }, uPulse: { value: 0 }, uSeed: { value: Math.random() * 10 } },
    vertex: /* glsl */`varying vec2 vUv; varying vec3 vWorld; varying vec3 vLocal; void main(){ vUv=uv; vLocal=position; vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragment: GLSL_HEAD + /* glsl */`
      uniform vec3 uColor; uniform float uAlpha; uniform float uH; uniform float uPulse; uniform float uSeed; varying vec2 vUv; varying vec3 vWorld; varying vec3 vLocal;
      void main(){
        float t = clamp(vUv.y, 0.0, 1.0);
        float g = pow(1.0 - t, 1.4);
        float pulse = 0.75 + 0.25*sin(uTime*(2.0+uPulse*5.0) + uSeed);
        float band = smoothstep(0.0,0.04,fract(t*6.0 - uTime*0.35 + uSeed)) * (1.0-smoothstep(0.06,0.2,fract(t*6.0 - uTime*0.35 + uSeed)));
        float k = uAlpha*(g*0.8 + band*0.35*g)*pulse;
        float d = length(cameraPosition - vWorld);
        k *= 1.0 - smoothstep(3500.0, 8000.0, d);
        gl_FragColor = vec4(uColor*k, k);
        #include <colorspace_fragment>
      }`,
  });
}

/* -------------------- голографические «призрачные» объекты (опции, превью) -------------------- */
export function makeHoloMaterial(color, alpha = 0.32) {
  return shader({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uScan: { value: 1 } },
    vertex: /* glsl */`varying vec3 vN; varying vec3 vWorld; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragment: GLSL_HEAD + /* glsl */`
      uniform vec3 uColor; uniform float uAlpha; uniform float uScan; varying vec3 vN; varying vec3 vWorld;
      void main(){
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - abs(dot(normalize(vN),V)), 1.6);
        float scan = 0.65 + 0.35*sin(vWorld.y*1.6 - uTime*3.0)*uScan;
        float k = (0.20 + 0.9*fres) * uAlpha * scan;
        gl_FragColor = vec4(uColor*k*1.6, k);
        #include <colorspace_fragment>
      }`,
  });
}

export const col = (hex) => new THREE.Color(hex);
