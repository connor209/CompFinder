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
import { dropWrongNumerator, dropWrongSetTotal } from "@compfinder/core/cardnumber.js";
import { isOverridden } from "./price-override.js";

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
 * The languages a seller writes in a title. Same list Last Comp uses
 * (apps/public/lib/settings.js), kept in step deliberately — a language it
 * knows and this doesn't would be a silent gap on exactly the cards where the
 * two products disagree.
 */
export const FOREIGN_LANGUAGE = [
  "russian", "italian", "italiano", "french", "française", "francaise",
  "german", "deutsch", "spanish", "español", "espanol",
  "portuguese", "português", "portugues",
  "japanese", "korean", "chinese", "thai", "indonesian"
];

/**
 * Settings for one card, given the text describing it.
 *
 * Ported from Last Comp, which has always excluded foreign-language comps when
 * pricing an English card and which the app had no equivalent of at all. An
 * English Charizard here could pool Japanese comps with nothing stopping it —
 * a different card at a different price, and invisible, because a batch of
 * English cards never shows the warning that would give it away.
 *
 * The two products decide "is this English" from different evidence, and that
 * asymmetry is the whole reason this lives in the app rather than in core.
 * Last Comp reads a catalogue row's language field. The app has only what the
 * lister typed, so a title naming a language IS the card's language and one
 * naming none is taken as English — which is also what the eBay title of an
 * English card looks like.
 *
 * The failure mode is a Japanese card whose title forgot to say so: its comps
 * would be excluded as foreign and the pool would empty. That is caught rather
 * than silent — the pool falls under MIN_SOLD_COMPS_TO_PRICE, the run checks
 * the live market, and the row says how many comps went and why.
 *
 * IS THE CARD ITSELF A SLAB. Same shape, same seam, and the reason neither
 * Panel.js nor QuickSearch.js needed a new argument to carry it: this function
 * is already handed the card's own eBay title, and "PSA 10" is written on it.
 * Without this the engine assumes every card it is asked about is raw and
 * throws away exactly the comps that ARE the card — see the block above
 * classifyExclusion for the £2.49 PSA 10 Umbreon that made it worth fixing.
 */
export function settingsForText(text) {
  const t = String(text || "");
  const subjectGrade = CompFinderPricing.subjectGradeFrom(t);
  const namesALanguage = FOREIGN_LANGUAGE.some((l) => new RegExp(`\\b${l}\\b`, "i").test(t));
  if (namesALanguage) return { ...APP_SETTINGS, subjectGrade };   // not an English card — leave the pool alone
  return {
    ...APP_SETTINGS,
    subjectGrade,
    excludeKeywords: { ...APP_SETTINGS.excludeKeywords, foreignPrint: FOREIGN_LANGUAGE }
  };
}

/**
 * The collector-number guards, applied to a comp pool before it is priced.
 *
 * Also ported from Last Comp, which has run both since it was written and
 * measured dropWrongSetTotal as the thing that stops "223/165" (a 151
 * Charizard, ~£259) pooling with "223/197" (an Obsidian Flames one, ~£96).
 * The app had neither, so the same collision was live on every English card in
 * inventory.
 *
 * Both stand down when the number carries no denominator, which is why they do
 * nothing for the Japanese Neo cards that prompted this week's work — those
 * are numbered "No. 178" with nothing to compare. They earn their place on the
 * English stock instead.
 */
export function applyNumberGuards(comps, cardNumber) {
  if (!cardNumber) return comps || [];
  return dropWrongNumerator(dropWrongSetTotal(comps || [], cardNumber), cardNumber);
}

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

/**
 * Does this title claim near-mint?
 *
 * Measured 2026-08-26 over a downloaded run of 89 cards and 3,163 comps:
 * near-mint sells for 2.06x lightly-played, paired within each card across 29
 * of them. The control is what makes that a finding rather than a number —
 * grouping a card's comps by grade separates them 2.06x while splitting the
 * SAME comps into random halves separates them 1.20x, so the grade is
 * explaining real variance.
 *
 * eBay's own condition field cannot help: across those 3,163 comps it says
 * only "Pre-Owned", "Ungraded" or "New (Other)". The grade is in the title,
 * where 851 of 953 used comps carry one.
 *
 * NEAR-MINT OR NOT is the only split taken, and the reason is in the same
 * measurement. MP and HP had four and five cards and contradicted each other —
 * LP/MP came out at 0.33x, claiming MP sells for three times LP — because the
 * MP pattern over-matches: "Played" appears in titles like "Japanese Played
 * Neo Destiny Old Back" as era wording rather than as a grade. Splitting on it
 * would be acting on a pattern the data says is broken.
 *
 * A title claiming both ("NM / LP", "Near Mint to Lightly Played") is NOT
 * near-mint. A seller hedging across two grades is describing the worse one.
 */
