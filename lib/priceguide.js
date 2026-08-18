/**
 * Cardmarket price guide — parse the daily JSON they publish per game.
 *
 * Shape (verified against real Pokémon and Riftbound files):
 *   { version, createdAt, priceGuides: [ { idProduct, idCategory,
 *       avg, low, trend, avg1, avg7, avg30, <premium fields> } ] }
 *
 * The premium (non-plain) variant is named PER GAME — Pokémon publishes
 * `avg-holo`/`trend-holo`/…, Riftbound and Magic publish `avg-foil`/… — so the
 * suffix is detected from the payload rather than hard-coded, and normalised
 * to one set of `p*` columns with `premiumKind` recording which it was.
 *
 * `idProduct` is Cardmarket's product id, which is exactly what `card_catalog`
 * is keyed on: every one of our 72,534 Pokémon and 1,437 Riftbound cards
 * matched a price row, so this joins with nothing left over.
 */

/**
 * Work out which premium naming a payload uses — "holo" from `avg-holo`,
 * "foil" from `avg-foil`. Read off the keys rather than matched against a
 * fixed list, so a game that names its premium something we haven't seen still
 * gets captured instead of silently dropping to null.
 */
export function detectPremiumKind(rows) {
  const first = (rows || [])[0]; // every row in a file shares its shape
  if (!first) return null;
  for (const key of Object.keys(first)) {
    const m = /^trend-(.+)$/.exec(key) || /^avg-(.+)$/.exec(key);
    if (m) return m[1];
  }
  return null;
}

/** Cardmarket writes missing prices as null; keep them null rather than 0. */
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise one payload into rows ready for `cm_price_latest`.
 * `asOf` is the guide's own date, so a late-running job still files the
 * numbers under the day they were published.
 */
export function parsePriceGuide(json, { game, asOf } = {}) {
  const rows = Array.isArray(json?.priceGuides) ? json.priceGuides : [];
  const premiumKind = detectPremiumKind(rows);
  const p = (r, field) => (premiumKind ? num(r[`${field}-${premiumKind}`]) : null);
  const date = asOf || (json?.createdAt ? String(json.createdAt).slice(0, 10) : null);

  const out = [];
  for (const r of rows) {
    const id = Number(r?.idProduct);
    if (!Number.isFinite(id)) continue;
    out.push({
      cardmarket_id: id,
      game: game || null,
      id_category: Number.isFinite(Number(r.idCategory)) ? Number(r.idCategory) : null,
      as_of: date,
      avg: num(r.avg), low: num(r.low), trend: num(r.trend),
      avg1: num(r.avg1), avg7: num(r.avg7), avg30: num(r.avg30),
      premium_kind: premiumKind,
      p_avg: p(r, "avg"), p_low: p(r, "low"), p_trend: p(r, "trend"),
      p_avg1: p(r, "avg1"), p_avg7: p(r, "avg7"), p_avg30: p(r, "avg30")
    });
  }
  return { rows: out, premiumKind, createdAt: json?.createdAt || null, asOf: date, count: out.length };
}

/**
 * The number to actually price against. Trend is Cardmarket's own smoothed
 * figure and the closest thing to "what it's worth today"; the 7-day average
 * is the steadier fallback, then 30-day, then the plain average. `low` is
 * deliberately last — it's the cheapest listing, not a valuation.
 */
export function marketPrice(row, { premium = false } = {}) {
  if (!row) return null;
  const pick = premium
    ? [row.p_trend, row.p_avg7, row.p_avg30, row.p_avg, row.p_low]
    : [row.trend, row.avg7, row.avg30, row.avg, row.low];
  for (const v of pick) if (v != null && v > 0) return Number(v);
  return null;
}

/**
 * A suggested sell price: the market figure nudged by a margin, floored so
 * bulk never lists below what it costs to post, and rounded to a tidy number.
 */
export function suggestPrice(row, { premium = false, marginPct = 0, floor = 0.02, round = "0.05" } = {}) {
  const base = marketPrice(row, { premium });
  if (base == null) return null;
  const withMargin = base * (1 + (Number(marginPct) || 0) / 100);
  const step = Number(round) || 0.01;
  const rounded = Math.round(withMargin / step) * step;
  return Math.max(Number(floor) || 0, Number(rounded.toFixed(2)));
}

/**
 * What Cardmarket's premium series actually is, per game. Pokémon's `-holo`
 * fields are its **reverse holo** printing, not "holo rare"; the foil games
 * are simply foil. Worth being explicit — "Holo" on a column header reads as
 * "the holo version of this card", which is not what the number is.
 */
export const PREMIUM_LABELS = {
  holo: { short: "Rev. holo", long: "Cardmarket’s reverse-holo price" },
  foil: { short: "Foil", long: "Cardmarket’s foil price" }
};
export function premiumLabel(kind, key = "short") {
  if (!kind) return key === "short" ? "Premium" : "Cardmarket’s premium price";
  const known = PREMIUM_LABELS[kind];
  if (known) return known[key];
  const title = kind.charAt(0).toUpperCase() + kind.slice(1);
  return key === "short" ? title : `Cardmarket’s ${kind} price`;
}

/**
 * Sanity-check one price series against its own neighbours.
 *
 * Cardmarket's trend is derived from completed sales, and a single product can
 * carry sales of things that aren't the plain raw card — graded slabs above
 * all — so trend sometimes sits an order of magnitude away from both the
 * cheapest listing and the 30-day average. That isn't an error on our side,
 * but it's worth marking so a wild number isn't read as a valuation.
 *
 * Returns null when the numbers hang together, or { reasons, low, avg30 }.
 */
export function priceWarning({ trend, avg7, avg30, low } = {}) {
  const n = (v) => (v == null || !(Number(v) > 0) ? null : Number(v));
  const t = n(trend) ?? n(avg7);
  if (t == null) return null;
  const lo = n(low);
  const m30 = n(avg30);
  const reasons = [];
  if (lo != null && t > lo * 10) reasons.push(`trend is ${Math.round(t / lo)}× the cheapest listing (£${lo.toFixed(2)})`);
  if (m30 != null && t > m30 * 5) reasons.push(`trend is ${Math.round(t / m30)}× the 30-day average (£${m30.toFixed(2)})`);
  if (m30 != null && t * 5 < m30) reasons.push(`trend is far below the 30-day average (£${m30.toFixed(2)})`);
  return reasons.length ? { reasons, low: lo, avg30: m30 } : null;
}

/** Is this card worth keeping a daily price history for? */
export function worthTracking(row, threshold = 1) {
  const v = marketPrice(row) ?? 0;
  const pv = marketPrice(row, { premium: true }) ?? 0;
  return Math.max(v, pv) >= threshold;
}
