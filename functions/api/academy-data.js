```js
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

  let changed = true;

  while (changed) {
    changed = false;

    const lineComment = result.match(/^\/\/[^\n]*(?:\n|$)/);

    if (lineComment) {
      result = result.slice(lineComment[0].length).trimStart();
      changed = true;
      continue;
    }

    const blockComment = result.match(/^\/\*[\s\S]*?\*\//);

    if (blockComment) {
      result = result.slice(blockComment[0].length).trimStart();
      changed = true;
    }
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

function normalizeDatasetSource(raw) {
  if (typeof raw !== "string") {
    throw new Error("KV value is not a string");
  }

  let source = stripBom(raw).trim();

  if (!source) {
    throw new Error("KV value is empty");
  }

  /*
   * Handle files such as:
   *
   * // comment
   * export const CHAMPIONS = [
   *   {...},
   *   {...},
   * ];
   *
   * We search for the export declaration anywhere in the source
   * because comments may appear before it.
   */
  const exportMatch = source.match(
    /export\s+(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*\[/
  );

  if (exportMatch) {
    const arrayStart = source.indexOf("[", exportMatch.index);
    let arrayEnd = source.lastIndexOf("]");

    if (
      arrayStart !== -1 &&
      arrayEnd !== -1 &&
      arrayEnd > arrayStart
    ) {
      /*
       * Some existing champions-data content has an accidental
       * extra closing bracket at the very end:
       *
       *   },
       * ]]
       *
       * Convert that to:
       *
       *   },
       * ]
       */
      if (
        arrayEnd === source.length - 1 &&
        source.charAt(arrayEnd - 1) === "]"
      ) {
        arrayEnd -= 1;
      }

      return source.slice(arrayStart, arrayEnd + 1);
    }
  }

  /*
   * Remove comments and export syntax if the source did not
   * match the exported-array case above.
   */
  source = removeLeadingComments(source);
  source = removeExportDeclaration(source);
  source = source.trim();
  source = removeFinalSemicolon(source);

  /*
   * Handle an array with an accidental extra closing bracket:
   *
   *   [...]
   *   ]]
   */
  if (
    source.startsWith("[") &&
    source.endsWith("]]")
  ) {
    source = source.slice(0, -1).trim();
  }

  /*
   * Already a complete array.
   */
  if (
    source.startsWith("[") &&
    source.endsWith("]")
  ) {
    return source;
  }

  /*
   * A single object.
   */
  if (
    source.startsWith("{") &&
    source.endsWith("}")
  ) {
    return `[${source}]`;
  }

  /*
   * Otherwise treat the source as an object fragment and wrap it.
   */
  return `[${source}]`;
}

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
    let diagnostic = "";

    const errorMessage = String(
      error?.message || error
    );

    /*
     * JSON5 errors usually contain:
     *
     *   at 1271:2
     *
     * Use that location to return a small section of the
     * normalized source for debugging.
     */
    const match = errorMessage.match(
      /at (\d+):(\d+)/
    );

    if (match) {
      const errorLine = Number(match[1]);

      try {
        const normalized = normalizeDatasetSource(raw);
        const lines = normalized.split("\n");

        const start = Math.max(
          0,
          errorLine - 4
        );

        const end = Math.min(
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
        // Keep the original parser error if diagnostics fail.
      }
    }

    throw new Error(
      `${datasetName}: ${errorMessage}${
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
        error:
          `KV key "${key}" is missing or empty`,
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
    const raw = await kv.get(
      KEYS.overrides
    );

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
      champions:
        championsResult.data,

      items:
        itemsResult.data,

      runes:
        runesResult.data,

      spells:
        spellsResult.data,

      overrides:
        overridesResult.data,
    },

    sources: {
      champions:
        championsResult.source,

      items:
        itemsResult.source,

      runes:
        runesResult.source,

      spells:
        spellsResult.source,

      overrides:
        overridesResult.source,
    },

    diagnostics: {
      kvBindingAvailable:
        Boolean(kv),

      champions: {
        ok:
          championsResult.ok,

        source:
          championsResult.source,

        count:
          championsResult.count,

        error:
          championsResult.error,
      },

      items: {
        ok:
          itemsResult.ok,

        source:
          itemsResult.source,

        count:
          itemsResult.count,

        error:
          itemsResult.error,
      },

      runes: {
        ok:
          runesResult.ok,

        source:
          runesResult.source,

        count:
          runesResult.count,

        error:
          runesResult.error,
      },

      spells: {
        ok:
          spellsResult.ok,

        source:
          spellsResult.source,

        count:
          spellsResult.count,

        error:
          spellsResult.error,
      },

      overrides: {
        ok:
          overridesResult.ok,

        source:
          overridesResult.source,

        champions:
          getObjectCount(
            overridesResult.data?.champions
          ),

        items:
          getObjectCount(
            overridesResult.data?.items
          ),

        runes:
          getObjectCount(
            overridesResult.data?.runes
          ),

        decisionTrees:
          getObjectCount(
            overridesResult.data?.decisionTrees
          ),

        patch:
          overridesResult.data?.patch ||
          null,

        verifiedPatch:
          overridesResult.data
            ?.verifiedPatch ||
          null,

        patchStatus:
          overridesResult.data
            ?.patchStatus ||
          null,

        error:
          overridesResult.error,
      },
    },

    meta: {
      version:
        "academy-data-v4-bracket-fix",

      generatedAt:
        new Date().toISOString(),
    },
  });
}
```
