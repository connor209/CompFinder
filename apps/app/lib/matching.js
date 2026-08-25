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

export default { APP_SETTINGS, appNameTokens, stripNumberingPrefix };
