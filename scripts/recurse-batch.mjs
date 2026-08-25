/**
 * Recursion harness for the APP's batch pricing path — apps/app, not Last Comp.
 *
 *   node scripts/recurse-batch.mjs                       # all four tests, 4 runs
 *   node scripts/recurse-batch.mjs --runs 3
 *   node scripts/recurse-batch.mjs --csv <exported.csv>  # add the CSV cross-run test
 *   node scripts/recurse-batch.mjs --json out.json
 *
 * WHY THIS EXISTS. apps/public has audit-big / diff-runs / inspect-spans, so a
 * pricing rule there gets judged on data. The app's batch screen had nothing
 * equivalent: its pipeline lives inside a React component (Panel.js's
 * runBatchInner), so the only way to exercise it was to run a batch and read
 * the results by eye — which costs one SoldComps request per card and cannot
 * be re-run for free. This runs the same three calls Panel.js makes
 * (simplifyTitle -> extractNameTokens -> recommend) with no React, no network
 * and no quota.
 *
 * WHAT "RECURSIVE" MEANS HERE. Four different repetitions, because they fail
 * in different ways:
 *
 *   R1 determinism   — the same comps, N times. Any drift is the code's own.
 *   R2 fixed point   — price the card, then re-price it from the comps it just
 *                      kept, N generations deep. Every exclusion rule in
 *                      pricing.js is RELATIVE to the surviving pool (median
 *                      price, median postage, majority epid, minimum comp
 *                      counts), so a pipeline that moves on generation 2 is
 *                      reporting a fact about pool size rather than about the
 *                      market. A stable filter reaches its fixed point in one
 *                      pass; this measures whether it does.
 *   R3 jackknife     — drop one used comp and re-price, once per comp. The
 *                      CSV proves SoldComps' page composition churns between
 *                      identical calls (see the --csv test), so this is not a
 *                      hypothetical: it is the swing a single item of upstream
 *                      churn buys you.
 *   R4 guards        — which exclusion rules could not run at all, because the
 *                      pool that reached them was smaller than their own
 *                      minimum. A guard that never fires is not protecting
 *                      anything, and nothing on screen says so.
 *
 * REPRODUCIBILITY. recencyWeightedPrice() reads Date.now(), so a fixture's
 * prices would drift as it aged and stop matching the run it was taken from.
 * Every comp date is therefore shifted forward by (now - fixture.asOf), which
 * preserves each comp's AGE — the only thing the weighting actually uses — so
 * this reproduces the shipped figures whenever it is run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import CompFinderPricing from "@compfinder/core/pricing.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const RUNS = Number(argOf("--runs", "4"));
const CSV = argOf("--csv", null);
const JSON_OUT = argOf("--json", null);
const FIXTURE = argOf("--fixture", join(HERE, "fixtures", "neo-batch.json"));

const { recommend, simplifyTitle, extractNameTokens, toPoundsStr, DEFAULT_SETTINGS } = CompFinderPricing;
const gbp = (p) => (p == null ? "—" : toPoundsStr(p));
const bar = (s) => console.log(`\n${s}\n${"─".repeat(s.length)}`);

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const CLOCK_SHIFT = Date.now() - Date.parse(fixture.asOf);

/** Fixture comp -> the shape recommend() wants, with its age preserved. */
function toComp(c) {
  return {
    title: c.title,
    itemPricePence: c.itemPricePence,
    postagePence: c.postagePence || 0,
    condition: c.condition || null,
    epid: c.epid || null,
    categoryId: c.categoryId || null,
    itemLocation: c.itemLocation || null,
    _source: { endedAt: new Date(Date.parse(c.endedAt) + CLOCK_SHIFT).toISOString() }
  };
}

/** Exactly the three calls Panel.js's runBatchInner makes for one card. */
function priceLikeTheApp(card, comps) {
  const query = card.query ?? simplifyTitle(card.title, DEFAULT_SETTINGS.stripWords);
  const nameTokens = extractNameTokens(query);
  return { query, nameTokens, rec: recommend(comps, DEFAULT_SETTINGS, nameTokens, "sold", card.cardNumber || null, card.set || null) };
}

