/**
 * A priced recommendation cut down to what is worth keeping: the figures, the
 * note, and every comp — counted or excluded, with why — slimmed to the
 * fields the rules read. Used by price feedback (lib/price-feedback.js), so a
 * 👍 / 👎 carries the evidence behind the price it judged.
 *
 * Moved out of batch-store.js when Bulk pricing and its saved runs were
 * removed (2026-11-26); the shape is unchanged, so feedback rows written
 * before and after read the same.
 */

// Characters Postgres will not accept, and eBay listing titles sometimes
// carry. A NUL byte is rejected outright in both text and jsonb
// ("unsupported Unicode escape sequence"), and a lone surrogate — half of a
// character pair, left behind when a title was truncated mid-emoji — is not
// valid UTF-8 on the wire. One of either in one comp used to cost the whole
// run, and an 89-card run holds several thousand scraped titles.
const NEEDS_CLEANING = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/;

export function storableText(value) {
  if (typeof value !== "string") return value ?? null;
  if (!NEEDS_CLEANING.test(value)) return value;
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0 || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      // A complete pair is a real character (an emoji in a seller's title) and
      // is kept; a high surrogate with nothing after it is dropped.
      if (next >= 0xdc00 && next <= 0xdfff) { out += value[i] + value[i + 1]; i += 1; }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += value[i];
  }
  return out;
}

/**
 * One comp, cut down to what the results screen actually reads off it.
 *
 * Everything here is rendered by CompsDetail in Panel.js: the price and
 * postage, the sold date and the listing link (both off `_source`), the
 * seller location, and — for a dropped comp — why it was dropped. A comp
 * carries a good deal more than this from SoldComps, and none of the rest is
 * ever shown, so storing it would multiply the size of a saved run for
 * nothing.
 *
 * Nothing here is optional. A saved run exists to be interrogated, and a comp
 * table missing its exclusion reasons answers the one question the screen is
 * for.
 */
export function slimComp(c) {
  if (!c) return null;
  const out = {
    title: storableText(c.title),
    itemPricePence: c.itemPricePence ?? null,
    postagePence: c.postagePence ?? null,
    totalPence: c.totalPence ?? null,
    itemLocation: storableText(c.itemLocation)
  };
  if (c.exclusionReason) out.exclusionReason = c.exclusionReason;
  // Not rendered, but READ BY THE RULES — so a saved run that drops them can no
  // longer be re-priced to the figure it printed. Measured on the 2026-08-26
  // corpus: without epid/categoryId one card of 85 replayed differently,
  // because splitByCatalogSignal had nothing left to judge. Condition is the
  // same kind of debt in advance: it is what a condition-aware price would be
  // built from, and a corpus without it cannot be used to work one out.
  //
  // Three short fields against a comp that already carries a title and a URL —
  // the size argument above was about the bulk of a SoldComps item, not this.
  if (c.condition) out.condition = c.condition;
  if (c.epid) out.epid = c.epid;
  if (c.categoryId) out.categoryId = c.categoryId;
  // What the postage WAS before dropForeignPostage zeroed it. Without it the
  // postage rule is the one rule a saved run can never be used to re-tune,
  // since the evidence it acted on is gone.
  if (c.postageDropped != null) out.postageDropped = c.postageDropped;
  const url = storableText(c._source?.url);
  const endedAt = c._source?.endedAt ?? null;
  if (url || endedAt) out._source = { url, endedAt };
  return out;
}

/** A recommendation, with every comp it was built from. */
export function slimRec(rec) {
  if (!rec) return null;
  return {
    rawPence: rec.rawPence ?? null,
    finalPence: rec.finalPence ?? null,
    // A price you typed. Stored beside the recommendation rather than in place
    // of it, so re-opening a run shows both — and so a run downloaded as a
    // corpus can still be re-priced against what the ENGINE said, which is the
    // only measurement of whether a rule change helped. See price-override.js.
    overridePence: rec.overridePence ?? null,
    confidence: rec.confidence ?? null,
    dataSource: rec.dataSource ?? null,
    note: storableText(rec.note),
    graded: rec.graded ?? [],
    included: (rec.included || []).map(slimComp),
    excluded: (rec.excluded || []).map(slimComp),
    // Priced by the house rules (lib/house-rec.js): the decision and the
    // engine's own figure, so a re-opened run still says how it was priced.
    ...(rec.house ? { house: rec.house } : {})
  };
}
