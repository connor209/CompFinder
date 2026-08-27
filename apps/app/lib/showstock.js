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
import { effectivePence, isOverridden, overriddenFromPence } from "./price-override.js";

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
 * **An override is not held, and that is the point of the gate rather than an
 * exception to it.** Every hold above says the same thing: the EVIDENCE is too
 * thin to print. A price you typed isn't built on that evidence at all — it is
 * a decision by the person who will be standing at the table — so a card the
 * app refused to price is exactly the card an override is for. It still goes
 * through the ladder: what you typed is an eBay price, and a sticker is cash.
 *
 * Returns { pence, held, reason, overridden } — `reason` is prose, meant to
 * be shown.
 */
export function stickerFor(rec) {
  const pence = effectivePence(rec);
  const overridden = isOverridden(rec);
  if (pence == null) {
    return { pence: null, held: true, reason: "no price found", overridden: false };
  }
  if (!overridden && rec.dataSource === "active") {
    return { pence: null, held: true, reason: "priced from asking prices, not sales", overridden: false };
  }
  if (!overridden && HELD_CONFIDENCE.includes(rec.confidence)) {
    const comps = (rec.included || []).length;
    return {
      pence: null,
      held: true,
      reason: `${String(rec.confidence).toLowerCase()} confidence — ${comps} comp${comps === 1 ? "" : "s"}`,
      overridden: false
    };
  }
  return { pence: stickerPence(pence), held: false, reason: null, overridden };
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
 * A price a HUMAN chose, as the label will print it: nearest whole pound.
 *
 * Deliberately not the cash ladder. The ladder is for a figure we derived and
 * are free to tidy; this is a number someone already decided on — the price we
 * list the card at on eBay, or one typed into the box. Running £22.49 through
 * the ladder would put £20 on the sticker, because the rungs step in fives
 * above £20, and giving away £2.49 nobody agreed to is not rounding.
 *
 * The pound is the only change the label itself forces, since labelPrice()
 * prints whole pounds.
 */
export function toPoundPence(pence) {
  const n = Number(pence);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(STICKER_MIN_PENCE, Math.round(n / 100) * 100);
}

/**
 * How much of a card's name fits on a label, by label size. A Niimbot label is
 * physically small, and the printer does not wrap — an over-long name is
 * silently cut off at the edge, or shrunk to something nobody can read across
 * a table. So the cut happens HERE, where it can be seen on screen before a
 * hundred labels come off the roll.
 */
export const NAME_LENGTHS = { short: 20, medium: 30, long: 44 };
export const DEFAULT_NAME_MAX = NAME_LENGTHS.medium;

/** Cut to `max`, on a word where possible, marked with an ellipsis. */
export function fit(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  const hard = s.slice(0, Math.max(0, max - 1));
  // Prefer the last word boundary, but not if that throws most of it away —
  // one very long word should still be cut mid-word rather than vanish.
  const space = hard.lastIndexOf(" ");
  const body = space > max * 0.6 ? hard.slice(0, space) : hard;
  return body.trimEnd() + "…";
}

/** Words that are never part of a card's name and only cost label width. */
const NOISE = /\b(pok[eé]mon|tcg|ccg|trading\s+card\s+game|genuine|official)\b/gi;

/**
 * The card's name as it should read on a label.
 *
 * The input is an eBay listing title, which is written for search engines
 * rather than for a 12mm sticker: "Pokemon TCG Umbreon VMAX 215/203 Evolving
 * Skies Alt Art Ultra Rare NM". Three passes cut it down, in this order
 * because each makes the next cheaper:
 *
 * 1. Bracketed asides go — they are always qualifiers, never the name.
 * 2. **Everything after the collector number goes.** This is the big one: a
 *    TCG title puts the name first and the set, rarity and condition after the
 *    number, so the number is a natural end marker. It also keeps the number
 *    itself, which is what lets you match a loose sticker back to a card.
 * 3. Noise words that are never part of a name.
 *
 * Only then does it truncate, so the ellipsis is a last resort rather than the
 * first thing that happens to a long title.
 */
export function labelName(title, max = DEFAULT_NAME_MAX) {
  let s = String(title || "").trim();
  if (!s) return "";
  s = s.replace(/[[(][^\])]*[\])]/g, " ");
  const num = s.match(/\b[A-Z]{0,3}\d{1,4}\s*\/\s*[A-Z]{0,3}\d{1,4}\b/i);
  if (num) s = s.slice(0, num.index + num[0].length);
  s = s.replace(NOISE, " ").replace(/\s+/g, " ").trim();
  // A title that was nothing but noise leaves the original standing: a label
  // with the wrong name is bad, one with no name at all is useless.
  if (!s) s = String(title).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;

  // Too long, and there is a number: cut the NAME and keep the number, rather
  // than truncating the whole string and losing it. The number is what makes a
  // stray label matchable back to a card — the customer is looking at the card
  // itself, so the name on the sticker is mostly there for us. "Iron Hands…
  // 070/162" beats "Iron Hands ex…" for the one job the text has to do.
  if (num) {
    const tail = num[0];
    const head = s.slice(0, s.length - tail.length).trim();
    const room = max - tail.length - 1;
    if (room >= 4) return `${fit(head, room)} ${tail}`;
  }
  return fit(s, max);
}

