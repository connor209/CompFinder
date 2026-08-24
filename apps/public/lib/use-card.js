"use client";

import { useEffect, useState } from "react";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { buildCompTokens, dropWrongSetTotal, dropWrongNumerator } from "./tokens.js";
import { UK, splitByMarket } from "./markets.js";
import { settingsForCard } from "./settings.js";
import { priceCard } from "./price.js";
import { assessLiquidity } from "./liquidity.js";
import { assessConfidence } from "./confidence.js";
import { groupExclusions } from "./exclusions.js";
import { conditionBands } from "./condition.js";
import { variantsPresent } from "./variants.js";
import { caveatsFor } from "./caveats.js";
import { safeListings } from "./listings.js";
import { foreignCount } from "./settings.js";
import { challengeAvailable, ensurePass } from "./turnstile-client.js";
import { DEFAULT_SOLD_WINDOW } from "./windows.js";

/**
 * Everything a card page needs, from a query string.
 *
 * Both the answer and the workings run off this, so the two screens can never
 * disagree about how many sales there were or which ones counted — the
 * workings exist to show the arithmetic behind the answer, and a second
 * fetching path would eventually make them arithmetic about different things.
 * The window is a caller's argument for the same reason: it is in the URL, and
 * both screens read it from there rather than each holding their own default.
 *
 * The sold window is cached server-side for 24 hours, so the second screen's
 * fetch costs nothing upstream.
 */

/** One card → the search text that finds it. Set name included deliberately:
 *  measured over 30 cards, "Mew ex 232/091" priced at £794 with the set in the
 *  query and £546 without, because eBay returns a different result set. */
export function queryForCard(card) {
  return [card.name, card.number || "", card.set || ""].join(" ").replace(/\s+/g, " ").trim();
}

async function price(query, sold, windowDays, retried = false) {
  const res = await fetch("/api/price", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, sold, soldAfterDays: windowDays })
  }).then((r) => r.json());

  if (!res.ok) {
    // The bot check asks once and only on a cache miss; solving it and coming
    // back is a normal path, not an error.
    if (res.needsChallenge && !retried && challengeAvailable()) {
      if (await ensurePass()) return price(query, sold, windowDays, true);
    }
    throw new Error(res.error || "Pricing request failed.");
  }
  return res;
}

export function useCard(query, windowDays = DEFAULT_SOLD_WINDOW) {
  const [state, setState] = useState({ status: "loading", query });

  useEffect(() => {
    if (!query) return undefined;
    let alive = true;
    setState({ status: "loading", query });

    (async () => {
      let resolved = null;
      try {
        const res = await fetch(`/api/resolve?q=${encodeURIComponent(query)}`).then((r) => r.json());
        const candidates = (res && res.candidates) || [];
        // One confident hit prices straight away; anything else is a question
        // for the visitor, because guessing between two printings of the same
        // number is how you price a £200 card at 60p.
        if (candidates.length && (res.confident || candidates.length === 1)) {
          resolved = candidates[0];
        } else if (candidates.length) {
          if (alive) setState({ status: "choose", query, candidates, fuzzy: !!res.fuzzy });
          return;
        }
      } catch {
        /* the resolver is an optimisation, not a gate — fall through to raw text */
      }

      const card = resolved || { name: query, q: query };
      const searchText = resolved ? queryForCard(resolved) : query;

      // BOTH REQUESTS GO OUT AT ONCE, and the price renders on the sold one.
      //
      // Awaiting them in turn cost a cold card fourteen seconds of spinner —
      // resolve 1.0s, then sold 5.2s, then live 7.7s, summed — where the two
      // price calls have nothing to do with each other and the sold set is the
      // only one the page can't draw without. Fired together and rendered on
      // the first, the same card is readable in about six.
      const soldPromise = price(searchText, true, windowDays);
      const livePromise = price(searchText, false, windowDays).catch(() => ({ comps: [] }));

      let sold;
      try {
        sold = await soldPromise;
      } catch (err) {
        // Swallow the live one too, or an unhandled rejection follows the
        // failure out.
        livePromise.catch(() => {});
        if (alive) setState({ status: "error", query, error: err.message });
        return;
      }
      if (!alive) return;

      // Everything except what's listed right now. The hero says "sells for"
      // until the listings land, then becomes "buy it today for" — a true
      // statement at each moment rather than a number that changes under a
      // fixed label.
      setState({
        status: "ready",
        query,
        card: { ...card, q: searchText },
        derived: derive(card, searchText, sold, { comps: [] }, windowDays),
        listingsPending: true
      });

      const listings = await livePromise;
      if (!alive) return;
      setState({
        status: "ready",
        query,
        card: { ...card, q: searchText },
        derived: derive(card, searchText, sold, listings, windowDays),
        listingsPending: false
      });
    })();

    return () => { alive = false; };
  }, [query, windowDays]);

  return state;
}

/**
 * The whole read of one card, in one pure function so it can be reasoned about
 * (and, later, tested) without a browser.
 */
