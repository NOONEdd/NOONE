// decisionLab -- a controlled test registry (TEMPLATE_TRUST_CONTRACT.md 5a). Test support only; not a suite.
//
// The serving gate reads approval only from a trusted registry entry, and the production
// registry says draft / DRAFT. To reach the checks that sit behind approval, the serving
// tests use a SEPARATE registry whose single entry is an approved copy of the canonical
// template, pinned to the PRODUCTION pins (so the copy's content must be identical; only
// its approval statuses differ). A gate bound to it always reports registry_not_production,
// so nothing it judges can ever be servable. Production is untouched.

import { OBJECTIVE_TRADE_TEMPLATE as T } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { createTemplateRegistry, registryEntries } from "../functions/_lib/decisionLab/templates/registry.js";
import { createServingGate } from "../functions/_lib/decisionLab/validator.js";

/** The canonical template with approved statuses and nothing else changed (deep-frozen: every nested object is T's own). */
export const APPROVED_COPY = Object.freeze({ ...T, status: "approved", rules: Object.freeze({ ...T.rules, status: "APPROVED" }) });

const [production] = registryEntries();
export const APPROVING_REGISTRY = createTemplateRegistry(
  [{ template: APPROVED_COPY, templateId: production.templateId, templateVersion: production.templateVersion, rulesVersion: production.rulesVersion, rulesDigest: production.rulesDigest, dataDigest: production.dataDigest }],
  { name: "test:approved-objective-trade" },
);

/** A serving gate whose only approval authority is APPROVING_REGISTRY. */
export const approvingGate = createServingGate(APPROVING_REGISTRY);

/** Blockers of a test-registry verdict without registry_not_production, which every such verdict carries. */
export const postApprovalBlockers = (r) => r.blockers.filter((b) => b !== "registry_not_production");
