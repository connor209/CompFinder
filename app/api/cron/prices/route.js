import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePriceGuide, worthTracking } from "@/lib/priceguide";

/**
 * Nightly Cardmarket price pull (Vercel Cron — see vercel.json).
 *
 * For each enabled game in `cm_price_sources`: download the day's price-guide
 * JSON, upsert every product into `cm_price_latest`, and append a history row
 * for the cards worth charting. Finishes by thinning old history to one row
 * per week.
 *
 * Only cards above HISTORY_MIN_VALUE get daily history — tracking every 2p
 * common would be ~112M rows a year to say nothing changed. The latest price
 * is still kept for everything.
 *
 * GET /api/cron/prices           all enabled games
 * GET /api/cron/prices?game=x    just one (handy for a first run)
 */
export const maxDuration = 300;

const HISTORY_MIN_VALUE = Number(process.env.PRICE_HISTORY_MIN || 1);
const HISTORY_KEEP_DAYS = Number(process.env.PRICE_HISTORY_KEEP_DAYS || 120);
const CHUNK = 1000;

async function upsertAll(admin, table, rows, onConflict) {
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    done += Math.min(CHUNK, rows.length - i);
  }
  return done;
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }

  const only = new URL(request.url).searchParams.get("game");
  let q = admin.from("cm_price_sources").select("game,url,enabled").eq("enabled", true);
  if (only) q = q.eq("game", only);
  const { data: sources, error: srcErr } = await q;
  if (srcErr) {
    return NextResponse.json({ ok: false, error: `Run migration 017 first — ${srcErr.message}` }, { status: 500 });
  }

  const results = [];
  for (const src of sources || []) {
    const started = Date.now();
    try {
      const res = await fetch(src.url, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const json = await res.json();
      const { rows, premiumKind, asOf } = parsePriceGuide(json, { game: src.game });
      if (rows.length === 0) throw new Error("no price rows in payload");

      const latest = await upsertAll(admin, "cm_price_latest", rows, "cardmarket_id");

      // History only for cards worth charting.
      const hist = rows
        .filter((r) => worthTracking(r, HISTORY_MIN_VALUE))
        .map((r) => ({
          cardmarket_id: r.cardmarket_id,
          as_of: r.as_of,
          trend: r.trend, avg7: r.avg7, low: r.low, p_trend: r.p_trend
        }));
      const history = await upsertAll(admin, "cm_price_history", hist, "cardmarket_id,as_of");

      await admin.from("cm_price_sources").update({
        last_run_at: new Date().toISOString(), last_as_of: asOf,
        last_rows: latest, last_error: null
      }).eq("game", src.game);

      results.push({ game: src.game, ok: true, asOf, premiumKind, latest, history, ms: Date.now() - started });
    } catch (err) {
      await admin.from("cm_price_sources").update({
        last_run_at: new Date().toISOString(), last_error: err.message
      }).eq("game", src.game);
      results.push({ game: src.game, ok: false, error: err.message, ms: Date.now() - started });
    }
  }

  // Thin history older than the daily window to one row per week.
  let pruned = null;
  try {
    const { data } = await admin.rpc("prune_price_history", { keep_days: HISTORY_KEEP_DAYS });
    pruned = data ?? null;
  } catch {
    /* pruning is housekeeping — never fail the run over it */
  }

  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: failed === 0, games: results.length, failed, pruned, results });
}
