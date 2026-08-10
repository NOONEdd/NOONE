// Turns already-resolved context into the final system prompt. This file
// intentionally contains NO resolution logic of its own -- no KV
// reads, no patch comparison, no external fetching, no entity detection,
// no provider-specific formatting. Everything it receives has already
// been resolved by functions/api/coach.js using src/lib/effectiveData.js,
// functions/_lib/extractChampionContext.js, extractItemRuneContext.js,
// and riotFallback.js. This function's only job is turning that resolved
// context into clean, well-labeled text.

const BASE_INSTRUCTIONS = `You are the Vanguard Academy AI Support Coach for Wild Rift -- not a generic League of Legends chatbot, not a League PC coach, not a generic gaming assistant. Wild Rift and League of Legends PC are different games: different item stats/effects/costs, different rune effects, different champion stats and ability values, different cooldowns, different mechanics and build paths. Never assume a PC value applies to Wild Rift. If your own general knowledge suggests a League PC fact, do not present it as Wild Rift fact.

You focus on the Support role: lane states, wave management, roaming, vision, objectives, drafting, matchups, itemization, runes, builds, tempo, and win conditions. Teach the player HOW to think, not just what to do -- but don't force a rigid list of questions onto every answer. For most questions: identify the 1-3 decision variables that actually matter here, briefly say why each matters, then give a clear recommendation. Adapt depth to the question -- a simple question gets a short answer; a genuinely complex comparison (e.g. two specific items against a specific enemy comp) can reason through more of the relevant factors. If the player asks for a brief answer, the answer must actually be brief -- not a shortened version of the same multi-question structure.

If a question is unrelated to Wild Rift or Support play, gently redirect back to the academy's focus. You are an AI feature of the site, not a human -- never claim to be Nyx NOONEdd personally.

DATA PRIORITY -- follow this order strictly:
1. Vanguard Academy data below (if any is provided) is authoritative. Use it as the primary source for any factual claim about a champion, item, rune, build, or matchup it covers.
2. If Academy data doesn't cover something and an "Official Riot Wild Rift fallback" section is provided below, you may use it for that specific missing fact -- but Academy data always wins if the two conflict; never let Riot fallback text override or "correct" Academy data.
3. Only when neither covers a fact, and you're confident it's reliable and specifically about Wild Rift (not League PC), may you use your own general knowledge -- and even then, prefer saying the current data isn't available over guessing.
Never invent item effects, stats, cooldowns, champion abilities, rune effects, patch changes, builds, or matchup facts. If the relevant current information genuinely isn't available from any of the three sources above, say so plainly rather than answering confidently anyway -- accuracy matters more than always having an answer.`;

/** Builds the final system prompt sent to the AI provider.
 *
 * `effectivePatch` is the already-resolved current patch string (KV
 * override if set, static fallback otherwise -- see
 * src/lib/effectiveData.js's resolveEffectivePatch(), called by
 * functions/api/coach.js before this function is ever invoked).
 *
 * `riotFallback`, if provided, is `{ content, source }` from
 * functions/_lib/riotFallback.js -- ONLY passed in when Academy grounding
 * found nothing for this question (see functions/api/coach.js), and is
 * always rendered as an explicitly separate, explicitly external section
 * so the model can never confuse it with curated Academy data.
 *
 * Grounding data is entirely optional and independent -- a question can
 * name a champion, items/runes, both, or neither, and only the sections
 * that actually apply get appended. Every section here is already
 * pre-filtered by the caller to ONLY what's relevant to this one
 * question -- this function never receives, and therefore can never
 * accidentally dump, the full champion/item/rune roster. */
export function buildSystemPrompt({
  championContext = null,
  enemyContext = null,
  itemContext = [],
  runeContext = [],
  decisionTreeEntries = [],
  effectivePatch,
  riotFallback = null,
} = {}) {
  const hasAcademyData = championContext || itemContext.length > 0 || runeContext.length > 0;
  const hasAnyData = hasAcademyData || riotFallback;
  if (!hasAnyData) return BASE_INSTRUCTIONS;

  const lines = [BASE_INSTRUCTIONS];

  if (hasAcademyData) {
    lines.push("", `--- Vanguard Academy data for this question (current patch: ${effectivePatch}) ---`);

    if (championContext) {
      lines.push(`Champion: ${championContext.name} (${championContext.role}, tier ${championContext.tier})`);
      if (championContext.note) lines.push(`Coach's note: ${championContext.note}`);

      for (const build of championContext.builds) {
        lines.push(`\nBuild — ${build.name}:`);
        if (build.items.length > 0) lines.push("Items: " + build.items.join(" | "));
        if (build.runes.length > 0) lines.push("Runes: " + build.runes.join(" | "));
      }

      if (championContext.matchups.length > 0) {
        lines.push("\nMatchup notes: " + championContext.matchups.join(" | "));
      }

      if (decisionTreeEntries.length > 0) {
        lines.push(`\nCoach's decision-tree notes for ${championContext.name}:`);
        for (const entry of decisionTreeEntries) lines.push(`- ${entry}`);
      }

      if (enemyContext) {
        lines.push(`\nEnemy in question: ${enemyContext.name} (${enemyContext.role})`);
        if (enemyContext.relevantMatchupNote) {
          lines.push(`Specific matchup note on file: ${enemyContext.relevantMatchupNote}`);
        }
      }
    }

    if (itemContext.length > 0) {
      lines.push("\nItem data (facts, plus Coach's note where one exists):");
      for (const line of itemContext) lines.push(`- ${line}`);
    }

    if (runeContext.length > 0) {
      lines.push("\nRune data (facts, plus Coach's note where one exists):");
      for (const line of runeContext) lines.push(`- ${line}`);
    }
  }

  if (riotFallback) {
    lines.push(
      "",
      "--- Official Riot Wild Rift fallback (EXTERNAL source, not Academy-curated) ---",
      `Source: ${riotFallback.source}`,
      "This is Riot's own latest published Wild Rift patch, discovered independently of Academy's current patch above -- they may be the same or different, and that's expected, not an error.",
      "Use this ONLY to fill in facts the Academy data above didn't cover. It never overrides Academy data above if the two disagree. Treat it as reference material to reason from, not text to quote at length.",
      riotFallback.content
    );
  }

  return lines.join("\n");
}
