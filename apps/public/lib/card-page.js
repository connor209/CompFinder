/**
 * Server-side reads for a card page: enough to put a price in the HTML
 * without the browser having run anything, and without spending an API call.
 *
 * WHY THIS EXISTS. The card screen is a client component that fetches on
 * mount, so a crawler sees a spinner where the answer should be — and every
 * uncached view costs a SoldComps request against a URL space where any string
 * is a valid page. Card pages are supposed to be the acquisition surface; a
 * page whose content only exists after JavaScript runs isn't one.
 *
 * The trade this makes: only PUBLISHED cards are server-rendered. Matching an
 * arbitrary /card/<anything> would mean resolving it server-side, which is 200
 * lines of candidate-ranking living in /api/resolve, and a URL space anyone
 * can walk. A published card is one we already chose to stand behind, so its
 * id is known from the manifest without resolving anything, and everything
 * else falls back to the existing client path unchanged.
 *
 * IT ONLY EVER READS THE CACHE. Filling it is the warmer's job. A published
 * card with nothing cached renders exactly as it does today — the browser
 * fetches — rather than a crawler triggering an upstream call.
 */
import { createServiceClient, createPublicClient } from "./supabase.js";
import { selectCatalog } from "./catalog-select.js";
import { cardFromRow, queryForCard, normaliseQuery } from "./card-query.js";
import { cacheKeyFor } from "./cache-key.js";
import { DEFAULT_SOLD_WINDOW } from "./windows.js";
import PUBLISHED from "./published-cards.js";

/**
 * How stale a cached price may be before the server stops rendering it.
 *
 * Far longer than /api/price's 24h TTL because they answer different
 * questions: that TTL decides when to SPEND a request refreshing, this decides
 * whether an answer already paid for is worth showing. On a 2,000-request
 * month the honest warm cadence for 455 cards is monthly, so 35 days is one
 * cycle plus slack for a run that slipped. Beyond it the page falls back to
 * fetching live, which is what it does today anyway.
 */
export const MAX_SERVER_PRICE_AGE_DAYS = 35;

const BY_QUERY = new Map(PUBLISHED.map((e) => [normaliseQuery(e.q), e]));

export function publishedCards() {
  return PUBLISHED;
}

/** Is this URL one of the cards we stand behind? Anything else is left to the client. */
export function findPublished(query) {
  return BY_QUERY.get(normaliseQuery(query || "")) || null;
}

/**
 * The catalogue row, through the same mapping /api/resolve uses — so the query
 * built from it is byte-identical to the one a visitor's click would build,
 * and hits the same cache entry. Anon client: card_catalog is public-readable
 * by policy, and a page render has no reason to hold the service key.
 */
export async function loadCard(cardmarketId) {
  const supabase = createPublicClient();
  const { data, error } = await selectCatalog((columns) =>
    supabase.from("card_catalog").select(columns).eq("cardmarket_id", cardmarketId).maybeSingle()
  );
  // A failed query and a missing row are different answers. This one is only
  // ever an optimisation — the client still fetches — so both degrade to null
  // rather than throwing a render away over a transient fault.
  if (error || !data) return null;
  return cardFromRow(data);
}


/** Cached sold comps for a card, or null. Never fetches. */
export async function loadCachedSold(card, { windowDays = DEFAULT_SOLD_WINDOW, maxAgeDays = MAX_SERVER_PRICE_AGE_DAYS } = {}) {
  let supabase;
  try {
    supabase = createServiceClient();
  } catch {
    // No service key (a local checkout, a preview without the env var). The
    // page renders and the browser fetches, exactly as before this existed.
    return null;
  }
  const key = cacheKeyFor(queryForCard(card), true, windowDays);
  const notBefore = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const { data, error } = await supabase
    .from("soldcomps_cache")
    .select("payload, fetched_at")
    .eq("cache_key", key)
    .gte("fetched_at", notBefore)
    .maybeSingle();
  if (error || !data) return null;
  return {
    comps: data.payload?.comps || [],
    // null rather than false when the entry predates the field: "we don't
    // know" and "there is no next page" lead to opposite conclusions about
    // whether the set was capped, and a fast card reads as slow if you coerce.
    hasNextPage: data.payload?.hasNextPage ?? null,
    rawItemCount: data.payload?.rawItemCount ?? (data.payload?.comps || []).length,
    fetchedAt: data.fetched_at
  };
}

/**
 * Everything the server can hand the card screen for a published card, or null
 * when it can't help and the client should do what it always did.
 */
export async function serverCard(query, windowDays = DEFAULT_SOLD_WINDOW) {
  const entry = findPublished(query);
  if (!entry) return null;
  const card = await loadCard(entry.id);
  if (!card) return null;
  const sold = await loadCachedSold(card, { windowDays });
  if (!sold || !sold.comps.length) return null;
  return { card: { ...card, q: queryForCard(card) }, sold };
}

/**
 * The published cards that currently have a price, for the sitemap.
 *
 * Only priced ones, deliberately: a card page with nothing cached is honest
 * but thin, and submitting hundreds of thin pages demotes the good ones with
 * them. The list grows as the warmer works through the set.
 *
 * One catalogue read for the whole set, then cache lookups in chunks —
 * PostgREST puts the filter in the URL, so 455 sixty-four-character keys in
 * one `in()` would be a ~29KB query string.
 */
export async function pricedCards({ windowDays = DEFAULT_SOLD_WINDOW, maxAgeDays = MAX_SERVER_PRICE_AGE_DAYS } = {}) {
  const supabase = createPublicClient();
  const { data: rows, error } = await selectCatalog((columns) =>
    supabase.from("card_catalog").select(columns).in("cardmarket_id", PUBLISHED.map((e) => e.id))
  );
  if (error || !rows) return [];

  const byId = new Map(rows.map((row) => [row.cardmarket_id, cardFromRow(row)]));
  const wanted = [];
  for (const entry of PUBLISHED) {
    const card = byId.get(entry.id);
    if (!card) continue;
    const q = queryForCard(card);
    wanted.push({ q, key: cacheKeyFor(q, true, windowDays) });
  }

  let service;
  try {
    service = createServiceClient();
  } catch {
    // Without the key we can't tell which are priced. An empty sitemap is
    // recoverable; one full of blank pages is not.
    return [];
  }

  const notBefore = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const present = new Set();
  for (let i = 0; i < wanted.length; i += 40) {
    const keys = wanted.slice(i, i + 40).map((w) => w.key);
    const { data, error: cacheError } = await service
      .from("soldcomps_cache").select("cache_key").in("cache_key", keys).gte("fetched_at", notBefore);
    if (cacheError) continue;
    for (const row of data || []) present.add(row.cache_key);
  }
  return wanted.filter((w) => present.has(w.key)).map((w) => w.q);
}

export default { publishedCards, findPublished, loadCard, loadCachedSold, serverCard, pricedCards, MAX_SERVER_PRICE_AGE_DAYS };
