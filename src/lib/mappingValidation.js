// Mapping integrity validation -- checks that every value the data uses has a complete display mapping, and that every
// mapping is itself valid. Pure and dependency-free (registries and datasets are passed in), so the same code runs in
// tests/mappingIntegrity.test.mjs (the gate: fails on any FATAL issue), in the browser after Coach Mode data loads (dev
// builds only -- see src/App.jsx), and anywhere else a dataset needs checking. Never runs per render.
//
// SEVERITY
//   fatal        canonical data or the registry itself is broken: a shipped value has no complete mapping, or a mapping
//                holds something that is not a component / color. Must be fixed in code before release.
//   recoverable  runtime data (Coach Mode overrides) the UI cannot map; the UI shows it with the neutral fallback /
//                an "unrecognized tier" row instead of crashing or hiding it, but the value still needs correcting.
//   warning      renders fine but is inconsistent (e.g. a coached champion filed under a lane tag, an override for an
//                id that does not exist in the catalog -- the site ignores it).
//   info         registry keys no data currently uses (not an error -- reported so dead entries are visible).

import { isIconComponent, isColorValue } from "./displayRegistry.js";

export const SEVERITY = Object.freeze({ FATAL: "fatal", RECOVERABLE: "recoverable", WARNING: "warning", INFO: "info" });

const hasOwn = (obj, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);
const norm = (v) => String(v).trim().replace(/\s+/g, " ").toLowerCase();

function issue(fields) {
  return Object.freeze({ dataset: null, entityId: null, entityName: null, field: null, value: undefined, registry: null, missing: [], suggestion: null, ...fields });
}

/** A registry's own entries: every required field valid, keys clean and unambiguous. */
export function validateRegistry(registry) {
  const issues = [];
  const seen = new Map();
  for (const key of registry.keys) {
    const entry = registry.config[key];
    if (typeof key !== "string" || !key.trim() || key !== key.trim()) {
      issues.push(issue({ severity: SEVERITY.FATAL, kind: "invalid-registry-key", registry: registry.name, value: key, message: `${registry.name}: key ${JSON.stringify(key)} is empty or has leading/trailing whitespace` }));
    }
    const k = norm(key);
    if (seen.has(k)) {
      issues.push(issue({ severity: SEVERITY.FATAL, kind: "ambiguous-registry-key", registry: registry.name, value: key, suggestion: seen.get(k), message: `${registry.name}: keys ${JSON.stringify(seen.get(k))} and ${JSON.stringify(key)} differ only by case/spacing` }));
    } else seen.set(k, key);
    if (registry.requires.includes("icon") && !isIconComponent(entry.icon)) {
      issues.push(issue({ severity: SEVERITY.FATAL, kind: entry.icon === undefined ? "missing-icon" : "invalid-icon", registry: registry.name, value: key, missing: ["icon"], message: `${registry.name}: ${JSON.stringify(key)} has ${entry.icon === undefined ? "no icon" : `an icon that is not a React component (${typeof entry.icon})`}` }));
    }
    if (registry.requires.includes("color") && !isColorValue(entry.color)) {
      issues.push(issue({ severity: SEVERITY.FATAL, kind: entry.color === undefined ? "missing-color" : "invalid-color", registry: registry.name, value: key, missing: ["color"], message: `${registry.name}: ${JSON.stringify(key)} has ${entry.color === undefined ? "no color" : `an invalid color ${JSON.stringify(entry.color)}`}` }));
    }
  }
  return issues;
}

/** Every entity's `field` value must be an own key of `registry`. A near-miss (case / whitespace) carries a suggestion. */
export function validateField({ dataset, entities, field, registry, severity = SEVERITY.FATAL }) {
  const issues = [];
  const byNorm = new Map(registry.keys.map((k) => [norm(k), k]));
  for (const e of entities || []) {
    const value = e ? e[field] : undefined;
    const base = { dataset, entityId: e && e.id != null ? e.id : null, entityName: e && e.name != null ? e.name : null, field, value, registry: registry.name };
    if (typeof value !== "string") {
      issues.push(issue({ ...base, severity, kind: value === undefined || value === null ? "missing-value" : "invalid-value-type", missing: [...registry.requires], message: `${dataset} "${base.entityId}": ${field} is ${value === undefined || value === null ? "missing" : `a ${typeof value}, not a string`}` }));
      continue;
    }
    if (hasOwn(registry.config, value)) continue;
    const suggestion = byNorm.get(norm(value)) || null;
    issues.push(issue({
      ...base, severity, kind: suggestion ? "mapping-key-mismatch" : "missing-mapping-key", missing: [...registry.requires], suggestion,
      message: `${dataset} "${base.entityId}" (${base.entityName}): ${field} ${JSON.stringify(value)} has no ${registry.requires.join(" / ")} mapping in ${registry.name}${suggestion ? ` -- did you mean ${JSON.stringify(suggestion)}? (case/whitespace differs)` : ""}`,
    }));
  }
  return issues;
}

/** Registry keys that no entity uses. */
export function unusedKeys(registry, usedValues) {
  const used = new Set(usedValues);
  return registry.keys.filter((k) => !used.has(k));
}

/**
 * Coach Mode overrides (runtime, from KV or this browser's local copy). Only `tier` reaches a display registry -- role,
 * category and path always come from the canonical data (src/lib/effectiveData.js never takes them from an override).
 */
