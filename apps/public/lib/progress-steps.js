/**
 * What the loading screen says while a cold card is being priced.
 *
 * Two things this is deliberately NOT.
 *
 * It is not a percentage. The cold path has exactly two moments the browser
 * can observe — the resolver returns, then the sold set lands — and between
 * them sits one await on /api/price with nothing streaming out of it. A bar
 * creeping to 80% would be inventing the 80%, and a site whose whole pitch is
 * that it shows its working has no business faking the one number it could
 * have checked. So the bar is indeterminate (it claims only "something is
 * happening") and the WORDS carry the progress.
 *
 * And it is not filler. Six seconds of undivided attention is the only place
 * on the site where we can say why this number differs from a scraped price
 * guide's, so every line below is a real stage that really happens, in the
 * order it happens: resolve the card, fetch the window, drop the junk comps,
 * weight what's left. Silly, but true.
 *
 * The last line HOLDS rather than cycling. A card that takes twenty seconds
 * should look like it is still working, not like it has looped.
 */

/** Long enough to read, short enough that all four show inside a cold fetch. */
export const STEP_MS = 1600;

/** Stage one: before the resolver has answered. Often skipped — a card picked
 *  from the dropdown arrives already resolved and starts at "pricing". */
export const RESOLVING = "Finding the card…";

/**
 * Stage two, in order. The window is INTERPOLATED, never written out: the
 * visitor can ask for 30 days, and a line promising 90 while the page counts
 * 30 is the same class of mistake as the hardcoded fee caption the workings
 * screen shipped once.
 */
export function pricingSteps(days) {
  return [
    `Rummaging through ${days} days of eBay…`,
    "Binning the bundles and job lots…",
    "Ignoring the graded slabs…",
    "Working out what it's actually worth…"
  ];
}

/** The line to show, given the real stage and how long we've been in it. */
export function stepFor(stage, days, elapsedMs) {
  if (stage !== "pricing") return RESOLVING;
  const steps = pricingSteps(days);
  const i = Math.floor(Math.max(0, elapsedMs) / STEP_MS);
  return steps[Math.min(i, steps.length - 1)];
}

export default { STEP_MS, RESOLVING, pricingSteps, stepFor };
