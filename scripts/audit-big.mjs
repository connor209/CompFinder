/**
 * Large-scale consistency audit. Numbers come from the catalogue (see
 * build-bigset.mjs), so a failure is the tool's rather than my recall's.
 *
 *   node scripts/audit-big.mjs [--limit N] [--json out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Resolved against this file, so the script runs from any working directory —
// it has to be invoked from apps/public for the workspace imports to resolve.
const HERE = dirname(fileURLToPath(import.meta.url));
import { createPacer } from "./lib/pace.mjs";
import CompFinderPricing from "@compfinder/core/pricing.js";
import CompFinderLiquidity from "@compfinder/core/liquidity.js";
import { buildCompTokens, dropWrongSetTotal } from "../apps/public/lib/tokens.js";
import { UK, splitByMarket, marketsIn } from "../apps/public/lib/markets.js";
import { settingsForCard } from "../apps/public/lib/settings.js";
import { variantsPresent } from "../apps/public/lib/variants.js";

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const LIMIT = Number(argOf("--limit", "9999"));
const JSON_OUT = argOf("--json", null);
const pacer = createPacer({ onWait: (m) => console.log(`   ⏳ ${m}`) });
const gbp = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

// Weighted toward the rarities people actually pay for, per the brief to avoid
// cheap cards, while keeping enough of the commoner chase tiers to notice if
// something only breaks there.
const ALL = JSON.parse(readFileSync(process.env.BIGSET || join(HERE, "bigset.json"), "utf8"));
const TIER = (r) => /special illustration|secret|hyper|amazing|shiny/i.test(r) ? 0
  : /illustration rare|art rare/i.test(r) ? 1
  : /ultra rare|rare ultra/i.test(r) ? 2 : 3;
const pick = [];
for (const tier of [0, 1, 2, 3]) {
  const g = ALL.filter((c) => TIER(c.rarity) === tier);
  pick.push(...(tier <= 1 ? g : g.filter((_, i) => i % (tier === 2 ? 4 : 6) === 0)));
}
const CARDS = pick.slice(0, LIMIT).map((c) => ({ ...c, q: `${c.name} ${c.number} ${c.set}` }));

async function price(query) {
  const { body } = await pacer.call(async () => {
    const res = await fetch(`${BASE}/api/price`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, sold: true, soldAfterDays: 90 })
    });
    return { status: res.status, body: await res.json().catch(() => ({ ok: false, error: "bad json" })) };
  });
  return body;
}

function analyse(card, res) {
  const comps = res.comps || [];
  const cs = settingsForCard(card);
  const tokens = buildCompTokens({ name: card.name, number: card.number }, card.q);
  const guarded = dropWrongSetTotal(comps, card.number);
  const { chosen, rest } = splitByMarket(guarded, UK);
  const all = [...chosen, ...rest];

  let rec = all.length ? CompFinderPricing.recommend(all, cs, tokens, "sold", card.number, card.set) : null;
  let viaName = false;
  if (rec && (rec.included || []).length === 0) {
    const alt = CompFinderPricing.recommend(all, cs, buildCompTokens({ name: card.name }, card.q), "sold", null, card.set);
    if ((alt.included || []).length >= 3) { rec = alt; viaName = true; }
  }
  const ukRec = chosen.length ? CompFinderPricing.recommend(chosen, cs, tokens, "sold", card.number, card.set) : null;

  const used = rec ? rec.included || [] : [];
  const totals = used.map((c) => c.totalPence);
  const lo = totals.length ? Math.min(...totals) : null;
  const hi = totals.length ? Math.max(...totals) : null;
  const dated = used.filter((c) => c._source?.endedAt).sort((a, b) => new Date(b._source.endedAt) - new Date(a._source.endedAt));
  const lastSold = dated.length ? dated[0].totalPence : null;
  const price = rec?.rawPence ?? null;

  const liq = CompFinderLiquidity.assess({
    soldComps: used, activeCount: null, windowDays: 90,
    saturated: res.hasNextPage === true || comps.length >= 39
  });

  const issues = [];
  if (!comps.length) issues.push("no comps fetched");
  else if (!used.length && !(rec?.graded || []).length) issues.push("everything excluded");
  if (used.length && price == null) issues.push("price null with comps used");
  if (lastSold != null && lo != null && (lastSold < lo || lastSold > hi)) issues.push("last sold outside range");
  if (used.some((c) => CompFinderPricing.parseGrade(c.title))) issues.push("graded counted as raw");
  if (lo && hi && lo > 0 && hi / lo > 15) issues.push(`span ${(hi / lo).toFixed(0)}x`);
  if (used.length === 1) issues.push("priced off a single comp");

  const reasons = {};
  for (const e of rec?.excluded || []) reasons[e.exclusionReason] = (reasons[e.exclusionReason] || 0) + 1;

  return {
    card, price, used: used.length, ukUsed: ukRec ? (ukRec.included || []).length : 0,
    fetched: comps.length, confidence: rec?.confidence ?? null, liquidity: liq.label,
    gradedTiers: (rec?.graded || []).length, viaName, issues, reasons,
    variants: variantsPresent(comps), markets: marketsIn(guarded).length,
    lo, hi, saturated: res.hasNextPage === true || comps.length >= 39
  };
}

const rows = [];
console.log(`Auditing ${CARDS.length} catalogue-verified chase cards against ${BASE}\n`);
for (const [i, card] of CARDS.entries()) {
  const res = await price(card.q);
  if (!res.ok) { rows.push({ card, fatal: res.error, issues: ["fetch failed"], used: 0, fetched: 0, reasons: {} }); continue; }
  const r = analyse(card, res);
  rows.push(r);
  if ((i + 1) % 20 === 0 || i === CARDS.length - 1) {
    const p = rows.filter((x) => x.price != null).length;
    process.stdout.write(`\r  ${i + 1}/${CARDS.length} · ${p} priced · ${rows.filter((x) => x.issues?.length).length} flagged   `);
  }
}
console.log("\n");
report(rows);
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1)); console.log(`\nWrote ${JSON_OUT}`); }

function report(rs) {
  const ok = rs.filter((r) => !r.fatal);
  const priced = ok.filter((r) => r.price != null);
  const flagged = ok.filter((r) => r.issues.length);
  console.log("=".repeat(78));
  console.log(`${rs.length} cards · ${priced.length} priced (${Math.round(priced.length / ok.length * 100)}%) · ${flagged.length} flagged`);
  console.log("=".repeat(78));

  const byRar = {};
  for (const r of ok) {
    const k = r.card.rarity;
    byRar[k] = byRar[k] || { n: 0, p: 0, f: 0 };
    byRar[k].n++; if (r.price != null) byRar[k].p++; if (r.issues.length) byRar[k].f++;
  }
  console.log("\nBy rarity:");
  for (const [k, v] of Object.entries(byRar).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k.slice(0,26).padEnd(27)} ${String(v.p).padStart(3)}/${String(v.n).padEnd(3)} priced · ${String(v.f).padStart(3)} flagged`);
  }

  const iss = {};
  for (const r of ok) for (const i of r.issues) {
    const k = i.startsWith("span") ? "wide span (>15x)" : i;
    iss[k] = (iss[k] || 0) + 1;
  }
  console.log("\nIssues:");
  for (const [k, v] of Object.entries(iss).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);

  const conf = {};
  for (const r of priced) conf[r.confidence] = (conf[r.confidence] || 0) + 1;
  console.log("\nConfidence:", Object.entries(conf).map(([k, v]) => `${k} ${v}`).join(" · "));

  const usedBuckets = { "0": 0, "1-2": 0, "3-5": 0, "6-10": 0, "11-20": 0, "21+": 0 };
  for (const r of ok) {
    const u = r.used;
    usedBuckets[u === 0 ? "0" : u <= 2 ? "1-2" : u <= 5 ? "3-5" : u <= 10 ? "6-10" : u <= 20 ? "11-20" : "21+"]++;
  }
  console.log("Comps used:", Object.entries(usedBuckets).map(([k, v]) => `${k}:${v}`).join(" · "));

  const all = {};
  for (const r of ok) for (const [k, v] of Object.entries(r.reasons)) all[k] = (all[k] || 0) + v;
  console.log("\nExclusions:");
  for (const [k, v] of Object.entries(all).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);

  console.log(`\nvia name fallback: ${ok.filter((r) => r.viaName).length}`);
  console.log(`saturated:         ${ok.filter((r) => r.saturated).length}/${ok.length}`);
  console.log(`UK-only would price: ${ok.filter((r) => r.ukUsed > 0).length}/${ok.length}`);
  const vc = ok.filter((r) => Object.keys(r.variants || {}).length).length;
  console.log(`cards with variant listings present: ${vc}/${ok.length}`);

  const none = ok.filter((r) => r.price == null);
  if (none.length) {
    console.log(`\nNo price (${none.length}):`);
    for (const r of none.slice(0, 30)) console.log(`  ${r.card.q.slice(0,52).padEnd(53)} ${r.fetched} fetched · ${JSON.stringify(r.reasons)}`);
    if (none.length > 30) console.log(`  … and ${none.length - 30} more`);
  }
  const p = pacer.stats();
  console.log(`\nPacing: ${p.served} calls, ${p.retried} backoffs, ${p.waitedSeconds}s waiting.`);
}
