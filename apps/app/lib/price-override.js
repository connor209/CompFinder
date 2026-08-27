/**
 * Comp Finder — the price you decided on, over the price we worked out.
 *
 * The pricing engine answers from comps. Sometimes you know something it
 * cannot: the card is signed, the comps are all the reverse holo, a customer
 * has already agreed a number, or SoldComps came back with nothing at all and
 * you still have to put the card in a box with a price on it. This module is
 * how that number gets in, and — more importantly — how it stays the SAME
 * number everywhere it then travels.
 *
 * Three rules, and the second is the one that earns the file:
 *
 * 1. **The recommendation is never edited.** `finalPence` stays exactly what
 *    the engine produced; the override is a second field beside it. That is
 *    what makes an override reversible, and it is what keeps a corpus honest:
 *    `scripts/recurse-batch.mjs` re-prices a downloaded run and compares
 *    against `finalPence`, so a hand-typed number silently overwriting it
 *    would poison the only measurement we have of whether a rule change helped.
 *
 * 2. **Everything that spends money reads `effectivePence()`, never
 *    `finalPence`.** The eBay upload CSV, the bulk lister, the sticker ladder,
 *    the saved run and the price history all go through it. A caller that
 *    reads `finalPence` directly is not a cosmetic bug — it lists the card at
 *    the price you overrode, which is the one outcome an override exists to
 *    prevent. `scripts/check-override.mjs` greps for exactly that.
 *
 * 3. **An override is loud.** Every screen that shows one says it is yours and
 *    what it replaced, and every export carries the engine's figure alongside.
 *    A price nobody can tell was typed by hand is indistinguishable from a
 *    price the tool stands behind, and the whole proposition here is knowing
 *    which is which.
 *
 * Framework-free and app-import-free on purpose, so check-override.mjs can
 * load it under bare node.
 */

/**
 * The ceiling, and it is a typo guard rather than an opinion about cards.
 * £99,999.99 is where eBay's own `*StartPrice` stops, so a number above it
 * cannot be listed anyway — and the realistic way to reach it is a missing
 * decimal point on a £120 card.
 */
export const MAX_OVERRIDE_PENCE = 9999999;

/** A price of zero is not a cheap card, it's an empty box. */
export const MIN_OVERRIDE_PENCE = 1;

/** £-with-pence, the way every other figure in the app is written. */
export function poundsStr(pence) {
  if (pence == null || !Number.isFinite(Number(pence))) return "—";
  return `£${(Number(pence) / 100).toFixed(2)}`;
}

/**
 * Read what was typed into a price in pence.
 *
 * Returns `{ pence, error }` — exactly one of them is set, and `error` is
 * prose meant to be shown on the row rather than a code. Deliberately fussy
 * about a third decimal: `12.505` is a slip of the finger, and rounding it
 * quietly is how a listing goes up at a price nobody chose.
 *
 * A blank string is not an error — it is the way you clear an override, and
 * comes back as `{ pence: null, error: null }`.
 */
export function parseOverridePence(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { pence: null, error: null };

  const cleaned = raw.replace(/^£\s*/, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    if (/^\d+\.\d{3,}$/.test(cleaned)) {
      return { pence: null, error: "Prices go to the penny — two decimal places at most." };
    }
    if (/^-/.test(cleaned)) {
      return { pence: null, error: "A price can't be negative." };
    }
    return { pence: null, error: `“${raw}” isn't a price — try 12.50.` };
  }

  const pence = Math.round(Number(cleaned) * 100);
  if (pence < MIN_OVERRIDE_PENCE) {
    return { pence: null, error: "A price of nothing isn't a price — clear the box instead." };
  }
  if (pence > MAX_OVERRIDE_PENCE) {
    return {
      pence: null,
      error: `${poundsStr(MAX_OVERRIDE_PENCE)} is as high as eBay will take — check the decimal point.`
    };
  }
  return { pence, error: null };
}

/** True when a human has put a price on this card by hand. */
export function isOverridden(rec) {
  return !!rec && rec.overridePence != null;
}

/**
 * THE price for this card: yours if you set one, otherwise the engine's.
 *
 * Every caller that lists, exports, stickers or records a price reads this.
 * See rule 2 at the top of the file.
 */
export function effectivePence(rec) {
  if (!rec) return null;
  if (rec.overridePence != null) return rec.overridePence;
  return rec.finalPence ?? null;
}

/**
 * A recommendation with your price on it. Returns a NEW rec — results live in
 * React state and a mutated rec would not re-render the row it is on.
 *
 * Two cases worth spelling out:
 *
 * - **Typing the recommendation back in clears the override.** There is
 *   nothing to override, and "overridden from £12.49 to £12.49" is noise on
 *   every screen and in every export from then on.
 * - **A card the engine could not price at all still takes one.** `rec` may be
 *   null — a SoldComps timeout, a card with no comps — and that is the single
 *   strongest case for typing a number, so a minimal rec is built around it.
 *   It carries `dataSource: "override"` and no comps, because there were none:
 *   nothing downstream should be able to mistake it for a priced card.
 */
export function withOverride(rec, pence) {
  const value = pence == null ? null : Math.round(Number(pence));
  if (value == null || !Number.isFinite(value) || value < MIN_OVERRIDE_PENCE) return clearOverride(rec);
  if (rec && rec.finalPence === value) return clearOverride(rec);
  // Already yours, at that number. Handing back the same rec is how the screens
  // tell a real edit from confirming a box unchanged — see the callers.
  if (rec && rec.overridePence === value) return rec;

  if (!rec) {
    return {
      rawPence: null,
      finalPence: null,
      confidence: "None",
      dataSource: "override",
      note: "",
      included: [],
      excluded: [],
      graded: [],
      overridePence: value
    };
  }
  return { ...rec, overridePence: value };
}

/**
 * Back to the engine's number. A rec that only ever existed to carry an
 * override goes back to nothing at all, rather than lingering as a priceless
 * row that used to be a failure and now looks like a result.
 */
export function clearOverride(rec) {
  if (!rec) return null;
  if (rec.dataSource === "override" && rec.finalPence == null) return null;
  if (rec.overridePence == null) return rec;
  const { overridePence, ...rest } = rec;
  return rest;
}

/**
 * One line saying what happened, or null. Shown on the row, appended to the
 * price-history note, and written into the exports — the same sentence in all
 * three, so the CSV and the screen cannot describe the same edit differently.
 */
export function overrideNote(rec) {
  if (!isOverridden(rec)) return null;
  return rec.finalPence == null
    ? `Priced by hand at ${poundsStr(rec.overridePence)} — the app couldn't price this card.`
    : `Priced by hand at ${poundsStr(rec.overridePence)}, overriding ${poundsStr(rec.finalPence)}.`;
}

/** The engine's figure, kept for display beside an override. Null when there
 *  is no override, so a caller can render "was £X" without a second test. */
export function overriddenFromPence(rec) {
  return isOverridden(rec) ? rec.finalPence ?? null : null;
}

export default {
  MAX_OVERRIDE_PENCE,
  MIN_OVERRIDE_PENCE,
  poundsStr,
  parseOverridePence,
  isOverridden,
  effectivePence,
  withOverride,
  clearOverride,
  overrideNote,
  overriddenFromPence
};
