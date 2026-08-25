# Nyx NOONE dd Academy

A Wild Rift Support coaching site — champion/item/rune tier lists, matchup guides, a Socratic AI Support Coach, and Patch Intelligence (AI-assisted, coach-reviewed patch analysis). Built with React + Vite, deployed on Cloudflare Pages.

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

This runs the full site including `/api/coach`, `/api/coach-overrides`, and the admin/Patch Intelligence endpoints locally, the same way they'll run once deployed. Two things worth knowing for local testing specifically:

- There's no `wrangler.toml` in this project (Cloudflare Pages bindings are configured entirely in the dashboard — see below), so a local KV namespace and env vars need to be passed as flags: `npx wrangler pages dev dist --kv=COACH_KV --binding COACH_PASSWORD=yourtestpassword`.
- If your local network blocks outbound requests, you may see a one-time warning about Miniflare failing to fetch Cloudflare's `cf.json` metadata on startup. It's harmless (Miniflare falls back to a placeholder), but if it seems to hang, set `CLOUDFLARE_CF_FETCH_ENABLED=false` in the environment before running the command above to skip that fetch entirely.

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

Without this, every other page works fine — only the AI Coach page shows an error when asked a question, and it's a specific one ("AI Coach isn't fully set up yet") rather than a generic failure.

**Provider setup (optional):** the AI Coach talks to whichever provider `functions/_lib/aiProvider.js` is told to use. Two providers exist today:

| Provider | `AI_PROVIDER` value | What it covers |
|---|---|---|
| Anthropic | `anthropic` (default) | Anthropic's own API — the only non-OpenAI-shaped adapter |
| Generic OpenAI-compatible | `openai-compatible` | **Any** provider that exposes a standard `POST {base_url}` chat/completions endpoint — OpenAI itself, OpenRouter, Together, Groq, a self-hosted vLLM/Ollama/LM Studio server, etc. One adapter, any provider that speaks that shape — you are not limited to a specific 1–2 named services. |

This is not a claim that literally every AI API works — only ones that either speak the OpenAI-compatible shape (covered generically) or have their own adapter file written for them (like Anthropic's does). A provider with a genuinely different API (its own auth style, request/response shape) needs its own `functions/_lib/providers/<name>.js` file — see the comment at the top of `aiProvider.js` for the exact contract.

**To stay on Anthropic (default, no action needed):**
- `ANTHROPIC_API_KEY` — Secret
- Leave `AI_PROVIDER` / `AI_MODEL` unset (defaults to `anthropic` / `claude-sonnet-4-6`)

**To switch to any OpenAI-compatible provider**, set these as plain (non-secret) Environment variables:
- `AI_PROVIDER` = `openai-compatible`
- `AI_BASE_URL` = that provider's chat/completions endpoint (e.g. `https://api.openai.com/v1/chat/completions`, or whatever your chosen provider's docs give you)
- `AI_MODEL` = whatever that provider calls the model you want (e.g. `gpt-4o-mini`) — required, there's no default since `AI_BASE_URL` could point anywhere
- `AI_TEMPERATURE` = optional; only sent to the provider if you set it

...and as a **Secret**:
- `AI_API_KEY` = that provider's key (kept as its own variable, separate from `ANTHROPIC_API_KEY`, so both can be configured at once and you can flip back by changing `AI_PROVIDER` alone)

Redeploy after changing any of these. Switching back to Anthropic later is just setting `AI_PROVIDER` back to `anthropic` (or removing it) — no code changes either direction. **This same configuration also powers Patch Intelligence's analysis** (`functions/_lib/patchIntelligence.js` calls the identical `callAIProvider()` dispatcher) — there's no separate AI setup for it.

### Enable real Coach Mode syncing (KV)

Right now, Coach Mode edits (tier/note changes) save to each visitor's browser only — not synced anywhere. To make edits real and visible to everyone:

