/* LawVault v3 — metadata-only search (search.js).
   Searches LawVault configuration metadata only. It does NOT index
   filenames inside Google Drive, because LawVault does not use the
   Drive API. The site shows this limitation next to the search field. */
(function () {
  'use strict';

  function norm(s) {
    return String(s || '').toLowerCase();
  }

  function buildIndex(content) {
    const items = [];
    const push = (id, title, description, section, sectionLabel, link) => {
      if (!id || !title) return;
      items.push({
        id: String(id),
        title: String(title),
        description: String(description || ''),
        section: String(section || ''),
        sectionLabel: String(sectionLabel || ''),
        link: link || null,
      });
    };
    (content.subjects || []).forEach((s) => {
      if (s.visible === false) return;
      push(s.id, s.title, (s.paper || '') + ' ' + (s.unit || '') + ' ' + (s.description || ''),
        'semesters', 'Semester Notes', s.link);
    });
    (content.todayNotes && content.todayNotes.items || []).forEach((t) => {
      if (t.visible === false) return;
      push(t.id, t.title, t.description || '', 'today', "Today's Notes", t.link);
    });
    (content.caseLaws || []).forEach((c) => {
      if (c.visible === false) return;
      push(c.id, c.title, [c.subject, c.year, c.court, c.issues].filter(Boolean).join(' '),
        'cases', 'Case Laws', c.link);
    });
    (content.previousPapers || []).forEach((p) => {
      if (p.visible === false) return;
      push(p.id, p.title, [p.year, p.subject, p.examType].filter(Boolean).join(' '),
        'papers', 'Previous Papers', p.link);
    });
    ((content.examPreparation && content.examPreparation.cards) || []).forEach((e) => {
      if (e.visible === false) return;
      push(e.id, e.title, e.description || '', 'exam', 'Exam Prep', e.link);
    });
    ((content.pendingContent && content.pendingContent.entries) || []).forEach((p) => {
      if (p.visible === false) return;
      push(p.id, p.title, (p.status || '') + ' ' + (p.description || ''),
        'pending', 'Pending & Unverified', p.link);
    });
    (content.contacts || []).forEach((c) => {
      if (c.visible === false || c.enabled === false) return;
      push(c.id, c.title, c.description || '', 'contact', 'Contact', c.destination);
    });
    return items;
  }

  function score(item, q) {
    const t = norm(item.title);
    const d = norm(item.description);
    if (t.startsWith(q)) return 3;
    if (t.indexOf(q) !== -1) return 2;
    if (d.indexOf(q) !== -1) return 1;
    return 0;
  }

  function query(index, q, limit) {
    q = norm(q).trim();
    if (q.length < 2) return [];
    const scored = [];
    for (const item of index) {
      const s = score(item, q);
      if (s > 0) scored.push({ item: item, score: s });
    }
    scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
    const out = scored.map((x) => x.item);
    return typeof limit === 'number' ? out.slice(0, limit) : out;
  }

  window.LVSearch = {
    buildIndex: buildIndex,
    suggest: function (index, q) { return query(index, q, 6); },
    search: function (index, q) { return query(index, q); },
  };
})();