const NEAR_MINT = /\b(nm|near\s*mint|mint|gem\s*mint|pack\s*fresh)\b/i;
const PLAYED = /\b(lp|mp|hp|lightly\s*played|moderately\s*played|heavily\s*played|played|poor|damaged|dmg|creased|whitening|exc(ellent)?|good)\b/i;

export function claimsNearMint(title) {
  const t = String(title || "");
  return NEAR_MINT.test(t) && !PLAYED.test(t);
}

/** Whether a card's own CardUploader grade is near-mint. "Unknown" is not. */
export function cardIsNearMint(condition) {
  return String(condition || "").trim().toUpperCase() === "NM";
}

/**
 * Enough same-grade comps to price from before the preference acts.
 *
 * Four, matching setMismatchMinKept, for its reasoning rather than by
 * coincidence: a stronger signal is worth trusting once there is enough of it,
 * and below that it stays a soft warning instead of acting on a tiny sample.
 */
export const CONDITION_MIN_KEPT = 4;

/**
 * Prefer comps that match the card's own grade.
 *
 * poolConditionsBelowPence pools NM, LP and MP together under £15, which is
 * most of a bulk inventory — so a played card is priced off a pool containing
 * near-mint comps worth twice as much. That is the largest per-card error left
 * after the 2026-08-25 work, and unlike the rest of it, it is measured.
 *
 * Deliberately NOT a multiplier. The comps already contain the answer for this
 * card in this week's market; a 2.06x constant would be that answer frozen at
 * one date across every card, and would need re-measuring to stay true. Using
 * the comps means the rule improves as the data does.
 *
 * An UNGRADED title is kept either way. It cannot be ruled out, and the honest
 * majority is not worth discarding to catch the ambiguous few — the same
 * principle dropWrongNumerator applies to a title with no collector number.
 *
 * Stands down entirely below CONDITION_MIN_KEPT, so a card whose grade is rare
 * in its pool keeps the pool it had rather than being priced off two comps.
 *
 * ⚠ FEED THIS THE COMPS A PRICE WAS BUILT FROM — rec.included — NEVER the raw
 * pool. Condition asks "which of THIS card's sales", which only means anything
 * once identity is settled. Applied to the raw pool it corrupts the identity
 * votes that come after it, and the corpus caught exactly that: Electabuzz No.
 * 125 went from £3.49 to £9.99, because most of the NM-labelled comps it
 * removed were a Pikachu, a Pichu, a Slowking, a Meganium and a Feraligatr —
 * wrong cards that splitSetMismatch had been excluding. Take them out early
 * and the set guard loses its majority, stands down, and lets £20 wrong cards
 * into the price it was there to keep out.
 *
 * Re-pricing from an already-priced set is safe: recurse-batch.mjs's R2 shows
 * the pipeline reaches its fixed point in one pass, so a second call over the
 * survivors settles rather than drifting.
 */
export function applyConditionPreference(comps, cardCondition) {
  const list = comps || [];
  const known = /^(NM|LP|MP|HP|DMG)$/i.test(String(cardCondition || "").trim());
  if (!known || list.length < CONDITION_MIN_KEPT) return { comps: list, dropped: [], reason: null };

  const wantNearMint = cardIsNearMint(cardCondition);
  const mismatched = (c) => (wantNearMint ? PLAYED.test(String(c.title || "")) && !claimsNearMint(c.title) : claimsNearMint(c.title));

  const kept = list.filter((c) => !mismatched(c));
  const dropped = list.filter(mismatched);
  if (!dropped.length || kept.length < CONDITION_MIN_KEPT) return { comps: list, dropped: [], reason: null };
  return {
    comps: kept,
    dropped,
    reason: wantNearMint
      ? `${dropped.length} played comp(s) set aside — this card is near-mint, and near-mint sells for about twice lightly-played`
      : `${dropped.length} near-mint comp(s) set aside — this card is ${String(cardCondition).toUpperCase()}, and near-mint sells for about twice lightly-played`
  };
}

