let CFG = null;
let activeSem = 'sem-1';
const PRESETS = {
  'Modern Kerala Editorial': '',
  'Minimal Dark': 'theme-minimal-dark',
  'High-Contrast Green': 'theme-high-contrast-green',
  'Monochrome Academic': 'theme-monochrome-academic'
};
function safeUrl(u) {
  if (typeof u !== 'string') return null;
  try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch (e) { return null; }
}
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function linkEl(text, href, label) {
  const safe = safeUrl(href);
  if (!safe) { const s = el('span', text + ' — link not configured'); s.className = 'small'; return s; }
  const a = document.createElement('a');
  a.textContent = text; a.href = safe; a.target = '_blank'; a.rel = 'noopener';
  a.setAttribute('aria-label', label || text);
  a.addEventListener('click', () => addRecent(text, safe));
  return a;
}
function getLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch (e) { return fallback; }
}
function setLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
function addRecent(title, href) {
  const list = getLS('lawvault_recent', []).filter(x => x.href !== href);
  list.unshift({ title, href }); setLS('lawvault_recent', list.slice(0, 8)); renderRecent();
}
function renderRecent() {
  const box = document.getElementById('recentList'); if (!box) return; box.innerHTML = '';
  const list = getLS('lawvault_recent', []);
  if (!list.length) { box.appendChild(el('p', 'No recently visited resources yet.', 'small')); return; }
  list.forEach(x => { const p = el('p'); p.appendChild(linkEl(x.title, x.href)); box.appendChild(p); });
}
function bookmarkBtn(id, title) {
  const b = document.createElement('button'); b.className = 'tab';
  const marks = getLS('lawvault_bookmarks', []);
  b.textContent = marks.includes(id) ? '★ Bookmarked' : '☆ Bookmark';
  b.addEventListener('click', () => {
    let m = getLS('lawvault_bookmarks', []);
    m = m.includes(id) ? m.filter(x => x !== id) : [...m, id];
    setLS('lawvault_bookmarks', m); renderBookmarks(); b.textContent = m.includes(id) ? '★ Bookmarked' : '☆ Bookmark';
  });
  b.setAttribute('aria-label', 'Bookmark ' + title);
  return b;
}
function renderBookmarks() {
  const box = document.getElementById('bookmarkList'); if (!box) return; box.innerHTML = '';
  const marks = getLS('lawvault_bookmarks', []);
  const all = [...(CFG.subjects || []), ...(CFG.caseLaws || []), ...(CFG.previousPapers || [])];
  const found = all.filter(x => marks.includes(x.id));
  if (!found.length) { box.appendChild(el('p', 'No bookmarks yet. Use the bookmark button on a card.', 'small')); return; }
  found.forEach(x => { const p = el('p'); p.appendChild(linkEl(x.title, x.link)); box.appendChild(p); });
}
function card(item, actionLabel) {
  const d = el('div', null, 'card reveal in');
  d.appendChild(el('div', null, 'green'));
  if (item.demo) d.appendChild(el('span', 'DEMO', 'pill'));
  if (item.status) d.appendChild(el('span', ' ' + item.status, 'pill'));
  d.appendChild(el('h3', item.title));
  if (item.description) d.appendChild(el('p', item.description));
  const meta = [item.paper || item.subject || '', item.unit || '', item.date || item.year || ''].filter(Boolean).join(' · ');
  if (meta) d.appendChild(el('p', meta, 'meta'));
  const actions = el('p');
  if (item.link) actions.appendChild(linkEl(actionLabel || 'Open in Google Drive', item.link, actionLabel + ': ' + item.title));
  d.appendChild(actions);
  d.appendChild(bookmarkBtn(item.id, item.title));
  return d;
}
function renderToday() {
  const box = document.getElementById('todayList'); if (!box) return; box.innerHTML = '';
  const t = CFG.todayNotes || {};
  if (!t.enabled) { box.appendChild(el('p', 'Today\'s Note is currently disabled.', 'empty')); return; }
  const now = Date.now(); const hours = t.expiryHours || 24;
  const items = (t.items || []).filter(x => x.visible !== false).filter(x => {
    if (!x.publishedAt) return true;
    return now <= new Date(x.publishedAt).getTime() + hours * 3600000;
  });
  if (!items.length) {
    box.appendChild(el('p', 'No note is scheduled for today. Check Semester Notes for the full library.', 'empty'));
    return;
  }
  items.forEach(x => box.appendChild(card(x, 'Open Notes')));
}
function renderSemesters() {
  const tabs = document.getElementById('semTabs'); const box = document.getElementById('semList');
  if (!tabs || !box) return; tabs.innerHTML = ''; box.innerHTML = '';
  (CFG.semesters || []).filter(s => s.visible !== false).forEach(s => {
    const b = el('button', s.label, 'tab' + (s.id === activeSem ? ' active' : ''));
    b.setAttribute('aria-pressed', s.id === activeSem ? 'true' : 'false');
    b.addEventListener('click', () => { activeSem = s.id; renderSemesters(); });
    tabs.appendChild(b);
  });
  const sem = (CFG.semesters || []).find(s => s.id === activeSem);
  if (sem && sem.featured) box.appendChild(el('p', 'Featured semester', 'pill'));
  const items = (CFG.subjects || []).filter(x => x.semesterId === activeSem && x.visible !== false);
  if (!items.length) { box.appendChild(el('p', 'Not configured yet. No subjects have been configured for this semester.', 'empty')); return; }
  items.forEach(x => box.appendChild(card(x, 'Open Folder / Note')));
}
function renderCases() {
  const box = document.getElementById('caseList'); if (!box) return; box.innerHTML = '';
  const q = (document.getElementById('caseSearch')?.value || '').toLowerCase();
  const subj = document.getElementById('caseSubject')?.value || '';
  const items = (CFG.caseLaws || []).filter(x => x.visible !== false)
    .filter(x => !q || (x.title + ' ' + (x.subject || '')).toLowerCase().includes(q))
    .filter(x => !subj || x.subject === subj);
  if (!items.length) { box.appendChild(el('p', 'No case laws match, or none are configured yet.', 'empty')); return; }
  items.forEach(x => {
    const d = el('details');
    const s = document.createElement('summary'); s.textContent = x.title + (x.demo ? ' — DEMO' : ''); d.appendChild(s);
    d.appendChild(el('p', 'Court: ' + (x.court || 'Not provided')));
    d.appendChild(el('p', 'Citation / year: ' + (x.citation || 'Not provided') + ' · ' + (x.year || '')));
    d.appendChild(el('p', 'Facts: ' + (x.facts || 'Not provided')));
    d.appendChild(el('p', 'Issues: ' + (x.issues || 'Not provided')));
    d.appendChild(el('p', 'Judgment: ' + (x.judgment || 'Not provided')));
    d.appendChild(el('p', 'Ratio: ' + (x.ratio || 'Not provided')));
    d.appendChild(el('p', 'Importance: ' + (x.importance || 'Not provided')));
    if (x.link) { const p = el('p'); p.appendChild(linkEl('Open source in Google Drive', x.link)); d.appendChild(p); }
    box.appendChild(d);
  });
}
function renderPapers() {
  const box = document.getElementById('paperList'); if (!box) return; box.innerHTML = '';
  const q = (document.getElementById('paperSearch')?.value || '').toLowerCase();
  const items = (CFG.previousPapers || []).filter(x => x.visible !== false)
    .filter(x => !q || (x.title + ' ' + (x.subject || '') + ' ' + (x.year || '')).toLowerCase().includes(q));
  if (!items.length) { box.appendChild(el('p', 'No previous papers are configured yet. No years or counts are claimed here.', 'empty')); return; }
  items.forEach(x => box.appendChild(card(x, 'Open Folder')));
}
function renderExam() {
  const box = document.getElementById('examList'); if (!box) return; box.innerHTML = '';
  const e = CFG.examPreparation || {};
  if (!e.enabled) { box.appendChild(el('p', 'Exam Preparation is currently disabled.', 'empty')); return; }
  if (e.examDate) box.appendChild(el('p', 'Exam date configured: ' + e.examDate));
  else box.appendChild(el('p', 'No exam date is set, so no countdown is shown.', 'small'));
  (e.cards || []).filter(x => x.visible !== false).forEach(x => box.appendChild(card(x, 'Open Folder')));
  const cl = document.getElementById('checklist'); if (cl) {
    cl.innerHTML = '';
    const done = getLS('lawvault_checklist', []);
    (e.checklist || []).forEach(item => {
      const lab = document.createElement('label'); lab.style.display = 'block';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = done.includes(item.id);
      cb.addEventListener('change', () => {
        let d = getLS('lawvault_checklist', []);
        d = cb.checked ? [...new Set([...d, item.id])] : d.filter(x => x !== item.id);
        setLS('lawvault_checklist', d);
      });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(' ' + item.label)); cl.appendChild(lab);
    });
    cl.appendChild(el('p', e.checklistNote || '', 'small'));
  }
}
function renderPending() {
  const box = document.getElementById('pendingList'); if (!box) return; box.innerHTML = '';
  const p = CFG.pendingContent || {};
  if (!p.enabled) { box.appendChild(el('p', 'Pending / Unverified content is currently disabled.', 'empty')); return; }
  box.appendChild(el('p', 'Warning: material in this section has not been verified. It is not official or approved.', 'warning'));
  (p.entries || []).filter(x => x.visible !== false).forEach(x => box.appendChild(card(x, 'Open Folder / File')));
}
function renderContacts() {
  const box = document.getElementById('contactList'); if (!box) return; box.innerHTML = '';
  (CFG.contacts || []).filter(x => x.visible !== false).forEach(x => {
    const d = el('div', null, 'card reveal in');
    d.appendChild(el('h3', x.title));
    d.appendChild(el('p', x.description || ''));
    if (x.enabled && safeUrl(x.destination)) {
      const p = el('p'); p.appendChild(linkEl('Open destination', x.destination)); d.appendChild(p);
    } else {
      d.appendChild(el('p', x.placeholder || 'Not configured yet.', 'small'));
      const b = el('button', 'Not configured', 'tab'); b.setAttribute('aria-disabled', 'true'); d.appendChild(b);
    }
    box.appendChild(d);
  });
}
function renderAnnouncements() {
  const box = document.getElementById('announceBar'); if (!box) return;
  const items = (CFG.announcements || []).filter(x => x.visible !== false);
  if (!items.length) { box.style.display = 'none'; return; }
  box.style.display = 'block'; box.textContent = items.map(x => x.title).join(' · ');
  document.getElementById('announceDot').textContent = String(items.length);
}
function renderSearch() {
  const box = document.getElementById('searchResults'); if (!box) return; box.innerHTML = '';
  const q = (document.getElementById('globalSearch')?.value || '').trim().toLowerCase();
  if (q.length < 2) { box.appendChild(el('p', 'Type at least 2 characters to search LawVault metadata.', 'small')); return; }
  const all = [
    ...(CFG.subjects || []).map(x => ({ ...x, kind: 'Semester Note' })),
    ...(CFG.caseLaws || []).map(x => ({ ...x, kind: 'Case Law' })),
    ...(CFG.previousPapers || []).map(x => ({ ...x, kind: 'Previous Paper' })),
    ...((CFG.examPreparation && CFG.examPreparation.cards) || []).map(x => ({ ...x, kind: 'Exam Prep' }))
  ].filter(x => x.visible !== false);
  const found = all.filter(x => (x.title + ' ' + (x.description || '') + ' ' + (x.subject || '') + ' ' + (x.paper || '')).toLowerCase().includes(q));
  if (!found.length) { box.appendChild(el('p', 'No results in LawVault metadata for that search.', 'empty')); return; }
  found.forEach(x => {
    const p = el('p'); p.appendChild(document.createTextNode(x.kind + ': '));
    p.appendChild(linkEl(x.title, x.link)); box.appendChild(p);
  });
}
function applySections() {
  const order = CFG.sectionOrder || [];
  const map = { today: 'sec-today', semesters: 'sec-semesters', cases: 'sec-cases', papers: 'sec-papers', exam: 'sec-exam', pending: 'sec-pending', contact: 'sec-contact' };
  const vis = CFG.sectionVisibility || {};
  const parent = document.getElementById('sections');
  order.forEach(key => {
    const sec = document.getElementById(map[key]); if (!sec) return;
    sec.style.display = vis[key] === false ? 'none' : '';
    parent.appendChild(sec);
  });
  Object.keys(map).forEach(key => { if (vis[key] === false) { const s = document.getElementById(map[key]); if (s) s.style.display = 'none'; } });
}
async function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('mainNav').classList.toggle('open'));
  document.querySelectorAll('#mainNav a').forEach(a => a.addEventListener('click', () => {
    document.querySelectorAll('#mainNav a').forEach(x => x.classList.remove('active'));
    a.classList.add('active'); document.getElementById('mainNav').classList.remove('open');
  }));
  try { const r = await fetch('./config.json'); CFG = await r.json(); } catch (e) {
    document.getElementById('todayList').textContent = 'Configuration could not be loaded. Check that config.json is next to index.html.';
    return;
  }
  const preset = PRESETS[CFG.theme && CFG.theme.preset] !== undefined ? CFG.theme.preset : 'Modern Kerala Editorial';
  document.body.className = PRESETS[preset] || '';
  document.getElementById('themeSelect').value = preset;
  document.getElementById('themeSelect').addEventListener('change', (e) => {
    const v = PRESETS[e.target.value] !== undefined ? e.target.value : 'Modern Kerala Editorial';
    document.body.className = PRESETS[v] || '';
  });
  document.getElementById('heroTitle').textContent = 'Welcome to ' + (CFG.site.wordmark || 'LawVault');
  document.getElementById('heroSub').textContent = CFG.site.subtitle || '';
  document.getElementById('heroTag').textContent = CFG.site.tagline || '';
  document.getElementById('heroQuote').textContent = '“' + (CFG.site.quote || '') + '”';
  document.getElementById('heroQuoteBy').textContent = CFG.site.quoteAttribution || '';
  const mainLink = document.getElementById('mainDriveLink');
  if (safeUrl(CFG.site.mainDriveFolder)) { mainLink.href = CFG.site.mainDriveFolder; mainLink.textContent = CFG.site.mainDriveFolderLabel || 'Open main Drive folder'; }
  else { mainLink.textContent = 'Main Drive folder link not configured'; mainLink.removeAttribute('href'); }
  document.getElementById('searchNote').textContent = CFG.site.searchNote || '';
  renderAnnouncements(); renderToday(); renderSemesters(); renderCases(); renderPapers(); renderExam(); renderPending(); renderContacts(); renderRecent(); renderBookmarks(); applySections();
  document.getElementById('globalSearch').addEventListener('input', renderSearch);
  document.getElementById('caseSearch').addEventListener('input', renderCases);
  document.getElementById('caseSubject').addEventListener('change', renderCases);
  document.getElementById('paperSearch').addEventListener('input', renderPapers);
  renderSearch();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) en.target.classList.add('in'); }), { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(n => io.observe(n));
  } else { document.querySelectorAll('.reveal').forEach(n => n.classList.add('in')); }
}
document.addEventListener('DOMContentLoaded', init);
