// decisionLab -- trusted template registry (contract: TEMPLATE_TRUST_CONTRACT.md).
//
// A scenario names its template by labels only (templateId, templateVersion,
// rulesVersion). This registry binds each registered label set to the exact
// content it stands for, by PINNED digests written below as literals:
//
//   rulesDigest  hash64(stableStringify(rules without status and notice))
//   dataDigest   hash64(stableStringify(template data without status, rules, runtime))
//
// Approval state (status, notice) is deliberately outside the pins: approving
// content does not change it. Everything else is pinned.
//
// The registry is also the ONLY source of approval for serving: each entry
// captures its canonical template's status and rules.status when the registry
// is built, and the serving gate reads them from there, never from a template
// a caller supplies (TEMPLATE_TRUST_CONTRACT.md 5).
//
//   registered labels, content matches   -> trusted
//   registered labels, content differs   -> template_content_mismatch, everywhere
//   unregistered labels                  -> may be generated and validated
//                                           (engineering use), never evaluated or served
//
// A PIN CHANGES ONLY TOGETHER WITH A VERSION BUMP. Editing the content and its
// pin under the same labels would silently re-bind every stored scenario.
// (tests/decisionLab.determinism.test.mjs [3] separately locks the full content
// at test time, statuses included.) hash64 is a 64-bit change detector, not a
// cryptographic hash: it catches edits, not adversarial collisions.

import { stableStringify, hash64 } from "../fingerprint.js";
import { OBJECTIVE_TRADE_TEMPLATE } from "./objectiveTrade.js";

/** Digest of a rule table's content: everything except its approval state. */
export function rulesContentDigest(rules) {
  const { status, notice, ...content } = rules;
  return hash64(stableStringify(content));
}

/** Digest of a template's non-rule data: everything except status, rules and runtime. */
export function templateDataDigest(template) {
  const { status, rules, runtime, ...data } = template;
  return hash64(stableStringify(data));
}

const PINS = [{ template: OBJECTIVE_TRADE_TEMPLATE, templateId: "objective_trade", templateVersion: 3, rulesVersion: "objective_trade.rules.3", rulesDigest: "642835aed280b6f7", dataDigest: "c30cc4eff657b232" }];

const labelKey = (templateId, templateVersion, rulesVersion) => JSON.stringify([templateId, templateVersion, rulesVersion]);
const digestOr = (f, x) => {
  try {
    return f(x);
  } catch {
    return null; // not canonically serializable: never equal to a pin
  }
};

/** Registries built here (production and controlled test registries): the serving gate accepts no other. */
const BUILT = new WeakSet();