export function derive(card, searchText, soldRes, liveRes, windowDays = DEFAULT_SOLD_WINDOW) {
  const withQ = { ...card, q: searchText };
  const comps = soldRes.comps || [];
  const priced = priceCard(withQ, comps);
  const rec = priced.rec;
  const used = rec ? rec.included || [] : [];

  // activeCount is what turns a rate into a wait: without it there is no
  // days-of-supply and no sell-through, which is how the old page said "the
  // listings up now would clear in about 12 days" and this one said nothing.
  // Counted from the guarded, UK-filtered live set below rather than the raw
  // response, so it's the same population the price used.
  const liveGuarded = dropWrongNumerator(
    dropWrongSetTotal(liveRes.comps || [], card.number), card.number
  );
  const liveUkCount = splitByMarket(liveGuarded, UK).chosen.length;

  const liquidity = assessLiquidity({
    used,
    response: soldRes,
    comps,
    activeCount: (liveRes.comps || []).length ? liveUkCount : null,
    windowDays
  });
  const confidence = assessConfidence({ rec, comps, windowDays, market: UK });

  // Active listings get the same name/number/set treatment as sold comps.
  // Scoring them with no tokens is why an early "buy one now" was offering
  // £2.60 copies of a different card.
  const settings = settingsForCard(withQ);
  const tokens = buildCompTokens({ name: card.name, number: card.number }, searchText);
  const liveUk = splitByMarket(liveGuarded, UK).chosen;
  const liveRec = liveUk.length
    ? CompFinderPricing.recommend(liveUk, settings, tokens, "active", card.number, card.set)
    : null;

  // What survives matching is not yet what we may show. The hero is the
  // CHEAPEST of these, so a single wrong listing is the headline rather than a
  // rounding error — see lib/listings.js for the £44.75 Umbreon this fixes.
  // The floor is measured against the price the page itself is showing, so it
  // has to be computed before the listings are trimmed to it.
  const safe = safeListings({
    candidates: (liveRec && liveRec.included) || [],
    number: card.number,
    soldPence: priced.pence,
    soldUsed: used.length
  });

  const listings = safe.listings.map((c) => ({
    itemPence: c.itemPricePence,
    postagePence: c.postagePence || 0,
    totalPence: c.totalPence ?? c.itemPricePence,
    title: c.title,
    url: c._source && c._source.url,
    condition: c.condition && c.condition !== "Unknown" ? c.condition : null
  }));

  // The rest of the market, beside the UK figure. Both are real answers to
  // "what's it worth" and they routinely differ by a third — showing only one
  // hides the fact that there IS a difference.
  const { chosen: ukComps, rest: restComps } = splitByMarket(
    dropWrongNumerator(dropWrongSetTotal(comps, card.number), card.number), UK
  );
  const ukRec = ukComps.length
    ? CompFinderPricing.recommend(ukComps, settings, tokens, "sold", card.number, card.set)
    : null;
  const restRec = restComps.length
    ? CompFinderPricing.recommend(restComps, settings, tokens, "sold", card.number, card.set)
    : null;

  // Two condition figures, but only where the comps can support them. On a
  // vintage card the gap is the whole story — Meganium ex EX Unseen Forces is
  // £167 Near Mint against £54 played — and on a modern card there is no gap
  // at all, so nothing is shown. See lib/condition.js.
  const bands = conditionBands(used, settings, tokens, card.number, card.set);

  const sales = used
    .map((c) => ({
      pence: c.totalPence ?? c.itemPricePence,
      endedAt: c._source && c._source.endedAt,
      t: c._source && c._source.endedAt ? new Date(c._source.endedAt).getTime() : 0,
      title: c.title,
      condition: c.condition && c.condition !== "Unknown" ? c.condition : null,
      url: c._source && c._source.url
    }))
    .sort((a, b) => b.t - a.t);

  const base = {
    marketPence: priced.pence,
    ukPence: ukRec ? ukRec.rawPence : null,
    marketUsed: ukRec ? (ukRec.included || []).length : 0,
    restPence: restRec ? restRec.rawPence : null,
    restUsed: restRec ? (restRec.included || []).length : 0,
    bands,
    gradedTiers: rec ? (rec.graded || []).length : 0,
    foreign: foreignCount(comps),
    variantsHere: variantsPresent(comps),
    rec,
    used: used.length,
    usedComps: used,
    sales,
    listings,
    cheapest: listings[0] || null,
    // Counted, not hidden. "16 listings" turning into "12" with no explanation
    // reads as the page having found less than it did, and the reason is worth
    // saying: these were too cheap to be this card.
    suppressedListings: safe.suppressed,
    listingFloorPence: safe.floorPence,
    liquidity,
    confidence,
    exclusions: groupExclusions((rec && rec.excluded) || []),
    excludedCount: rec ? (rec.excluded || []).length : 0,
    viaName: priced.viaName,
    lo: priced.lo,
    hi: priced.hi,
    windowDays,
    graded: rec ? rec.graded || [] : [],
    // The most recent sale that actually counted. The product is named after
    // it, and until now it only appeared on the workings screen. sales is
    // already newest-first, so this is the head of it and never a second sort.
    lastComp: sales[0] || null
  };

  // Caveats need the finished picture, so they come last rather than being
  // threaded through every branch above.
  return { ...base, caveats: caveatsFor({ rec, derived: base, card }) };
}

export default { useCard, derive, queryForCard };