/**
 * Was the condition preference worth what it cost?
 *
 * applyConditionPreference guards the pool it hands over, but every rule after
 * it cuts that pool further — so a card can pass the guard with four comps and
 * still be priced off one. Measured on the 2026-08-26 corpus before this
 * existed: Ledian went to two comps and Zubat to one, and Zubat's price ROSE
 * on a played card, which is the opposite of what the rule is for.
 *
 * So the preference is applied optimistically and kept only if the priced
 * result still stands on enough comps. Trading a broad pool for a thin one is
 * how this week's worst prices happened, and a rule that improves the average
 * card by making a few unpriceable is not an improvement.
 */
export function conditionPreferenceHolds(rec) {
  return !!rec && (rec.included || []).length >= MIN_SOLD_COMPS_TO_PRICE;
}

/**
 * Do the comps disagree about what product this even is?
 *
 * Measured on the 2026-08-25 re-run, once the matching and postage faults were
 * fixed: 71 rows carried no disagreement warning and their median was £2.49,
 * which is right. The 18 rows that warned about themselves had a median of
 * £5.74, and every remaining bad price was one of them. The engine already
 * knew — it printed the blend anyway.
 *
 * Golbat No. 042 is the case: eBay's own catalog split its comps into three
 * products — 15 at £12.99, 6 at £5.08, 3 at £2.60 — and the recommendation
 * was £7.99, which is right for none of them. Same shape as the Yu-Gi-Oh
 * finding in CLAUDE.md, where a confident number built on pooled printings is
 * worse than no answer.
 *
 * The ratio is priceOutlierMultiplier, deliberately NOT a new number. That is
 * the engine's own "this comp is implausibly high" threshold, already measured
 * across 278 cards, and a pool whose cheapest and dearest comps differ by more
 * than a single comp is allowed to differ from the median is not one product.
 * Against this run it separates cleanly: it catches Golbat at 21x, Sunkern at
 * 17x, Farfetch'd at 14x, Zubat at 11x and Magmar at 9x — the five worst
 * remaining prices — and leaves Wooper at 4x, whose £3.49 is plausible.
 */
export function poolDisagrees(rec, settings = APP_SETTINGS) {
  const totals = ((rec && rec.included) || []).map((c) => c.totalPence).filter((t) => t > 0);
  if (totals.length < 2) return false;
  const lo = Math.min(...totals);
  const hi = Math.max(...totals);
  return hi / lo >= settings.priceOutlierMultiplier;
}

/**
 * Above this, a sold price is worth one API call to check against the live
 * market before it goes on a card.
 *
 * Golbat No. 042 is why. Its sold pool looked HEALTHY — four comps, £12.00 to
 * £44.33, a 3.7x span well under the disagreement trigger, four comps well over
 * the minimum, Medium confidence — and it priced at £29.99 on a card whose live
 * UK market is £3.48. Nothing inside the pool could catch that: the cheapest
 * comp in it was £12, so there was no outlier to find and no disagreement to
 * measure. The pool was consistent and simply wasn't the card.
 *
 * Only the live market can see that, which is what makes this an absolute
 * threshold rather than another shape-of-the-data heuristic.
 *
 * Twice the floor. A price at or near £2.49 cannot be wrong in a way that costs
 * anything — you list it, it sells. The money is lost at the top, where a bulk
 * common priced as a chase card sits unsold, so that is where the extra request
 * is worth spending. Measured on the 89-card run it fires on 10 rows.
 */
export const SANITY_CHECK_ABOVE_PENCE = APP_SETTINGS.floorPence * 2;

/**
 * Asking prices run ABOVE sold prices — that is what "asking" means, and the
 * engine already says so on every active-sourced row. So a sold figure well
 * above the live asking market is not a strong card, it is a contradiction:
 * those sales are a different product.
 *
 * The multiple is deliberately loose. A card genuinely on the way up can sell
 * above stale listings, and this must not fire on that. Golbat's sold price was
 * 8.5x its asking market and Sunkern's was 9.7x; nothing legitimate looks like
 * that.
 *
 * NOT corpus-validated — it rests on the market structure above plus those two
 * observed cases. It is the first rule here that isn't measured over a run, and
 * it should be the first re-examined when there is a corpus to do it with.
 */
const ASKING_CONTRADICTION_MULTIPLE = 2;

