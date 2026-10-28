# LawVault — LLB Class Knowledge Library

LawVault is a lightweight, single-page website for an LLB class library.
It is an index and navigation layer only. The files themselves stay on
Google Drive, and LawVault links to them. LawVault does **not** use the
Google Drive API, API keys, OAuth, service accounts, or scraping.

## What is real, what is demo, and what is placeholder

- **Real:** Semester 1 subject cards, with the five Google Doc links in
  `config.json` (Contract Unit 2, Constitutional Law-I Unit 1, Tort Unit 1,
  Crimes-I Unit 1, Jurisprudence Unit 1), and the main Drive folder link.
- **Demo only:** one case-law entry, one previous-paper category, and one
  pending entry. Each is clearly labelled DEMO in the site and in
  `config.json`. Replace them with real entries, or set `visible` to
  `false` for them.
- **Placeholder:** all contact cards. No contact details are included.
  Add a real destination in `config.json` and set `enabled` to `true`,
  or leave the card disabled.
- **Not claimed:** no resource counts, no exam date, no case citations,
  and no years are shown unless they are configured. Semesters 2–7 show
  “Not configured yet”.

## Files

- `index.html` — the single page (structure and section headings).
- `styles.css` — Modern Kerala Editorial styling.
- `app.js` — rendering, search, filters, bookmarks, recent items,
  theme presets, and Today's Note expiry. It only reads `config.json`.
- `config.json` — **the only file you normally need to edit.**
- `bot/` — a Cloudflare Workers webhook skeleton only. It is not a
  running bot and contains no real credentials.

## Publish to GitHub Pages (beginner steps)

1. In your GitHub repository (for example, `llbvault`), upload
   `index.html`, `styles.css`, `app.js`, and `config.json` to the root
   of the `main` branch. Keep the files next to each other.
2. Go to the repository **Settings**, then **Pages**.
3. Under “Build and deployment”, choose **Deploy from a branch**.
4. Choose branch `main` and folder `/ (root)`, then **Save**.
5. Wait a few minutes, then open the Pages address GitHub shows you.
   For a project repository it looks like
   `https://YOUR-USERNAME.github.io/llbvault/`
   (replace YOUR-USERNAME with your GitHub username).
6. If you see a 404 at first, wait a few more minutes and try again;
   the first Pages build can take time.

This site uses relative links (`./styles.css`, `./config.json`,
`./app.js`), so it works under a project subpath such as `/llbvault/`.
Do not change those links to start with `/`.

## Change content without editing code

Edit only `config.json`, then commit and push it (or upload it again
through the GitHub website). GitHub Pages will rebuild the site.

- **Add a subject:** copy an existing entry in `subjects`, give it a new
  stable `id` (do not reuse an old id), set its `semesterId` (for
  example `sem-2`), `title`, `description`, and `link` (a full
  `https://` Google Drive share link), and set `visible` to `true`.
- **Hide something:** set its `visible` to `false`. Do not delete the
  entry unless you are sure; hiding is safer.
- **Today's Note:** add an entry to `todayNotes.items` with a
  `publishedAt` date and time. It is shown for 24 hours (or
  `expiryHours`, if you change it) and then hidden automatically.
  Times are Asia/Kolkata. Do not guess today's notes from a folder name.
- **Change the featured semester:** set `featured` to `true` on that
  semester and `false` on the others, and set `default` to `true` on
  the semester that should open first.
- **Change the theme:** set `theme.preset` to exactly one of:
  `Modern Kerala Editorial`, `Minimal Dark`, `High-Contrast Green`,
  or `Monochrome Academic`. Other values are ignored by the site.
- **Reorder or hide sections:** edit `sectionOrder` and
  `sectionVisibility`. Use only the section keys already in the file.
- **Announcements:** add an entry to `announcements` with a `title`
  and `visible` set to `true`. It appears as a banner at the top.
- **Contacts:** fill in `destination` with a real `https://` link or
  a Telegram link, and set `enabled` to `true`. Leave it disabled
  until you have a real destination.

Rules for `config.json`:

- Use only full `https://` links. Other links are ignored by the site.
- Never put a bot token, GitHub token, password, or API key in
  `config.json` or in any website file. It is public on GitHub Pages.
- Do not write HTML or script tags into titles or descriptions.
  The site inserts configuration text as plain text, not as HTML.

## Search — honest limitation

Search in LawVault searches only the metadata in `config.json`
(subjects, case names, paper categories, exam cards). It cannot search
filenames inside Google Drive folders, because LawVault does not use
the Drive API. To make something searchable, add it to `config.json`.

## Bookmarks, recent items, and the revision checklist

Bookmarks, recently visited links, and the revision checklist are
stored only in the visitor's own browser (localStorage). They do not
sync across devices and they are not sent to any server.

## Telegram bot — skeleton only (not deployed yet)

The `bot/` folder is a Cloudflare Workers webhook skeleton. It shows
how a management bot could later work, without running one:

1. A Telegram webhook (Cloudflare Workers) receives an update.
2. The worker checks that the Telegram user id is in `ADMIN_IDS`
   (a server secret, never in the repository).
3. The worker validates the requested change against an allowlist of
   fields and presets, and builds a new `config.json`.
4. The worker uses a narrowly scoped GitHub token (a server secret,
   stored in Cloudflare, never in the repository) to update
   `config.json` in the repository through the GitHub API.
5. GitHub Pages rebuilds the site. The bot confirms success only
   after that update succeeds.

To deploy it later, the owner still needs: a Telegram bot token
(from BotFather), a Cloudflare account, a GitHub token with only
write access to this one repository's contents, and their own
Telegram user id for the allowlist. None of those values belong in
this repository, in chat, or in `config.json`.

## If something looks empty or broken

- “Not configured yet” means no real entry has been added for that
  semester or section. That is intentional — LawVault does not invent
  subjects, papers, cases, or contacts.
- A Drive link that asks for access means that Drive file or folder
  has not been shared with the visitor. LawVault cannot change Drive
  sharing; the owner must share the Drive folder or file.
- If the site looks unstyled, check that `styles.css` is in the same
  folder as `index.html` and that the Pages source is `main` / root.
