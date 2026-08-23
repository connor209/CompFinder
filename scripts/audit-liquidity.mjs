/**
 * Does the page read liquidity the same way the harness does?
 *
 *   node scripts/audit-liquidity.mjs [--n 40] [--json out.json]
 *
 * The band shown on the page ("Sells fast", "Slow mover") hangs almost
 * entirely on one boolean: whether the result set was CAPPED. SoldComps
 * returns about forty sales per page newest-first, so for a fast card the
 * window isn't 90 days, it's however long those forty sales took — and
 * dividing forty by ninety instead of by twelve understates the rate sevenfold.
 *
 * There are two ways to spot a cap and they are not the same test:
 *
 *   hasNextPage   the API saying so. Authoritative.
 *   comps >= 39   a full page is the observable symptom. A guess.
 *
 * The audits use `hasNextPage === true || comps.length >= 39`. The page uses
 * only the count, because lib/price.js drops hasNextPage on the floor. They
 * agree on most cards and that is exactly the problem: a heuristic that is
 * usually right is the kind that gets trusted. This measures how often they
 * disagree, in which direction, and whether the band a visitor sees changes.
 *
 * The suspected gap is currency filtering. parseResponse drops non-GBP items,
 * so a full page of forty can arrive as twenty-eight comps — capped by the
 * API, not capped by the count.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPacer } from "./lib/pace.mjs";
import { auditHeaders } from "./lib/audit-headers.mjs";
import { priceCard } from "./lib/price-card.mjs";
import CompFinderLiquidity from "@compfinder/core/liquidity.js";
import { assessLiquidity } from "../apps/public/lib/liquidity.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const N = Number(argOf("--n", "40"));
const JSON_OUT = argOf("--json", null);
const pacer = createPacer({ onWait: (m) => console.log(`   ⏳ ${m}`) });

/**
 * Half chase cards, half cheap ones. The disagreement we're looking for needs
 * cards whose comp count lands near the page size from below, and those are
 * commons and trainers rather than the chase set where everything is capped.
 */
function sample() {
  const big = JSON.parse(readFileSync(join(HERE, "bigset.json"), "utf8"));
  const wide = JSON.parse(readFileSync(join(HERE, "wideset.json"), "utf8"))
    .filter((c) => c.game === "pokemon");
  const half = Math.ceil(N / 2);
  const every = (list, want) => {
    const step = Math.max(1, Math.floor(list.length / want));
    return list.filter((_, i) => i % step === 0).slice(0, want);
  };
  return [...every(big, half), ...every(wide, N - half)]
    .map((c) => ({ ...c, q: `${c.name} ${c.number} ${c.set}` }));
}

async function fetchComps(query) {
  const { body } = await pacer.call(async () => {
    const res = await fetch(`${BASE}/api/price`, {
      method: "POST", headers: auditHeaders(),
      body: JSON.stringify({ query, sold: true, soldAfterDays: 90 })
    });
    return { status: res.status, body: await res.json().catch(() => ({ ok: false, error: "bad json" })) };
  });
  return body && body.ok ? body : null;
}

const NOW = Date.now();
const CARDS = sample();
console.log(`Liquidity read: ${CARDS.length} cards, page signal vs count signal\n`);

