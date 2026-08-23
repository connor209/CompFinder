/**
 * NOTE: reports rawPence — what a card is WORTH. finalPence, the recommended
 * listing price floored at £2.49 and rounded up a 50p charm ladder, belongs to
 * the business app and has no place in a "what's it worth" tool. Measured
 * against the Pulse best sellers, where a third of the cards trade under £5,
 * the ladder alone put our median at 1.11x their market price against an
 * honest 1.03x.
 */
/**
 * Consistency audit for the public price page.
 *
 * Runs a deliberately adversarial set of searches against the deployed API and
 * checks the results against invariants that hold regardless of what a card is
 * actually worth. That distinction matters: there is no independent source of
 * truth here for "the right price", so this proves the tool is SELF-CONSISTENT
 * and flags what looks wrong for a human to judge. It does not validate prices.
 *
 * The card list is chosen to break things, not to pass: names that collide
 * across sets, numbers that repeat, common words as card names, prints in other
 * languages, cards where graded slabs dominate, and queries a real person would
 * type badly.
 *
 *   node scripts/audit-public.mjs [--url https://...] [--limit N]
 *
 * Only cache misses count against the API rate limit, so re-running after a fix
 * is close to free for cards already seen.
 */
import { createPacer } from "./lib/pace.mjs";
import CompFinderPricing from "@compfinder/core/pricing.js";
import CompFinderLiquidity from "@compfinder/core/liquidity.js";
import { buildCompTokens } from "../apps/public/lib/tokens.js";
import { auditHeaders } from "./lib/audit-headers.mjs";

const settings = CompFinderPricing.DEFAULT_SETTINGS;
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = (argOf("--url", "https://comp-finder-public.vercel.app")).replace(/\/$/, "");
const LIMIT = Number(argOf("--limit", "999"));
const DELAY_MS = 250;

// `number`/`set` mimic the visitor picking a suggestion; omitting them mimics
// them typing free text and pressing the button, which is the weaker path.
const CARDS = [
  // --- high-value alt arts, where the collector number is the whole ballgame
  { q: "Giratina V 186/196 LOR", name: "Giratina V", number: "186/196", set: "Lost Origin", tag: "alt-art" },
  { q: "Umbreon VMAX 215/203 EVS", name: "Umbreon VMAX", number: "215/203", set: "Evolving Skies", tag: "alt-art" },
  { q: "Charizard ex 199/165 MEW", name: "Charizard ex", number: "199/165", set: "151", tag: "alt-art" },
  { q: "Rayquaza VMAX 218/203 EVS", name: "Rayquaza VMAX", number: "218/203", set: "Evolving Skies", tag: "alt-art" },
  { q: "Lugia V 186/195 SIT", name: "Lugia V", number: "186/195", set: "Silver Tempest", tag: "alt-art" },
  { q: "Mew ex 205/165 MEW", name: "Mew ex", number: "205/165", set: "151", tag: "alt-art" },
  // --- the same search WITHOUT the number, which is what people actually type
  { q: "Giratina V alt art", tag: "no-number" },
  { q: "Umbreon VMAX alt art", tag: "no-number" },
  { q: "Charizard ex 151", tag: "no-number" },
  { q: "Moonbreon", tag: "no-number" },
  // --- names that collide across dozens of sets
  { q: "Charizard", tag: "ambiguous" },
  { q: "Pikachu", tag: "ambiguous" },
  { q: "Mewtwo", tag: "ambiguous" },
  { q: "Blastoise", tag: "ambiguous" },
  { q: "Eevee", tag: "ambiguous" },
  // --- card names that are ordinary English words
  { q: "Iono 237/193 PAL", name: "Iono", number: "237/193", set: "Paldea Evolved", tag: "common-word" },
  { q: "Rare Candy", tag: "common-word" },
  { q: "Boss's Orders 154/172 BRS", name: "Boss's Orders", number: "154/172", set: "Brilliant Stars", tag: "common-word" },
  { q: "Professor's Research", tag: "common-word" },
  { q: "Switch", tag: "common-word" },
  { q: "Great Ball", tag: "common-word" },
  // --- cheap cards, where postage is most of the price
  { q: "Bidoof 111/189", tag: "cheap" },
  { q: "Magikarp 30/102", tag: "cheap" },
  { q: "Rattata 61/102", tag: "cheap" },
  { q: "Caterpie 45/102", tag: "cheap" },
  // --- graded-dominated
  { q: "Charizard 4/102 Base Set", name: "Charizard", number: "4/102", set: "Base Set", tag: "graded-heavy" },
  { q: "Blastoise 2/102 Base Set", name: "Blastoise", number: "2/102", set: "Base Set", tag: "graded-heavy" },
  { q: "Pikachu Illustrator", tag: "graded-heavy" },
  // --- reverse holo, a separately-priced variant the engine must not pool
  { q: "Pikachu reverse holo 58/102", tag: "reverse" },
  { q: "Snorlax reverse holo", tag: "reverse" },
  // --- non-English prints
  { q: "Charizard ex SV2a 201 Japanese", tag: "japanese" },
  { q: "Umbreon ex Japanese", tag: "japanese" },
  { q: "Pikachu Korean", tag: "korean" },
  // --- lots and sealed, which must not be priced as singles
  { q: "Pokemon booster box", tag: "lot-risk" },
  { q: "Charizard card lot", tag: "lot-risk" },
  { q: "Pokemon bundle joblot", tag: "lot-risk" },
  // --- other games
  { q: "Luffy OP01-001", tag: "other-game" },
  { q: "Blue-Eyes White Dragon LOB-001", tag: "other-game" },
  { q: "Ragavan Nimble Pilferer", tag: "other-game" },
  { q: "Elesh Norn Mother of Machines", tag: "other-game" },
  { q: "Lorcana Elsa Spirit of Winter", tag: "other-game" },
  // --- how people really type
  { q: "charzard", tag: "typo" },
  { q: "giratina v", tag: "sloppy" },
  { q: "umbreon vmax", tag: "sloppy" },
  { q: "charizard vmax rainbow", tag: "sloppy" },
  // --- deliberately obscure / likely empty
  { q: "Wooloo 191/202 SWSH", tag: "obscure" },
  { q: "Zamazenta V 138/202", tag: "obscure" },
  { q: "Klefki 79/078", tag: "obscure" },
  { q: "Chien-Pao ex 261/193", tag: "obscure" },
  { q: "Pidgey 57/102 Base Set shadowless", tag: "obscure" }
];

