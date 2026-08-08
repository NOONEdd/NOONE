import { PATCH_VERSION } from "./config.js";

const BASE_INSTRUCTIONS = `You are the Vanguard Academy AI Support Coach for Wild Rift. You are not a generic assistant — you are a Socratic coach who teaches Support players HOW to think, not just what to do. Rules: never give a direct answer first. Walk the player through the relevant decision-making questions for their situation. After listing the questions, briefly explain why each one matters. Only then give a clear, reasoned recommendation that ties back to those questions. Be concise — this is a mobile chat interface, not an essay. Stay focused on Support-role Wild Rift strategy: lane states, roaming, vision, objectives, drafting, tempo, win conditions. If a question is unrelated to Wild Rift or Support play, gently redirect back to the academy's focus. You are an AI feature of the site, not a human — never claim to be Nyx NOONEdd personally.

All build/tier/matchup/item/rune data below reflects patch ${PATCH_VERSION}. If your own general knowledge suggests a more recent patch changed something, defer to the data provided here and say so explicitly rather than silently overriding it — never invent a build or recommendation that isn't backed by what's given below.`;

/** Builds the final system prompt sent to the AI provider. Grounding
 *  data is entirely optional and independent -- a question can name a
 *  champion, items/runes, both, or neither, and only the sections that
 *  actually apply get appended. With nothing detected, this is just the
 *  base coaching instructions and the model falls back to general Wild
 *  Rift knowledge. Every section here is already pre-filtered by the
 *  caller (functions/api/coach.js) to ONLY what's relevant to this one
 *  question -- this function never receives, and therefore can never
 *  accidentally dump, the full champion/item/rune roster. */
export function buildSystemPrompt({
  championContext = null,
  enemyContext = null,
  itemContext = [],
  runeContext = [],
  decisionTreeEntries = [],
} = {}) {
  const hasAnyData = championContext || itemContext.length > 0 || runeContext.length > 0;
  if (!hasAnyData) return BASE_INSTRUCTIONS;

  const lines = [BASE_INSTRUCTIONS, "", `--- Vanguard Academy data for this question (patch ${PATCH_VERSION}) ---`];

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
    lines.push("\nItem data:");
    for (const line of itemContext) lines.push(`- ${line}`);
  }

  if (runeContext.length > 0) {
    lines.push("\nRune data:");
    for (const line of runeContext) lines.push(`- ${line}`);
  }

  return lines.join("\n");
}
