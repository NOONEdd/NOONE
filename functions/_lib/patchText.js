// Structure-preserving conversion of a Riot patch page into plain text
// that the Patch Intelligence parser (patchParser.js) can split into
// semantic sections.
//
// WHY THIS EXISTS INSTEAD OF riotFallback.js's stripHtmlToText():
// that function replaces every tag with a space and then collapses ALL
// whitespace into one line. That is fine for the ~4000-character
// snippet the AI Coach quotes, but it destroys exactly the information a
// section-aware analysis needs (which line is a heading, which lines are
// one champion's bullet list, where one change ends and the next begins)
// and it only decodes five HTML entities (so "&#39;" / "&#x27;" /
// "&rarr;" survive into the text and break entity-name matching). The
// AI Coach path is deliberately left on the old function so its behavior
// is byte-for-byte unchanged; only Patch Intelligence uses this one.
//
// Output format (one item per line, blank line between blocks):
//   # Title / ## Section / ### Subsection ...   headings from <h1>-<h6>
//   - bullet   (two spaces of indent per nesting level)   from <li>
//   plain paragraphs / labels                            from <p>, <div>, ...
//   ---                                                   from <hr>
// This is deliberately the same shape as Riot's own markdown-like page
// text, so the parser has ONE input format whether headings came from
// real <hN> tags or from text conventions (ALL-CAPS champion names etc.).
//
// Pure functions, no I/O, Web-standard JS only (runs unchanged in
// Cloudflare Workers and in Node for the tests).

// Bump whenever the extraction algorithm changes in a way that could
// change the produced text. It is part of the source cache key
// (riotFallback.js) and of PATCH_INTEL_ENGINE_VERSION's inputs, so a
// change here can never be masked by an older cached extraction.
export const SOURCE_TEXT_VERSION = "src-v2";

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201C", rdquo: "\u201D", sbquo: "\u201A", bdquo: "\u201E",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022", middot: "\u00B7",
  rarr: "\u2192", larr: "\u2190", harr: "\u2194", times: "\u00D7", divide: "\u00F7", plusmn: "\u00B1",
  deg: "\u00B0", trade: "\u2122", copy: "\u00A9", reg: "\u00AE", laquo: "\u00AB", raquo: "\u00BB",
  le: "\u2264", ge: "\u2265", ne: "\u2260", minus: "\u2212", approx: "\u2248",
};

/** Decodes named + numeric (decimal and hex) HTML entities. Unknown named
 *  entities are left exactly as written rather than guessed. */
export function decodeHtmlEntities(input) {
  return String(input || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

// Whole elements whose content is never patch text.
const DROP_ELEMENTS = /<(script|style|noscript|svg|template|iframe|nav|footer|form|button|select|head|canvas|video|audio|picture)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HEADING_TAG = /^h([1-6])$/;
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "aside", "blockquote", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "dl", "dt", "dd", "details", "summary", "pre", "address",
]);
const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+|</g;

function collapseInline(text) {
  return text
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/[ \t\r\f\v\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g, " ")
    .trim();
}

/** Converts raw page HTML to the line-oriented text described in the
 *  file header. Returns { text, meta } -- `meta` carries cheap structural
 *  counts used only for diagnostics (never for decisions). */
export function htmlToStructuredText(html) {
  const source = String(html || "");
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  const cleaned = source.replace(DROP_ELEMENTS, " ");

  const lines = [];
  let current = "";
  let listDepth = 0;
  let inHeading = 0; // heading level currently open, else 0
  let liPending = false;
  const meta = { headings: 0, listItems: 0, tables: 0 };

  function flush() {
    const line = collapseInline(decodeHtmlEntities(current));
    current = "";
    if (!line) {
      liPending = false;
      return;
    }
    if (inHeading) {
      lines.push(`${"#".repeat(inHeading)} ${line}`);
      meta.headings++;
    } else if (liPending) {
      lines.push(`${"  ".repeat(Math.max(0, listDepth - 1))}- ${line}`);
      meta.listItems++;
    } else {
      lines.push(line);
    }
    liPending = false;
  }
  function blank() {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  }

  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(cleaned)) !== null) {
    const raw = m[0];
    if (raw.startsWith("<!--")) continue;
    if (raw[0] !== "<" || raw === "<") {
      current += raw === "<" ? "<" : raw;
      continue;
    }
    const tag = (m[1] || "").toLowerCase();
    const closing = raw[1] === "/";
    if (!tag) continue;

    const headingMatch = HEADING_TAG.exec(tag);
    if (headingMatch) {
      flush();
      blank();
      inHeading = closing ? 0 : Number(headingMatch[1]);
      continue;
    }
    if (tag === "li") {
      flush();
      if (!closing) liPending = true;
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      flush();
      if (closing) {
        listDepth = Math.max(0, listDepth - 1);
        if (listDepth === 0) blank();
      } else {
        listDepth++;
      }
      continue;
    }
    if (tag === "br") {
      flush();
      continue;
    }
    if (tag === "hr") {
      flush();
      blank();
      lines.push("---");
      blank();
      continue;
    }
    if (tag === "td" || tag === "th") {
      if (closing) current += " | ";
      continue;
    }
    if (tag === "tr" && !closing) meta.tables++;
    if (BLOCK_TAGS.has(tag)) {
      flush();
      if (!listDepth) blank();
      continue;
    }
    // any other tag (a, span, strong, em, b, i, img, ...) is inline: its text
    // is already in the surrounding text nodes.
  }
  flush();

  let body = lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  // Table rows end with a dangling " |" separator; tidy it.
  body = body.replace(/ \|$/gm, "");

  if (titleMatch) {
    const title = collapseInline(decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, " ")));
    if (title && !body.slice(0, 400).toLowerCase().includes(title.toLowerCase().slice(0, 24))) {
      body = `# ${title}\n\n${body}`;
    }
  }
  return { text: body, meta };
}