1. **Workers & Pages → KV → Create a namespace** — name it anything, e.g. `vanguard-coach-data`.
2. **Workers & Pages → your project → Settings → Functions → KV namespace bindings → Add binding**
   - Variable name: `COACH_KV` (must match exactly — this is what `functions/api/coach-overrides.js`, the rate limiter, the password lockout, and the AI Coach's grounding all look for)
   - KV namespace: the one you just created
   - **Add this binding under BOTH the Production and Preview environment tabs.** Cloudflare Pages configures these separately — a binding added to only one will work when you preview a deploy but silently miss (or vice versa) once it's actually live, which looks exactly like "my Coach Mode edits keep reverting." If edits ever seem to not stick after a deploy, this is the first thing to check.
3. Redeploy.

Once this is set up, the small text under the Coach Mode toggle will say **"Synced to the live site for everyone"** instead of **"Saved to this browser only."** That's the confirmation it's working.

## Admin area & authentication

Everything privileged — Coach Mode's on-page editing controls, and the Patch Intelligence review dashboard — is gated behind one private admin area at **`/#/admin`**. There is no other password prompt anywhere else in the site, and no hidden reveal mechanism (see "Safe Browsing cleanup" below for why that matters).

1. Log in at `https://your-site.pages.dev/#/admin` with `COACH_PASSWORD`.
2. A successful login sets a signed, `HttpOnly` session cookie (`functions/_lib/adminAuth.js`) — good for 12 hours. The password itself is never stored in the browser and never sent again for the rest of the session; every subsequent admin action (Coach Mode edits, Patch Intelligence review actions) is authorized by that cookie, checked server-side on every request.
3. Once logged in, Coach Mode's editing controls appear automatically on the public tier list / champion pages — there's nothing further to unlock there.
4. **5 wrong password attempts locks out that IP for 15 minutes** (`functions/_lib/passwordAttempts.js`, same mechanism as before, just applied to the new login endpoint).

**Recommended extra secret — `ADMIN_SESSION_SECRET`:** if this isn't set, sessions are still signed securely (derived from `COACH_PASSWORD` server-side, never transmitted), so everything works out of the box with zero extra configuration. Setting a dedicated `ADMIN_SESSION_SECRET` (any long random string — a password generator's output is fine) is a small extra hardening step: it means a session's signing key isn't tied to the login password at all. Add it as a Secret, same as `COACH_PASSWORD`, and redeploy.

### Safe Browsing cleanup

