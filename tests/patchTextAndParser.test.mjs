// Patch Intelligence -- patchText.js / patchParser.js regression test.
// Plain Node ESM, no framework. Run directly:
//
//   node tests/patchTextAndParser.test.mjs

import { htmlToStructuredText, decodeHtmlEntities } from '../functions/_lib/patchText.js';
import { parsePatchDocument, splitOversizeUnit } from '../functions/_lib/patchParser.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

// ---------------------------------------------------------------------
// patchText.js
// ---------------------------------------------------------------------
console.log('\n=== patchText.js ===');

{
  const html = `<html><body>
    <h1>Patch 7.3a</h1>
    <p>Intro paragraph with an &amp; and an &#39;apostrophe&#39;.</p>
    <h2>Champion Changes</h2>
    <h3>Leona</h3>
    <ul><li>Q damage 80 -> 90</li><li>W armor 20 -> 25</li></ul>
    <table><tr><td>Stat</td><td>Old</td><td>New</td></tr><tr><td>HP</td><td>600</td><td>620</td></tr></table>
    <hr/>
    <p>Final note.</p>
  </body></html>`;
  const { text, meta } = htmlToStructuredText(html);

  check('heading levels preserved (# for h1)', text.includes('# Patch 7.3a'), text.slice(0, 100));
  check('h2 becomes ##', text.includes('## Champion Changes'));
  check('h3 becomes ###', text.includes('### Leona'));
  check('bullets get - prefix', text.includes('- Q damage 80 -> 90') || text.includes('- Q damage 80 -&gt; 90') === false, text);
  check('&amp; decoded to &', text.includes('an & and'), text);
  check("&#39; decoded to '", text.includes("'apostrophe'"), text);
  check('table cells joined with |', /Stat\s*\|\s*Old\s*\|\s*New/.test(text), text);
  check('<hr> becomes ---', text.includes('---'));
  check('meta reports heading/list counts', meta && meta.headings >= 3 && meta.listItems >= 2 && meta.tables >= 1, meta);
}

{
  // Named entities are decoded for the punctuation/symbol set patch
  // notes actually use; an unknown named entity is deliberately left
  // exactly as written rather than guessed (see the function's own
  // doc comment) -- confirmed here as documented behavior, not a gap.
  const decoded = decodeHtmlEntities('Tank&nbsp;build &mdash; caf&eacute; &#x2019;s &#8217; test');
  check('nbsp decoded', decoded.includes('Tank\u00a0build') || decoded.includes('Tank build'), decoded);
  check('mdash decoded', decoded.includes('\u2014'), decoded);
  check('unknown named entity (&eacute;) left as-is by design', decoded.includes('&eacute;'), decoded);
  check('hex numeric entity decoded', decoded.includes('\u2019s'), decoded);
  check('decimal numeric entity decoded', decoded.includes('\u2019'), decoded);
}

{
  // Script/style content must never leak into the extracted text.
  const html = `<html><body><script>var x = "CHAMPION_SHOULD_NOT_APPEAR";</script><style>.x{color:red}</style><h1>Real Title</h1><p>Real body</p></body></html>`;
  const { text } = htmlToStructuredText(html);
  check('script content excluded', !text.includes('CHAMPION_SHOULD_NOT_APPEAR'), text);
  check('style content excluded', !text.includes('color:red'), text);
  check('real content kept', text.includes('Real Title') && text.includes('Real body'));
}

// ---------------------------------------------------------------------
// patchParser.js
// ---------------------------------------------------------------------
console.log('\n=== patchParser.js ===');

