/**
 * The liquidity band, and the one boolean it hangs on.
 *
 *   node scripts/check-liquidity.mjs      (or: npm run check)
 *
 * Two failures worth catching, both of which shipped:
 *
 *   1. Guessing the cap from the comp count. When SoldComps says there is
 *      more, it has returned between 35 and 40 items — so a threshold of 39
 *      misses real caps and invents others. hasNextPage answers it directly.
 *   2. Measuring the rate over the SURVIVORS' span. The cap truncates the
 *      search, not this card: three sales three days apart inside a page that
 *      reaches back two months is one sale every three weeks, not seven a week.
 *
 * The fixture shapes below are real cards from the 2026-08-23 audit, kept
 * because each is a case where a plausible-looking rule gave an answer that
 * was wrong by an order of magnitude.
 */
import CompFinderLiquidity from "@compfinder/core/liquidity.js";
import { saturatedFrom, visibleDaysFrom, assessLiquidity } from "../apps/public/lib/liquidity.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.UTC(2026, 7, 23);
const DAY = 86400000;
let failures = 0;

const fail = (msg) => { console.error(`  ${msg}`); failures++; };
/** Sales at the given ages in days, newest first or not — order is irrelevant. */
const sales = (...agesInDays) =>
  agesInDays.map((d, i) => ({ totalPence: 500 + i, _source: { endedAt: new Date(NOW - d * DAY).toISOString() } }));

// --- 1. reading the cap -----------------------------------------------------
const SAT = [
  ["the API says there is more", { hasNextPage: true }, sales(1), true],
  ["the API says there is not", { hasNextPage: false }, new Array(55).fill(sales(1)[0]), false],
  ["a 55-comp set the API called complete", { hasNextPage: false }, new Array(55).fill(sales(1)[0]), false],
  ["a 36-comp set the API called capped", { hasNextPage: true }, new Array(36).fill(sales(1)[0]), true],
  // Only when the API hasn't spoken does the count get a say: a cache entry
  // written before /api/price returned the field.
  ["no answer, a full page", { hasNextPage: null }, new Array(40).fill(sales(1)[0]), true],
  ["no answer, a short page", { hasNextPage: null }, new Array(6).fill(sales(1)[0]), false],
  ["no response at all", null, new Array(40).fill(sales(1)[0]), true]
];
for (const [label, response, comps, expected] of SAT) {
  const got = saturatedFrom(response, comps);
  if (got !== expected) fail(`saturatedFrom: ${label} — expected ${expected}, got ${got}`);
}

// --- 2. the visible window --------------------------------------------------
if (visibleDaysFrom([], NOW) !== null) fail("visibleDaysFrom: no comps should be null");
if (visibleDaysFrom(sales(3), NOW) !== 3) fail("visibleDaysFrom: one comp should reach back its own age");
// The OLDEST raw comp is what page one reaches back to.
if (visibleDaysFrom(sales(1, 40, 7), NOW) !== 40) fail("visibleDaysFrom: should use the oldest comp, not the newest");
if (visibleDaysFrom([{ totalPence: 1 }], NOW) !== null) fail("visibleDaysFrom: undated comps should be null");

// --- 3. bands, on shapes that have been wrong before ------------------------
const BANDS = [
  // Xerneas: 3 sales bunched inside a page reaching back two months. Reading
  // the rate off their own 3-day span said "Sells fast".
  ["3 sales in a 58-day reach", sales(1, 2, 4), 58.5, "slow"],
  // Doduo: genuinely fast. The trap here is the opposite one — a window that
  // ends at the newest sale rather than at now leaves the "recent half" empty
  // and reads 13 sales in 4 days as illiquid.
  ["13 sales in a 5.5-day reach", sales(2.4, 2.5, 2.6, 3, 3.1, 3.2, 3.5, 4, 4.1, 4.2, 5, 5.2, 5.4), 5.5, "very-liquid"],
  // Sunkern: a page that reaches back nearly the whole window with four sales
  // in it is not a slow mover, it is a card that barely trades.
  ["4 sales in an 83-day reach, one of them recent", sales(20, 55, 70, 80), 83.5, "illiquid"],
  // The case the window-ending-at-now buys us: plenty of sales, none lately.
  ["20 sales, none in the last 40 days", sales(...Array.from({ length: 20 }, (_, i) => 45 + i)), 70, "illiquid"],
  // Why the split stands down under a fortnight. Three sales in the last six
  // days, none in the last three: split, that is "nothing sold recently" and
  // the card reads as dead. Over six days that comparison is noise, and the
  // honest answer is three sales a week and a bit.
  ["3 sales in a 6-day reach, none in the last 3", sales(4, 5, 5.5), 6, "very-liquid"]
];
for (const [label, comps, visibleDays, expected] of BANDS) {
  const got = CompFinderLiquidity.assess({ soldComps: comps, saturated: true, visibleDays, now: NOW });
  if (got.band !== expected) {
    fail(`band: ${label} — expected ${expected}, got ${got.band} (${got.recentPerWeek}/wk over ${got.effectiveDays}d)`);
  }
}

