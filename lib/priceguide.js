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

/** Suffixes seen in the wild, in the order we'd prefer them. */
const PREMIUM_SUFFIXES = ["foil", "holo", "reverse", "reverseholo", "special"];

/** Work out which premium naming a payload uses, e.g. "holo" from `avg-holo`. */
export function detectPremiumKind(rows) {
  for (const r of rows || []) {
    for (const s of PREMIUM_SUFFIXES) if (`trend-${s}` in r || `avg-${s}` in r) return s;
    // Only need one row — every row in a file shares its shape.
    break;
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

/** Is this card worth keeping a daily price history for? */
export function worthTracking(row, threshold = 1) {
  const v = marketPrice(row) ?? 0;
  const pv = marketPrice(row, { premium: true }) ?? 0;
  return Math.max(v, pv) >= threshold;
}
