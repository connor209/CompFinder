/**
 * How the business app asks the shared pricing engine to match a comp.
 *
 * `packages/core` prices any card for either product. Everything in here is a
 * choice this app makes about ITS OWN inputs, and none of it belongs in core —
 * the same knob set the wrong way for Last Comp would change what a stranger
 * is told their card is worth. apps/public/lib/settings.js is the mirror of
 * this file on the other side; the app simply never had one, and read
 * DEFAULT_SETTINGS directly from five screens instead.
 *
 * Both rules here come from the 2026-08-25 Neo-era Japanese batch. See
 * docs/APP_BATCH_RECURSION.md for the measurements.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";

/**
 * "No.", "No", "#" — a numbering prefix, at the front of a card NUMBER.
 *
 * The app's inputs carry it and Last Comp's do not, which is the whole reason
 * this is an app-side rule. A CardUploader CSV's `*C:Card Number` column holds
 * whatever the lister typed, and for Japanese Neo-era cards that is literally
 * "No. 178"; Last Comp gets a catalogue row whose number is a bare "178".
 *
 * Left in the SEARCH QUERY on purpose — plenty of sellers write "No.178" and
 * eBay's own search is the last thing to start guessing at. It is stripped
 * only where it becomes a REQUIRED MATCH TOKEN, because there it is not a fact
 * about the card at all.
 */
const NUMBERING_PREFIX = /^\s*(?:no|#)\.?\s*/i;

export function stripNumberingPrefix(number) {
  return String(number || "").replace(NUMBERING_PREFIX, "").trim();
}

/**
 * The comp-title tokens for one already-simplified query.
 *
 * nameTokensMatch requires EVERY token, and it matches on a word boundary. A
 * token of "No." compiles to \bNo\.\b, and \b after a full stop demands a word
 * character next — so it matches "No.178" and can never match "No. 178". A
 * comp was surviving on whether its seller typed a space, and 47-85 comps a
 * card were being thrown out as nameMismatch on that alone.
 *
 * Dropping the prefix gives up nothing that identifies the card: the numeral
 * stays a required token and already tolerates leading zeros either way round.
 *
 * "Nr" and "Num" were in the first draft of this and came out again —
 * probe-tokenchange.mjs ran the pattern over 2,132 catalogue cards and "NR" is
 * the SET CODE for Neo Revelation ("Shining Magikarp NR 66"). Dropping a set
 * code is a looser and different change, nothing in the batch ever wrote "Nr",
 * and it bought nothing measured.
 */
export function appNameTokens(simplifiedQuery) {
  return CompFinderPricing.extractNameTokens(simplifiedQuery)
    .filter((t) => !/^(?:no|#)\.?$/i.test(t));
}

/**
 * The engine's defaults, with one policy this app sets for itself.
 *
 * setMismatchExcludeBelowRatio governs splitSetMismatch, which excludes comps
 * that don't name the confirmed set. It fired only when the set-matching comps
 * were a MINORITY — the intent being "trust a confirmed set even when it is
 * outvoted" — with the effect that a confirmed set which WON its vote excluded
 * nothing at all, and a Neo Destiny print sat inside a 4-of-5 Neo Genesis pool
 * and was priced. At 1 the ceiling is gone and the guard acts whichever side
 * of the vote the confirmed comps are on.
 *
 * setMismatchMinKept is untouched and still holds it off a sample too small to
 * price from: a pool of two is not a mandate to exclude, it is a reason to
 * stop claiming a price.
 *
 * This is a setting, not a code change, because recommend() already takes it —
 * which is why nothing in packages/core needed editing for either rule.
 *
 * WHY THE APP AND NOT LAST COMP. The app is handed a set by the lister, on a
 * card they are holding. Last Comp infers one from a search box. Trusting a
 * confirmed set harder is right where the confirmation is a human's; it is a
 * different question where it is a guess, and it should be measured there
 * separately rather than inherited from here.
 */
export const APP_SETTINGS = {
  ...CompFinderPricing.DEFAULT_SETTINGS,
  setMismatchExcludeBelowRatio: 1
};

/**
 * Postage that no UK seller charges to post one card.
 *
 * Measured against a live ebay.co.uk search for Sunkern No. 191 (2026-08-25):
 * every UK listing was free delivery, £0.99 or £1.00, with a single £5.00
 * outlier. The comps the batch priced from carried £8.39 to £14.17. That is
 * not a UK-domestic sale, whatever eBay's itemLocation field says — and on
 * these cards it says nothing, because the field is null for domestic items
 * and null is also what a missing value looks like.
 */
const FOREIGN_POSTAGE_PENCE = 600;

/**
 * Drops the postage from comps that are not UK sales.
 *
 * freePostage adds the buyer's postage to the seller's price, and that is
 * right: a £2 card posted for £1.35 did cost somebody £3.35. It stops being
 * right the moment the postage is somebody's international shipping. Measured
 * across the 2026-08-25 Neo-era batch, 74-82% of each recommended price WAS
 * the postage — the cards themselves comped at £1.16 to £4.37, which is what
 * a Japanese Neo common is worth, and £8 to £14 of shipping was being read as
 * card value on top.
 *
 * The comp is kept and its postage zeroed, rather than the comp excluded.
 * Excluding is what splitPostageOutliers already does and it is measurably the
 * wrong shape here: it needs six comps to hold an opinion, it stands down
 * rather than empty a pool where EVERY comp is foreign, and these pools are
 * thin enough already. The sale still happened and the card still went for
 * £2.20; only the shipping is not evidence about the UK market.
 *
 * BOTH conditions have to hold. £8 of tracked, signed postage on an £800 card
 * is a real UK cost and the second clause is what keeps this off it — postage
 * is only ever material relative to a cheap card, which is exactly where this
 * fires.
 */
export function dropForeignPostage(comps) {
  let changed = 0;
  const out = (comps || []).map((c) => {
    const postage = c.postagePence || 0;
    if (postage > FOREIGN_POSTAGE_PENCE && postage > (c.itemPricePence || 0)) {
      changed++;
      return { ...c, postagePence: 0, postageDropped: postage };
    }
    return c;
  });
  return { comps: out, changed };
}

/**
 * The fewest sold comps that may become a price.
 *
 * Across the 2026-08-25 batch, 37% of prices came from two comps or fewer and
 * those skewed HIGH — median £15.49 against £9.99 for the prices built from
 * four or more. Thinner pool, bigger number, because with two comps nothing
 * absorbs a bad one and every downstream guard is below its own minimum.
 *
 * Sunkern No. 191 is the case to remember: one sold comp at £19.36 became a
 * £19.49 recommendation, while twelve live UK listings for the same card sat
 * at £1.99 to £2.24. A number you have to know to distrust is worse than no
 * number — the same reasoning that HOLDS a thin price back from a show
 * sticker rather than printing it.
 */
export const MIN_SOLD_COMPS_TO_PRICE = 3;

export function tooThinToPrice(rec) {
  return !!rec && rec.dataSource === "sold" && (rec.included || []).length > 0
    && rec.included.length < MIN_SOLD_COMPS_TO_PRICE;
}

export default {
  APP_SETTINGS, appNameTokens, stripNumberingPrefix,
  dropForeignPostage, tooThinToPrice, MIN_SOLD_COMPS_TO_PRICE
};
