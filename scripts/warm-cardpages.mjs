/**
 * Fills soldcomps_cache for the published card pages, so a crawler and a
 * visitor both find a price already there.
 *
 *   node scripts/warm-cardpages.mjs --dry-run          # what it would do, spends nothing
 *   node scripts/warm-cardpages.mjs --limit 120        # warm the 120 stalest
 *   node scripts/warm-cardpages.mjs --limit 40 --max-age 14
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (to see how old
 * each cache entry is) and AUDIT_TOKEN (so the run isn't throttled like a
 * visitor). Without the service key it can still warm, it just can't
 * prioritise — see below.
 *
 * THE BUDGET IS THE WHOLE DESIGN. On the Starter plan there are 2,000 SoldComps
 * requests a month, shared with everyone actually using the site. Warming all
 * 455 cards costs 455 of them, so this is not a job to run nightly:
 *
 *   455 cards ÷ 4 runs a month = ~120 per weekly run = 455 requests a month
 *   leaving ~1,500 for real visitors, which is ~50 distinct searches a day.
 *
 * Hence --limit as the primary control and oldest-first ordering: a partial run
 * is a useful run, and running it more often just cycles the set faster rather
 * than re-spending on cards that are already fresh.
 *
 * It goes through /api/price rather than calling SoldComps directly, on
 * purpose. That route is cache-first, globally paced and writes the entry with
 * exactly the key a card page will read. Calling upstream directly would
 * duplicate all three and could write a key nothing looks for.
 */
import { createClient } from "@supabase/supabase-js";
import { cardFromRow, queryForCard } from "../apps/public/lib/card-query.js";
import { DEFAULT_SOLD_WINDOW } from "../apps/public/lib/windows.js";
import { cacheKeyFor } from "../apps/public/lib/cache-key.js";
import { auditHeaders } from "./lib/audit-headers.mjs";
import PUBLISHED from "../apps/public/lib/published-cards.js";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = (process.env.PUBLIC_SITE_URL || argOf("--url", "https://comp-finder-public.vercel.app")).replace(/\/$/, "");
const LIMIT = Number(argOf("--limit", "120"));
// Don't re-spend on anything warmed recently. Shorter than the card page's
// 35-day read window on purpose, so an entry is refreshed before it expires
// off the page rather than after.
const MAX_AGE_DAYS = Number(argOf("--max-age", "21"));
const dryRun = args.includes("--dry-run");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !(SERVICE_KEY || ANON_KEY)) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY are required.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// --- 1. the published cards, as the page will see them -----------------------
// Through cardFromRow and queryForCard, which is what makes the key written
// here the key a card page reads. Never rebuild the query from the manifest.
const ids = PUBLISHED.map((e) => e.id);
const rows = [];
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await db
    .from("card_catalog")
    .select("cardmarket_id,name,collector_number,rarity,expansion,expansion_code,game")
    .in("cardmarket_id", ids.slice(i, i + 200));
  if (error) {
    console.error(`catalogue read failed: ${error.message}`);
    process.exit(1);
  }
  rows.push(...(data || []));
}

const byId = new Map(rows.map((r) => [r.cardmarket_id, cardFromRow(r)]));
const cards = [];
for (const entry of PUBLISHED) {
  const card = byId.get(entry.id);
  if (!card) {
    console.warn(`  not in the catalogue any more, skipped: ${entry.q} (${entry.id})`);
    continue;
  }
  const query = queryForCard(card);
  cards.push({ entry, card, query, key: cacheKeyFor(query, true, DEFAULT_SOLD_WINDOW) });
}

// --- 2. how old is each one --------------------------------------------------
// soldcomps_cache has RLS on with no policies, so this needs the service key.
// Without it every card looks unwarmed, which would re-spend on fresh entries
// — so refuse to guess and say why.
const ages = new Map();
if (SERVICE_KEY) {
  for (let i = 0; i < cards.length; i += 40) {
    const keys = cards.slice(i, i + 40).map((c) => c.key);
    const { data, error } = await db.from("soldcomps_cache").select("cache_key,fetched_at").in("cache_key", keys);
    if (error) {
      console.error(`cache read failed: ${error.message}`);
      process.exit(1);
    }
    for (const row of data || []) ages.set(row.cache_key, new Date(row.fetched_at).getTime());
  }
} else {
  console.warn(
    "⚠️  No SUPABASE_SERVICE_ROLE_KEY — can't see cache ages, so this run can't skip cards that are\n" +
    "   already fresh or warm the stalest first. /api/price will still serve those from cache without\n" +
    "   spending a SoldComps request, but --limit will be used up on them. Set the key."
  );
}

const now = Date.now();
const ageDays = (key) => (ages.has(key) ? (now - ages.get(key)) / 86400000 : Infinity);

const stale = cards
  .filter((c) => ageDays(c.key) > MAX_AGE_DAYS)
  // Never warmed first, then oldest. A partial run should always be the most
  // valuable partial run available.
  .sort((a, b) => ageDays(b.key) - ageDays(a.key));

const todo = stale.slice(0, LIMIT);
const fresh = cards.length - stale.length;

console.log(
  `${cards.length} published · ${fresh} fresh (under ${MAX_AGE_DAYS}d) · ${stale.length} stale · warming ${todo.length}` +
  (stale.length > todo.length ? ` (${stale.length - todo.length} left for the next run)` : "")
);
if (dryRun) {
  for (const c of todo.slice(0, 15)) {
    const age = ageDays(c.key);
    console.log(`  ${age === Infinity ? "never" : `${age.toFixed(0)}d`.padStart(5)}  ${c.query}`);
  }
  if (todo.length > 15) console.log(`  … and ${todo.length - 15} more`);
  console.log("dry run — nothing fetched, nothing spent.");
  process.exit(0);
}

// --- 3. warm them ------------------------------------------------------------
let warmed = 0, alreadyCached = 0, failed = 0, spent = 0;

for (const [i, c] of todo.entries()) {
  let res;
  try {
    res = await fetch(`${BASE}/api/price`, {
      method: "POST",
      headers: auditHeaders(),
      body: JSON.stringify({ query: c.query, sold: true, soldAfterDays: DEFAULT_SOLD_WINDOW })
    });
  } catch (err) {
    failed++;
    console.warn(`  ✗ ${c.query} — ${err.message}`);
    continue;
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    failed++;
    console.warn(`  ✗ ${c.query} — HTTP ${res.status} ${json.error || ""}`);
    // A 503 from the global pacer means we are going faster than SoldComps
    // allows. Backing off is cheaper than a run of shed requests.
    if (res.status === 503) await new Promise((r) => setTimeout(r, 5000));
    continue;
  }

  if (json.cached) alreadyCached++;
  else { warmed++; spent++; }
  const comps = (json.comps || []).length;
  console.log(`  ${String(i + 1).padStart(3)}/${todo.length}  ${json.cached ? "cached" : "warmed"}  ${String(comps).padStart(3)} comps  ${c.query}`);
}

console.log(
  `\nwarmed ${warmed} · already cached ${alreadyCached} · failed ${failed}\n` +
  `about ${spent} SoldComps request(s) spent. Starter plan is 2,000 a month, shared with live visitors.`
);
if (failed) process.exitCode = 1;
