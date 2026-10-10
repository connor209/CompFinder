/**
 * Why is a card missing from the QR storefront?
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/trace-storefront.mjs <storefront token or URL> "recycle"
 *
 * Read-only. Runs the REAL loader (`loadPublicStorefront`) — the same function
 * the page calls — with the view counter switched off, so tracing a link does
 * not count as somebody scanning it. Then reads every listing and checkout
 * whose title matches the search, on its own, and says what happened to each
 * one on the way to a stranger's phone:
 *
 *   on the storefront        it is in a pocket the visitor can see
 *   sold shell               quantity 0 — eBay's out-of-stock control
 *   same SKU as the box      a checked-out card shares its SKU, so the box wins
 *   same SKU as another      folded into the first live listing with that SKU
 *   not read by the loader   in the table, but the loader's paged read missed it
 *
 * The last one is what the comparison at the bottom is for: the loader pages
 * through ebay_listings 1,000 rows at a time, and a row it never read is a
 * card that is simply not there, with nothing on screen to say so.
 */
import { createClient } from "@supabase/supabase-js";
import { loadPublicStorefront, LISTING_COLUMNS } from "../apps/app/lib/storefront-store.js";
import { isListingAvailable } from "../apps/app/lib/stockcheck.js";
import { showOnly } from "../apps/app/lib/streamstock.js";
import { normalise } from "../apps/app/lib/showfilter.js";

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [rawToken, ...words] = process.argv.slice(2);
const query = words.join(" ").trim();
if (!url || !key || !rawToken || !query) {
  console.error('Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/trace-storefront.mjs <token or URL> "<card name>"');
  process.exit(1);
}
const token = rawToken.replace(/[?#].*$/, "").split("/").filter(Boolean).pop();

const db = createClient(url, key, { auth: { persistSession: false } });
// The real client for every read, and nothing for the one write the loader makes.
const admin = new Proxy(db, {
  get: (t, p) => (p === "rpc" ? async () => ({ data: null, error: null }) : Reflect.get(t, p))
});

const has = (title) => {
  const hay = normalise(title || "");
  return normalise(query).split(" ").filter(Boolean).every((w) => hay.includes(w));
};

async function readAll(make) {
  let rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data || []);
    if (!data || data.length < 1000) return rows;
  }
}

const { data: link, error: linkErr } = await db
  .from("show_storefronts")
  .select("id,user_id,title,event,include_online,expires_at,revoked_at")
  .eq("token", token)
  .maybeSingle();
if (linkErr || !link) {
  console.error(linkErr ? `Couldn't read the link: ${linkErr.message}` : "No storefront with that token.");
  process.exit(1);
}
const owner = link.user_id;
console.log(`Link: "${link.title || "(untitled)"}"  event=${link.event || "(any)"}  online stock ${link.include_online ? "INCLUDED" : "NOT included"}`);
if (!link.include_online) {
  console.log("  → this link only shows cards checked out to the show. A copy that is only listed online never appears on it.");
}

// 1. What the page actually serves.
const served = await loadPublicStorefront(admin, token);
if (!served.ok) {
  console.log(`The loader refuses this link: ${served.reason}`);
  process.exit(0);
}
const cards = served.stock.cards.filter((c) => has(`${c.name} ${c.set || ""}`));
console.log(`\nOn the storefront for "${query}": ${cards.length} pocket(s)`);
for (const c of cards) console.log(`  [${c.source}] ${c.name}  ×${c.count}  ${c.priceText || "ask"}`);

// 2. Every matching row, on its own, in a stable order.
const listings = (await readAll(() =>
  db.from("ebay_listings").select(LISTING_COLUMNS).eq("user_id", owner).order("ebay_item_id")
)).filter((l) => has(l.title));
const checkouts = showOnly(await readAll(() => {
  let q = db.from("stock_checkouts").select("*").eq("user_id", owner).is("resolved_at", null).order("id");
  if (link.event) q = q.eq("event", String(link.event).trim());
  return q;
}));
const boxSkus = new Set(checkouts.filter((c) => c.sku).map((c) => String(c.sku).toLowerCase()));
const boxHits = checkouts.filter((c) => has(c.title));

console.log(`\nChecked out to this show, matching: ${boxHits.length}`);
for (const c of boxHits) console.log(`  ${c.sku || "(no sku)"}  ${c.title}`);

// 3. Did the loader's own paged read see every listing?
const loaderRows = await readAll(() => db.from("ebay_listings").select(LISTING_COLUMNS).eq("user_id", owner));
const loaderIds = new Set(loaderRows.map((l) => String(l.ebay_item_id)));
const { count: total } = await db.from("ebay_listings").select("id", { count: "exact", head: true }).eq("user_id", owner);
console.log(`\nListings in the table: ${total}; read by an unordered paged select: ${loaderIds.size} distinct (${loaderRows.length} rows)`);
if (loaderIds.size !== total) console.log("  → the paged read MISSED or DUPLICATED rows. That alone drops cards off the storefront.");

console.log(`\nListings matching "${query}": ${listings.length}`);
const seen = new Set();
for (const l of listings) {
  const sku = l.sku ? String(l.sku).toLowerCase() : "";
  let fate;
  if (!loaderIds.has(String(l.ebay_item_id))) fate = "NOT READ by the loader";
  else if (!isListingAvailable(l)) fate = "sold shell (quantity 0)";
  else if (!link.include_online) fate = "online stock not included on this link";
  else if (sku && boxSkus.has(sku)) fate = "hidden: same SKU as a card in the box";
  else if (sku && seen.has(sku)) fate = "hidden: same SKU as an earlier listing";
  else fate = "on the storefront";
  if (fate === "on the storefront" && sku) seen.add(sku);
  console.log(`  ${l.ebay_item_id}  sku=${l.sku ?? "(none)"}  qty=${l.quantity ?? "?"}  £${l.price_value ?? "?"}  → ${fate}`);
  console.log(`      ${l.title}`);
}
