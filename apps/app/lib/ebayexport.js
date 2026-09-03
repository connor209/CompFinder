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
import { exportPence } from "./zero-price.js";

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
 * Returns { csv, updated, zeroed, missing, skipped }:
 *   updated  rows given a real price
 *   zeroed   rows that were IN the run and came back without a price — written
 *            as 0.00 rather than left at whatever the file already said
 *   missing  SKUs we had a price for that aren't in the file
 *   skipped  rows the run never saw at all (left at their original price)
 *
 * The zero is the correction to the fault this whole path had. A row the run
 * could not price used to be left alone, which sounds conservative and is not:
 * a CardUploader file arrives with a placeholder price on every row, £2.49 as
 * often as not, so "left at its original price" meant a card nothing had
 * checked went up at £2.49 looking exactly like a card the engine had priced
 * at the floor. 0.00 cannot be mistaken for a price and eBay will not list at
 * it. A row the run never saw is a different thing and still keeps what it
 * had — the run has no opinion about a card that wasn't in it.
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
  let zeroed = 0;
  let skipped = 0;
  const out = [header.map(csvField).join(",")];

  for (const row of rows.slice(1)) {
    const cells = header.map((_, i) => (row[i] === undefined ? "" : row[i]));
    const sku = cells[skuAt];
    if (sku) seen.add(sku);
    const pence = priceOf(sku);
    if (pence == null) {
      skipped++;
    } else if (pence > 0) {
      cells[priceAt] = (pence / 100).toFixed(2);
      updated++;
    } else {
      cells[priceAt] = "0.00";
      zeroed++;
    }
    out.push(cells.map(csvField).join(","));
  }

  const allSkus = priced instanceof Map ? [...priced.keys()] : Object.keys(priced || {});
  const missing = allSkus.filter((s) => s && !seen.has(s));

  // CRLF: File Exchange is specified on CRLF, and Windows Excel round-trips it
  // without adding blank lines.
  return { csv: out.join("\r\n") + "\r\n", updated, zeroed, missing, skipped };
}

/**
 * The prices from a finished batch, as SKU -> pence. Rows without a SKU are
 * left out; a row the run priced at nothing is IN, at zero, because the run
 * does have something to say about it — that nothing checked it — and the
 * whole cost of the old behaviour was that saying nothing looked identical to
 * a card the engine had priced at the floor.
 *
 * `exportPence`, which reads `effectivePence` and writes zero where there is
 * no price: this file is what actually reprices the listings, so a row you
 * overrode has to go up at YOUR number. Reading the recommendation here would
 * list the card at the price you rejected, which is the one failure an
 * override exists to prevent — check-override.mjs greps for it.
 *
 * A zero must never reach eBay, and this is not the place that stops it —
 * `exportGuard()` in zero-price.js refuses the download while any row is at
 * zero. Two layers on purpose: the guard is what a person meets, and the zero
 * in the file is what is left if a guard is ever bypassed.
 */
export function pricedSkuMap(results) {
  const map = new Map();
  for (const r of results || []) {
    if (!r?.sku) continue;
    map.set(r.sku, exportPence(r?.rec));
  }
  return map;
}
