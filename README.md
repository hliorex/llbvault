# LawVault v4 — LLB Class Knowledge Library

An editorial, motion-led redesign of the LawVault site: premium serif
display type, masked headline reveals, chapter-style sections, a
scrolling header zoom, a self-drawing scales illustration, and a
marquee strip — all vanilla CSS/JS, no libraries, fast on Android
phones. Notes themselves stay on Google Drive; this site is the index
and navigation layer. Hosted free on GitHub Pages. No database, no
Drive API, no server.

v4 keeps everything v3 had: the same content, the same theme system
(dark/light, 5 colours, automatic festival themes), the same PWA
manifest/icons/service worker, the same search, bookmarks, and
checklist behaviour. Bookmarks, recent views, theme choices, and
checklist state carry over from v3 because the browser-storage keys
are unchanged.

## Motion and accessibility

- Headlines reveal word-by-word through overflow masks; cards reveal
  with a stagger as they scroll into view (IntersectionObserver).
- The welcome banner artwork zooms subtly on scroll; a scroll-progress
  bar runs along the top of the header.
- A scales-of-justice line illustration draws itself on first view.
- A slow marquee strip runs between the banner and the content.
- `prefers-reduced-motion` disables all of the above: everything is
  static and fully readable. On phones, motion is lighter and the
  parallax is off.
- Progressive enhancement: every hiding effect is gated behind a `js`
  class added by the script, so if JavaScript fails, headings and
  content stay visible.

## What is real vs placeholder

**Real content (works today):**

- Semester 1 subjects — the 5 detailed notes, each opening its Google Doc.
- "Open main Drive folder" — the configured public Drive folder.

**Honest empty/demo states (nothing invented):**

- Today's Notes: empty until the administrator schedules items
  (`data/content.json` → `todayNotes.items`).
- Latest Updates: empty until the administrator adds entries.
- Semesters 2–7: "Not configured yet".
- Case Laws / Previous Papers / Pending: one entry each, clearly labelled
  DEMO, to be replaced with real data.
- Exam Preparation: cards link to the main Drive folder; no countdown is
  shown because no exam date is set.
- Contact cards: all disabled until real destinations are configured.

## Publish to GitHub Pages (beginner steps)

The live site is the `hliorex/llbvault` repository, branch `main`,
folder `/ (root)`. To publish v4:

1. Before publishing, the v3 site must be backed up — see
   `ROLLBACK.md` (a `v3-backup` branch in GitHub plus the untouched
   local folder `~/workspace/llb-notes-site-v3/`).
2. Upload this folder's contents to the repository root, replacing
   `index.html`, `assets/`, `data/`, `sw.js`, `manifest.webmanifest`,
   and `README.md`. (The `bot/` and `worker/` folders are skeletons
   only and are not published to the live site.)
3. Wait for the GitHub Pages rebuild, then open
   `https://hliorex.github.io/llbvault/` and check the banner,
   Today's Notes, Semester 1, search, and the theme switcher.

All internal links are relative (`./assets/...`, `./data/...`), so the
site works under the `/llbvault/` subpath. No build step is needed.

## Editing content without touching code

Everything the site shows comes from two files:

- `data/site-config.json` — site name, welcome text, navigation, theme
  colours, festival date ranges, section order and visibility.
- `data/content.json` — today's notes, updates, semesters, subjects,
  case laws, papers, exam cards, pending entries, contacts.

Edit them in GitHub's web editor, commit, and the site updates after the
Pages rebuild. Never put secrets, tokens, or passwords in these files —
they are public.

## Settings the administrator must configure

1. **Festival dates** (`data/site-config.json` → `theme.festivals`):
   Diwali, Holi, Onam, Eid al-Fitr (and Pongal) move every year — confirm
   the ranges each year. Wrong dates only affect the automatic theme.
   The corrected 2027 dates are already in this file.
2. **Today's Notes** (`data/content.json` → `todayNotes.items`): add
   `{ id, title, description, link, publishedAt }`. Items expire 24 hours
   after `publishedAt` (Asia/Kolkata) and hide automatically.
3. **Latest Updates** (`data/content.json` → `latestUpdates`): add
   `{ id, title, description, publishedAt, important }`.
4. **Semesters & subjects**: add subjects under `subjects` with the right
   `semesterId`, a title, and an `https://` Drive link.
5. **Case laws / papers / pending**: replace the DEMO entries with real
   ones (or delete them). Never invent citations, years, or counts.
6. **Exam date** (`examPreparation.examDate`, e.g. `"2027-01-15"`): only
   then does the countdown appear.
7. **Contacts**: set `destination` (must start with `https://`) and
   `enabled: true` for each card you want to show.
8. **Telegram bot** (later): needs a bot token, the owner's Telegram user
   id, a Cloudflare account, and a narrowly scoped GitHub token — all as
   Cloudflare secrets, never in chat or in this repository. See
   `bot/SETUP.md`.

## Install as an app

The site ships a PWA manifest and icons (`assets/images/icon-192.png`,
`icon-512.png`). On Android Chrome: open the site → menu → "Add to Home
screen" / "Install app". The LawVault logo will be used as the app icon.

## Notes on honesty

- Search covers LawVault metadata only, not filenames inside Drive
  (no Drive API). The site says this next to the search field.
- The revision checklist is stored in the browser only and does not sync.
- Pending content is always labelled and warning-styled, never presented
  as approved.
