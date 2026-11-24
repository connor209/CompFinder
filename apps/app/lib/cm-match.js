/**
 * A card of ours → its Cardmarket product → Cardmarket's price guide, in
 * pounds. Pure: the route (/api/cardmarket/prices) does the reads.
 *
 * CardUploader writes Cardmarket's own names — "Pokemon Card 151", "Shiny
 * Treasure ex", "Geodude (Master Ball Pattern)" — so the match is the SET
 * NAME exactly (the catalogue's `expansion`), then the collector number,
 * with the card's NAME deciding between products that share a number (the
 * plain Geodude and its Master Ball and Poké Ball patterns are three products
 * at 074). A card that cannot be pinned to one product gets no figure and
 * says why: a Cardmarket price for the wrong product is worse than none.
 *
 * Shown beside eBay's figures, never priced from: nothing here reaches
 * house-pricing.js. Using it in a price waits on measuring how far apart the
 * two markets sit (the plan agreed 2026-11-24).
 */

const plain = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** A collector number as the catalogue keeps it: numerator only, letter prefix kept, zeros off ("074/165" → "74", "TG05" → "TG5"). */
export function normNumber(n) {
  const head = String(n || "").split("/")[0].trim().replace(/^[A-Za-z]{2,4}\s+(?=\d)/, (m) => m.trim());
  const m = head.match(/^([A-Za-z-]*?)\s*0*(\d+)([A-Za-z]?)$/);
  if (!m) return head.toUpperCase().replace(/\s+/g, "");
  return `${m[1].toUpperCase().replace(/-/g, "")}${Number(m[2])}${m[3].toLowerCase()}`;
}

/** A name for comparing: accents and punctuation off, case folded. */
export function normName(s) {
  return plain(s).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The name without a bracketed aside: "Geodude (Master Ball Pattern)" → "geodude". */
const baseOf = (s) => normName(String(s || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " "));

/**
 * The catalogue row for a card, from the rows of its set. Returns
 * { row } or { row: null, why }.
 */
export function matchCatalog(card, setRows) {
  const set = normName(card.set);
  const inSet = (setRows || []).filter((r) => normName(r.expansion) === set);
  if (!inSet.length) return { row: null, why: "set not in the catalogue" };
  const num = normNumber(card.number);
  if (!num || !/\d/.test(num)) {
    // No number: only an exact name, once in the set, will do.
    const byName = inSet.filter((r) => normName(r.name) === normName(card.name));
    return byName.length === 1 ? { row: byName[0] } : { row: null, why: byName.length ? "several products share that name" : "no number, and no product of that name" };
  }
  const sameNumber = inSet.filter((r) => normNumber(r.collector_number) === num);
  if (!sameNumber.length) return { row: null, why: "no product with that number in the set" };
  if (sameNumber.length === 1) {
    // One product at the number: the name has still to be the same card.
    const r = sameNumber[0];
    return baseOf(r.name) === baseOf(card.name) || normName(r.name).startsWith(baseOf(card.name)) || baseOf(card.name).startsWith(baseOf(r.name))
      ? { row: r } : { row: null, why: `number matches ${r.name}, not this card` };
  }
  const exact = sameNumber.filter((r) => normName(r.name) === normName(card.name));
  if (exact.length === 1) return { row: exact[0] };
  // Several products at the number (a plain card and its patterns): the one
  // whose name carries no bracket is the plain card, when ours has none either.
  if (!/[([]/.test(String(card.name || ""))) {
    const plainOnes = sameNumber.filter((r) => !/[([]/.test(String(r.name || "")) && baseOf(r.name) === baseOf(card.name));
    if (plainOnes.length === 1) return { row: plainOnes[0] };
  }
  return { row: null, why: "several products share that number" };
}

/** Whether we hold the card's reverse holo — Cardmarket prices that apart, in its "holo" figures. */
export function isReverse(card) {
  return /\brev(?:erse)?\b[\s.-]*(?:holo|foil)/i.test(`${card.finish || ""} ${card.title || ""} ${card.name || ""}`);
}

const toPence = (eur, rate) => (eur == null || !(Number(eur) > 0) ? null : Math.round(Number(eur) * rate * 100));

/**
 * The figures to show, from a cm_price_latest row: trend, 7 and 30-day
 * averages and the low, in pounds (pence) at `rate`, with the euro trend kept
 * alongside. A reverse holo reads the premium figures. `dir` compares the
 * 7-day average with the 30-day one: "up" 10% above, "down" 10% below.
 */
export function cmFigures(price, { reverse = false, rate = 0.85 } = {}) {
  if (!price) return null;
  const p = reverse
    ? { trend: price.p_trend, avg7: price.p_avg7, avg30: price.p_avg30, low: price.p_low }
    : { trend: price.trend, avg7: price.avg7, avg30: price.avg30, low: price.low };
  if (p.trend == null && p.avg30 == null) return null;
  const a7 = Number(p.avg7) || null;
  const a30 = Number(p.avg30) || null;
  const dir = a7 && a30 ? (a7 > a30 * 1.1 ? "up" : a7 < a30 * 0.9 ? "down" : "flat") : null;
  return {
    pence: toPence(p.trend ?? p.avg30, rate),
    avg7Pence: toPence(p.avg7, rate),
    avg30Pence: toPence(p.avg30, rate),
    lowPence: toPence(p.low, rate),
    eurTrend: p.trend != null ? Number(p.trend) : null,
    reverse,
    dir,
    asOf: price.as_of || null
  };
}
