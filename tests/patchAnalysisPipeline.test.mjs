// Patch Intelligence -- multi-batch analysis pipeline regression test.
// Mocks the AI provider (global fetch), never calls a real API. Plain
// Node ESM, no framework. Run directly:
//
//   node tests/patchAnalysisPipeline.test.mjs
//
// Covers spec requirements the two pre-existing revision-focused test
// files don't touch: multiple batches for one patch, bounded per-batch
// retry, retry-with-split on a truncated response, a batch that never
// recovers blocking "complete" (never silently reported as a clean
// pass), and a large synthetic Patch-7.3-SHAPED patch (generic content,
// not this project's actual 7.3 text -- there is no per-patch-version
// logic anywhere in this pipeline to test around).

import { runPatchIntelAnalysis, PATCH_INTEL_ENGINE_VERSION } from '../functions/_lib/patchIntelPipeline.js';
import { htmlToStructuredText } from '../functions/_lib/patchText.js';
import { CHAMPIONS, isAcademyCovered } from '../src/data/champions.js';
import { ITEMS } from '../src/data/items.js';
import { RUNES } from '../src/data/runes.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

const champs = CHAMPIONS.filter(isAcademyCovered);
const championRoster = champs.map((c) => ({ id: c.id, name: c.name, role: c.role, tier: 'B' }));
const itemRoster = ITEMS.map((i) => ({ id: i.id, name: i.name, category: i.category, tier: 'B', info: i.info || '' }));
const runeRoster = RUNES.map((r) => ({ id: r.id, name: r.name, path: r.path, tier: 'B', info: r.info || '' }));
const env = { ANTHROPIC_API_KEY: 'dummy', AI_PROVIDER: 'anthropic' };

function emptyBatchInput(summary) {
  return { supportMetaAnalysis: summary, championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [], entityVerdicts: [] };
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
function toolUseResponse(input, stopReason = 'end_turn') {
  return jsonResponse({ content: [{ type: 'tool_use', name: 'submit_structured_response', input }], stop_reason: stopReason });
}

// ---------------------------------------------------------------------
console.log('\n=== single small patch: exactly one AI call, byte-identical summary passthrough ===');
{
  const { text } = htmlToStructuredText(`<html><body><h1>Patch 7.3a Notes</h1><p>Leona Q, W, and E all received changes this patch.</p></body></html>`);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return toolUseResponse(emptyBatchInput('DELIBERATE_TEXT_9f3')); };
  const result = await runPatchIntelAnalysis({ env, patchContent: text, championRoster, itemRoster, runeRoster });
  check('ok', result.ok === true);
  check('exactly one AI call for a single-batch patch', calls === 1, calls);
  check('complete', result.complete === true);
  check('summary passed through unmodified', result.report.supportMetaAnalysis === 'DELIBERATE_TEXT_9f3', result.report.supportMetaAnalysis);
  check('engineVersion reported', typeof result.engineVersion === 'string' && result.engineVersion.length > 0, result.engineVersion);
  check('engineVersion matches the exported constant', result.engineVersion === PATCH_INTEL_ENGINE_VERSION);
  check('analysisCoverage present and complete', result.report.analysisCoverage && result.report.analysisCoverage.complete === true);
}

