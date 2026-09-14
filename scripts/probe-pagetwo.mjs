/**
 * Is there a second page, and is it worth a request?
 *
 *   node scripts/probe-pagetwo.mjs --limit 10
 *   node scripts/probe-pagetwo.mjs --query "Umbreon VMAX 215/203 Evolving Skies"
 *   node scripts/probe-pagetwo.mjs --limit 4 --dry-run   # prints the URLs, spends nothing
 *
 * SoldComps returns one page of sales, newest first. Everything downstream is
 * built around that: `needsAnotherPass()` stops the search ladder on a FULL
 * page, `assessLiquidity()` reads the band off whether the set was CAPPED, and
 * `visibleDays` measures how far back that one page reached. All of it assumes
 * page two is unreachable — and `buildRequestUrl` has accepted a `page`
 * parameter the whole time that nothing has ever passed.
 *
 * So this asks the question directly, on the only cards where it can mean
 * anything: a card whose page one came back capped.
 *
 * WHAT THIS IS LOOKING FOR, in the order it matters.
 *
 * **Whether `page` does anything at all.** It is NOT one of the parameters
 * soldcomps.js records as confirmed — keyword, count, ebaySite, sortOrder,
 * itemCondition came off a captured dashboard request, itemLocation and
 * soldAfter off their docs page. `page` came off neither. An ignored parameter
 * does not error: it serves page one again, and a merge that de-duplicates
 * correctly then reports "0 new" rather than "this does not work". That is the
 * failure this repo keeps paying for — the quiet one — so it is the first
 * thing printed and it is printed as a verdict, not as a percentage.
 *
 * **Whether it reaches further back.** This is the liquidity payoff and it is
 * separate from the count. A capped card's window is not 90 days, it is however
 * long those ~40 sales took; `visibleDays` divides by that span. A second page
 * that doubles the reach fixes the band on exactly the fast cards the cap
 * currently misreads.
 *
 * **Whether the price moves.** Through `priceCard()` — the page's own
 * pipeline, not a re-implementation — because a harness that prices slightly
 * differently from the page is reporting on a product that does not exist.
 * Expect it to move very little: a capped card already has fifteen-plus comps
 * and the median absorbs a stray. A price that does NOT move while the reach
 * doubles is the honest result, and it is still a win — it is the liquidity
 * read and the graded pools that were thin, not the median.
 *
 * COST. Two billed requests per capped card, one per uncapped one, against a
 * Starter plan of 2,000 a month shared with live visitors and the warmer. The
 * limit defaults low on purpose and the bill is printed at the end.
 *
 * Nothing here writes to the cache or touches the app's own path — it calls
 * SoldComps directly, the way apps/app/app/api/soldcomps/route.js does, so
 * what it measures is the supplier's behaviour rather than ours.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPacer } from "./lib/pace.mjs";
import { priceCard } from "./lib/price-card.mjs";
import { compKey } from "../apps/app/lib/searchpasses.js";
import SoldCompsApi from "@compfinder/core/pricing.js";
import SoldComps from "@compfinder/core/soldcomps.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DRY = has("--dry-run");
const LIMIT = Number(argOf("--limit", 8));
const SET = argOf("--set", join(HERE, "bigset-en2.json"));
const ONE = argOf("--query", null);

// The same name the public page reads (apps/public/.env.local.example). Never
// printed, never interpolated into anything this script logs.
const KEY = process.env.SOLDCOMPS_API_KEY;
if (!KEY && !DRY) {
  console.error("SOLDCOMPS_API_KEY is not set — export it and run again. --dry-run needs no key.");
  process.exit(2);
}

/**
 * Page one is sent EXACTLY as production sends it — same count, window,
 * location and sort as apps/app's route and /api/price. A probe that asks a
 * slightly different question answers one.
 */
const REQUEST = { count: 240, ebaySite: "ebay.co.uk", sortOrder: "endedRecently", itemCondition: "any", itemLocation: "domestic", soldAfterDays: 90 };