const pacer = createPacer({ onWait: (msg) => console.log(`      ⏳ ${msg}`) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gbp = (p) => (p == null ? "—" : CompFinderPricing.toPoundsStr(p));

async function price(query, sold) {
  // Every call goes through the pacer: it enforces the gap, the hourly
  // ceiling, and a real backoff if the server rate-limits us anyway.
  const { status, body } = await pacer.call(async () => {
    const r = await rawPrice(query, sold);
    return { status: r.status, body: r.body };
  });
  return { status, ...body };
}

async function rawPrice(query, sold) {
  const res = await fetch(`${BASE}/api/price`, {
    method: "POST",
    headers: auditHeaders(),
    body: JSON.stringify({ query, sold, soldAfterDays: 90 })
  });
  const json = await res.json().catch(() => ({ ok: false, error: `non-JSON (HTTP ${res.status})` }));
  return { status: res.status, body: json };
}

/** Mirrors the page's UK-only pre-filter, so the audit scores what a visitor sees. */
function preFilterUk(comps) {
  return comps.filter((c) => !c.itemLocation);
}

function analyse(card, soldComps, activeComps) {
  // Exactly what the page does, so the audit scores the shipped behaviour.
  const tokens = buildCompTokens({ name: card.name || card.q, number: card.number }, card.q);
  const number = card.number || null;
  const set = card.set || null;

  const rec = CompFinderPricing.recommend(preFilterUk(soldComps), settings, tokens, "sold", number, set);
  const activeRec = activeComps.length
    ? CompFinderPricing.recommend(preFilterUk(activeComps), settings, tokens, "active", number, set)
    : null;

  const used = rec.included || [];
  const totals = used.map((c) => c.totalPence);
  const lo = totals.length ? Math.min(...totals) : null;
  const hi = totals.length ? Math.max(...totals) : null;
  const byDate = used
    .filter((c) => c._source && c._source.endedAt)
    .sort((a, b) => new Date(b._source.endedAt) - new Date(a._source.endedAt));
  const lastSold = byDate.length ? byDate[0].totalPence : null;

  const liq = CompFinderLiquidity.assess({
    soldComps: used,
    activeCount: activeRec ? (activeRec.included || []).length : null,
    windowDays: 90
  });

  // --- invariants: true regardless of what the card is really worth ---------
  const issues = [];
  const bare = number ? number.split("/")[0].replace(/^0+/, "") : null;

  if (used.length > 0 && rec.rawPence == null) issues.push("price is null despite comps being used");
  if (lastSold != null && lo != null && (lastSold < lo || lastSold > hi)) {
    issues.push(`last sold ${gbp(lastSold)} outside used range ${gbp(lo)}–${gbp(hi)}`);
  }
  const gradedLeak = used.filter((c) => CompFinderPricing.parseGrade(c.title));
  if (gradedLeak.length) issues.push(`${gradedLeak.length} graded slab(s) counted as raw`);
  const foreignLeak = used.filter((c) => c.itemLocation);
  if (foreignLeak.length) issues.push(`${foreignLeak.length} non-UK comp(s) in a UK-only price`);
  if (bare) {
    const off = used.filter((c) => !new RegExp(`\\b0*${bare}\\b`).test(c.title));
    if (off.length) issues.push(`${off.length}/${used.length} used comps don't mention number ${bare}`);
  }
  if (rec.rawPence && activeRec?.rawPence) {
    const ratio = activeRec.rawPence / rec.rawPence;
    if (ratio > 5 || ratio < 0.2) {
      issues.push(`asking ${gbp(activeRec.rawPence)} vs sold ${gbp(rec.rawPence)} (${ratio.toFixed(1)}x)`);
    }
  }
  const spreadRatio = lo && hi ? hi / lo : null;
  if (spreadRatio && spreadRatio > 20) issues.push(`used comps span ${spreadRatio.toFixed(0)}x (${gbp(lo)}–${gbp(hi)})`);

  // How much of the fetched sample survives the UK-only rule. Searching
  // ebay.co.uk returns mostly GBP listings from overseas sellers, so this is
  // the number that decides whether a UK-only price has anything to stand on.
  const ukCount = preFilterUk(soldComps).length;

  return {
    card, rec, activeRec, liq, used: used.length, lastSold, lo, hi, issues,
    fetched: soldComps.length, ukCount,
    ukShare: soldComps.length ? ukCount / soldComps.length : null,
    excludedReasons: countBy((rec.excluded || []).map((e) => e.exclusionReason))
  };
}

function countBy(arr) {
  const m = {};
  for (const x of arr) m[x || "?"] = (m[x || "?"] || 0) + 1;
  return m;
}

async function main() {
  const list = CARDS.slice(0, LIMIT);
  console.log(`Auditing ${list.length} searches against ${BASE}\n`);
  const results = [];

  for (const [i, card] of list.entries()) {
    process.stdout.write(`[${String(i + 1).padStart(2)}/${list.length}] ${card.q.padEnd(38)} `);
    const sold = await price(card.q, true);
    const active = await price(card.q, false);

    if (!sold.ok) {
      console.log(`FETCH FAILED — ${sold.error}`);
      results.push({ card, fatal: sold.error, issues: [`fetch failed: ${sold.error}`], used: 0 });
      continue;
    }
    const r = analyse(card, sold.comps || [], active.ok ? active.comps || [] : []);
    r.cachedSold = sold.cached;
    console.log(
      `${String(r.fetched).padStart(3)} fetched → ${String(r.used).padStart(3)} used  ` +
      `${gbp(r.rec.rawPence).padStart(9)}  ${r.liq.label.padEnd(16)}` +
      (r.issues.length ? `  ⚠ ${r.issues.length}` : "")
    );
    results.push(r);
  }

  report(results);
}

function report(results) {
  const flagged = results.filter((r) => r.issues.length);
  const empty = results.filter((r) => !r.fatal && r.used === 0);

  console.log("\n" + "=".repeat(78));
  console.log(`SUMMARY  ${results.length} searches · ${flagged.length} with issues · ${empty.length} returned no usable comps`);
  console.log("=".repeat(78));

  const byTag = {};
  for (const r of results) {
    const t = r.card.tag;
    byTag[t] = byTag[t] || { n: 0, issues: 0, empty: 0 };
    byTag[t].n++;
    if (r.issues.length) byTag[t].issues++;
    if (!r.fatal && r.used === 0) byTag[t].empty++;
  }
  console.log("\nBy category:");
  for (const [tag, s] of Object.entries(byTag).sort((a, b) => b[1].issues - a[1].issues)) {
    console.log(`  ${tag.padEnd(14)} ${String(s.n).padStart(2)} searched · ${String(s.issues).padStart(2)} flagged · ${String(s.empty).padStart(2)} empty`);
  }

  if (flagged.length) {
    console.log("\nFlagged:");
    for (const r of flagged) {
      console.log(`\n  ${r.card.q}  [${r.card.tag}]`);
      for (const i of r.issues) console.log(`    · ${i}`);
    }
  }

  if (empty.length) {
    console.log("\nNo usable comps:");
    for (const r of empty) {
      console.log(`  ${r.card.q.padEnd(40)} [${r.card.tag}] ${r.fetched} fetched, all excluded: ${JSON.stringify(r.excludedReasons)}`);
    }
  }

  const withData = results.filter((r) => !r.fatal && r.fetched > 0);
  if (withData.length) {
    const shares = withData.map((r) => r.ukShare).sort((a, b) => a - b);
    const medShare = shares[Math.floor(shares.length / 2)];
    const totalFetched = withData.reduce((a, r) => a + r.fetched, 0);
    const totalUk = withData.reduce((a, r) => a + r.ukCount, 0);
    console.log("\nUK share of fetched comps:");
    console.log(`  ${totalUk} of ${totalFetched} comps were UK-domestic (${Math.round((totalUk / totalFetched) * 100)}%)`);
    console.log(`  median per search: ${Math.round(medShare * 100)}%`);
    console.log(`  searches with 0 UK comps: ${withData.filter((r) => r.ukCount === 0).length}/${withData.length}`);
    console.log(`  searches with fewer than 3 UK comps: ${withData.filter((r) => r.ukCount < 3).length}/${withData.length}`);
  }

  const allReasons = {};
  for (const r of results) for (const [k, v] of Object.entries(r.excludedReasons || {})) allReasons[k] = (allReasons[k] || 0) + v;
  const pace = pacer.stats();
  console.log(`\nPacing: ${pace.served} calls made, ${pace.retried} rate-limit backoffs, ${pace.waitedSeconds}s spent waiting.`);

  console.log("\nExclusion reasons across the run:");
  for (const [k, v] of Object.entries(allReasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