const reasonsOf = (rec) => {
  const out = {};
  for (const e of rec.excluded) out[e.exclusionReason] = (out[e.exclusionReason] || 0) + 1;
  return out;
};
const fmtReasons = (r) => Object.entries(r).map(([k, v]) => `${v} ${k}`).join(", ") || "none";

const report = { asOf: fixture.asOf, runs: RUNS, cards: [], csv: null };

// ── R0: does the harness reproduce the shipped run? ──────────────────────────
// Everything below is only worth reading if this passes. Where the fixture
// carries the whole used set, the price it computes must equal the price the
// app printed into the CSV — otherwise the model of the pipeline is wrong and
// the instability measured further down is the harness's, not the app's.
bar(`R0 · Does this harness reproduce the shipped run? (fixture as of ${fixture.asOf})`);
for (const card of fixture.cards) {
  const comps = card.comps.map(toComp);
  const { rec, nameTokens } = priceLikeTheApp(card, comps);
  const usedInFixture = card.comps.filter((c) => c.verdict === "used").length;
  const okPrice = rec.rawPence === card.observed.rawPence;
  const okUsed = rec.included.length === usedInFixture;
  console.log(
    `${okPrice && okUsed ? "✓" : "✗"} ${card.sku.padEnd(5)} ${card.query.padEnd(18)} ` +
    `harness ${gbp(rec.rawPence).padStart(7)} from ${rec.included.length} · ` +
    `app ${gbp(card.observed.rawPence).padStart(7)} from ${usedInFixture}` +
    (okPrice && okUsed ? "" : "   ← MISMATCH")
  );
  if (!okPrice || !okUsed) process.exitCode = 1;
  report.cards.push({ sku: card.sku, query: card.query, tokens: nameTokens, observed: card.observed, tests: {} });
}

const cardOf = (sku) => report.cards.find((c) => c.sku === sku);

// ── R1: determinism ─────────────────────────────────────────────────────────
bar(`R1 · Determinism — the same comps, ${RUNS} times`);
for (const card of fixture.cards) {
  const prices = [];
  for (let i = 0; i < RUNS; i++) prices.push(priceLikeTheApp(card, card.comps.map(toComp)).rec.finalPence);
  const stable = prices.every((p) => p === prices[0]);
  console.log(`${stable ? "✓" : "✗"} ${card.sku.padEnd(5)} ${card.query.padEnd(18)} ${prices.map(gbp).join("  ")}`);
  cardOf(card.sku).tests.determinism = { prices, stable };
}

// ── R2: fixed point ─────────────────────────────────────────────────────────
// Generation 0 is the run the app did. Generation N+1 re-prices from exactly
// the comps generation N kept. If the price moves, the exclusion rules are
// still changing their minds with nothing new to go on.
bar(`R2 · Fixed point — re-price from the comps just kept, ${RUNS} generations`);
for (const card of fixture.cards) {
  let comps = card.comps.map(toComp);
  const gens = [];
  for (let g = 0; g < RUNS; g++) {
    const { rec } = priceLikeTheApp(card, comps);
    gens.push({ gen: g, price: rec.finalPence, raw: rec.rawPence, used: rec.included.length, reasons: reasonsOf(rec) });
    if (rec.included.length === 0) break;
    // Strip the totalPence recommend() added, so generation N+1 re-derives it
    // rather than being handed a pre-computed answer.
    comps = rec.included.map(({ totalPence, exclusionReason, ...c }) => c);
  }
  const settled = gens.every((g) => g.price === gens[0].price && g.used === gens[0].used);
  console.log(
    `${settled ? "✓" : "✗"} ${card.sku.padEnd(5)} ${card.query.padEnd(18)} ` +
    gens.map((g) => `g${g.gen}:${gbp(g.price)}/${g.used}`).join("  ")
  );
  cardOf(card.sku).tests.fixedPoint = { gens, settled };
}

