/**
 * Runs the PulseTCG movers list — chosen because it's awkward, not because
 * it's representative. Reports where we differ and, more usefully, WHY.
 *
 *   node scripts/compare-movers.mjs [--limit N]
 */
import { createPacer } from "./lib/pace.mjs";
import { MOVERS } from "./movers.mjs";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { buildCompTokens } from "../apps/public/lib/tokens.js";
import { UK, splitByMarket } from "../apps/public/lib/markets.js";
import { settingsForCard } from "../apps/public/lib/settings.js";
import { priceCard } from "./lib/price-card.mjs";
import { resolveCard } from "./lib/resolve-card.mjs";
import { auditHeaders } from "./lib/audit-headers.mjs";

const S = CompFinderPricing.DEFAULT_SETTINGS;
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const LIMIT = Number(argOf("--limit", "999"));
const pacer = createPacer({ onWait: (m) => console.log(`   ⏳ ${m}`) });
const gbp = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

async function price(query) {
  const { body } = await pacer.call(async () => {
    const res = await fetch(`${BASE}/api/price`, {
      method: "POST", headers: auditHeaders(),
      body: JSON.stringify({ query, sold: true, soldAfterDays: 90 })
    });
    return { status: res.status, body: await res.json().catch(() => ({ ok: false, error: "bad json" })) };
  });
  return body;
}

/**
 * THEN: this script's scoring as it stood when the movers comparison was first
 * run. Closer to the page than compare-pulse was — it already used
 * settingsForCard, the market split and rawPence — but with no collector-number
 * guards, so a card whose number collides with a set name (Mew ex in the 151
 * set) or with another print pooled them together.
 */
function scoreThen(card, comps) {
  const tokens = buildCompTokens({ name: card.name, number: card.number }, card.q);
  const { chosen, rest } = splitByMarket(comps, UK);
  const all = [...chosen, ...rest];
  if (!all.length) return { rec: null, pence: null, used: 0, viaName: false };
  const cs = settingsForCard(card);
  let rec = CompFinderPricing.recommend(all, cs, tokens, "sold", card.number, card.set);
  let viaName = false;
  if ((rec.included || []).length === 0) {
    const nameOnly = buildCompTokens({ name: card.name }, card.q);
    const alt = CompFinderPricing.recommend(all, S, nameOnly, "sold", null, card.set);
    if ((alt.included || []).length >= 3) { rec = alt; viaName = true; }
  }
  return { rec, pence: rec?.rawPence ?? null, used: (rec.included || []).length, viaName };
}

/** NOW: the page's actual pipeline, via the shared module. */
function scoreNow(card, comps) {
  const p = priceCard(card, comps);
  return { rec: p.rec, pence: p.pence, used: p.used, viaName: p.viaName };
}

const rows = [];
const list = MOVERS.slice(0, LIMIT);
console.log(`Running ${list.length} movers against ${BASE}\n`);
console.log("card                                 num         pulse      THEN  n      NOW  n  then  now   note");
console.log("-".repeat(112));

for (const ref of list) {
  // Resolved first, so a Japanese card keeps its Japanese comps — see
  // lib/resolve-card.mjs.
  const card = await resolveCard(BASE, ref);
  const res = await price(card.q);
  if (!res.ok) { console.log(`${card.name.slice(0,34).padEnd(35)} FETCH FAILED`); continue; }
  const comps = res.comps || [];
  const then = scoreThen(card, comps);
  const { rec, used, viaName } = scoreNow(card, comps);
  const ours = rec?.rawPence ?? null;
  const ratio = ours && card.pulse ? ours / card.pulse : null;
  const ratioThen = then.pence && card.pulse ? then.pence / card.pulse : null;

  const notes = [];
  if (card.graded) notes.push(`pulse=${card.graded} slab`);
  if (card.variant && card.variant !== "Holo") notes.push(card.variant.toLowerCase());
  if (viaName) notes.push("number unmatched");
  if (!comps.length) notes.push("no comps");
  else if (used === 0) notes.push("all excluded");
  if ((rec?.graded || []).length) notes.push(`${rec.graded.length} graded tier(s)`);

  rows.push({ card, ours, ratio, ratioThen, then, used, viaName, comps: comps.length, gradedTiers: (rec?.graded || []).length });
  console.log(
    `${card.name.slice(0,34).padEnd(35)} ${String(card.number).padEnd(11)} ${gbp(card.pulse).padStart(8)} ` +
    `${gbp(then.pence).padStart(9)} ${String(then.used).padStart(2)} ${gbp(ours).padStart(9)} ${String(used).padStart(2)} ` +
    `${(ratioThen ? ratioThen.toFixed(2) : " —").padStart(5)} ${(ratio ? ratio.toFixed(2) : " —").padStart(5)}   ${notes.join(", ")}`
  );
}

