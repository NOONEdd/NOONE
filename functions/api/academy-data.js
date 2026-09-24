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

function stripBom(source) {
  return source.replace(/^\uFEFF/, "");
}

function removeLeadingComments(source) {
  let result = source.trim();

  while (true) {
    const lineComment = result.match(/^\/\/[^\n]*(?:\n|$)/);

    if (lineComment) {
      result = result
        .slice(lineComment[0].length)
        .trimStart();

      continue;
    }

    const blockComment = result.match(/^\/\*[\s\S]*?\*\//);

    if (blockComment) {
      result = result
        .slice(blockComment[0].length)
        .trimStart();

      continue;
    }

    break;
  }

  return result;
}

function removeExportDeclaration(source) {
  return source.replace(
    /^\s*export\s+(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*/,
    ""
  );
}

function removeFinalSemicolon(source) {
  const trimmed = source.trim();

  if (trimmed.endsWith(";")) {
    return trimmed.slice(0, -1).trim();
  }

  return trimmed;
}

/**
 * Normalize Academy KV datasets.
 *
 * Supported formats:
 *
 * export const DATA = [
 *   {...},
 *   {...},
 * ];
 *
 * OR:
 *
 * [
 *   {...},
 *   {...}
 * ]
 *
 * OR:
 *
 * {...},
 * {...}
 *
 * Also repairs the known champions-data trailing "]]" issue.
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
   * First handle the normal exported-array format.
   *
   * Example:
   *
   * export const CHAMPIONS = [
   *   ...
   * ];
   */
  const exportMatch = source.match(
    /export\s+(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*\[/
  );

  if (exportMatch) {
    const arrayStart = source.indexOf(
      "[",
      exportMatch.index
    );

    if (arrayStart === -1) {
      throw new Error("Could not locate array start");
    }

    let extracted = source
      .slice(arrayStart)
      .trim();

    /*
     * Remove a trailing semicolon first.
     *
     * Example:
     * ]]
     * ;
     */
    extracted = extracted
      .replace(/;\s*$/, "")
      .trim();

    /*
     * IMPORTANT:
     *
     * champions-data currently ends with:
     *
     *   ],
     *  },
     * ]]
     *
     * The final "]]" contains one extra closing bracket.
     *
     * Keep removing extra trailing ] characters until the
     * array has only one final closing bracket.
     */
    while (extracted.endsWith("]]")) {
      extracted = extracted
        .slice(0, -1)
        .trim();
    }

    /*
     * Final safety cleanup for semicolon after bracket.
     */
    extracted = extracted
      .replace(/;\s*$/, "")
      .trim();

    if (
      !extracted.startsWith("[") ||
      !extracted.endsWith("]")
    ) {
      throw new Error(
        "Could not extract a complete array"
      );
    }

    return extracted;
  }

  /*
   * Handle files that start with comments before the data.
   */
  source = removeLeadingComments(source);

  /*
   * Handle:
   *
   * export const DATA = ...
   */
  source = removeExportDeclaration(source);

  source = source.trim();

  /*
   * Remove final semicolon.
   */
  source = removeFinalSemicolon(source);

  /*
   * Repair the same trailing extra-bracket problem even
   * when there is no export declaration.
   */
  while (source.endsWith("]]")) {
    source = source
      .slice(0, -1)
      .trim();
  }

  /*
   * Already an array.
   */
  if (
    source.startsWith("[") &&
    source.endsWith("]")
  ) {
    return source;
  }

  /*
   * Single object.
   */
  if (
    source.startsWith("{") &&
    source.endsWith("}")
  ) {
    return `[${source}]`;
  }

  /*
   * Raw comma-separated objects.
   */
  return `[${source}]`;
}

function parseAcademyDataset(raw, datasetName) {
  try {
    const normalized =
      normalizeDatasetSource(raw);

    const parsed =
      JSON5.parse(normalized);

    if (!Array.isArray(parsed)) {
      throw new Error(
        `Expected an array but received ${typeof parsed}`
      );
    }

    return parsed;
  } catch (error) {
    let diagnostic = "";

    const message =
      error?.message || String(error);

    /*
     * JSON5 normally reports:
     *
     * JSON5: invalid character ']' at 1271:2
     */
    const match =
      message.match(/at (\d+):(\d+)/);

    if (match) {
      const errorLine = Number(match[1]);

      try {
        const normalized =
          normalizeDatasetSource(raw);

        const lines =
          normalized.split("\n");

        const start =
          Math.max(0, errorLine - 4);

        const end =
          Math.min(
            lines.length,
            errorLine + 3
          );

        diagnostic = lines
          .slice(start, end)
          .map(
            (line, index) =>
              `${start + index + 1}: ${line}`
          )
          .join("\n");
      } catch {
        // Keep original error.
      }
    }

    throw new Error(
      `${datasetName}: ${message}${
        diagnostic
          ? `\n\nContext around error:\n${diagnostic}`
          : ""
      }`
    );
  }
}

async function readDataset(
  kv,
  key,
  datasetName
) {
  if (!kv) {
    return {
      ok: false,
      source: "unavailable",
      data: null,
      count: 0,
      error:
        "COACH_KV binding is not available",
    };
  }

  try {
    const raw =
      await kv.get(key);

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
        error:
          `KV key "${key}" is missing or empty`,
      };
    }

    const data =
      parseAcademyDataset(
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
      error:
        error?.message ||
        String(error),
    };
  }
}

async function readOverrides(kv) {
  if (!kv) {
    return {
      ok: false,
      source: "unavailable",
      data: EMPTY_OVERRIDES,
      error:
        "COACH_KV binding is not available",
    };
  }

  try {
    const raw =
      await kv.get(KEYS.overrides);

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

    const parsed =
      JSON.parse(raw);

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
      error:
        error?.message ||
        String(error),
    };
  }
}

function getObjectCount(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
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
      version: "academy-data-v6",
      generatedAt: new Date().toISOString(),
    },
  });
}