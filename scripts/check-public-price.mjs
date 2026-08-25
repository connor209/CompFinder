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

// Two files are exempt wholesale. This one has to name the field in code to
// look for it. check-batchsave.mjs asserts the round trip of a saved run from
// the BUSINESS app's batch screen, where a recommended listing price is the
// right answer and the whole point of the screen — it never reads anything
// under apps/public. Everywhere else may DISCUSS finalPence in a comment —
// the explanation of why we don't use it is worth keeping — but must not read
// it.
const EXEMPT = new Set(["scripts/check-public-price.mjs", "scripts/check-batchsave.mjs"]);

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
