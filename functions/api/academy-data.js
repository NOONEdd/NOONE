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

/**
 * Convert the current Academy KV dataset format into
 * something JSON5 can parse.
 *
 * Supported formats:
 *
 * 1. Full array:
 *    [
 *      { id: "lulu", ... },
 *      { id: "janna", ... }
 *    ]
 *
 * 2. JavaScript export:
 *    export const CHAMPIONS = [
 *      { id: "lulu", ... }
 *    ];
 *
 * 3. Fragment:
 *    // Enchanter
 *    { id: "lulu", ... },
 *    { id: "janna", ... },
 *
 *    This gets wrapped in [ ... ].
 */
function normalizeDatasetSource(raw) {
  if (typeof raw !== "string") {
    throw new Error("KV value is not a string");
  }

  let source = raw
    .replace(/^\uFEFF/, "")
    .trim();

  if (!source) {
    throw new Error("KV value is empty");
  }

  // Remove common JS export declaration.
  source = source.replace(
    /^\s*export\s+(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*/,
    ""
  );

  source = source.trim();

  // Remove a final semicolon from a complete exported array/object.
  if (source.endsWith(";")) {
    source = source.slice(0, -1).trim();
  }

  /*
   * Already a complete JSON5 array.
   */
  if (source.startsWith("[") && source.endsWith("]")) {
    return source;
  }

  /*
   * A single complete object.
   */
  if (source.startsWith("{") && source.endsWith("}")) {
    return `[${source}]`;
  }

  /*
   * Current champions-data format is a fragment:
   *
   * // Enchanter
   * { ... },
   * { ... },
   *
   * JSON5 can parse the objects individually but not as
   * multiple top-level values, so wrap the whole fragment.
   */
  return `[${source}]`;
}

/**
 * Parse an Academy dataset stored in KV.
 *
 * JSON5 supports:
 * - // comments
 * - /* comments *\/
 * - single quoted strings
 * - unquoted object keys
 * - trailing commas
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

/**
 * Read one of the Academy dataset keys.
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

    if (raw === null || raw === undefined || raw.trim() === "") {
      return {
        ok: false,
        source: "missing",
        data: null,
        count: 0,
        error: `KV key "${key}" is missing or empty`,
      };
    }

    const data = parseAcademyDataset(raw, datasetName);

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

/**
 * coach-overrides is already stored as normal JSON,
 * so it should NOT go through the JSON5 dataset parser.
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

    if (raw === null || raw === undefined || raw.trim() === "") {
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

  /*
   * Read all Academy datasets in parallel.
   */
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

  /*
   * Return the actual Academy data plus detailed diagnostics.
   *
   * IMPORTANT:
   * This endpoint only READS KV.
   * It does not write or modify anything.
   */
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
      version: "academy-data-v2-json5",
      generatedAt: new Date().toISOString(),
    },
  });
}