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
 * Parse Academy datasets stored in KV.
 *
 * The current KV format is JavaScript-like source:
 *
 * { id: "lulu", name: "Lulu", ... },
 * { id: "janna", name: "Janna", ... },
 *
 * It is NOT normal JSON.
 *
 * This parser extracts the top-level object/array structure without
 * requiring an external dependency.
 */
function parseAcademyData(raw, datasetName) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${datasetName}: KV value is empty`);
  }

  let source = raw.trim();

  // Remove UTF-8 BOM if present.
  source = source.replace(/^\uFEFF/, "");

  // Remove common export wrapper if present.
  source = source.replace(
    /^\s*export\s+(?:const|let|var)\s+\w+\s*=\s*/,
    ""
  ).trim();

  /*
   * Case 1:
   * The KV value is already a complete array.
   */
  if (source.startsWith("[") && source.endsWith("]")) {
    return parseLooseJson(source, datasetName);
  }

  /*
   * Case 2:
   * The KV value is a complete object.
   */
  if (source.startsWith("{") && source.endsWith("}")) {
    return parseLooseJson(source, datasetName);
  }

  /*
   * Case 3:
   * The KV value contains object entries without
   * an enclosing array:
   *
   * { ... },
   * { ... },
   * { ... },
   *
   * Wrap them in an array.
   */
  return parseLooseJson(`[${source}]`, datasetName);
}

/**
 * Convert the Academy JavaScript-like syntax into valid JSON
 * without using eval().
 *
 * This intentionally supports the current data format:
 *
 *   id: "lulu"
 *   name: "Lulu"
 *   tag: "Core"
 *   type: "core"
 *
 * and preserves quoted strings containing apostrophes such as:
 *
 *   Kog'Maw
 *   Mikael's Blessing
 */
function parseLooseJson(source, datasetName) {
  try {
    return JSON.parse(source);
  } catch (firstError) {
    // Convert unquoted object keys to quoted JSON keys.
    let converted = source.replace(
      /([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)\s*:/g,
      '$1"$2":'
    );

    /*
     * Remove JavaScript-style comments.
     *
     * Only remove // comments when they occur outside strings.
     */
    converted = stripLineComments(converted);

    /*
     * Remove trailing commas before } or ].
     */
    converted = converted.replace(/,\s*([}\]])/g, "$1");

    try {
      return JSON.parse(converted);
    } catch (secondError) {
      throw new Error(
        `${datasetName}: unable to parse KV data. ` +
        `Original error: ${firstError.message}. ` +
        `After conversion: ${secondError.message}`
      );
    }
  }
}

/**
 * Removes // comments without destroying // inside strings.
 */
function stripLineComments(input) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      output += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }

      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      /*
       * JSON ultimately requires double-quoted strings.
       * We don't attempt to convert single/backtick strings here.
       * The current Academy data uses double quotes.
       */
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") {
        i++;
      }

      output += "\n";
      continue;
    }

    output += char;
  }

  return output;
}

async function readDataset(kv, key, datasetName) {
  if (!kv) {
    return {
      ok: false,
      source: "unavailable",
      data: null,
      error: "COACH_KV binding is not available",
    };
  }

  try {
    const raw = await kv.get(key);

    if (!raw || !raw.trim()) {
      return {
        ok: false,
        source: "missing",
        data: null,
        error: `KV key "${key}" is empty or missing`,
      };
    }

    const data = parseAcademyData(raw, datasetName);

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
      data: null,
      error: error?.message || String(error),
    };
  }
}

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

    if (!raw || !raw.trim()) {
      return {
        ok: true,
        source: "empty",
        data: EMPTY_OVERRIDES,
        error: null,
      };
    }

    const parsed = JSON.parse(raw);

    return {
      ok: true,
      source: "kv",
      data: {
        ...EMPTY_OVERRIDES,
        ...parsed,
        champions: parsed?.champions || {},
        items: parsed?.items || {},
        runes: parsed?.runes || {},
        decisionTrees: parsed?.decisionTrees || {},
      },
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

function countData(data) {
  if (Array.isArray(data)) {
    return data.length;
  }

  if (data && typeof data === "object") {
    return Object.keys(data).length;
  }

  return 0;
}

export async function onRequestGet(context) {
  const kv = context.env.COACH_KV;

  const [
    champions,
    items,
    runes,
    spells,
    overrides,
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
      champions: champions.data,
      items: items.data,
      runes: runes.data,
      spells: spells.data,
      overrides: overrides.data,
    },

    sources: {
      champions: champions.source,
      items: items.source,
      runes: runes.source,
      spells: spells.source,
      overrides: overrides.source,
    },

    diagnostics: {
      kvBindingAvailable: !!kv,

      champions: {
        ok: champions.ok,
        count: countData(champions.data),
        source: champions.source,
        error: champions.error,
      },

      items: {
        ok: items.ok,
        count: countData(items.data),
        source: items.source,
        error: items.error,
      },

      runes: {
        ok: runes.ok,
        count: countData(runes.data),
        source: runes.source,
        error: runes.error,
      },

      spells: {
        ok: spells.ok,
        count: countData(spells.data),
        source: spells.source,
        error: spells.error,
      },

      overrides: {
        ok: overrides.ok,
        source: overrides.source,
        champions: Object.keys(
          overrides.data?.champions || {}
        ).length,
        items: Object.keys(
          overrides.data?.items || {}
        ).length,
        runes: Object.keys(
          overrides.data?.runes || {}
        ).length,
        decisionTrees: Object.keys(
          overrides.data?.decisionTrees || {}
        ).length,
        patch: overrides.data?.patch || null,
        verifiedPatch: overrides.data?.verifiedPatch || null,
        error: overrides.error,
      },
    },

    meta: {
      version: "academy-data-v1",
      generatedAt: new Date().toISOString(),
    },
  });
}