const rows = [];
for (const card of CARDS) {
  const res = await fetchComps(card.q);
  if (!res) { console.log(`  ✗ ${card.q} — no response`); continue; }

  const comps = res.comps || [];
  const { rec } = priceCard(card, comps);
  const used = rec ? rec.included || [] : [];

  const liq = (saturated) => CompFinderLiquidity.assess({
    soldComps: used, activeCount: null, windowDays: 90, saturated
  });

  // Three policies for the one boolean everything hangs on.
  const known = res.hasNextPage != null;
  const POLICY = {
    // What the page does today: lib/price.js never sees hasNextPage.
    count: comps.length >= 39,
    // What the audit scripts do: the page signal, with the count as a backstop.
    either: res.hasNextPage === true || comps.length >= 39,
    // Proposed: believe the API when it has spoken; guess only when it hasn't
    // (a cache entry written before the field existed).
    trustPage: known ? res.hasNextPage === true : comps.length >= 39
  };

  const bands = {};
  const rates = {};
  for (const [name, saturated] of Object.entries(POLICY)) {
    const l = liq(saturated);
    bands[name] = l.band;
    rates[name] = l.recentPerWeek;
  }

  // A fourth reading, and the one that exposes the deeper problem. `saturated`
  // describes the RAW fetch — forty listings, more pages behind them — but
  // assess() derives the span from the comps it is handed, which are what
  // survived filtering. On a Hoothoot that is 5 sales out of 40 listings: the
  // page cap truncated the SEARCH, not this card's sales, so reading the rate
  // off the 5-day span between those five is a different claim entirely.
  //
  // What page one can actually support is "this card sold N times in the
  // window page one covers" — so the window is the raw span, and the sales are
  // the filtered ones.
  const rawTimes = comps
    .map((c) => (c._source && c._source.endedAt ? new Date(c._source.endedAt).getTime() : NaN))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a);
  const rawSpanDays = rawTimes.length >= 2
    ? Math.max((rawTimes[0] - rawTimes[rawTimes.length - 1]) / 86400000, 0.5)
    : null;
  const capped = POLICY.trustPage;
  const byRawSpan = capped && rawSpanDays
    ? CompFinderLiquidity.assess({ soldComps: used, activeCount: null, windowDays: rawSpanDays, saturated: false })
    : liq(POLICY.trustPage);
  bands.rawSpan = byRawSpan.band;
  rates.rawSpan = byRawSpan.recentPerWeek;

  // A fifth: what the page now ships. Scored through the shared helper rather
  // than re-derived here — a harness with its own copy of the model is how the
  // count guess survived unnoticed in the first place.
  const shipped = assessLiquidity({ used, response: res, comps, windowDays: 90, now: NOW });
  bands.visible = shipped.band;
  rates.visible = shipped.recentPerWeek;
  const visibleDays = shipped.capped ? shipped.effectiveDays : null;

  rows.push({
    q: card.q,
    rarity: card.rarity,
    rawItemCount: res.rawItemCount ?? null,
    fetched: comps.length,
    used: used.length,
    hasNextPage: res.hasNextPage ?? null,
    droppedByCurrency: res.rawItemCount != null ? res.rawItemCount - comps.length : null,
    ...POLICY,
    bands,
    rates,
    rawSpanDays: rawSpanDays != null ? Math.round(rawSpanDays * 10) / 10 : null,
    visibleDays: visibleDays != null ? Math.round(visibleDays * 10) / 10 : null,
    usedSpanDays: (() => {
      const t = used.map((c) => (c._source && c._source.endedAt ? new Date(c._source.endedAt).getTime() : NaN))
        .filter((x) => !Number.isNaN(x)).sort((a, b) => b - a);
      return t.length >= 2 ? Math.round(((t[0] - t[t.length - 1]) / 86400000) * 10) / 10 : null;
    })(),
    concentratedShown: liq(POLICY.trustPage).concentrated,
    concentratedRawSpan: byRawSpan.concentrated,
    concentratedShipped: shipped.concentrated,
    momentumShipped: shipped.momentum,
    reasonShipped: shipped.reasons[0] || null,
    // The count guess, against the API's own answer.
    missedCap: known && res.hasNextPage === true && !POLICY.count,
    falseCap: known && res.hasNextPage === false && POLICY.count
  });

  const r = rows[rows.length - 1];
  const flag = r.missedCap ? "  ← missed a cap" : r.falseCap ? "  ← claimed a cap" : "";
  console.log(
    `  ${String(comps.length).padStart(3)} comps` +
    ` (raw ${String(res.rawItemCount ?? "?").padStart(3)}, next=${String(res.hasNextPage).padEnd(5)})` +
    `  ${bands.count.padEnd(12)} ${card.q.slice(0, 44)}${flag}`
  );
}

const missed = rows.filter((r) => r.missedCap);
const claimed = rows.filter((r) => r.falseCap);
const movedFromToday = rows.filter((r) => r.bands.count !== r.bands.trustPage);
const movedFromHarness = rows.filter((r) => r.bands.either !== r.bands.trustPage);

