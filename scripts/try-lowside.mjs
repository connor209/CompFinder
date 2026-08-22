/**
 * Evaluates a LOW-side price-outlier rule against the cached audit corpus,
 * offline, before touching packages/core.
 *
 *   node scripts/try-lowside.mjs [--set scripts/bigset-en2.json]
 *
 * This one needs care. splitPriceOutliers is one-sided on purpose, and its
 * comment records a real experiment: a symmetric version was tried on a
 * 25-comp pull in August and made prices WORSE, because it threw out the
 * genuinely cheap comps whenever the group median was already skewed high by
 * contamination that hadn't been cleaned yet.
 *
 * What has changed since is the amount of cleaning that now runs first —
 * graded, nameMismatch, setMismatch, catalogMismatch, notACard and the
 * variant split all execute before this point, so the median a low-side rule
 * would measure against is a very different number from the one that
 * experiment measured against. That is an argument for re-testing, not for
 * assuming the old result no longer holds. So this prints every title the
 * rule would remove, at three different widths, and the decision is made by
 * reading them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPacer } from "./lib/pace.mjs";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { buildCompTokens, dropWrongSetTotal } from "../apps/public/lib/tokens.js";
import { UK, splitByMarket } from "../apps/public/lib/markets.js";
import { settingsForCard } from "../apps/public/lib/settings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const SET = argOf("--set", join(HERE, "bigset-en2.json"));
const gbp = (p) => CompFinderPricing.toPoundsStr(p);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

const ALL = JSON.parse(readFileSync(SET, "utf8"));
const TIER = (r) => /special illustration|secret|hyper|amazing|shiny/i.test(r) ? 0
  : /illustration rare|art rare/i.test(r) ? 1
  : /ultra rare|rare ultra/i.test(r) ? 2 : 3;
const CARDS = [];
for (const tier of [0, 1, 2, 3]) {
  const g = ALL.filter((c) => TIER(c.rarity) === tier);
  CARDS.push(...(tier <= 1 ? g : g.filter((_, i) => i % (tier === 2 ? 2 : 3) === 0)));
}

const pacer = createPacer({ onWait: () => {} });
const priced = [];
let misses = 0;

for (const [i, c] of CARDS.entries()) {
  process.stdout.write(`\r  ${i + 1}/${CARDS.length} · ${priced.length} priced · ${misses} misses   `);
  const q = `${c.name} ${c.number} ${c.set}`;
  let res;
  try {
    res = await pacer.call(async () => {
      const r = await fetch(`${BASE}/api/price`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, sold: true, soldAfterDays: 90 })
      });
      return { status: r.status, body: await r.json().catch(() => ({ ok: false })) };
    });
  } catch { continue; }
  // pacer.call resolves to { status, body } - reading .ok off the wrapper is
  // undefined, which silently skipped every card on the first attempt.
  const body = res && res.body;
  if (!body || !body.ok) continue;
  if (!body.cached) misses++;
  const comps = body.comps || [];
  if (!comps.length) continue;

  const cs = settingsForCard(c);
  const tokens = buildCompTokens({ name: c.name, number: c.number }, q);
  const { chosen, rest } = splitByMarket(dropWrongSetTotal(comps, c.number), UK);
  const rec = CompFinderPricing.recommend([...chosen, ...rest], cs, tokens, "sold", c.number, c.set);
  const used = rec.included || [];
  if (used.length < 6) continue;   // the rule would not run below this anyway
  priced.push({ q, used });
}
console.log(`\n\n${priced.length} cards with 6+ comps (${misses} cache misses)\n`);

for (const K of [8, 12, 20]) {
  let dropped = 0, cardsHit = 0, spansFixedBefore = 0, spansFixedAfter = 0;
  const samples = [];
  let worstShift = null;
  for (const { q, used } of priced) {
    const totals = used.map((c) => c.totalPence);
    const med = median(totals);
    if (!med) continue;
    const floor = med / K;
    const out = used.filter((c) => c.totalPence < floor);
    const keep = used.filter((c) => c.totalPence >= floor);
    const spanBefore = Math.max(...totals) / Math.min(...totals);
    if (spanBefore > 15) spansFixedBefore++;
    if (!out.length || keep.length < 3) {
      if (spanBefore > 15) spansFixedAfter++;
      continue;
    }
    cardsHit++; dropped += out.length;
    const kt = keep.map((c) => c.totalPence);
    const spanAfter = Math.max(...kt) / Math.min(...kt);
    if (spanBefore > 15 && spanAfter > 15) spansFixedAfter++;
    const shift = median(kt) / med - 1;
    if (!worstShift || Math.abs(shift) > Math.abs(worstShift.shift)) worstShift = { q, shift, med, after: median(kt) };
    for (const c of out) samples.push({ q, price: c.totalPence, med, title: c.title });
  }
  console.log("=".repeat(100));
  console.log(`LOW-SIDE at median/${K}:  ${dropped} comps off ${cardsHit} of ${priced.length} cards`);
  console.log(`  wide spans (>15x): ${spansFixedBefore} -> ${spansFixedAfter}`);
  if (worstShift) console.log(`  largest median shift: ${(worstShift.shift * 100).toFixed(1)}%  ${gbp(worstShift.med)} -> ${gbp(worstShift.after)}  ${worstShift.q}`);
  console.log("  every title it would remove:");
  for (const s of samples.sort((a, b) => a.price / a.med - b.price / b.med)) {
    console.log(`    ${gbp(s.price).padStart(9)} vs ${gbp(s.med).padStart(9)} med  ${s.title.slice(0, 68)}`);
  }
  console.log("");
}
