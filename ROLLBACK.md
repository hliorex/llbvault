# LawVault v4 — Rollback to v3

If anything goes wrong with v4, the v3 site can be restored exactly.
Nothing in this rollback deletes anything: v4 stays recoverable too.

## What exists before v4 is published

1. **Local v3 source (untouched):** `~/workspace/llb-notes-site-v3/`
   — the exact files that were live as v3. The v4 build never wrote
   to this folder. Its contents (verified byte-identical to the live
   v3 publish): `index.html`, `assets/css/style.css`,
   `assets/js/app.js`, `assets/js/search.js`,
   `assets/images/logo.svg`, `assets/images/icon-192.png`,
   `assets/images/icon-512.png`, `data/site-config.json`,
   `data/content.json`, `sw.js`, `manifest.webmanifest`,
   `README.md`, `bot/`, `worker/`.
   Note: the `data/site-config.json` in that folder already contains
   the corrected 2027 festival dates (Holi Mar 21–23, Eid al-Fitr
   Mar 9–11, Onam Sep 10–13, Diwali Oct 27–31), so restoring it keeps
   that fix.
2. **GitHub branch `v3-backup`:** created from `main` immediately
   before the v4 publish (the parent agent creates this in GitHub).
   It holds the last live v3 commit, so the rollback can be done
   entirely in the browser, with no local files needed.

## Rollback method A — from the GitHub branch (recommended)

1. On GitHub, open the `hliorex/llbvault` repository.
2. Go to the branch switcher (top-left, above the file list) and
   select `v3-backup`.
3. Click **"Compare"** (or open a pull request) from `v3-backup`
   into `main`, review that the diff is "v4 → v3", then merge.
   Alternatively, if the repository is only ever edited through the
   web UI, restore file-by-file from the `v3-backup` branch:
   open each file on `v3-backup`, copy its contents, and paste them
   into the same file on `main` via the web editor, committing each
   change.
4. Wait for the GitHub Pages rebuild (usually under a minute), then
   open `https://hliorex.github.io/llbvault/` and confirm it shows
   the v3 design ("Your LLB Study Space" banner without the chapter
   numbers, marquee, or scales illustration).

## Rollback method B — from the local v3 folder

1. Re-upload every file from `~/workspace/llb-notes-site-v3/` to the
   repository root on `main`, replacing the v4 files. The v3 file
   list is identical in layout to v4 (`index.html`, `assets/`,
   `data/`, `sw.js`, `manifest.webmanifest`, `README.md`), so a
   straight overwrite restores v3. Do not upload `bot/` or `worker/`
   — they were never part of the live site.
2. Wait for the Pages rebuild and verify the live site as in
   method A.

## After a rollback

- The service worker cache name changes back to `lawvault-v3`, so
  browsers will re-fetch the v3 assets; the v4 cache is purged on
  the next visit. If the site still looks like v4, do a hard reload
  (or clear the site data for `hliorex.github.io`).
- Bookmarks, recent views, theme choices, and checklist state are
  unaffected: v3 and v4 use the same browser-storage keys on purpose.
- The v4 files remain in `~/workspace/llb-notes-site-v4/` and in the
  `main` branch history, so v4 can be re-published later once the
  problem is fixed. Do not delete the `v3-backup` branch until v4
  has been confirmed working on the live site.
