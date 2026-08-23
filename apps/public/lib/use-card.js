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
import { foreignCount } from "./settings.js";
import { challengeAvailable, ensurePass } from "./turnstile-client.js";

/**
 * Everything a card page needs, from a query string.
 *
 * Both the answer and the workings run off this, so the two screens can never
 * disagree about how many sales there were or which ones counted — the
 * workings exist to show the arithmetic behind the answer, and a second
 * fetching path would eventually make them arithmetic about different things.
 *
 * The sold window is cached server-side for 24 hours, so the second screen's
 * fetch costs nothing upstream.
 */
export const SOLD_WINDOW_DAYS = 90;

/** One card → the search text that finds it. Set name included deliberately:
 *  measured over 30 cards, "Mew ex 232/091" priced at £794 with the set in the
 *  query and £546 without, because eBay returns a different result set. */
export function queryForCard(card) {
  return [card.name, card.number || "", card.set || ""].join(" ").replace(/\s+/g, " ").trim();
}

async function price(query, sold, retried = false) {
  const res = await fetch("/api/price", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, sold, soldAfterDays: SOLD_WINDOW_DAYS })
  }).then((r) => r.json());

  if (!res.ok) {
    // The bot check asks once and only on a cache miss; solving it and coming
    // back is a normal path, not an error.
    if (res.needsChallenge && !retried && challengeAvailable()) {
      if (await ensurePass()) return price(query, sold, true);
    }
    throw new Error(res.error || "Pricing request failed.");
  }
  return res;
}

export function useCard(query) {
  const [state, setState] = useState({ status: "loading", query });

  useEffect(() => {
    if (!query) return undefined;
    let live = true;
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
          if (live) setState({ status: "choose", query, candidates, fuzzy: !!res.fuzzy });
          return;
        }
      } catch {
        /* the resolver is an optimisation, not a gate — fall through to raw text */
      }

      const card = resolved || { name: query, q: query };
      const searchText = resolved ? queryForCard(resolved) : query;

      let sold;
      try {
        sold = await price(searchText, true);
      } catch (err) {
        if (live) setState({ status: "error", query, error: err.message });
        return;
      }
      if (!live) return;

      // Live listings never block the price. They fill in the hero's buy-it-
      // today figure when they land, and their absence is a state the design
      // has an answer for.
      let live_ = { comps: [] };
      try { live_ = await price(searchText, false); } catch { /* optional */ }
      if (!live) return;

      setState({
        status: "ready",
        query,
        card: { ...card, q: searchText },
        derived: derive(card, searchText, sold, live_)
      });
    })();

    return () => { live = false; };
  }, [query]);

  return state;
}

/**
 * The whole read of one card, in one pure function so it can be reasoned about
 * (and, later, tested) without a browser.
 */
export function derive(card, searchText, soldRes, liveRes) {
  const withQ = { ...card, q: searchText };
  const comps = soldRes.comps || [];
  const priced = priceCard(withQ, comps);
  const rec = priced.rec;
  const used = rec ? rec.included || [] : [];

  const liquidity = assessLiquidity({
    used,
    response: soldRes,
    comps,
    windowDays: SOLD_WINDOW_DAYS
  });
  const confidence = assessConfidence({
    rec,
    comps,
    windowDays: SOLD_WINDOW_DAYS,
    market: UK
  });

  // Active listings get the same name/number/set treatment as sold comps.
  // Scoring them with no tokens is why an early "buy one now" was offering
  // £2.60 copies of a different card.
  const settings = settingsForCard(withQ);
  const tokens = buildCompTokens({ name: card.name, number: card.number }, searchText);
  const guardedLive = dropWrongNumerator(
    dropWrongSetTotal(liveRes.comps || [], card.number), card.number
  );
  const liveUk = splitByMarket(guardedLive, UK).chosen;
  const liveRec = liveUk.length
    ? CompFinderPricing.recommend(liveUk, settings, tokens, "active", card.number, card.set)
    : null;

  const listings = ((liveRec && liveRec.included) || [])
    .map((c) => ({
      itemPence: c.itemPricePence,
      postagePence: c.postagePence || 0,
      totalPence: c.totalPence ?? c.itemPricePence,
      title: c.title,
      url: c._source && c._source.url,
      condition: c.condition && c.condition !== "Unknown" ? c.condition : null
    }))
    .sort((a, b) => a.totalPence - b.totalPence);

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
    liquidity,
    confidence,
    exclusions: groupExclusions((rec && rec.excluded) || []),
    excludedCount: rec ? (rec.excluded || []).length : 0,
    viaName: priced.viaName,
    lo: priced.lo,
    hi: priced.hi
  };

  // Caveats need the finished picture, so they come last rather than being
  // threaded through every branch above.
  return { ...base, caveats: caveatsFor({ rec, derived: base, card }) };
}

export default { useCard, derive, queryForCard, SOLD_WINDOW_DAYS };
