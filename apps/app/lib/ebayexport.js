/**
 * Comp Finder — turn a priced batch back into an eBay upload file.
 *
 * A CardUploader export is already eBay's File Exchange format: it carries
 * `*Title`, `CustomLabel` (the SKU), `*StartPrice` and the item specifics eBay
 * expects. So the safest possible export is not to build a new file at all —
 * it's to take the original file, change nothing except `*StartPrice`, and
 * hand it back. Every column CardUploader set, every item specific, every
 * category stays exactly as it was.
 *
 * Rows are matched on `CustomLabel`, never on row order: results get filtered
 * and re-sorted in the UI, and a price landing on the wrong row would list the
 * wrong card at the wrong money.
 */
import CardUploaderCsv from "./carduploader.js";
import { effectivePence } from "./price-override.js";

const PRICE_COL = "*StartPrice";
const SKU_COL = "CustomLabel";

/** Quote a field only when it needs it — eBay accepts both, diffs read better. */
function csvField(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Rewrite `csvText`'s prices from `priced` — a Map (or plain object) of
 * SKU -> price in pence.
 *
 * Returns { csv, updated, missing, skipped }:
 *   updated  rows whose price was replaced
 *   missing  SKUs we had a price for that aren't in the file
 *   skipped  rows in the file we had no price for (left at their original price)
 */
export function repriceCardUploaderCsv(csvText, priced) {
  const priceOf = (sku) => {
    if (!sku) return null;
    const v = priced instanceof Map ? priced.get(sku) : priced?.[sku];
    return v == null ? null : Number(v);
  };

  const rows = CardUploaderCsv.parseCsv(csvText || "");
  if (rows.length < 2) throw new Error("That doesn't look like a CardUploader CSV — no data rows found.");

  const header = rows[0];
  const priceAt = header.indexOf(PRICE_COL);
  const skuAt = header.indexOf(SKU_COL);
  if (priceAt === -1) throw new Error(`The CSV has no ${PRICE_COL} column, so there's nothing to reprice.`);
  if (skuAt === -1) throw new Error(`The CSV has no ${SKU_COL} column, so rows can't be matched safely.`);

  const seen = new Set();
  let updated = 0;
  let skipped = 0;
  const out = [header.map(csvField).join(",")];

  for (const row of rows.slice(1)) {
    const cells = header.map((_, i) => (row[i] === undefined ? "" : row[i]));
    const sku = cells[skuAt];
    if (sku) seen.add(sku);
    const pence = priceOf(sku);
    if (pence != null && pence > 0) {
      cells[priceAt] = (pence / 100).toFixed(2);
      updated++;
    } else {
      skipped++;
    }
    out.push(cells.map(csvField).join(","));
  }

  const allSkus = priced instanceof Map ? [...priced.keys()] : Object.keys(priced || {});
  const missing = allSkus.filter((s) => s && !seen.has(s));

  // CRLF: File Exchange is specified on CRLF, and Windows Excel round-trips it
  // without adding blank lines.
  return { csv: out.join("\r\n") + "\r\n", updated, missing, skipped };
}

/**
 * The prices from a finished batch, as SKU -> pence. Rows without a SKU or
 * without a recommendation are left out — an unpriced row must keep whatever
 * price it already had rather than going up at nothing.
 *
 * `effectivePence`, not `finalPence`: this file is what actually reprices the
 * listings, so a row you overrode has to go up at YOUR number. Reading the
 * recommendation here would list the card at the price you rejected, which is
 * the one failure an override exists to prevent — check-override.mjs greps
 * for it.
 */
export function pricedSkuMap(results) {
  const map = new Map();
  for (const r of results || []) {
    if (!r?.sku) continue;
    const pence = effectivePence(r?.rec);
    if (pence == null || !(pence > 0)) continue;
    map.set(r.sku, pence);
  }
  return map;
}