// ---------------------------------------------------------------------
console.log('\n=== large synthetic patch (Patch-7.3-shaped, generic content): multiple batches, correct merge + coverage ===');
{
  let body = `<h1>Patch Notes 7.3a</h1><p>Patch 7.3a brings a wide set of changes across champions, items, and the battlefield.</p><h2>CHAMPION CHANGES</h2>`;
  for (const c of champs) body += `<h3>${c.name}</h3><ul><li>Passive: cooldown 20s -> 18s</li><li>Q: damage 60 -> 70</li></ul>`;
  body += `<h2>ITEM CHANGES</h2>`;
  for (const i of ITEMS) body += `<h3>${i.name}</h3><ul><li>Total cost 2400 -> 2300</li></ul>`;
  body += `<h2>RUNE CHANGES</h2>`;
  for (const r of RUNES.slice(0, 12)) body += `<h3>${r.name}</h3><ul><li>Effect strength 8% -> 10%</li></ul>`;
  body += `<h2>BATTLEFIELD ADJUSTMENTS</h2><h3>Jungle</h3><ul><li>Monster damage adjusted</li></ul>`;
  body += `<h2>BUG FIXES</h2><ul><li>Fixed various visual bugs</li></ul>`;
  const { text } = htmlToStructuredText(`<html><body>${body}</body></html>`);

  let calls = 0;
  const seenBatchIndices = new Set();
  globalThis.fetch = async (url, options) => {
    calls++;
    const reqBody = JSON.parse(options.body);
    const sys = reqBody.system;
    const bctx = /excerpt (\d+) of (\d+)/.exec(sys);
    if (bctx) seenBatchIndices.add(`${bctx[1]}/${bctx[2]}`);
    const m = /--- Entities to address in entityVerdicts.*?---\n([\s\S]*?)\n\n---/.exec(sys);
    const entityLines = (m ? m[1].split('\n').filter(Boolean) : []).filter((l) => l !== '(none detected in this excerpt)');
    const names = entityLines.map((l) => l.replace(/\s*\([^)]*\)\s*$/, '').trim());
    // Every OTHER detected entity in this batch "changed but is not Support-relevant";
    // the first champion-type entity gets a real, Support-relevant change.
    const champLine = entityLines.find((l) => l.includes('(champion)'));
    const champName = champLine ? champLine.replace(/\s*\(champion\)\s*$/, '').trim() : null;
    const championChanges = champName ? [{
      championName: champName, whatChanged: 'Q: damage 60 -> 70', previousValue: '60', newValue: '70', type: 'Buff',
      supportImpact: 'x', impactSeverity: 'Low', gameplayImplications: '', buildImplications: '', runeImplications: '',
      matchupImplications: '', tierListActionNeeded: false, recommendedTierAction: 'No change', reasoning: '', confidence: 'Low',
    }] : [];
    const entityVerdicts = names.map((name) => ({ name, detected: true, changed: name === champName, supportRelevant: name === champName }));
    return toolUseResponse({ supportMetaAnalysis: `Batch ${calls} summary.`, championChanges, itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [], entityVerdicts });
  };

  const result = await runPatchIntelAnalysis({ env, patchContent: text, championRoster, itemRoster, runeRoster });
  check('ok', result.ok === true);
  check('more than one AI call made (multi-batch)', calls > 1, calls);
  check('complete', result.complete === true);
  const cov = result.report.analysisCoverage;
  check('every planned batch succeeded', cov.batches.failed === 0 && cov.batches.notStarted === 0, cov.batches);
  check('batch context (excerpt X of N) sent with a consistent, sane N across calls', (() => {
    const totals = [...seenBatchIndices].map((s) => s.split('/')[1]);
    return new Set(totals).size === 1 && Number(totals[0]) === cov.batches.planned;
  })(), [...seenBatchIndices]);
  check('coverage totalEntities matches full roster size', cov.totalEntities === championRoster.length + itemRoster.length + runeRoster.length, cov.totalEntities);
  check('coverage detectedEntities matches what was actually put in the patch text', cov.detectedEntities === champs.length + ITEMS.length + 12, `detected=${cov.detectedEntities}`);
  const championNames = result.report.championChanges.map((c) => c.championName);
  check('championChanges has no duplicate entities (cross-batch merge dedupes correctly)', new Set(championNames).size === championNames.length, championNames);
  check('championChanges count is bounded by batch count (one flagged champion per batch in this mock, never more)', result.report.championChanges.length > 0 && result.report.championChanges.length <= cov.batches.planned, { count: result.report.championChanges.length, batches: cov.batches.planned });
  check('changed_relevant state count matches championChanges count', cov.states.changed_relevant === result.report.championChanges.length, cov.states);
  check('runes never mentioned in the patch are not_detected', cov.states.not_detected === runeRoster.length - 12, cov.states);
  check('no entity left in a "detected_unknown" limbo state (every detected entity got an explicit AI verdict)', cov.states.detected_unknown === 0, cov.states);
}

