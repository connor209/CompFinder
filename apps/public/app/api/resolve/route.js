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

  let parsed = parseQuery(q);
  const supabase = createPublicClient();

  // Cast a wide net and rank in JS: the useful signals (exact-name match,
  // language, product type) aren't things this schema can order by, and the
  // candidate set for one card name is small enough that it doesn't matter.
  const fetchByTokens = async (tokens) => {
    let query = supabase
      .from("card_catalog")
      .select("cardmarket_id,name,collector_number,rarity,expansion,expansion_code,game")
      .limit(120);
    for (const t of tokens) query = query.ilike("name", `%${t}%`);
    const { data, error } = await query;
    if (error) {
      console.error("resolve failed:", error.message);
      return null;
    }
    return data || [];
  };

  // Trim WORDS, derive tokens from them. Deriving the name back out of the
  // filtered tokens loses every one-character word — and "V" is not noise on a
  // Pokémon card. "Hisuian Zoroark V Lost Origin" came back as the name
  // "hisuian zoroark", which matched the non-V card EXACTLY (100) and the V
  // card only on tokens (12), so it confidently priced the wrong card.
  const words = parsed.name.split(/\s+/).filter(Boolean);
  const tokensOf = (ws) => ws.map((w) => w.toLowerCase()).filter((t) => t.length >= 2).slice(0, 4);
  const tokens = tokensOf(words);
  if (!tokens.length) return NextResponse.json({ ok: true, parsed, candidates: [], confident: false });

  // EVERY token has to appear in the card's name, so one word that isn't part
  // of the name empties the result. parseQuery already strips a set that
  // follows the collector number, but "Umbreon ex Prismatic Evolutions" has no
  // number to split on and returned nothing at all.
  //
  // So when the full set of tokens finds nothing, drop the trailing ones one
  // at a time and try again — and treat what was dropped as a set hint, which
  // scoreCard rewards. "umbreon ex prismatic evolutions" finds nothing, then
  // nothing, then "umbreon ex" finds the card and "prismatic evolutions"
  // becomes the hint that picks the right one out of six. Costs an extra round
  // trip only on a query that was going to fail outright.
  let data = await fetchByTokens(tokens);
  if (data === null) return NextResponse.json({ ok: true, parsed, candidates: [], confident: false });

  let usedWords = words;
  while (!data.length && usedWords.length > 1) {
    usedWords = usedWords.slice(0, -1);
    const retry = await fetchByTokens(tokensOf(usedWords));
    if (retry === null) break;
    data = retry;
  }
  if (usedWords.length < words.length) {
    const dropped = words.slice(usedWords.length).join(" ");
    parsed = { ...parsed, name: usedWords.join(" "), setHint: [parsed.setHint, dropped].filter(Boolean).join(" ") };
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
