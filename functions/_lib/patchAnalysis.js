// Per-batch AI execution for Patch Intelligence's multi-stage pipeline.
// functions/_lib/patchPlanner.js decides WHAT goes in each batch; this
// file is what actually calls the AI for one batch, with three kinds of
// resilience layered on top of the plain per-batch primitives in
// patchIntelligence.js (buildBatchSystemPrompt / parseAIJson /
// normalizePatchIntelReport / normalizeEntityVerdicts):
//
//   1. bounded same-batch retry (PATCH_INTEL_BATCH_MAX_ATTEMPTS) for
//      transient failures (a provider error, a malformed response) --
//      retrying the identical batch is worth trying again for these,
//      since nothing about the batch itself was the problem;
//   2. retry-with-split (PATCH_INTEL_MAX_SPLIT_DEPTH) specifically for a
//      TRUNCATED response -- an identical retry would very likely
//      truncate again for the same reason, so the batch is instead cut
//      in half (patchPlanner.js's splitBatchInHalf, at a unit boundary,
//      never mid-change) and each half is retried independently, so a
//      handful of unusually verbose entities can't take an entire
//      batch's worth of OTHER entities down with them;
//   3. a wall-clock budget (PATCH_INTEL_REQUEST_BUDGET_MS) across the
//      WHOLE run -- Cloudflare Pages Functions have a finite execution
//      time per HTTP request, and there is no cross-request "continue"
//      mechanism implemented (a genuine limitation; see the delivery
//      report). Once the budget is spent, no NEW batch call is started;
//      anything not yet started is reported as unresolved (never
//      silently dropped -- see patchAggregate.js), and the admin's
//      existing Retry Analysis action reprocesses everything from
//      scratch, same as it always has for a single failed AI call.
//
// A batch that still can't succeed after all of the above is reported
// as a genuine failure for its unit(s) -- never silently skipped, never
// papered over as "no changes." Pure orchestration: no persistence, no
// KV, no notification -- all of that stays in functions/api/admin/
// patch-check.js via patchIntelPipeline.js.

import { callAIProvider } from "./aiProvider.js";
import { renderUnit } from "./patchParser.js";
import { splitBatchInHalf } from "./patchPlanner.js";
import {
  buildBatchSystemPrompt,
  BATCH_REPORT_JSON_SCHEMA,
  parseAIJson,
  normalizePatchIntelReport,
  normalizeEntityVerdicts,
} from "./patchIntelligence.js";
import {
  PATCH_INTEL_MAX_TOKENS,
  PATCH_INTEL_BATCH_MAX_ATTEMPTS,
  PATCH_INTEL_MAX_SPLIT_DEPTH,
  PATCH_INTEL_CONCURRENCY,
  PATCH_INTEL_CALL_TIMEOUT_MS,
  PATCH_INTEL_REQUEST_BUDGET_MS,
} from "./config.js";

export const ANALYSIS_VERSION = "analysis-v1";

/** Races one AI call against PATCH_INTEL_CALL_TIMEOUT_MS. This does NOT
 *  cancel the underlying request -- aiProvider.js's adapters take no
 *  abort signal (see config.js's own note on this constant) -- it only
 *  stops this function from waiting on it forever, so one unresponsive
 *  call can't stall the whole pipeline past its wall-clock budget. */
function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, code: "ai_timeout", error: "The AI analyst didn't respond in time for this batch.", logDetail: `No response within ${ms}ms.` }),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** One AI call for one batch, no retry. Returns
 *  { ok: true, report, entityVerdicts, parseStrategy } or
 *  { ok: false, code, error, logDetail }. Never throws. */
async function runOneBatchAttempt({ env, batch, batchIndex, batchTotal, patchTitle, patchIntro, championRoster, itemRoster, runeRoster }) {
  const batchText = batch.units.map(renderUnit).join("\n\n");
  const systemPrompt = buildBatchSystemPrompt({
    batchIndex, batchTotal, patchTitle, patchIntro, batchText,
    forcedEntities: batch.entities, championRoster, itemRoster, runeRoster,
  });

  const result = await withTimeout(
    callAIProvider({
      env,
      systemPrompt,
      messages: [{ role: "user", content: `Analyze excerpt ${batchIndex} of ${batchTotal} now and return ONLY the JSON object described in your instructions.` }],
      maxTokens: PATCH_INTEL_MAX_TOKENS,
      jsonSchema: BATCH_REPORT_JSON_SCHEMA,
    }),
    PATCH_INTEL_CALL_TIMEOUT_MS
  );

  if (!result.ok) {
    return {
      ok: false,
      code: result.code === "truncated_output" ? "truncated_output" : result.code === "ai_timeout" ? "ai_timeout" : "ai_error",
      error: result.error,
      logDetail: result.logDetail,
    };
  }

  // Checked BEFORE attempting to parse -- see patchIntelligence.js's
  // previous single-call version of this same check for why: a
  // truncated reply is deterministically not valid JSON, so a specific
  // "cut off" error is more useful than a generic "invalid JSON" one.
  if (result.truncated) {
    return {
      ok: false,
      code: "truncated_output",
      error: `The AI analyst's response for this excerpt was cut off before it finished (hit the ${PATCH_INTEL_MAX_TOKENS}-token hard maximum).`,
      logDetail: `finishReason: ${result.finishReason}. Reply length: ${(result.reply || "").length} chars. Reply tail (last 300 chars): ${JSON.stringify((result.reply || "").slice(-300))}.`,
    };
  }

  const parseResult = parseAIJson(result.reply);
  if (!parseResult) {
    return {
      ok: false,
      code: "ai_invalid_output",
      error: "The AI analyst didn't return valid JSON for this excerpt.",
      logDetail: `All parse strategies failed. finishReason: ${result.finishReason}. Reply length: ${(result.reply || "").length} chars. Raw reply (first 500 chars): ${JSON.stringify((result.reply || "").slice(0, 500))}`,
    };
  }

  const normalized = normalizePatchIntelReport(parseResult.parsed, { championRoster, itemRoster, runeRoster });
  if (!normalized) {
    return {
      ok: false,
      code: "ai_invalid_output",
      error: "The AI analyst's response for this excerpt didn't match the expected report shape.",
      logDetail: `Parsed via "${parseResult.strategy}" strategy but the shape was unusable: ${JSON.stringify(parseResult.parsed).slice(0, 300)}`,
    };
  }

  const entityVerdicts = normalizeEntityVerdicts(parseResult.parsed.entityVerdicts, batch.entities);
  return { ok: true, report: normalized, entityVerdicts, parseStrategy: parseResult.strategy };
}

