import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { cleanSearchName } from "@compfinder/core/cardname.js";

/**
 * Card typeahead for the public search box. Reads card_catalog with the anon
 * key — that table is public-readable by policy (migration 005), so this needs
 * no service key and no rate limiting: it costs a cheap indexed query and,
 * unlike /api/price, never spends money upstream.
 *
 * Suggesting a catalogue card rather than pricing raw typed text is what makes
 * the eBay query specific enough to be worth trusting — name plus collector
 * number plus set code, instead of whatever the visitor typed.
 *
 * GET /api/suggest?q=charizard  ->  { ok, cards: [...] }
 */
export async function GET(request) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, cards: [] });

  const supabase = createPublicClient();

  // Split into words so "charizard 199" matches on both, rather than needing
  // the visitor to type the name exactly as the catalogue stores it.
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  const digits = q.match(/\d{1,4}/);

  let query = supabase
    .from("card_catalog")
    .select("cardmarket_id,name,collector_number,rarity,expansion,expansion_code,game")
    .limit(8);

  for (const w of words) {
    // A number in the query is far more likely to be a collector number than
    // part of the name, so don't force it to match the name field too.
    if (/^\d+$/.test(w)) continue;
    query = query.ilike("name", `%${w}%`);
  }
  if (digits) query = query.ilike("collector_number", `${digits[0]}%`);

  const { data, error } = await query;
  if (error) {
    console.error("suggest failed:", error.message);
    return NextResponse.json({ ok: true, cards: [] });
  }

  return NextResponse.json({
    ok: true,
    cards: (data || []).map((c) => ({
      id: c.cardmarket_id,
      name: cleanSearchName(c.name, c.game),
      number: c.collector_number,
      set: c.expansion,
      code: c.expansion_code,
      rarity: c.rarity,
      game: c.game
    }))
  });
}
