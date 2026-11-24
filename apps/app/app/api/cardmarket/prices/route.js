import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { matchCatalog, cmFigures, isReverse } from "@/lib/cm-match";
import { loadEurGbp } from "@/lib/fx";

/**
 * POST /api/cardmarket/prices — Cardmarket's price guide for our cards, in
 * pounds. Body: { cards: [{ id, name, number, set, finish?, title? }] }.
 * Answers { ok, rate, rateAsOf, rateFallback, results: { [id]: { cardmarketId,
 * pence, avg7Pence, avg30Pence, lowPence, eurTrend, reverse, dir, asOf } |
 * { why } } }.
 *
 * Reads only what the nightly job already stored (the catalogue, the price
 * guide, the exchange rate via lib/fx.js): no request leaves for Cardmarket. Shown beside
 * eBay's figures; nothing here prices a card.
 */
export const maxDuration = 60;
const MAX_CARDS = 400;

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 }); }
  const cards = (Array.isArray(body?.cards) ? body.cards : []).filter((c) => c && c.id != null && c.set).slice(0, MAX_CARDS);
  if (!cards.length) return NextResponse.json({ ok: true, results: {} });

  // One catalogue read per set, by Cardmarket's own set name.
  const sets = [...new Set(cards.map((c) => String(c.set).trim()).filter(Boolean))];
  const bySet = new Map();
  const escape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
  await Promise.all(sets.map(async (set) => {
    const { data, error } = await sb.from("card_catalog").select("cardmarket_id,name,collector_number,expansion").ilike("expansion", escape(set)).limit(3000);
    bySet.set(set.toLowerCase(), error ? { error: error.message } : data || []);
  }));

  const results = {};
  const wanted = new Map();
  for (const c of cards) {
    const rows = bySet.get(String(c.set).trim().toLowerCase());
    if (!rows || rows.error) { results[c.id] = { why: rows?.error ? `catalogue read failed: ${rows.error}` : "set not in the catalogue" }; continue; }
    const m = matchCatalog(c, rows);
    if (!m.row) { results[c.id] = { why: m.why }; continue; }
    wanted.set(c.id, { card: c, id: m.row.cardmarket_id, name: m.row.name });
  }

  const ids = [...new Set([...wanted.values()].map((w) => w.id))];
  const prices = new Map();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from("cm_price_latest")
      .select("cardmarket_id,as_of,trend,avg7,avg30,low,p_trend,p_avg7,p_avg30,p_low")
      .in("cardmarket_id", ids.slice(i, i + 300));
    for (const p of data || []) prices.set(String(p.cardmarket_id), p);
  }

  const fx = await loadEurGbp(sb);
  for (const [id, w] of wanted) {
    const f = cmFigures(prices.get(String(w.id)), { reverse: isReverse(w.card), rate: fx.rate });
    results[id] = f ? { cardmarketId: w.id, product: w.name, ...f } : { cardmarketId: w.id, product: w.name, why: "no price in today's guide" };
  }
  return NextResponse.json({ ok: true, rate: fx.rate, rateAsOf: fx.asOf, rateFallback: fx.fallback, results });
}