/** Runs one batch to completion: bounded same-batch retries, then --
 *  only for a truncated response on a batch with more than one unit --
 *  a split into two independently-retried halves. Returns a result tree
 *  (a split failure/success carries `parts`, the recursive results for
 *  each half) rather than a flat list, so patchAggregate.js can walk it
 *  and know exactly which original units ended up resolved vs. not. */
async function runBatchWithRetries(ctx, batch, splitDepth) {
  let lastFailure = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= PATCH_INTEL_BATCH_MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    const outcome = await runOneBatchAttempt({ ...ctx, batch });
    if (outcome.ok) {
      return {
        ok: true, batchId: batch.id, unitIds: batch.unitIds, entities: batch.entities,
        report: outcome.report, entityVerdicts: outcome.entityVerdicts, parseStrategy: outcome.parseStrategy,
        attempts, splitDepth,
      };
    }
    lastFailure = outcome;
    if (outcome.code === "truncated_output" && batch.units.length > 1 && splitDepth < PATCH_INTEL_MAX_SPLIT_DEPTH) break;
  }

  if (lastFailure && lastFailure.code === "truncated_output" && batch.units.length > 1 && splitDepth < PATCH_INTEL_MAX_SPLIT_DEPTH) {
    const halves = splitBatchInHalf(batch, ctx.index);
    const parts = [];
    for (const half of halves) parts.push(await runBatchWithRetries(ctx, half, splitDepth + 1));
    const ok = parts.every((p) => p.ok);
    return {
      ok, batchId: batch.id, unitIds: batch.unitIds, entities: batch.entities,
      split: true, parts, attempts, splitDepth,
      code: ok ? undefined : "partial_split_failure",
      error: ok ? undefined : "One or more halves of a split excerpt still failed after retrying.",
    };
  }

  return {
    ok: false, batchId: batch.id, unitIds: batch.unitIds, entities: batch.entities,
    code: lastFailure ? lastFailure.code : "ai_error",
    error: lastFailure ? lastFailure.error : "Unknown batch failure.",
    logDetail: lastFailure ? lastFailure.logDetail : "",
    attempts, splitDepth,
  };
}

/** Runs every batch in the plan, up to PATCH_INTEL_CONCURRENCY at once,
 *  and stops STARTING new batches once PATCH_INTEL_REQUEST_BUDGET_MS has
 *  elapsed (already-started batches still finish). Returns
 *  { results, notStartedBatches, durationMs } -- results is in plan
 *  order (one entry per batch that was at least started); a batch the
 *  time budget prevented from starting at all is listed separately in
 *  notStartedBatches, never silently absent from both. */
export async function runAllBatches({ env, plan, patchTitle, patchIntro, championRoster, itemRoster, runeRoster }) {
  const ctx = { env, index: plan.index, patchTitle, patchIntro, championRoster, itemRoster, runeRoster };
  const total = plan.batches.length;
  const startedAt = Date.now();
  const results = new Array(total);

  let nextIndex = 0;
  async function worker() {
    for (;;) {
      if (Date.now() - startedAt > PATCH_INTEL_REQUEST_BUDGET_MS) return;
      const i = nextIndex++;
      if (i >= total) return;
      const batch = plan.batches[i];
      results[i] = await runBatchWithRetries({ ...ctx, batchIndex: i + 1, batchTotal: total }, batch, 0);
    }
  }

  const workerCount = Math.max(1, Math.min(PATCH_INTEL_CONCURRENCY, total));
  if (total > 0) await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const notStartedBatches = [];
  const settled = [];
  for (let i = 0; i < total; i++) {
    if (results[i]) settled.push(results[i]);
    else notStartedBatches.push(plan.batches[i]);
  }

  return { results: settled, notStartedBatches, durationMs: Date.now() - startedAt };
}
