/**
 * Comp Finder — saving and re-opening a batch run.
 *
 * A run of the Batch screen is expensive: one SoldComps request per card, a
 * couple of seconds each, and until now it lived only in React state. Opening
 * a deep dive navigates to another section, which remounts the panel — so a
 * 59-card run was one click away from being gone, with no way back except
 * paying for all 59 again.
 *
 * This module is the only thing that knows the shape of a saved run. Both
 * places that persist one go through it — the Supabase tables (migration 023)
 * and the sessionStorage copy that survives the remount — because two
 * serialisers would eventually disagree about what a saved run contains, and
 * the failure would be silent: a run that re-opens with its prices but not the
 * comps behind them still looks fine.
 *
 * It takes a Supabase client as an argument rather than importing one, which
 * keeps the file free of app imports so `scripts/check-batchsave.mjs` can load
 * it under bare node and assert the round trip.
 */

/**
 * How long a saved run is kept. A run is a working document — you price a
 * batch, then spend a few days listing off it — so this needs to comfortably
 * outlast that, not archive forever: the rows are fat (a 60-card run is
 * roughly a megabyte of comps). Thirty days is several times the week that
 * processing actually takes, and the sweep below means an abandoned run costs
 * nothing after that.
 *
 * The same number is the column default in migration 023 — change both.
 */
export const RETENTION_DAYS = 30;

/** The filter controls a run was priced under, restored with it so the
 *  screen never shows a saved run next to filters it wasn't run with. */
export const FILTER_KEYS = [
  "ebaySite",
  "itemLocation",
  "itemCondition",
  "soldWithin",
  "minPrice",
  "maxPrice",
  "includeCondition",
  "useFullTitle",
  "fetchActiveAlways"
];

export function expiresAtIso(now = Date.now()) {
  return new Date(now + RETENTION_DAYS * 86400000).toISOString();
}

/** "59 cards from stock-aug.csv" / "59 pasted titles" — what the list shows. */
export function labelFor({ csvName = null, count = 0 } = {}) {
  const cards = `${count} card${count === 1 ? "" : "s"}`;
  return csvName ? `${cards} from ${csvName}` : `${cards} pasted`;
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
    title: c.title ?? null,
    itemPricePence: c.itemPricePence ?? null,
    postagePence: c.postagePence ?? null,
    totalPence: c.totalPence ?? null,
    itemLocation: c.itemLocation ?? null
  };
  if (c.exclusionReason) out.exclusionReason = c.exclusionReason;
  const url = c._source?.url ?? null;
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
    confidence: rec.confidence ?? null,
    dataSource: rec.dataSource ?? null,
    note: rec.note ?? null,
    graded: rec.graded ?? [],
    included: (rec.included || []).map(slimComp),
    excluded: (rec.excluded || []).map(slimComp)
  };
}

/**
 * A finished run's rows, as the records migration 023 stores — and as the
 * sessionStorage copy holds them, so both paths restore identically.
 *
 * `activeByIndex` is keyed by a row's index in the run, which is also its
 * `position` here: that is the same key the live screen uses, so a re-opened
 * run's asking prices land back on the rows they were fetched for.
 */
export function batchRows(results, activeByIndex = {}) {
  return (results || []).map((r, i) => ({
    position: i,
    title: r.title || "",
    sku: r.sku || null,
    query: r.query || null,
    failed: r.failed || null,
    rec: slimRec(r.rec),
    active_rec: slimRec(activeByIndex?.[i]?.rec),
    csv_item: r.csvItem || null,
    name_tokens: r.nameTokens || null,
    set_name: r.set || null,
    card_number: r.cardNumber || null
  }));
}

/**
 * Turn stored rows back into exactly what the results screen renders from:
 * the `results` array and the `activeByIndex` map. Rows are ordered by
 * `position` here rather than trusted to arrive sorted, because the index a
 * row sits at IS the key its asking prices are stored under — a re-ordered
 * restore would quietly hang one card's active listings on another card.
 */
