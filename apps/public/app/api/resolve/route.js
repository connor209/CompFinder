import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { cleanSearchName } from "@compfinder/core/cardname.js";
import { parseQuery, rankCards, languageOf } from "@/lib/resolve";

/**
 * Free text -> ranked catalogue cards.
 *
 * This runs BEFORE the price search, not after, which is the point. Measured
 * on 30 cards, "Mew ex 232/091" priced at £794 with the set name in the query
 * and £546 without — SoldComps returns a different result set when the set is
 * missing, so no amount of filtering downstream recovers it. Resolving first
 * means the eBay search itself is specific.
 *
 * GET /api/resolve?q=charizard ex 223  ->  { ok, parsed, candidates, confident }
 */
export async function GET(request) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, parsed: null, candidates: [], confident: false });
  if (q.length > 120) return NextResponse.json({ ok: false, error: "That search is too long." }, { status: 400 });

  const parsed = parseQuery(q);
  const supabase = createPublicClient();

  // Cast a wide net and rank in JS: the useful signals (exact-name match,
  // language, product type) aren't things this schema can order by, and the
  // candidate set for one card name is small enough that it doesn't matter.
  let query = supabase
    .from("card_catalog")
    .select("cardmarket_id,name,collector_number,rarity,expansion,expansion_code,game")
    .limit(120);

  const tokens = parsed.name.toLowerCase().split(/\s+/).filter((t) => t.length >= 2).slice(0, 4);
  if (!tokens.length) return NextResponse.json({ ok: true, parsed, candidates: [], confident: false });
  for (const t of tokens) query = query.ilike("name", `%${t}%`);

  const { data, error } = await query;
  if (error) {
    console.error("resolve failed:", error.message);
    return NextResponse.json({ ok: true, parsed, candidates: [], confident: false });
  }

  const { candidates, confident } = rankCards(data || [], parsed);

  return NextResponse.json({
    ok: true,
    parsed,
    confident,
    candidates: candidates.map(({ row, score }) => ({
      id: row.cardmarket_id,
      name: cleanSearchName(row.name, row.game),
      number: row.collector_number,
      set: row.expansion,
      code: row.expansion_code,
      rarity: row.rarity,
      game: row.game,
      // Shown on the picker: a Japanese print of the same card is a different
      // product at a different price, and the set name alone doesn't say so.
      language: languageOf(row),
      score
    }))
  });
}
