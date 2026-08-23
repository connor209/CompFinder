/**
 * NOTE: reports rawPence — what a card is WORTH. finalPence, the recommended
 * listing price floored at £2.49 and rounded up a 50p charm ladder, belongs to
 * the business app and has no place in a "what's it worth" tool. Measured
 * against the Pulse best sellers, where a third of the cards trade under £5,
 * the ladder alone put our median at 1.11x their market price against an
 * honest 1.03x.
 */
/**
 * The 100-card audit. Same invariant approach as audit-public.mjs, run against
 * the approved list of current high-volume Pokémon singles.
 *
 * Checks self-consistency, not price accuracy — there is no ground truth here.
 * A card flagged below is one where the tool contradicts itself or returns
 * something it can't justify; a card that passes is one where nothing is
 * provably wrong, which is a weaker claim than "the price is right".
 *
 *   node scripts/audit-top100.mjs [--url ...] [--limit N] [--json out.json]
 */
import { createPacer } from "./lib/pace.mjs";
import { TOP_100 } from "./top100.mjs";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { buildCompTokens } from "../apps/public/lib/tokens.js";
import { writeFileSync } from "node:fs";
import { auditHeaders } from "./lib/audit-headers.mjs";
import { assessLiquidity } from "../apps/public/lib/liquidity.js";

const settings = CompFinderPricing.DEFAULT_SETTINGS;
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const LIMIT = Number(argOf("--limit", "999"));
const JSON_OUT = argOf("--json", null);

const pacer = createPacer({ onWait: (m) => console.log(`      ⏳ ${m}`) });
const gbp = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

async function price(query, sold) {
  const { status, body } = await pacer.call(async () => {
    const res = await fetch(`${BASE}/api/price`, {
      method: "POST",
      headers: auditHeaders(),
      body: JSON.stringify({ query, sold, soldAfterDays: 90 })
    });
    const json = await res.json().catch(() => ({ ok: false, error: `non-JSON (HTTP ${res.status})` }));
    return { status: res.status, body: json };
  });
  return { status, ...body };
}

const ukOnly = (comps) => comps.filter((c) => !c.itemLocation);

function analyse(card, res) {
  const comps = res.comps || [];
  const tokens = buildCompTokens({ name: card.name, number: card.number }, card.q);

  const nameOnly = buildCompTokens({ name: card.name }, card.q);

  const uk = CompFinderPricing.recommend(ukOnly(comps), settings, tokens, "sold", card.number, card.set);
  let ww = CompFinderPricing.recommend(comps, settings, tokens, "sold", card.number, card.set);

  // Mirrors the page's number fallback, so a re-run measures what a visitor
  // actually gets rather than a stricter path they never see.
  let numberUnmatched = false;
  if ((ww.included || []).length === 0 && card.number) {
    const byName = CompFinderPricing.recommend(comps, settings, nameOnly, "sold", null, card.set);
    if ((byName.included || []).length >= 3) { ww = byName; numberUnmatched = true; }
  }
  const used = ww.included || [];
  const totals = used.map((c) => c.totalPence);
  const lo = totals.length ? Math.min(...totals) : null;
  const hi = totals.length ? Math.max(...totals) : null;

  const byDate = used
    .filter((c) => c._source && c._source.endedAt)
    .sort((a, b) => new Date(b._source.endedAt) - new Date(a._source.endedAt));
  const lastSold = byDate.length ? byDate[0].totalPence : null;

  const liq = assessLiquidity({ used, response: res, comps, windowDays: 90 });
  const saturated = liq.capped;

  // Three outcomes worth telling apart, which the first run lumped together
  // as "no price": nothing usable at all, a card that only trades graded, and
  // one recovered by ignoring a number that doesn't exist.
  const gradedTiers = (ww.graded || []).length;
  const outcome = ww.rawPence != null
    ? (numberUnmatched ? "priced-via-name" : "priced")
    : gradedTiers > 0 ? "graded-only" : "nothing";

  const issues = [];
  const bare = card.number ? String(card.number).split("/")[0] : null;

  if (comps.length === 0) issues.push("no comps returned at all");
  if (outcome === "nothing") issues.push("no price and no graded sales");
  if (used.length > 0 && ww.rawPence == null) issues.push("price null despite comps used");
  if (lastSold != null && lo != null && (lastSold < lo || lastSold > hi)) {
    issues.push(`last sold ${gbp(lastSold)} outside used range`);
  }
  const graded = used.filter((c) => CompFinderPricing.parseGrade(c.title));
  if (graded.length) issues.push(`${graded.length} graded slab(s) priced as raw`);
  if (bare) {
    const off = used.filter((c) => !new RegExp(`\\b0*${bare.replace(/^0+/, "")}\\b|\\b${bare}\\b`).test(c.title));
    if (off.length > used.length / 2) issues.push(`${off.length}/${used.length} used comps don't mention ${bare}`);
  }
  if (lo && hi && lo > 0 && hi / lo > 10) issues.push(`used comps span ${(hi / lo).toFixed(0)}x`);
  if (comps.length > 0 && used.length === 0 && gradedTiers === 0) issues.push(`all ${comps.length} comps excluded`);

  const reasons = {};
  for (const e of ww.excluded || []) reasons[e.exclusionReason] = (reasons[e.exclusionReason] || 0) + 1;

  return {
    card, uk, ww, liq, saturated, issues, reasons, outcome, numberUnmatched, gradedTiers,
    fetched: comps.length, ukCount: ukOnly(comps).length,
    used: used.length, ukUsed: (uk.included || []).length,
    lastSold, lo, hi
  };
}