// --- 4. nothing changes for callers that don't pass a window ----------------
const legacy = sales(1, 2, 4);
const before = CompFinderLiquidity.assess({ soldComps: legacy, saturated: true, now: NOW });
if (before.band !== "very-liquid") {
  fail(`legacy: a capped set with no visibleDays should keep its old reading, got ${before.band}`);
}
const uncapped = CompFinderLiquidity.assess({ soldComps: legacy, saturated: false, now: NOW });
if (uncapped.effectiveDays !== 90) fail(`uncapped: window should stay 90 days, got ${uncapped.effectiveDays}`);
// visibleDays must never apply to an uncapped set — the 90-day window is real
// there, and shrinking it would inflate every slow card.
const ignored = CompFinderLiquidity.assess({ soldComps: legacy, saturated: false, visibleDays: 4, now: NOW });
if (ignored.effectiveDays !== 90) fail(`uncapped: visibleDays should be ignored, got ${ignored.effectiveDays}`);

// --- 5. nothing to measure --------------------------------------------------
const empty = CompFinderLiquidity.assess({ soldComps: [], saturated: true, visibleDays: 30, now: NOW });
if (empty.band !== "unknown") fail(`no sales should be "unknown", got ${empty.band}`);

// --- 6. the page and the harness agree, because it is one function ----------
const response = { hasNextPage: true };
const raw = sales(1, 2, 4, 58.5);
const viaHelper = assessLiquidity({ used: sales(1, 2, 4), response, comps: raw, now: NOW });
if (viaHelper.band !== "slow") fail(`assessLiquidity: expected slow, got ${viaHelper.band}`);
if (!viaHelper.capped) fail("assessLiquidity: a hasNextPage set should be capped");
if (viaHelper.reasons.some((r) => /the true total is higher/.test(r))) {
  fail("assessLiquidity: a visible window shouldn't claim the total is higher — it's complete over that window");
}

// --- 7. tripwire: nobody goes back to counting comps ------------------------
// The count guess was wrong on 21 of 40 cards and nothing failed, because
// every caller had its own copy of it. One definition, and a grep to keep it
// that way.
const OWNER = "apps/public/lib/liquidity.js";
const SELF = "scripts/check-liquidity.mjs";
const AUDIT = "scripts/audit-liquidity.mjs";   // exists to compare the policies
const SKIP_DIRS = new Set([".next", "node_modules"]);
const offenders = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(js|mjs)$/.test(full)) continue;
    const rel = relative(ROOT, full);
    if (rel === OWNER || rel === SELF || rel === AUDIT) continue;
    readFileSync(full, "utf8").split("\n").forEach((line, i) => {
      const code = line.trim().startsWith("//") || line.trim().startsWith("*") ? "" : line.replace(/\/\/.*$/, "");
      if (/\.length\s*>=\s*39\b/.test(code)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
}
for (const d of ["apps/public", "scripts", "packages/core"]) walk(join(ROOT, d));
for (const o of offenders) fail(`saturation guessed from a comp count outside ${OWNER}: ${o}`);

if (failures) {
  console.error(`\nliquidity: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log(`liquidity: ${SAT.length} cap-signal + ${BANDS.length} band cases hold (visible window, legacy path, count tripwire).`);
