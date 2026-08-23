/**
 * The same cards, the same cached comps, scored by yesterday's pricing
 * pipeline and today's.
 *
 *   node scripts/compare-eras.mjs [--list pulse|movers|both]
 *
 * The two Pulse comparison scripts can only ever show harness drift, because
 * both of their columns run today's engine. This answers the question they
 * cannot: what did the exclusion work actually do to our agreement with an
 * independent price source?
 *
 * "Then" is the real pipeline as of ea2474a — the last commit before the core
 * work — reconstructed from git: packages/core/pricing.js plus the public
 * page's tokens, settings and markets modules from the same commit, with
 * their imports repointed at the old engine. Not a re-implementation of what
 * I think it did; the actual files.
 *
 * Comps are read from the 24-hour cache, so this costs nothing at SoldComps
 * and can be re-run freely. Set OLDPIPE to the directory holding the
 * extracted old modules.
 */
import { createPacer } from "./lib/pace.mjs";
import { priceCard } from "../apps/public/lib/price.js";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { resolveCard } from "./lib/resolve-card.mjs";
import { REFERENCE } from "./pulse-reference.mjs";
import { MOVERS } from "./movers.mjs";
import { auditHeaders } from "./lib/audit-headers.mjs";

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = argOf("--url", "https://comp-finder-public.vercel.app").replace(/\/$/, "");
const WHICH = argOf("--list", "both");
const OLD = process.env.OLDPIPE;
if (!OLD) { console.error("set OLDPIPE to the extracted old-pipeline directory"); process.exit(1); }

const [oldPricingMod, oldTokens, oldSettings, oldMarkets] = await Promise.all([
  import(`${OLD}/pricing.cjs`), import(`${OLD}/tokens.mjs`),
  import(`${OLD}/settings.mjs`), import(`${OLD}/markets.mjs`)
]);
const oldPricing = oldPricingMod.default || oldPricingMod;

/** The page's pipeline as it stood at ea2474a. */
function priceThen(card, comps) {
  const settings = oldSettings.settingsForCard(card);
  const tokens = oldTokens.buildCompTokens({ name: card.name, number: card.number }, card.q);
  const guarded = oldTokens.dropWrongSetTotal(comps, card.number);
  const { chosen, rest } = oldMarkets.splitByMarket(guarded, oldMarkets.UK);
  const all = [...chosen, ...rest];
  if (!all.length) return { pence: null, used: 0 };
  let rec = oldPricing.recommend(all, settings, tokens, "sold", card.number, card.set);
  if ((rec.included || []).length === 0) {
    const alt = oldPricing.recommend(
      all, settings, oldTokens.buildCompTokens({ name: card.name }, card.q), "sold", null, card.set
    );
    if ((alt.included || []).length >= 3) rec = alt;
  }
  return { pence: rec.rawPence ?? null, used: (rec.included || []).length, rec };
}

const pacer = createPacer({ onWait: () => {} });
const gbp = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function comps(query) {
  const { body } = await pacer.call(async () => {
    const r = await fetch(`${BASE}/api/price`, {
      method: "POST", headers: auditHeaders(),
      body: JSON.stringify({ query, sold: true, soldAfterDays: 90 })
    });
    return { status: r.status, body: await r.json().catch(() => ({ ok: false })) };
  });
  return body && body.ok ? { comps: body.comps || [], cached: body.cached } : null;
}

async function run(label, cards) {
  console.log(`\n${"=".repeat(94)}\n${label} — ${cards.length} cards, same comps through both pipelines\n${"=".repeat(94)}`);
  console.log("card                                  pulse      THEN  n       NOW  n    then    now");
  console.log("-".repeat(94));
  const rows = [];
  let misses = 0;
  for (const c of cards) {
    // Resolve first, exactly as the page does. Without the card's language the
    // English-only comp rule fires on Japanese cards and strips the very comps
    // that should price them.
    const card = await resolveCard(BASE, { name: c.name, number: c.number, set: c.set, q: `${c.name} ${c.number} ${c.set}` });
    const got = await comps(card.q);
    if (!got) { console.log(`${card.name.slice(0, 36).padEnd(37)} FETCH FAILED`); continue; }
    if (!got.cached) misses++;
    const then = priceThen(card, got.comps);
    const now = priceCard(card, got.comps);
    const rt = then.pence && c.pulse ? then.pence / c.pulse : null;
    const rn = now.pence && c.pulse ? now.pence / c.pulse : null;
    rows.push({ c, then, now, rt, rn });
    console.log(
      `${(c.name + " " + c.number).slice(0, 36).padEnd(37)} ${gbp(c.pulse).padStart(8)} ` +
      `${gbp(then.pence).padStart(9)} ${String(then.used).padStart(2)} ${gbp(now.pence).padStart(9)} ${String(now.used).padStart(2)} ` +
      `${(rt ? rt.toFixed(2) : " —").padStart(7)} ${(rn ? rn.toFixed(2) : " —").padStart(6)}`
    );
  }

  const both = rows.filter((r) => r.rt != null && r.rn != null);
  const near = (rs, k) => rs.filter((r) => r[k] >= 0.75 && r[k] <= 1.5).length;
  const wild = (rs, k) => rs.filter((r) => r[k] > 3 || r[k] < 0.33).length;
  console.log(`\n  priced            ${rows.filter((r) => r.then.pence).length} -> ${rows.filter((r) => r.now.pence).length} of ${rows.length}`);
  if (both.length) {
    console.log(`  median vs Pulse   ${med(both.map((r) => r.rt)).toFixed(2)}x -> ${med(both.map((r) => r.rn)).toFixed(2)}x`);
    console.log(`  within 0.75–1.5x  ${near(both, "rt")} -> ${near(both, "rn")} of ${both.length}`);
    console.log(`  beyond 3x         ${wild(both, "rt")} -> ${wild(both, "rn")} of ${both.length}`);
    const closer = both.filter((r) => Math.abs(Math.log(r.rn)) < Math.abs(Math.log(r.rt))).length;
    const further = both.filter((r) => Math.abs(Math.log(r.rn)) > Math.abs(Math.log(r.rt))).length;
    console.log(`  moved CLOSER to Pulse: ${closer}   further away: ${further}   unchanged: ${both.length - closer - further}`);
  }
  const moved = rows.filter((r) => r.then.pence && r.now.pence && Math.abs(r.now.pence / r.then.pence - 1) > 0.1);
  console.log(`\n  prices that moved >10% (${moved.length}):`);
  for (const r of moved.sort((a, b) => Math.abs(Math.log(b.now.pence / b.then.pence)) - Math.abs(Math.log(a.now.pence / a.then.pence)))) {
    const dir = Math.abs(Math.log(r.rn)) < Math.abs(Math.log(r.rt)) ? "closer" : "further";
    console.log(`    ${(r.c.name + " " + r.c.number).slice(0, 34).padEnd(35)} ${gbp(r.then.pence).padStart(9)} -> ${gbp(r.now.pence).padStart(9)}  (${r.then.used}->${r.now.used} comps, pulse ${gbp(r.c.pulse)}, ${dir})`);
  }
  if (misses) console.log(`\n  ${misses} cache misses — those were fetched live`);
  return rows;
}

if (WHICH === "pulse" || WHICH === "both") await run("PulseTCG best sellers", REFERENCE);
if (WHICH === "movers" || WHICH === "both") {
  await run("PulseTCG movers", MOVERS.map((m) => ({ ...m, set: m.set || "" })));
}
