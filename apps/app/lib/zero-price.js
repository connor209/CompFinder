/**
 * Comp Finder — a card we could not price is £0.00, and £0.00 stops an export.
 *
 * The failure this file exists to prevent is a quiet one, and it has already
 * cost money. A CardUploader CSV arrives with a placeholder `*StartPrice` on
 * every row — £2.49 is the usual one, the same figure as the engine's floor,
 * which is exactly why nobody looked twice at it. The eBay upload export used
 * to leave a row it had no price for at whatever price the file already
 * carried, so a card SoldComps timed out on, or one whose comps were all
 * excluded, went up at £2.49. On screen it said "Skipped"; in the file it said
 * £2.49; on eBay it said sold. A £40 card can leave the building that way and
 * the only evidence is a row that looked blank on a screen nobody re-read.
 *
 * Two rules, and they only work as a pair:
 *
 * 1. **No price is written as ZERO, not as blank.** A blank reads as "nothing
 *    to say here" and gets skipped over by a person and by a file format
 *    alike. £0.00 is not a cheap card — it is not a price at all, it is
 *    impossible to mistake for one, and eBay itself refuses to list at it. The
 *    poison value is the point.
 *
 * 2. **Nothing that spends money leaves while a zero is in the run.** A zero
 *    that can be exported is just a different wrong number in the file. The
 *    guard is a hard stop rather than a warning, because the whole class of
 *    fault here is a thing that was on screen and did not get read: the run
 *    has to be fixed — price the card by hand, or take it out — before the
 *    file exists at all.
 *
 * The engine is untouched by any of this. `packages/core` still returns
 * `finalPence: null` for a card it cannot price, which is the honest answer
 * and the one the public page needs; the zero is what the APP writes down
 * about that answer, and it lives on this side of the line. `effectivePence()`
 * likewise still returns null — every caller counting priced cards or holding
 * a sticker back depends on that, and a zero leaking into those would read as
 * a card priced at nothing rather than a card not priced.
 *
 * Framework-free and app-import-free, so check-zeroprice.mjs can load it under
 * bare node.
 */
import { effectivePence } from "./price-override.js";

/** What a card with no price is written as. Not a price; a marker. */
export const UNPRICED_PENCE = 0;

/** True when neither the engine nor a human has put a number on this card. */
export function isUnpriced(rec) {
  return effectivePence(rec) == null;
}

/**
 * The number to WRITE for a card — the price where there is one, zero where
 * there is not.
 *
 * Deliberately not `effectivePence()` with a default bolted on at each call
 * site: the difference between "no price" and "zero" is the whole subject of
 * this file, and a caller choosing its own fallback is how one export learns
 * the rule and the next one doesn't.
 */
export function exportPence(rec) {
  return effectivePence(rec) ?? UNPRICED_PENCE;
}

/**
 * Every row in a run that has no price, in the order they appear.
 *
 * Carries the SKU and the title because the guard message names them: "3 cards
 * have no price" sends you hunting through 89 rows, and the hunt is the step
 * that gets skipped.
 */
export function unpricedRows(results) {
  const out = [];
  (results || []).forEach((r, i) => {
    if (!r) return;
    if (!isUnpriced(r.rec)) return;
    out.push({ index: i, sku: r.sku || "", title: r.title || "" });
  });
  return out;
}

/** How many rows to name before the message gets longer than it is useful. */
const NAMED_IN_MESSAGE = 3;

/**
 * May this run leave the building?
 *
 * `{ ok, rows, count, message }` — `message` is prose meant to be shown as the
 * status line, naming the first few cards and what to do, because a refusal
 * that doesn't say which card is a refusal you argue with rather than act on.
 *
 * `what` names the export in the caller's own words ("the eBay upload CSV"),
 * so one guard can speak for several buttons without any of them reading like
 * a generic error.
 */
export function exportGuard(results, what = "This export") {
  const rows = unpricedRows(results);
  if (rows.length === 0) return { ok: true, rows, count: 0, message: "" };

  const named = rows
    .slice(0, NAMED_IN_MESSAGE)
    .map((r) => (r.sku ? `${r.sku} (${r.title})` : r.title || "an untitled row"))
    .join(", ");
  const rest = rows.length - Math.min(rows.length, NAMED_IN_MESSAGE);

  return {
    ok: false,
    rows,
    count: rows.length,
    message:
      `${what} is blocked: ${rows.length} card${rows.length === 1 ? "" : "s"} ` +
      `${rows.length === 1 ? "has" : "have"} no price and ${rows.length === 1 ? "is" : "are"} sitting at £0.00 — ` +
      `${named}${rest > 0 ? `, and ${rest} more` : ""}. ` +
      `A card with no price is one nothing checked, not a cheap one: give each a price by hand, or take it out of the run, then export.`
  };
}

export default {
  UNPRICED_PENCE,
  isUnpriced,
  exportPence,
  unpricedRows,
  exportGuard
};