function buildRegistry(pins, name) {
  // Each entry records, once, whether its own canonical template still matches its pins, and the
  // approval state of that template at build time (the only approval the serving gate reads).
  const entries = new Map(
    pins.map((pin) => {
      const t = pin.template;
      const broken = [];
      if (t.id !== pin.templateId || t.version !== pin.templateVersion || t.rules.version !== pin.rulesVersion) broken.push("labels");
      if (digestOr(rulesContentDigest, t.rules) !== pin.rulesDigest) broken.push("rules");
      if (digestOr(templateDataDigest, t) !== pin.dataDigest) broken.push("template");
      if (t.runtime.checkRules(t.rules).length !== 0) broken.push("rules_invalid"); // pinned content must also be well formed
      const approval = Object.freeze({ template: String(t.status), rules: String(t.rules.status) });
      return [labelKey(pin.templateId, pin.templateVersion, pin.rulesVersion), Object.freeze({ ...pin, approval, broken: Object.freeze(broken) })];
    }),
  );
  const entryOf = (template) => (template && typeof template === "object" && template.rules && typeof template.rules === "object" ? entries.get(labelKey(template.id, template.version, template.rules.version)) : undefined);

  /** The registered template for these labels, or null. */
  function registeredTemplate({ templateId, templateVersion, rulesVersion } = {}) {
    const entry = entries.get(labelKey(templateId, templateVersion, rulesVersion));
    return entry ? entry.template : null;
  }

  /** True when `rules` IS a registered, intact (deep-frozen) rule table: its
   *  shape and content are known, so per-call checks can be skipped. */
  function isRegisteredIntactRules(rules) {
    for (const entry of entries.values()) if (entry.template.rules === rules && entry.broken.length === 0) return true;
    return false;
  }

  /** Trust of a template, by its own labels:
   *  { registered, issue: null | { code: "template_unregistered" } | { code: "template_content_mismatch", parts } }
   *  parts: "rules" | "template" (non-rule data) | "runtime" (not the registered runtime object) | "labels".
   *  Never throws. */
  function templateTrust(template) {
    try {
      const entry = entryOf(template);
      if (!entry) return { registered: false, issue: { code: "template_unregistered" } };
      const parts = entry.broken.filter((x) => x !== "labels").map((x) => (x === "rules_invalid" ? "rules" : x));
      const reg = entry.template;
      if (template !== reg) {
        if (template.runtime !== reg.runtime) parts.push("runtime");
        if (template.rules !== reg.rules && digestOr(rulesContentDigest, template.rules) !== entry.rulesDigest) parts.push("rules");
        const keys = (o) => Object.keys(o).filter((k) => k !== "status" && k !== "rules" && k !== "runtime").sort();
        const sameRefs = stableStringify(keys(template)) === stableStringify(keys(reg)) && keys(reg).every((k) => template[k] === reg[k]);
        if (!sameRefs && digestOr(templateDataDigest, template) !== entry.dataDigest) parts.push("template");
      }
      const unique = [...new Set(parts)];
      return { registered: true, issue: unique.length ? { code: "template_content_mismatch", parts: unique } : null };
    } catch {
      return { registered: false, issue: { code: "template_unregistered" } };
    }
  }

  /** The trusted approval for a template's labels: the registry entry's
   *  { template, rules } statuses, or null when the labels are not registered.
   *  The template's OWN status fields are never read. Never throws. */
  function registeredApproval(template) {
    try {
      const entry = entryOf(template);
      return entry ? entry.approval : null;
    } catch {
      return null;
    }
  }

  /** The registry's own state, for tests and audits. */
  function registryEntries() {
    return [...entries.values()].map(({ templateId, templateVersion, rulesVersion, rulesDigest, dataDigest, approval, broken }) => ({ templateId, templateVersion, rulesVersion, rulesDigest, dataDigest, approval: { ...approval }, broken: [...broken] }));
  }

  const registry = Object.freeze({ name, registeredTemplate, isRegisteredIntactRules, templateTrust, registeredApproval, registryEntries });
  BUILT.add(registry);
  return registry;
}

/** The production registry: the literal pins above, built once at load. */
export const TEMPLATE_REGISTRY = buildRegistry(PINS, "production");

/** A separate, controlled registry from explicit pins (for tests: e.g. an
 *  approved copy of a template, to reach the checks behind approval). It never
 *  changes TEMPLATE_REGISTRY, and a serving gate bound to it always reports
 *  registry_not_production, so it cannot make anything servable.
 *  pins: [{ template, templateId, templateVersion, rulesVersion, rulesDigest, dataDigest }] */
export function createTemplateRegistry(pins, { name } = {}) {
  if (typeof name !== "string" || name === "" || name === "production") throw new TypeError("a controlled template registry needs its own name (not \"production\")");
  if (!Array.isArray(pins)) throw new TypeError("pins must be a list");
  return buildRegistry(pins, name);
}

/** True for a registry built by this module (the production one or a controlled one). */
export function isTemplateRegistry(registry) {
  return BUILT.has(registry);
}

// The production registry's lookups, as module functions.
export const { registeredTemplate, isRegisteredIntactRules, templateTrust, registeredApproval, registryEntries } = TEMPLATE_REGISTRY;
