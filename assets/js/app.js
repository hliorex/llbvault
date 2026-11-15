/* LawVault v5 — app.js
   Renders the site from data/site-config.json + data/content.json, and
   runs the editorial motion layer (masked headline reveals, scroll
   reveals, header parallax, scroll progress, scales illustration draw,
   chapter numbering).
   v5 adds a Google Sheets data layer: when data/sheets-config.json has
   enabled=true and a sheetId, content is read from that Sheet instead
   of the local JSON files, tab by tab, with the local files kept as a
   silent fallback for any tab that fails to load. See the "Google
   Sheets data layer" section below and SHEET_MODEL.md.
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
  var TZ = 'Asia/Kolkata';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  function applyTheme(cfg) {
    var prefs = loadThemePrefs(cfg);
    var fest = prefs.auto ? festivalForToday(cfg, new Date()) : null;
    var root = document.documentElement;
    root.setAttribute('data-mode', prefs.mode);
    root.setAttribute('data-color', prefs.color);
    root.setAttribute('data-festival', fest ? fest.id : 'none');
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
    var modeT = panel.querySelector('[data-tmode]');
    if (modeT) {
      modeT.textContent = prefs.mode === 'light' ? 'Light' : 'Dark';
      modeT.setAttribute('aria-checked', prefs.mode === 'light' ? 'true' : 'false');
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
  }
  function buildThemePanel(cfg) {
    var panel = document.getElementById('themePanel');
    if (!panel) return;
    panel.innerHTML = '';
    panel.appendChild(h('h3', null, 'Appearance'));
    var row1 = h('div', 'theme-row');
    row1.appendChild(h('span', null, 'Light theme'));
    var modeT = h('button', 'toggle');
    modeT.type = 'button';
    modeT.setAttribute('data-tmode', '1');
    modeT.setAttribute('role', 'switch');
    modeT.setAttribute('aria-label', 'Toggle light theme');
    modeT.addEventListener('click', function () {
      var p = loadThemePrefs(cfg);
      p.mode = p.mode === 'light' ? 'dark' : 'light';
      saveThemePrefs(p); applyTheme(cfg);
    });
    row1.appendChild(modeT);
    panel.appendChild(row1);
    var row2 = h('div', 'theme-row');
    row2.appendChild(h('span', null, 'Colour'));
    var sw = h('div', 'swatches');
    (cfg.theme.colors || []).forEach(function (c) {
      var b = h('button', 'swatch');
      b.type = 'button';
      b.setAttribute('data-color', c.id);
      b.title = c.name;
      b.setAttribute('aria-label', c.name + ' colour');
      b.style.background = c.swatch;
      b.addEventListener('click', function () {
        var p = loadThemePrefs(cfg);
        p.color = c.id;
        saveThemePrefs(p); applyTheme(cfg);
      });
      sw.appendChild(b);
    });
    row2.appendChild(sw);
    panel.appendChild(row2);
    var row3 = h('div', 'theme-row');
    row3.appendChild(h('span', null, 'Festival themes (auto)'));
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
    panel.appendChild(row3);
    var st = h('div', 'search-note');
    st.setAttribute('data-autostate', '1');
    panel.appendChild(st);
    var note = h('div', 'search-note', 'Festival dates are defaults — confirm them each year in data/site-config.json.');
    panel.appendChild(note);
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
      renderSaved();
    });
    return b;
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
          var th = h('div', 'thumb');
          th.appendChild(h('span', null, String(it.title || '?').charAt(0).toUpperCase()));
          card.appendChild(th);
          var body = h('div', 'today-body');
          body.appendChild(h('h3', null, it.title));
          body.appendChild(h('p', null, it.description || ''));
          var acts = h('div', 'today-actions');
          var url = safeUrl(it.link);
          if (url) {
            acts.appendChild(driveLink(url, 'Open Notes ↗', true));
            acts.appendChild(bookmarkBtn(it.id));
            recordViewOnClick(acts, { id: it.id, title: it.title, link: url, sectionLabel: "Today's Notes" });
          }
          body.appendChild(acts);
          card.appendChild(body);
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
      var hh = h('h4');
      hh.appendChild(h('span', null, u.title));
      var meta = h('span');
      if (u.important) meta.appendChild(h('span', 'badge ok', 'Important'));
      else if (u.publishedAt && Date.now() - Date.parse(u.publishedAt) < 24 * 3600 * 1000)
        meta.appendChild(h('span', 'badge ok', 'New'));
      if (u.publishedAt) meta.appendChild(h('time', null, ' ' + fmtDT(u.publishedAt)));
      hh.appendChild(meta);
      li.appendChild(hh);
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
      var cd = h('div', 'card pad');
      cd.appendChild(h('div', 'sec-sub', 'Exam countdown'));
      var num = h('div', 'countdown');
      cd.appendChild(num); wrap.appendChild(cd);
      (function tick() {
        var ms = Date.parse(ex.examDate) - Date.now();
        num.textContent = ms > 0
          ? Math.floor(ms / 86400000) + ' days to go'
          : 'Exam date has passed.';
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
      var cl = h('div', 'card pad'); cl.style.marginTop = '12px';
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
  }

  function renderAnnouncements() {
    var anns = (CONTENT.announcements || []).filter(function (a) { return a.visible !== false; });
    var bell = document.getElementById('bellDot');
    if (bell) bell.classList.toggle('on', anns.length > 0);
    var bar = document.getElementById('announceBar');
    return { anns: anns, bar: bar };
  }

  function renderSaved() {
    var panel = document.getElementById('savedPanel');
    if (!panel) return;
    panel.innerHTML = '';
    panel.appendChild(h('h3', null, 'Saved & recent'));
    var bms = getBookmarks();
    var items = [];
    if (SEARCH_INDEX.length && bms.length) {
      items = SEARCH_INDEX.filter(function (i) { return bms.indexOf(i.id) !== -1; });
    }
    if (items.length) {
      panel.appendChild(h('div', 'search-note', 'Bookmarks'));
      items.forEach(function (i) { panel.appendChild(savedRow(i)); });
    }
    var rec = loadJson(RECENT_KEY, []);
    if (rec.length) {
      panel.appendChild(h('div', 'search-note', 'Recently viewed'));
      rec.slice(0, 6).forEach(function (i) { panel.appendChild(savedRow(i)); });
    }
    if (!items.length && !rec.length) {
      panel.appendChild(h('div', 'search-note', 'Nothing saved yet. Tap ☆ on any card to bookmark it.'));
    }
  }
  function savedRow(i) {
    var d = h('div');
    d.style.padding = '8px 0';
    d.style.borderBottom = '1px solid var(--border)';
    if (i.link && safeUrl(i.link)) {
      var a = h('a', null, i.title);
      a.href = i.link; a.target = '_blank'; a.rel = 'noopener';
      a.style.color = 'var(--text)'; a.style.textDecoration = 'none'; a.style.fontSize = '14px';
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
  }
  function showSearchResults(q) {
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
    var themePanel = document.getElementById('themePanel');
    themeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      themePanel.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!themePanel.contains(e.target) && e.target !== themeBtn) themePanel.classList.remove('open');
    });
    var bell = document.getElementById('bellBtn');
    bell.addEventListener('click', function () {
      var info = renderAnnouncements();
      var msg = info.anns.length
        ? info.anns.map(function (a) { return '• ' + a.title; }).join('\n')
        : 'No announcements right now.';
      alert(msg);
    });
    var bmBtn = document.getElementById('savedBtn');
    var savedPanel = document.getElementById('savedPanel');
    bmBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      renderSaved();
      savedPanel.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!savedPanel.contains(e.target) && e.target !== bmBtn) savedPanel.classList.remove('open');
    });
    var backTop = document.getElementById('backTop');
    backTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
    });
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
      row.c.forEach(function (cell, i) {
        var val = sheetCellValue(cell);
        if (val !== '' && val !== null && val !== undefined) any = true;
        obj[cols[i]] = (val === null || val === undefined) ? '' : val;
      });
      if (any) out.push(obj);
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
    if (map.main_drive_folder && /^https:\/\//i.test(map.main_drive_folder)) cfg.site.mainDriveFolder = map.main_drive_folder;
    cfg.theme = cfg.theme || {};
    if (map.default_mode === 'light' || map.default_mode === 'dark') cfg.theme.defaultMode = map.default_mode;
    var colors = (cfg.theme.colors || []).map(function (c) { return c.id; });
    if (map.default_color && colors.indexOf(map.default_color) !== -1) cfg.theme.defaultColor = map.default_color;
    if (map.festival_auto !== undefined && map.festival_auto !== '') cfg.theme.autoFestival = sBool(map.festival_auto);
    return cfg;
  }
  /* SHEETS-END */

  function fetchSheetTab(sheetId, tab) {
    var url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) +
      '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(tab);
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
    applySectionOrder();
    initMotion();
    initScrollMotion();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
  }

  function boot() {
    Promise.all([
      fetch('./data/site-config.json').then(function (r) { return r.json(); }),
      fetch('./data/content.json').then(function (r) { return r.json(); }),
      fetch('./data/sheets-config.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (arr) {
      CFG = arr[0]; CONTENT = arr[1];
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
        renderAll();
      });
    }).catch(function () {
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
