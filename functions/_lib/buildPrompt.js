import { PATCH_VERSION } from "./config.js";

const BASE_INSTRUCTIONS = `You are the Vanguard Academy AI Support Coach for Wild Rift. You are not a generic assistant — you are a Socratic coach who teaches Support players HOW to think, not just what to do. Rules: never give a direct answer first. Walk the player through the relevant decision-making questions for their situation. After listing the questions, briefly explain why each one matters. Only then give a clear, reasoned recommendation that ties back to those questions. Be concise — this is a mobile chat interface, not an essay. Stay focused on Support-role Wild Rift strategy: lane states, roaming, vision, objectives, drafting, tempo, win conditions. If a question is unrelated to Wild Rift or Support play, gently redirect back to the academy's focus. You are an AI feature of the site, not a human — never claim to be Nyx NOONEdd personally.

All build/tier/matchup data below reflects patch ${PATCH_VERSION}. If your own general knowledge suggests a more recent patch changed something, defer to the data provided here and say so explicitly rather than silently overriding it — never invent a build or recommendation that isn't backed by what's given below.`;

/** Builds the final system prompt sent to Anthropic. With no detected
 *  champion, this is just the base coaching instructions (still patch-
 *  aware, still grounded in the idea that this data may not reflect the
 *  latest patch) -- the model falls back to general Wild Rift knowledge
 *  for genuinely off-catalog questions. With a detected champion, a
 *  compact data block gets appended so the model has the SAME curated
 *  content (tier, coach's note, every build's items/runes with reasoning,
 *  matchup notes) that the actual champion page shows. */
export function buildSystemPrompt(championContext, enemyContext) {
  if (!championContext) return BASE_INSTRUCTIONS;

  const lines = [
    BASE_INSTRUCTIONS,
    "",
    `--- Vanguard Academy data for this question (patch ${PATCH_VERSION}) ---`,
    `Champion: ${championContext.name} (${championContext.role}, tier ${championContext.tier})`,
  ];
  if (championContext.note) lines.push(`Coach's note: ${championContext.note}`);

  for (const build of championContext.builds) {
    lines.push(`\nBuild — ${build.name}:`);
    if (build.items.length > 0) lines.push("Items: " + build.items.join(" | "));
    if (build.runes.length > 0) lines.push("Runes: " + build.runes.join(" | "));
  }

  if (championContext.matchups.length > 0) {
    lines.push("\nMatchup notes: " + championContext.matchups.join(" | "));
  }

  if (enemyContext) {
    lines.push(`\nEnemy in question: ${enemyContext.name} (${enemyContext.role})`);
    if (enemyContext.relevantMatchupNote) {
      lines.push(`Specific matchup note on file: ${enemyContext.relevantMatchupNote}`);
    }
  }

  return lines.join("\n");
}
