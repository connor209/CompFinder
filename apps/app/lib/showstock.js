/**
 * Comp Finder — the show pool: what gets priced, and what goes on the sticker.
 *
 * The Show Desk already knows which cards left the building: checking a card
 * out writes an open `stock_checkouts` row. That set IS the show stock list,
 * so it needs no new table and no second definition — this file just turns it
 * into something the Batch screen can price, and turns what comes back into a
 * price you can write on a label.
 *
 * A sticker is NOT the eBay recommended price, and the difference is the whole
 * reason this file exists:
 *
 * - `finalPence` sits on a 50p charm ladder off a £2.49 floor (pricing.js),
 *   because that is what an eBay listing wants. Nobody hands 50p pieces across
 *   a table all day, so a sticker rounds to cash.
 * - A sticker is printed and physically stuck to a card. Everywhere else a bad
 *   price is recoverable — you edit the listing. This one gets peeled off by
 *   hand, or worse, sold at. So a thin price is HELD rather than rounded: see
 *   stickerFor() below.
 *
 * Framework-free and app-import-free on purpose, so scripts/check-showstock.mjs
 * can load it under bare node and assert the ladder and the gate.
 */

/** No sticker goes out below this — you cannot take 40p across a table. */
export const STICKER_MIN_PENCE = 100;

/**
 * Confidence tiers that never get a sticker. `confidenceTier()` in pricing.js
 * calls 0 comps "None" and 1-3 "Low"; both are a number built on almost
 * nothing, and the audit harness exists precisely because two examples are not
 * evidence. On the web that figure carries its own caveat next to it. On a
 * sticker there is no room for a caveat, and no reader looking for one.
 */
export const HELD_CONFIDENCE = ["None", "Low"];

/**
 * The cash ladder. Round money, in the steps a float of change actually holds:
 * £1 up to £20, £5 to £100, £10 above that. Ties round up (Math.round), which
 * is the right direction here — the eBay price this comes from has ~13.25% of
 * fees and £1.35 of postage priced into it that a table sale never pays, so a
 * sticker rounded up is still comfortably inside what the card sells for.
 *
 * The band is chosen from the price we were given, not from the rounded
 * result, so a figure never falls through two bands on its way down.
 *
 * Note the deliberate loss of resolution at the bottom: £2.49 and £2.99 both
 * sticker at £3, and anything under £1.50 becomes £1. That is correct for a
 * show table and wrong for bulk — a 20p common wants a "3 for £5" tub, not a
 * label of its own.
 */
export function stickerPence(finalPence) {
  const n = Number(finalPence);
  if (!Number.isFinite(n) || n <= 0) return null;
  const step = n <= 2000 ? 100 : n <= 10000 ? 500 : 1000;
  return Math.max(STICKER_MIN_PENCE, Math.round(n / step) * step);
}

/**
 * The sticker for one recommendation, or a reason there isn't one.
 *
 * Three things are held back, and none of them are held quietly — every caller
 * shows the count and the reason:
 *
 * 1. No price at all. Nothing to round.
 * 2. A price built from ACTIVE listings. The batch run falls back to asking
 *    prices when SoldComps' sold endpoint is down (Panel.js), which is right
 *    for a screen that labels the row "active" — and wrong for a label, where
 *    the source travels no further than this function. An asking price is
 *    evidence that somebody wants that much, not that anybody paid it.
 * 3. Low or no confidence. See HELD_CONFIDENCE.
 *
 * Returns { pence, held, reason } — `reason` is prose, meant to be shown.
 */
export function stickerFor(rec) {
  if (!rec || rec.finalPence == null) {
    return { pence: null, held: true, reason: "no price found" };
  }
  if (rec.dataSource === "active") {
    return { pence: null, held: true, reason: "priced from asking prices, not sales" };
  }
  if (HELD_CONFIDENCE.includes(rec.confidence)) {
    const comps = (rec.included || []).length;
    return {
      pence: null,
      held: true,
      reason: `${String(rec.confidence).toLowerCase()} confidence — ${comps} comp${comps === 1 ? "" : "s"}`
    };
  }
  return { pence: stickerPence(rec.finalPence), held: false, reason: null };
}

/**
 * Open checkouts -> items the Batch screen can price.
 *
 * `source: "stock"` is not special-cased by buildQueryForItem() in Panel.js —
 * it falls through to the same title-parsing path a pasted line takes, which
 * is exactly right: a checkout's `title` IS the eBay listing title.
 *
 * A row with no title can't be priced (its SKU is a shelf reference, not a
 * card), so it is returned as `skipped` rather than dropped — the screen says
 * how many and which.
 */
export function buildPool(checkouts) {
  const items = [];
  const skipped = [];
  for (const c of checkouts || []) {
    if (!c || c.resolved_at) continue;
    if (!c.title) {
      skipped.push({ id: c.id, sku: c.sku || null });
      continue;
    }
    items.push({ sku: c.sku || "", title: c.title, source: "stock", checkoutId: c.id });
  }
  return { items, skipped };
}

/** The show a pool belongs to, for the saved run's label. */
export function poolLabel(checkouts) {
  const events = [...new Set((checkouts || []).map((c) => (c?.event || "").trim()).filter(Boolean))];
  if (events.length === 1) return events[0];
  return "the show desk";
}

/**
 * A priced run turned into sticker rows: one per card, in run order, each
 * carrying its own held-ness. This is the shape the Show Desk write-back
 * consumes and the shape the label export will render — defined once, here,
 * so the number printed on a label and the number stored against the card
 * cannot come from two different roundings.
 */
export function stickerRows(results) {
  return (results || []).map((r) => {
    const s = stickerFor(r.rec);
    return {
      sku: r.sku || "",
      title: r.title || "",
      recommendedPence: r.rec?.finalPence ?? null,
      confidence: r.rec?.confidence ?? null,
      stickerPence: s.pence,
      held: s.held,
      reason: s.reason
    };
  });
}

/** "31 priced, 12 held back" — the one-liner every caller shows. */
export function stickerSummary(rows) {
  const priced = (rows || []).filter((r) => !r.held).length;
  const held = (rows || []).length - priced;
  return { priced, held };
}
