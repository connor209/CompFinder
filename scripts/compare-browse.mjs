/**
 * Would eBay's Browse API make a better source of live listings for Last Comp
 * than SoldComps' active mode? A dry run that answers it on the published set.
 *
 *   node scripts/compare-browse.mjs                 # 40 cards
 *   node scripts/compare-browse.mjs --n 120 --json browse-vs-soldcomps.json
 *   node scripts/compare-browse.mjs --card "Umbreon VMAX 215"   # one card, every listing
 *
 * WHY. The public page spends a SoldComps request on live listings for every
 * uncached card view, from the same 2,000 a month the sold side and the warmer
 * share. The app already stopped doing that — /api/active asks Browse through
 * `browseComps()` — and Browse is first-party, app-token, 5,000 calls a day.
 * Before the page follows, this shows whether Browse finds the same market:
 * how many listings come back, how many survive the page's own matching, and
 * above all which listing would be the HERO, since "buy it today for" is the
 * cheapest survivor and one bad match is the headline (lib/listings.js, the
 * £44.75 Umbreon).
 *
 * SPENDS NOTHING AT SOLDCOMPS. Both sides of each comparison go through the
 * page's own `derive()`, fed from what is already in soldcomps_cache: the
 * cached sold entry for the price and the listing floor, and the cached active
 * entry — ANY age — as the SoldComps side. The Browse side is one free Browse
 * call per card, through the app's `browseComps()`, so the request is the one
 * the app already makes rather than a third copy of it.
 *
 * Two things to read the output with:
 *
 *   - **The two sides are not from the same moment.** A cached active entry
 *     can be weeks old (its TTL is two hours, but rows are never deleted) and
 *     Browse is now. Every row prints the SoldComps side's age, and a hero
 *     that differs on a card whose cache is a month old is the market moving,
 *     not either source being wrong. Cards nobody has looked at have no
 *     cached active entry at all and are compared Browse-only.
 *   - **Browse returns at most 50, cheapest first** (`browseActiveListings`
 *     clamps the limit). That is the right half of the market for the hero
 *     and the wrong half for a count: a card with 50 back is flagged CAPPED,
 *     and its days-of-supply would read low on the page.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (soldcomps_cache
 * has RLS on with no policies) and EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (the
 * app's Production keyset). Writes nothing anywhere.
 */
import { createClient } from "@supabase/supabase-js";
import { cardFromRow, queryForCard } from "../apps/public/lib/card-query.js";
import { cacheKeyFor } from "../apps/public/lib/cache-key.js";
import { DEFAULT_SOLD_WINDOW } from "../apps/public/lib/windows.js";
import { derive } from "../apps/public/lib/use-card.js";
import { browseComps } from "../apps/app/lib/ebay.js";
import PUBLISHED from "../apps/public/lib/published-cards.js";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Heroes within this of each other are "the same answer". */
const AGREE_PCT = 10;

/**
 * Item ids, comparable across both sources. Browse says `v1|123456789012|0`;
 * SoldComps says the legacy number alone. The middle part is the listing.
 */
export function listingIdOf(comp) {
  const raw = String((comp && comp._source && comp._source.itemId) || "");
  const m = raw.match(/^v1\|(\d+)\|/);
  return m ? m[1] : raw.replace(/\D/g, "") || null;
}

const pctApart = (a, b) => (a && b ? (Math.abs(a - b) / Math.min(a, b)) * 100 : null);

/**
 * One side of the comparison: what the page would show if `live` were the
 * live-listing response. Straight off derive(), so this is the page's answer
 * and never a reconstruction of it.
 */
export function sideOf(card, query, soldRes, live) {
  if (!live) return null;
  const d = derive(card, query, soldRes, live, DEFAULT_SOLD_WINDOW);
  return {
    raw: (live.comps || []).length,
    shown: d.listings.length,
    suppressed: d.suppressedListings,
    floorPence: d.listingFloorPence,
    hero: d.cheapest ? { pence: d.cheapest.totalPence, title: d.cheapest.title, url: d.cheapest.url } : null,
    liquidity: d.liquidity && d.liquidity.label,
    ids: new Set((live.comps || []).map(listingIdOf).filter(Boolean)),
    marketPence: d.marketPence,
    listings: d.listings
  };
}

