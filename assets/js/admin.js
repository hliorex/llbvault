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

  /* In-page confirmation dialog. Native window.confirm() is avoided:
     it is awkward on phones and cannot be answered by automation,
     which made deletes impossible to verify. This dialog is plain
     DOM, styled in admin.css. */
  function confirmDialog(message, confirmLabel, onConfirm) {
    var overlay = h('div', 'confirm-overlay');
    var box = h('div', 'confirm-box');
    box.appendChild(h('p', 'confirm-msg', message));
    var row = h('div', 'confirm-actions');
    var cancel = h('button', 'btn ghost', 'Cancel');
    cancel.type = 'button';
    var yes = h('button', 'btn danger', confirmLabel || 'Delete');
    yes.type = 'button';
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });
    yes.addEventListener('click', function () { close(); onConfirm(); });
    row.appendChild(cancel);
    row.appendChild(yes);
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    cancel.focus();
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
      var isHeaderEcho = true;
      row.c.forEach(function (cell, i) {
        var val = cellValue(cell);
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
  function readTab(tab) {
    var url = 'https://docs.google.com/spreadsheets/d/' +
      encodeURIComponent(SHEETS_CFG.sheetId) +
      '/gviz/tq?tqx=out:json&headers=1&sheet=' + encodeURIComponent(tab) +
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
      return new Promise(function (res) { setTimeout(res, 1500); })
        .then(function () { return pollVerify(tab, predicate, attemptsLeft - 1); });
    }).catch(function () {
      if (attemptsLeft <= 1) return false;
      return new Promise(function (res) { setTimeout(res, 1500); })
        .then(function () { return pollVerify(tab, predicate, attemptsLeft - 1); });
    });
  }
  function writeAndVerify(action, tab, row, predicate) {
    return postWrite(action, tab, row).then(function () {
      return pollVerify(tab, predicate, 8);
    }).then(function (verified) {
      return readAll().then(function () { return verified; });
    });
  }

  /* ---------- settings tab (key/value) ---------- */
  /* SITE_DEFAULTS is data/site-config.json: the fallback the public
     site uses when a Sheet key is absent, and the source of the
     colour allowlist and festival defaults. Fetched at boot; the
     Appearance and Website Settings forms wait for it. */
  var SITE_DEFAULTS = null;
  function settingsMap() {
    var map = {};
    (DATA.settings || []).forEach(function (r) {
      var k = sText(r.key);
      if (k) map[k] = sText(r.value);
    });
    return map;
  }
  function saveSetting(key, value, done) {
    /* The script upserts settings rows by key (see doSetSetting), so
       'add' both creates and updates. Verify by re-reading the tab. */
    writeAndVerify('add', 'settings', { key: key, value: value }, function (rows) {
      return rows.some(function (r) {
        return sText(r.key) === key && sameValue(r.value, value);
      });
    }).then(function (ok) { if (done) done(ok); });
  }
  function saveSettings(pairs, done) {
    /* Sequential writes: the verification re-read of one write must
       not race the next write to the same tab. */
    var i = 0;
    var allOk = true;
    function next() {
      if (i >= pairs.length) { if (done) done(allOk); return; }
      var p = pairs[i++];
      saveSetting(p.key, p.value, function (ok) {
        if (!ok) allOk = false;
        next();
      });
    }
    next();
  }

  /* Filter state for the list views that have filters. Kept outside
     renderCurrent() so typing in a filter survives re-renders. */
  var CASE_FILTER = { q: '', subject: '' };
  var PAPER_FILTER = { year: '', semester: '', subject: '' };

  /* ---------- module definitions ---------- */
  var STATUS_OPTS = [
    { value: 'Draft', label: 'Draft (not public)' },
    { value: 'Published', label: 'Published' },
    { value: 'Archived', label: 'Archived (hidden)' }
  ];
  /* Case laws and papers keep a Demo option so the seeded placeholder
     rows stay visibly labelled Demo until the admin replaces them. */
  var CASE_STATUS_OPTS = STATUS_OPTS.concat([
    { value: 'Demo', label: 'Demo (placeholder)' }
  ]);
  /* Pending workflow: only Verified content may be published. The
     publish action enforces this; the select lists every state so an
     entry's history stays visible. */
  var PENDING_STATUS_OPTS = [
    { value: 'Draft', label: 'Draft (admin is preparing it)' },
    { value: 'Pending', label: 'Pending (awaiting verification)' },
    { value: 'Demo', label: 'Demo (placeholder material)' },
    { value: 'Verified', label: 'Verified (checked and approved)' },
    { value: 'Published', label: 'Published (promoted — leaves the Pending section)' },
    { value: 'Archived', label: 'Archived (no longer displayed)' }
  ];
  var CONTACT_KIND_OPTS = [
    { value: 'message', label: 'Message Admin' },
    { value: 'feedback', label: 'Send Feedback' },
    { value: 'broken-link', label: 'Report Broken Link' },
    { value: 'incorrect', label: 'Report Incorrect Content' },
    { value: 'suggest', label: 'Suggest a Resource' },
    { value: 'community', label: 'Join Class Community' }
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
    },
    'cases': {
      tab: 'case_laws', title: 'Case Laws',
      desc: 'Case summaries for the Case Law Library. Enter only real cases — never invent citations, facts, or judgments.',
      fields: [
        { key: 'title', label: 'Case title', type: 'text', required: true },
        { key: 'citation', label: 'Citation', type: 'text', help: 'For example: AIR 1973 SC 1461. Leave empty if unknown — never guess.' },
        { key: 'court', label: 'Court', type: 'text' },
        { key: 'year', label: 'Year', type: 'text', help: 'Decision year, for example: 1973.' },
        { key: 'subject', label: 'Subject', type: 'text', help: 'For example: Constitutional Law-I.' },
        { key: 'facts', label: 'Facts', type: 'textarea' },
        { key: 'issues', label: 'Legal issues', type: 'textarea' },
        { key: 'judgment', label: 'Judgment', type: 'textarea' },
        { key: 'ratio', label: 'Ratio decidendi', type: 'textarea' },
        { key: 'exam_relevance', label: 'Exam relevance', type: 'textarea' },
        { key: 'drive_link', label: 'Original source (Google Drive link)', type: 'url', help: 'Optional. Must start with https://.' },
        { key: 'important', label: 'Mark as Important', type: 'checkbox' },
        { key: 'status', label: 'Status', type: 'select', options: CASE_STATUS_OPTS, def: 'Draft' }
      ]
    },
    'papers': {
      tab: 'papers', title: 'Question Papers',
      desc: 'Previous year question papers. Upload to Drive first, then paste the folder link.',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true, help: 'For example: First Semester LLB — 2024 papers.' },
        { key: 'year', label: 'Exam year', type: 'text', required: true, help: 'For example: 2024.' },
        { key: 'semester_id', label: 'Semester', type: 'semester-select', help: 'Leave as "None" if the paper spans semesters.' },
        { key: 'subject', label: 'Subject', type: 'text' },
        { key: 'exam_type', label: 'Exam type', type: 'text', help: 'For example: End Semester, Supplementary, Model.' },
        { key: 'drive_link', label: 'Google Drive folder link', type: 'url', required: true, help: 'Must start with https://.' },
        { key: 'status', label: 'Status', type: 'select', options: CASE_STATUS_OPTS, def: 'Published' }
      ]
    },
    'exam': {
      tab: 'exam_prep', title: 'Exam Resource',
      desc: 'Resource cards in Exam Preparation. The exam date is set separately, above the list.',
      fields: [
        { key: 'category', label: 'Category', type: 'text', required: true, help: 'Grouping shown on the card, for example: Important Questions.' },
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'drive_link', label: 'Google Drive link', type: 'url', help: 'Optional. Must start with https://.' },
        { key: 'enabled', label: 'Enabled', type: 'checkbox', def: true },
        { key: 'order', label: 'Display order', type: 'number', def: 1 }
      ]
    },
    'pending': {
      tab: 'pending', title: 'Pending Entry',
      desc: 'Unverified material. Only Verified entries can be published.',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'drive_link', label: 'Google Drive link', type: 'url', help: 'Optional. Must start with https://.' },
        { key: 'status', label: 'Status', type: 'select', options: PENDING_STATUS_OPTS, def: 'Pending' },
        { key: 'reason', label: 'Why is this unverified?', type: 'textarea', help: 'Shown with the entry, so students know why it is not official yet.' }
      ]
    },
    'contacts': {
      tab: 'contacts', title: 'Contact Card',
      desc: 'Contact cards on the public site. Empty destination or disabled = greyed out.',
      fields: [
        { key: 'label', label: 'Label', type: 'text', required: true },
        { key: 'kind', label: 'Kind', type: 'select', options: CONTACT_KIND_OPTS },
        { key: 'destination', label: 'Destination link', type: 'url', help: 'Must start with https://, or leave empty for "Not configured yet".' },
        { key: 'enabled', label: 'Enabled', type: 'checkbox', def: false },
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
    if (st) wrap.appendChild(h('span', 'badge' + (st.toLowerCase() === 'published' || st.toLowerCase() === 'verified' ? ' ok' : st.toLowerCase() === 'demo' ? ' demo' : ''), st));
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
        toast(ok ? (published ? 'Unpublished.' : 'Published.') : 'Change sent — the Sheet can take a moment to update. Refresh in a few seconds if the list looks stale.', false);
      });
    });
  }
  function toggleEnabledBtn(moduleKey, row) {
    var enabled = sBool(row.enabled);
    return actionBtn(enabled ? 'Disable' : 'Enable', function () {
      var next = { id: row.id, enabled: enabled ? 'FALSE' : 'TRUE' };
      saveRow(moduleKey, next, true, function (ok) {
        toast(ok ? (enabled ? 'Disabled.' : 'Enabled.') : 'Change sent — the Sheet can take a moment to update. Refresh in a few seconds if the list looks stale.', false);
      });
    });
  }
  function deleteBtn(moduleKey, row, label) {
    return actionBtn('Delete', function () {
      confirmDialog('Delete "' + sText(label || row.title || row.name || row.label) + '"? This removes the catalogue entry only — it never deletes the Google Drive document.', 'Delete', function () {
        writeAndVerify('delete', MODULES[moduleKey].tab, { id: row.id }, function (rows) {
          return !rows.some(function (r) { return sText(r.id) === sText(row.id); });
        }).then(function (ok) {
          toast(ok ? 'Deleted.' : 'Delete sent — the Sheet can take a moment to update. Refresh in a few seconds if the entry still shows.', false);
          renderCurrent();
        });
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

  function semesterLabel(semId) {
    var found = null;
    (DATA.semesters || []).forEach(function (s) {
      if (sText(s.id) === sText(semId)) found = s;
    });
    return found ? (sText(found.label) || ('Semester ' + sText(found.number))) : '';
  }

  function renderCases() {
    var sel = el('caseSubjectFilter');
    var subjects = [];
    (DATA.case_laws || []).forEach(function (r) {
      var s = sText(r.subject);
      if (s && subjects.indexOf(s) === -1) subjects.push(s);
    });
    subjects.sort();
    var prev = sel.value;
    sel.innerHTML = '';
    sel.appendChild(new Option('All subjects', ''));
    subjects.forEach(function (s) { sel.appendChild(new Option(s, s)); });
    if (subjects.indexOf(CASE_FILTER.subject) !== -1) sel.value = CASE_FILTER.subject;
    else if (subjects.indexOf(prev) !== -1) sel.value = prev;
    CASE_FILTER.subject = sel.value;

    var q = CASE_FILTER.q.toLowerCase();
    var rows = (DATA.case_laws || []).filter(function (r) {
      if (CASE_FILTER.subject && sText(r.subject) !== CASE_FILTER.subject) return false;
      if (q && (sText(r.title) + ' ' + sText(r.subject) + ' ' + sText(r.citation)).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      return sText(b.year).localeCompare(sText(a.year)) || sText(a.title).localeCompare(sText(b.title));
    });
    renderList(el('listCases'), rows, function (row) {
      var div = h('div', 'list-row');
      var main = h('div', 'row-main');
      main.appendChild(h('div', 'row-title', sText(row.title) || '(no title)'));
      main.appendChild(h('div', 'row-meta',
        [sText(row.citation), sText(row.court), sText(row.subject), sText(row.year)].filter(Boolean).join(' • ') || 'No citation details'));
      main.appendChild(statusBadges(row));
      div.appendChild(main);
      var acts = h('div', 'row-actions');
      acts.appendChild(actionBtn('Edit', function () { openEditor('cases', row); }));
      acts.appendChild(togglePublishBtn('cases', row));
      acts.appendChild(deleteBtn('cases', row));
      div.appendChild(acts);
      return div;
    }, 'No case laws match. Add a real case — never invent citations or judgments.');
  }

  function renderPapers() {
    var years = [];
    (DATA.papers || []).forEach(function (r) {
      var y = sText(r.year);
      if (y && years.indexOf(y) === -1) years.push(y);
    });
    years.sort().reverse();
    var yearSel = el('paperYearFilter');
    yearSel.innerHTML = '';
    yearSel.appendChild(new Option('All years', ''));
    years.forEach(function (y) { yearSel.appendChild(new Option(y, y)); });
    if (years.indexOf(PAPER_FILTER.year) !== -1) yearSel.value = PAPER_FILTER.year;
    PAPER_FILTER.year = yearSel.value;

    var semSel = el('paperSemFilter');
    var semPrev = semSel.value;
    semSel.innerHTML = '';
    semSel.appendChild(new Option('All semesters', ''));
    (DATA.semesters || []).slice().sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); }).forEach(function (s) {
      semSel.appendChild(new Option(sText(s.label) || ('Semester ' + sText(s.number)), sText(s.id)));
    });
    if (PAPER_FILTER.semester) semSel.value = PAPER_FILTER.semester;
    else if (semPrev) semSel.value = semPrev;
    PAPER_FILTER.semester = semSel.value;

    var sq = PAPER_FILTER.subject.toLowerCase();
    var rows = (DATA.papers || []).filter(function (r) {
      if (PAPER_FILTER.year && sText(r.year) !== PAPER_FILTER.year) return false;
      if (PAPER_FILTER.semester && sText(r.semester_id) !== PAPER_FILTER.semester) return false;
      if (sq && (sText(r.subject) + ' ' + sText(r.title)).toLowerCase().indexOf(sq) === -1) return false;
      return true;
    }).sort(function (a, b) {
      return sText(b.year).localeCompare(sText(a.year)) || sText(a.title).localeCompare(sText(b.title));
    });
    renderList(el('listPapers'), rows, function (row) {
      var div = h('div', 'list-row');
      var main = h('div', 'row-main');
      main.appendChild(h('div', 'row-title', sText(row.title) || '(no title)'));
      main.appendChild(h('div', 'row-meta',
        [sText(row.year), semesterLabel(row.semester_id), sText(row.subject), sText(row.exam_type)].filter(Boolean).join(' • ') || 'No details'));
      main.appendChild(statusBadges(row));
      div.appendChild(main);
      var acts = h('div', 'row-actions');
      acts.appendChild(actionBtn('Edit', function () { openEditor('papers', row); }));
      acts.appendChild(togglePublishBtn('papers', row));
      acts.appendChild(deleteBtn('papers', row));
      div.appendChild(acts);
      return div;
    }, 'No question papers match. Add one with its Drive folder link.');
  }

  function renderExam() {
    var map = settingsMap();
    var input = el('examDateInput');
    var stored = sText(map.exam_date);
    if (document.activeElement !== input) input.value = stored.slice(0, 10);
    var note = el('examDateNote');
    if (stored) {
      var ms = sTime(stored);
      note.textContent = isNaN(ms)
        ? 'Stored exam date "' + stored + '" could not be read as a date — the countdown is hidden. Save a valid date or clear it.'
        : 'Countdown is live on the public site: ' + Math.max(0, Math.floor((ms - Date.now()) / 86400000)) + ' day(s) to go (from today). Clear the date and save to hide the countdown.';
    } else {
      note.textContent = 'No exam date is set — no countdown is shown on the public site.';
    }
    var rows = (DATA.exam_prep || []).slice().sort(function (a, b) {
      return Number(a.order || 0) - Number(b.order || 0);
    });
    renderList(el('listExam'), rows, function (row) {
      var div = h('div', 'list-row');
      var main = h('div', 'row-main');
      main.appendChild(h('div', 'row-title', sText(row.title) || '(no title)'));
      main.appendChild(h('div', 'row-meta', sText(row.description) || 'No description'));
      var badges = h('span');
      if (sText(row.category)) badges.appendChild(h('span', 'badge', sText(row.category)));
      if (!sBool(row.enabled)) badges.appendChild(h('span', 'badge warn', 'Disabled'));
      if (!isHttps(row.drive_link)) badges.appendChild(h('span', 'badge warn', 'No Drive link'));
      main.appendChild(badges);
      div.appendChild(main);
      var acts = h('div', 'row-actions');
      acts.appendChild(actionBtn('Edit', function () { openEditor('exam', row); }));
      acts.appendChild(toggleEnabledBtn('exam', row));
      acts.appendChild(deleteBtn('exam', row));
      div.appendChild(acts);
      return div;
    }, 'No exam resources yet.');
  }

  function verifyBtn(row) {
    var st = sText(row.status).toLowerCase();
    if (st === 'verified' || st === 'published') return null;
    return actionBtn('Verify', function () {
      saveRow('pending', { id: row.id, status: 'Verified' }, true, function (ok) {
        toast(ok ? 'Verified. It can now be published.' : 'Change sent — the Sheet can take a moment to update. Refresh in a few seconds if the list looks stale.', false);
      });
    });
  }
  function publishPendingBtn(row) {
    var st = sText(row.status).toLowerCase();
    if (st === 'published') {
      return actionBtn('Unpublish', function () {
        saveRow('pending', { id: row.id, status: 'Verified' }, true, function (ok) {
          toast(ok ? 'Unpublished — back to Verified.' : 'Change sent — the Sheet can take a moment to update. Refresh in a few seconds if the list looks stale.', false);
        });
      });
    }
    return actionBtn('Publish', function () {
      if (sText(row.status).toLowerCase() !== 'verified') {
        toast('Only Verified content can be published. Verify this entry first — Draft, Pending, and Demo entries are never shown as official.', true);
        return;
      }
      saveRow('pending', { id: row.id, status: 'Published' }, true, function (ok) {
        toast(ok ? 'Published.' : 'Change sent — the Sheet can take a moment to update. Refresh in a few seconds if the list looks stale.', false);
      });
    });
  }
  function renderPending() {
    var order = { pending: 0, draft: 1, demo: 2, verified: 3, published: 4, archived: 5 };
    var rows = (DATA.pending || []).slice().sort(function (a, b) {
      var oa = order[sText(a.status).toLowerCase()], ob = order[sText(b.status).toLowerCase()];
      oa = oa === undefined ? 9 : oa; ob = ob === undefined ? 9 : ob;
      if (oa !== ob) return oa - ob;
      return sTime(b.created_at) - sTime(a.created_at);
    });
    renderList(el('listPending'), rows, function (row) {
      var div = h('div', 'list-row');
      var main = h('div', 'row-main');
      main.appendChild(h('div', 'row-title', sText(row.title) || '(no title)'));
      var meta = [];
      if (sText(row.reason)) meta.push('Why unverified: ' + sText(row.reason));
      if (row.created_at) meta.push('Added ' + fmtDT(row.created_at));
      main.appendChild(h('div', 'row-meta', meta.join(' • ') || sText(row.description) || 'No details'));
      if (sText(row.description) && meta.length) main.appendChild(h('div', 'row-meta', sText(row.description)));
      main.appendChild(statusBadges(row));
      div.appendChild(main);
      var acts = h('div', 'row-actions');
      acts.appendChild(actionBtn('Edit', function () { openEditor('pending', row); }));
      var vb = verifyBtn(row);
      if (vb) acts.appendChild(vb);
      acts.appendChild(publishPendingBtn(row));
      acts.appendChild(deleteBtn('pending', row));
      div.appendChild(acts);
      return div;
    }, 'Nothing pending. Unverified material added here waits for review before it can go public.');
  }

  function renderContacts() {
    var rows = (DATA.contacts || []).slice().sort(function (a, b) {
      return Number(a.order || 0) - Number(b.order || 0);
    });
    renderList(el('listContacts'), rows, function (row) {
      var div = h('div', 'list-row');
      var main = h('div', 'row-main');
      main.appendChild(h('div', 'row-title', sText(row.label) || '(no label)'));
      var dest = sText(row.destination);
      main.appendChild(h('div', 'row-meta', dest || 'No destination — shows as "Not configured yet"'));
      var badges = h('span');
      if (sText(row.kind)) badges.appendChild(h('span', 'badge', sText(row.kind)));
      badges.appendChild(h('span', 'badge' + (sBool(row.enabled) && dest ? ' ok' : ' warn'),
        sBool(row.enabled) ? (dest ? 'Live' : 'Enabled, no destination') : 'Disabled'));
      main.appendChild(badges);
      div.appendChild(main);
      var acts = h('div', 'row-actions');
      acts.appendChild(actionBtn('Edit', function () { openEditor('contacts', row); }));
      acts.appendChild(toggleEnabledBtn('contacts', row));
      acts.appendChild(deleteBtn('contacts', row, row.label));
      div.appendChild(acts);
      return div;
    }, 'No contact cards yet.');
  }

  /* ---------- appearance & website settings forms ---------- */
  function settingsField(labelText, input, helpText) {
    var label = h('label', 'field');
    label.appendChild(h('span', null, labelText));
    label.appendChild(input);
    if (helpText) label.appendChild(h('span', 'help', helpText));
    return label;
  }
  function settingsCheck(labelText, checked) {
    var label = h('label', 'field check');
    var input = h('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    label.appendChild(input);
    label.appendChild(h('span', null, labelText));
    return { label: label, input: input };
  }
  function isMMDD(v) {
    return /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(sText(v));
  }
  function isHexColor(v) {
    return /^#[0-9a-fA-F]{6}$/.test(sText(v));
  }
  function festivalDefaults() {
    var list = (SITE_DEFAULTS && SITE_DEFAULTS.theme && SITE_DEFAULTS.theme.festivals) || [];
    return list;
  }
  function renderAppearance() {
    var box = el('appearanceForm');
    box.innerHTML = '';
    var map = settingsMap();
    if (!SITE_DEFAULTS) {
      box.appendChild(h('p', 'sec-sub', 'The site defaults (data/site-config.json) could not be loaded. Refresh the page to try again — the form needs the colour allowlist and festival defaults.'));
      return;
    }
    var theme = SITE_DEFAULTS.theme || {};
    var colors = theme.colors || [];
    var card = h('div', 'card pad');

    var modeSel = h('select');
    [['dark', 'Dark'], ['light', 'Light']].forEach(function (o) {
      modeSel.appendChild(new Option(o[1], o[0]));
    });
    modeSel.value = (map.default_mode === 'light' || map.default_mode === 'dark') ? map.default_mode : (theme.defaultMode || 'dark');
    card.appendChild(settingsField('Default theme (dark / light)', modeSel, 'Visitors who never picked a theme see this. A visitor\'s own choice always wins.'));

    var colorSel = h('select');
    colors.forEach(function (c) {
      colorSel.appendChild(new Option(c.name + ' (' + c.id + ')', c.id));
    });
    var curColor = map.default_color || theme.defaultColor || 'emerald';
    colorSel.value = colors.some(function (c) { return c.id === curColor; }) ? curColor : (colors[0] ? colors[0].id : '');
    card.appendChild(settingsField('Default accent colour', colorSel, 'Only the colours in the site configuration can be chosen — no free-text colours.'));

    var auto = settingsCheck('Automatic festival themes (switch by date)', map.festival_auto !== '' && map.festival_auto !== undefined ? sBool(map.festival_auto) : theme.autoFestival !== false);
    card.appendChild(auto.label);

    card.appendChild(h('h2', null, 'Festival themes'));
    card.appendChild(h('p', 'sec-sub', 'Date ranges are month-day (MM-DD). Festival dates move every year — the defaults below are the corrected 2027 dates from the site configuration. Colours must be 6-digit hex (#rrggbb).'));
    var festInputs = {};
    festivalDefaults().forEach(function (f) {
      var row = h('div', 'fest-row');
      row.appendChild(h('div', 'fest-name', f.name));
      var start = h('input'); start.type = 'text'; start.placeholder = 'MM-DD';
      start.value = sText(map['festival_' + f.id + '_start']) || f.start || '';
      start.setAttribute('aria-label', f.name + ' start date');
      var end = h('input'); end.type = 'text'; end.placeholder = 'MM-DD';
      end.value = sText(map['festival_' + f.id + '_end']) || f.end || '';
      end.setAttribute('aria-label', f.name + ' end date');
      var acc = h('input'); acc.type = 'color';
      acc.value = isHexColor(map['festival_' + f.id + '_accent']) ? sText(map['festival_' + f.id + '_accent']) : (isHexColor(f.accent) ? f.accent : '#20E6A0');
      acc.setAttribute('aria-label', f.name + ' accent colour');
      var acc2 = h('input'); acc2.type = 'color';
      acc2.value = isHexColor(map['festival_' + f.id + '_accent2']) ? sText(map['festival_' + f.id + '_accent2']) : (isHexColor(f.accent2) ? f.accent2 : '#50F5B5');
      acc2.setAttribute('aria-label', f.name + ' second accent colour');
      row.appendChild(h('span', 'fest-lab', 'From')); row.appendChild(start);
      row.appendChild(h('span', 'fest-lab', 'To')); row.appendChild(end);
      row.appendChild(h('span', 'fest-lab', 'Colours')); row.appendChild(acc); row.appendChild(acc2);
      card.appendChild(row);
      festInputs[f.id] = { start: start, end: end, accent: acc, accent2: acc2 };
    });
    var err = h('p', 'form-error'); err.style.display = 'none';
    err.setAttribute('role', 'alert');
    card.appendChild(err);

    var actions = h('div', 'editor-actions');
    var save = h('button', 'btn', 'Save appearance');
    save.type = 'button';
    save.addEventListener('click', function () {
      err.style.display = 'none';
      var pairs = [
        { key: 'default_mode', value: modeSel.value },
        { key: 'default_color', value: colorSel.value },
        { key: 'festival_auto', value: auto.input.checked ? 'TRUE' : 'FALSE' }
      ];
      var bad = null;
      Object.keys(festInputs).forEach(function (id) {
        var fi = festInputs[id];
        if (!isMMDD(fi.start.value) || !isMMDD(fi.end.value)) bad = 'Festival dates must be MM-DD (for example 10-27). Check every festival row.';
        if (!isHexColor(fi.accent.value) || !isHexColor(fi.accent2.value)) bad = 'Festival colours must be 6-digit hex colours.';
        pairs.push({ key: 'festival_' + id + '_start', value: fi.start.value.trim() });
        pairs.push({ key: 'festival_' + id + '_end', value: fi.end.value.trim() });
        pairs.push({ key: 'festival_' + id + '_accent', value: fi.accent.value });
        pairs.push({ key: 'festival_' + id + '_accent2', value: fi.accent2.value });
      });
      if (bad) { err.textContent = bad; err.style.display = 'block'; return; }
      save.disabled = true; save.textContent = 'Saving…';
      saveSettings(pairs, function (ok) {
        save.disabled = false; save.textContent = 'Save appearance';
        toast(ok ? 'Appearance saved. It applies on the next public-site load.' : 'Change sent — the Sheet can take a moment to update. Refresh in a few seconds if the form looks stale.', false);
        renderCurrent();
      });
    });
    var reset = h('button', 'btn ghost', 'Reset to defaults');
    reset.type = 'button';
    reset.addEventListener('click', function () {
      confirmDialog('Reset the appearance to the site configuration defaults (dark mode, emerald, festival auto on, and the 2027 festival dates and colours)? This overwrites the Sheet values.', 'Reset', function () {
        var pairs = [
          { key: 'default_mode', value: theme.defaultMode || 'dark' },
          { key: 'default_color', value: theme.defaultColor || 'emerald' },
          { key: 'festival_auto', value: theme.autoFestival !== false ? 'TRUE' : 'FALSE' }
        ];
        festivalDefaults().forEach(function (f) {
          pairs.push({ key: 'festival_' + f.id + '_start', value: f.start || '' });
          pairs.push({ key: 'festival_' + f.id + '_end', value: f.end || '' });
          pairs.push({ key: 'festival_' + f.id + '_accent', value: f.accent || '' });
          pairs.push({ key: 'festival_' + f.id + '_accent2', value: f.accent2 || '' });
        });
        saveSettings(pairs, function (ok) {
          toast(ok ? 'Appearance reset to defaults.' : 'Change sent — the Sheet can take a moment to update. Refresh in a few seconds if the form looks stale.', false);
          renderCurrent();
        });
      });
    });
    var preview = h('a', 'btn ghost', 'Preview the public site ↗');
    preview.href = './index.html'; preview.target = '_blank'; preview.rel = 'noopener';
    actions.appendChild(save); actions.appendChild(reset); actions.appendChild(preview);
    card.appendChild(actions);
    box.appendChild(card);
  }

  var SECTION_DEFS = [
    ['today', "Today's Notes + Latest Updates"],
    ['semesters', 'Browse by Semester'],
    ['cases', 'Case Law Library'],
    ['papers', 'Previous Year Papers'],
    ['exam', 'Exam Preparation'],
    ['pending', 'Pending & Unverified'],
    ['contact', 'Contact & Feedback']
  ];
  function renderSettings() {
    var box = el('settingsForm');
    box.innerHTML = '';
    var map = settingsMap();
    if (!SITE_DEFAULTS) {
      box.appendChild(h('p', 'sec-sub', 'The site defaults (data/site-config.json) could not be loaded. Refresh the page to try again.'));
      return;
    }
    var site = SITE_DEFAULTS.site || {};
    var card = h('div', 'card pad');
    function textInput(key, fallback) {
      var input = h('input');
      input.type = 'text';
      input.value = sText(map[key]) || sText(fallback) || '';
      return input;
    }
    var titleIn = textInput('site_title', site.title);
    card.appendChild(settingsField('Website title', titleIn));
    var tagIn = textInput('site_tagline', site.tagline);
    card.appendChild(settingsField('Tagline (shown under the title)', tagIn));
    var welIn = textInput('welcome_title', site.welcomeTitle);
    card.appendChild(settingsField('Welcome banner title', welIn));
    var welSub = h('textarea');
    welSub.value = sText(map.welcome_subtitle) || sText(site.welcomeSubtitle) || '';
    card.appendChild(settingsField('Welcome banner subtitle', welSub));
    var footIn = textInput('footer_tagline', site.footerTagline);
    card.appendChild(settingsField('Footer tagline', footIn));
    var legalIn = h('textarea');
    legalIn.value = sText(map.footer_legal) || '';
    card.appendChild(settingsField('Copyright / disclaimer text', legalIn, 'Shown in the footer. Leave empty to use the default line about Drive storage.'));
    var driveIn = h('input');
    driveIn.type = 'url'; driveIn.setAttribute('inputmode', 'url');
    driveIn.value = sText(map.main_drive_folder) || sText(site.mainDriveFolder) || '';
    card.appendChild(settingsField('Main Google Drive folder link', driveIn, 'Must start with https://. Used by the "Open main Drive folder" button.'));

    var examIn = h('input');
    examIn.type = 'date';
    examIn.value = sText(map.exam_date).slice(0, 10);
    card.appendChild(settingsField('Exam date (shared with Exam Preparation)', examIn, 'Empty = no countdown on the public site.'));

    card.appendChild(h('h2', null, 'Homepage sections'));
    card.appendChild(h('p', 'sec-sub', 'Turn sections on or off. Hidden sections disappear from the public site (and from the chapter numbering). Section order stays in data/site-config.json.'));
    var vis = (SITE_DEFAULTS.sectionVisibility || {});
    var toggles = {};
    SECTION_DEFS.forEach(function (def) {
      var key = 'section_' + def[0] + '_enabled';
      var cur = map[key];
      var chk = settingsCheck(def[1], cur !== '' && cur !== undefined ? sBool(cur) : vis[def[0]] !== false);
      card.appendChild(chk.label);
      toggles[def[0]] = chk.input;
    });
    var err = h('p', 'form-error'); err.style.display = 'none';
    err.setAttribute('role', 'alert');
    card.appendChild(err);
    var actions = h('div', 'editor-actions');
    var save = h('button', 'btn', 'Save website settings');
    save.type = 'button';
    save.addEventListener('click', function () {
      err.style.display = 'none';
      if (sText(driveIn.value) && !isHttps(driveIn.value)) {
        err.textContent = 'The main Drive folder link must start with https://.';
        err.style.display = 'block';
        return;
      }
      var pairs = [
        { key: 'site_title', value: titleIn.value.trim() },
        { key: 'site_tagline', value: tagIn.value.trim() },
        { key: 'welcome_title', value: welIn.value.trim() },
        { key: 'welcome_subtitle', value: welSub.value.trim() },
        { key: 'footer_tagline', value: footIn.value.trim() },
        { key: 'footer_legal', value: legalIn.value.trim() },
        { key: 'main_drive_folder', value: driveIn.value.trim() },
        { key: 'exam_date', value: examIn.value }
      ];
      SECTION_DEFS.forEach(function (def) {
        pairs.push({ key: 'section_' + def[0] + '_enabled', value: toggles[def[0]].checked ? 'TRUE' : 'FALSE' });
      });
      save.disabled = true; save.textContent = 'Saving…';
      saveSettings(pairs, function (ok) {
        save.disabled = false; save.textContent = 'Save website settings';
        toast(ok ? 'Website settings saved. They apply on the next public-site load.' : 'Change sent — the Sheet can take a moment to update. Refresh in a few seconds if the form looks stale.', false);
        renderCurrent();
      });
    });
    actions.appendChild(save);
    card.appendChild(actions);
    box.appendChild(card);
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
    else if (CURRENT === 'cases') renderCases();
    else if (CURRENT === 'papers') renderPapers();
    else if (CURRENT === 'exam') renderExam();
    else if (CURRENT === 'pending') renderPending();
    else if (CURRENT === 'contacts') renderContacts();
    else if (CURRENT === 'appearance') renderAppearance();
    else if (CURRENT === 'settings') renderSettings();
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
      /* An explicit "None" option: papers may span semesters, and a
         new subject must not silently land in the first semester. */
      input.appendChild(new Option('— None —', ''));
      (DATA.semesters || []).forEach(function (s) {
        input.appendChild(new Option(sText(s.label) || ('Semester ' + sText(s.number)), sText(s.id)));
      });
      /* Only the subjects editor defaults to the semester currently
         shown in the Semester & Subjects view. */
      var semDefault = (EDIT && EDIT.moduleKey === 'subjects') ? el('semSelect').value : '';
      input.value = value || semDefault || '';
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
    /* Papers: the same title in a different year or for a different
       subject is legitimate — only warn on title + year + subject. */
    if (EDIT.moduleKey === 'papers') {
      var t = sText(obj.title).toLowerCase();
      var y = sText(obj.year).toLowerCase();
      var s = sText(obj.subject).toLowerCase();
      if (!t) return null;
      var dupPaper = (DATA[mod.tab] || []).some(function (r) {
        return sText(r.title).toLowerCase() === t &&
          sText(r.year).toLowerCase() === y &&
          sText(r.subject).toLowerCase() === s &&
          sText(r.id) !== sText(obj.id);
      });
      return dupPaper ? 'A paper with this title, year, and subject already exists. Save again to confirm it is not a duplicate.' : null;
    }
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
  /* Verification comparison: gviz returns booleans for TRUE/FALSE
     cells, while writes send the strings 'TRUE'/'FALSE', so a plain
     string comparison would report every enable/disable toggle as
     unconfirmed even though the write persisted. Compare
     boolean-aware, and case-insensitively otherwise. */
  function sameValue(a, b) {
    var x = sText(a), y = sText(b);
    if (x === y) return true;
    var bx = x.toLowerCase(), by = y.toLowerCase();
    if (bx === by) return true;
    var bools = ['true', 'false', '1', '0', 'yes', 'no'];
    if (bools.indexOf(bx) !== -1 && bools.indexOf(by) !== -1) return sBool(a) === sBool(b);
    return false;
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
            return sameValue(r[k], patch[k]);
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
      var prefixes = { 'daily-notes': 'note', 'announcements': 'ann', 'semesters': 'sem', 'subjects': 'subj', 'cases': 'case', 'papers': 'paper', 'exam': 'exam', 'pending': 'pending', 'contacts': 'contact' };
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
        /* The write was sent but the Sheet read-back lagged: the change
           almost always persisted. Say so plainly instead of crying
           failure, and keep the editor open so nothing is saved twice. */
        showEditorWarn('Saved, but the Sheet has not shown the change yet — it can lag a few seconds. Check the list before saving again; do not save twice.');
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
    if (EDIT.moduleKey === 'cases') {
      /* Mirror the public site's case detail view. */
      var cite = [sText(obj.citation), sText(obj.court), sText(obj.subject), sText(obj.year)].filter(Boolean).join(' • ');
      if (cite) card.appendChild(h('p', null, cite));
      if (sBool(obj.important)) card.appendChild(h('span', 'badge ok', 'Important'));
      var dl = h('dl', 'case-detail');
      [['Facts', obj.facts], ['Legal issues', obj.issues], ['Judgment', obj.judgment],
       ['Ratio decidendi', obj.ratio], ['Exam relevance', obj.exam_relevance]].forEach(function (pair) {
        if (!sText(pair[1])) return;
        dl.appendChild(h('dt', null, pair[0]));
        dl.appendChild(h('dd', null, sText(pair[1])));
      });
      card.appendChild(dl);
    } else if (EDIT.moduleKey === 'papers') {
      var pmeta = [sText(obj.year), semesterLabel(obj.semester_id), sText(obj.subject), sText(obj.exam_type)].filter(Boolean).join(' • ');
      if (pmeta) card.appendChild(h('p', null, pmeta));
    } else if (EDIT.moduleKey === 'pending') {
      if (sText(obj.status)) card.appendChild(h('span', 'badge warn', sText(obj.status)));
      if (sText(obj.reason)) card.appendChild(h('p', null, 'Why unverified: ' + sText(obj.reason)));
      card.appendChild(h('p', null, '⚠ This material has not been verified. It is raw or draft content and must not be treated as official or approved.'));
      if (obj.description) card.appendChild(h('p', null, sText(obj.description)));
    } else if (EDIT.moduleKey === 'contacts') {
      var dest = sText(obj.destination);
      var live = sBool(obj.enabled) && dest;
      card.appendChild(h('p', null, live ? 'Card is live with a destination link.' : 'Card appears greyed out with "Not configured yet."'));
    } else if (EDIT.moduleKey === 'exam') {
      if (sText(obj.category)) card.appendChild(h('span', 'badge', sText(obj.category)));
      if (obj.description) card.appendChild(h('p', null, sText(obj.description)));
    } else {
      var meta = [];
      if (obj.unit) meta.push(sText(obj.unit));
      if (obj.subject) meta.push(sText(obj.subject));
      if (sText(obj.status)) meta.push('Status: ' + sText(obj.status));
      if (obj.publish_at) meta.push('Publishes ' + fmtDT(obj.publish_at));
      if (obj.expires_at) meta.push('Expires ' + fmtDT(obj.expires_at));
      if (meta.length) card.appendChild(h('p', null, meta.join(' • ')));
      if (obj.description) card.appendChild(h('p', null, sText(obj.description)));
    }
    if (sText(obj.status) && EDIT.moduleKey !== 'pending') card.appendChild(h('p', null, 'Status: ' + sText(obj.status)));
    if (obj.drive_link || obj.destination) {
      var linkVal = obj.drive_link || obj.destination;
      var link = h('span', 'badge ok', isHttps(linkVal) ? 'Link: ' + sText(linkVal) : 'Link is not https:// — it will be rejected');
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
    /* Site defaults (colour allowlist, festival defaults, fallback
       text) for the Appearance and Website Settings forms. Loaded
       independently of the login so the forms are ready when needed. */
    fetch('./data/site-config.json').then(function (r) { return r.json(); }).then(function (cfg) {
      SITE_DEFAULTS = cfg || null;
      if (CURRENT === 'appearance' || CURRENT === 'settings') renderCurrent();
    }).catch(function () { SITE_DEFAULTS = null; });

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
        else if (q === 'cases') openEditor('cases', null);
        else if (q === 'papers') openEditor('papers', null);
        else if (q === 'exam') openEditor('exam', null);
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
    el('addCaseBtn').addEventListener('click', function () { openEditor('cases', null); });
    el('addPaperBtn').addEventListener('click', function () { openEditor('papers', null); });
    el('addExamBtn').addEventListener('click', function () { openEditor('exam', null); });
    el('addPendingBtn').addEventListener('click', function () { openEditor('pending', null); });
    el('addContactBtn').addEventListener('click', function () { openEditor('contacts', null); });
    el('caseSearch').addEventListener('input', function () {
      CASE_FILTER.q = el('caseSearch').value.trim();
      renderCases();
    });
    el('caseSubjectFilter').addEventListener('change', function () {
      CASE_FILTER.subject = el('caseSubjectFilter').value;
      renderCases();
    });
    el('paperYearFilter').addEventListener('change', function () {
      PAPER_FILTER.year = el('paperYearFilter').value;
      renderPapers();
    });
    el('paperSemFilter').addEventListener('change', function () {
      PAPER_FILTER.semester = el('paperSemFilter').value;
      renderPapers();
    });
    el('paperSubjectFilter').addEventListener('input', function () {
      PAPER_FILTER.subject = el('paperSubjectFilter').value.trim();
      renderPapers();
    });
    el('examDateSave').addEventListener('click', function () {
      var btn = el('examDateSave');
      var value = el('examDateInput').value;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      saveSetting('exam_date', value, function (ok) {
        btn.disabled = false;
        btn.textContent = 'Save exam date';
        toast(ok
          ? (value ? 'Exam date saved — the countdown is live.' : 'Exam date cleared — no countdown is shown.')
          : 'Change sent — the Sheet can take a moment to update. Refresh in a few seconds if the note looks stale.', false);
        renderCurrent();
      });
    });
    el('editorSave').addEventListener('click', saveEditor);
    el('editorPreviewBtn').addEventListener('click', previewEditor);
    el('editorCancel').addEventListener('click', closeEditor);
    el('editorDelete').addEventListener('click', function () {
      if (!EDIT || !EDIT.row) return;
      var mod = MODULES[EDIT.moduleKey];
      var label = sText(EDIT.row.title || EDIT.row.name || EDIT.row.label);
      confirmDialog('Delete "' + label + '"? This removes the catalogue entry only — it never deletes the Google Drive document.', 'Delete', function () {
        writeAndVerify('delete', mod.tab, { id: EDIT.row.id }, function (rows) {
          return !rows.some(function (r) { return sText(r.id) === sText(EDIT.row.id); });
        }).then(function (ok) {
          toast(ok ? 'Deleted.' : 'Delete sent — the Sheet can take a moment to update. Refresh in a few seconds if the entry still shows.', false);
          if (ok) closeEditor();
          renderCurrent();
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