// ── R3: jackknife ───────────────────────────────────────────────────────────
bar("R3 · Jackknife — what one item of upstream churn is worth");
for (const card of fixture.cards) {
  const comps = card.comps.map(toComp);
  const base = priceLikeTheApp(card, comps).rec;
  const used = base.included;
  const swings = [];
  for (const drop of used) {
    const without = comps.filter((c) => !(c.title === drop.title && c.itemPricePence === drop.itemPricePence && c._source.endedAt === drop._source.endedAt));
    const alt = priceLikeTheApp(card, without).rec;
    swings.push({ dropped: drop.title.slice(0, 46), total: drop.totalPence, price: alt.finalPence, used: alt.included.length });
  }
  const prices = swings.map((s) => s.price).filter((p) => p != null);
  const lo = prices.length ? Math.min(...prices) : null;
  const hi = prices.length ? Math.max(...prices) : null;
  const worst = base.finalPence && lo != null
    ? Math.round((Math.max(Math.abs(hi - base.finalPence), Math.abs(base.finalPence - lo)) / base.finalPence) * 100)
    : null;
  console.log(`  ${card.sku.padEnd(5)} ${card.query.padEnd(18)} base ${gbp(base.finalPence).padStart(7)} from ${used.length} comps`);
  for (const s of swings) {
    console.log(`        drop ${gbp(s.total).padStart(7)}  → ${gbp(s.price).padStart(7)} from ${s.used}   ${s.dropped}`);
  }
  console.log(`        range ${gbp(lo)}–${gbp(hi)} · worst single-comp swing ${worst == null ? "—" : worst + "%"}`);
  cardOf(card.sku).tests.jackknife = { basePence: base.finalPence, baseUsed: used.length, swings, lo, hi, worstPct: worst };
}

// ── R4: guard starvation ────────────────────────────────────────────────────
// Each of these rules carries its own minimum, and below it the rule returns
// its input untouched. The pool that reaches them is whatever survived the
// name-token filter, so a card can lose 90% of its comps to one rule and then
// be handed to the rest with too few left for any of them to run.
const GUARDS = [
  { name: "splitPostageOutliers", min: DEFAULT_SETTINGS.postageOutlierMinComps, what: "flags postage that dwarfs the card" },
  { name: "splitByCatalogSignal", min: DEFAULT_SETTINGS.catalogSignalMinComps ?? 3, what: "eBay's own epid/category vote" },
  { name: "wide-spread confidence cap", min: 2, what: "caps confidence when comps disagree" }
];
bar("R4 · Guard starvation — which rules could not run on the pool that reached them");
for (const card of fixture.cards) {
  const { rec } = priceLikeTheApp(card, card.comps.map(toComp));
  const pool = rec.included.length;
  const starved = GUARDS.filter((g) => pool < g.min);
  console.log(
    `  ${card.sku.padEnd(5)} ${card.query.padEnd(18)} pool ${String(pool).padStart(2)} · ` +
    (starved.length ? `SILENT: ${starved.map((g) => `${g.name} (needs ${g.min})`).join(", ")}` : "all guards live")
  );
  cardOf(card.sku).tests.guards = { pool, starved: starved.map((g) => ({ name: g.name, min: g.min, what: g.what })) };
}

