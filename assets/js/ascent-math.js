/* LawVault v7 — ascent math (pure functions, no DOM, no WebGL).
   Everything the 3D terrain needs that can be computed without a
   renderer lives here, so it can be unit-tested in Node: the noise
   heightfield, the vertex-colour rules, the scroll-to-camera mapping,
   and the day/night grading. All functions are deterministic: the same
   inputs always give the same outputs, on every device. */

export function clamp01(x) {
  if (typeof x !== 'number' || isNaN(x)) return 0;
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}

/* Frame-rate independent exponential smoothing. lambda ~3 gives a
   calm ~1s settle; larger values track the target more tightly. */
export function damp(current, target, lambda, dt) {
  if (!(dt > 0)) return target;
  var t = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * t;
}

/* Deterministic integer hash -> [0, 1). Works for negative inputs. */
export function hash2(x, y) {
  var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function smoothstep01(t) {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}

/* Bilinear-interpolated value noise, output in [0, 1]. */
export function valueNoise(x, y) {
  var xi = Math.floor(x), yi = Math.floor(y);
  var xf = x - xi, yf = y - yi;
  var u = smoothstep01(xf), v = smoothstep01(yf);
  var a = hash2(xi, yi), b = hash2(xi + 1, yi);
  var c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/* Fractal Brownian motion, output in [0, 1]. */
export function fbm(x, y, octaves) {
  var sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (var i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return norm > 0 ? sum / norm : 0;
}

/* Ridged multifractal: sharp crests, soft valleys. Output in [0, 1]. */
export function ridged(x, y, octaves) {
  var sum = 0, amp = 0.55, freq = 1, norm = 0;
  for (var i = 0; i < octaves; i++) {
    var n = 1 - Math.abs(2 * valueNoise(x * freq, y * freq) - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.11;
  }
  return norm > 0 ? sum / norm : 0;
}

/* 0 at the start of the flight (z >= 60), 1 at the summit (z <= -900). */
export function climbFactor(z) {
  return clamp01((60 - z) / 960);
}

/* 0 in the valley corridor (|x| small), 1 at the outer ridges. */
export function corridorMask(x) {
  return smoothstep01(Math.abs(x) / 110);
}

/* Terrain height in world units. The corridor the camera flies through
   stays low (peaks under ~14 units); the ridges rise to ~60 units and
   grow taller towards the summit end of the flight. */
export function terrainHeight(x, z) {
  var ridge = ridged(x * 0.011 + 7.3, z * 0.011 + 2.9, 4);
  var detail = fbm(x * 0.045 + 1.7, z * 0.045 + 8.4, 3);
  var mask = 0.18 + 0.82 * corridorMask(x);
  var climb = 0.55 + 0.45 * climbFactor(z);
  var h = (ridge * 52 + detail * 7) * mask * climb;
  h += 2.5 * fbm(x * 0.02 + 4.1, z * 0.02 + 5.2, 2);
  return h;
}

/* Vertex colour for a terrain point. h = height in world units,
   slope = 0 (flat) to 1 (vertical). Returns [r, g, b] in 0..1.
   Valleys are dark slate, mid slopes warm rock, high flat ground is
   snow; steep faces stay rock even above the snow line. */
export function heightColor(h, slope) {
  var valley = [0.10, 0.14, 0.13];
  var rock = [0.24, 0.22, 0.19];
  var highRock = [0.33, 0.31, 0.29];
  var snow = [0.92, 0.94, 0.95];
  var t = clamp01(h / 26);
  var r = lerp(valley[0], rock[0], t);
  var g = lerp(valley[1], rock[1], t);
  var b = lerp(valley[2], rock[2], t);
  var t2 = clamp01((h - 26) / 16);
  r = lerp(r, highRock[0], t2);
  g = lerp(g, highRock[1], t2);
  b = lerp(b, highRock[2], t2);
  /* Snow: only high, and only where the slope can hold it. */
  var snowiness = smoothstep01((h - 30) / 12) * (1 - smoothstep01((slope - 0.35) / 0.3));
  r = lerp(r, snow[0], snowiness);
  g = lerp(g, snow[1], snowiness);
  b = lerp(b, snow[2], snowiness);
  return [r, g, b];
}

/* Camera flight control points: [x, y, z], one per content chapter
   plus the opening position. The camera weaves through the valley and
   climbs towards the summit. Kept here (not in terrain.js) so the
   clearance test can check the flight path against terrainHeight. */
export var CAMERA_CONTROL_POINTS = [
  [0, 46, 120],
  [-38, 30, -60],
  [42, 24, -220],
  [-48, 30, -380],
  [30, 38, -540],
  [-24, 46, -680],
  [10, 58, -800],
  [0, 72, -920]
];

/* Turn section top offsets (px, ascending) into normalised scroll
   parameters in [0, 1]: the scroll position at which each chapter's
   camera stop is reached. `offsetPx` is how far past the top of the
   viewport a section must travel before its stop engages. The result
   is strictly increasing, so the camera never flies backwards. */
export function waypointParams(tops, maxScroll, offsetPx) {
  var out = [];
  if (!tops || !tops.length) return out;
  if (!(maxScroll > 0)) {
    for (var i = 0; i < tops.length; i++) out.push(i / Math.max(1, tops.length - 1));
    return out;
  }
  var prev = -1;
  for (var j = 0; j < tops.length; j++) {
    var p = clamp01((tops[j] - (offsetPx || 0)) / maxScroll);
    if (p <= prev) p = Math.min(1, prev + 0.02);
    /* If the stops run out of room at the end, pull the earlier ones
       back evenly instead of stacking them all at 1. */
    if (p >= 1 && j < tops.length - 1) p = 1 - (tops.length - 1 - j) * 0.02;
    if (p <= prev) p = prev;
    out.push(p);
    prev = p;
  }
  return out;
}

/* Map scroll progress p through chapter stops onto the camera curve
   parameter. stopParams and stopUs must be same-length ascending
   arrays; outside the stops the mapping clamps to the ends. With
   evenly spaced stops this is the identity mapping. */
export function progressToCurveT(p, stopParams, stopUs) {
  p = clamp01(p);
  if (!stopParams || !stopUs || stopParams.length < 2 || stopParams.length !== stopUs.length) return p;
  if (p <= stopParams[0]) {
    var f0 = stopParams[0] > 0 ? p / stopParams[0] : 1;
    return lerp(0, stopUs[0], f0);
  }
  var last = stopParams.length - 1;
  if (p >= stopParams[last]) {
    var span = 1 - stopParams[last];
    var f1 = span > 0 ? (p - stopParams[last]) / span : 1;
    return lerp(stopUs[last], 1, f1);
  }
  for (var i = 0; i < last; i++) {
    if (p <= stopParams[i + 1]) {
      var seg = stopParams[i + 1] - stopParams[i];
      var f = seg > 0 ? (p - stopParams[i]) / seg : 0;
      return lerp(stopUs[i], stopUs[i + 1], f);
    }
  }
  return p;
}

/* Day-to-night grading keyframes. Colours are linear-ish RGB triplets
   in 0..1. The ascent starts at dawn, brightens to day, fades through
   dusk, and ends under stars at the summit. */
var GRADE_KEYS = [
  { p: 0.00, sky: [0.36, 0.47, 0.55], fog: [0.23, 0.30, 0.33], sun: [1.00, 0.75, 0.55], sunI: 1.10, hemiI: 0.75, stars: 0.00, exposure: 1.00 },
  { p: 0.35, sky: [0.55, 0.68, 0.78], fog: [0.42, 0.52, 0.56], sun: [1.00, 0.95, 0.85], sunI: 1.60, hemiI: 1.00, stars: 0.00, exposure: 1.05 },
  { p: 0.70, sky: [0.32, 0.25, 0.38], fog: [0.20, 0.18, 0.26], sun: [1.00, 0.55, 0.35], sunI: 0.90, hemiI: 0.60, stars: 0.25, exposure: 0.95 },
  { p: 1.00, sky: [0.03, 0.05, 0.11], fog: [0.03, 0.05, 0.10], sun: [0.55, 0.65, 0.90], sunI: 0.35, hemiI: 0.35, stars: 1.00, exposure: 0.90 }
];

function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function dayNightGrade(p) {
  p = clamp01(p);
  var i = 0;
  while (i < GRADE_KEYS.length - 2 && p > GRADE_KEYS[i + 1].p) i++;
  var a = GRADE_KEYS[i], b = GRADE_KEYS[i + 1];
  var span = b.p - a.p;
  var t = span > 0 ? (p - a.p) / span : 0;
  return {
    sky: lerp3(a.sky, b.sky, t),
    fog: lerp3(a.fog, b.fog, t),
    sun: lerp3(a.sun, b.sun, t),
    sunIntensity: lerp(a.sunI, b.sunI, t),
    hemiIntensity: lerp(a.hemiI, b.hemiI, t),
    stars: lerp(a.stars, b.stars, t),
    exposure: lerp(a.exposure, b.exposure, t)
  };
}

/* Decorative altitude readout: scroll progress mapped onto the height
   of Everest (8,848 m). This is a scroll-progress display, never
   content data — the readout is always labelled as scroll progress. */
export function altitudeFor(p) {
  return Math.round(clamp01(p) * 8848);
}
