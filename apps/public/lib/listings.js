/**
 * Which live listings are safe to put in front of someone, and which one may
 * be the hero.
 *
 * THE HERO IS A MINIMUM, AND A MINIMUM HAS NO ROBUSTNESS. Everywhere else on
 * the page a stray comp is absorbed — the price is a weighted median, and one
 * bad match moves it by pennies. The "buy it today for" figure is the single
 * cheapest live listing, so one bad match IS the answer, printed in the
 * largest type on the page with an affiliate link under it.
 *
 * That is not hypothetical. Umbreon VMAX 215 Evolving Skies, 24 Aug 2026:
 * eight sold comps, median £837.48, last one £949.95 — and the page led with
 * "Buy it today for £44.75", tagged buy-hero, pointing at a listing that was
 * not the card.
 *
 * Two separate leaks put it there, and both need closing:
 *
 *   1. dropWrongNumerator keeps a title with NO collector number in it —
 *      "no explicit number, can't rule it out", which is right for sold comps
 *      (dropping them loses real evidence and the median absorbs the rest) and
 *      wrong for a minimum, where the unnumbered stray wins by construction.
 *   2. Some of the cheap listings DID carry 215/203 and still weren't the
 *      card: £57.72 and £85.56 against a £837 median. Counterfeits, damage or
 *      a copied title. No amount of name and number matching separates those,
 *      because the title is not evidence about the object.
 *
 * So the number guard is tightened for live listings, and then a price floor
 * catches what matching cannot. Nothing is deleted quietly: what the floor
 * rejects is counted and handed back, so the page can say it rather than
 * appearing to have found less than it did.
 */

/**
 * How far below the sold figure an asking price may sit before we stop
 * believing it is the same object.
 *
 * A third. The reasoning, and why it is nothing like the sold-side rule:
 * pricing.js drops a LOW SOLD outlier at median/12 with a cluster guard,
 * because a completed sale is evidence — somebody really did pay that, and a
 * played copy of an £800 card really does sell for £70. An asking price is not
 * evidence of anything. Anyone can list anything at any number, and the cheap
 * tail of a chase card's live listings is where the fakes, the "card only"
 * misdescriptions and the wrong printings collect. Above a third of market a
 * listing is a keen seller or a rough copy; below it, on the cards this has
 * been looked at on, it is not the card.
 *
 * NOT YET MEASURED against a corpus — scripts/probe-rules.mjs and the audit
 * harness are how that gets done, and this number should move if the data says
 * so. It is deliberately loose: the job is to catch a 5%-of-market fake, not
 * to adjudicate a good deal.
 */
export const LISTING_FLOOR_FRACTION = 1 / 3;

/**
 * A floor needs something to stand on. One or two sold comps is not a market,
 * and suppressing real listings against a number built on a single sale would
 * trade a visible error for an invisible one.
 */
export const MIN_COMPS_FOR_FLOOR = 3;

/** Below this there is nothing to be wrong about, and the fractions get silly. */
const FLOOR_APPLIES_ABOVE_PENCE = 500;

/**
 * Live listings whose title carries a collector number that isn't ours.
 *
 * Stricter than the sold-side dropWrongNumerator: a title with NO number is
 * dropped too, because for the hero we need positive evidence that this is the
 * card rather than an absence of evidence that it isn't.
 *
 * Falls back to the input when too few survive — an empty buy module is worse
 * than a cautious one, and a card whose sellers simply don't write numbers
 * would otherwise never show a listing at all.
 */
export function requireNumber(listings, number, minKept = 2) {
  const want = String(number || "").trim().replace(/^0+(?=\d)/, "");
  if (!want) return { kept: listings, dropped: [] };

  const kept = [];
  const dropped = [];
  for (const c of listings) {
    const found = [...String(c.title || "").matchAll(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g)];
    const bare = [...String(c.title || "").matchAll(/\b(\d{1,4})\b/g)];
    const ours =
      found.some((m) => m[1].replace(/^0+(?=\d)/, "") === want) ||
      (!found.length && bare.some((m) => m[1].replace(/^0+(?=\d)/, "") === want));
    (ours ? kept : dropped).push(c);
  }
  return kept.length >= minKept ? { kept, dropped } : { kept: listings, dropped: [] };
}

/**
 * The listings a page may show, and the ones it must not lead with.
 *
 * `soldPence` is the figure the page is already showing as what the card sells
 * for; `soldUsed` is how many comps it rests on.
 *
 * @returns {{ listings, suppressed: number, floorPence: number|null }}
 */
export function safeListings({ candidates = [], number = null, soldPence = null, soldUsed = 0 }) {
  const { kept } = requireNumber(candidates, number);

  const floorPence =
    soldPence != null && soldPence > FLOOR_APPLIES_ABOVE_PENCE && soldUsed >= MIN_COMPS_FOR_FLOOR
      ? Math.round(soldPence * LISTING_FLOOR_FRACTION)
      : null;

  if (floorPence == null) {
    return { listings: [...kept].sort(byPrice), suppressed: 0, floorPence: null };
  }

  const believable = kept.filter((c) => priceOf(c) >= floorPence);
  return {
    // If EVERY listing is under the floor, the floor is likelier wrong than
    // sixteen sellers are — most often a sold figure inflated by graded slabs
    // that shouldn't have counted. Show them rather than an empty module, and
    // let the caveats carry the doubt.
    listings: (believable.length ? believable : [...kept]).sort(byPrice),
    suppressed: believable.length ? kept.length - believable.length : 0,
    floorPence
  };
}

/**
 * What the page is allowed to SAY about the live listings, from the counts at
 * each stage of the funnel above.
 *
 * "Nothing listed in the UK right now" is a claim about eBay, and the page was
 * making it in three situations where it wasn't true: when the listings
 * request had failed and been swallowed into an empty array; when eBay had
 * listings but none were UK-domestic; and when our own guards — the number
 * rule, the exclusions, the floor — had taken every one of them. Reported on
 * 28 Aug 2026 with a screenshot of 72 live results for the Umbreon VMAX 215
 * this file was written for, beside our page saying there were none.
 *
 * A guard that drops a listing is doing its job. Printing the result as though
 * eBay were empty is not: it is the same class of mistake as the £44.75 hero,
 * stated with total confidence and impossible for the visitor to check. The
 * funnel is counted so each of those states can say which one it is.
 *
 * @param counts.fetched    live listings the API returned for this card
 * @param counts.uk         of those, UK-domestic and carrying our number
 * @param counts.elsewhere  of those, listed from outside the UK
 * @param counts.shown      what survived everything and reached the page
 */
export function listingsVerdict({ pending = false, unknown = false, fetched = 0, uk = 0, elsewhere = 0, shown = 0 } = {}) {
  if (pending) return { state: "pending", text: null };
  // Never a claim about eBay. We asked and didn't get an answer, which is a
  // fact about us.
  if (unknown) return { state: "unknown", text: "couldn't check what's listed right now" };
  if (shown > 0) return { state: "showing", text: null };
  if (!fetched) return { state: "none", text: "nothing listed in the UK right now" };
  if (!uk && elsewhere) {
    return {
      state: "elsewhere",
      text: `nothing listed in the UK · ${elsewhere} listed from elsewhere`
    };
  }
  return {
    state: "filtered",
    text: `${fetched} listed, none we could confirm as this card`
  };
}

const priceOf = (c) => c.totalPence ?? c.itemPricePence ?? 0;
const byPrice = (a, b) => priceOf(a) - priceOf(b);

export default { safeListings, requireNumber, listingsVerdict, LISTING_FLOOR_FRACTION, MIN_COMPS_FOR_FLOOR };
