# LawVault v5 — Rollback to v4

If anything goes wrong with v5, the v4 site can be restored exactly.
Nothing in this rollback deletes anything: v5 stays recoverable too.

## What exists before v5 is published

1. **Local v4 source (untouched):** `~/workspace/llb-notes-site-v4/`
   — the exact files that were live as v4. The v5 build never wrote
   to this folder. Its contents: `index.html`, `assets/css/style.css`,
   `assets/js/app.js`, `assets/js/search.js`,
   `assets/images/logo.svg`, `assets/images/icon-192.png`,
   `assets/images/icon-512.png`, `data/site-config.json`,
   `data/content.json`, `sw.js`, `manifest.webmanifest`,
   `README.md`, `bot/`, `worker/`.
   Note: the `data/site-config.json` in that folder already contains
   the corrected 2027 festival dates (Holi Mar 21–23, Eid al-Fitr
   Mar 9–11, Onam Sep 10–13, Diwali Oct 27–31), so restoring it keeps
   that fix.
2. **GitHub branch `v4-backup`:** created from `main` immediately
   before the v5 publish (the parent agent creates this in GitHub).
   It holds the last live v4 commit, so the rollback can be done
   entirely in the browser, with no local files needed.

## The Google Sheet is additive — rollback does not touch it

v5's Sheet connection is configured only through
`data/sheets-config.json`. Rolling the site back to v4 removes that
file from the live site, and v4 ignores the Sheet entirely: it reads
only its local `data/content.json` and `data/site-config.json`. No
Sheet data is changed, deleted, or disconnected by a rollback, and
the Apps Script deployment is left running. If v5 is re-published
later, the Sheet and its contents are still there.

To stop the v5 site reading the Sheet WITHOUT rolling back, set
`enabled` to `false` in `data/sheets-config.json` and republish that
one file. The v5 site then uses its local JSON files only (which are
byte-identical to v4's), and the admin panel shows its "Not
connected" state.

## Rollback method A — from the GitHub branch (recommended)

1. On GitHub, open the `hliorex/llbvault` repository.
2. Go to the branch switcher (top-left, above the file list) and
   select `v4-backup`.
3. Click **"Compare"** (or open a pull request) from `v4-backup`
   into `main`, review that the diff is "v5 → v4", then merge.
   Alternatively, restore file-by-file from the `v4-backup` branch:
   open each file on `v4-backup`, copy its contents, and paste them
   into the same file on `main` via the web editor, committing each
   change. Also delete the v5-only files from `main`:
   `admin.html`, `assets/css/admin.css`, `assets/js/admin.js`,
   `data/sheets-config.json`, `SHEET_MODEL.md`, and the
   `apps-script/` folder (if it was published).
4. Wait for the GitHub Pages rebuild (usually under a minute), then
   open `https://hliorex.github.io/llbvault/` and confirm it shows
   the v4 site, and that `…/llbvault/admin.html` no longer loads.

## Rollback method B — from the local v4 folder

1. Re-upload every file from `~/workspace/llb-notes-site-v4/` to the
   repository root on `main`, replacing the v5 files. Then delete
   the v5-only files listed in method A, step 3. Do not upload
   `bot/` or `worker/` — they were never part of the live site.
2. Wait for the Pages rebuild and verify the live site as in
   method A.

## After a rollback

- The service worker cache name changes back to `lawvault-v4`, so
  browsers will re-fetch the v4 assets; the v5 cache is purged on
  the next visit. If the site still looks like v5, do a hard reload
  (or clear the site data for `hliorex.github.io`).
- Bookmarks, recent views, theme choices, and checklist state are
  unaffected: v4 and v5 use the same browser-storage keys on purpose.
  (The admin session key is v5-only and simply stops being used.)
- The v5 files remain in `~/workspace/llb-notes-site-v5/` and in the
  `main` branch history, so v5 can be re-published later once the
  problem is fixed. Do not delete the `v4-backup` branch until v5
  has been confirmed working on the live site.
