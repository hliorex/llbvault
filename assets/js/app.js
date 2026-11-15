/* LawVault v6 — app.js
   Renders the site from data/site-config.json + data/content.json, and
   runs the Delta × VineWinner presentation layer (preloader, particles,
   spotlight, curtain transitions, scroll reveals, notifications popup,
   PWA install guidance, slide-in panels).
   v6 is a UI redesign of the v5 public site only: the data layer below
   (Google Sheets gviz reading with local JSON fallback), the theme and
   festival engine, search, bookmarks, and publish/expiry rules are
   functionally identical to v5. The admin panel is unchanged.
   Security: every config string is inserted as plain text (textContent),
   never as HTML. Only https:// links are accepted. Theme names must be
   from the config allowlists.
   Progressive enhancement: the `js` class is added to <html> first, and
   every hiding/reveal effect in CSS is gated behind it, so content stays
   visible if this script fails to load. */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* Storage keys are kept at their v3 names on purpose, so bookmarks,
     recent views, theme choices, and checklists carry over from v3. */
  var THEME_KEY = 'lv-theme-v3';
  var BM_KEY = 'lv-bookmarks-v3';
  var RECENT_KEY = 'lv-recent-v3';
  var CHECK_KEY = 'lv-checklist-v3';
  var MOTION_KEY = 'lv-motion-v3';
  var TZ = 'Asia/Kolkata';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Motion preference: the OS reduced-motion setting always wins; the
     visitor can additionally pause ambient motion from the appearance
     panel. Stored separately from the theme prefs. */
  function motionPrefPaused() {
    try {
      var raw = localStorage.getItem(MOTION_KEY);
      return raw ? !!JSON.parse(raw).paused : false;
    } catch (e) { return false; }
  }
  function saveMotionPref(paused) {
    try { localStorage.setItem(MOTION_KEY, JSON.stringify({ paused: !!paused })); } catch (e) {}
  }
  function applyMotionPref() {
    document.body.classList.toggle('motion-paused', motionPrefPaused());
  }
  function motionAllowed() {
    return !REDUCED && !document.body.classList.contains('motion-paused');
  }
  applyMotionPref();

  /* ---------- small helpers ---------- */
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function safeUrl(u) {
    if (typeof u !== 'string') return null;
    var t = u.trim();
    return /^https:\/\//i.test(t) ? t : null;
  }
  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function fmtDT(iso) {
    try {
      return new Date(iso).toLocaleString('en-IN', {
        timeZone: TZ, day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch (e) { return ''; }
  }
  function driveLink(url, label, small) {
    var a = h('a', 'btn drive-btn' + (small ? ' small' : ''), label || 'Open Notes ↗');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Opens in Google Drive';
    return a;
  }

  /* ---------- themes (unchanged from v3) ---------- */
  function loadThemePrefs(cfg) {
    var d = (cfg.theme || {});
    var p = loadJson(THEME_KEY, {});
    var mode = p.mode === 'light' ? 'light' : (d.defaultMode === 'light' ? 'light' : 'dark');
    var colors = (d.colors || []).map(function (c) { return c.id; });
    var color = colors.indexOf(p.color) !== -1 ? p.color : (d.defaultColor || 'emerald');
    var auto = p.auto === undefined ? (d.autoFestival !== false) : !!p.auto;
    return { mode: mode, color: color, auto: auto };
  }
  function saveThemePrefs(p) { saveJson(THEME_KEY, p); }
  function festivalForToday(cfg, now) {
    var list = (cfg.theme && cfg.theme.festivals) || [];
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var cur = mm + '-' + dd;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f && f.start && f.end && cur >= f.start && cur <= f.end) return f;
    }
    return null;
  }
  function hexToRgb(hex) {
    var m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
  }
  /* The effective accent colour, for the particles canvas. Refreshed
     whenever the theme is applied; falls back to emerald. */
  var PARTICLE_RGB = '32, 230, 160';
  function refreshParticleRgb() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
      if (v) PARTICLE_RGB = v;
    } catch (e) {}
  }
  function applyTheme(cfg) {
    var prefs = loadThemePrefs(cfg);
    var fest = prefs.auto ? festivalForToday(cfg, new Date()) : null;
    var root = document.documentElement;
    root.setAttribute('data-mode', prefs.mode);
    root.setAttribute('data-color', prefs.color);
    root.setAttribute('data-festival', fest ? fest.id : 'none');
    /* Festival palettes come from the config (Sheet settings may
       override them). Applied as inline vars so a Sheet palette edit
       actually takes effect; the CSS festival layers are the fallback
       when a value is missing or invalid. Without a festival, the
       inline vars are removed so the manual colour layers apply. */
    if (fest && hexToRgb(fest.accent)) {
      root.style.setProperty('--accent', fest.accent);
      if (hexToRgb(fest.accent2)) root.style.setProperty('--accent-2', fest.accent2);
      root.style.setProperty('--accent-rgb', hexToRgb(fest.accent));
    } else {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-2');
      root.style.removeProperty('--accent-rgb');
    }
    refreshParticleRgb();
    var note = document.getElementById('festivalNote');
    if (note) {
      if (fest) {
        note.textContent = '✨ ' + fest.name + ' theme is on — change it anytime from the theme button (top right).';
      } else {
        note.textContent = '';
      }
    }
    syncThemePanel(cfg, prefs, fest);
  }
  function syncThemePanel(cfg, prefs, fest) {
    var panel = document.getElementById('themePanel');
    if (!panel) return;
    var colors = (cfg.theme && cfg.theme.colors) || [];
    var colorName = 'Emerald';
    colors.forEach(function (c) { if (c.id === prefs.color) colorName = c.name; });
    var modeT = panel.querySelector('[data-tmode]');
    if (modeT) {
      modeT.setAttribute('aria-checked', prefs.mode === 'light' ? 'true' : 'false');
      var lbl = modeT.querySelector('[data-tmode-label]');
      if (lbl) lbl.textContent = prefs.mode === 'light' ? '☀️ Light active' : '🌙 Dark active';
    }
    var modeSub = panel.querySelector('[data-modesub]');
    if (modeSub) {
      modeSub.textContent = prefs.mode === 'light'
        ? 'Light — Parchment & Crema (' + colorName + ')'
        : 'Dark — Deep Cellar & ' + colorName;
    }
    panel.querySelectorAll('.swatch').forEach(function (s) {
      s.classList.toggle('active', s.getAttribute('data-color') === prefs.color && !fest);
    });
    var autoT = panel.querySelector('[data-tauto]');
    if (autoT) autoT.setAttribute('aria-checked', prefs.auto ? 'true' : 'false');
    var autoState = panel.querySelector('[data-autostate]');
    if (autoState) {
      autoState.textContent = prefs.auto
        ? (fest ? 'Auto — ' + fest.name + ' active' : 'Auto — no festival today')
        : 'Auto off';
    }
    var motionT = panel.querySelector('[data-tmotion]');
    if (motionT) motionT.setAttribute('aria-checked', motionPrefPaused() ? 'true' : 'false');
  }
  function buildThemePanel(cfg) {
    var panel = document.getElementById('themePanel');
    if (!panel) return;
    panel.innerHTML = '';
    var head = h('div', 'panel-head');
    var headTx = h('div');
    headTx.appendChild(h('h3', null, 'Appearance'));
    headTx.appendChild(h('p', 'panel-sub', 'Theme, colour, festivals, motion'));
    head.appendChild(headTx);
    var close = h('button', 'icon-btn small', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close appearance settings');
    close.addEventListener('click', closePanels);
    head.appendChild(close);
    panel.appendChild(head);

    /* Theme mode */
    var card1 = h('div', 'panel-card');
    var row1 = h('div', 'theme-row');
    var tx1 = h('div');
    tx1.appendChild(h('h4', null, 'Theme Mode'));
    var sub = h('p', 'panel-desc', '');
    sub.setAttribute('data-modesub', '1');
    tx1.appendChild(sub);
    row1.appendChild(tx1);
    var modeT = h('button', 'mode-toggle-btn');
    modeT.type = 'button';
    modeT.setAttribute('data-tmode', '1');
    modeT.setAttribute('role', 'switch');
    modeT.setAttribute('aria-label', 'Toggle light theme');
    modeT.appendChild(h('span', null, '🌙 Dark / ☀️ Light')).setAttribute('data-tmode-label', '1');
    modeT.addEventListener('click', function () {
      var p = loadThemePrefs(cfg);
      p.mode = p.mode === 'light' ? 'dark' : 'light';
      saveThemePrefs(p); applyTheme(cfg);
    });
    row1.appendChild(modeT);
    card1.appendChild(row1);
    panel.appendChild(card1);

    /* Accent colour */
    var card2 = h('div', 'panel-card');
    card2.appendChild(h('h4', null, 'Accent Colour'));
    card2.appendChild(h('p', 'panel-desc', 'Each colour restyles the whole site, including particles and glow.'));
    var sw = h('div', 'swatches');
    (cfg.theme.colors || []).forEach(function (c) {
      var b = h('button', 'swatch');
      b.type = 'button';
      b.setAttribute('data-color', c.id);
      b.setAttribute('aria-label', c.name + ' colour');
      var dot = h('span', 'swatch-dot');
      dot.style.background = c.swatch;
      b.appendChild(dot);
      b.appendChild(h('span', 'swatch-name', c.name));
      b.appendChild(h('span', 'swatch-hex', c.swatch));
      b.addEventListener('click', function () {
        var p = loadThemePrefs(cfg);
        p.color = c.id;
        saveThemePrefs(p); applyTheme(cfg);
      });
      sw.appendChild(b);
    });
    card2.appendChild(sw);
    panel.appendChild(card2);

    /* Festival themes */
    var card3 = h('div', 'panel-card');
    var row3 = h('div', 'theme-row');
    var tx3 = h('div');
    tx3.appendChild(h('h4', null, 'Festival themes (auto)'));
    tx3.appendChild(h('p', 'panel-desc', 'Auto-activates on the configured festival dates.'));
    row3.appendChild(tx3);
    var autoT = h('button', 'toggle');
    autoT.type = 'button';
    autoT.setAttribute('data-tauto', '1');
    autoT.setAttribute('role', 'switch');
    autoT.setAttribute('aria-label', 'Toggle automatic festival themes');
    autoT.addEventListener('click', function () {
      var p = loadThemePrefs(cfg);
      p.auto = !p.auto;
      saveThemePrefs(p); applyTheme(cfg);
    });
    row3.appendChild(autoT);
    card3.appendChild(row3);
    var stRow = h('div', 'festival-status');
    stRow.appendChild(h('span', null, 'Status:'));
    var st = h('span', 'accent-text');
    st.setAttribute('data-autostate', '1');
    stRow.appendChild(st);
    card3.appendChild(stRow);
    panel.appendChild(card3);

    /* Motion */
    var card4 = h('div', 'panel-card');
    var row4 = h('div', 'theme-row');
    var tx4 = h('div');
    tx4.appendChild(h('h4', null, 'Reduce motion'));
    tx4.appendChild(h('p', 'panel-desc', 'Pauses particles, glow, reveals and the ticker. Your system reduced-motion setting always applies too.'));
    row4.appendChild(tx4);
    var motionT = h('button', 'toggle');
    motionT.type = 'button';
    motionT.setAttribute('data-tmotion', '1');
    motionT.setAttribute('role', 'switch');
    motionT.setAttribute('aria-label', 'Toggle reduced motion');
    motionT.addEventListener('click', function () {
      saveMotionPref(!motionPrefPaused());
      applyMotionPref();
      syncThemePanel(cfg, loadThemePrefs(cfg), festivalForToday(cfg, new Date()));
    });
    row4.appendChild(motionT);
    card4.appendChild(row4);
    panel.appendChild(card4);

    panel.appendChild(h('p', 'search-note', 'Festival dates are defaults — confirm them each year in data/site-config.json.'));
  }

  /* ---------- bookmarks & recently viewed ---------- */
  function getBookmarks() { return loadJson(BM_KEY, []); }
  function isBookmarked(id) { return getBookmarks().indexOf(id) !== -1; }
  function toggleBookmark(id) {
    var list = getBookmarks();
    var i = list.indexOf(id);
    if (i === -1) list.push(id); else list.splice(i, 1);
    saveJson(BM_KEY, list);
    return i === -1;
  }
  function recordView(item) {
    var list = loadJson(RECENT_KEY, []).filter(function (x) { return x.id !== item.id; });
    list.unshift({ id: item.id, title: item.title, link: item.link || null, section: item.sectionLabel || '' });
    saveJson(RECENT_KEY, list.slice(0, 12));
  }
  function bookmarkBtn(id) {
    var b = h('button', 'bookmark-btn' + (isBookmarked(id) ? ' saved' : ''));
    b.type = 'button';
    b.innerHTML = isBookmarked(id) ? '★' : '☆';
    b.title = isBookmarked(id) ? 'Remove bookmark' : 'Bookmark this';
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var saved = toggleBookmark(id);
      b.classList.toggle('saved', saved);
      b.innerHTML = saved ? '★' : '☆';
      b.title = saved ? 'Remove bookmark' : 'Bookmark this';
      updateSavedBadge();
      showToast(saved ? 'Bookmarked — find it under ☆ in the header.' : 'Bookmark removed.');
      renderSaved();
    });
    return b;
  }
  function updateSavedBadge() {
    var badge = document.getElementById('savedCount');
    if (!badge) return;
    var n = getBookmarks().length;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('on', n > 0);
  }

  /* ---------- toast ---------- */
  var toastTimer = null;
  function showToast(msg) {
    var banner = document.getElementById('toastBanner');
    var text = document.getElementById('toastMessage');
    if (!banner || !text) return;
    text.textContent = msg;
    banner.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { banner.classList.remove('show'); }, 2600);
  }

  /* ---------- slide-in panels ---------- */
  function openPanel(which) {
    closePanels();
    var panel = document.getElementById(which === 'theme' ? 'themePanel' : 'savedPanel');
    var backdrop = document.getElementById(which === 'theme' ? 'themeBackdrop' : 'savedBackdrop');
    if (panel) panel.classList.add('open');
    if (backdrop) backdrop.hidden = false;
  }
  function closePanels() {
    ['themePanel', 'savedPanel'].forEach(function (id) {
      var p = document.getElementById(id);
      if (p) p.classList.remove('open');
    });
    ['themeBackdrop', 'savedBackdrop'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.hidden = true;
    });
  }

  /* ---------- curtain wipe transition ---------- */
  var wipeTimeoutA = null, wipeTimeoutB = null;
  function withCurtain(label, fn) {
    var curtain = document.getElementById('curtainWipe');
    if (!curtain || !motionAllowed()) { fn(); return; }
    var labelEl = document.getElementById('curtainLabel');
    if (labelEl && label) labelEl.textContent = label;
    if (wipeTimeoutA) clearTimeout(wipeTimeoutA);
    if (wipeTimeoutB) clearTimeout(wipeTimeoutB);
    curtain.classList.remove('wiping-out');
    curtain.classList.add('wiping-in');
    wipeTimeoutA = setTimeout(function () {
      fn();
      curtain.classList.remove('wiping-in');
      curtain.classList.add('wiping-out');
      wipeTimeoutB = setTimeout(function () { curtain.classList.remove('wiping-out'); }, 500);
    }, 420);
  }

  /* ---------- shared card builders ---------- */
  function emptyState(title, text) {
    var d = h('div', 'card empty');
    d.appendChild(h('strong', null, title));
    d.appendChild(document.createTextNode(text));
    return d;
  }
  function demoBadge() { return h('span', 'badge demo', 'DEMO'); }

  /* ---------- renderers ---------- */
  var CFG, CONTENT, SEARCH_INDEX = [];

  function renderNav() {
    var nav = document.getElementById('mainNav');
    nav.innerHTML = '';
    (CFG.navigation || []).forEach(function (n, i) {
      var a = h('a', i === 0 ? 'active' : '', n.label);
      a.href = n.href || '#home';
      a.addEventListener('click', function () { nav.classList.remove('mobile-open'); });
      nav.appendChild(a);
    });
  }

  function renderWelcome() {
    var s = CFG.site || {};
    var t = document.getElementById('welcomeTitle');
    t.innerHTML = '';
    var full = String(s.welcomeTitle || 'Your LLB Study Space');
    var hl = String(s.welcomeHighlight || 'LLB');
    var idx = full.indexOf(hl);
    if (idx !== -1) {
      t.appendChild(document.createTextNode(full.slice(0, idx)));
      var sp = h('span', 'hl', hl);
      t.appendChild(sp);
      t.appendChild(document.createTextNode(full.slice(idx + hl.length)));
    } else {
      t.textContent = full;
    }
    document.getElementById('welcomeSub').textContent = s.welcomeSubtitle || '';
    splitMasked(t);
  }

  function activeTodayItems() {
    var tn = CONTENT.todayNotes || {};
    if (tn.enabled === false) return [];
    var hours = Number(tn.expiryHours) || 24;
    var now = Date.now();
    return (tn.items || []).filter(function (it) {
      if (it.visible === false) return false;
      if (!it.publishedAt) return true;
      var t = Date.parse(it.publishedAt);
      if (isNaN(t)) return false;
      return (now - t) < hours * 3600 * 1000;
    });
  }

  function renderToday() {
    var tn = CONTENT.todayNotes || {};
    var box = document.getElementById('todayBody');
    box.innerHTML = '';
    var wrap = h('div');
    var badges = h('div');
    badges.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;';
    badges.appendChild(h('span', 'badge ok', '● ' + (tn.updatedLabel || 'Updated today')));
    badges.appendChild(h('span', 'badge', '◷ ' + (tn.label || 'Active for 24 Hours')));
    wrap.appendChild(badges);
    if (tn.enabled === false) {
      wrap.appendChild(emptyState("Today's Notes is off", 'The administrator has disabled this section.'));
    } else {
      var items = activeTodayItems();
      if (!items.length) {
        wrap.appendChild(emptyState('No notes scheduled', "Nothing is scheduled for today's notes yet. Check back later or open the main Drive folder."));
        var link = safeUrl((CFG.site || {}).mainDriveFolder);
        if (link) {
          var p = h('div'); p.style.textAlign = 'center'; p.style.marginTop = '10px';
          p.appendChild(driveLink(link, (CFG.site || {}).mainDriveFolderLabel || 'Open main Drive folder', true));
          wrap.appendChild(p);
        }
      } else {
        var grid = h('div', 'today-cards');
        items.forEach(function (it) {
          var card = h('div', 'card today-card reveal');
          card.setAttribute('data-tilt', '1');
          var main = h('div', 'today-main');
          var tile = h('span', 'note-tile', String(it.title || '?').charAt(0).toUpperCase());
          main.appendChild(tile);
          var body = h('div', 'today-body');
          body.appendChild(h('h3', null, it.title));
          body.appendChild(h('p', null, it.description || ''));
          main.appendChild(body);
          card.appendChild(main);
          var acts = h('div', 'today-actions');
          var url = safeUrl(it.link);
          if (url) {
            acts.appendChild(bookmarkBtn(it.id));
            acts.appendChild(driveLink(url, 'Open Notes ↗', true));
            recordViewOnClick(acts, { id: it.id, title: it.title, link: url, sectionLabel: "Today's Notes" });
          }
          card.appendChild(acts);
          grid.appendChild(card);
        });
        wrap.appendChild(grid);
      }
    }
    box.appendChild(wrap);
  }
  function recordViewOnClick(container, item) {
    container.addEventListener('click', function () { recordView(item); }, true);
  }

  function renderUpdates() {
    var list = (CONTENT.latestUpdates || []).filter(function (u) { return u.visible !== false; });
    var box = document.getElementById('updatesBody');
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(emptyState('No updates yet', 'Announcements and updates from the administrator will appear here.'));
      return;
    }
    var ul = h('ul', 'timeline');
    list.forEach(function (u) {
      var li = h('li');
      li.appendChild(h('span', 'tdot'));
      var meta = h('div', 'update-meta');
      if (u.publishedAt) meta.appendChild(h('time', null, fmtDT(u.publishedAt)));
      if (u.important) meta.appendChild(h('span', 'badge ok', 'Important'));
      else if (u.publishedAt && Date.now() - Date.parse(u.publishedAt) < 24 * 3600 * 1000)
        meta.appendChild(h('span', 'badge ok', 'New'));
      li.appendChild(meta);
      li.appendChild(h('h4', null, u.title));
      if (u.description) li.appendChild(h('p', null, u.description));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  function subjectsFor(semId) {
    return (CONTENT.subjects || []).filter(function (s) {
      return s.visible !== false && s.semesterId === semId;
    });
  }
  var activeSem = null;
  function renderSemesters() {
    var sems = (CONTENT.semesters || []).filter(function (s) { return s.visible !== false; });
    if (!activeSem || !sems.some(function (s) { return s.id === activeSem; })) {
      var def = sems.find(function (s) { return s.default; }) || sems[0];
      activeSem = def ? def.id : null;
    }
    var tabs = document.getElementById('semTabs');
    tabs.innerHTML = '';
    sems.forEach(function (s) {
      var b = h('button', 'sem-tab' + (s.id === activeSem ? ' active' : ''), s.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', s.id === activeSem ? 'true' : 'false');
      b.addEventListener('click', function () { activeSem = s.id; renderSemesters(); });
      tabs.appendChild(b);
    });
    var grid = document.getElementById('semGrid');
    grid.innerHTML = '';
    var subs = activeSem ? subjectsFor(activeSem) : [];
    if (!subs.length) {
      grid.appendChild(emptyState('Not configured yet', 'No subjects have been configured for this semester.'));
      return;
    }
    var icons = ['📚', '⚖️', '📜', '🏛️', '📖'];
    subs.forEach(function (s, i) {
      var url = safeUrl(s.link);
      var card = h('a', 'card subj-card reveal');
      card.href = url || '#semesters';
      if (url) { card.target = '_blank'; card.rel = 'noopener'; }
      var ic = h('span', 'subj-ico', icons[i % icons.length]);
      card.appendChild(ic);
      var tx = h('div');
      tx.appendChild(h('h3', null, s.paper || s.title));
      tx.appendChild(h('p', null, (s.unit ? s.unit + ' • ' : '') + (s.description || '')));
      card.appendChild(tx);
      card.appendChild(h('span', 'go', '›'));
      if (url) recordViewOnClick(card, { id: s.id, title: s.title, link: url, sectionLabel: 'Semester Notes' });
      grid.appendChild(card);
    });
  }

  function renderCases() {
    var list = (CONTENT.caseLaws || []).filter(function (c) { return c.visible !== false; });
    var wrap = document.getElementById('casesBody');
    wrap.innerHTML = '';
    var filters = h('div', 'filters');
    var q = h('input'); q.type = 'search'; q.placeholder = 'Search case name…'; q.setAttribute('aria-label', 'Search cases');
    var subj = h('select'); subj.setAttribute('aria-label', 'Filter by subject');
    subj.appendChild(new Option('All subjects', ''));
    var year = h('select'); year.setAttribute('aria-label', 'Filter by year');
    year.appendChild(new Option('All years', ''));
    var subjects = [], years = [];
    list.forEach(function (c) {
      if (c.subject && subjects.indexOf(c.subject) === -1) subjects.push(c.subject);
      if (c.year && years.indexOf(c.year) === -1) years.push(c.year);
    });
    subjects.forEach(function (s) { subj.appendChild(new Option(s, s)); });
    years.forEach(function (y) { year.appendChild(new Option(y, y)); });
    filters.appendChild(q); filters.appendChild(subj); filters.appendChild(year);
    wrap.appendChild(filters);
    var grid = h('div', 'grid');
    wrap.appendChild(grid);
    var more = h('div', 'show-more-wrap');
    wrap.appendChild(more);
    function draw(expanded) {
      grid.innerHTML = ''; more.innerHTML = '';
      var qq = q.value.trim().toLowerCase();
      var rows = list.filter(function (c) {
        if (subj.value && c.subject !== subj.value) return false;
        if (year.value && String(c.year) !== year.value) return false;
        if (qq && (c.title + ' ' + (c.subject || '')).toLowerCase().indexOf(qq) === -1) return false;
        return true;
      });
      if (!rows.length) { grid.appendChild(emptyState('No case laws found', 'Try a different search or filter.')); return; }
      var show = expanded ? rows : rows.slice(0, 6);
      show.forEach(function (c) {
        var card = h('div', 'card mini-card reveal');
        if (c.demo) card.appendChild(demoBadge());
        card.appendChild(h('h3', null, c.title));
        card.appendChild(h('p', null, [c.year, c.subject].filter(Boolean).join(' • ')));
        var row = h('div', 'today-actions');
        var v = h('button', 'btn small', 'View Case');
        v.type = 'button';
        v.addEventListener('click', function () { openCaseDetail(c); });
        row.appendChild(v);
        row.appendChild(bookmarkBtn(c.id));
        card.appendChild(row);
        grid.appendChild(card);
      });
      if (rows.length > 6 && !expanded) {
        var b = h('button', 'btn ghost small', 'Show all (' + rows.length + ')');
        b.type = 'button';
        b.addEventListener('click', function () { draw(true); });
        more.appendChild(b);
      }
    }
    q.addEventListener('input', function () { draw(false); });
    subj.addEventListener('change', function () { draw(false); });
    year.addEventListener('change', function () { draw(false); });
    draw(false);
  }

  function openCaseDetail(c) {
    withCurtain(c.title, function () { showCaseDetail(c); });
  }
  function showCaseDetail(c) {
    var sec = document.getElementById('caseDetail');
    sec.style.display = 'block';
    sec.innerHTML = '';
    var bc = h('div', 'breadcrumb');
    var a1 = h('a', null, 'Home'); a1.href = '#home';
    var a2 = h('a', null, 'Case Laws'); a2.href = '#cases';
    a2.addEventListener('click', function () { sec.style.display = 'none'; });
    bc.appendChild(a1); bc.appendChild(document.createTextNode(' / '));
    bc.appendChild(a2); bc.appendChild(document.createTextNode(' / ' + c.title));
    sec.appendChild(bc);
    var card = h('div', 'card pad');
    if (c.demo) card.appendChild(demoBadge());
    card.appendChild(h('h2', null, c.title));
    card.appendChild(h('p', 'sec-sub', [c.citation, c.court, c.subject, c.year].filter(Boolean).join(' • ')));
    var dl = h('dl', 'case-detail');
    [['Facts', c.facts], ['Legal issues', c.issues], ['Judgment', c.judgment],
     ['Ratio decidendi', c.ratio], ['Exam relevance', c.importance]].forEach(function (pair) {
      if (!pair[1]) return;
      dl.appendChild(h('dt', null, pair[0]));
      dl.appendChild(h('dd', null, pair[1]));
    });
    card.appendChild(dl);
    var url = safeUrl(c.link);
    if (url) { var p = h('p'); p.appendChild(driveLink(url, 'Open source in Google Drive ↗', true)); card.appendChild(p); }
    var back = h('button', 'btn ghost small', '← Back to Case Laws');
    back.type = 'button';
    back.addEventListener('click', function () { sec.style.display = 'none'; location.hash = '#cases'; });
    card.appendChild(back);
    sec.appendChild(card);
    recordView({ id: c.id, title: c.title, link: null, sectionLabel: 'Case Laws' });
    sec.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  }

  function renderPapers() {
    var list = (CONTENT.previousPapers || []).filter(function (p) { return p.visible !== false; });
    var wrap = document.getElementById('papersBody');
    wrap.innerHTML = '';
    var filters = h('div', 'filters');
    var year = h('select'); year.setAttribute('aria-label', 'Filter by year');
    year.appendChild(new Option('All years', ''));
    var sem = h('select'); sem.setAttribute('aria-label', 'Filter by semester');
    sem.appendChild(new Option('All semesters', ''));
    var subj = h('input'); subj.type = 'search'; subj.placeholder = 'Filter by subject…'; subj.setAttribute('aria-label', 'Filter by subject');
    var years = [], sems = [];
    list.forEach(function (p) {
      if (p.year && years.indexOf(p.year) === -1) years.push(p.year);
      if (p.semesterId && sems.indexOf(p.semesterId) === -1) sems.push(p.semesterId);
    });
    years.forEach(function (y) { year.appendChild(new Option(y, y)); });
    sems.forEach(function (s) { sem.appendChild(new Option(s, s)); });
    filters.appendChild(year); filters.appendChild(sem); filters.appendChild(subj);
    wrap.appendChild(filters);
    var grid = h('div', 'grid');
    wrap.appendChild(grid);
    function draw() {
      grid.innerHTML = '';
      var sq = subj.value.trim().toLowerCase();
      var rows = list.filter(function (p) {
        if (year.value && String(p.year) !== year.value) return false;
        if (sem.value && p.semesterId !== sem.value) return false;
        if (sq && (p.subject || '').toLowerCase().indexOf(sq) === -1 && (p.title || '').toLowerCase().indexOf(sq) === -1) return false;
        return true;
      });
      if (!rows.length) { grid.appendChild(emptyState('No papers found', 'Try a different filter.')); return; }
      rows.forEach(function (p) {
        var card = h('div', 'card mini-card reveal');
        if (p.demo) card.appendChild(demoBadge());
        card.appendChild(h('h3', null, p.year ? String(p.year) : p.title));
        card.appendChild(h('p', null, [p.subject, p.examType].filter(Boolean).join(' • ') || p.title));
        var row = h('div', 'today-actions');
        var url = safeUrl(p.link);
        if (url) {
          row.appendChild(driveLink(url, 'Open Folder ↗', true));
          row.appendChild(bookmarkBtn(p.id));
          recordViewOnClick(row, { id: p.id, title: p.title, link: url, sectionLabel: 'Previous Papers' });
        }
        card.appendChild(row);
        grid.appendChild(card);
      });
    }
    year.addEventListener('change', draw);
    sem.addEventListener('change', draw);
    subj.addEventListener('input', draw);
    draw();
  }

  function renderExam() {
    var ex = CONTENT.examPreparation || {};
    var wrap = document.getElementById('examBody');
    wrap.innerHTML = '';
    if (ex.enabled === false) {
      wrap.appendChild(emptyState('Exam Preparation is off', 'The administrator has disabled this section.'));
      return;
    }
    if (ex.examDate) {
      var cd = h('div', 'card countdown-card');
      var cdTx = h('div');
      cdTx.appendChild(h('p', 'countdown-label', 'Exam countdown'));
      var num = h('div', 'countdown');
      cdTx.appendChild(num);
      cd.appendChild(cdTx);
      var cdNum = h('div');
      var big = h('span', 'countdown-big', '—');
      cdNum.appendChild(big);
      cdNum.appendChild(h('p', 'countdown-sub', 'days to go'));
      cd.appendChild(cdNum);
      wrap.appendChild(cd);
      (function tick() {
        var ms = Date.parse(ex.examDate) - Date.now();
        if (ms > 0) {
          var days = Math.floor(ms / 86400000);
          num.textContent = days + ' days to go';
          big.textContent = String(days);
        } else {
          num.textContent = 'Exam date has passed.';
          big.textContent = '0';
        }
      })();
    }
    var grid = h('div', 'grid');
    (ex.cards || []).forEach(function (c) {
      if (c.visible === false) return;
      var card = h('div', 'card mini-card reveal');
      card.appendChild(h('h3', null, c.title));
      card.appendChild(h('p', null, c.description || ''));
      var url = safeUrl(c.link);
      if (url) card.appendChild(driveLink(url, 'Open in Google Drive ↗', true));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    if ((ex.checklist || []).length) {
      var cl = h('div', 'card pad checklist');
      cl.appendChild(h('h3', null, 'Revision checklist'));
      cl.appendChild(h('p', 'sec-sub', ex.checklistNote || 'Stored only in this browser.'));
      var state = loadJson(CHECK_KEY, {});
      ex.checklist.forEach(function (item) {
        var lab = h('label');
        var cb = h('input'); cb.type = 'checkbox';
        cb.checked = !!state[item.id];
        cb.addEventListener('change', function () {
          state[item.id] = cb.checked; saveJson(CHECK_KEY, state);
        });
        lab.appendChild(cb);
        lab.appendChild(h('span', null, item.label));
        cl.appendChild(lab);
      });
      wrap.appendChild(cl);
    }
  }

  function renderPending() {
    var pc = CONTENT.pendingContent || {};
    var wrap = document.getElementById('pendingBody');
    wrap.innerHTML = '';
    if (pc.enabled === false) {
      wrap.appendChild(emptyState('Pending content is off', 'The administrator has disabled this section.'));
      return;
    }
    wrap.appendChild(h('p', 'pending-note', '⚠ This material has not been verified. It is raw or draft content and must not be treated as official or approved.'));
    var list = (pc.entries || []).filter(function (e) { return e.visible !== false; });
    if (!list.length) {
      wrap.appendChild(emptyState('Nothing pending', 'No unverified material is listed right now.'));
      return;
    }
    var grid = h('div', 'grid');
    list.forEach(function (e) {
      var card = h('div', 'card mini-card pending-card reveal');
      card.appendChild(h('span', 'badge warn', e.status || 'Pending'));
      if (e.demo) card.appendChild(demoBadge());
      card.appendChild(h('h3', null, e.title));
      card.appendChild(h('p', null, (e.category ? e.category + ' • ' : '') + (e.dateAdded ? 'Added ' + e.dateAdded : '') + ' ' + (e.description || '')));
      var url = safeUrl(e.link);
      if (url) card.appendChild(driveLink(url, 'Open in Google Drive ↗', true));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  function renderContacts() {
    var wrap = document.getElementById('contactBody');
    wrap.innerHTML = '';
    var list = (CONTENT.contacts || []).filter(function (c) { return c.visible !== false; });
    if (!list.length) {
      wrap.appendChild(emptyState('No contact options', 'The administrator has not configured any contact cards yet.'));
      return;
    }
    var grid = h('div', 'contact-grid');
    list.forEach(function (c) {
      var card = h('div', 'card contact-card reveal' + (c.enabled ? '' : ' disabled'));
      card.appendChild(h('h3', null, c.title));
      card.appendChild(h('p', null, c.enabled ? (c.description || '') : (c.placeholder || 'Not configured yet.')));
      var url = safeUrl(c.destination);
      if (c.enabled && url) {
        var a = h('a', 'btn small', 'Open ↗');
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        card.appendChild(a);
      }
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  function renderFooter() {
    document.getElementById('year').textContent = new Date().getFullYear();
    document.getElementById('footTag').textContent = (CFG.site || {}).footerTagline || '';
    var legal = document.getElementById('footLegal');
    if (legal) {
      legal.textContent = (CFG.site || {}).footerLegal ||
        'Notes are stored on Google Drive; this site only links to them.';
    }
  }

  /* Header and footer brand names follow the configured site title
     and tagline (Sheet settings override the config file). */
  function renderBrand() {
    var s = CFG.site || {};
    var name = s.wordmark || s.title || 'LawVault';
    var tag = s.tagline || '';
    document.querySelectorAll('.brand-name').forEach(function (e) { e.textContent = name; });
    document.querySelectorAll('.brand-sub').forEach(function (e) { e.textContent = tag; });
  }

  function renderAnnouncements() {
    var anns = (CONTENT.announcements || []).filter(function (a) { return a.visible !== false; });
    var bell = document.getElementById('bellDot');
    if (bell) bell.classList.toggle('on', anns.length > 0);
    renderNotifPopup(anns);
    var bar = document.getElementById('announceBar');
    return { anns: anns, bar: bar };
  }
  function renderNotifPopup(anns) {
    var list = document.getElementById('notifList');
    var count = document.getElementById('notifCount');
    if (!list) return;
    if (count) count.textContent = anns.length + ' active';
    list.innerHTML = '';
    if (!anns.length) {
      list.appendChild(h('div', 'notif-empty', 'No announcements right now.'));
      return;
    }
    anns.forEach(function (a) {
      var row = h('button', 'notif-row');
      row.type = 'button';
      var meta = h('div', 'notif-meta');
      if (a.publishedAt) meta.appendChild(h('span', null, fmtDT(a.publishedAt)));
      if (a.important) meta.appendChild(h('span', 'badge ok', 'Important'));
      else if (a.publishedAt && Date.now() - Date.parse(a.publishedAt) < 24 * 3600 * 1000)
        meta.appendChild(h('span', 'badge ok', 'New'));
      row.appendChild(meta);
      row.appendChild(h('h4', null, a.title));
      if (a.description) row.appendChild(h('p', null, a.description));
      row.addEventListener('click', function () {
        toggleNotifPopup(false);
        location.hash = '#updates';
      });
      list.appendChild(row);
    });
  }
  function toggleNotifPopup(force) {
    var popup = document.getElementById('notifPopup');
    var bell = document.getElementById('bellBtn');
    if (!popup) return;
    var open = force !== undefined ? force : !popup.classList.contains('open');
    popup.classList.toggle('open', open);
    if (bell) bell.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function renderSaved() {
    var panel = document.getElementById('savedPanel');
    if (!panel) return;
    panel.innerHTML = '';
    var head = h('div', 'panel-head');
    var headTx = h('div');
    headTx.appendChild(h('h3', null, 'Saved & Recent'));
    headTx.appendChild(h('p', 'panel-sub', 'Stored only in this browser'));
    head.appendChild(headTx);
    var close = h('button', 'icon-btn small', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close saved and recent');
    close.addEventListener('click', closePanels);
    head.appendChild(close);
    panel.appendChild(head);
    var bms = getBookmarks();
    var items = [];
    if (SEARCH_INDEX.length && bms.length) {
      items = SEARCH_INDEX.filter(function (i) { return bms.indexOf(i.id) !== -1; });
    }
    var bmTitle = h('h4', 'saved-sec-title', 'Bookmarks (★)');
    if (items.length) {
      var clear = h('button', 'clear-btn', 'Clear all');
      clear.type = 'button';
      clear.addEventListener('click', function () {
        saveJson(BM_KEY, []);
        updateSavedBadge();
        showToast('All bookmarks cleared.');
        renderSaved();
      });
      bmTitle.appendChild(clear);
    }
    panel.appendChild(bmTitle);
    if (items.length) {
      items.forEach(function (i) { panel.appendChild(savedRow(i)); });
    } else {
      panel.appendChild(h('p', 'search-note', 'Nothing saved yet. Tap ☆ on any card to bookmark it.'));
    }
    var rec = loadJson(RECENT_KEY, []);
    panel.appendChild(h('h4', 'saved-sec-title muted', 'Recently viewed'));
    if (rec.length) {
      rec.slice(0, 6).forEach(function (i) { panel.appendChild(savedRow(i)); });
    } else {
      panel.appendChild(h('p', 'search-note', 'Items you open will appear here.'));
    }
    updateSavedBadge();
  }
  function savedRow(i) {
    var d = h('div', 'saved-row');
    if (i.link && safeUrl(i.link)) {
      var a = h('a', null, i.title);
      a.href = i.link; a.target = '_blank'; a.rel = 'noopener';
      d.appendChild(a);
    } else {
      d.appendChild(h('span', null, i.title));
    }
    return d;
  }

  /* ---------- search UI ---------- */
  function wireSearch() {
    var bar = document.getElementById('searchBar');
    var input = document.getElementById('searchInput');
    var sugg = document.getElementById('suggest');
    var activeIdx = -1, current = [];
    function closeSugg() { sugg.classList.remove('open'); sugg.innerHTML = ''; activeIdx = -1; }
    function openSugg(list) {
      sugg.innerHTML = ''; activeIdx = -1;
      if (!list.length) { closeSugg(); return; }
      current = list;
      list.forEach(function (it, i) {
        var b = h('button');
        b.type = 'button';
        b.appendChild(document.createTextNode(it.title));
        b.appendChild(h('span', 'kind', it.sectionLabel));
        b.addEventListener('click', function () { goToResult(it); closeSugg(); });
        sugg.appendChild(b);
      });
      sugg.classList.add('open');
    }
    function goToResult(it) {
      if (it.section === 'cases') {
        var c = (CONTENT.caseLaws || []).find(function (x) { return x.id === it.id; });
        if (c) { location.hash = '#cases'; openCaseDetail(c); return; }
      }
      if (it.link && safeUrl(it.link)) { window.open(it.link, '_blank', 'noopener'); }
      else { location.hash = '#' + it.section; }
      recordView(it);
    }
    input.addEventListener('input', function () {
      var q = input.value;
      if (q.trim().length < 2) { closeSugg(); return; }
      openSugg(window.LVSearch.suggest(SEARCH_INDEX, q));
    });
    input.addEventListener('keydown', function (e) {
      var btns = sugg.querySelectorAll('button');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!btns.length) return;
        activeIdx = e.key === 'ArrowDown'
          ? (activeIdx + 1) % btns.length
          : (activeIdx - 1 + btns.length) % btns.length;
        btns.forEach(function (b, i) { b.classList.toggle('active', i === activeIdx); });
        btns[activeIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0 && current[activeIdx]) { goToResult(current[activeIdx]); closeSugg(); }
        else { showSearchResults(input.value); closeSugg(); }
      } else if (e.key === 'Escape') { closeSugg(); }
    });
    document.addEventListener('click', function (e) {
      if (!sugg.contains(e.target) && e.target !== input) closeSugg();
    });
    var closeBtn = document.getElementById('searchCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        bar.classList.remove('open');
        closeSugg();
      });
    }
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        bar.classList.add('open');
        input.focus();
      } else if (e.key === 'Escape' && bar.classList.contains('open') && document.activeElement !== input) {
        bar.classList.remove('open');
        closeSugg();
      }
    });
  }
  function showSearchResults(q) {
    withCurtain('Search: ' + q, function () { showSearchResultsNow(q); });
  }
  function showSearchResultsNow(q) {
    var sec = document.getElementById('searchResults');
    sec.style.display = 'block';
    sec.innerHTML = '';
    var bc = h('div', 'breadcrumb');
    var a1 = h('a', null, 'Home'); a1.href = '#home';
    a1.addEventListener('click', function () { sec.style.display = 'none'; });
    bc.appendChild(a1);
    bc.appendChild(document.createTextNode(' / Search: ' + q));
    sec.appendChild(bc);
    var card = h('div', 'card pad');
    card.appendChild(h('h2', null, 'Search results'));
    card.appendChild(h('p', 'sec-sub', (CFG.site || {}).searchNote || ''));
    var rows = window.LVSearch.search(SEARCH_INDEX, q);
    if (!rows.length) {
      card.appendChild(h('p', null, 'No matches. Try a subject, case name, or year.'));
    } else {
      var ul = h('ul');
      ul.style.listStyle = 'none'; ul.style.padding = '0'; ul.style.margin = '0';
      rows.forEach(function (it) {
        var li = h('li'); li.style.padding = '8px 0'; li.style.borderBottom = '1px solid var(--border)';
        var b = h('button');
        b.type = 'button';
        b.style.cssText = 'background:none;border:0;color:var(--text);font-size:15px;cursor:pointer;text-align:left;padding:0;';
        b.appendChild(document.createTextNode(it.title + '  '));
        b.appendChild(h('span', 'badge', it.sectionLabel));
        b.addEventListener('click', function () {
          sec.style.display = 'none';
          var c = (CONTENT.caseLaws || []).find(function (x) { return x.id === it.id; });
          if (it.section === 'cases' && c) { location.hash = '#cases'; openCaseDetail(c); }
          else if (it.link && safeUrl(it.link)) window.open(it.link, '_blank', 'noopener');
          else location.hash = '#' + it.section;
          recordView(it);
        });
        li.appendChild(b);
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    sec.appendChild(card);
    sec.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---------- header wiring ---------- */
  function wireHeader() {
    var menuBtn = document.getElementById('menuBtn');
    var nav = document.getElementById('mainNav');
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('mobile-open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    var searchBtn = document.getElementById('searchBtn');
    var searchBar = document.getElementById('searchBar');
    searchBtn.addEventListener('click', function () {
      var open = searchBar.classList.toggle('open');
      if (open) document.getElementById('searchInput').focus();
    });
    var themeBtn = document.getElementById('themeBtn');
    themeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleNotifPopup(false);
      openPanel('theme');
    });
    var bell = document.getElementById('bellBtn');
    bell.addEventListener('click', function (e) {
      e.stopPropagation();
      closePanels();
      toggleNotifPopup();
    });
    document.addEventListener('click', function (e) {
      var popup = document.getElementById('notifPopup');
      if (popup && popup.classList.contains('open') &&
          !popup.contains(e.target) && e.target !== bell && !bell.contains(e.target)) {
        toggleNotifPopup(false);
      }
    });
    var bmBtn = document.getElementById('savedBtn');
    bmBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleNotifPopup(false);
      renderSaved();
      openPanel('saved');
    });
    ['themeBackdrop', 'savedBackdrop'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', closePanels);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePanels(); toggleNotifPopup(false); closeInfoModal(); }
    });
    var backTop = document.getElementById('backTop');
    backTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
    });
    var pwaHero = document.getElementById('pwaHeroBtn');
    if (pwaHero) pwaHero.addEventListener('click', showPwaModal);
    var pwaFooter = document.getElementById('pwaFooterBtn');
    if (pwaFooter) pwaFooter.addEventListener('click', showPwaModal);
    document.querySelectorAll('[data-footer-modal]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openFooterModal(btn.getAttribute('data-footer-modal'));
      });
    });
  }

  /* ---------- preloader ---------- */
  /* Stage-based progress tied to the real boot steps (config fetch,
     Sheet read, render). The inline timer in index.html is the safety
     net if this script never runs; the skip button always works. */
  var preloaderDone = false;
  function setPreloader(pct, msg) {
    var bar = document.getElementById('preloaderFill');
    var pctEl = document.getElementById('preloaderPct');
    var step = document.getElementById('preloaderStep');
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (step && msg) step.textContent = msg;
  }
  function hidePreloader() {
    if (preloaderDone) return;
    preloaderDone = true;
    var p = document.getElementById('lvPreloader');
    if (!p) return;
    setPreloader(100, 'Welcome to LawVault — Your LLB Study Space');
    setTimeout(function () {
      p.classList.add('preloader-hidden');
      setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 900);
    }, REDUCED ? 0 : 200);
  }
  function initPreloader() {
    var skip = document.getElementById('preloaderSkip');
    if (skip) skip.addEventListener('click', hidePreloader);
    setPreloader(20, 'Loading site configuration…');
  }

  /* ---------- Delta particles canvas ---------- */
  /* 16 slow-rising dots/rings in the current accent colour. Skips
     drawing entirely under reduced motion, when motion is paused, or
     when the tab is hidden. */
  var particleAnimId = null;
  function initParticles() {
    var canvas = document.getElementById('deltaParticles');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var width = window.innerWidth, height = window.innerHeight;
    canvas.width = width; canvas.height = height;
    window.addEventListener('resize', function () {
      width = window.innerWidth; height = window.innerHeight;
      canvas.width = width; canvas.height = height;
    }, { passive: true });
    var particles = [];
    for (var i = 0; i < 16; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 2.0 + 0.9,
        vx: (Math.random() - 0.5) * 0.28,
        vy: -Math.random() * 0.35 - 0.1,
        alpha: Math.random() * 0.35 + 0.1,
        isRing: i % 5 === 0
      });
    }
    var cleared = false;
    function drawFrame() {
      if (motionAllowed() && !document.hidden) {
        cleared = false;
        ctx.clearRect(0, 0, width, height);
        for (var j = 0; j < particles.length; j++) {
          var p = particles[j];
          p.x += p.vx; p.y += p.vy;
          if (p.y < -20) p.y = height + 20;
          if (p.x < -20) p.x = width + 20;
          if (p.x > width + 20) p.x = -20;
          ctx.beginPath();
          if (p.isRing) {
            ctx.arc(p.x, p.y, p.r * 3.8, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(' + PARTICLE_RGB + ', ' + (p.alpha * 0.55) + ')';
            ctx.lineWidth = 0.8;
            ctx.stroke();
          } else {
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + PARTICLE_RGB + ', ' + p.alpha + ')';
            ctx.fill();
          }
        }
      } else if (!cleared) {
        ctx.clearRect(0, 0, width, height);
        cleared = true;
      }
      particleAnimId = requestAnimationFrame(drawFrame);
    }
    if (particleAnimId) cancelAnimationFrame(particleAnimId);
    drawFrame();
  }

  /* ---------- spotlight follower + card tilt ---------- */
  /* GPU-only: a single transform on a fixed layer, rAF-throttled, and
     no DOM queries inside the mousemove handler. Fine pointers only;
     disabled under reduced motion or when motion is paused. */
  function initSpotlight() {
    var spotlight = document.getElementById('spotlightLayer');
    if (!spotlight) return;
    if (window.matchMedia && !window.matchMedia('(pointer: fine)').matches) return;
    var mouseX = window.innerWidth * 0.5, mouseY = window.innerHeight * 0.3;
    var rafPending = false;
    window.addEventListener('mousemove', function (e) {
      mouseX = e.clientX; mouseY = e.clientY;
      if (!rafPending && motionAllowed()) {
        rafPending = true;
        requestAnimationFrame(function () {
          spotlight.style.transform = 'translate3d(' + mouseX + 'px, ' + mouseY + 'px, 0)';
          rafPending = false;
        });
      }
    }, { passive: true });
  }
  function initTilt() {
    if (window.matchMedia && !window.matchMedia('(pointer: fine)').matches) return;
    var current = null, rafPending = false, mx = 0, my = 0;
    document.addEventListener('pointermove', function (e) {
      var card = e.target && e.target.closest
        ? e.target.closest('.today-card, .subj-card, .mini-card, .contact-card')
        : null;
      if (!card || !card.classList.contains('in') || !motionAllowed()) {
        if (current) { current.style.transform = ''; current = null; }
        return;
      }
      if (current && current !== card) current.style.transform = '';
      current = card; mx = e.clientX; my = e.clientY;
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(function () {
          rafPending = false;
          if (!current) return;
          var r = current.getBoundingClientRect();
          var rx = ((my - r.top) / r.height - 0.5) * -4;
          var ry = ((mx - r.left) / r.width - 0.5) * 4;
          current.style.transform = 'perspective(700px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-3px)';
        });
      }
    }, { passive: true });
    document.addEventListener('pointerout', function (e) {
      if (current && !current.contains(e.relatedTarget)) {
        current.style.transform = '';
        current = null;
      }
    }, { passive: true });
  }
  function initAmbient() {
    refreshParticleRgb();
    initParticles();
    initSpotlight();
    initTilt();
  }

  /* ---------- info modal + PWA install ---------- */
  var infoModalAction = null;
  function openInfoModal(title, buildBody, action) {
    var modal = document.getElementById('infoModal');
    var titleEl = document.getElementById('infoModalTitle');
    var body = document.getElementById('infoModalBody');
    var installBtn = document.getElementById('infoModalInstall');
    if (!modal || !titleEl || !body) return;
    titleEl.textContent = title;
    body.innerHTML = '';
    buildBody(body);
    infoModalAction = action || null;
    if (installBtn) {
      installBtn.hidden = !action;
      if (action) installBtn.textContent = action.label;
    }
    modal.hidden = false;
  }
  function closeInfoModal() {
    var modal = document.getElementById('infoModal');
    if (modal) modal.hidden = true;
    infoModalAction = null;
  }
  function initInfoModal() {
    var close = document.getElementById('infoModalClose');
    var ok = document.getElementById('infoModalOk');
    var install = document.getElementById('infoModalInstall');
    var modal = document.getElementById('infoModal');
    if (close) close.addEventListener('click', closeInfoModal);
    if (ok) ok.addEventListener('click', closeInfoModal);
    if (install) install.addEventListener('click', function () {
      var action = infoModalAction;
      closeInfoModal();
      if (action && action.fn) action.fn();
    });
    if (modal) modal.addEventListener('click', function (e) {
      if (e.target === modal) closeInfoModal();
    });
  }
  function openFooterModal(key) {
    var copy = {
      About: [
        'LawVault is your class knowledge library — LLB notes, case laws, previous papers and exam resources, organised in one place.',
        'Notes themselves stay on Google Drive; this site is the index and navigation layer. Content is managed by the administrator through a Google Sheet, so updates appear here without any code change.'
      ],
      Privacy: [
        'LawVault stores your theme preferences, bookmarks, recently viewed items, and revision checklist strictly in your local browser (localStorage keys lv-theme-v3, lv-bookmarks-v3, lv-recent-v3, lv-checklist-v3, lv-motion-v3).',
        'There are no accounts, no tracking, and nothing you do here is sent anywhere except the read-only requests that load the site content.'
      ],
      Disclaimer: [
        'All study digests, case summaries, and unverified community notes on LawVault are meant for academic reference only and must be verified against official university syllabi and statutory bare acts.',
        'Material in Pending & Unverified has not been checked and must not be treated as official or approved.'
      ]
    };
    openInfoModal(key + ' — LawVault', function (body) {
      (copy[key] || []).forEach(function (para) {
        body.appendChild(h('p', null, para));
      });
    }, null);
  }
  var deferredPrompt = null;
  function initPwa() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
    });
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      showToast('LawVault installed — find it on your home screen.');
    });
  }
  function isInstalled() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }
  function showPwaModal() {
    if (isInstalled()) {
      openInfoModal('LawVault is installed', function (body) {
        body.appendChild(h('p', null, 'LawVault is already running as an installed app on this device. You can open it from your home screen or app list, and it works offline.'));
      }, null);
      return;
    }
    if (deferredPrompt) {
      openInfoModal('Install LawVault', function (body) {
        body.appendChild(h('p', null, 'Add LawVault to your home screen for a full-screen, offline-capable app experience — same notes, same Drive links, no browser chrome.'));
      }, {
        label: 'Install app',
        fn: function () {
          var p = deferredPrompt;
          deferredPrompt = null;
          if (p) p.prompt();
        }
      });
      return;
    }
    openInfoModal('Add LawVault to your home screen', function (body) {
      body.appendChild(h('p', null, 'LawVault works as an installable app (manifest + service worker):'));
      var ul = h('ul');
      ul.appendChild(h('li', null, 'Android (Chrome): tap the browser menu (⋮) and select “Add to Home screen” or “Install app”.'));
      ul.appendChild(h('li', null, 'iOS (Safari): tap the Share button and select “Add to Home Screen”.'));
      body.appendChild(ul);
    }, null);
  }

  /* ---------- motion layer (v4) ---------- */
  /* Masked headline reveals: split [data-mask] headings into word masks.
     Only runs when JS works, and the hiding CSS is gated behind the `js`
     class, so headings stay readable if anything here fails. */
  function splitMasked(el) {
    if (!el || el.getAttribute('data-mask-done')) return;
    el.setAttribute('data-mask-done', '1');
    var nodes = Array.prototype.slice.call(el.childNodes);
    el.innerHTML = '';
    nodes.forEach(function (node) {
      var text = node.textContent || '';
      var cls = node.nodeType === 1 ? (node.className || '') : '';
      text.split(/(\s+)/).forEach(function (w) {
        if (!w) return;
        if (/^\s+$/.test(w)) { el.appendChild(document.createTextNode(' ')); return; }
        var mask = document.createElement('span');
        mask.className = 'mask';
        var inner = document.createElement('span');
        inner.className = 'mask-word' + (cls ? ' ' + cls : '');
        inner.textContent = w;
        mask.appendChild(inner);
        el.appendChild(mask);
      });
    });
  }
  function splitAllMasks(root) {
    var list = (root || document).querySelectorAll('[data-mask]');
    for (var i = 0; i < list.length; i++) splitMasked(list[i]);
  }

  /* Stagger delay: index of the element among same-type siblings, capped. */
  function staggerDelay(el, cls, step, cap) {
    var parent = el.parentNode;
    if (!parent) return 0;
    var sibs = parent.querySelectorAll(':scope > .' + cls);
    var idx = 0;
    for (var i = 0; i < sibs.length; i++) { if (sibs[i] === el) { idx = i; break; } }
    return Math.min(idx, cap) * step;
  }

  var revealIO = null;
  function observeMotion(root) {
    if (!root || !root.querySelectorAll) return;
    var targets = root.querySelectorAll('.reveal:not(.in), .mask-word:not(.in)');
    targets.forEach(function (e) {
      if (e.classList.contains('mask-word')) {
        e.style.transitionDelay = staggerDelay(e.parentNode, 'mask', 55, 8) + 'ms';
      } else {
        e.style.transitionDelay = staggerDelay(e, 'reveal', 45, 5) + 'ms';
      }
      if (revealIO) revealIO.observe(e); else e.classList.add('in');
    });
  }
  function initMotion() {
    if ('IntersectionObserver' in window && !REDUCED) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); revealIO.unobserve(en.target); }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -4% 0px' });
    } else {
      revealIO = null; // reduced motion or no IO: observeMotion reveals immediately
    }
    splitAllMasks(document);
    observeMotion(document);
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n && n.nodeType === 1) {
              if (n.classList && (n.classList.contains('reveal') || n.classList.contains('mask-word'))) {
                observeMotion(n.parentNode || document);
              }
              observeMotion(n);
            }
          });
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
    /* Safety net: nothing may stay hidden if an observer never fires. */
    setTimeout(function () {
      document.querySelectorAll('.reveal:not(.in), .mask-word:not(.in)').forEach(function (e) {
        e.classList.add('in');
      });
    }, 2500);
    /* Scales illustration draws itself once the page is up. */
    var scales = document.getElementById('scalesSvg');
    if (scales) {
      setTimeout(function () { scales.classList.add('drawn'); }, 200);
    }
  }

  /* Scroll progress + header parallax, one rAF-throttled handler. */
  function initScrollMotion() {
    var progress = document.getElementById('scrollProgress');
    var backTop = document.getElementById('backTop');
    var art = document.getElementById('welcomeArt');
    var welcome = document.getElementById('home');
    var ticking = false;
    function update() {
      ticking = false;
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (progress) progress.style.transform = 'scaleX(' + p + ')';
      if (backTop) backTop.classList.toggle('show', window.scrollY > 600);
      if (!REDUCED && art && welcome && window.innerWidth > 700) {
        var r = welcome.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) {
          var prog = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
          art.style.transform = 'scale(' + (1 + prog * 0.08).toFixed(4) + ') translateY(' + (prog * 18).toFixed(1) + 'px)';
        }
      } else if (art) {
        art.style.transform = '';
      }
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* Chapter numbers follow the applied section order, skipping hidden sections. */
  function renumberChapters() {
    var n = 0;
    document.querySelectorAll('.chapter-tag').forEach(function (tag) {
      var sec = tag.closest('[data-section]');
      if (sec && sec.style.display === 'none') return;
      /* The Today chapter tag sits outside #sections; skip it when
         the Today priority area is hidden. */
      if (tag.getAttribute('data-chapter') === 'today') {
        var grid = document.getElementById('todayGrid');
        if (grid && grid.style.display === 'none') return;
      }
      n++;
      var num = tag.querySelector('.chapter-num');
      if (num) num.textContent = String(n).padStart(2, '0');
    });
  }

  function applySectionOrder() {
    var main = document.getElementById('sections');
    if (!main) return;
    (CFG.sectionOrder || []).forEach(function (key) {
      var el = main.querySelector('[data-section="' + key + '"]');
      if (el) main.appendChild(el);
    });
    var vis = CFG.sectionVisibility || {};
    Object.keys(vis).forEach(function (key) {
      if (vis[key] === false) {
        var el = main.querySelector('[data-section="' + key + '"]');
        if (el) el.style.display = 'none';
      }
    });
    /* The Today priority area lives outside #sections, so its
       visibility is applied separately, tag and grid together. */
    if (vis.today === false) {
      var tag = document.querySelector('.chapter-tag[data-chapter="today"]');
      if (tag) tag.style.display = 'none';
      var grid = document.getElementById('todayGrid');
      if (grid) grid.style.display = 'none';
    }
    renumberChapters();
  }

  /* ---------- Google Sheets data layer (v5) ---------- */
  /* When data/sheets-config.json has enabled=true and a sheetId, the
     public site reads its content from that Google Sheet (shared
     "Anyone with the link can view") instead of the local JSON files.
     Every tab is fetched independently: a tab that fails to load keeps
     its local fallback, so the site always renders. All sheet values
     are treated as untrusted text and mapped onto the same shapes the
     renderers already use; links are still filtered by safeUrl().
     The SHEETS-START / SHEETS-END markers delimit pure functions with
     no DOM or network access, so they can be extracted and tested. */
  /* SHEETS-START */
  function parseGvizText(text) {
    if (typeof text !== 'string') return null;
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      var res = JSON.parse(text.slice(start, end + 1));
      if (!res || res.status !== 'ok' || !res.table) return null;
      return res.table;
    } catch (e) { return null; }
  }
  function sheetCellValue(cell) {
    if (!cell) return '';
    var v = cell.v;
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') {
      var m = /^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/.exec(v.trim());
      if (m) {
        var d = new Date(Number(m[1]), Number(m[2]), Number(m[3]),
          Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
        return isNaN(d.getTime()) ? '' : d.toISOString();
      }
      return v;
    }
    return v;
  }
  function gvizRowsToObjects(table) {
    var cols = (table.cols || []).map(function (c, i) {
      return (c && c.label ? String(c.label) : 'col' + i).trim();
    });
    var out = [];
    (table.rows || []).forEach(function (row) {
      if (!row || !row.c) return;
      var obj = {};
      var any = false;
      var isHeaderEcho = true;
      row.c.forEach(function (cell, i) {
        var val = sheetCellValue(cell);
        if (val !== '' && val !== null && val !== undefined) any = true;
        if (String(val) !== String(cols[i])) isHeaderEcho = false;
        obj[cols[i]] = (val === null || val === undefined) ? '' : val;
      });
      /* Guard: if the header row ever leaks through as data (gviz
         header detection), drop it instead of counting it as an entry. */
      if (any && !isHeaderEcho) out.push(obj);
    });
    return out;
  }
  function sText(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
  function sBool(v) {
    if (v === true || v === 1) return true;
    if (typeof v === 'string') {
      var t = v.trim().toLowerCase();
      return t === 'true' || t === 'yes' || t === '1';
    }
    return false;
  }
  function sNum(v, fallback) {
    var n = Number(v);
    return isNaN(n) ? fallback : n;
  }
  function sTime(v) {
    var t = sText(v);
    if (!t) return NaN;
    var ms = Date.parse(t);
    return isNaN(ms) ? NaN : ms;
  }
  function sDatePart(v) {
    var ms = sTime(v);
    if (isNaN(ms)) return sText(v).slice(0, 10);
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /* A sheet row is publicly visible when it is enabled, its status is
     Published (or Demo), its publish time has passed, and its expiry
     time (if any) has not. Scheduled items stay hidden until their
     publish time; expired items disappear without being deleted. */
  function sPublished(row, now) {
    if (!sBool(row.enabled)) return false;
    var st = sText(row.status).toLowerCase();
    if (st && st !== 'published' && st !== 'demo') return false;
    var pub = sTime(row.publish_at);
    if (!isNaN(pub) && pub > now) return false;
    var exp = sTime(row.expires_at);
    if (!isNaN(exp) && exp <= now) return false;
    return true;
  }
  function sortByOrder(a, b) {
    var ao = sNum(a.order, 0), bo = sNum(b.order, 0);
    if (ao !== bo) return ao - bo;
    return sText(a.id).localeCompare(sText(b.id));
  }
  function mapSheetsToContent(tabs, fallback) {
    var content = JSON.parse(JSON.stringify(fallback));
    var now = Date.now();
    var settingsMap = {};
    if (tabs.settings) {
      tabs.settings.forEach(function (r) {
        var k = sText(r.key);
        if (k) settingsMap[k] = sText(r.value);
      });
    }
    if (tabs.daily_notes) {
      content.todayNotes = content.todayNotes || {};
      content.todayNotes.items = tabs.daily_notes.map(function (r, i) {
        var pub = sText(r.publish_at) || sText(r.created_at);
        return {
          id: sText(r.id) || ('note-' + i),
          title: sText(r.title),
          description: sText(r.description),
          link: sText(r.drive_link),
          publishedAt: pub,
          visible: sPublished(r, now)
        };
      });
    }
    if (tabs.announcements) {
      var anns = tabs.announcements.map(function (r, i) {
        return {
          id: sText(r.id) || ('ann-' + i),
          title: sText(r.title),
          description: sText(r.description),
          publishedAt: sText(r.publish_at) || sText(r.created_at),
          important: sText(r.badge).toLowerCase() === 'important',
          pinned: sBool(r.pinned),
          visible: sPublished(r, now)
        };
      });
      anns.sort(function (a, b) {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        var ta = sTime(a.publishedAt), tb = sTime(b.publishedAt);
        if (isNaN(ta) && isNaN(tb)) return 0;
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return tb - ta;
      });
      content.latestUpdates = anns;
      content.announcements = anns;
    }
    var configuredSemesters = null;
    if (tabs.semesters) {
      var semRows = tabs.semesters.slice().sort(sortByOrder);
      configuredSemesters = {};
      content.semesters = semRows.map(function (r, i) {
        var num = sNum(r.number, i + 1);
        configuredSemesters[sText(r.id)] = sBool(r.configured);
        return {
          id: sText(r.id) || ('sem-' + num),
          number: num,
          label: sText(r.label) || ('Semester ' + num),
          visible: sBool(r.enabled),
          default: num === 1,
          featured: num === 1
        };
      });
    }
    if (tabs.subjects) {
      var subjRows = tabs.subjects.slice().sort(sortByOrder);
      content.subjects = subjRows.map(function (r, i) {
        var name = sText(r.name);
        var unit = sText(r.unit);
        var desc = sText(r.description);
        var semOk = configuredSemesters ? configuredSemesters[sText(r.semester_id)] !== false : true;
        return {
          id: sText(r.id) || ('subj-' + i),
          semesterId: sText(r.semester_id),
          paper: name,
          title: [name, unit, desc].filter(Boolean).join(' — '),
          unit: unit,
          description: desc,
          link: sText(r.drive_link),
          icon: sText(r.icon),
          date: sDatePart(r.created_at),
          visible: sBool(r.enabled) && semOk,
          category: 'Semester Notes'
        };
      });
    }
    if (tabs.case_laws) {
      content.caseLaws = tabs.case_laws.map(function (r, i) {
        var st = sText(r.status).toLowerCase();
        return {
          id: sText(r.id) || ('case-' + i),
          title: sText(r.title),
          citation: sText(r.citation),
          court: sText(r.court),
          year: sText(r.year),
          subject: sText(r.subject),
          facts: sText(r.facts),
          issues: sText(r.issues),
          judgment: sText(r.judgment),
          ratio: sText(r.ratio),
          importance: sText(r.exam_relevance),
          link: sText(r.drive_link),
          demo: st === 'demo',
          visible: st === 'published' || st === 'demo',
          category: 'Case Laws'
        };
      });
    }
    if (tabs.papers) {
      var papers = tabs.papers.map(function (r, i) {
        var st = sText(r.status).toLowerCase();
        return {
          id: sText(r.id) || ('paper-' + i),
          title: sText(r.title),
          year: sText(r.year),
          semesterId: sText(r.semester_id),
          subject: sText(r.subject),
          examType: sText(r.exam_type),
          link: sText(r.drive_link),
          demo: st === 'demo',
          visible: st === 'published' || st === 'demo',
          category: 'Previous Papers'
        };
      });
      papers.sort(function (a, b) { return sText(b.year).localeCompare(sText(a.year)); });
      content.previousPapers = papers;
    }
    if (tabs.exam_prep) {
      content.examPreparation = content.examPreparation || {};
      content.examPreparation.cards = tabs.exam_prep.slice().sort(sortByOrder).map(function (r, i) {
        return {
          id: sText(r.id) || ('exam-' + i),
          title: sText(r.title),
          description: sText(r.description),
          link: sText(r.drive_link),
          visible: sBool(r.enabled),
          category: sText(r.category) || 'Exam Prep'
        };
      });
    }
    if (Object.prototype.hasOwnProperty.call(settingsMap, 'exam_date')) {
      content.examPreparation = content.examPreparation || {};
      var ems = sTime(settingsMap.exam_date);
      content.examPreparation.examDate = isNaN(ems) ? null : settingsMap.exam_date;
    }
    if (tabs.pending) {
      content.pendingContent = content.pendingContent || {};
      content.pendingContent.entries = tabs.pending.map(function (r, i) {
        var st = sText(r.status);
        var low = st.toLowerCase();
        var reason = sText(r.reason);
        return {
          id: sText(r.id) || ('pending-' + i),
          title: sText(r.title),
          description: sText(r.description) + (reason ? ' Reason: ' + reason : ''),
          link: sText(r.drive_link),
          status: st || 'Pending',
          demo: low === 'demo',
          visible: low === 'pending' || low === 'demo',
          category: 'Pending',
          dateAdded: sDatePart(r.created_at)
        };
      });
    }
    if (tabs.contacts) {
      content.contacts = tabs.contacts.slice().sort(sortByOrder).map(function (r, i) {
        return {
          id: sText(r.id) || ('contact-' + i),
          title: sText(r.label),
          description: '',
          destination: sText(r.destination),
          enabled: sBool(r.enabled),
          visible: true,
          placeholder: 'Not configured yet.'
        };
      });
    }
    return content;
  }
  function mapSheetsSettings(rows, fallbackCfg) {
    var cfg = JSON.parse(JSON.stringify(fallbackCfg));
    var map = {};
    rows.forEach(function (r) {
      var k = sText(r.key);
      if (k) map[k] = sText(r.value);
    });
    cfg.site = cfg.site || {};
    if (map.site_title) { cfg.site.title = map.site_title; cfg.site.wordmark = map.site_title; }
    if (map.site_tagline) cfg.site.tagline = map.site_tagline;
    if (map.welcome_title) cfg.site.welcomeTitle = map.welcome_title;
    if (map.welcome_subtitle) cfg.site.welcomeSubtitle = map.welcome_subtitle;
    if (map.footer_tagline) cfg.site.footerTagline = map.footer_tagline;
    if (map.footer_legal) cfg.site.footerLegal = map.footer_legal;
    if (map.main_drive_folder && /^https:\/\//i.test(map.main_drive_folder)) cfg.site.mainDriveFolder = map.main_drive_folder;
    /* Section visibility: a Sheet key overrides the config value for
       that section; an absent key keeps the config fallback. */
    var sectionIds = ['today', 'semesters', 'cases', 'papers', 'exam', 'pending', 'contact'];
    cfg.sectionVisibility = cfg.sectionVisibility || {};
    sectionIds.forEach(function (id) {
      var key = 'section_' + id + '_enabled';
      if (map[key] !== undefined && map[key] !== '') cfg.sectionVisibility[id] = sBool(map[key]);
    });
    cfg.theme = cfg.theme || {};
    if (map.default_mode === 'light' || map.default_mode === 'dark') cfg.theme.defaultMode = map.default_mode;
    var colors = (cfg.theme.colors || []).map(function (c) { return c.id; });
    if (map.default_color && colors.indexOf(map.default_color) !== -1) cfg.theme.defaultColor = map.default_color;
    if (map.festival_auto !== undefined && map.festival_auto !== '') cfg.theme.autoFestival = sBool(map.festival_auto);
    /* Festival overrides: date ranges and palette colours from the
       Sheet win over the config values, but only when they are valid
       (MM-DD dates, #rrggbb colours). Invalid values keep the config
       fallback, so a typo can never break the theme. */
    (cfg.theme.festivals || []).forEach(function (f) {
      var pre = 'festival_' + f.id + '_';
      if (/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(map[pre + 'start'] || '')) f.start = map[pre + 'start'];
      if (/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(map[pre + 'end'] || '')) f.end = map[pre + 'end'];
      if (/^#[0-9a-fA-F]{6}$/.test(map[pre + 'accent'] || '')) f.accent = map[pre + 'accent'];
      if (/^#[0-9a-fA-F]{6}$/.test(map[pre + 'accent2'] || '')) f.accent2 = map[pre + 'accent2'];
    });
    return cfg;
  }
  /* SHEETS-END */

  function fetchSheetTab(sheetId, tab) {
    var url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) +
      '/gviz/tq?tqx=out:json&headers=1&sheet=' + encodeURIComponent(tab);
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('sheet fetch failed');
      return r.text();
    }).then(function (text) {
      var table = parseGvizText(text);
      if (!table) throw new Error('sheet parse failed');
      return gvizRowsToObjects(table);
    });
  }
  function loadSheets(sheetCfg) {
    var tabs = ['settings', 'daily_notes', 'announcements', 'semesters',
      'subjects', 'case_laws', 'papers', 'exam_prep', 'pending', 'contacts'];
    return Promise.all(tabs.map(function (tab) {
      return fetchSheetTab(sheetCfg.sheetId, tab).then(function (rows) {
        return { tab: tab, rows: rows };
      }).catch(function () {
        return { tab: tab, rows: null };
      });
    })).then(function (results) {
      var out = {};
      var any = false;
      results.forEach(function (r) {
        if (r.rows !== null) { out[r.tab] = r.rows; any = true; }
      });
      return any ? out : null;
    });
  }

  /* ---------- boot ---------- */
  function renderAll() {
    document.title = (CFG.site && CFG.site.title ? CFG.site.title + ' — ' : '') + 'Your LLB Class Knowledge Library';
    renderBrand();
    renderNav();
    renderWelcome();
    var sn = document.getElementById('searchNote');
    if (sn) sn.textContent = (CFG.site && CFG.site.searchNote) || '';
    buildThemePanel(CFG);
    applyTheme(CFG);
    renderAnnouncements();
    renderToday();
    renderUpdates();
    renderSemesters();
    renderCases();
    renderPapers();
    renderExam();
    renderPending();
    renderContacts();
    renderFooter();
    wireHeader();
    wireSearch();
    SEARCH_INDEX = window.LVSearch.buildIndex(CONTENT);
    updateSavedBadge();
    applySectionOrder();
    initMotion();
    initScrollMotion();
    initAmbient();
    setPreloader(90, 'Building your study space…');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
    hidePreloader();
  }

  function boot() {
    initPreloader();
    initPwa();
    initInfoModal();
    Promise.all([
      fetch('./data/site-config.json').then(function (r) { return r.json(); }),
      fetch('./data/content.json').then(function (r) { return r.json(); }),
      fetch('./data/sheets-config.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (arr) {
      CFG = arr[0]; CONTENT = arr[1];
      setPreloader(45, 'Configuration loaded. Reading the Google Sheet…');
      var sheetsCfg = arr[2];
      var overlay = null;
      if (sheetsCfg && sheetsCfg.enabled === true && typeof sheetsCfg.sheetId === 'string' && sheetsCfg.sheetId.trim()) {
        overlay = Promise.race([
          loadSheets(sheetsCfg),
          new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 8000); })
        ]);
      }
      return (overlay || Promise.resolve(null)).then(function (tabs) {
        if (tabs) {
          try {
            if (tabs.settings) CFG = mapSheetsSettings(tabs.settings, CFG);
            CONTENT = mapSheetsToContent(tabs, CONTENT);
          } catch (e) { /* keep the local fallback content */ }
        }
        setPreloader(70, 'Content ready. Rendering…');
        renderAll();
      });
    }).catch(function () {
      hidePreloader();
      document.getElementById('todayBody').innerHTML =
        '<div class="card empty"><strong>Could not load content</strong>The configuration files could not be fetched. Check your connection and reload.</div>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
