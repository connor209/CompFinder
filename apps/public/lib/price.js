/**
 * The page's pricing pipeline, in one place.
 *
 * Lives here rather than in scripts/ because it IS the page's behaviour; the
 * harnesses import it from the app, not the other way round. Extracted after
 * the Pulse comparisons were found to have drifted away from it. compare-pulse.mjs was
 * still scoring with DEFAULT_SETTINGS, no collector-number guards, and
 * finalPence — the recommended LISTING price, floored at £2.49 and rounded up
 * a charm ladder — against a best-sellers list where a third of the cards are
 * worth under £5. It was measuring a floor, not a market, and it would have
 * gone on measuring one through a re-run meant to check our accuracy.
 *
 * Every harness that prices a card should call this, so there is one answer to
 * "what does the page actually do" rather than four copies drifting apart.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";
import { buildCompTokens, dropWrongSetTotal, dropWrongNumerator } from "./tokens.js";
import { UK, splitByMarket } from "./markets.js";
import { settingsForCard } from "./settings.js";

/**
 * `card` is { name, number, set, q } — q being the text the search was run
 * with. `comps` is the raw array from /api/price.
 *
 * Returns the worldwide figure (the headline the audit reports), the
 * chosen-market figure beside it, and enough detail to explain either.
 */
export function priceCard(card, comps = [], { market = UK } = {}) {
  const settings = settingsForCard(card);
  const tokens = buildCompTokens({ name: card.name, number: card.number }, card.q);
  const guarded = dropWrongNumerator(dropWrongSetTotal(comps, card.number), card.number);
  const { chosen, rest } = splitByMarket(guarded, market);
  const all = [...chosen, ...rest];

  let rec = all.length
    ? CompFinderPricing.recommend(all, settings, tokens, "sold", card.number, card.set)
    : null;

  // NUMBER FALLBACK. If requiring the collector number rejects every comp but
  // the name alone matches several, the number is likelier wrong than the
  // market empty. Mirrors the card screen.
  let viaName = false;
  if (rec && (rec.included || []).length === 0) {
    const alt = CompFinderPricing.recommend(
      all, settings, buildCompTokens({ name: card.name }, card.q), "sold", null, card.set
    );
    if ((alt.included || []).length >= 3) { rec = alt; viaName = true; }
  }

  const marketRec = chosen.length
    ? CompFinderPricing.recommend(chosen, settings, tokens, "sold", card.number, card.set)
    : null;

  const used = rec ? rec.included || [] : [];
  const totals = used.map((c) => c.totalPence);

  return {
    rec,
    marketRec,
    // rawPence ONLY. finalPence is a recommended LISTING price — floored at
    // £2.49 and rounded up a 50p charm ladder — which belongs to the business
    // app, where a listing floor is exactly right. This page answers "what is
    // this worth", and the ladder was quietly adding up to 30% on cheap cards:
    // against the Pulse best sellers, a third of which trade under £5, it put
    // our median at 1.11x their market price where the honest figure is 1.03x.
    pence: rec?.rawPence ?? null,
    marketPence: marketRec?.rawPence ?? null,
    used: used.length,
    marketUsed: marketRec ? (marketRec.included || []).length : 0,
    viaName,
    lo: totals.length ? Math.min(...totals) : null,
    hi: totals.length ? Math.max(...totals) : null,
    excluded: rec ? (rec.excluded || []).length : 0
  };
}

export default { priceCard };