export function restoreResults(items) {
  const ordered = [...(items || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const results = [];
  const activeByIndex = {};
  ordered.forEach((it, i) => {
    results.push({
      title: it.title || "",
      sku: it.sku || "",
      query: it.query || "",
      csvItem: it.csv_item || null,
      rec: it.rec || null,
      nameTokens: it.name_tokens || null,
      set: it.set_name || null,
      cardNumber: it.card_number || null,
      ...(it.failed ? { failed: it.failed } : {})
    });
    if (it.active_rec) activeByIndex[i] = { loading: false, rec: it.active_rec };
  });
  return { results, activeByIndex };
}

// ---------------------------------------------------------------------------
// Supabase. Every caller passes its own client — see the note at the top.
// ---------------------------------------------------------------------------

const BATCH_COLUMNS =
  "id, created_at, expires_at, label, source, csv_name, filters, item_count, priced_count, status";

/** Insert a finished run. Items go in chunks: a 60-card run is around a
 *  megabyte of comps, and one insert that size is the kind of request that
 *  fails at a proxy rather than at the database. */
export async function saveBatch(supabase, userId, { results, activeByIndex = {}, filters = {}, csvRaw = null, status = "complete" }) {
  const rows = results || [];
  if (rows.length === 0) return null;

  const { data: batch, error } = await supabase
    .from("price_batches")
    .insert({
      user_id: userId,
      label: labelFor({ csvName: csvRaw?.name || null, count: rows.length }),
      source: csvRaw ? "csv" : "paste",
      csv_name: csvRaw?.name || null,
      csv_text: csvRaw?.text || null,
      filters,
      item_count: rows.length,
      priced_count: rows.filter((r) => r.rec && r.rec.finalPence != null).length,
      status,
      expires_at: expiresAtIso()
    })
    .select(BATCH_COLUMNS)
    .single();
  if (error) throw error;

  const items = batchRows(rows, activeByIndex).map((it) => ({ ...it, batch_id: batch.id, user_id: userId }));
  for (let i = 0; i < items.length; i += 25) {
    const { error: itemsError } = await supabase.from("price_batch_items").insert(items.slice(i, i + 25));
    if (itemsError) {
      // A half-written run is worse than none: it would re-open looking
      // complete while missing its last cards.
      await supabase.from("price_batches").delete().eq("id", batch.id);
      throw itemsError;
    }
  }
  return batch;
}

/** One saved run, ready to render: `{ batch, results, activeByIndex }`. */
export async function loadBatch(supabase, id) {
  const { data: batch, error } = await supabase.from("price_batches").select(BATCH_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!batch) return null;

  const { data: items, error: itemsError } = await supabase
    .from("price_batch_items")
    .select("position, title, sku, query, failed, rec, active_rec, csv_item, name_tokens, set_name, card_number")
    .eq("batch_id", id)
    .order("position", { ascending: true });
  if (itemsError) throw itemsError;

  return { batch, ...restoreResults(items || []) };
}

export async function listBatches(supabase, userId, limit = 50) {
  const { data, error } = await supabase
    .from("price_batches")
    .select(BATCH_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function deleteBatch(supabase, id) {
  const { error } = await supabase.from("price_batches").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Drop the user's own expired runs. Called whenever the saved-runs list loads,
 * rather than from a cron: the retention promise only has to hold from the
 * point of view of someone looking at the list, and a sweep that runs when
 * they look is one less scheduled job that can quietly stop working.
 */
export async function purgeExpired(supabase, userId) {
  const { error } = await supabase
    .from("price_batches")
    .delete()
    .eq("user_id", userId)
    .lt("expires_at", new Date().toISOString());
  if (error) throw error;
}

/** Keep a re-opened run honest when asking prices are fetched after the fact:
 *  the row on screen and the row in the record should say the same thing. */
export async function updateItemActive(supabase, batchId, position, rec) {
  const { error } = await supabase
    .from("price_batch_items")
    .update({ active_rec: slimRec(rec) })
    .eq("batch_id", batchId)
    .eq("position", position);
  if (error) throw error;
}
