import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { cleanSearchName } from "@compfinder/core/cardname.js";
import { parseQuery, rankCards, languageOf } from "@/lib/resolve";

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

  // Ranked, not raw. This dropdown is the first thing anyone sees, and it was
  // returning whatever Postgres handed back: "ns zoroark" suggested an Online
  // Code Card, and the scoring that keeps those out has existed in resolve all
  // along. Showing something different from what pressing Enter does is worse
  // than showing nothing.
  const parsed = parseQuery(q);
  let ranked = rankCards(data || [], parsed, 8);

  // Same trigram fallback as /api/resolve. Without it the box stayed empty on
  // exactly the searches the fuzzy work was meant to rescue — "Umbeon ex" and
  // "team rockets persian" found nothing here while Enter found them both,
  // because the fallback only ever reached the submit path.
  //
  // Only on a miss, and only once the query is long enough to be worth it: a
  // two- or three-character prefix matches plenty exactly, and this runs on
  // every keystroke.
  if (!ranked.candidates.length && parsed.name.length >= 4) {
    const { data: fuzzyRows, error: fuzzyError } = await supabase
      .rpc("search_catalog_fuzzy", { q: parsed.name, lim: 40 });
    if (!fuzzyError && fuzzyRows && fuzzyRows.length) {
      ranked = rankCards(fuzzyRows.map((r) => ({ ...r, _similarity: r.similarity })), parsed, 8);
    }
  }

  return NextResponse.json({
    ok: true,
    cards: ranked.candidates.map(({ row }) => ({
      id: row.cardmarket_id,
      name: cleanSearchName(row.name, row.game),
      number: row.collector_number,
      set: row.expansion,
      code: row.expansion_code,
      rarity: row.rarity,
      game: row.game,
      language: languageOf(row)
    }))
  });
}