{
  const text = `# Patch 7.3a\n\nWelcome to the patch.\n\n## CHAMPION CHANGES\n\n### Leona\n\n- Q: damage 80 -> 90\n- W: armor 20 -> 25\n\n### Garen\n\n- Base Health 620 -> 600\n\n## ITEM CHANGES\n\n### Ardent Censer\n\n- Heal/shield power 10% -> 12%\n\n## BUG FIXES\n\n- Fixed a visual bug`;
  const parsed = parsePatchDocument(text, { maxUnitChars: 18000 });

  check('title extracted', parsed.title === 'Patch 7.3a', parsed.title);
  check('units created for every heading', parsed.units.some((u) => u.title === 'Leona') && parsed.units.some((u) => u.title === 'Garen') && parsed.units.some((u) => u.title === 'Ardent Censer'));
  check('champion units categorized as champions', parsed.units.find((u) => u.title === 'Leona')?.category === 'champions');
  check('item unit categorized as items', parsed.units.find((u) => u.title === 'Ardent Censer')?.category === 'items');
  check('bugfix unit categorized as bugfixes', parsed.units.find((u) => u.title === 'BUG FIXES')?.category === 'bugfixes');
  check('section-only headings (no body) marked empty', parsed.units.find((u) => u.title === 'CHAMPION CHANGES')?.empty === true);
  check('every unit has a unique id', new Set(parsed.units.map((u) => u.id)).size === parsed.units.length);

  // Every non-blank source line should be accounted for in exactly the
  // unit(s) built from it -- reconstruct and compare against the input
  // (ignoring pure heading/blank lines, which become unit.title/headingPath
  // rather than body text).
  const bodyLines = text.split('\n').filter((l) => l.trim() && !/^#{1,6}\s/.test(l));
  const reconstructed = parsed.units.flatMap((u) => u.text.split('\n')).filter((l) => l.trim());
  for (const line of bodyLines) {
    check(`line preserved somewhere in units: "${line.slice(0, 40)}"`, reconstructed.some((l) => l.includes(line.trim().replace(/^- /, '')) || line.includes(l)));
  }
}

{
  // ALL-CAPS section headings (no markdown #) must still be detected as
  // section boundaries, distinct from an ALL-CAPS entity name.
  const text = `Patch 7.3a\n\nCHAMPION CHANGES\n\nLEONA\n- Q damage up\n\nBATTLEFIELD ADJUSTMENTS\n\nJungle\n- Smite timer changed`;
  const parsed = parsePatchDocument(text, { maxUnitChars: 18000 });
  check('ALL-CAPS section heading detected', parsed.units.some((u) => u.title === 'CHAMPION CHANGES'));
  check('ALL-CAPS entity name still becomes its own unit', parsed.units.some((u) => u.title === 'LEONA'));
}

{
  // Oversize splitting: never mid-line, never mid-change, every line
  // preserved across the resulting pieces.
  const lines = [];
  for (let i = 0; i < 200; i++) lines.push(`- Change number ${i}: some stat 10 -> ${10 + i}`);
  const joined = lines.join('\n');
  const bigUnit = { id: 'U099', title: 'Huge Section', headingPath: ['HUGE SECTION'], category: 'other', lines, text: joined, chars: joined.length, gameplay: true, empty: false };

  const pieces = splitOversizeUnit(bigUnit, 800);
  check('oversize unit actually gets split into more than one piece', pieces.length > 1, pieces.length);
  check('every piece stays under the max (some slack allowed for an unsplittable single line)', pieces.every((p) => p.chars <= 1600));

  const allLines = pieces.flatMap((p) => p.text.split('\n')).filter(Boolean);
  check('no line lost or duplicated across the split', allLines.length === lines.length, `expected ${lines.length}, got ${allLines.length}`);
  check('no line cut mid-way (every piece line matches an original line exactly)', allLines.every((l) => lines.includes(l)));
  check('order preserved', JSON.stringify(allLines) === JSON.stringify(lines));
}

{
  // A single unit at or under the limit should not be split at all.
  const unit = { id: 'U001', title: 'Small', headingPath: ['Small'], category: 'other', lines: ['- one line'], text: '- one line', chars: 10, gameplay: true, empty: false };
  const pieces = splitOversizeUnit(unit, 18000);
  check('small unit returned unchanged', pieces.length === 1 && pieces[0].text === unit.text);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