This version removes the things most likely to have triggered the earlier Google Safe Browsing "Deceptive Pages" warning:
- The `?coach`-URL-param reveal mechanism and its `localStorage` flag (`src/hooks/useCoachUIVisible.js`) — deleted entirely.
- The on-page password prompt that used to live directly on public tier list pages (inside `CoachToggle`) — deleted; the only password field anywhere in the app now lives at `/#/admin`, clearly labeled "NOONEdd Academy — Admin," with no resemblance to a third-party login page.
- The old `/api/verify-coach` endpoint and the dead legacy `/api/coach.js` (a leftover Vercel-format file that was never actually reachable on Cloudflare Pages, but was still sitting in the repo) — both deleted.
- Sending the raw admin password on every Coach Mode save — replaced with the session-cookie system above, so the password now only ever travels over the wire once, at login.
- Baseline security response headers (`public/_headers`): `X-Frame-Options: DENY` (the admin login page can't be framed by another site), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

None of this can guarantee Google's classification changes or how quickly — that's Google's own review process — but it removes the concrete patterns (a discoverable hidden password form, a password re-sent on every request) most commonly associated with that warning.

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

## AI Coach data grounding architecture

Priority order the AI Coach follows for any factual Wild Rift claim, strictly in this order:

1. **Nyx NOONE dd Academy effective data** — champions/items/runes/builds/matchups/decision trees, resolved from `src/data/*.js` (static baseline) merged with live Coach Mode KV overrides. This is the primary source for essentially everything the AI says about the game.
2. **Official Riot Wild Rift patch notes** — used when Academy data isn't *sufficient* for the specific question, which is not the same as "an entity wasn't found." `functions/_lib/academyCoverage.js` makes this call deterministically (no extra AI call): Academy is treated as insufficient when nothing was grounded at all, when the question asks about a specific mechanical fact (e.g. "cooldown") the grounded text doesn't mention, or when the question is asking what *changed* — Academy only ever holds current data, never a diff against a previous patch. When Riot fallback does run, it discovers Riot's own latest published patch independently (from Riot's patch-notes index, not from Academy's patch) — Academy could say 7.2b while Riot's already on 7.3, and the fallback correctly uses 7.3. A patch explicitly named in the question (e.g. "what changed in 7.1d?") is looked up directly instead. Only `wildrift.leagueoflegends.com`, never a user-supplied URL or third-party site, cached in KV (~12h for "what's latest," ~7 days for a given patch's content since it's immutable once published), 5s timeout, always fails gracefully. See `functions/_lib/riotFallback.js`.
3. **The model's own general knowledge** — last resort, and only for facts specifically about Wild Rift, never League PC.

Academy data always wins if it conflicts with the Riot fallback — the fallback only fills gaps, never overrides.

**One resolver, shared by the website and the AI.** `src/lib/effectiveData.js` is the single place that merges static data with KV overrides (field-by-field, so a partial edit like just a new `note` doesn't blow away the rest of the entry). Both `src/App.jsx` (the website) and `functions/api/coach.js` (the AI Coach) call the exact same functions from this file — they can't drift into disagreeing about a champion's current tier, an item's current stats, or the current patch, because it's the same code computing both.

**Patch resolution** works the same way: `src/data/patch.js` holds `STATIC_PATCH_VERSION`, the shipped fallback. Coach Mode can set a live override (the "Current patch" field shown when Coach Mode is unlocked) stored in KV as `overrides.patch`. `resolveEffectivePatch()` in `effectiveData.js` prefers the KV value whenever one is set, falling back to the static constant otherwise — same function, same result, on the website footer, the AI's system prompt, and `/api/version`.

**Patch data verification status** is a deliberately separate question from "what's the current patch." `resolvePatchDataStatus()` (same file) reports `verified` / `updating` / `not_reviewed`, derived from `overrides.verifiedPatch` (the patch an admin last explicitly marked verified) and `overrides.patchStatus`. It can only ever report `verified` when `verifiedPatch` exactly string-matches the current effective patch — so bumping the current patch, by itself, always and automatically drops back to a non-verified status, with no separate reset step required anywhere. The AI Coach's system prompt includes this status and is told to hedge on patch-specific numbers when it isn't `verified`, rather than presenting unreviewed data as freshly confirmed.

**Conversation-aware grounding.** A follow-up question like "what if they have a heavy dive comp?" (naming no champion or item) still resolves against whatever was being discussed — `detectChampionsInConversation()` / `detectItemsAndRunesInConversation()` in `functions/_lib/detectChampion.js` / `detectItemsRunes.js` check the latest message first (so switching topics still works correctly), and only fall back through a small bounded window of recent messages (`CONVERSATION_LOOKBACK_MESSAGES` in `config.js`) if the latest message named nothing. This is a look-back over messages already in the request, not an extra data source — cost/size limits are unaffected.

**Anti-hallucination guardrails.** Entity data existing isn't the same as the *specific fact asked about* existing — `champions.js` has no per-ability data at all (role/tier/builds/matchups/notes, never "what does the W do"), so a question about a specific ability's exact effect (`isAbilityDetailQuestion()` in `academyCoverage.js`) is always treated as an Academy gap and gets an explicit reminder in the system prompt not to invent the answer, even when nothing else was grounded (e.g. a champion outside this Support-focused roster, asked about by ability). Champion role is always presented from the grounded data ("Janna (Enchanter, ...)") with an explicit instruction to answer position questions from that field, not assumption. A separate instruction tells the model not to validate a question's premise if it assumes a mechanic or term that isn't in the grounded data or standard Wild Rift knowledge (e.g. a made-up item interaction) — correct the premise using the real grounded facts instead of inventing an explanation for a fictional one.

## Patch Intelligence

A coach-reviewed, Support-focused breakdown of what changed in each Wild Rift patch — not a copy of Riot's patch notes, and not something that touches your tier lists on its own.

**Workflow:** official patch detected → AI analysis (Support-relevant changes only, cross-checked against your actual current roster/tiers) → stored as a private report → you review it at `/#/admin` (approve / reject / edit / publish) → publishing optionally marks the patch verified → only then does anything appear on the public `/#/patch-intelligence` page. The AI is explicitly instructed it's an analyst, not the final authority — nothing it produces is ever applied to champion/item/rune data automatically; recommended tier changes are suggestions you still apply the normal way, by hand, in Coach Mode.

**Detecting a new patch:**
- **Manual (no setup required):** click "Check for new patch now" on the admin dashboard, any time.
- **Automatic:** Cloudflare Pages Functions can't run on a schedule by themselves (only standalone Workers support Cron Triggers) — this project has neither an existing Worker nor a wrangler.toml to add one to, so automatic checking needs ONE small piece of outside scheduling, in order of simplicity:
  1. A free external scheduler (e.g. [cron-job.org](https://cron-job.org), or a scheduled GitHub Actions workflow) that does nothing but `POST https://your-site.pages.dev/api/admin/patch-check` with header `X-Patch-Check-Secret: <PATCH_CHECK_SECRET>` and body `{"trigger":"scheduled"}` on whatever interval you like (once or twice a day is plenty — Riot doesn't patch more often than that).
  2. A tiny companion Cloudflare Worker with a Cron Trigger doing the same fetch, if you'd rather keep it entirely inside Cloudflare. This needs its own minimal `wrangler.toml` and a `[triggers] crons = [...]` entry — ask in a future session if you'd like this scaffolded out; it's a handful of lines but is a genuinely separate deployable Worker, not something addable to this Pages project's config alone.

  Either way, set `PATCH_CHECK_SECRET` (any long random string) as a Secret so the endpoint can't be triggered by anyone else — this is separate from the admin session, specifically so a scheduler never needs to hold your login password.

**Never fabricates:** if Riot's patch-notes page can't be reached, or a genuinely new patch's content can't be fetched, Patch Intelligence stores an honest "source unavailable" state (or, if you've set `NOTIFY_WEBHOOK_URL`, sends you a heads-up) instead of guessing at changes — it never invents a patch's contents.

**Notifications:** set `NOTIFY_WEBHOOK_URL` (a Secret) to any URL that accepts a JSON POST, and Patch Intelligence sends a short summary there whenever a new patch is detected (or when detection fails on the scheduled path). This works natively with a **Discord** webhook URL or a **Slack** incoming webhook URL with zero further setup — paste either directly. For Telegram, ntfy.sh, or email, point it at a small relay (e.g. a Zapier/Make "catch webhook → forward" automation, or ntfy.sh's own webhook-compatible topic URL). No notification service is required — reports are always visible at `/#/admin` regardless of whether this is configured.

## Project structure

```
src/
  data/          champions.js, items.js, runes.js, constants.js, patch.js (static patch fallback)
  lib/           effectiveData.js — shared data-merge resolver + patch/verification-status resolvers, imported by BOTH the website and the AI Coach
  components/    shared UI (RankChip, TierBoard, Layout, BuildList, SmartImage, icons, PatchStatus)
  pages/         one file (or group) per route, including AdminPage.jsx and PatchIntelligencePage.jsx
  hooks/         routing, Coach Mode storage (real API + local fallback, now session-cookie-based), hero parallax
  utils/         image base-path resolution
functions/
  api/coach.js                Cloudflare Pages Function — AI Coach chat endpoint (grounds + calls the active AI provider)
  api/coach-overrides.js      Cloudflare Pages Function — Coach Mode read/write via KV; GET public, POST admin-session protected
  api/version.js              Cloudflare Pages Function — reports active AI provider/model + patch version + verification status
  api/health.js               Cloudflare Pages Function — uptime check
  api/patch-reports.js        Cloudflare Pages Function — PUBLIC read-only list of published Patch Intelligence reports
  api/admin/login.js          Cloudflare Pages Function — password check, issues the signed session cookie
  api/admin/logout.js         Cloudflare Pages Function — clears the session cookie
  api/admin/session.js        Cloudflare Pages Function — reports whether the current cookie is a valid session
  api/admin/patch-check.js    Cloudflare Pages Function — detects a new official patch, runs the AI analysis, stores the report
  api/admin/patch-reports.js  Cloudflare Pages Function — admin report list/detail + approve/reject/edit/publish actions
  _lib/config.js              all tunable numbers (limits, caps, defaults) in one place
  _lib/aiProvider.js          provider-agnostic dispatcher — see "Provider setup" above; also used by Patch Intelligence
  _lib/providers/anthropic.js        Anthropic adapter
  _lib/providers/openaiCompatible.js generic adapter for any OpenAI-compatible provider
  _lib/detectChampion.js, detectItemsRunes.js   scan the question for champion/item/rune mentions
  _lib/extractChampionContext.js, extractItemRuneContext.js   pull ONLY the relevant data + live overrides
  _lib/buildPrompt.js         assembles the final system prompt from whatever was detected, including patch verification status
  _lib/rateLimiter.js, passwordAttempts.js   per-IP abuse protection, both backed by COACH_KV
  _lib/riotFallback.js        official Riot Wild Rift patch-notes fallback + full-content fetch for Patch Intelligence — independent latest-patch discovery, cached, timeout-bounded
  _lib/academyCoverage.js     deterministic "is Academy data actually sufficient for this question" logic (decides if Riot fallback runs)
  _lib/patchIntelligence.js   builds the Patch Intelligence analyst prompt, calls the AI provider, validates/normalizes the JSON result
  _lib/patchReportsStore.js   KV storage for Patch Intelligence reports (index + individual report bodies)
  _lib/notify.js              optional outbound webhook notification for new patch reports
  _lib/adminAuth.js           signs/verifies the admin session cookie (Web Crypto HMAC-SHA256, no new dependency)
  _lib/kv.js                  reads live Coach Mode overrides from COACH_KV
  _lib/logger.js              structured request logging (Cloudflare real-time logs only, nothing user-visible)
public/
  assets/        empty folders for your own champion/item/rune images
  _headers       baseline security response headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
scripts/
  organize-images.js   run locally to bulk-sort your own image files by filename
```

## What's built vs. what needs content

- **Fully built:** site structure, routing, all tier lists, all 71 items and ~50 runes with real Wild Rift stats, Coach Mode (local + real sync once KV is set up), AI Coach (once you add your API key), auto-detecting image system, private admin authentication, Patch Intelligence (detection, AI analysis, review workflow, public page).
- **Needs your coaching input:** most champions only have a tier + one-line note. Full Items/Runes/Matchups tabs are written for Lulu and Nautilus as examples — the rest follow the same data shape in `src/data/champions.js`.
- **Placeholder:** the About/story section on the Coaching page, and dedicated macro guide pages (roaming, vision, objectives) — the AI Coach covers this conversationally, but there's no written version yet.
- **Needs a decision from you:** whether to set up automatic patch checking (external scheduler or a small companion Worker — see "Patch Intelligence" above) or just use the manual "Check for new patch now" button; whether to configure `NOTIFY_WEBHOOK_URL` for patch alerts.