const cards = ONE
  ? [{ name: ONE, number: "", set: "", q: ONE }]
  : JSON.parse(readFileSync(SET, "utf8"))
      // Chase cards first: a capped page is the precondition for this probe
      // having anything to measure, and cheap commons are capped almost never
      // — the 50-card commons run returned a median of 11.
      .filter((c) => /special illustration|secret|hyper|illustration rare|ultra rare/i.test(c.rarity || ""))
      .slice(0, LIMIT)
      .map((c) => ({ ...c, q: `${c.name} ${c.number} ${c.set}` }));

const url = (q, page) => SoldComps.buildRequestUrl({ ...REQUEST, keyword: q, page });

if (DRY) {
  console.log(`\nWould send ${cards.length} card${cards.length === 1 ? "" : "s"}, page 1 then page 2 only where page 1 is capped:\n`);
  for (const c of cards) {
    console.log(`  ${c.q}`);
    console.log(`    p1  ${url(c.q, 1)}`);
    console.log(`    p2  ${url(c.q, 2)}`);
  }
  console.log(`\nCeiling ${cards.length * 2} requests. Nothing sent. Authorization: Bearer <key> on each.\n`);
  process.exit(0);
}

const pacer = createPacer({ onWait: (m) => process.stdout.write(`\n  ${m}\n`) });

