import CompFinderLiquidity from "@compfinder/core/liquidity.js";

/**
 * How the page decides a sold-comp set was CAPPED — and the one definition
 * both the page and the audit harness use.
 *
 * Everything liquidity reports hangs on this boolean. SoldComps returns one
 * page of sales, newest first, so for a fast-moving card the window isn't 90
 * days — it's however long those sales took. Dividing by 90 instead of by the
 * span they actually cover understates the rate by whatever fraction of the
 * window was never returned.
 *
 * WHY NOT COUNT THE COMPS. That is what the page did, and measured across 40
 * cards on 2026-08-23 it got the answer wrong on 21 of them. The page size is
 * not fixed: when SoldComps says there is more, it had returned between 35 and
 * 40 items — so a threshold of 39 missed 12 genuinely capped sets, and read
 * "Slow mover, 0.78 sales a week" on a Hoothoot actually selling 7 a week and
 * a Doduo selling 30. In the other direction nine result sets came back with
 * 39 to 55 items and were NOT capped, where the count guess claimed a cap that
 * never happened: the band mostly survived that, but the explanation told the
 * visitor "that's as far back as one page of results reaches, so the true
 * total is higher" about a complete set of results, and suppressed the
 * momentum and bunching reads, both of which stand down on capped data.
 *
 * The API answers the question directly. Ask it, and guess only when it hasn't
 * spoken — a cache entry written before /api/price returned the field, which
 * ages out within a day.
 */
const FALLBACK_FULL_PAGE = 39;

export function saturatedFrom(response, comps = []) {
  const hasNextPage = response && response.hasNextPage;
  if (hasNextPage === true || hasNextPage === false) return hasNextPage;
  return (comps || []).length >= FALLBACK_FULL_PAGE;
}

/**
 * The page's liquidity read, in one place.
 *
 * Same reasoning as priceCard() in lib/price.js: a harness that computes this
 * slightly differently from the page reports on a product that doesn't exist.
 * That is not hypothetical here — the audits already believed hasNextPage
 * while the page was counting comps, and neither side knew.
 *
 * @param {object} input
 * @param {Array}  input.used        comps the price was built from (post-filter)
 * @param {object} input.response    the /api/price body, for hasNextPage
 * @param {Array}  [input.comps]     raw comps, only for the legacy fallback
 * @param {number} [input.activeCount]
 * @param {number} [input.windowDays]
 */
export function assessLiquidity({ used = [], response = null, comps = [], activeCount = null, windowDays = 90, now }) {
  return CompFinderLiquidity.assess({
    soldComps: used,
    activeCount,
    windowDays,
    saturated: saturatedFrom(response, comps.length ? comps : used),
    ...(now ? { now } : {})
  });
}

export default { assessLiquidity, saturatedFrom };