console.log(`\n${"-".repeat(72)}`);
console.log(`cards measured                         ${rows.length}`);
console.log(`the count guess got the cap wrong      ${missed.length + claimed.length}`);
console.log(`  capped, but under 39 comps came back   ${missed.length}   (rate understated)`);
console.log(`  not capped, but 39+ comps came back    ${claimed.length}   (rate overstated, and the copy claims a cap that never happened)`);
console.log(`\nband a visitor sees, if we believe hasNextPage:`);
console.log(`  changes vs the page today             ${movedFromToday.length}`);
console.log(`  changes vs the audit harness          ${movedFromHarness.length}`);

const spread = (key) => {
  const c = {};
  for (const r of rows) c[r.bands[key]] = (c[r.bands[key]] || 0) + 1;
  return c;
};
console.log(`\nband distribution`);
for (const key of ["count", "either", "trustPage", "rawSpan", "visible"]) {
  const c = spread(key);
  console.log(`  ${key.padEnd(10)} ` + ["very-liquid", "liquid", "slow", "illiquid", "unknown"]
    .map((b) => `${b} ${String(c[b] || 0).padStart(2)}`).join("   "));
}

if (movedFromToday.length) {
  console.log(`\nWhat changes on the page:`);
  for (const r of movedFromToday) {
    console.log(`  ${r.q}`);
    console.log(`     ${r.bands.count} (${r.rates.count}/wk) → ${r.bands.trustPage} (${r.rates.trustPage}/wk)` +
                `   ${r.fetched} comps, next=${r.hasNextPage}`);
  }
}

const cappedRows = rows.filter((r) => r.trustPage && r.used > 0);
const spanGap = cappedRows.filter((r) => r.rawSpanDays && r.usedSpanDays && r.rawSpanDays > r.usedSpanDays * 1.25);
console.log(`\ncapped cards where the filtered span is narrower than the page's span: ${spanGap.length} of ${cappedRows.length}`);
const movedByRawSpan = cappedRows.filter((r) => r.bands.rawSpan !== r.bands.trustPage);
console.log(`bands that move again if the window is the page's span, not the survivors': ${movedByRawSpan.length}`);
if (movedByRawSpan.length) {
  for (const r of movedByRawSpan) {
    console.log(`  ${r.q}`);
    console.log(`     ${r.used} sales kept of ${r.fetched}` +
      `   span: survivors ${r.usedSpanDays}d vs page ${r.rawSpanDays}d` +
      `   ${r.bands.trustPage} (${r.rates.trustPage}/wk) → ${r.bands.rawSpan} (${r.rates.rawSpan}/wk)`);
  }
}
const movedByVisible = cappedRows.filter((r) => r.bands.visible !== r.bands.count);
console.log(`\nWindow = how far back page one reaches, ending now:`);
console.log(`  bands that differ from what the page shows today: ${movedByVisible.length} of ${cappedRows.length} capped cards`);
for (const r of movedByVisible) {
  console.log(`  ${r.q}`);
  console.log(`     ${r.used} sales kept of ${r.fetched}   page reaches back ${r.visibleDays}d` +
    `   today ${r.bands.count} (${r.rates.count}/wk) → ${r.bands.visible} (${r.rates.visible}/wk)`);
}

const regains = cappedRows.filter((r) => !r.concentratedShown && r.concentratedShipped);
console.log(`bunching warnings the capped flag was suppressing: ${regains.length}`);

const withRaw = rows.filter((r) => r.droppedByCurrency != null);
if (withRaw.length) {
  const dropped = withRaw.filter((r) => r.droppedByCurrency > 0);
  console.log(`\nnon-GBP items dropped by the parser: ${dropped.length} of ${withRaw.length} cards`);
}

const pageSizes = rows.filter((r) => r.hasNextPage === true).map((r) => r.rawItemCount).filter((n) => n != null);
if (pageSizes.length) {
  console.log(`page size when the API says there is more: ${Math.min(...pageSizes)}\u2013${Math.max(...pageSizes)} items`);
}
const overPage = rows.filter((r) => r.hasNextPage === false && r.rawItemCount != null && r.rawItemCount >= 39);
if (overPage.length) {
  console.log(`sets of 39+ that were NOT capped: ${overPage.length}, up to ${Math.max(...overPage.map((r) => r.rawItemCount))} items`);
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
  console.log(`\nwrote ${JSON_OUT}`);
}
console.log(`\npacer: ${JSON.stringify(pacer.stats())}`);
