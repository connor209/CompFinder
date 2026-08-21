import { parsePriceGuide, worthTracking } from "@/lib/priceguide";

/**
 * The Cardmarket price ingest, shared by the nightly cron and the manual
 * "sync now" button in Settings so both do exactly the same work.
 *
 * Downloads a game's price-guide JSON, upserts every product into
 * `cm_price_latest`, and appends a history row for the cards worth charting.
 * Only cards at or above `historyMin` get daily history — tracking every 2p
 * common would be ~112M rows a year to record that nothing happened.
 */

const CHUNK = 1000;

export const HISTORY_MIN = Number(process.env.PRICE_HISTORY_MIN || 1);
export const HISTORY_KEEP_DAYS = Number(process.env.PRICE_HISTORY_KEEP_DAYS || 120);

async function upsertAll(admin, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

/** Pull one game. Records the outcome on its `cm_price_sources` row either way. */
export async function syncGamePrices(admin, source, { historyMin = HISTORY_MIN } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(source.url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const json = await res.json();
    const { rows, premiumKind, asOf } = parsePriceGuide(json, { game: source.game });
    if (rows.length === 0) throw new Error("no price rows in payload");

    const latest = await upsertAll(admin, "cm_price_latest", rows, "cardmarket_id");

    const hist = rows.filter((r) => worthTracking(r, historyMin)).map((r) => ({
      cardmarket_id: r.cardmarket_id,
      as_of: r.as_of,
      trend: r.trend, avg7: r.avg7, low: r.low, p_trend: r.p_trend
    }));
    const history = await upsertAll(admin, "cm_price_history", hist, "cardmarket_id,as_of");

    await admin.from("cm_price_sources").update({
      last_run_at: new Date().toISOString(), last_as_of: asOf,
      last_rows: latest, last_error: null
    }).eq("game", source.game);

    return { game: source.game, ok: true, asOf, premiumKind, latest, history, ms: Date.now() - started };
  } catch (err) {
    await admin.from("cm_price_sources").update({
      last_run_at: new Date().toISOString(), last_error: err.message
    }).eq("game", source.game);
    return { game: source.game, ok: false, error: err.message, ms: Date.now() - started };
  }
}

/** Pull every enabled game, or just one. Never throws — read the results. */
export async function syncPrices(admin, { game = null } = {}) {
  let q = admin.from("cm_price_sources").select("game,url,enabled").eq("enabled", true);
  if (game) q = q.eq("game", game);
  const { data: sources, error } = await q;
  if (error) throw new Error(`Run migration 017 first — ${error.message}`);
  if (!sources?.length) {
    throw new Error(game ? `No enabled price source for "${game}".` : "No price sources configured.");
  }

  const results = [];
  for (const src of sources) results.push(await syncGamePrices(admin, src));
  return results;
}

/** Thin history past the daily window to one row per week. Best-effort. */
export async function prunePriceHistory(admin, keepDays = HISTORY_KEEP_DAYS) {
  try {
    const { data } = await admin.rpc("prune_price_history", { keep_days: keepDays });
    return data ?? null;
  } catch {
    return null;
  }
}
