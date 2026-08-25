/**
 * The words and figures on the shareable price image.
 *
 * Kept apart from the route that draws it so it can be tested under bare node
 * — the route is JSX and next/og, neither of which the check scripts can load.
 *
 * WHAT IS DELIBERATELY NOT ON IT: "buy it today for". Everywhere else that
 * figure is the headline, and here it would be a lie with a long half-life.
 * Asking prices are two hours fresh at best, and this image is built to be
 * pasted into a Facebook group where it will still be visible in March. A
 * sold price is a fact about something that already happened and stays true;
 * a live listing may have sold before the screenshot finished uploading.
 *
 * The DATE is on it for the same reason. A price screenshot with no date is
 * the thing people argue with each other about six months later.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";

const gbp = (pence) => (pence == null ? "—" : CompFinderPricing.toPoundsStr(pence));

/** 23 Aug 2026 — unambiguous to a UK reader and short enough for the strip. */
export function shortDate(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Satori has no ellipsis; an over-long name has to be cut before it is drawn. */
export function fit(text, max) {
  const s = String(text || "").trim();
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Everything the image renders, from what the screen was showing.
 *
 * `now` is a parameter rather than a call to Date.now() so the tests can pin
 * it — the same reason the audit scripts take a timestamp.
 */
export function shareFields({ card, marketPence, used = 0, windowDays = 90, lastSale = null, now = new Date() } = {}) {
  // Not a default parameter: a default only fires on undefined, and the caller
  // that hands this a null card is exactly the one that has nothing to draw.
  const c = card || {};
  const setLine = [c.set, c.number ? `#${c.number}` : null]
    .filter(Boolean)
    .join(" · ");

  return {
    name: fit(c.name || "Unknown card", 34),
    setLine: fit(setLine, 46),
    figure: gbp(marketPence),
    // "Sells for" rather than "worth": the number is what comparable copies
    // actually sold for, which is a narrower and more defensible claim.
    figureLabel: "Sells for",
    basis: used
      ? `${used} sold ${used === 1 ? "listing" : "listings"} · last ${windowDays} days`
      : `No sales in the last ${windowDays} days`,
    lastSale: lastSale && lastSale.pence != null
      ? `Last one ${gbp(lastSale.pence)}${lastSale.endedAt ? ` on ${shortDate(lastSale.endedAt)}` : ""}`
      : null,
    // Stamped, always. See the note at the top of this file.
    stamp: `eBay UK sold prices · ${shortDate(now)}`,
    domain: "lastcomp.co.uk"
  };
}

export default { shareFields, shortDate, fit };