export function validateOverrides(overrides, { tierRegistry, catalogs }) {
  const issues = [];
  for (const [mapName, list] of Object.entries(catalogs)) {
    const map = overrides && overrides[mapName];
    if (map === undefined || map === null) continue;
    if (typeof map !== "object" || Array.isArray(map)) {
      issues.push(issue({ severity: SEVERITY.RECOVERABLE, kind: "invalid-override-map", dataset: `overrides.${mapName}`, value: map, message: `overrides.${mapName} is not an object` }));
      continue;
    }
    const ids = new Set(list.map((e) => e.id));
    for (const [id, entry] of Object.entries(map)) {
      const base = { dataset: `overrides.${mapName}`, entityId: id, entityName: (list.find((e) => e.id === id) || {}).name || null };
      if (!ids.has(id)) {
        issues.push(issue({ ...base, severity: SEVERITY.WARNING, kind: "override-unknown-entity", message: `overrides.${mapName}["${id}"]: no ${mapName.replace(/s$/, "")} with that id exists -- the site ignores this override` }));
      }
      if (!entry || typeof entry !== "object" || !("tier" in entry) || entry.tier === "" || entry.tier === null || entry.tier === undefined) continue; // "" / null = fall back to the base tier
      issues.push(...validateField({ dataset: `overrides.${mapName}`, entities: [{ id, name: base.entityName, tier: entry.tier }], field: "tier", registry: tierRegistry, severity: SEVERITY.RECOVERABLE }));
    }
  }
  return issues;
}

/**
 * The whole Academy: registries, canonical datasets, role-vocabulary consistency, and (optionally) Coach Mode overrides.
 * @param {object} args
 * @param {{tier, championRole, itemCategory, runePath}} args.registries   from src/data/constants.js DISPLAY_REGISTRIES
 * @param {Array} args.champions, args.items, args.runes                    CANONICAL data (src/data/*.js), not effective data --
 *                                                                          so an override problem is reported as such, not as a data bug
 * @param {object} [args.overrides]                                         Coach Mode overrides, if loaded
 * @param {(champion) => boolean} [args.isCovered]                          src/data/champions.js isAcademyCovered
 * @returns {{ ok:boolean, issues:object[], counts:object, coverage:object[] }}  ok = no fatal issue
 */
export function validateAcademyMappings({ registries, champions = [], items = [], runes = [], overrides = null, isCovered = null }) {
  const issues = [];
  for (const r of Object.values(registries)) issues.push(...validateRegistry(r));

  const fields = [
    { registry: registries.championRole, dataset: "champions", entities: champions, field: "role" },
    { registry: registries.itemCategory, dataset: "items", entities: items, field: "category" },
    { registry: registries.runePath, dataset: "runes", entities: runes, field: "path" },
  ];
  const tierUses = [["champions", champions], ["items", items], ["runes", runes]];
  for (const f of fields) issues.push(...validateField(f));
  for (const [dataset, entities] of tierUses) issues.push(...validateField({ dataset, entities, field: "tier", registry: registries.tier }));

  // the role field's two vocabularies (see ROLE_REGISTRY in src/data/constants.js): coached champions use a support archetype,
  // roster-only champions a lane tag. A mismatch renders fine but means the champion is filed under the wrong vocabulary.
  if (isCovered) {
    for (const c of champions) {
      const entry = hasOwn(registries.championRole.config, c.role) ? registries.championRole.config[c.role] : null;
      if (!entry || !entry.group) continue;
      const expected = isCovered(c) ? "support" : "lane";
      if (entry.group !== expected) {
        issues.push(issue({ severity: SEVERITY.WARNING, kind: "role-vocabulary-mismatch", dataset: "champions", entityId: c.id, entityName: c.name, field: "role", value: c.role, registry: registries.championRole.name, message: `champions "${c.id}" (${c.name}): ${isCovered(c) ? "an Academy-coached" : "a roster-only"} champion uses the ${entry.group} role ${JSON.stringify(c.role)}; expected a ${expected} role` }));
      }
    }
  }

  if (overrides) issues.push(...validateOverrides(overrides, { tierRegistry: registries.tier, catalogs: { champions, items, runes } }));

  const coverage = [];
  const used = new Map();
  for (const f of fields) used.set(f.registry.name, (used.get(f.registry.name) || []).concat(f.entities.map((e) => e[f.field])));
  used.set(registries.tier.name, tierUses.flatMap(([, list]) => list.map((e) => e.tier)));
  for (const r of Object.values(registries)) {
    const values = [...new Set(used.get(r.name) || [])];
    const missing = values.filter((v) => !hasOwn(r.config, v));
    const unused = unusedKeys(r, values);
    for (const k of unused) issues.push(issue({ severity: SEVERITY.INFO, kind: "unused-registry-key", registry: r.name, value: k, message: `${r.name}: ${JSON.stringify(k)} is defined but no canonical data uses it` }));
    coverage.push({ registry: r.name, description: r.description, values, mapped: values.filter((v) => hasOwn(r.config, v)), missing, unused, keys: [...r.keys] });
  }

  const counts = { fatal: 0, recoverable: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return { ok: counts.fatal === 0, issues, counts, coverage };
}

/** Human-readable report (console / test output). Info lines only when `verbose`. */
export function formatMappingReport(report, { verbose = false } = {}) {
  const order = [SEVERITY.FATAL, SEVERITY.RECOVERABLE, SEVERITY.WARNING, SEVERITY.INFO];
  const lines = [`Mapping integrity: ${report.ok ? "OK" : "FAILED"} -- ${report.counts.fatal} fatal, ${report.counts.recoverable} recoverable, ${report.counts.warning} warning, ${report.counts.info} info`];
  for (const sev of order) {
    if (sev === SEVERITY.INFO && !verbose) continue;
    for (const i of report.issues.filter((x) => x.severity === sev)) lines.push(`  [${sev}] ${i.kind}: ${i.message}`);
  }
  return lines.join("\n");
}
