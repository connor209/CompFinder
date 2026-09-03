/**
 * The public page reports what a card is WORTH, never what to list it at.
 *
 *   node scripts/check-public-price.mjs      (or: npm run check)
 *
 * recommend() returns two figures. rawPence is the recency-weighted value of
 * the comps. finalPence is a recommended LISTING price: floored at £2.49 and
 * rounded up a 50p charm ladder. The floor and the ladder are exactly right in
 * the business app, where the output is a price to list at — and wrong here,
 * where the question is "what's that card worth".
 *
 * This is a grep rather than a behavioural test on purpose. The leak is never
 * a wrong calculation; it is someone reaching for the wrong field, and it has
 * happened three times: the headline price, the recent-searches chip, and two
 * audit harnesses. Measured against the Pulse best sellers — a third of which
 * trade under £5 — the ladder alone put our median at 1.11x their market price
 * where the honest figure is 1.03x.
 *
 * Comments may discuss finalPence — the explanation of why we don't use it is
 * worth keeping. Only reading it as a value fails.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED = ["apps/public/app", "apps/public/lib", "scripts"];
const SKIP_DIRS = new Set([".next", "node_modules"]);

// Nine files are exempt wholesale. This one has to name the field in code to
// look for it. The other seven assert BUSINESS-app behaviour, where a
// recommended listing price is the right answer and the whole point of the
// screen, and none of them reads anything under apps/public:
// check-batchsave.mjs covers the round trip of a saved batch run;
// check-showstock.mjs and check-labels.mjs cover the show-table sticker and
// the label it prints on, both derived from finalPence precisely because that
// is a price to SELL at rather than a valuation; recurse-batch.mjs re-runs the
// Batch screen's own pipeline, where the figure under test is the one the
// screen prints; dump-batch.mjs copies a saved business-app run out of the
// database verbatim; check-matching.mjs asserts the Batch screen's own rules,
// one of which reads the ladder price by design; and check-override.mjs asserts
// that a price typed on a result beats the ladder price everywhere it travels,
// which it cannot do without naming both; and check-zeroprice.mjs has to build
// recs both with and without a ladder price, because the entire rule it pins
// is the difference between a card priced at the £2.49 floor and a card
// nothing priced at all. Everywhere else may
// DISCUSS finalPence in a comment — the explanation of why we don't use it is
// worth keeping — but must not read it.
const EXEMPT = new Set([
  "scripts/check-public-price.mjs",
  "scripts/check-batchsave.mjs",
  "scripts/check-showstock.mjs",
  "scripts/recurse-batch.mjs",
  "scripts/dump-batch.mjs",
  "scripts/check-matching.mjs",
  "scripts/check-override.mjs",
  "scripts/check-zeroprice.mjs",
  "scripts/check-labels.mjs"
]);

/** Strips line comments and whole-line block-comment bodies. */
function codeOnly(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  return line.replace(/\/\/.*$/, "");
}

const offenders = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(js|mjs)$/.test(entry)) continue;
    const rel = relative(ROOT, full);
    if (EXEMPT.has(rel)) continue;
    readFileSync(full, "utf8").split("\n").forEach((line, i) => {
      if (/finalPence/.test(codeOnly(line))) {
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 88)}`);
      }
    });
  }
}
for (const d of SCANNED) walk(join(ROOT, d));

if (offenders.length) {
  console.error("The public side must price with rawPence, not the listing ladder:\n");
  for (const o of offenders) console.error(`  ${o}`);
  console.error(`\n${offenders.length} reference(s) to finalPence in code outside the business app.`);
  process.exit(1);
}
console.log("public pricing: no charm-ladder listing price outside the business app.");
