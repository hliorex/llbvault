/* LawVault v7 — "The Ascent" live 3D terrain.
   A fixed canvas behind all content renders procedural mountain
   terrain (Three.js, vendored locally — no CDN). Scrolling flies the
   camera along a glowing trail through the valleys, one stop per
   content chapter, while the light grades from dawn to starry night.

   Failure behaviour (all deliberate, all safe):
   - Reduced motion: this module is never loaded (see the loader in
     index.html) and the static Everest photo stays as the backdrop.
   - No WebGL / context creation failure / any init error: the canvas
     stays hidden and the static photo backdrop remains.
   - WebGL context lost at runtime: the canvas hides again and the
     photo backdrop takes over.
   The canvas never receives pointer events and never blocks taps,
   scrolling, or content. Content is fully usable with the 3D layer
   absent, because the terrain is decoration only. */

import * as THREE from 'three';
import {
  clamp01, damp, terrainHeight, heightColor,
  waypointParams, progressToCurveT, dayNightGrade, altitudeFor,
  CAMERA_CONTROL_POINTS
} from './ascent-math.js';

(function () {
  'use strict';

  /* Defence in depth: the loader in index.html already skips reduced
     motion and WebGL-less browsers, but never trust that alone. */
  var REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (REDUCED) return;

  var canvas = document.getElementById('terrainCanvas');
  if (!canvas) return;

  var root = document.documentElement;
  var isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var isSmallScreen = window.innerWidth < 760;
  var isMobile = isCoarse || isSmallScreen;

  var renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !isMobile,
      alpha: false,
      powerPreference: 'low-power',
      stencil: false,
      depth: true
    });
  } catch (e) {
    return; /* WebGL unavailable: the photo fallback stays. */
  }
  if (!renderer || !renderer.getContext()) return;

  var scene, camera, curve, trailMat, beaconMats, cloudPts, starPts,
      hemi, sun, sunTarget, clock;
  var rafId = 0, running = false, destroyed = false;
  var smoothedP = 0, targetP = 0;
  var mouseX = 0, mouseY = 0, smMouseX = 0, smMouseY = 0;
  var lastHeight = -1, lastReadout = '';
  var stopParams = [], stopUs = [];
  var readoutEl = document.getElementById('altitudeReadout');

  /* Chapter sections, in page order. Their offsets become the camera
     stops; if any are missing the mapping degrades to even spacing. */
  var CHAPTER_IDS = ['home', 'today', 'semesters', 'cases', 'papers', 'exam', 'pending', 'contact'];

  function computeStops() {
    var tops = [];
    CHAPTER_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      /* Hidden sections (section visibility off) have no boxes; they
         get no camera stop instead of a bogus one. */
      if (!el.getClientRects || el.getClientRects().length === 0) return;
      var r = el.getBoundingClientRect();
      tops.push(r.top + window.scrollY);
    });
    tops.sort(function (a, b) { return a - b; });
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var offset = window.innerHeight * 0.35;
    stopParams = waypointParams(tops, max, offset);
    stopUs = [];
    for (var i = 0; i < stopParams.length; i++) {
      stopUs.push(i / Math.max(1, stopParams.length - 1));
    }
    lastHeight = document.documentElement.scrollHeight;
  }

  function softDotTexture(inner, outer) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(0.4, outer);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function buildTerrain(width, depth, segX, segZ, zCenter, heightScale, darken) {
    var geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var eps = 2;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var z = pos.getZ(i) + zCenter;
      var h = terrainHeight(x, z) * heightScale;
      pos.setY(i, h);
      /* Slope from finite differences of the same heightfield. */
      var dhdx = (terrainHeight(x + eps, z) - terrainHeight(x - eps, z)) / (2 * eps);
      var dhdz = (terrainHeight(x, z + eps) - terrainHeight(x, z - eps)) / (2 * eps);
      var slope = clamp01(Math.sqrt(dhdx * dhdx + dhdz * dhdz) / 6);
      var col = heightColor(h, slope);
      colors[i * 3] = col[0] * darken;
      colors[i * 3 + 1] = col[1] * darken;
      colors[i * 3 + 2] = col[2] * darken;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      metalness: 0
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = zCenter;
    mesh.frustumCulled = false;
    return mesh;
  }

  function buildClouds(count) {
    var geo = new THREE.BufferGeometry();
    var positions = new Float32Array(count * 3);
    var speeds = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * 260;
      positions[i * 3 + 1] = 16 + Math.random() * 42;
      positions[i * 3 + 2] = 100 - Math.random() * 1000;
      speeds[i] = 0.6 + Math.random() * 1.4;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      map: softDotTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0.35)'),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      size: 34,
      sizeAttenuation: true,
      color: 0xdfe9e6
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData.speeds = speeds;
    return pts;
  }

  function buildStars(count) {
    var geo = new THREE.BufferGeometry();
    var positions = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      /* Upper dome, well above the terrain, far from the camera. */
      var theta = Math.random() * Math.PI * 2;
      var phi = Math.random() * Math.PI * 0.42;
      var r = 850;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = 60 + r * Math.cos(phi) * 0.55;
      positions[i * 3 + 2] = -450 + r * Math.sin(phi) * Math.sin(theta) * 0.8;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xcfe0ff,
      size: 1.8,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  function readAccent() {
    try {
      var v = window.getComputedStyle(root).getPropertyValue('--accent');
      var c = new THREE.Color((v || '#20E6A0').trim());
      return c;
    } catch (e) {
      return new THREE.Color('#20E6A0');
    }
  }

  function applyAccent() {
    var c = readAccent();
    if (trailMat) trailMat.color.copy(c);
    (beaconMats || []).forEach(function (m) { m.color.copy(c); });
  }

  function init() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x3a4a48, isMobile ? 0.0042 : 0.0036);

    camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2400);

    /* Backdrop photo as the sky: the same image as the static
       fallback, so the live scene and the fallback agree visually.
       If it fails to load, the graded sky colour stands alone. */
    var grade0 = dayNightGrade(0);
    scene.background = new THREE.Color(grade0.sky[0], grade0.sky[1], grade0.sky[2]);
    try {
      new THREE.TextureLoader().load(
        './assets/img/everest-backdrop.jpg',
        function (tex) {
          tex.colorSpace = THREE.SRGBColorSpace;
          if (!destroyed) scene.background = tex;
        },
        undefined,
        function () { /* keep the graded colour background */ }
      );
    } catch (e) { /* keep the graded colour background */ }

    hemi = new THREE.HemisphereLight(0xbfd4cc, 0x1c2622, 0.85);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffe0b8, 1.1);
    sunTarget = new THREE.Object3D();
    scene.add(sunTarget);
    sun.target = sunTarget;
    scene.add(sun);

    /* Main terrain: the valley the camera flies through. */
    var segX = isMobile ? 110 : 190;
    var segZ = isMobile ? 130 : 220;
    scene.add(buildTerrain(520, 1100, segX, segZ, -450, 1, 1));
    /* Distant silhouette ridge for depth, mostly fog-tinted. */
    scene.add(buildTerrain(760, 520, 90, 30, -1250, 1.35, 0.55));

    cloudPts = buildClouds(isMobile ? 120 : 220);
    scene.add(cloudPts);
    starPts = buildStars(isMobile ? 220 : 420);
    scene.add(starPts);

    /* Flight path + glowing trail + chapter beacons. */
    var pts = CAMERA_CONTROL_POINTS.map(function (p) {
      return new THREE.Vector3(p[0], p[1], p[2]);
    });
    curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    var accent = readAccent();
    trailMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    var tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 240, 0.45, 6, false),
      trailMat
    );
    tube.frustumCulled = false;
    scene.add(tube);

    beaconMats = [];
    var beaconTex = softDotTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.25)');
    pts.forEach(function (p, i) {
      if (i === 0) return;
      var m = new THREE.SpriteMaterial({
        map: beaconTex,
        color: accent.clone(),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      beaconMats.push(m);
      var s = new THREE.Sprite(m);
      s.position.copy(p);
      s.scale.set(7, 7, 1);
      scene.add(s);
    });

    clock = new THREE.Clock();
    computeStops();
    onResize();
    applyAccent();

    /* Theme changes (mode / colour / festival) re-tint the trail. */
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].attributeName === 'data-mode' ||
              muts[i].attributeName === 'data-color' ||
              muts[i].attributeName === 'data-festival') {
            applyAccent();
            return;
          }
        }
      });
      mo.observe(root, { attributes: true });
    }

    root.classList.add('terrain-live');
    start();
  }

  function onResize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    computeStops();
  }

  function readScrollTarget() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    targetP = max > 0 ? clamp01(window.scrollY / max) : 0;
  }

  function updateReadout(p) {
    if (!readoutEl) return;
    var pct = Math.round(p * 100);
    var alt = altitudeFor(p);
    var text = 'SCROLL ' + pct + '% · ' + alt.toLocaleString('en-IN') + ' M';
    if (text !== lastReadout) {
      lastReadout = text;
      readoutEl.textContent = text;
    }
  }

  function frame() {
    if (!running || destroyed) return;
    rafId = requestAnimationFrame(frame);
    var dt = Math.min(0.05, clock.getDelta());
    var t = clock.elapsedTime;

    /* Content renders asynchronously; if the page grew, the chapter
       stops move, so recompute them when the height changes. */
    if (document.documentElement.scrollHeight !== lastHeight) computeStops();
    readScrollTarget();
    smoothedP = damp(smoothedP, targetP, 3.2, dt);
    smMouseX = damp(smMouseX, mouseX, 4, dt);
    smMouseY = damp(smMouseY, mouseY, 4, dt);

    var curveT = progressToCurveT(smoothedP, stopParams, stopUs);
    var pos = curve.getPointAt(curveT);
    var ahead = curve.getPointAt(Math.min(1, curveT + 0.055));

    /* Gentle idle drift so the scene breathes when still. */
    var driftX = Math.sin(t * 0.12) * 0.7;
    var driftY = Math.sin(t * 0.09 + 1.3) * 0.5;
    camera.position.set(
      pos.x + smMouseX * 3 + driftX,
      pos.y + smMouseY * 1.5 + driftY,
      pos.z
    );
    camera.lookAt(ahead.x + smMouseX * 6, ahead.y - 2 + smMouseY * 2, ahead.z);

    /* Sun follows the camera so the valleys stay lit along the flight. */
    sun.position.set(camera.position.x + 120, camera.position.y + 190, camera.position.z - 220);
    sunTarget.position.copy(camera.position);

    /* Day/night grading from scroll progress. */
    var g = dayNightGrade(smoothedP);
    var lightMode = root.getAttribute('data-mode') === 'light';
    var fogCol = new THREE.Color(g.fog[0], g.fog[1], g.fog[2]);
    if (lightMode) fogCol.lerp(new THREE.Color(0.88, 0.92, 0.89), 0.55);
    scene.fog.color.copy(fogCol);
    if (scene.background && scene.background.isColor) {
      scene.background.setRGB(g.sky[0], g.sky[1], g.sky[2]);
      if (lightMode) scene.background.lerp(new THREE.Color(0.85, 0.90, 0.87), 0.5);
    }
    sun.color.setRGB(g.sun[0], g.sun[1], g.sun[2]);
    sun.intensity = g.sunIntensity;
    hemi.intensity = g.hemiIntensity * (lightMode ? 1.25 : 1);
    if (starPts) starPts.material.opacity = g.stars;
    renderer.toneMappingExposure = g.exposure;
    if (cloudPts) cloudPts.material.opacity = 0.5 * (1 - g.stars * 0.55);

    /* Cloud drift. */
    if (cloudPts) {
      var arr = cloudPts.geometry.attributes.position;
      var speeds = cloudPts.userData.speeds;
      for (var i = 0; i < speeds.length; i++) {
        var nx = arr.getX(i) + speeds[i] * dt;
        if (nx > 280) nx = -280;
        arr.setX(i, nx);
      }
      arr.needsUpdate = true;
    }

    updateReadout(smoothedP);
    renderer.render(scene, camera);
  }

  function start() {
    if (running || destroyed) return;
    running = true;
    clock.getDelta();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function destroy() {
    destroyed = true;
    stop();
    root.classList.remove('terrain-live');
    try { renderer.dispose(); } catch (e) {}
  }

  /* Never run the loop while the tab is hidden. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (!destroyed) start();
  });

  /* A lost context hands the backdrop back to the static photo. */
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    destroy();
  });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(onResize, 120);
  }, { passive: true });

  window.addEventListener('scroll', readScrollTarget, { passive: true });

  /* Mouse parallax: fine pointers only, so touch scrolling is untouched. */
  if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('mousemove', function (e) {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }

  try {
    init();
  } catch (e) {
    /* Any failure leaves the static photo backdrop in place. */
    try { destroy(); } catch (ignored) {}
  }
})();