// ── R5: counterfactual ──────────────────────────────────────────────────────
// R4 says the postage guard never ran. This says what it would have done. The
// only thing changed is the guard's own minimum comp count — every threshold
// that decides WHICH comp is an outlier is left exactly as shipped, so this
// measures the starvation and nothing else.
bar("R5 · Counterfactual — the same comps, with the starved guards allowed to run");
for (const card of fixture.cards) {
  const comps = card.comps.map(toComp);
  const asShipped = priceLikeTheApp(card, comps).rec;
  const relaxed = { ...DEFAULT_SETTINGS, postageOutlierMinComps: 2, catalogSignalMinComps: 2, catalogSignalMinKept: 1 };
  const query = card.query;
  const rec = recommend(comps, relaxed, extractNameTokens(query), "sold", null, card.set || null);
  const removed = rec.excluded.filter((e) => !asShipped.excluded.some((x) => x.title === e.title && x.itemPricePence === e.itemPricePence));
  console.log(`  ${card.sku.padEnd(5)} ${card.query.padEnd(18)} as shipped ${gbp(asShipped.finalPence).padStart(7)} from ${asShipped.included.length}  →  ${gbp(rec.finalPence).padStart(7)} from ${rec.included.length}`);
  for (const r of removed) {
    console.log(`        would drop ${String(r.exclusionReason).padEnd(13)} item ${gbp(r.itemPricePence)} + post ${gbp(r.postagePence)}   ${r.title.slice(0, 44)}`);
  }
  if (!removed.length) console.log("        nothing further removed");
  cardOf(card.sku).tests.counterfactual = {
    shippedPence: asShipped.finalPence, shippedUsed: asShipped.included.length,
    relaxedPence: rec.finalPence, relaxedUsed: rec.included.length,
    wouldDrop: removed.map((r) => ({ reason: r.exclusionReason, item: r.itemPricePence, postage: r.postagePence, title: r.title }))
  };
}
console.log(
  "\n  Postage is why these figures look the way they do. freePostage adds the\n" +
  "  buyer's postage to the seller's price, which is right — a £2 card posted for\n" +
  "  £1.35 did cost somebody £3.35. It stops being right at £10 of postage on a\n" +
  "  £2 Japanese common, and splitPostageOutliers exists precisely to say so. It\n" +
  "  needs six comps to have an opinion, and the name-token filter never leaves it six."
);

// ── CSV cross-run test ──────────────────────────────────────────────────────
// The app's own export is a free recursion test that has already been run: a
// batch that lists the same card twice priced it twice, from two separate
// SoldComps calls minutes apart. Any difference between those rows is upstream
// churn measured on live data, not a model of it.
function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

if (CSV) {
  bar("CSV · The same query, priced twice in one live run");
  const rows = parseCsv(readFileSync(CSV, "utf8"));
  const byQuery = {};
  for (const r of rows) {
    const q = r["Simplified Query"];
    if (!q || r.Confidence === "Skipped") continue;
    (byQuery[q] ||= []).push(r);
  }
  const repeated = Object.entries(byQuery).filter(([, rs]) => rs.length > 1);
  let churned = 0, priceMoved = 0;
  const detail = [];
  for (const [q, rs] of repeated) {
    const used = [...new Set(rs.map((r) => r["Comps Used"]))];
    const excl = [...new Set(rs.map((r) => r["Comps Excluded"]))];
    const price = [...new Set(rs.map((r) => r["Recommended Price"]))];
    const sets = [...new Set(rs.map((r) => (/(Neo [A-Za-z]+|Trainer Magazine|Neo Premium File 1)/.exec(r.Title) || [])[1]))].filter(Boolean);
    const poolChurn = used.length > 1 || excl.length > 1;
    if (poolChurn) churned++;
    if (price.length > 1) priceMoved++;
    detail.push({ query: q, rows: rs.length, used, excluded: excl, price, declaredSets: sets, poolChurn, priceMoved: price.length > 1 });
    console.log(
      `  ${poolChurn ? "≠" : "="} ${q.padEnd(20)} ×${rs.length}  used ${used.join("/").padEnd(7)} excl ${excl.join("/").padEnd(8)} ` +
      `£${price.join("/").padEnd(12)} ${sets.length > 1 ? `⚠ declared as ${sets.length} different sets: ${sets.join(" + ")}` : ""}`
    );
  }
  console.log(`\n  ${repeated.length} queries priced more than once · ${churned} came back with a different comp pool · ${priceMoved} moved the price`);
  const collisions = detail.filter((d) => d.declaredSets.length > 1 && d.price.length === 1);
  if (collisions.length) {
    console.log(`  ${collisions.length} of them are DIFFERENT CARDS (different declared set, same query) that got the identical price:`);
    for (const c of collisions) console.log(`      ${c.query.padEnd(20)} ${c.declaredSets.join(" + ")} → £${c.price[0]}`);
  }
  report.csv = { repeated: repeated.length, churned, priceMoved, collisions: collisions.length, detail };
}

if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(report, null, 2)); console.log(`\nwrote ${JSON_OUT}`); }