/**
 * A priced run turned into sticker rows: one per card, in run order, each
 * carrying its own held-ness. This is the shape the Show Desk write-back
 * consumes and the shape the label export renders — defined once, here, so the
 * number printed on a label and the number stored against the card cannot come
 * from two different roundings.
 *
 * `overrides` is keyed by POSITION in the run, which is the same key a saved
 * run restores under and the order this list renders in — see the note in
 * Panel.js. Read the block inside for how it differs from a price typed on the
 * result itself.
 */
export function stickerRows(results, { nameMax = DEFAULT_NAME_MAX, overrides = {} } = {}) {
  return (results || []).map((r, i) => {
    const s = stickerFor(r.rec);
    const suggested = s.pence;
    // TWO hand-set prices meet here and they are NOT the same thing, so neither
    // is named just "override":
    //
    //   s.overridden   a price typed on the RESULT — an eBay price, which the
    //                  ladder turns into cash and which also lists, exports and
    //                  goes into the price history (see price-override.js).
    //   overrides[i]   a price typed on the STICKER, in whole pounds, which
    //                  travels no further than the label and the show desk.
    //
    // The sticker one wins where both are set: it is the later, more specific
    // decision, and it is the number somebody typed while looking at the label.
    //
    // A price set by hand WINS, and it wins over a hold as much as over a
    // suggestion. Holding a thin price back is the right default — the engine
    // has nothing to stand on — but it was never meant to mean the card can't
    // be sold. Someone who has the card in their hand knows more than the comps
    // do, and typing a number is them saying so.
    const set = overrides?.[i];
    const stickerSet = set != null && Number.isFinite(Number(set)) && Number(set) > 0;
    return {
      sku: r.sku || "",
      title: r.title || "",
      label: labelName(r.title, nameMax),
      // The price the sticker was rounded FROM — yours where you set one on the
      // result, so the "eBay £x" the screen prints beside the sticker is the
      // price the card would actually be listed at, not one it was talked out
      // of.
      recommendedPence: effectivePence(r.rec),
      // What the app had said, kept only where it was overridden: a row that
      // can't say what a price replaced can't be checked against its run.
      overriddenFromPence: overriddenFromPence(r.rec),
      pricedByHand: s.overridden,
      confidence: r.rec?.confidence ?? null,
      suggestedPence: suggested,
      stickerPence: stickerSet ? Math.round(Number(set)) : suggested,
      held: stickerSet ? false : s.held,
      // Only "edited" when it actually differs from what we suggested: a saved
      // run re-opened at the show rehydrates every price it wrote, and marking
      // all of them as hand-set would say something untrue about most.
      edited: stickerSet && suggested !== Math.round(Number(set)),
      reason: stickerSet ? null : s.reason
    };
  });
}

/** "31 priced, 12 held back" — the one-liner every caller shows. */
export function stickerSummary(rows) {
  const priced = (rows || []).filter((r) => !r.held).length;
  const held = (rows || []).length - priced;
  return { priced, held };
}
