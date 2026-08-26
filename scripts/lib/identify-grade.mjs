/**
 * Scoring a photo read against the card that was actually in front of the
 * camera. See docs/CARD_IMAGE_RECOGNITION.md for why this is stage 0.
 *
 * THE GRADER IS DELIBERATELY STRICT, AND ERRS TOWARD MARKING A READ WRONG.
 * It would be easy to write one that shrugs at "Charizard" for "Charizard ex",
 * and it would report a number several points better than the truth — but
 * those are two cards at two prices, and the whole point of measuring is to
 * find out whether the scan can be trusted with money. A grader that flatters
 * the model is worse than no grader, because it ends an investigation.
 *
 * The number normaliser is card-images.mjs's, not a second one. That file
 * already had to decide that 060 and 60 are one card and SV1 and SV10 are not,
 * and a second answer to the same question is a bug waiting for the day the
 * two disagree.
 */
import { nameKey, numKey, norm, withinOneEdit } from "./card-images.mjs";

/**
 * Per-MTok list prices, cached 2026-06. Only used to print what a run cost, so
 * being a month stale costs nothing but a rounding error; the live table is at
 * https://www.anthropic.com/pricing.
 */
export const MODEL_PRICES = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-fable-5": { in: 10, out: 50 }
};

/** Dollars for one read, or null if we don't have a price for that model. */
export function costOf(usage, model) {
  const p = MODEL_PRICES[String(model || "").replace(/-\d{8}$/, "")];
  if (!p || !usage) return null;
  return ((usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out) / 1e6;
}

/**
 * The numerator alone — "215/203" -> "215".
 *
 * The numerator is what the engine matches comps on; the denominator is a
 * weaker signal about the set that sellers often get wrong or leave off. So
 * they are scored apart: a read of "215" for a card printed 215/203 is a
 * complete answer as far as pricing is concerned.
 */
export function numeratorOf(n) {
  const first = String(n || "").split("/")[0];
  return numKey(first.trim());
}

/** Both halves, when both sides carry one. */
export function fullNumberOf(n) {
  const parts = String(n || "").split("/");
  if (parts.length < 2) return null;
  return `${numKey(parts[0].trim())}/${numKey(parts[1].trim())}`;
}

export function numbersAgree(read, truth) {
  const a = numeratorOf(read);
  const b = numeratorOf(truth);
  if (!a || !b) return { numerator: false, exact: false };
  const numerator = a === b;
  const fa = fullNumberOf(read);
  const fb = fullNumberOf(truth);
  // "Exact" means the read carries everything the card does. Where the card
  // has a denominator, a read without one is not exact — that is the whole
  // difference between Charizard ex 223/165 and 223/197. Where the card has
  // none (a promo numbered SWSH001), the numerator is the whole number and a
  // matching read is exact.
  return { numerator, exact: numerator && (fb == null || (fa != null && fa === fb)) };
}

/**
 * Names, strictly.
 *
 * nameKey() does the work that should be forgiven — Nidoran♂ against
 * "Nidoran [M]", "Dialga Lv.68" against "Dialga", the delta symbol written
 * twice — and nothing beyond that is forgiven here. In particular this does
 * NOT use card-images.mjs's nameAgrees(): that one accepts our side carrying
 * a variant suffix theirs omits, which is right when set and number have
 * already identified the card and wrong here, where the suffix IS the
 * identification. Charizard and Charizard ex must not grade as the same read.
 */
export function namesAgree(read, truth) {
  const a = nameKey(read);
  const b = nameKey(truth);
  return !!a && !!b && a === b;
}

/** A wrong name that is one letter out — a typo, not a different Pokémon. */
export function nameIsNear(read, truth) {
  const a = nameKey(read);
  const b = nameKey(truth);
  if (!a || !b || a === b) return false;
  // A one-edit tolerance on a short name is not a typo allowance, it's a
  // different card: "Ho-Oh" and "Hooh", fine, but "Mew" and "Mewtwo" is not
  // one edit and "Eevee"/"Eevee V" would be. Same length floor as the
  // catalogue's own name guard.
  if (a.length < 5 || b.length < 5) return false;
  // One name extending the other is never a typo — it is a variant suffix,
  // and "Eevee" against "Eevee V" is exactly the one-character difference this
  // would otherwise excuse. Same rule the catalogue's name guard uses.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.startsWith(short) || long.endsWith(short)) return false;
  return withinOneEdit(a, b);
}

/**
 * Sets, leniently, and only ever as a reported extra.
 *
 * The set is not what a comp is matched on and a seller rarely writes it in
 * full, so "Evolving Skies" against "Sword & Shield Evolving Skies" is a hit.
 * It is worth counting because the set is what would narrow an art-embedding
 * search later — see the doc — not because a price depends on it.
 */
export function setsAgree(read, truth) {
  const a = norm(read);
  const b = norm(truth);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export const OUTCOMES = ["right", "name-only", "wrong", "abstained", "error"];

/**
 * One photo, scored.
 *
 * `read` is the object lib/identify.js returned (or null if the call failed),
 * `truth` is the corpus row. The four outcomes are the whole point of the
 * exercise, and they are not a scale from good to bad — they are three
 * different things, and the ordering that matters is by COST:
 *
 *   right      the query would have priced the card in the photo.
 *   name-only  no number read, so the search pools every printing of the card
 *              and reports a number with a wide span. Visible on the page as a
 *              caveat, recoverable by the user, but not an answer.
 *   abstained  it said it couldn't read a card. Costs a re-scan and nothing
 *              else. The SAFE failure, and a model that abstains more and is
 *              wrong less is a better model for this job even if its headline
 *              accuracy is lower.
 *   wrong      a clean, confident query for a DIFFERENT card. The scan panel
 *              prices it and shows a figure, and nothing anywhere says it is
 *              the wrong card. This is the number to minimise, and the reason
 *              a raw accuracy percentage is not enough to decide anything.
 */
export function gradeRead(read, truth) {
  const decoy = truth.expect === "abstain";
  const row = {
    file: truth.file,
    want: decoy ? "(no card — should abstain)" : `${truth.name} ${truth.number}${truth.set ? ` (${truth.set})` : ""}`,
    got: null,
    outcome: "error",
    name: false,
    nameNear: false,
    numerator: false,
    exactNumber: false,
    set: false,
    notes: ""
  };
  if (!read) return row;

  row.got = [read.name, read.number, read.set].filter(Boolean).join(" ") || "(nothing)";
  row.notes = read.notes || "";

  // A decoy row is a photo with no card in it — a hand, a table, a sealed
  // pack, a frame taken while the camera was still moving. It is in the
  // corpus because the panel prices whatever comes back: an invented card
  // from an empty frame is priced and shown like any other, so "does it know
  // when to say no" is a measurement, not a nicety. There is nothing to score
  // it on but the refusal.
  if (decoy) {
    row.outcome = read.identified === false ? "abstained" : "wrong";
    return row;
  }

  row.name = namesAgree(read.name, truth.name);
  row.nameNear = !row.name && nameIsNear(read.name, truth.name);
  row.set = setsAgree(read.set, truth.set);
  const num = numbersAgree(read.number, truth.number);
  row.numerator = num.numerator;
  row.exactNumber = num.exact;

  if (read.identified === false) {
    row.outcome = "abstained";
    return row;
  }
  if (!numeratorOf(read.number)) {
    row.outcome = row.name ? "name-only" : "wrong";
    return row;
  }
  row.outcome = row.numerator && row.name ? "right" : "wrong";
  return row;
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

/** Counts, rates and money for a whole run. */
export function summarise(rows, { costs = [] } = {}) {
  const n = rows.length;
  const count = (o) => rows.filter((r) => r.outcome === o).length;
  const totals = Object.fromEntries(OUTCOMES.map((o) => [o, count(o)]));
  const priced = totals.right + totals["name-only"] + totals.wrong; // reads that reach a price
  const knownCost = costs.filter((c) => c != null);
  return {
    n,
    ...totals,
    // Of the scans that produce a price at all, how many price the wrong card.
    // The headline: this is the rate at which the tool lies to somebody about
    // to hand over cash, and it is what any later model has to beat.
    wrongWhenPriced: priced ? totals.wrong / priced : 0,
    nameRate: n ? rows.filter((r) => r.name).length / n : 0,
    numberRate: n ? rows.filter((r) => r.numerator).length / n : 0,
    exactNumberRate: n ? rows.filter((r) => r.exactNumber).length / n : 0,
    setRate: n ? rows.filter((r) => r.set).length / n : 0,
    typos: rows.filter((r) => r.nameNear).length,
    costUsd: knownCost.length ? knownCost.reduce((a, b) => a + b, 0) : null,
    costKnownFor: knownCost.length
  };
}

/** The summary as the lines a run prints. */
export function summaryLines(s) {
  return [
    `  photos              ${s.n}`,
    `  right               ${s.right} (${pct(s.right, s.n)})   would have priced the card in the photo`,
    `  name-only           ${s["name-only"]} (${pct(s["name-only"], s.n)})   no number: pools every printing`,
    `  abstained           ${s.abstained} (${pct(s.abstained, s.n)})   said it couldn't read one — costs a re-scan`,
    `  WRONG               ${s.wrong} (${pct(s.wrong, s.n)})   a confident price for a different card`,
    `  errors              ${s.error}`,
    "",
    `  wrong when it priced anything at all   ${(s.wrongWhenPriced * 100).toFixed(1)}%`,
    `  name read correctly                    ${pct(Math.round(s.nameRate * s.n), s.n)}${s.typos ? `  (${s.typos} of the misses are one letter out)` : ""}`,
    `  numerator read correctly               ${pct(Math.round(s.numberRate * s.n), s.n)}`,
    `  full number, both halves               ${pct(Math.round(s.exactNumberRate * s.n), s.n)}`,
    `  set named correctly                    ${pct(Math.round(s.setRate * s.n), s.n)}`,
    s.costUsd == null
      ? `  cost                                   ${s.n === s.error ? "nothing ran" : "unknown — no price on file for that model"}`
      : `  cost                                   $${s.costUsd.toFixed(4)} for ${s.costKnownFor} read(s)`
  ];
}
