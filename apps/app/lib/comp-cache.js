/**
 * A day's memory for the app's comp lookups.
 *
 * The app had none. Every batch run re-fetched every card, so re-running a
 * list — which is the normal case, not the exception — cost full price every
 * time. Measured over the 2026-08-25 Neo-era work: four runs of the same
 * 89-card list cost 417 SoldComps requests where one day's cache would have
 * cost 104.
 *
 * Last Comp has cached sold comps for 24 hours since it was written. This is
 * the same idea against its own table (migration 025) — see the migration for
 * why not the same one.
 *
 * BEST EFFORT, ALWAYS. Migrations here are applied by hand, so the code ships
 * first and a missing table has to degrade to "no caching" rather than take
 * the Batch screen down. Every function below swallows its own errors and
 * returns as though the cache simply missed. A cache that fails loudly is
 * worse than no cache: the price is still correct without it.
 */

/**
 * How long a lookup stays good.
 *
 * 24h for sold, matching Last Comp: a completed sale is a fact that doesn't
 * change, and a day's worth of new sales barely moves a recency-weighted
 * median.
 *
 * 2h for active, also matching Last Comp, for the opposite reason — an asking
 * price is only true until someone buys it or relists, and the whole point of
 * checking the live market is that it is live. Stale actives would silently
 * turn the sanity check into a second opinion from yesterday.
 */
export const CACHE_TTL_SECONDS = { sold: 24 * 60 * 60, active: 2 * 60 * 60 };

/**
 * The cache key.
 *
 * Every parameter that changes what SoldComps returns has to be in here, or a
 * run with a 30-day window would be served a 90-day answer. That failure is
 * invisible — no error, no wrong-looking price, just a number built from the
 * wrong evidence — which is the same shape as the three-callers problem
 * CLAUDE.md describes for the public page's cache key.
 *
 * Namespaced with "app:" so an entry can never be confused with the public
 * page's, even if the two tables were ever merged.
 */
export function cacheKeyFor(query, options = {}) {
  const sold = options.sold !== false;
  const parts = [
    "app",
    String(query || "").trim().toLowerCase().replace(/\s+/g, " "),
    options.ebaySite || "ebay.co.uk",
    sold ? "sold" : "active",
    // SoldComps ignores the window for active listings, so folding it in would
    // store the same listings twice under two keys and make a window toggle
    // refetch them for nothing. Same reasoning as the public route.
    sold ? String(options.soldAfterDays ?? 90) : "0",
    options.itemLocation || "domestic",
    options.itemCondition || "any",
    options.minPrice == null || options.minPrice === "" ? "" : String(options.minPrice),
    options.maxPrice == null || options.maxPrice === "" ? "" : String(options.maxPrice)
  ];
  return parts.join("|");
}

/** A cached response, or null for a miss, an expired entry, or no table. */
export async function readCache(supabase, query, options) {
  try {
    const sold = options.sold !== false;
    const ttl = sold ? CACHE_TTL_SECONDS.sold : CACHE_TTL_SECONDS.active;
    const freshAfter = new Date(Date.now() - ttl * 1000).toISOString();
    const { data, error } = await supabase
      .from("app_comp_cache")
      .select("payload, fetched_at")
      .eq("cache_key", cacheKeyFor(query, options))
      .gte("fetched_at", freshAfter)
      .maybeSingle();
    if (error || !data) return null;
    return { ...data.payload, cached: true, fetchedAt: data.fetched_at };
  } catch {
    return null;
  }
}

/** Store a response. Never throws — a failed write only costs a future hit. */
export async function writeCache(supabase, query, options, payload) {
  try {
    await supabase.from("app_comp_cache").upsert(
      {
        cache_key: cacheKeyFor(query, options),
        query: String(query || ""),
        sold: options.sold !== false,
        payload,
        comp_count: Array.isArray(payload && payload.comps) ? payload.comps.length : 0,
        fetched_at: new Date().toISOString()
      },
      { onConflict: "cache_key" }
    );
  } catch {
    /* migration 025 not applied, or a transient write failure — either way the
       price is already correct and the only cost is fetching it again. */
  }
}

export default { cacheKeyFor, readCache, writeCache, CACHE_TTL_SECONDS };
