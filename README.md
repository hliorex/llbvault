# LawVault v5 — LLB Class Knowledge Library

v5 builds on v4: the same editorial, motion-led public site (premium
serif display type, masked headline reveals, chapter-style sections,
scrolling header zoom, self-drawing scales illustration, marquee
strip — all vanilla CSS/JS, no libraries, fast on Android phones),
plus a web **Admin Panel** and **Google Sheets as the database**.

Notes themselves stay on Google Drive; the Sheet stores only titles,
descriptions, metadata, and Drive links. Hosted free on GitHub Pages.
No dedicated database server, no Drive API.

## Architecture

```
Public site (index.html + assets/js/app.js)
  reads content from ──► Google Sheet (gviz, read-only, no login)
  falls back to ───────► data/content.json + data/site-config.json
                         (local files, byte-identical to v4)

Admin panel (admin.html + assets/js/admin.js)
  reads the Sheet ─────► gviz, read-only
  writes ──────────────► Apps Script web app (doPost), which checks
                         the admin credentials server-side
                         (Script Properties) before writing

Apps Script (apps-script/Code.gs, attached to the Sheet)
  owns ────────────────► tab creation, seeding, validation,
                         credential checks, activity logging
```

- The public site never needs a login, and readers never see the
  admin panel: `admin.html` is not linked from the public site's
  navigation. It is reachable by direct URL only.
- No Google login is needed to edit: the admin logs in with an
  administrative code and password, checked by the Apps Script.
- No source-code change is needed to change content: edits in the
  panel save to the Sheet, and the public site reads the Sheet on
  every load.
- If the Sheet is unreachable, empty, or disabled, the public site
  falls back silently to its local JSON files, tab by tab — the site
  always renders.

## What is real vs placeholder

**Real content (works today):**

- Semester 1 subjects — the 5 detailed notes, each opening its Google Doc.
- "Open main Drive folder" — the configured public Drive folder.

**Honest empty/demo states (nothing invented):**

- Today's Notes: empty until the administrator schedules items.
- Latest Updates: empty until the administrator adds entries.
- Semesters 2–7: "Not configured yet".
- Case Laws / Previous Papers / Pending: one entry each, clearly labelled
  DEMO, to be replaced with real data.
- Exam Preparation: cards link to the main Drive folder; no countdown is
  shown because no exam date is set.
- Contact cards: all disabled until real destinations are configured.

## Admin panel — Phase 1 (this build)

Fully working: login, dashboard (counts, today's notes, active
announcements, pending count, recently modified, missing/bad links,
quick actions), Daily Notes (schedule, 24h expiry, Important flag),
Announcements (badges, pin, schedule, expiry), Semesters & Subjects,
and the Activity Log (read-only).

Present in the navigation but honestly marked "coming in the next
phase" (no faked functionality): Case Laws, Question Papers, Exam
Preparation, Pending Content, Contact & Feedback, Appearance,
Website Settings. Their Sheet tabs already exist, and the public site
already reads them — entries added directly in the Sheet (following
`SHEET_MODEL.md`) appear on the site.

## Setup (owner steps)

1. Create the Google Sheet and deploy the Apps Script — exact steps
   in `apps-script/SETUP.md`. Credentials go ONLY into the script's
   Script Properties (`ADMIN_CODE`, `ADMIN_PASS_HASH`) — never into
   code, the Sheet, or the website.
2. Share the Sheet "Anyone with the link can view" (Viewer, not
   Editor).
3. Fill in `data/sheets-config.json`: `sheetId`, `appsScriptUrl`,
   `enabled: true`. Publish that file. Nothing else needs changing.
4. Open `admin.html` on the live site and log in.

The Sheet's tabs, columns, and value formats are documented in
`SHEET_MODEL.md`. The script's `setupSheets()` creates and seeds them
(idempotent — safe to run twice).

## Publish to GitHub Pages (beginner steps)

The live site is the `hliorex/llbvault` repository, branch `main`,
folder `/ (root)`. To publish v5:

1. Before publishing, the v4 site must be backed up — see
   `ROLLBACK.md` (a `v4-backup` branch in GitHub plus the untouched
   local folder `~/workspace/llb-notes-site-v4/`).
2. Upload this folder's contents to the repository root, replacing
   `index.html`, `assets/`, `data/`, `sw.js`, `manifest.webmanifest`,
   and `README.md`, and adding `admin.html`, `SHEET_MODEL.md`,
   and `ROLLBACK.md`. (The `bot/` and `worker/` folders are skeletons
   only and are not published to the live site. The `apps-script/`
   folder is documentation + backend source for the owner's Google
   account; it contains no secrets and may be published or kept local
   — the live site does not load it.)
3. Wait for the GitHub Pages rebuild, then open
   `https://hliorex.github.io/llbvault/` and check the banner,
   Today's Notes, Semester 1, search, and the theme switcher. Then
   open `…/llbvault/admin.html` and check the login / "Not connected"
   state (it shows "Not connected" until `sheets-config.json` is
   filled in).

All internal links are relative (`./assets/...`, `./data/...`), so the
site works under the `/llbvault/` subpath. No build step is needed.

## Editing content

- **With the Sheet connected:** use the admin panel. Changes appear
  on the public site on the next load — no republishing needed.
- **Without the Sheet (fallback):** edit `data/site-config.json`
  (site name, welcome text, navigation, theme colours, festival date
  ranges, section order and visibility) and `data/content.json`
  (today's notes, updates, semesters, subjects, case laws, papers,
  exam cards, pending entries, contacts) in GitHub's web editor,
  commit, and the site updates after the Pages rebuild.

Never put secrets, tokens, or passwords in these files — they are
public.

## Settings the administrator must configure

1. **Festival dates** (`data/site-config.json` → `theme.festivals`):
   Diwali, Holi, Onam, Eid al-Fitr (and Pongal) move every year — confirm
   the ranges each year. Wrong dates only affect the automatic theme.
   The corrected 2027 dates are already in this file.
2. **Today's Notes**: add via the admin panel (or `todayNotes.items`
   in the fallback JSON). Items expire 24 hours after publishing
   (Asia/Kolkata) and hide automatically.
3. **Case laws / papers / pending**: replace the DEMO entries with real
   ones (or delete them). Never invent citations, years, or counts.
4. **Exam date** (`exam_date` in the Sheet's `settings` tab, or
   `examPreparation.examDate` in the fallback JSON, e.g. `"2027-01-15"`):
   only then does the countdown appear.
5. **Contacts**: set a destination (must start with `https://`) and
   enable the card — via the Sheet's `contacts` tab for now (panel
   module in the next phase).
6. **Telegram bot** (later): needs a bot token, the owner's Telegram user
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
- The admin code + password is a shared secret checked by a script —
  a soft lock, sized for a class library. The Sheet's version history
  and the `activity_log` tab can undo and trace changes. Do not reuse
  a password that protects anything else.
