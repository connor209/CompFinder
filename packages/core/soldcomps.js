/**
 * Comp Finder — SoldComps API response normalization.
 *
 * Maps SoldComps' JSON response shape (confirmed 2026-08-12 from their full
 * docs page: https://sold-comps.com/docs) into the same
 * {title, itemPricePence, postagePence, condition} shape parseResultsText()
 * already produces from the Terapeak page — so pricing.js's core logic
 * (query simplification, exclusion rules, Reverse Holo handling, the
 * name-token safety net, floor/rounding) doesn't need to change to switch
 * data sources.
 *
 * As of 2026-08-12 this also surfaces `epid` and `categoryId` — eBay's own
 * catalog-product-identity and listing-category fields — as first-class
 * comp properties rather than debug-only extras. See pricing.js's
 * splitByCatalogSignal for why: these are structured, authoritative signals
 * for "is this genuinely the same product" that don't depend on guessing at
 * title wording the way earlier fixes (postage-outlier, set-mismatch) did.
 */
const SoldCompsApi = (() => {

  const BASE_URL = "https://api.sold-comps.com/v1/scrape";

  // Condition inference — identical logic to content.js's inferCondition,
  // duplicated here since this module has to work standalone (fetched from
  // a background script, not necessarily alongside content.js).
  function inferCondition(title) {
    const t = (title || "").toLowerCase();
    if (/\bnm\b|near mint/.test(t)) return "NM";
    if (/\blp\b|lightly played/.test(t)) return "LP";
    if (/\bmp\b|moderately played/.test(t)) return "MP";
    // "60 hp" is a Pokemon's stat, not Heavily Played. A lookbehind would say
    // that directly — /(?<!\d\s)\bhp\b/ — and this file is bundled into BOTH
    // browsers, where Safari only learned lookbehind in 16.4. Older iPads throw
    // a SyntaxError when the minifier rebuilds the literal as RegExp(string),
    // which takes the whole screen down at the moment this function is first
    // called. Dropping the stat first says the same thing in syntax every
    // engine has.
    if (/heavily played/.test(t) || /\bhp\b/.test(t.replace(/\d\shp\b/g, " "))) return "HP";
    if (/damaged/.test(t)) return "DMG";
    return "Unknown";
  }

  const toPence = (amount) => Math.round(Number(amount) * 100);

  /** Maps one SoldComps API item to the shape pricing.js's recommend() expects. */
  /**
   * Maps one SoldComps API item to the shape pricing.js's recommend()
   * expects. Handles BOTH response modes — sold (default) and active
   * (sold=false, confirmed in SoldComps' docs as the real replacement for
   * what the old Terapeak Active-listing bridge used to provide): the two
   * modes use different field names for price (soldPrice vs currentPrice)
   * and currency (soldCurrency vs currentCurrency), everything else
   * (title, shippingPrice, epid, categoryId, itemLocation) is shared.
   */
  function mapItem(apiItem) {
    const title = apiItem.title || "";
    const isActive = apiItem.listingType === "active" || apiItem.currentPrice != null;
    const price = isActive ? apiItem.currentPrice : apiItem.soldPrice;
    const currency = isActive ? apiItem.currentCurrency : apiItem.soldCurrency;
    return {
      title,
      itemPricePence: toPence(price),
      postagePence: toPence(apiItem.shippingPrice || 0),
      condition: apiItem.condition || inferCondition(title),
      // eBay's own catalog product ID ("stable across sellers for the same
      // variant" per SoldComps' docs) and listing category — both null-able,
      // both used by pricing.js's splitByCatalogSignal as a stronger
      // alternative to text-based set/variant matching when present.
      epid: apiItem.epid || null,
      categoryId: apiItem.categoryId || null,
      // Seller's country, per SoldComps' docs — "null on ebay.co.uk" reads
      // like the field just doesn't work for the UK site, but real evidence
      // (2026-08-12, user-verified) says otherwise: eBay's own UI shows a
      // location badge specifically to flag CROSS-BORDER items, and shows
      // nothing for genuine UK-domestic ones — the field is null *because*
      // the item is domestic, not because the data is missing. Used by
      // pricing.js's splitByNonUkLocation as the real fix for cross-listed
      // international sellers, replacing what the postage-outlier heuristic
      // was only ever an imperfect proxy for.
      itemLocation: apiItem.itemLocation || null,
      // kept for reference/debugging, not used by pricing.js
      _source: { itemId: apiItem.itemId, url: apiItem.url, endedAt: apiItem.endedAt, currency }
    };
  }

  /**
   * Maps a full API response into an array of comps, same shape
   * parseResultsText() returns from the Terapeak page.
   * Filters out non-GBP results defensively — shouldn't happen if the
   * marketplace parameter is set correctly, but a silently-wrong-currency
   * comp would badly skew a price, so this fails safe rather than trusting
   * it. Also reports which currencies actually came back, since seeing
   * "USD" here when GBP was expected is a direct diagnostic for a wrong
   * marketplace parameter (see buildRequestUrl) rather than a mystery.
   */
  function parseResponse(json, expectedCurrency = "GBP") {
    if (!json || !Array.isArray(json.items)) {
      return { comps: [], skippedWrongCurrency: 0, hasNextPage: false, currenciesSeen: [], autoSelectedCategory: null };
    }
    let skippedWrongCurrency = 0;
    const comps = [];
    const currenciesSeen = new Set();
    for (const item of json.items) {
      // Active-mode items (sold=false) use currentCurrency, not
      // soldCurrency — checking only soldCurrency would let every active
      // item through unfiltered regardless of actual currency, since
      // item.soldCurrency is simply undefined for them.
      const currency = item.soldCurrency || item.currentCurrency;
      if (currency) currenciesSeen.add(currency);
      if (expectedCurrency && currency && currency !== expectedCurrency) {
        skippedWrongCurrency++;
        continue;
      }
      comps.push(mapItem(item));
    }
    return {
      comps,
      skippedWrongCurrency,
      hasNextPage: !!json.hasNextPage,
      currenciesSeen: Array.from(currenciesSeen),
      autoSelectedCategory: json.autoSelectedCategory || null
    };
  }

  /**
   * Builds the request URL for one query.
   * `keyword`, `count`, `ebaySite`, `sortOrder`, `itemCondition` all
   * confirmed from a real captured dashboard request (2026-08-11).
   * `itemLocation` confirmed 2026-08-12 directly from SoldComps' full docs
   * page (enum: default/domestic/worldwide) — kept as a default even though
   * the same docs page reveals it's very likely a no-op for ebay.co.uk
   * specifically: the response-level itemLocation field (seller's country)
   * is documented as "null on ebay.co.uk", meaning SoldComps can't
   * determine seller location for UK-site listings at all, so a
   * domestic/worldwide filter almost certainly can't act on data it
   * doesn't have. Confirmed by three consecutive live runs on the same
   * query returning byte-identical results despite this being set. Left in
   * place since it's harmless and may start working if SoldComps improves
   * UK location detection later — the real fix for UK cross-border
   * contamination is the set-mismatch exclusion in pricing.js instead,
   * which doesn't depend on location data at all.
   * `soldAfter` confirmed from the same full docs fetch — restricts to
   * recent sales (YYYY-MM-DD, inclusive lower bound on endedAt), matching
   * the 30-day recency window the original Terapeak-based methodology used
   * by default, so very old sales don't skew a current price estimate.
   */
  function buildRequestUrl({
    keyword,
    count = 240,
    page = 1,
    ebaySite = "ebay.co.uk",
    sortOrder = "endedRecently",
    itemCondition = "any",
    itemLocation = "domestic",
    soldAfterDays = 90,
    minPrice = null,
    maxPrice = null
  }) {
    const params = new URLSearchParams({ keyword, count: String(count), ebaySite, sortOrder, itemCondition, itemLocation });
    if (page > 1) params.set("page", String(page));
    if (soldAfterDays) {
      const d = new Date(Date.now() - soldAfterDays * 24 * 60 * 60 * 1000);
      params.set("soldAfter", d.toISOString().slice(0, 10));
    }
    // ⚠️ minPrice/maxPrice parameter NAMES are confirmed present (seen in a
    // real captured dashboard request, 2026-08-11) but that capture had them
    // unset, so the exact value format (plain pounds vs pence, decimal
    // handling) isn't confirmed the way ebaySite/itemLocation/itemCondition
    // are. Sent as plain decimal pounds (e.g. "2.50") as the most likely
    // interpretation — flagged in the UI as experimental rather than
    // presented with the same confidence as the verified parameters.
    if (minPrice != null && minPrice !== "") params.set("minPrice", String(minPrice));
    if (maxPrice != null && maxPrice !== "") params.set("maxPrice", String(maxPrice));
    return `${BASE_URL}?${params.toString()}`;
  }

  return { BASE_URL, mapItem, parseResponse, buildRequestUrl, inferCondition };
})();

if (typeof module !== "undefined") module.exports = SoldCompsApi;
