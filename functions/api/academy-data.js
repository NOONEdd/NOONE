import JSON5 from "json5";

const KEYS = {
  champions: "champions-data",
  items: "items-data",
  runes: "runes-data",
  spells: "spells-data",
  overrides: "coach-overrides",
};

const EMPTY_OVERRIDES = {
  champions: {},
  items: {},
  runes: {},
  decisionTrees: {},
  patch: null,
  verifiedPatch: null,
  patchStatus: null,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

/*
 * Removes a UTF-8 BOM if one exists.
 */
function stripBom(source) {
  return source.replace(/^\uFEFF/, "");
}

/*
 * Detect and remove JavaScript export declarations.
 *
 * Supports:
 *
 * export const CHAMPIONS = [...]
 * export let CHAMPIONS = [...]
 * export var CHAMPIONS = [...]
 *
 * Also supports comments before the export declaration.
 */
function removeExportDeclaration(source) {
  return source.replace(
    /^\s*export\s+(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*/,
    ""
  );
}

/*
 * Remove a final JavaScript semicolon.
 */
function removeFinalSemicolon(source) {
  const trimmed = source.trim();

  if (trimmed.endsWith(";")) {
    return trimmed.slice(0, -1).trim();
  }

  return trimmed;
}

/*
 * Find whether the source is already a complete array.
 *
 * Important:
 * We do NOT simply check startsWith("[") because the
 * champions-data file may begin with comments.
 */
function extractCompleteArray(source) {
  const text = source.trim();

  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");

  if (
    firstBracket !== -1 &&
    lastBracket !== -1 &&
    lastBracket > firstBracket
  ) {
    const before = text.slice(0, firstBracket).trim();

    /*
     * If everything before the first [ is only comments,
     * or an export declaration has already been removed,
     * this is probably a complete array.
     */
    if (
      before === "" ||
      /^\/\/[\s\S]*$/m.test(before) ||
      /^\/\*[\s\S]*\*\/$/.test(before)
    ) {
      return text.slice(firstBracket, lastBracket + 1);
    }
  }

  return null;
}

/*
 * Remove leading comments only.
 *
 * This is specifically needed because champions-data may look like:
 *
 * // Enchanter
 * // ...
 * export const CHAMPIONS = [
 *
 * JSON5 itself understands comments, but the export declaration
 * must be removed first.
 */
function removeLeadingComments(source) {
  let result = source.trim();

  let changed = true;

  while (changed) {
    changed = false;

    // Line comment
    const lineComment = result.match(/^\/\/[^\n]*(?:\n|$)/);

    if (lineComment) {
      result = result.slice(lineComment[0].length).trimStart();
      changed = true;
      continue;
    }

    // Block comment
    const blockComment = result.match(/^\/\*[\s\S]*?\*\//);

    if (blockComment) {
      result = result.slice(blockComment[0].length).trimStart();
      changed = true;
    }
  }

  return result;
}

/*
 * Normalize Academy datasets into valid JSON5.
 *
 * Supported formats:
 *
 * 1. [
 *      { ... },
 *      { ... }
 *    ]
 *
 * 2. export const CHAMPIONS = [
 *      { ... },
 *      { ... }
 *    ];
 *
 * 3. // Enchanter
 *    { ... },
 *    { ... },
 *
 * 4. // Enchanter
 *    export const CHAMPIONS = [
 *      { ... }
 *    ];
 */
function normalizeDatasetSource(raw) {
  if (typeof raw !== "string") {
    throw new Error("KV value is not a string");
  }

  let source = stripBom(raw).trim();

  if (!source) {
    throw new Error("KV value is empty");
  }

  /*
   * First try to detect a complete exported array even when
   * comments exist before the export declaration.
   *
   * Example:
   *
   * // Enchanter
   * export const CHAMPIONS = [
   *   ...
   * ];
   */
  const exportMatch = source.match(
    /export\s+(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*\[/
  );

  if (exportMatch) {
    const arrayStart = source.indexOf("[", exportMatch.index);

    const arrayEnd = source.lastIndexOf("]");

    if (
      arrayStart !== -1 &&
      arrayEnd !== -1 &&
      arrayEnd > arrayStart
    ) {
      return source.slice(arrayStart, arrayEnd + 1);
    }
  }

  /*
   * Remove leading comments, then check again.
   */
  source = removeLeadingComments(source);

  /*
   * Remove export declaration if one remains.
   */
  source = removeExportDeclaration(source);

  source = source.trim();

  /*
   * Remove final semicolon.
   */
  source = removeFinalSemicolon(source);

  /*
   * If this is already a complete array, use it directly.
   */
  if (
    source.startsWith("[") &&
    source.endsWith("]")
  ) {
    return source;
  }

  /*
   * A single complete object.
   */
  if (
    source.startsWith("{") &&
    source.endsWith("}")
  ) {
    return `[${source}]`;
  }

  /*
   * Otherwise it is a fragment containing multiple objects.
   *
   * Example:
   *
   * { ... },
   * { ... },
   * { ... },
   *
   * Wrap it in an array.
   */
  return `[${source}]`;
}

/*
 * Parse one Academy dataset.
 */
function parseAcademyDataset(raw, datasetName) {
  try {
    const normalized = normalizeDatasetSource(raw);

    const parsed = JSON5.parse(normalized);

    if (!Array.isArray(parsed)) {
      throw new Error(
        `Expected an array but received ${typeof parsed}`
      );
    }

    return parsed;
  } catch (error) {
    throw new Error(
      `${datasetName}: ${error?.message || String(error)}`
    );
  }
}

/*
 * Read a normal Academy dataset from KV.
 */
async function readDataset(kv, key, datasetName) {
  if (!kv) {
    return {
      ok: false,
      source: "unavailable",
      data: null,
      count: 0,
      error: "COACH_KV binding is not available",
    };
  }

  try {
    const raw = await kv.get(key);

    if (
      raw === null ||
      raw === undefined ||
      raw.trim() === ""
    ) {
      return {
        ok: false,
        source: "missing",
        data: null,
        count: 0,
        error: `KV key "${key}" is missing or empty`,
      };
    }

    const data = parseAcademyDataset(
      raw,
      datasetName
    );

    return {
      ok: true,
      source: "kv",
      data,
      count: data.length,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      source: "error",
      data: null,
      count: 0,
      error: error?.message || String(error),
    };
  }
}

/*
 * coach-overrides is stored as real JSON.
 *
 * Do NOT parse this with the dataset parser.
 */
async function readOverrides(kv) {
  if (!kv) {
    return {
      ok: false,
      source: "unavailable",
      data: EMPTY_OVERRIDES,
      error: "COACH_KV binding is not available",
    };
  }

  try {
    const raw = await kv.get(KEYS.overrides);

    if (
      raw === null ||
      raw === undefined ||
      raw.trim() === ""
    ) {
      return {
        ok: true,
        source: "empty",
        data: EMPTY_OVERRIDES,
        error: null,
      };
    }

    const parsed = JSON.parse(raw);

    const data = {
      ...EMPTY_OVERRIDES,
      ...parsed,

      champions:
        parsed?.champions &&
        typeof parsed.champions === "object"
          ? parsed.champions
          : {},

      items:
        parsed?.items &&
        typeof parsed.items === "object"
          ? parsed.items
          : {},

      runes:
        parsed?.runes &&
        typeof parsed.runes === "object"
          ? parsed.runes
          : {},

      decisionTrees:
        parsed?.decisionTrees &&
        typeof parsed.decisionTrees === "object"
          ? parsed.decisionTrees
          : {},
    };

    return {
      ok: true,
      source: "kv",
      data,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      source: "error",
      data: EMPTY_OVERRIDES,
      error: error?.message || String(error),
    };
  }
}

function getObjectCount(value) {
  if (!value || typeof value !== "object") {
    return 0;
  }

  return Object.keys(value).length;
}

export async function onRequestGet(context) {
  const kv = context.env.COACH_KV;

  const [
    championsResult,
    itemsResult,
    runesResult,
    spellsResult,
    overridesResult,
  ] = await Promise.all([
    readDataset(
      kv,
      KEYS.champions,
      "champions-data"
    ),

    readDataset(
      kv,
      KEYS.items,
      "items-data"
    ),

    readDataset(
      kv,
      KEYS.runes,
      "runes-data"
    ),

    readDataset(
      kv,
      KEYS.spells,
      "spells-data"
    ),

    readOverrides(kv),
  ]);

  return json({
    success: true,

    data: {
      champions: championsResult.data,
      items: itemsResult.data,
      runes: runesResult.data,
      spells: spellsResult.data,
      overrides: overridesResult.data,
    },

    sources: {
      champions: championsResult.source,
      items: itemsResult.source,
      runes: runesResult.source,
      spells: spellsResult.source,
      overrides: overridesResult.source,
    },

    diagnostics: {
      kvBindingAvailable: Boolean(kv),

      champions: {
        ok: championsResult.ok,
        source: championsResult.source,
        count: championsResult.count,
        error: championsResult.error,
      },

      items: {
        ok: itemsResult.ok,
        source: itemsResult.source,
        count: itemsResult.count,
        error: itemsResult.error,
      },

      runes: {
        ok: runesResult.ok,
        source: runesResult.source,
        count: runesResult.count,
        error: runesResult.error,
      },

      spells: {
        ok: spellsResult.ok,
        source: spellsResult.source,
        count: spellsResult.count,
        error: spellsResult.error,
      },

      overrides: {
        ok: overridesResult.ok,
        source: overridesResult.source,

        champions: getObjectCount(
          overridesResult.data?.champions
        ),

        items: getObjectCount(
          overridesResult.data?.items
        ),

        runes: getObjectCount(
          overridesResult.data?.runes
        ),

        decisionTrees: getObjectCount(
          overridesResult.data?.decisionTrees
        ),

        patch:
          overridesResult.data?.patch || null,

        verifiedPatch:
          overridesResult.data?.verifiedPatch || null,

        patchStatus:
          overridesResult.data?.patchStatus || null,

        error: overridesResult.error,
      },
    },

    meta: {
      version: "academy-data-v3-json5",
      generatedAt: new Date().toISOString(),
    },
  });
}