export function soldContradictsAsking(soldRec, activeRec) {
  const sold = soldRec && soldRec.rawPence;
  const asking = activeRec && activeRec.rawPence;
  if (!sold || !asking) return false;
  return sold > asking * ASKING_CONTRADICTION_MULTIPLE;
}

/** Every reason to spend one more request asking what the card is listed at. */
export function needsActiveCheck(rec, settings = APP_SETTINGS) {
  if (!rec) return false;
  if ((rec.included || []).length < MIN_SOLD_COMPS_TO_PRICE) return true;
  if (poolDisagrees(rec, settings)) return true;
  return rec.finalPence != null && rec.finalPence >= SANITY_CHECK_ABOVE_PENCE;
}

/**
 * Which rows need you, and why.
 *
 * The point of the batch screen is not to price every card perfectly. It is to
 * tell you which prices to look at — you cannot read 89 notes, and being asked
 * to is why the screen felt like work.
 *
 * CALIBRATED against the 2026-08-26 run rather than guessed, and the
 * calibration changed the design. The first draft flagged anything that looked
 * doubtful — thin pools, wide spans, an unconfirmed set, a catalogue split —
 * and flagged 67% of the batch, with the flagged rows' median at £2.99 against
 * £2.49 for the rest. A queue holding two thirds of a run saves nobody
 * anything.
 *
 * Measured signal by signal over that run, the reason is that the app now ACTS
 * on nearly everything that used to warrant a look:
 *
 *   span >= 8x        survives to the results ZERO times — poolDisagrees
 *                     already routes those to the live market or holds them
 *   fewer than 4 comps  flags 17 rows whose median is £2.49, the same as every
 *                     other row: no discriminating power at all
 *   no comp names the set  flags 6 rows, median £2.49 against £2.49 — none
 *                     either, and this is the second time that plausible
 *                     signal has been measured and found to be worth nothing
 *   eBay's catalogue split  never fires: only 341 of 953 used comps carry an
 *                     epid, and just 35 cards have four
 *
 * So what is left is not "suspicious rows". It is the two things the app did
 * that you might disagree with, and neither is a defect:
 *
 *   it could not answer at all, or
 *   it overruled the completed sales with the live market.
 *
 * That is 16 of 89 on this run. Everything else the app is prepared to stand
 * behind, and says so by not asking.
 *
 * NOT the Confidence badge, which is a comp COUNT and points the wrong way: on
 * the 2026-08-25 run the two worst prices in the batch were the two BEST-badged
 * rows. Golbat No. 042 said Medium at £29.99 on a card listed live at £3.48;
 * Misdreavus said High at £10.49 with none of its ten comps naming the set.
 */
export function reviewVerdict(rec) {
  if (!rec) return { needsReview: true, reasons: ["no result for this card"], basis: null };
  // A price you typed IS the look. The queue exists to ask "do you agree with
  // this?", and a row carrying your own number has already been answered — a
  // card left flagged after you priced it by hand makes the count meaningless,
  // which is the one thing that would stop it being read.
  if (isOverridden(rec)) {
    return { needsReview: false, reasons: [], basis: null, overridden: true };
  }
  const reasons = [];

  if (rec.finalPence == null) {
    reasons.push(
      rec.priceHeld
        ? "no price — the evidence didn't support one"
        : "no price was produced"
    );
  }
  // The app took the live market over the completed sales. That is the single
  // largest override it makes — Golbat No. 042 went from £29.99 to £3.49 on it
  // — and it is worth seeing rather than discovering.
  if (rec.soldOverruled) reasons.push("the sold comps were overruled by what it's listed at now");

  return {
    needsReview: reasons.length > 0,
    reasons,
    // Not a fault, so not a reason — but a materially different basis, and the
    // one thing worth being able to filter on separately.
    basis: rec.dataSource === "active" ? "asking prices, not completed sales" : null
  };
}

export default {
  APP_SETTINGS, appNameTokens, stripNumberingPrefix,
  dropForeignPostage, tooThinToPrice, MIN_SOLD_COMPS_TO_PRICE,
  poolDisagrees, needsActiveCheck, soldContradictsAsking, SANITY_CHECK_ABOVE_PENCE,
  settingsForText, applyNumberGuards, FOREIGN_LANGUAGE,
  applyConditionPreference, conditionPreferenceHolds, claimsNearMint, cardIsNearMint, CONDITION_MIN_KEPT,
  reviewVerdict
};
