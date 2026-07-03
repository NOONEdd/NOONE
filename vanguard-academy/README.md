# Vanguard Academy

A Wild Rift Support coaching site — champion/item/rune tier lists, matchup guides, and a Socratic AI Support Coach. Built with React + Vite.

Fan-made project, not affiliated with or endorsed by Riot Games.

## Run it locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Deploy to Vercel

1. Push this project to a GitHub repo.
2. Import the repo at [vercel.com/new](https://vercel.com/new).
3. Before your first deploy, add an environment variable: `ANTHROPIC_API_KEY` — get a key at [console.anthropic.com](https://console.anthropic.com). This powers the AI Coach page.
4. Deploy. Vercel auto-detects Vite and builds it correctly with no extra config.

Without step 3, every other page works fine — only the AI Coach page will show an error when asked a question.

## Adding real images

This project ships with **no Wild Rift artwork** — every champion, item, and rune card references a local file path that doesn't exist yet, and falls back to a stylized icon until you add one.

To add real images:

1. Source them yourself — official Wild Rift channels, the wiki, or your own screenshots (see Riot's Fan Content Policy for what's allowed in a non-commercial project like this one).
2. Drop them into the matching folder using the **exact id** already used in the data files:
   - `public/assets/champions/{id}.jpg` — e.g. `lulu.jpg`, `nautilus.jpg`
   - `public/assets/items/{id}.jpg` — e.g. `ardent-censer.jpg`, `eclipse.jpg`
   - `public/assets/runes/{id}.jpg` — e.g. `conqueror.jpg`, `grasp-of-the-undying.jpg`
3. That's it — no code changes needed. Check `src/data/champions.js`, `items.js`, and `runes.js` for the exact `id` of each entry.
4. If your files use a different extension (`.png`, `.webp`), either rename them to `.jpg`, or add an entry to the `EXT_BY_TYPE_ID` map in `src/utils/images.js`.

## Coach Mode — how it actually persists

Coach Mode (the tier/note editor on the three tier list pages) currently saves to **your browser's localStorage only**. That means:

- Edits you make are visible only on that browser, on that device.
- They will **not** appear for other visitors, and won't sync to your phone or another computer.
- The real source of truth for the public site is the data in `src/data/champions.js`, `items.js`, and `runes.js`.

**To make a tier/note change permanent and public:** edit the relevant entry directly in those data files and redeploy (push to GitHub — Vercel redeploys automatically).

Coach Mode is genuinely useful for quickly previewing how a change will look before committing it to the data files — just know it's a local scratchpad, not a live editor for the public site. A real backend (Supabase, Firebase, or similar) would be the natural next step if you want Coach Mode to publish changes directly without a code edit + redeploy.

## Project structure

```
src/
  data/          champions.js, items.js, runes.js, constants.js
  components/    shared UI (RankChip, TierBoard, Layout, BuildList, icons)
  pages/         one file (or group) per route
  hooks/         routing, Coach Mode storage, hero parallax
  utils/         image path resolution
api/
  coach.js       Vercel serverless function — proxies the AI Coach to Anthropic
public/
  assets/        empty folders for your own champion/item/rune images
```

## What's built vs. what needs content

- **Fully built:** site structure, routing, all tier lists, all 71 items and ~50 runes with real Wild Rift stats, Coach Mode, AI Coach (once you add your API key).
- **Needs your coaching input:** most champions only have a tier + one-line note. Full Items/Runes/Matchups tabs are written for Lulu and Nautilus as examples — the rest follow the same data shape in `src/data/champions.js`.
- **Placeholder:** the About/story section on the Coaching page, and dedicated macro guide pages (roaming, vision, objectives) — the AI Coach covers this conversationally, but there's no written version yet.