/** Both sides for one card, and how they relate. */
export function compareCard({ card, query, soldRes, soldcompsLive, soldcompsAgeDays, browseLive, browseError }) {
  const sc = sideOf(card, query, soldRes, soldcompsLive);
  const br = browseError ? null : sideOf(card, query, soldRes, browseLive);

  let overlap = null;
  if (sc && br) {
    let both = 0;
    for (const id of sc.ids) if (br.ids.has(id)) both++;
    overlap = { both, soldcompsOnly: sc.ids.size - both, browseOnly: br.ids.size - both };
  }

  let verdict;
  if (browseError) verdict = "browse-error";
  else if (!sc) verdict = br.hero ? "browse-only" : "neither";
  else if (!sc.hero && !br.hero) verdict = "neither";
  else if (!br.hero) verdict = "browse-lost-hero";
  else if (!sc.hero) verdict = "browse-found-hero";
  else {
    const apart = pctApart(sc.hero.pence, br.hero.pence);
    verdict = apart <= AGREE_PCT ? "agree" : br.hero.pence < sc.hero.pence ? "browse-cheaper" : "browse-dearer";
  }

  return {
    query,
    marketPence: (br || sc || {}).marketPence ?? null,
    soldcompsAgeDays,
    soldcomps: sc,
    browse: br,
    browseError: browseError || null,
    browseCapped: !!(br && br.raw >= 50),
    overlap,
    verdict
  };
}

const gbp = (p) => (p == null ? "—" : `£${(p / 100).toFixed(2)}`);
const VERDICT_ORDER = ["agree", "browse-cheaper", "browse-dearer", "browse-found-hero", "browse-lost-hero", "browse-only", "neither", "browse-error"];

function printRow(r) {
  const s = r.soldcomps;
  const b = r.browse;
  const age = r.soldcompsAgeDays == null ? "none" : `${r.soldcompsAgeDays.toFixed(0)}d`;
  console.log(`\n${r.query}  · sells for ${gbp(r.marketPence)}  · ${r.verdict}`);
  console.log(
    `  SoldComps (${age.padStart(4)}): ` +
    (s ? `${String(s.raw).padStart(3)} back · ${String(s.shown).padStart(3)} shown · ${s.suppressed} under floor · hero ${gbp(s.hero && s.hero.pence)}` : "no cached active entry")
  );
  console.log(
    `  Browse   (now) : ` +
    (b ? `${String(b.raw).padStart(3)} back · ${String(b.shown).padStart(3)} shown · ${b.suppressed} under floor · hero ${gbp(b.hero && b.hero.pence)}${r.browseCapped ? " · CAPPED at 50" : ""}` : `failed — ${r.browseError}`)
  );
  if (r.overlap) console.log(`  same listing ids: ${r.overlap.both} in both · ${r.overlap.soldcompsOnly} SoldComps only · ${r.overlap.browseOnly} Browse only`);
  if (s && s.hero && b && b.hero && r.verdict !== "agree") {
    console.log(`    SC hero: ${s.hero.title}`);
    console.log(`    BR hero: ${b.hero.title}`);
  }
}

