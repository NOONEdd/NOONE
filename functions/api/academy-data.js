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
      "Cache-Control": "no-store",
    },
  });
}

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

  /*
   * Handles:
   *
   * // comments
   * export const CHAMPIONS = [
   *   {...},
   *   {...},
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

    let arrayEnd = source.lastIndexOf("]");

    if (
      arrayStart === -1 ||
      arrayEnd === -1 ||
      arrayEnd <= arrayStart
    ) {
      throw new Error(
        "Could not locate complete array"
      );
    }

    /*
     * Your champions-data currently ends with:
     *
     * ]]
     *
     * Remove only the extra final bracket.
     */
    if (
      source.slice(arrayEnd - 1, arrayEnd + 1) === "]]"
    ) {
      arrayEnd -= 1;
    }

    return source.slice(
      arrayStart,
      arrayEnd + 1
    );
  }

  /*
   * Remove leading comments.
   */
  while (true) {
    const lineComment =
      source.match(/^\/\/[^\n]*(?:\n|$)/);

    if (lineComment) {
      source = source
        .slice(lineComment[0].length)
        .trimStart();

      continue;
    }

    const blockComment =
      source.match(/^\/\*[\s\S]*?\*\//);

    if (blockComment) {
      source = source
        .slice(blockComment[0].length)
        .trimStart();

      continue;
    }

    break;
  }

  /*
   * Remove export declaration if present.
   */
  source = source.replace(
    /^\s*export\s+(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*/,
    ""
  );

  source = source.trim();

  /*
   * Remove final semicolon.
   */
  if (source.endsWith(";")) {
    source = source
      .slice(0, -1)
      .trim();
  }

  /*
   * Handle accidental extra closing bracket.
   */
  if (source.endsWith("]]")) {
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
   * Object fragment.
   */
  return `[${source}]`;
}

function parseDataset(raw, name) {
  try {
    const normalized =
      normalizeDatasetSource(raw);

    const parsed =
      JSON5.parse(normalized);

    if (!Array.isArray(parsed)) {
      throw new Error(
        `Expected array, received ${typeof parsed}`
      );
    }

    return parsed;
  } catch (error) {
    const message =
      error?.message || String(error);

    /*
     * Include parser context when JSON5 gives
     * a line/column.
     */
    let context = "";

    const match =
      message.match(/at (\d+):(\d+)/);

    if (match) {
      try {
        const lineNumber =
          Number(match[1]);

        const normalized =
          normalizeDatasetSource(raw);

        const lines =
          normalized.split("\n");

        const start =
          Math.max(0, lineNumber - 3);

        const end =
          Math.min(
            lines.length,
            lineNumber + 2
          );

        context = lines
          .slice(start, end)
          .map(
            (line, index) =>
              `${start + index + 1}: ${line}`
          )
          .join("\n");
      } catch {
        context = "";
      }
    }

    throw new Error(
      `${name}: ${message}${
        context
          ? `\n\nContext around error:\n${context}`
          : ""
      }`
    );
  }
}

async function readDataset(
  kv,
  key,
  name
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
      parseDataset(raw, name);

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

    return {
      ok: true,
      source: "kv",
      data: {
        ...EMPTY_OVERRIDES,
        ...parsed,

        champions:
          parsed?.champions &&
          typeof parsed.champions ===
            "object"
            ? parsed.champions
            : {},

        items:
          parsed?.items &&
          typeof parsed.items ===
            "object"
            ? parsed.items
            : {},

        runes:
          parsed?.runes &&
          typeof parsed.runes ===
            "object"
            ? parsed.runes
            : {},

        decisionTrees:
          parsed?.decisionTrees &&
          typeof parsed.decisionTrees ===
            "object"
            ? parsed.decisionTrees
            : {},
      },
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

function objectCount(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return 0;
  }

  return Object.keys(value).length;
}

export async function onRequestGet(
  context
) {
  const kv =
    context.env.COACH_KV;

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
      kvBindingAvailable:
        Boolean(kv),

      champions: {
        ok: champions.ok,
        source: champions.source,
        count: champions.count,
        error: champions.error,
      },

      items: {
        ok: items.ok,
        source: items.source,
        count: items.count,
        error: items.error,
      },

      runes: {
        ok: runes.ok,
        source: runes.source,
        count: runes.count,
        error: runes.error,
      },

      spells: {
        ok: spells.ok,
        source: spells.source,
        count: spells.count,
        error: spells.error,
      },

      overrides: {
        ok: overrides.ok,
        source: overrides.source,

        champions:
          objectCount(
            overrides.data?.champions
          ),

        items:
          objectCount(
            overrides.data?.items
          ),

        runes:
          objectCount(
            overrides.data?.runes
          ),

        decisionTrees:
          objectCount(
            overrides.data?.decisionTrees
          ),

        patch:
          overrides.data?.patch || null,

        verifiedPatch:
          overrides.data?.verifiedPatch ||
          null,

        patchStatus:
          overrides.data?.patchStatus ||
          null,

        error:
          overrides.error,
      },
    },

    meta: {
      version:
        "academy-data-v4",
      generatedAt:
        new Date().toISOString(),
    },
  });
}