async function fetchPage(q, page) {
  const { status, body } = await pacer.call(async () => {
    const r = await fetch(url(q, page), {
      headers: { Authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(20_000)
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  if (status !== 200 || !body) return null;
  const parsed = SoldComps.parseResponse(body, "GBP");
  const items = Array.isArray(body.items) ? body.items : [];
  return { comps: parsed.comps, hasNextPage: parsed.hasNextPage, raw: items.length, items };
}

/**
 * Does SoldComps still call the sold date `endedAt`?
 *
 * Printed once, off the first response, costing nothing — because the answer
 * is worth more than the rest of this script if it is no. `mapItem()` reads
 * `apiItem.endedAt` and nothing else, so a renamed field does not error: every
 * comp gets `_source.endedAt: undefined` and the date column goes blank, which
 * is the visible symptom. What is NOT visible is everything else that reads
 * that field — the recency weighting inside `recommend()`, `visibleDays` in
 * liquidity.js, the sold window in windows.js, and the "last one sold on"
 * line the public page leads with. Those degrade silently and still print a
 * confident number.
 *
 * So this reports what the raw item actually carries, rather than what we
 * hoped it would.
 */
function reportFields(items) {
  const first = items[0];
  if (!first) return console.log("  FIELD CHECK · no items came back, nothing to read.\n");
  const keys = Object.keys(first);
  const dateish = keys.filter((k) => /date|end|sold|time/i.test(k));
  const withEnded = items.filter((it) => it && it.endedAt).length;
  console.log("  FIELD CHECK · what one raw SoldComps item carries");
  console.log(`    date-ish keys   ${dateish.length ? dateish.join(", ") : "NONE"}`);
  console.log(`    endedAt present ${withEnded}/${items.length} items`);
  if (!withEnded) {
    console.log("    ⚠ mapItem() reads apiItem.endedAt and nothing else. With none populated, every");
    console.log("      comp's date is blank AND the recency weighting, liquidity's visibleDays and the");
    console.log("      public page's last-sold line are all running on nothing. Fix this before page 2.");
  }
  console.log(`    all keys        ${keys.join(", ")}\n`);
}

/** How far back a comp set reaches, in days ending now. Same read as liquidity.js. */
function reachDays(comps) {
  let oldest = null;
  for (const c of comps) {
    const at = c?._source?.endedAt ? new Date(c._source.endedAt).getTime() : NaN;
    if (Number.isNaN(at)) continue;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest === null ? null : Math.max((Date.now() - oldest) / 86400000, 0.5);
}

const gbp = (p) => (p == null ? "—" : SoldCompsApi.toPoundsStr(p));
const rows = [];
let spent = 0;
let capped = 0;
let fieldsReported = false;
let ignored = 0;

for (const [i, card] of cards.entries()) {
  process.stdout.write(`\r  ${i + 1}/${cards.length} · ${spent} requests   `);

  const p1 = await fetchPage(card.q, 1);
  spent++;
  if (!p1) { rows.push({ card, note: "page 1 failed" }); continue; }

  if (!fieldsReported) { process.stdout.write("\r".padEnd(60) + "\r\n"); reportFields(p1.items); fieldsReported = true; }

  if (!p1.hasNextPage) {
    rows.push({ card, note: `not capped (${p1.raw} items) — no page 2 to ask for`, p1 });
    continue;
  }
  capped++;

  const p2 = await fetchPage(card.q, 2);
  spent++;
  if (!p2) { rows.push({ card, note: "page 2 failed", p1 }); continue; }

  // The verdict that matters. A merge keyed on compKey() — the same rule
  // searchpasses.js counts a sale by, so two sources of truth about what makes
  // one listing one listing cannot drift — reports 0 new for an ignored
  // parameter and for a genuinely empty second page alike. They are different
  // findings: an ignored parameter serves the SAME ids back.
  const seen = new Set(p1.comps.map(compKey));
  const fresh = p2.comps.filter((c) => !seen.has(compKey(c)));
  const identical = p2.comps.length > 0 && fresh.length === 0 && p2.comps.length === p1.comps.length;
  if (identical) ignored++;

  const merged = [...p1.comps, ...fresh];
  const before = priceCard(card, p1.comps);
  const after = priceCard(card, merged);

  rows.push({
    card, p1, p2, fresh: fresh.length, identical, merged,
    reachBefore: reachDays(p1.comps), reachAfter: reachDays(merged),
    before, after
  });
}

process.stdout.write("\r".padEnd(60) + "\r");

console.log(`\n  Page-two probe · ${cards.length} cards · ${capped} came back capped\n`);
for (const r of rows) {
  console.log(`  ${r.card.q}`);
  if (r.note) { console.log(`    ${r.note}\n`); continue; }
  if (r.identical) {
    console.log(`    ⚠ PAGE 2 IS PAGE 1 — ${r.p2.comps.length} items, every id already seen.`);
    console.log(`      The parameter is being ignored, not the page being empty. One request spent for nothing.\n`);
    continue;
  }
  const reach = r.reachAfter && r.reachBefore ? `${r.reachBefore.toFixed(0)}d → ${r.reachAfter.toFixed(0)}d` : "—";
  console.log(`    items   ${r.p1.comps.length} + ${r.p2.comps.length} → ${r.fresh} new after dedupe`);
  console.log(`    reach   ${reach}${r.p2.hasNextPage ? "  (still capped — a page 3 exists)" : ""}`);
  console.log(`    price   ${gbp(r.before.pence)} (${r.before.used} used) → ${gbp(r.after.pence)} (${r.after.used} used)\n`);
}

const usable = rows.filter((r) => r.fresh != null && !r.identical);
const newTotal = usable.reduce((n, r) => n + r.fresh, 0);
console.log(`  ${spent} requests spent.`);
if (ignored) console.log(`  ${ignored} of ${capped} capped cards served page 1 twice — treat \`page\` as unsupported until that is 0.`);
if (usable.length) {
  const movedReach = usable.filter((r) => r.reachAfter && r.reachBefore && r.reachAfter > r.reachBefore * 1.25).length;
  const movedPrice = usable.filter((r) => r.before.pence && r.after.pence && Math.abs(r.after.pence - r.before.pence) / r.before.pence > 0.05).length;
  console.log(`  ${newTotal} new sales across ${usable.length} capped cards · reach extended on ${movedReach} · price moved >5% on ${movedPrice}.`);
}
console.log("");
