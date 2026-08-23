/**
 * Liquidity inference from SoldComps data.
 *
 * A price answers "what is it worth". Liquidity answers the question a
 * reseller actually has next — "if I list it, will it sell, and how long will
 * I wait" — and it's the thing a bare comp list never tells you.
 *
 * WHAT WE HAVE TO WORK WITH. Per sold comp: a price and an `endedAt` date.
 * Per active listing: a price. Plus the two counts. That's it — SoldComps
 * exposes no seller identity, no watch counts, no bid counts, and doesn't
 * distinguish auction from Buy It Now on the sold side. Every metric below is
 * built from dates, prices and counts alone, and the limits that creates are
 * stated rather than papered over:
 *
 *   - No seller identity means ten sales could be one seller clearing ten
 *     copies rather than ten independent buyers. We can't detect that
 *     directly, so `concentrated` flags the observable symptom instead:
 *     sales bunched onto very few days.
 *   - The active count is what's listed *now*, not what was listed while each
 *     sale happened, so days-of-supply is a snapshot, not a measured rate.
 *   - A 90-day window can't resolve anything slower than roughly monthly.
 *
 * Everything here is derived aggregate — no listing is reproduced — which also
 * makes it the safest class of output to show publicly.
 */
const CompFinderLiquidity = (() => {

  // Tuned for UK TCG singles. A card selling several times a week is a card
  // you can list at market and expect gone; one selling monthly needs either
  // patience or a discount, and that difference is the whole point of this.
  const BANDS = [
    { key: "very-liquid", label: "Sells fast",   minSalesPerWeek: 3 },
    { key: "liquid",      label: "Sells well",   minSalesPerWeek: 1 },
    { key: "slow",        label: "Slow mover",   minSalesPerWeek: 0.25 },
    { key: "illiquid",    label: "Hard to sell", minSalesPerWeek: 0 }
  ];

  const DAY_MS = 24 * 60 * 60 * 1000;

  // Shortest window worth cutting in half. Under a fortnight, "the recent
  // half" is a handful of days and the comparison is noise.
  const MIN_SPLIT_DAYS = 14;

  function median(nums) {
    if (!nums.length) return null;
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base + 1] !== undefined
      ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
      : sorted[base];
  }

  /** Sale timestamps, newest first. Comps without a usable date are dropped. */
  function saleTimes(soldComps) {
    return (soldComps || [])
      .map((c) => (c && c._source && c._source.endedAt ? new Date(c._source.endedAt).getTime() : NaN))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => b - a);
  }

  /**
   * @param {object}   input
   * @param {Array}    input.soldComps   comps the price was built from (post-filter)
   * @param {number}   [input.activeCount] live listings for the same card, if known
   * @param {number}   [input.windowDays]  how far back the sold search reached
   * @param {number}   [input.visibleDays] on a capped set, how far back page one
   *                                       reaches — measured on the RAW result
   *                                       set, before filtering. See below.
   * @param {number}   [input.now]         injectable clock, for tests
   */
  function assess({ soldComps = [], activeCount = null, windowDays = 90, saturated = false, visibleDays = null, now = Date.now() } = {}) {
    const times = saleTimes(soldComps);
    const sales = times.length;

    // SATURATION. SoldComps returns roughly forty results per page, newest
    // first, so a fast-moving card doesn't return "all sales in 90 days" — it
    // returns "the last forty sales", and dividing those by 90 understates the
    // rate by however much of the window we never saw. Measured live: a Mega
    // Darkrai ex returned forty sales spanning a single day. Called with 90 it
    // reads as 3/week; the truth is nearer 40/day.
    //
    // When the caller says the set was capped, the period becomes the span the
    // returned sales actually cover. That turns the cap from a distortion into
    // a density measurement — the tighter the span, the faster the card moves.
    //
    // WHICH SPAN, THOUGH. The cap applies to the SEARCH, not to this card: a
    // page of forty listings might contain three sales of the card asked for.
    // Reading the rate off the span between those three says the card sold
    // three times in three days when what happened is that three of the last
    // forty listings for that query were it. Measured over 40 cards on
    // 2026-08-23, that overstated a Xerneas at 7 sales a week where the honest
    // figure is 0.36, and it overstates by more the harder the filtering works.
    //
    // What page one actually supports: it reaches back to some moment T, so
    // between T and now every matching listing is in the data, and the sales
    // that survived filtering are all of this card's sales in that period. So
    // the window is `visibleDays` — measured on the raw result set by the
    // caller, who is the only one holding it — and it ends at now, which keeps
    // it honest about a card that has stopped selling. Callers that don't pass
    // it get the older behaviour rather than a silent change of meaning.
    const observedSpanDays = sales >= 2 ? Math.max((times[0] - times[times.length - 1]) / DAY_MS, 0.5) : null;
    const visible = saturated && visibleDays > 0 ? Math.max(visibleDays, 0.5) : null;
    const effectiveDays = visible || (saturated && observedSpanDays ? observedSpanDays : windowDays);
    const capped = !!(saturated && effectiveDays < windowDays);

    if (sales === 0) {
      return {
        band: "unknown",
        label: "Not enough sales",
        salesPerWeek: 0,
        recentPerWeek: 0,
        sellThrough: null,
        daysOfSupply: null,
        medianGapDays: null,
        spread: null,
        momentum: null,
        concentrated: false,
        sales: 0,
        activeCount,
        windowDays,
        reasons: ["No dated sales in the window, so there's nothing to measure a rate from."]
      };
    }

    const salesPerWeek = round2((sales / effectiveDays) * 7);

    // Banding uses the RECENT half of the window, not the whole of it. A card
    // that sold twelve times in the last five weeks and nothing before is a
    // card you can shift today; averaged across ninety days it reads as slow,
    // which is exactly backwards for someone deciding whether to list now.
    // The same rule handles the opposite case honestly: a card whose sales all
    // sit in the older half scores zero here, because nothing is selling now.
    const halfWindow = effectiveDays / 2;
    const recentCutoff = now - halfWindow * DAY_MS;
    const recentSales = times.filter((t) => t >= recentCutoff).length;
    // The split needs a window that ENDS AT NOW, or "the recent half" is the
    // recent half of a period that finished days ago. A visible window does end
    // at now, so it splits like any other — and that is the whole point, since
    // it is what separates a card selling steadily from one that sold twenty
    // times last month and nothing since. A window derived from the comps'
    // own span does not, so it keeps the old behaviour of not splitting.
    //
    // Below a fortnight the halves stop meaning anything: three days of sales
    // against three days of nothing is noise, not a trend.
    const splittable = !capped || (visible && effectiveDays >= MIN_SPLIT_DAYS);
    const recentPerWeek = splittable ? round2((recentSales / halfWindow) * 7) : salesPerWeek;

    // Gaps between consecutive sales. More honest than a raw count for thin
    // cards: four sales spread evenly across 90 days is a working market,
    // four on the same afternoon is one seller having a clearout.
    const gaps = [];
    for (let i = 0; i < times.length - 1; i++) gaps.push((times[i] - times[i + 1]) / DAY_MS);
    const medianGapDays = gaps.length ? round1(median(gaps)) : null;

    // Distinct selling days vs sales. Well under 1 means bunching.
    const distinctDays = new Set(times.map((t) => Math.floor(t / DAY_MS))).size;
    // Bunching is only meaningless when the window is the sales' own span —
    // then they look bunched by construction, whoever sold them. Across a
    // window that ends at now, four sales on one afternoon and nothing either
    // side is exactly the clearout this flag exists to name.
    const bunchingReadable = !capped || (visible && effectiveDays >= MIN_SPLIT_DAYS);
    const concentrated = bunchingReadable && sales >= 4 && distinctDays / sales < 0.5;

    // Supply pressure. Sell-through is the share of "card exists on eBay"
    // events that ended in a sale; days-of-supply turns the same two numbers
    // into a wait a person can picture.
    let sellThrough = null;
    let daysOfSupply = null;
    if (typeof activeCount === "number" && activeCount >= 0) {
      sellThrough = sales + activeCount > 0 ? round2(sales / (sales + activeCount)) : null;
      const perDay = sales / effectiveDays;
      daysOfSupply = perDay > 0 ? Math.round(activeCount / perDay) : null;
    }

    // Price agreement. A tight spread means buyers and sellers agree what the
    // card costs, so a listing at market moves; a wide one means the price
    // depends on condition or luck, which is its own kind of illiquidity.
    const prices = (soldComps || [])
      .map((c) => c.totalPence ?? c.itemPricePence)
      .filter((p) => typeof p === "number" && p > 0)
      .sort((a, b) => a - b);
    const med = median(prices);
    const iqr = prices.length >= 4 ? quantile(prices, 0.75) - quantile(prices, 0.25) : null;
    const spread = iqr != null && med ? round2(iqr / med) : null;

    // Is it warming or cooling? Compare the recent half of the window with the
    // older half. Needs enough sales for the split to mean anything.
    let momentum = null;
    if (sales >= 6 && splittable) {
      const midpoint = now - (effectiveDays / 2) * DAY_MS;
      const recent = times.filter((t) => t >= midpoint).length;
      const older = sales - recent;
      momentum = older === 0 ? "heating" : recent / older >= 1.5 ? "heating" : recent / older <= 0.5 ? "cooling" : "steady";
    }

    const band = BANDS.find((b) => recentPerWeek >= b.minSalesPerWeek) || BANDS[BANDS.length - 1];

    return {
      band: band.key,
      label: band.label,
      salesPerWeek,
      recentPerWeek,
      sellThrough,
      daysOfSupply,
      medianGapDays,
      spread,
      momentum,
      concentrated,
      sales,
      activeCount,
      windowDays,
      capped,
      // The window the rate was actually computed over — 90 days normally, and
      // how far back page one reached when the set was capped.
      effectiveDays: round1(effectiveDays),
      observedSpanDays: observedSpanDays != null ? round1(observedSpanDays) : null,
      reasons: explain({ salesPerWeek, recentPerWeek, sellThrough, daysOfSupply, medianGapDays, spread, momentum, concentrated, sales, halfWindow, recentSales, capped, observedSpanDays, visible, effectiveDays, splittable })
    };
  }

  /** Plain sentences, so the number never has to be interpreted by the reader. */
  function explain({ salesPerWeek, recentPerWeek, sellThrough, daysOfSupply, medianGapDays, spread, momentum, concentrated, sales, halfWindow, recentSales, capped, observedSpanDays, visible, effectiveDays, splittable }) {
    const out = [];
    if (visible) {
      // The honest sentence for a capped set. Not "at least N sales" — within
      // the window page one reaches, N is exactly how many there were. What's
      // missing is everything OLDER, which is a different caveat and the one
      // worth printing.
      const days = Math.round(effectiveDays);
      out.push(
        `${sales} sale${sales === 1 ? "" : "s"} in the ${days === 1 ? "last day" : `last ${days} days`}` +
        ` — about ${salesPerWeek >= 1 ? `${round1(salesPerWeek)} a week` : `one every ${Math.round(7 / Math.max(salesPerWeek, 0.01))} days`}.`
      );
      out.push("That's as far back as one page of results reaches, so older sales aren't counted here.");
      if (splittable && recentSales === 0) {
        out.push(`None of them in the last ${Math.round(halfWindow)} days, though.`);
      }
    } else if (capped) {
      const perDay = observedSpanDays ? sales / observedSpanDays : null;
      out.push(
        `At least ${sales} sales in the last ${observedSpanDays < 1.5 ? "day" : Math.round(observedSpanDays) + " days"}` +
        (perDay ? ` — roughly ${perDay >= 1 ? Math.round(perDay) + " a day" : Math.round(perDay * 7) + " a week"}.` : ".")
      );
      out.push("That's as far back as one page of results reaches, so the true total is higher.");
    } else if (recentSales === 0) {
      out.push(`${sales} sale${sales === 1 ? "" : "s"} in the window, but none in the last ${Math.round(halfWindow)} days.`);
    } else if (recentPerWeek >= 1) {
      out.push(`About ${recentPerWeek} sales a week recently${salesPerWeek !== recentPerWeek ? ` (${salesPerWeek}/week across the whole window)` : ""}.`);
    } else if (medianGapDays != null && medianGapDays < 1) {
      // Rounding a sub-day median to "every 0 days" was nonsense; when sales
      // land together the gap isn't the story, the bunching is.
      out.push(`${sales} sales, several on the same day.`);
    } else if (medianGapDays != null) {
      out.push(`Only ${sales} sales in the window — roughly one every ${Math.round(medianGapDays)} days.`);
    } else {
      out.push(`Only ${sales} sale${sales === 1 ? "" : "s"} in the window.`);
    }
    if (daysOfSupply != null) {
      // Thresholds are deliberately wide: 56 days of supply on a card selling
      // three times a week is a healthy market, not a warning, and the first
      // draft called that "expect to wait".
      out.push(
        daysOfSupply <= 45
          ? `At the current rate the listings up now would clear in about ${daysOfSupply} day${daysOfSupply === 1 ? "" : "s"}.`
          : daysOfSupply <= 150
            ? `Roughly ${daysOfSupply} days of supply listed at the current rate.`
            : `Roughly ${daysOfSupply} days of supply listed — heavily oversupplied, expect to wait or undercut.`
      );
    } else if (sellThrough != null) {
      out.push(`${Math.round(sellThrough * 100)}% of listings seen ended in a sale.`);
    }
    if (spread != null) {
      out.push(
        spread <= 0.25
          ? "Sold prices cluster tightly, so the market agrees on a number."
          : "Sold prices vary widely — condition and listing quality are doing a lot of the work."
      );
    }
    if (momentum === "heating") out.push("Sales have picked up in the second half of the window.");
    if (momentum === "cooling") out.push("Sales have slowed in the second half of the window.");
    if (concentrated) {
      out.push(
        "Those sales are bunched onto very few days, which can mean one seller clearing stock rather than steady demand."
      );
    }
    return out;
  }

  const round1 = (n) => Math.round(n * 10) / 10;
  const round2 = (n) => Math.round(n * 100) / 100;

  return { assess, BANDS };
})();

if (typeof module !== "undefined") module.exports = CompFinderLiquidity;
