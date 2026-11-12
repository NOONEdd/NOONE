// Display registries -- the ONE way a data value (a champion role, an item category, a rune path, a tier) is turned into
// UI properties (an icon component, a color). Pure, dependency-free ES module: no React import, no data import, so
// it is usable from the browser bundle, from Node tests, and from anything else without pulling in JSX.
//
// WHY THIS EXISTS: every one of these used to be a bare object lookup (`ROLE_ICONS[c.role]`) whose result went straight into
// JSX. A value the map did not know -- a new role such as "Marksman Support" added to the data before its icon, a typo, a
// Coach Mode tier the board has no row for -- produced `undefined`, and `<undefined />` crashed the whole page (React #130).
// A bare lookup also answers for keys the map never defined: `ROLE_ICONS["constructor"]` is Object's constructor FUNCTION,
// which React would happily try to render. lookupDisplay() below only ever answers from the registry's OWN keys, never
// returns anything but a valid component and a usable color, and reports every miss once so a fallback can never quietly
// hide an incomplete mapping (the same misses also fail tests/mappingIntegrity.test.mjs).

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");

/** True for something React can render as `<Icon />`: a function/class component, or a forwardRef/memo wrapper (what
 *  lucide-react exports). A string (an icon NAME), null, undefined, or any other object is not. */
export function isIconComponent(value) {
  if (typeof value === "function") return true;
  return Boolean(value) && typeof value === "object" && (value.$$typeof === FORWARD_REF || value.$$typeof === MEMO);
}

/** The color formats this site actually uses: #rgb / #rrggbb, or a CSS custom property reference such as var(--text-dimmer). */
export function isColorValue(value) {
  return typeof value === "string" && (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) || /^var\(--[a-z0-9-]+\)$/i.test(value));
}

const hasOwn = (obj, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Declares one registry. `entries` is an ordered list of [key, { icon?, color?, ...metadata }]; the order is the
 * display order (filter pills, tier rows). `requires` names the fields every entry must carry ("icon", "color").
 * Returns a frozen descriptor that lookupDisplay(), the derived legacy maps and the validator all read -- so a key's icon,
 * color and position are defined exactly once.
 */
export function defineRegistry({ name, description, entries, requires = ["icon", "color"], fallback }) {
  const config = {};
  for (const [key, entry] of entries) config[key] = Object.freeze({ ...entry });
  return Object.freeze({
    name,
    description: description || name,
    requires: Object.freeze([...requires]),
    keys: Object.freeze(entries.map(([key]) => key)),
    config: Object.freeze(config),
    fallback: Object.freeze({ ...fallback }),
  });
}

/** A legacy `{ key: value }` map (e.g. ROLE_ICONS) derived from a registry, so existing imports keep working unchanged. */
export function deriveMap(registry, prop) {
  const out = {};
  for (const key of registry.keys) out[key] = registry.config[key][prop];
  return Object.freeze(out);
}

// ---- diagnostics: reported once per (registry, key, problem) per page load -- never on every render ----
const reported = new Set();
let sink = (message, details) => { if (typeof console !== "undefined") console.warn(message, details); };

/** Redirects mapping diagnostics (tests capture them; nothing else needs to). Returns a function restoring the previous sink. */
export function setMappingDiagnosticSink(fn) {
  const previous = sink;
  sink = fn;
  return () => { sink = previous; };
}
/** Forgets which misses were already reported (tests only). */
export function resetMappingDiagnostics() {
  reported.clear();
}

export function reportMappingIssue(registryName, key, problems, context) {
  const id = `${registryName}␟${String(key)}␟${problems.join(",")}`;
  if (reported.has(id)) return;
  reported.add(id);
  sink(`[mapping] ${registryName}: no valid ${problems.join(" / ")} for ${JSON.stringify(key)} -- rendering the neutral fallback. Add it to src/data/constants.js.`, {
    registry: registryName, key, missing: problems, ...(context || {}),
  });
}

/**
 * Resolves `key` against `registry`. ALWAYS returns a renderable icon and a usable color:
 *   { key, known, icon, color, entry }
 * `known` is false when the registry has no own entry for the key. A missing or invalid field falls back to the registry's
 * neutral fallback and is reported once (with `context`, e.g. { dataset: "champions", entityId, entityName }).
 */
export function lookupDisplay(registry, key, context) {
  const entry = hasOwn(registry.config, key) ? registry.config[key] : null;
  const problems = [];
  if (!entry) problems.push(...registry.requires);
  else {
    if (registry.requires.includes("icon") && !isIconComponent(entry.icon)) problems.push("icon");
    if (registry.requires.includes("color") && !isColorValue(entry.color)) problems.push("color");
  }
  if (problems.length) reportMappingIssue(registry.name, key, problems, context);
  const iconOk = Boolean(entry) && isIconComponent(entry.icon);
  const colorOk = Boolean(entry) && isColorValue(entry.color);
  return {
    key,
    known: Boolean(entry),
    icon: iconOk ? entry.icon : registry.fallback.icon,
    color: colorOk ? entry.color : registry.fallback.color,
    entry,
  };
}

/** Defense in depth for components that RECEIVE an icon as a prop (RankChip): a valid component passes through untouched;
 *  anything else becomes `fallback` and is reported once under `component`/`subject`. */
export function safeIcon(icon, fallback, { component, subject, context } = {}) {
  if (isIconComponent(icon)) return icon;
  reportMappingIssue(component || "icon prop", subject ?? "(unknown)", ["icon"], { ...(context || {}), received: icon === null ? "null" : typeof icon });
  return fallback;
}
