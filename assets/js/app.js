/* LawVault v3 — app.js
   Renders the site from data/site-config.json + data/content.json.
   Security: every config string is inserted as plain text (textContent),
   never as HTML. Only https:// links are accepted. Theme names must be
   from the config allowlists. */
(function () {
  'use strict';

  var THEME_KEY = 'lv-theme-v3';
  var BM_KEY = 'lv-bookmarks-v3';
  var RECENT_KEY = 'lv-recent-v3';
  var TZ = 'Asia/Kolkata';

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

  /* ---------- themes ---------- */
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
    // mode row
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
    // colour row
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
    // auto festival row
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
  function driveCaption() {
    return h('div', 'search-note', 'Opens in Google Drive ↗');
  }
  function sectionHead(icon, title, sub, actionEl) {
    var head = h('div', 'sec-head');
    head.appendChild(h('span', 'ico', icon));
    head.appendChild(h('h2', null, title));
    if (actionEl) {
      var wrap = h('div', 'sec-actions');
      wrap.appendChild(actionEl);
      head.appendChild(wrap);
    }
    return head;
  }
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
    // welcomeTitle is "Your LLB Study Space" — highlight the configured word safely
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
  }

  function activeTodayItems() {
    var tn = CONTENT.todayNotes || {};
    if (tn.enabled === false) return [];
    var hours = Number(tn.expiryHours) || 24;
    var now = Date.now();
    return (tn.items || []).filter(function (it) {
      if (it.visible === false) return false;
      if (!it.publishedAt) return true; // no schedule metadata: treat as active
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
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      var state = loadJson('lv-checklist-v3', {});
      ex.checklist.forEach(function (item) {
        var lab = h('label');
        var cb = h('input'); cb.type = 'checkbox';
        cb.checked = !!state[item.id];
        cb.addEventListener('change', function () {
          state[item.id] = cb.checked; saveJson('lv-checklist-v3', state);
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
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    window.addEventListener('scroll', function () {
      backTop.classList.toggle('show', window.scrollY > 600);
    }, { passive: true });
    backTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function revealOnScroll() {
    var io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { threshold: 0.08 });
    }
    function watch(root) {
      if (!root.querySelectorAll) return;
      root.querySelectorAll('.reveal:not(.in)').forEach(function (e) {
        if (io) io.observe(e); else e.classList.add('in');
      });
    }
    watch(document);
    // New cards are rendered dynamically (semester tabs, filters, search),
    // so observe them too when they are added later.
    if ('MutationObserver' in window && io) {
      var mo = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n && n.nodeType === 1) {
              if (n.classList && n.classList.contains('reveal') && !n.classList.contains('in')) io.observe(n);
              watch(n);
            }
          });
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
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
  }

  /* ---------- boot ---------- */
  function boot() {
    Promise.all([
      fetch('./data/site-config.json').then(function (r) { return r.json(); }),
      fetch('./data/content.json').then(function (r) { return r.json(); }),
    ]).then(function (arr) {
      CFG = arr[0]; CONTENT = arr[1];
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
      revealOnScroll();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(function () {});
      }
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
