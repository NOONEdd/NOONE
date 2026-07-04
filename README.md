# Vanguard Academy

A Wild Rift Support coaching site — champion/item/rune tier lists, matchup guides, and a Socratic AI Support Coach. Built with React + Vite, deployed on Cloudflare Pages.

Fan-made project, not affiliated with or endorsed by Riot Games.

## Run it locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Note: plain `npm run dev` does **not** run the `/functions` API (AI Coach, Coach Mode sync) — those only run on Cloudflare's infrastructure, or locally via `npx wrangler pages dev` (see below). Everything else works fine either way.

### Testing the API routes locally (optional)

```bash
npm run build
npx wrangler pages dev dist
```

This runs the full site including `/api/coach` and `/api/coach-overrides` locally, the same way they'll run once deployed.

## Deploying (Cloudflare Pages)

This project is already live on Cloudflare Pages. For a fresh deploy from this codebase:

1. Push this project to a GitHub repo.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Build settings: framework preset **Vite**, build command `npm run build`, output directory `dist`. Cloudflare usually detects this automatically.
4. Deploy.

### Enable the AI Coach

1. **Workers & Pages → your project → Settings → Environment variables**
2. Add `ANTHROPIC_API_KEY` as a **Secret** (get a key at console.anthropic.com)
3. Redeploy (env var changes need a new deployment to take effect)

Without this, every other page works fine — only the AI Coach page shows an error when asked a question.

### Enable real Coach Mode syncing (KV)

Right now, Coach Mode edits (tier/note changes) save to each visitor's browser only — not synced anywhere. To make edits real and visible to everyone:

1. **Workers & Pages → KV → Create a namespace** — name it anything, e.g. `vanguard-coach-data`.
2. **Workers & Pages → your project → Settings → Functions → KV namespace bindings → Add binding**
   - Variable name: `COACH_KV` (must match exactly — this is what `functions/api/coach-overrides.js` looks for)
   - KV namespace: the one you just created
3. Redeploy.

Once this is set up, the small text under the Coach Mode toggle will say **"Synced to the live site for everyone"** instead of **"Saved to this browser only."** That's the confirmation it's working.

**Heads up:** the write endpoint (`/api/coach-overrides`) currently has no authentication — anyone who found the URL and the right request shape could technically post data. Fine for now since the URL isn't published anywhere, but worth adding a simple check (e.g. a shared secret typed once to unlock Coach Mode, verified server-side) before treating this as fully public-safe long-term.

## Adding real images

This project ships with **no Wild Rift artwork** — every champion, item, and rune card references a local file path that doesn't exist yet, and falls back to a stylized icon until you add one.

To add real images:

1. Source them yourself — official Wild Rift channels, the wiki, or your own screenshots (see Riot's Fan Content Policy for what's allowed in a non-commercial project like this one).
2. Drop them into the matching folder using the **exact id** already used in the data files, in **any** common format:
   - `public/assets/champions/{id}.webp` (or `.jpg`, `.png`, `.jpeg`, `.avif`) — e.g. `lulu.webp`, `nautilus.jpg`
   - `public/assets/items/{id}.webp` — e.g. `eclipse.webp`, `heartsteel.png`
   - `public/assets/runes/{id}.webp` — e.g. `conqueror.webp`
3. That's it — **no code changes needed, ever, regardless of format.** `<SmartImage />` (`src/components/SmartImage.jsx`) automatically tries webp, jpg, jpeg, png, then avif for every image slot and uses whichever one exists. Add ten more images next month in whatever format you happen to have — same result, zero code edits.
4. Check `src/data/champions.js`, `items.js`, and `runes.js` for the exact `id` of each entry if you're not sure what to name a file.

### Bulk-organizing your own images

If you've got a folder of images with messy/inconsistent filenames (screenshots, wiki downloads, etc.), `scripts/organize-images.js` will match them against the real ids and copy them into the right place automatically:

```bash
node scripts/organize-images.js path/to/your/images-folder
```

It matches by normalized filename (so `80px-Eclipse_WR_item.png` still matches the `eclipse` id), copies rather than moves your originals, and prints a report of what matched and what's still missing. Safe to re-run any time you add more images later — it only touches files in `public/assets/`, never your source folder.

## Coach Mode — how it persists

Coach Mode (the tier/note editor on the three tier list pages) tries the real backend first (`/api/coach-overrides`, backed by Cloudflare KV — see setup above) and falls back to browser-local storage automatically if that's not reachable (e.g. local dev without `wrangler`, or before the KV binding is set up). The small status line under the toggle tells you which one is active.

Once KV is set up, edits are real: they save to the live site immediately and show up for every visitor, on every device — no redeploy needed. Champion/item blurbs baked into `src/data/*.js` are still the fallback default for anything you haven't graded yet in Coach Mode.

## Project structure

```
src/
  data/          champions.js, items.js, runes.js, constants.js
  components/    shared UI (RankChip, TierBoard, Layout, BuildList, SmartImage, icons)
  pages/         one file (or group) per route
  hooks/         routing, Coach Mode storage (real API + local fallback), hero parallax
  utils/         image base-path resolution
functions/
  api/coach.js             Cloudflare Pages Function — proxies the AI Coach to Anthropic
  api/coach-overrides.js   Cloudflare Pages Function — Coach Mode read/write via KV
public/
  assets/        empty folders for your own champion/item/rune images
scripts/
  organize-images.js   run locally to bulk-sort your own image files by filename
```

## What's built vs. what needs content

- **Fully built:** site structure, routing, all tier lists, all 71 items and ~50 runes with real Wild Rift stats, Coach Mode (local + real sync once KV is set up), AI Coach (once you add your API key), auto-detecting image system.
- **Needs your coaching input:** most champions only have a tier + one-line note. Full Items/Runes/Matchups tabs are written for Lulu and Nautilus as examples — the rest follow the same data shape in `src/data/champions.js`.
- **Placeholder:** the About/story section on the Coaching page, and dedicated macro guide pages (roaming, vision, objectives) — the AI Coach covers this conversationally, but there's no written version yet.