function summarise(rows) {
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const withBoth = rows.filter((r) => r.soldcomps && r.browse);
  const median = (xs) => {
    const s = xs.filter((x) => x != null).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  console.log(`\n=== ${rows.length} cards ===`);
  for (const v of VERDICT_ORDER) if (count(v)) console.log(`  ${v.padEnd(18)} ${count(v)}`);
  console.log(`  Browse capped at 50: ${rows.filter((r) => r.browseCapped).length}`);
  if (withBoth.length) {
    console.log(`  on the ${withBoth.length} cards with both sides:`);
    console.log(`    median listings shown — SoldComps ${median(withBoth.map((r) => r.soldcomps.shown))}, Browse ${median(withBoth.map((r) => r.browse.shown))}`);
    console.log(`    median SoldComps cache age ${median(withBoth.map((r) => r.soldcompsAgeDays))?.toFixed(0)}d — differences on old entries are the market moving`);
  }
  console.log(`  Browse listings held back by the price floor: ${rows.reduce((n, r) => n + ((r.browse && r.browse.suppressed) || 0), 0)} listings across the run`);
  console.log("\ndry run — no SoldComps request made, nothing written.");
}

// --- the run -----------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const argOf = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const N = Number(argOf("--n", "40"));
  const JSON_OUT = argOf("--json", null);
  const ONE = argOf("--card", null);

  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")}. See the header of this file for what each is for.`);
    process.exit(1);
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // The published cards as the page sees them — through cardFromRow and
  // queryForCard, or the keys below would be keys no page ever wrote.
  let entries = PUBLISHED;
  if (ONE) {
    const want = ONE.toLowerCase();
    entries = PUBLISHED.filter((e) => e.q.toLowerCase().includes(want));
    if (!entries.length) {
      console.error(`No published card matches "${ONE}".`);
      process.exit(1);
    }
  }
  const rowsById = new Map();
  const ids = entries.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("card_catalog")
      .select("cardmarket_id,name,collector_number,rarity,expansion,expansion_code,game")
      .in("cardmarket_id", ids.slice(i, i + 200));
    if (error) throw new Error(`catalogue read failed: ${error.message}`);
    for (const r of data || []) rowsById.set(r.cardmarket_id, cardFromRow(r));
  }
  const cards = entries
    .map((e) => rowsById.get(e.id))
    .filter(Boolean)
    .map((card) => {
      const query = queryForCard(card);
      return { card, query, soldKey: cacheKeyFor(query, true, DEFAULT_SOLD_WINDOW), activeKey: cacheKeyFor(query, false, 0) };
    });

  // Every cache entry for those cards, whatever its age. Nothing is fetched to
  // fill a gap: a card with no sold entry has no price and no floor, so there
  // is nothing to compare, and it is counted rather than priced.
  const cache = new Map();
  const keys = cards.flatMap((c) => [c.soldKey, c.activeKey]);
  for (let i = 0; i < keys.length; i += 80) {
    const { data, error } = await db.from("soldcomps_cache").select("cache_key,payload,fetched_at").in("cache_key", keys.slice(i, i + 80));
    if (error) throw new Error(`cache read failed: ${error.message}`);
    for (const r of data || []) cache.set(r.cache_key, r);
  }

  const priced = cards.filter((c) => cache.has(c.soldKey));
  // Cards with BOTH cached first — those are the like-for-like rows — then the
  // rest, so a short run is the most informative short run available.
  priced.sort((a, b) => Number(cache.has(b.activeKey)) - Number(cache.has(a.activeKey)));
  const todo = ONE ? priced : priced.slice(0, N);
  console.log(
    `${cards.length} published · ${priced.length} with a cached sold price · ` +
    `${priced.filter((c) => cache.has(c.activeKey)).length} also with cached SoldComps listings · comparing ${todo.length}`
  );
  if (cards.length - priced.length) console.log(`  (${cards.length - priced.length} skipped: no cached sold price, so no floor to judge listings against)`);

  const now = Date.now();
  const out = [];
  for (const c of todo) {
    const soldRow = cache.get(c.soldKey);
    const soldRes = { ...soldRow.payload, comps: soldRow.payload.comps || [] };
    const activeRow = cache.get(c.activeKey);

    let browseLive = null;
    let browseError = null;
    try {
      // The app's own call, UK-located stock, cheapest first.
      const comps = await browseComps({ q: c.query, limit: 50, ukOnly: true });
      browseLive = { comps, hasNextPage: false, rawItemCount: comps.length };
    } catch (err) {
      browseError = err.message;
    }

    const row = compareCard({
      card: c.card,
      query: c.query,
      soldRes,
      soldcompsLive: activeRow ? { ...activeRow.payload, comps: activeRow.payload.comps || [] } : null,
      soldcompsAgeDays: activeRow ? (now - new Date(activeRow.fetched_at).getTime()) / 86400000 : null,
      browseLive,
      browseError
    });
    out.push(row);
    printRow(row);
    if (ONE) {
      for (const [label, side] of [["SoldComps", row.soldcomps], ["Browse", row.browse]]) {
        if (!side) continue;
        console.log(`  — ${label}, every listing shown, cheapest first:`);
        for (const l of side.listings) console.log(`      ${gbp(l.totalPence).padStart(9)}  ${l.title}`);
      }
    }
  }

  summarise(out);

  if (JSON_OUT) {
    const plain = out.map((r) => ({
      ...r,
      soldcomps: r.soldcomps && { ...r.soldcomps, ids: undefined },
      browse: r.browse && { ...r.browse, ids: undefined }
    }));
    writeFileSync(JSON_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), cards: plain }, null, 1));
    console.log(`wrote ${JSON_OUT}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