// ---------------------------------------------------------------------
console.log('\n=== one batch permanently fails: result is ok, but NOT complete, and never silently presented as a clean pass ===');
{
  // Two champions -> likely one batch (small content), so force TWO
  // batches deterministically by using two totally separate top-level
  // sections far apart in size isn't needed -- instead we drive this by
  // making every call to batch "B02" (or whichever the 2nd is) fail by
  // inspecting the excerpt index in the request, while batch 1 succeeds.
  let body = `<h1>Patch</h1><h2>CHAMPION CHANGES</h2>`;
  const twoChamps = champs.slice(0, 2);
  for (const c of twoChamps) body += `<h3>${c.name}</h3><ul><li>Q up</li></ul>`;
  const { text } = htmlToStructuredText(`<html><body>${body}</body></html>`);

  // Force exactly one batch to fail permanently: fail every single call
  // (simplest deterministic way to prove "ok but not complete" can only
  // happen when NOT every batch fails -- so here we instead simulate a
  // 2-batch plan by shrinking PATCH_INTEL_BATCH_MAX_ENTITIES's effective
  // reach isn't directly controllable from the test, so we assert the
  // single-batch case's failure mode instead: ok:false when the only
  // batch fails, which the OTHER test above (single small patch) already
  // proves succeeds -- covered instead via the multi-batch large patch,
  // where we fail every OTHER call.
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    const reqBody = JSON.parse(options.body);
    const bctx = /excerpt (\d+) of (\d+)/.exec(reqBody.system);
    const idx = bctx ? Number(bctx[1]) : 1;
    if (idx === 2) return jsonResponse({ error: { message: 'server error' } }, 500);
    return toolUseResponse(emptyBatchInput(`ok-${idx}`));
  };

  // Build a patch large enough to force >= 2 batches deterministically:
  // reuse the large synthetic body from the previous block's champion
  // section only (36 champions at ~14/batch -> multiple batches).
  let bigBody = `<h1>Patch</h1><h2>CHAMPION CHANGES</h2>`;
  for (const c of champs) bigBody += `<h3>${c.name}</h3><ul><li>Q up</li></ul>`;
  const { text: bigText } = htmlToStructuredText(`<html><body>${bigBody}</body></html>`);

  const result = await runPatchIntelAnalysis({ env, patchContent: bigText, championRoster, itemRoster, runeRoster });
  check('still ok (at least one batch succeeded)', result.ok === true);
  check('NOT complete', result.complete === false);
  check('coverage reports the failed batch', result.report.analysisCoverage.batches.failed >= 1, result.report.analysisCoverage.batches);
  check('coverage reports at least one unresolved entity', result.report.analysisCoverage.states.unresolved > 0, result.report.analysisCoverage.states);
  check('failure is retried up to the bound before being reported (not just given up on first try)', calls > result.report.analysisCoverage.batches.planned, calls);
}

// ---------------------------------------------------------------------
console.log('\n=== every batch fails: ok:false, never silently returns a fake success ===');
{
  const { text } = htmlToStructuredText(`<html><body><h1>Patch</h1><p>Leona changes this patch.</p></body></html>`);
  globalThis.fetch = async () => jsonResponse({ error: { message: 'down' } }, 503);
  const result = await runPatchIntelAnalysis({ env, patchContent: text, championRoster, itemRoster, runeRoster });
  check('ok:false when every batch fails', result.ok === false);
  check('a specific error code is given', typeof result.code === 'string' && result.code.length > 0, result.code);
}

// ---------------------------------------------------------------------
console.log('\n=== truncated response on a multi-unit batch triggers split, not identical retry ===');
{
  const twoChamps = champs.slice(0, 2);
  let body = `<h1>Patch</h1><h2>CHAMPION CHANGES</h2>`;
  for (const c of twoChamps) body += `<h3>${c.name}</h3><ul><li>Q up</li></ul>`;
  const { text } = htmlToStructuredText(`<html><body>${body}</body></html>`);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return jsonResponse({ content: [], stop_reason: 'max_tokens' }); // whole batch truncates once
    return toolUseResponse(emptyBatchInput(`half-${calls}`));
  };
  const result = await runPatchIntelAnalysis({ env, patchContent: text, championRoster: twoChamps.map((c) => ({ id: c.id, name: c.name, role: c.role, tier: 'B' })), itemRoster, runeRoster });
  check('ok after split-and-retry', result.ok === true);
  check('complete', result.complete === true);
  check('exactly 3 calls: 1 failed whole-batch attempt + 2 successful half-batch retries', calls === 3, calls);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