// ---- summary ----------------------------------------------------------------
const priced = rows.filter((r) => r.ours != null);
// Graded entries are excluded from the accuracy read: Pulse is quoting a slab
// there and we deliberately price raw, so a gap is the two tools measuring
// different objects rather than either being wrong.
const comparable = priced.filter((r) => !r.card.graded && r.ratio != null);
const ratios = comparable.map((r) => r.ratio).sort((a, b) => a - b);
const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
const within = (lo, hi) => comparable.filter((r) => r.ratio >= lo && r.ratio <= hi).length;

console.log("\n" + "=".repeat(96));
console.log(`${rows.length} cards · ${priced.length} priced · ${rows.length - priced.length} not`);
console.log(`\nAccuracy (excluding the ${rows.filter(r=>r.card.graded).length} graded entries, where Pulse quotes a slab and we price raw):`);
if (med) {
  const rt = comparable.map((r) => r.ratioThen).filter((x) => x != null).sort((a, b) => a - b);
  const medThen = rt.length ? rt[Math.floor(rt.length / 2)] : null;
  console.log(`  median ratio     ${medThen ? medThen.toFixed(2) + "x -> " : ""}${med.toFixed(2)}x   over ${comparable.length} cards`);
  const moved = rows.filter((r) => r.then.pence && r.ours && Math.abs(r.ours / r.then.pence - 1) > 0.1);
  const gained = rows.filter((r) => !r.then.pence && r.ours);
  const lostP = rows.filter((r) => r.then.pence && !r.ours);
  console.log(`  moved >10% between the two scorings: ${moved.length}   gained a price: ${gained.length}   lost one: ${lostP.length}`);
  for (const r of moved.sort((a, b) => Math.abs(Math.log(b.ours / b.then.pence)) - Math.abs(Math.log(a.ours / a.then.pence))).slice(0, 12)) {
    console.log(`     ${r.card.name.slice(0, 30).padEnd(31)} ${gbp(r.then.pence).padStart(9)} -> ${gbp(r.ours).padStart(9)}   (${r.then.used} -> ${r.used} comps, pulse ${gbp(r.card.pulse)})`);
  }
  for (const r of lostP) console.log(`     LOST  ${r.card.name.slice(0, 30).padEnd(31)} was ${gbp(r.then.pence)}`);
  console.log(`  within 0.75-1.5x ${within(0.75, 1.5)}/${comparable.length}`);
  console.log(`  within 0.5-2x    ${within(0.5, 2)}/${comparable.length}`);
  console.log(`  beyond 3x        ${comparable.filter((r) => r.ratio > 3 || r.ratio < 0.33).length}/${comparable.length}`);
}

const group = (label, pred) => {
  const g = rows.filter(pred);
  const p = g.filter((r) => r.ours != null);
  const c = p.filter((r) => !r.card.graded && r.ratio != null);
  const m = c.length ? c.map(r=>r.ratio).sort((a,b)=>a-b)[Math.floor(c.length/2)] : null;
  console.log(`  ${label.padEnd(26)} ${String(p.length).padStart(2)}/${String(g.length).padEnd(3)} priced` + (m ? `   median ${m.toFixed(2)}x` : ""));
};
console.log("\nBy awkwardness:");
group("standard numbering", (r) => /^\d+\/\d+$/.test(r.card.number));
group("promo / TG numbering", (r) => !/^\d+\/\d+$/.test(r.card.number));
group("reverse / cosmos / ice", (r) => r.card.variant && r.card.variant !== "Holo");
group("graded (ACE 10)", (r) => r.card.graded);
group("thin volume (<=3)", (r) => r.card.vol <= 3);

const bad = comparable.filter((r) => r.ratio > 2 || r.ratio < 0.5).sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));
if (bad.length) {
  console.log("\nFurthest off:");
  for (const r of bad) {
    console.log(`  ${r.card.name.slice(0,30).padEnd(31)} ${String(r.card.number).padEnd(11)} pulse ${gbp(r.card.pulse).padStart(8)} vs ours ${gbp(r.ours).padStart(9)}  ${r.ratio.toFixed(2)}x  (${r.used} comps${r.viaName ? ", number unmatched" : ""})`);
  }
}
const none = rows.filter((r) => r.ours == null);
if (none.length) {
  console.log("\nNo price:");
  for (const r of none) console.log(`  ${r.card.name.slice(0,30).padEnd(31)} ${String(r.card.number).padEnd(11)} ${r.comps} comps fetched`);
}
const p = pacer.stats();
console.log(`\nPacing: ${p.served} calls, ${p.retried} backoffs, ${p.waitedSeconds}s waiting.`);
