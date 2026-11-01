# LawVault v3 — LLB Class Knowledge Library

A simple, fast, dark-emerald academic website for LLB class notes. Notes
themselves stay on Google Drive; this site is the index and navigation
layer. Hosted free on GitHub Pages. No database, no Drive API, no server.

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

1. Create a new public repository on GitHub (e.g. `llbvault`).
2. In this folder, run:
   ```
   git init
   git add .
   git commit -m "Publish LawVault v3"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/llbvault.git
   git push -u origin main
   ```
3. On GitHub: repository **Settings → Pages** → Source "Deploy from a
   branch", branch `main`, folder `/ (root)` → Save.
4. Wait a minute or two, then open
   `https://YOUR-USERNAME.github.io/llbvault/`.

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
