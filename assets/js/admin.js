/* LawVault v5 — admin panel (admin.js).
   Reads the Google Sheet with the read-only gviz endpoint and writes
   through the Apps Script web app, which checks the admin credentials
   server-side on every request. No Google login is needed.
   Security: the administrative code and password are kept in memory
   and in sessionStorage (this tab only, cleared when the tab closes),
   never in localStorage and never in any file. Every value read from
   the Sheet is inserted as plain text, never as HTML. Only https://
   links are accepted. Writes use a no-CORS POST (Apps Script web apps
   redirect, which breaks normal CORS reads), so every write is
   confirmed by re-reading the Sheet before reporting success. */
(function () {
  'use strict';

  var SESSION_KEY = 'lv-admin-session-v5';
  var TZ = 'Asia/Kolkata';
  var TABS = ['settings', 'daily_notes', 'announcements', 'semesters',
    'subjects', 'case_laws', 'papers', 'exam_prep', 'pending',
    'contacts', 'activity_log'];

  var SHEETS_CFG = null;
  var DATA = {};
  var SESSION = { code: null, pass: null };
  var CURRENT = 'dashboard';
  var EDIT = null; /* { moduleKey, row, dupConfirmed } */

  /* ---------- small helpers ---------- */
  function el(id) { return document.getElementById(id); }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
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
  function sTime(v) {
    var t = sText(v);
    if (!t) return NaN;
    var ms = Date.parse(t);
    return isNaN(ms) ? NaN : ms;
  }
  function fmtDT(v) {
    var ms = sTime(v);
    if (isNaN(ms)) return sText(v);
    try {
      return new Date(ms).toLocaleString('en-IN', {
        timeZone: TZ, day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit', hour12: true
      });
    } catch (e) { return sText(v); }
  }
  function isHttps(v) { return /^https:\/\//i.test(sText(v)); }
  function isDriveLink(v) {
    var t = sText(v).toLowerCase();
    return t.indexOf('drive.google.com') !== -1 || t.indexOf('docs.google.com') !== -1;
  }
  function toLocalInput(v) {
    var ms = sTime(v);
    if (isNaN(ms)) return '';
    var d = new Date(ms);
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function toast(msg, isError) {
    var t = el('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.style.display = 'none'; }, 3500);
  }

  /* ---------- gviz reading (same contract as the public site) ---------- */
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
  function cellValue(cell) {
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
  function rowsToObjects(table) {
    var cols = (table.cols || []).map(function (c, i) {
      return (c && c.label ? String(c.label) : 'col' + i).trim();
    });
    var out = [];
    (table.rows || []).forEach(function (row) {
      if (!row || !row.c) return;
      var obj = {};
      var any = false;
      row.c.forEach(function (cell, i) {
        var val = cellValue(cell);
        if (val !== '' && val !== null && val !== undefined) any = true;
        obj[cols[i]] = (val === null || val === undefined) ? '' : val;
      });
      if (any) out.push(obj);
    });
    return out;
  }
  function readTab(tab) {
    var url = 'https://docs.google.com/spreadsheets/d/' +
      encodeURIComponent(SHEETS_CFG.sheetId) +
      '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(tab) +
      '&cb=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('read failed');
      return r.text();
    }).then(function (text) {
      var table = parseGvizText(text);
      if (!table) throw new Error('parse failed');
      return rowsToObjects(table);
    });
  }
  function readAll() {
    return Promise.all(TABS.map(function (tab) {
      return readTab(tab).then(function (rows) {
        return { tab: tab, rows: rows };
      }).catch(function () {
        return { tab: tab, rows: null };
      });
    })).then(function (results) {
      var next = {};
      results.forEach(function (r) {
        if (r.rows !== null) next[r.tab] = r.rows;
        else if (DATA[r.tab]) next[r.tab] = DATA[r.tab];
        else next[r.tab] = [];
      });
      DATA = next;
      return DATA;
    });
  }

  /* ---------- authentication (JSONP ping) ---------- */
  function ping(code, pass) {
    return new Promise(function (resolve) {
      var cb = 'lvPing' + Date.now() + Math.floor(Math.random() * 1000);
      var done = false;
      var script = document.createElement('script');
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(ok);
      }
      var timer = setTimeout(function () { finish(false); }, 20000);
      window[cb] = function (res) { finish(!!(res && res.ok)); };
      script.onerror = function () { finish(false); };
      script.src = SHEETS_CFG.appsScriptUrl +
        '?action=ping&code=' + encodeURIComponent(code) +
        '&pass=' + encodeURIComponent(pass) +
        '&callback=' + cb;
      document.head.appendChild(script);
    });
  }

  /* ---------- writes (POST + re-read verification) ---------- */
  function postWrite(action, tab, row) {
    return fetch(SHEETS_CFG.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ code: SESSION.code, pass: SESSION.pass, action: action, tab: tab, row: row })
    }).catch(function () { /* no-cors: network errors surface via verification */ });
  }
  function pollVerify(tab, predicate, attemptsLeft) {
    return readTab(tab).then(function (rows) {
      if (predicate(rows)) return true;
      if (attemptsLeft <= 1) return false;
      return new Promise(function (res) { setTimeout(res, 1200); })
        .then(function () { return pollVerify(tab, predicate, attemptsLeft - 1); });
    }).catch(function () {
      if (attemptsLeft <= 1) return false;
      return new Promise(function (res) { setTimeout(res, 1200); })
        .then(function () { return pollVerify(tab, predicate, attemptsLeft - 1); });
    });
  }
  function writeAndVerify(action, tab, row, predicate) {
    return postWrite(action, tab, row).then(function () {
      return pollVerify(tab, predicate, 5);
    }).then(function (verified) {
      return readAll().then(function () { return verified; });
    });
  }

  /* ---------- module definitions ---------- */
  var STATUS_OPTS = [
    { value: 'Draft', label: 'Draft (not public)' },
    { value: 'Published', label: 'Published' },
    { value: 'Archived', label: 'Archived (hidden)' }
  ];
  var MODULES = {
    'daily-notes': {
      tab: 'daily_notes', title: 'Daily Notes',
      desc: "Manage today's materials. Expiry removes a note from display only — never from Drive.",
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'drive_link', label: 'Google Drive link', type: 'url', required: true, help: 'Paste the document or folder URL. Must start with https://.' },
        { key: 'subject', label: 'Subject', type: 'text' },
        { key: 'publish_at', label: 'Publish at', type: 'datetime', help: 'Leave empty to publish immediately. A future time schedules the note.' },
        { key: 'expires_at', label: 'Expires at', type: 'datetime', help: 'Leave empty for automatic expiry 24 hours after publishing.' },
        { key: 'important', label: 'Mark as Important', type: 'checkbox' },
        { key: 'enabled', label: 'Enabled', type: 'checkbox', def: true },
        { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTS, def: 'Published' }
      ]
    },
    'announcements': {
      tab: 'announcements', title: 'Announcements',
      desc: 'Publish updates. Announcements appear in Latest Updates and on the notification bell.',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'badge', label: 'Badge', type: 'select', options: [
          { value: '', label: 'None' },
          { value: 'New', label: 'New' },
          { value: 'Important', label: 'Important' }
        ] },
        { key: 'pinned', label: 'Pin to the top', type: 'checkbox' },
        { key: 'publish_at', label: 'Publish at', type: 'datetime', help: 'Leave empty to publish immediately. A future time schedules the announcement.' },
        { key: 'expires_at', label: 'Expires at', type: 'datetime', help: 'Leave empty for no expiry.' },
        { key: 'enabled', label: 'Enabled', type: 'checkbox', def: true },
        { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTS, def: 'Published' }
      ]
    },
    'semesters': {
      tab: 'semesters', title: 'Semester',
      desc: 'Semesters 1–7. A semester marked "not configured" hides its subjects on the public site.',
      fields: [
        { key: 'number', label: 'Semester number', type: 'number', required: true },
        { key: 'label', label: 'Label', type: 'text', required: true },
        { key: 'configured', label: 'Configured (subjects visible)', type: 'checkbox', def: true },
        { key: 'enabled', label: 'Enabled', type: 'checkbox', def: true },
        { key: 'order', label: 'Display order', type: 'number', def: 1 }
      ]
    },
    'subjects': {
      tab: 'subjects', title: 'Subject',
      desc: 'Subject/unit cards inside a semester.',
      fields: [
        { key: 'semester_id', label: 'Semester', type: 'semester-select', required: true },
        { key: 'name', label: 'Subject name', type: 'text', required: true },
        { key: 'icon', label: 'Icon (emoji)', type: 'text' },
        { key: 'unit', label: 'Unit', type: 'text', help: 'For example: Unit 2' },
        { key: 'description', label: 'Description / topic', type: 'textarea' },
        { key: 'drive_link', label: 'Google Drive link', type: 'url', required: true, help: 'Paste the document URL. Must start with https://.' },
        { key: 'enabled', label: 'Enabled', type: 'checkbox', def: true },
        { key: 'order', label: 'Display order', type: 'number', def: 1 }
      ]
    }
  };
  var MODULE_META = {
    'dashboard': ['Dashboard', 'Overview of LawVault content.'],
    'daily-notes': ['Daily Notes', "Manage today's materials."],
    'announcements': ['Announcements', 'Publish updates.'],
    'semesters': ['Semester & Subjects', 'Organise study materials.'],
    'cases': ['Case Laws', 'Manage case summaries.'],
    'papers': ['Question Papers', 'Manage previous papers.'],
    'exam': ['Exam Preparation', 'Manage exam resources.'],
    'pending': ['Pending Content', 'Review unverified entries.'],
    'contacts': ['Contact & Feedback', 'Manage communication links.'],
    'appearance': ['Appearance', 'Themes and colours.'],
    'settings': ['Website Settings', 'General configurations.'],
    'activity': ['Activity Log', 'History of admin actions.']
  };

  /* ---------- visibility helpers (mirror the public site's rules) ---------- */
  function rowLive(row, now) {
    if (!sBool(row.enabled)) return false;
    var st = sText(row.status).toLowerCase();
    if (st && st !== 'published' && st !== 'demo') return false;
    var pub = sTime(row.publish_at);
    if (!isNaN(pub) && pub > now) return false;
    var exp = sTime(row.expires_at);
    if (!isNaN(exp) && exp <= now) return false;
    return true;
  }
  function dailyNoteLive(row, now) {
    if (!rowLive(row, now)) return false;
    var pub = sTime(row.publish_at) || sTime(row.created_at);
    if (!isNaN(pub) && (now - pub) >= 24 * 3600 * 1000) return false;
    return true;
  }
  function statusBadges(row, extra) {
    var wrap = h('span');
    var st = sText(row.status);
    if (st) wrap.appendChild(h('span', 'badge' + (st.toLowerCase() === 'published' ? ' ok' : st.toLowerCase() === 'demo' ? ' demo' : ''), st));
    if (!sBool(row.enabled)) wrap.appendChild(h('span', 'badge warn', 'Disabled'));
    if (sBool(row.important)) wrap.appendChild(h('span', 'badge ok', 'Important'));
    if (sBool(row.pinned)) wrap.appendChild(h('span', 'badge ok', 'Pinned'));
    var now = Date.now();
    var pub = sTime(row.publish_at);
    if (!isNaN(pub) && pub > now) wrap.appendChild(h('span', 'badge warn', 'Scheduled'));
    if (extra) extra.forEach(function (b) { wrap.appendChild(h('span', 'badge', b)); });
    return wrap;
  }

  /* ---------- list rendering ---------- */
  function actionBtn(label, fn, danger) {
    var b = h('button', 'mini-btn' + (danger ? ' danger' : ''), label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  function renderList(container, rows, buildRow, emptyText) {
    container.innerHTML = '';
    if (!rows.length) {
      container.appendChild(h('p', 'sec-sub', emptyText));
      return;
    }
    rows.forEach(function (row) { container.appendChild(buildRow(row)); });
  }
  function togglePublishBtn(moduleKey, row) {
    var published = sText(row.status).toLowerCase() === 'published';
    return actionBtn(published ? 'Unpublish' : 'Publish', function () {
      var next = {};
      next.id = row.id;
      next.status = published ? 'Draft' : 'Published';
      saveRow(moduleKey, next, true, function (ok) {
        toast(ok ? (published ? 'Unpublished.' : 'Published.') : 'Could not confirm the change. Check the list and activity log.', !ok);
      });
    });
  }
  function toggleEnabledBtn(moduleKey, row) {
    var enabled = sBool(row.enabled);
    return actionBtn(enabled ? 'Disable' : 'Enable', function () {
      var next = { id: row.id, enabled: enabled ? 'FALSE' : 'TRUE' };
      saveRow(moduleKey, next, true, function (ok) {
        toast(ok ? (enabled ? 'Disabled.' : 'Enabled.') : 'Could not confirm the change. Check the list and activity log.', !ok);
      });
    });
  }
  function deleteBtn(moduleKey, row, label) {
    return actionBtn('Delete', function () {
      if (!window.confirm('Delete "' + sText(label || row.title || row.name || row.label) + '"? This removes the catalogue entry only — it never deletes the Google Drive document.')) return;
      writeAndVerify('delete', MODULES[moduleKey].tab, { id: row.id }, function (rows) {
        return !rows.some(function (r) { return sText(r.id) === sText(row.id); });
      }).then(function (ok) {
        toast(ok ? 'Deleted.' : 'Could not confirm the deletion. Check the list and activity log.', !ok);
        renderCurrent();
      });
    }, true);
  }

  function renderDaily() {
    var rows = (DATA.daily_notes || []).slice().sort(function (a, b) {
      return sTime(b.created_at) - sTime(a.created_at);
    });
    renderList(el('listDaily'), rows, function (row) {
      var div = h('div', 'list-row');
      var main = h('div', 'row-main');
      main.appendChild(h('div', 'row-title', sText(row.title) || '(no title)'));
      main.appendChild(h('div', 'row-meta',
        [sText(row.subject), row.publish_at ? 'Published ' + fmtDT(row.publish_at) : '',
         row.expires_at ? 'Expires ' + fmtDT(row.expires_at) : ''].filter(Boolean).join(' • ') ||
        'No schedule set'));
      main.appendChild(statusBadges(row, dailyNoteLive(row, Date.now()) ? ['Live now'] : []));
      div.appendChild(main);
      var acts = h('div', 'row-actions');
      acts.appendChild(actionBtn('Edit', function () { openEditor('daily-notes', row); }));
      acts.appendChild(togglePublishBtn('daily-notes', row));
      acts.appendChild(toggleEnabledBtn('daily-notes', row));
      acts.appendChild(deleteBtn('daily-notes', row));
      div.appendChild(acts);
      return div;
    }, 'No daily notes yet. Add one to fill the Today\'s Notes section.');
  }

  function renderAnnouncements() {
    var rows = (DATA.announcements || []).slice().sort(function (a, b) {
      return sTime(b.created_at) - sTime(a.created_at);
    });
    renderList(el('listAnn'), rows, function (row) {
      var div = h('div', 'list-row');
      var main = h('div', 'row-main');
      main.appendChild(h('div', 'row-title', sText(row.title) || '(no title)'));
      main.appendChild(h('div', 'row-meta',
        [sText(row.badge) ? 'Badge: ' + sText(row.badge) : '',
         row.publish_at ? 'Published ' + fmtDT(row.publish_at) : '',
         row.expires_at ? 'Expires ' + fmtDT(row.expires_at) : ''].filter(Boolean).join(' • ') ||
        'No schedule set'));
      main.appendChild(statusBadges(row, rowLive(row, Date.now()) ? ['Live now'] : []));
      div.appendChild(main);
      var acts = h('div', 'row-actions');
      acts.appendChild(actionBtn('Edit', function () { openEditor('announcements', row); }));
      acts.appendChild(togglePublishBtn('announcements', row));
      acts.appendChild(toggleEnabledBtn('announcements', row));
      acts.appendChild(deleteBtn('announcements', row));
      div.appendChild(acts);
      return div;
    }, 'No announcements yet.');
  }

  function renderSemesters() {
    var sems = (DATA.semesters || []).slice().sort(function (a, b) {
      return Number(a.order || 0) - Number(b.order || 0);
    });
    renderList(el('semList'), sems, function (row) {
      var count = (DATA.subjects || []).filter(function (s) {
        return sText(s.semester_id) === sText(row.id);
      }).length;
      var div = h('div', 'list-row');
      var main = h('div', 'row-main');
      main.appendChild(h('div', 'row-title', sText(row.label) || ('Semester ' + sText(row.number))));
      main.appendChild(h('div', 'row-meta', count + ' subject(s)'));
      var badges = h('span');
      badges.appendChild(h('span', 'badge' + (sBool(row.configured) ? ' ok' : ' warn'),
        sBool(row.configured) ? 'Configured' : 'Not configured'));
      if (!sBool(row.enabled)) badges.appendChild(h('span', 'badge warn', 'Disabled'));
      main.appendChild(badges);
      div.appendChild(main);
      var acts = h('div', 'row-actions');
      acts.appendChild(actionBtn('Edit', function () { openEditor('semesters', row); }));
      div.appendChild(acts);
      return div;
    }, 'No semesters found in the Sheet. Run setupSheets() in the Apps Script editor.');

    var sel = el('semSelect');
    var prev = sel.value;
    sel.innerHTML = '';
    sems.forEach(function (s) {
      sel.appendChild(new Option(sText(s.label) || ('Semester ' + sText(s.number)), sText(s.id)));
    });
    if (prev && sems.some(function (s) { return sText(s.id) === prev; })) sel.value = prev;
    renderSubjects();
  }

  function renderSubjects() {
    var semId = el('semSelect').value;
    var rows = (DATA.subjects || []).filter(function (s) {
      return !semId || sText(s.semester_id) === semId;
    }).sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); });
    renderList(el('subjList'), rows, function (row) {
      var div = h('div', 'list-row');
      var main = h('div', 'row-main');
      main.appendChild(h('div', 'row-title', sText(row.name) || '(no name)'));
      main.appendChild(h('div', 'row-meta',
        [sText(row.unit), sText(row.description)].filter(Boolean).join(' • ') || 'No unit/description'));
      var badges = h('span');
      if (!sBool(row.enabled)) badges.appendChild(h('span', 'badge warn', 'Disabled'));
      if (!isHttps(row.drive_link)) badges.appendChild(h('span', 'badge warn', 'Bad/missing link'));
      main.appendChild(badges);
      div.appendChild(main);
      var acts = h('div', 'row-actions');
      acts.appendChild(actionBtn('Edit', function () { openEditor('subjects', row); }));
      acts.appendChild(toggleEnabledBtn('subjects', row));
      acts.appendChild(deleteBtn('subjects', row, row.name));
      div.appendChild(acts);
      return div;
    }, 'No subjects in this semester yet.');
  }

  function renderActivity() {
    var rows = (DATA.activity_log || []).slice().reverse().slice(0, 50);
    var box = el('logList');
    box.innerHTML = '';
    if (!rows.length) {
      box.appendChild(h('p', 'sec-sub', 'No activity recorded yet.'));
      return;
    }
    var table = h('table', 'log-table');
    var thead = h('thead');
    var tr = h('tr');
    ['Time', 'Admin', 'Action', 'Module', 'Detail', 'Result'].forEach(function (c) {
      tr.appendChild(h('th', null, c));
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = h('tbody');
    rows.forEach(function (r) {
      var row = h('tr');
      row.appendChild(h('td', null, fmtDT(r.timestamp)));
      row.appendChild(h('td', null, sText(r.admin)));
      row.appendChild(h('td', null, sText(r.action)));
      row.appendChild(h('td', null, sText(r.module)));
      row.appendChild(h('td', null, sText(r.detail)));
      row.appendChild(h('td', null, sText(r.result)));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    box.appendChild(table);
  }

  function renderDashboard() {
    var now = Date.now();
    var subjects = DATA.subjects || [];
    var cases = DATA.case_laws || [];
    var papers = DATA.papers || [];
    var resources = DATA.exam_prep || [];
    el('statSubjects').textContent = subjects.length;
    el('statCases').textContent = cases.length;
    el('statPapers').textContent = papers.length;
    el('statResources').textContent = resources.length;
    el('statToday').textContent = (DATA.daily_notes || []).filter(function (r) {
      return dailyNoteLive(r, now);
    }).length;
    el('statAnnouncements').textContent = (DATA.announcements || []).filter(function (r) {
      return rowLive(r, now);
    }).length;
    el('statPending').textContent = (DATA.pending || []).filter(function (r) {
      var st = sText(r.status).toLowerCase();
      return st === 'pending' || st === 'demo';
    }).length;
    var broken = 0;
    [['daily_notes', 'drive_link'], ['subjects', 'drive_link'],
     ['case_laws', 'drive_link'], ['papers', 'drive_link'],
     ['exam_prep', 'drive_link'], ['pending', 'drive_link'],
     ['contacts', 'destination']].forEach(function (pair) {
      (DATA[pair[0]] || []).forEach(function (r) {
        var v = sText(r[pair[1]]);
        if (v && !isHttps(v)) broken++;
        if (!v && pair[0] !== 'contacts') broken++;
      });
    });
    el('statBroken').textContent = broken;

    var recent = [];
    [['daily_notes', 'Daily Note'], ['announcements', 'Announcement'],
     ['subjects', 'Subject']].forEach(function (pair) {
      (DATA[pair[0]] || []).forEach(function (r) {
        var t = sTime(r.updated_at) || sTime(r.created_at);
        if (!isNaN(t)) recent.push({ t: t, label: sText(r.title || r.name), kind: pair[1] });
      });
    });
    recent.sort(function (a, b) { return b.t - a.t; });
    var box = el('recentList');
    box.innerHTML = '';
    if (!recent.length) {
      box.appendChild(h('p', 'sec-sub', 'Nothing modified yet.'));
      return;
    }
    recent.slice(0, 6).forEach(function (r) {
      var line = h('p', 'sec-sub', fmtDT(new Date(r.t).toISOString()) + ' — ' + r.kind + ': ' + r.label);
      box.appendChild(line);
    });
  }

  function renderCurrent() {
    if (CURRENT === 'dashboard') renderDashboard();
    else if (CURRENT === 'daily-notes') renderDaily();
    else if (CURRENT === 'announcements') renderAnnouncements();
    else if (CURRENT === 'semesters') renderSemesters();
    else if (CURRENT === 'activity') renderActivity();
  }

  /* ---------- editor ---------- */
  function buildField(def, value) {
    var label = h('label', 'field' + (def.type === 'checkbox' ? ' check' : ''));
    var span = h('span', null, def.label + (def.required ? ' *' : ''));
    var input;
    if (def.type === 'textarea') {
      input = h('textarea');
      input.value = value || '';
    } else if (def.type === 'select') {
      input = h('select');
      (def.options || []).forEach(function (o) {
        input.appendChild(new Option(o.label, o.value));
      });
      input.value = (value === undefined || value === '') ? (def.def || '') : value;
    } else if (def.type === 'semester-select') {
      input = h('select');
      (DATA.semesters || []).forEach(function (s) {
        input.appendChild(new Option(sText(s.label) || ('Semester ' + sText(s.number)), sText(s.id)));
      });
      input.value = value || el('semSelect').value || '';
    } else if (def.type === 'checkbox') {
      input = h('input');
      input.type = 'checkbox';
      input.checked = value === undefined || value === '' ? !!def.def : sBool(value);
    } else if (def.type === 'datetime') {
      input = h('input');
      input.type = 'datetime-local';
      input.value = toLocalInput(value);
    } else if (def.type === 'number') {
      input = h('input');
      input.type = 'number';
      input.value = (value === undefined || value === '') ? (def.def === undefined ? '' : def.def) : value;
    } else {
      input = h('input');
      input.type = def.type === 'url' ? 'url' : 'text';
      input.value = value || '';
      if (def.type === 'url') { input.placeholder = 'https://…'; input.setAttribute('inputmode', 'url'); }
    }
    input.setAttribute('data-field', def.key);
    input.addEventListener('input', function () {
      if (EDIT) EDIT.dupConfirmed = false;
      el('editorSave').textContent = 'Save';
      hideEditorMessages();
    });
    if (def.type === 'checkbox') {
      label.appendChild(input);
      label.appendChild(span);
    } else {
      label.appendChild(span);
      label.appendChild(input);
    }
    if (def.help) label.appendChild(h('span', 'help', def.help));
    return label;
  }
  function hideEditorMessages() {
    el('editorError').style.display = 'none';
    el('editorWarn').style.display = 'none';
  }
  function showEditorError(msg) {
    var e = el('editorError');
    e.textContent = msg;
    e.style.display = 'block';
  }
  function showEditorWarn(msg) {
    var w = el('editorWarn');
    w.textContent = msg;
    w.style.display = 'block';
  }
  function openEditor(moduleKey, row) {
    var mod = MODULES[moduleKey];
    EDIT = { moduleKey: moduleKey, row: row || null, dupConfirmed: false };
    el('editorTitle').textContent = (row ? 'Edit ' : 'Add ') + mod.title.replace(/s$/, '') + (row ? '' : ' (new)');
    var fields = el('editorFields');
    fields.innerHTML = '';
    mod.fields.forEach(function (def) {
      fields.appendChild(buildField(def, row ? row[def.key] : undefined));
    });
    hideEditorMessages();
    el('editorPreview').style.display = 'none';
    el('editorSave').textContent = 'Save';
    el('editorDelete').style.display = row ? 'inline-flex' : 'none';
    el('editor').style.display = 'block';
    el('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() {
    EDIT = null;
    el('editor').style.display = 'none';
  }
  function collectEditor() {
    var mod = MODULES[EDIT.moduleKey];
    var obj = {};
    if (EDIT.row && EDIT.row.id) obj.id = EDIT.row.id;
    el('editorFields').querySelectorAll('[data-field]').forEach(function (input) {
      var key = input.getAttribute('data-field');
      var def = null;
      mod.fields.forEach(function (d) { if (d.key === key) def = d; });
      if (!def) return;
      if (def.type === 'checkbox') obj[key] = input.checked ? 'TRUE' : 'FALSE';
      else obj[key] = input.value.trim();
    });
    return obj;
  }
  function validateEditor(obj) {
    var mod = MODULES[EDIT.moduleKey];
    for (var i = 0; i < mod.fields.length; i++) {
      var def = mod.fields[i];
      var v = obj[def.key];
      if (def.required && (v === undefined || v === '')) {
        return 'Please fill in: ' + def.label + '.';
      }
      if (def.type === 'url' && v && !isHttps(v)) {
        return def.label + ' must start with https://.';
      }
    }
    return null;
  }
  function duplicateWarning(obj) {
    var mod = MODULES[EDIT.moduleKey];
    var titleKey = obj.title !== undefined ? 'title' : (obj.name !== undefined ? 'name' : (obj.label !== undefined ? 'label' : null));
    if (!titleKey) return null;
    var mine = sText(obj[titleKey]).toLowerCase();
    if (!mine) return null;
    var dup = (DATA[mod.tab] || []).some(function (r) {
      return sText(r[titleKey]).toLowerCase() === mine && sText(r.id) !== sText(obj.id);
    });
    return dup ? 'An entry with this ' + titleKey + ' already exists. Save again to confirm it is not a duplicate.' : null;
  }
  function linkWarning(obj) {
    var link = obj.drive_link || obj.destination;
    if (link && isHttps(link) && !isDriveLink(link)) {
      return 'This link is not a Google Drive/Docs link. It will still be saved — double-check it opens the right document.';
    }
    return null;
  }
  function saveRow(moduleKey, patch, isUpdate, done) {
    var mod = MODULES[moduleKey];
    var action = isUpdate ? 'update' : 'add';
    var id = patch.id;
    var predicate;
    if (action === 'add') {
      predicate = function (rows) {
        return rows.some(function (r) { return sText(r.id) === sText(id); });
      };
    } else {
      predicate = function (rows) {
        return rows.some(function (r) {
          if (sText(r.id) !== sText(id)) return false;
          return Object.keys(patch).every(function (k) {
            if (k === 'id') return true;
            return sText(r[k]) === sText(patch[k]);
          });
        });
      };
    }
    writeAndVerify(action, mod.tab, patch, predicate).then(function (ok) {
      renderCurrent();
      if (done) done(ok);
    });
  }
  function saveEditor() {
    if (!EDIT) return;
    hideEditorMessages();
    var obj = collectEditor();
    var err = validateEditor(obj);
    if (err) { showEditorError(err); return; }
    var dup = duplicateWarning(obj);
    if (dup && !EDIT.dupConfirmed) {
      EDIT.dupConfirmed = true;
      showEditorWarn(dup);
      el('editorSave').textContent = 'Save anyway';
      return;
    }
    var warn = linkWarning(obj);
    if (warn) showEditorWarn(warn);
    var isUpdate = !!(EDIT.row && EDIT.row.id);
    if (!isUpdate && !obj.id) {
      /* New rows get a client-side id so the write can be verified by
         re-reading the Sheet. The script accepts provided ids. */
      var prefixes = { 'daily-notes': 'note', 'announcements': 'ann', 'semesters': 'sem', 'subjects': 'subj' };
      obj.id = (prefixes[EDIT.moduleKey] || 'row') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    el('editorSave').disabled = true;
    el('editorSave').textContent = 'Saving…';
    saveRow(EDIT.moduleKey, obj, isUpdate, function (ok) {
      el('editorSave').disabled = false;
      el('editorSave').textContent = 'Save';
      if (ok) {
        toast(isUpdate ? 'Saved.' : 'Added.');
        closeEditor();
      } else {
        showEditorError('Could not confirm the change in the Sheet. It may still have been saved — check the list and the activity log, and do not save twice.');
      }
    });
  }
  function previewEditor() {
    if (!EDIT) return;
    var obj = collectEditor();
    var box = el('editorPreview');
    box.innerHTML = '';
    var card = h('div', 'preview-card');
    card.appendChild(h('span', 'badge', 'PREVIEW — how it will look'));
    var title = sText(obj.title || obj.name || obj.label) || '(no title)';
    card.appendChild(h('h3', null, title));
    var meta = [];
    if (obj.unit) meta.push(sText(obj.unit));
    if (obj.subject) meta.push(sText(obj.subject));
    if (sText(obj.status)) meta.push('Status: ' + sText(obj.status));
    if (obj.publish_at) meta.push('Publishes ' + fmtDT(obj.publish_at));
    if (obj.expires_at) meta.push('Expires ' + fmtDT(obj.expires_at));
    if (meta.length) card.appendChild(h('p', null, meta.join(' • ')));
    if (obj.description) card.appendChild(h('p', null, sText(obj.description)));
    if (obj.drive_link) {
      var link = h('span', 'badge ok', isHttps(obj.drive_link) ? 'Link: ' + sText(obj.drive_link) : 'Link is not https:// — it will be rejected');
      card.appendChild(link);
    }
    box.appendChild(card);
    box.style.display = 'block';
  }

  /* ---------- navigation ---------- */
  function showView(moduleKey) {
    CURRENT = moduleKey;
    closeEditor();
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-module') === moduleKey);
    });
    var views = {
      'dashboard': 'view-dashboard', 'daily-notes': 'view-daily-notes',
      'announcements': 'view-announcements', 'semesters': 'view-semesters',
      'cases': 'view-cases', 'papers': 'view-papers', 'exam': 'view-exam',
      'pending': 'view-pending', 'contacts': 'view-contacts',
      'appearance': 'view-appearance', 'settings': 'view-settings',
      'activity': 'view-activity'
    };
    Object.keys(views).forEach(function (k) {
      el(views[k]).style.display = k === moduleKey ? '' : 'none';
    });
    var meta = MODULE_META[moduleKey] || ['LawVault Admin', ''];
    el('moduleTitle').textContent = meta[0];
    el('moduleDesc').textContent = meta[1];
    renderCurrent();
  }

  /* ---------- login / logout ---------- */
  function setLoginEnabled(on) {
    el('adminCode').disabled = !on;
    el('adminPass').disabled = !on;
    el('loginBtn').disabled = !on;
  }
  function showLogin(message, bad) {
    el('loginView').style.display = '';
    el('appView').style.display = 'none';
    el('logoutBtn').style.display = 'none';
    var cs = el('connectState');
    cs.textContent = message;
    cs.className = 'connect-state' + (bad ? ' bad' : ' good');
  }
  function enterApp() {
    el('loginView').style.display = 'none';
    el('appView').style.display = '';
    el('logoutBtn').style.display = '';
    el('connLine').textContent = 'Storage: Google Sheet (connected) · Configuration: GitHub · Changes save to the Sheet and appear on the public site without editing code.';
    showView('dashboard');
    readAll().then(renderCurrent);
  }
  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: SESSION.code, pass: SESSION.pass }));
    } catch (e) { /* private mode: session lives in memory only */ }
  }
  function clearSession() {
    SESSION = { code: null, pass: null };
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function tryLogin(code, pass) {
    return ping(code, pass).then(function (ok) {
      if (!ok) return false;
      SESSION = { code: code, pass: pass };
      saveSession();
      return true;
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    fetch('./data/sheets-config.json').then(function (r) { return r.json(); }).then(function (cfg) {
      SHEETS_CFG = cfg || {};
      var problems = [];
      if (SHEETS_CFG.enabled !== true) problems.push('the Sheet connection is disabled (enabled is not true in data/sheets-config.json)');
      if (!sText(SHEETS_CFG.sheetId)) problems.push('no Sheet ID is configured');
      if (!isHttps(SHEETS_CFG.appsScriptUrl)) problems.push('no Apps Script web app URL is configured');
      if (problems.length) {
        setLoginEnabled(false);
        showLogin('Not connected: ' + problems.join('; ') +
          '. Follow apps-script/SETUP.md to create the Sheet, deploy the script, and fill in data/sheets-config.json. The public site keeps working from its local files meanwhile.', true);
        return;
      }
      showLogin('Connected to the Google Sheet. Log in to manage content.', false);
      setLoginEnabled(true);
      /* Restore a session from this tab, verifying it with the server. */
      var saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) {}
      if (saved && saved.code && saved.pass) {
        el('loginBtn').textContent = 'Checking session…';
        setLoginEnabled(false);
        tryLogin(saved.code, saved.pass).then(function (ok) {
          el('loginBtn').textContent = 'Log in';
          setLoginEnabled(true);
          if (ok) enterApp();
          else { clearSession(); showLogin('Your previous session expired. Please log in again.', true); }
        });
      }
    }).catch(function () {
      setLoginEnabled(false);
      showLogin('Not connected: data/sheets-config.json could not be loaded. The public site keeps working from its local files meanwhile.', true);
    });

    el('loginForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var code = el('adminCode').value.trim();
      var pass = el('adminPass').value;
      var err = el('loginError');
      err.style.display = 'none';
      if (!code || !pass) {
        err.textContent = 'Enter both the administrative code and the password.';
        err.style.display = 'block';
        return;
      }
      el('loginBtn').disabled = true;
      el('loginBtn').textContent = 'Checking…';
      tryLogin(code, pass).then(function (ok) {
        el('loginBtn').disabled = false;
        el('loginBtn').textContent = 'Log in';
        if (ok) {
          el('adminPass').value = '';
          enterApp();
        } else {
          err.textContent = 'Invalid administrative code or password, or the Apps Script web app could not be reached. Check the credentials and the deployment, then try again.';
          err.style.display = 'block';
        }
      });
    });

    el('logoutBtn').addEventListener('click', function () {
      clearSession();
      showLogin('Logged out. Your code and password were cleared from this tab.', false);
      setLoginEnabled(true);
    });

    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        showView(b.getAttribute('data-module'));
      });
    });
    document.querySelectorAll('[data-quick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = b.getAttribute('data-quick');
        showView(q);
        if (q === 'daily-notes') openEditor('daily-notes', null);
        else if (q === 'announcements') openEditor('announcements', null);
        else if (q === 'semesters') openEditor('subjects', null);
      });
    });

    el('refreshBtn').addEventListener('click', function () {
      readAll().then(function () {
        renderCurrent();
        toast('Refreshed from the Sheet.');
      });
    });
    el('addDailyBtn').addEventListener('click', function () { openEditor('daily-notes', null); });
    el('addAnnBtn').addEventListener('click', function () { openEditor('announcements', null); });
    el('addSubjBtn').addEventListener('click', function () { openEditor('subjects', null); });
    el('semSelect').addEventListener('change', renderSubjects);
    el('editorSave').addEventListener('click', saveEditor);
    el('editorPreviewBtn').addEventListener('click', previewEditor);
    el('editorCancel').addEventListener('click', closeEditor);
    el('editorDelete').addEventListener('click', function () {
      if (!EDIT || !EDIT.row) return;
      var mod = MODULES[EDIT.moduleKey];
      var label = sText(EDIT.row.title || EDIT.row.name || EDIT.row.label);
      if (!window.confirm('Delete "' + label + '"? This removes the catalogue entry only — it never deletes the Google Drive document.')) return;
      writeAndVerify('delete', mod.tab, { id: EDIT.row.id }, function (rows) {
        return !rows.some(function (r) { return sText(r.id) === sText(EDIT.row.id); });
      }).then(function (ok) {
        toast(ok ? 'Deleted.' : 'Could not confirm the deletion. Check the list and activity log.', !ok);
        if (ok) closeEditor();
        renderCurrent();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
