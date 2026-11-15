# LawVault v5 — Apps Script setup

This sets up the Google Sheet (the database) and the Apps Script web
app (the only writer to the Sheet). The website code needs no changes
after this except filling in two values in
`data/sheets-config.json` — see step 6.

No credential value is ever written into code, the Sheet, or the
website. The admin credentials live only in the script's Script
Properties, which only the Google account owner can see.

## Step 1 — Create the Sheet

1. In the owner's Google account, create a new blank Google Sheet.
   Name it `LawVault Data` (any name works).
2. Copy the Sheet ID from the URL — it is the long value between
   `/d/` and `/edit`. Keep it for step 6.

## Step 2 — Attach the script

1. With the Sheet open: **Extensions → Apps Script**.
2. Delete the default `Code.gs` content.
3. Paste the full contents of `apps-script/Code.gs` from this folder.
4. Save (Ctrl/Cmd+S). Name the project `LawVault Admin API`
   (any name works).

## Step 3 — Create the tabs and seed the data

1. In the Apps Script editor, select the function `setupSheets`
   in the function dropdown and click **Run**.
2. Authorise when asked (the script only touches this spreadsheet).
3. Open the Sheet: it now has all 11 tabs with headers, Semesters
   1–7 (only Semester 1 configured), the 5 real Semester 1 notes,
   default settings, the DEMO placeholders, the 6 exam-prep cards,
   and the 6 disabled contact cards.
4. `setupSheets()` is idempotent — running it again only fills tabs
   that are still empty. It never overwrites existing rows.

## Step 4 — Set the admin credentials (Script Properties)

1. In the Apps Script editor: **Project Settings** (gear icon) →
   **Script properties** → **Add script property**.
2. Add a property named exactly `ADMIN_CODE` with the chosen
   administrative code as its value.
3. Generate the password hash. The value stored must be the SHA-256
   hex digest of the password — never the password itself. Generate
   it one of these ways (pick one):
   - In a terminal: `printf %s 'your-password' | sha256sum`
     (use the real password in place of `your-password`; the output
     before the ` -` is the hash).
   - In a browser console (F12 → Console):
     `crypto.subtle.digest('SHA-256', new TextEncoder().encode('your-password')).then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')))`
4. Add a property named exactly `ADMIN_PASS_HASH` with that 64-character
   hex digest as its value.
5. Never put the code or the password (or the hash) into `Code.gs`,
   the Sheet, the website files, or chat. Anyone who can read the
   public website repository must not be able to learn them.

## Step 5 — Deploy the web app

1. In the Apps Script editor: **Deploy → New deployment**.
2. Click the gear icon → **Web app**.
3. Set **Execute as: Me** (the owner's Google account).
4. Set **Who has access: Anyone**. This only means anyone may call
   the endpoint; every write is still checked against the Script
   Properties credentials on the server, and failed attempts are
   logged in the `activity_log` tab.
5. Click **Deploy** and copy the **Web app URL**
   (it ends in `/exec`). Keep it for step 6.
6. If you ever edit `Code.gs` afterwards, redeploy:
   **Deploy → Manage deployments → Edit → New version → Deploy**.

## Step 6 — Wire the website to the Sheet

1. Open `data/sheets-config.json` in the website files.
2. Paste the Sheet ID from step 1 into `sheetId`.
3. Paste the Web app URL from step 5 into `appsScriptUrl`.
4. Set `enabled` to `true`.
5. Publish the updated `data/sheets-config.json` to the repository.
   The public site and the admin panel read it on every load — no
   other file changes are needed.

## Step 7 — Share the Sheet for reading

The public site reads the Sheet without any login, so the Sheet must
be readable by link:

1. In the Sheet: **Share → General access → Anyone with the link →
   Viewer**. (Viewer, not Editor — only the Apps Script may write.)
2. Do NOT share the Sheet as Editor with "anyone with the link":
   that would let anyone edit the database directly, bypassing the
   admin login entirely.

## Step 8 — Test

1. Open the admin panel (`admin.html` on the live site) and log in
   with the administrative code and password.
2. The dashboard should show the seeded counts (5 subjects, 1 case
   law, 1 paper, 6 exam resources, 1 pending entry).
3. Add a test Daily Note, publish it, and check the public site's
   Today's Notes section. Delete the test note afterwards.
4. Check the `activity_log` tab: the login, the add, and the delete
   should all be recorded.

## If something goes wrong

- **Site shows the old local content:** `enabled` is `false`, the
  Sheet ID is wrong, or the Sheet is not shared as "Anyone with the
  link can view". The site falls back to its local JSON silently —
  this is by design, so the site never breaks.
- **Admin login fails:** check that `ADMIN_CODE` and
  `ADMIN_PASS_HASH` are set in Script Properties (exact key names),
  that the hash is the SHA-256 hex of the password (64 hex
  characters), and that the deployed web app URL in
  `sheets-config.json` is the current deployment.
- **Writes fail:** make sure the deployment is the latest version
  (step 5.6) and that "Execute as" is "Me".
- **Rollback:** disabling the Sheet is instant — set `enabled` to
  `false` in `data/sheets-config.json` and republish. The site then
  uses its local JSON files only. Rolling back the site to v4 also
  works: v4 ignores the Sheet entirely. See `ROLLBACK.md`.

## Honest limits

The admin code + password is a shared secret checked by a script —
a soft lock, not bank-grade security. It is the right weight for a
class library: the worst case is someone changing listings, and the
Sheet's version history plus the `activity_log` tab can undo and
trace it. Do not reuse a password that protects anything else.
