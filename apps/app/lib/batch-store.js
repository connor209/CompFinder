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

/** "59 cards from stock-aug.csv" / "43 cards from London Expo" / "59 cards
 *  pasted" — what the saved-runs list shows. A pool run names its show for the
 *  same reason a CSV run names its file: weeks later, "43 cards pasted" tells
 *  you nothing about which trip it was for. */
export function labelFor({ csvName = null, count = 0, poolName = null } = {}) {
  const cards = `${count} card${count === 1 ? "" : "s"}`;
  const from = csvName || poolName;
  return from ? `${cards} from ${from}` : `${cards} pasted`;
}

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
    confidence: rec.confidence ?? null,
    dataSource: rec.dataSource ?? null,
    note: storableText(rec.note),
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
    title: storableText(r.title) || "",
    sku: storableText(r.sku) || null,
    query: storableText(r.query) || null,
    failed: storableText(r.failed) || null,
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

// Small enough that one card's comps never make a request too big to send,
// and that a failure costs few enough retries to be worth doing row by row.
const CHUNK_SIZE = 10;

const BATCH_COLUMNS =
  "id, created_at, expires_at, label, source, csv_name, filters, item_count, priced_count, status";

/**
 * `pool_name` (migration 024) is read and written OPTIONALLY, and that is
 * worth the small amount of machinery below.
 *
 * Migrations here are applied by hand in the Supabase SQL editor, so there is
 * always a window where the code is deployed and the column is not. Naming an
 * absent column in a select is not a degraded read — Postgres rejects the whole
 * statement — so a required `pool_name` would take out the saved-runs list and
 * every save with it, including runs that have nothing to do with a show. The
 * feature failing to remember which show it priced is a fair price for that;
 * losing a 59-card run is not.
 *
 * The flag latches on the first rejection, so the retry happens once per page
 * rather than on every call.
 */
let poolNameColumn = true;
const POOL_NAME_MISSING = /pool_name/i;

export function batchColumns() {
  return poolNameColumn ? `${BATCH_COLUMNS}, pool_name` : BATCH_COLUMNS;
}

/** True when an error is Postgres refusing a statement that names pool_name. */
export function isMissingPoolName(error) {
  if (!error || !poolNameColumn) return false;
  return POOL_NAME_MISSING.test(error.message || "") || POOL_NAME_MISSING.test(error.details || "");
}

/** Latch the column off after a rejection, so callers retry without it once. */
function dropPoolNameColumn() {
  poolNameColumn = false;
}

// Structural failures — the table isn't there, or we aren't allowed to write
// to it. Nothing about retrying a smaller slice helps, so don't spend thirty
// round trips finding that out.
const STRUCTURAL = new Set(["42P01", "42501", "PGRST205", "PGRST301", "PGRST106"]);

/**
 * Insert a finished run.
 *
 * Items go in small chunks: an 89-card run is a couple of megabytes of comps,
 * and one insert that size is the kind of request that fails at a proxy rather
 * than at the database. When a chunk does fail, it retries row by row instead
 * of giving up — the first version of this deleted the whole batch on any
 * failure, which turned "one comp with a character Postgres won't take" into
 * an 89-card run that vanished with nothing to show for it. Eighty-eight saved
 * cards beat none, and a card that still won't store is kept WITHOUT its comps
 * and says so on the row, rather than silently coming back looking priced from
 * nothing.
 */
export async function saveBatch(supabase, userId, { results, activeByIndex = {}, filters = {}, csvRaw = null, poolName = null, status = "complete" }) {
  const rows = results || [];
  if (rows.length === 0) return null;

  const record = {
    user_id: userId,
    label: labelFor({ csvName: csvRaw?.name || null, count: rows.length, poolName }),
    source: csvRaw ? "csv" : poolName ? "stock" : "paste",
    csv_name: csvRaw?.name || null,
    csv_text: csvRaw?.text || null,
    pool_name: poolName,
    filters,
    item_count: rows.length,
    priced_count: rows.filter((r) => r.rec && r.rec.finalPence != null).length,
    status,
    expires_at: expiresAtIso()
  };
  const insert = () =>
    supabase.from("price_batches").insert(record).select(batchColumns()).single();

  let { data: batch, error } = await insert();
  if (isMissingPoolName(error)) {
    // Migration 024 isn't applied. The run still saves — it just won't
    // remember which show it was for. The label already carries the name.
    dropPoolNameColumn();
    delete record.pool_name;
    ({ data: batch, error } = await insert());
  }
  if (error) throw error;

  const items = batchRows(rows, activeByIndex).map((it) => ({ ...it, batch_id: batch.id, user_id: userId }));
  const degraded = [];
  const giveUp = async (err) => {
    // Nothing was storable, so leave no half-written run behind: it would
    // re-open looking complete while missing most of its cards.
    await supabase.from("price_batches").delete().eq("id", batch.id);
    throw err;
  };

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const { error: chunkError } = await supabase.from("price_batch_items").insert(chunk);
    if (!chunkError) continue;
    if (STRUCTURAL.has(chunkError.code)) await giveUp(chunkError);

    for (const row of chunk) {
      const { error: rowError } = await supabase.from("price_batch_items").insert(row);
      if (!rowError) continue;

      const stripped = {
        ...row,
        rec: row.rec ? { ...row.rec, included: [], excluded: [] } : null,
        active_rec: null,
        failed: [row.failed, `The comps behind this price could not be stored (${rowError.message}).`]
          .filter(Boolean)
          .join(" ")
      };
      const { error: strippedError } = await supabase.from("price_batch_items").insert(stripped);
      if (strippedError) await giveUp(strippedError);
      degraded.push(row.title);
    }
  }
  return { batch, degraded };
}

/** One saved run, ready to render: `{ batch, results, activeByIndex }`. */
export async function loadBatch(supabase, id) {
  const read = () => supabase.from("price_batches").select(batchColumns()).eq("id", id).maybeSingle();
  let { data: batch, error } = await read();
  if (isMissingPoolName(error)) {
    dropPoolNameColumn();
    ({ data: batch, error } = await read());
  }
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
  const read = () =>
    supabase
      .from("price_batches")
      .select(batchColumns())
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

  let { data, error } = await read();
  if (isMissingPoolName(error)) {
    dropPoolNameColumn();
    ({ data, error } = await read());
  }
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