async function main() {
  const list = TOP_100.slice(0, LIMIT);
  console.log(`Auditing ${list.length} cards against ${BASE}\n`);
  const results = [];

  for (const [i, card] of list.entries()) {
    process.stdout.write(`[${String(i + 1).padStart(3)}/${list.length}] ${card.q.slice(0, 42).padEnd(43)}`);
    const res = await price(card.q, true);
    if (!res.ok) {
      console.log(`FAILED — ${res.error}`);
      results.push({ card, fatal: res.error, issues: [`fetch failed: ${res.error}`], used: 0, fetched: 0 });
      continue;
    }
    const r = analyse(card, res);
    console.log(
      `${String(r.fetched).padStart(3)}→${String(r.used).padStart(3)}  ${gbp(r.ww.rawPence).padStart(10)}  ` +
      `${r.liq.label.padEnd(16)}${r.issues.length ? ` ⚠ ${r.issues.length}` : ""}`
    );
    results.push(r);
  }

  report(results);
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(results.map((r) => ({
      card: r.card, fetched: r.fetched, ukCount: r.ukCount, used: r.used, ukUsed: r.ukUsed,
      price: r.ww?.rawPence ?? null, confidence: r.ww?.confidence ?? null,
      outcome: r.outcome, numberUnmatched: r.numberUnmatched, gradedTiers: r.gradedTiers,
      liquidity: r.liq?.label ?? null, saturated: r.saturated, issues: r.issues, reasons: r.reasons
    })), null, 2));
    console.log(`\nWrote ${JSON_OUT}`);
  }
}

function report(rs) {
  const ok = rs.filter((r) => !r.fatal);
  const flagged = ok.filter((r) => r.issues.length);
  const noPrice = ok.filter((r) => r.ww?.rawPence == null);

  console.log("\n" + "=".repeat(80));
  console.log(`${rs.length} cards · ${ok.length - noPrice.length} priced · ${noPrice.length} no price · ${flagged.length} flagged`);
  console.log("=".repeat(80));

  const outcomes = {};
  for (const r of ok) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
  console.log("\nOutcomes:");
  for (const [k, v] of Object.entries(outcomes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)}  ${k}`);
  }

  const byBand = {};
  for (const r of ok) {
    const b = r.card.band;
    byBand[b] = byBand[b] || { n: 0, priced: 0, flagged: 0 };
    byBand[b].n++;
    if (r.ww?.rawPence != null) byBand[b].priced++;
    if (r.issues.length) byBand[b].flagged++;
  }
  console.log("\nBy price band:");
  for (const [b, s] of Object.entries(byBand)) {
    console.log(`  ${b.padEnd(6)} ${String(s.n).padStart(3)} cards · ${String(s.priced).padStart(3)} priced · ${String(s.flagged).padStart(2)} flagged`);
  }

  const withNum = ok.filter((r) => r.card.number);
  const noNum = ok.filter((r) => !r.card.number);
  const pricedPct = (arr) => (arr.length ? Math.round((arr.filter((r) => r.ww?.rawPence != null).length / arr.length) * 100) : 0);
  console.log(`\nWith a collector number: ${pricedPct(withNum)}% priced (${withNum.length} cards)`);
  console.log(`Free text, no number:    ${pricedPct(noNum)}% priced (${noNum.length} cards)`);

  const totFetched = ok.reduce((a, r) => a + r.fetched, 0);
  const totUk = ok.reduce((a, r) => a + r.ukCount, 0);
  console.log(`\nUK share: ${totUk}/${totFetched} comps (${Math.round((totUk / totFetched) * 100)}%)`);
  console.log(`Saturated result sets: ${ok.filter((r) => r.saturated).length}/${ok.length}`);
  console.log(`UK-only would price:   ${ok.filter((r) => r.ukUsed > 0).length}/${ok.length}  (worldwide: ${ok.filter((r) => r.used > 0).length}/${ok.length})`);

  const all = {};
  for (const r of ok) for (const [k, v] of Object.entries(r.reasons || {})) all[k] = (all[k] || 0) + v;
  console.log("\nExclusions:");
  for (const [k, v] of Object.entries(all).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);

  if (noPrice.length) {
    console.log("\nNo price produced:");
    for (const r of noPrice) console.log(`  ${r.card.q.slice(0, 46).padEnd(47)} ${r.fetched} fetched · ${JSON.stringify(r.reasons)}`);
  }
  if (flagged.length) {
    console.log("\nFlagged:");
    for (const r of flagged) console.log(`  ${r.card.q.slice(0, 46).padEnd(47)} ${r.issues.join("; ")}`);
  }

  const p = pacer.stats();
  console.log(`\nPacing: ${p.served} calls, ${p.retried} backoffs, ${p.waitedSeconds}s waiting.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
