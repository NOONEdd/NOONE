// Scenario Engine (Decision Lab) test runner: npm run test:engine
//
// Runs every tests/decisionLab.*.test.mjs file, one after another, each in its
// own Node process, and exits non-zero if any of them fails. New suites are
// picked up by name, so adding one needs no change here or in CI.
//
// WHAT THESE TESTS ARE: engineering and regression tests. Their expected
// values come from the code's own contracts or from the DRAFT Objective Trade
// rule table ("engine goldens"), so a pass means "the engine still does what
// it did", never "this is correct Wild Rift coaching". Coach-approved Golden
// cases do not exist yet (COACH_GOLDENS in tests/decisionLab.golden.test.mjs
// is empty); this runner does not run or report any.
//
// Uses only Node built-ins: the engine has no npm dependencies.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const suites = readdirSync(join(root, "tests"))
  .filter((f) => /^decisionLab\..+\.test\.mjs$/.test(f))
  .sort();

if (suites.length === 0) {
  console.error("run-engine-tests: no tests/decisionLab.*.test.mjs found");
  process.exit(1);
}

const results = [];
for (const file of suites) {
  console.log(`\n##### ${file}`);
  const started = Date.now();
  const run = spawnSync(process.execPath, [join("tests", file)], { cwd: root, stdio: "inherit" });
  const status = run.status === null ? `signal ${run.signal}` : run.status;
  results.push({ file, status, seconds: ((Date.now() - started) / 1000).toFixed(1) });
}

console.log(`\n##### Scenario Engine tests on Node ${process.version} (engineering regression pins; not coach-approved Golden cases)`);
for (const r of results) console.log(`  ${r.status === 0 ? "PASS" : "FAIL"}  ${r.file}  (exit ${r.status}, ${r.seconds}s)`);
const failed = results.filter((r) => r.status !== 0);
console.log(failed.length === 0 ? `  all ${results.length} suites passed` : `  ${failed.length} of ${results.length} suites failed`);
process.exit(failed.length === 0 ? 0 : 1);
