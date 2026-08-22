import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { cleanSearchName } from "@compfinder/core/cardname.js";
import { parseQuery, rankCards, languageOf } from "@/lib/resolve";

// One warning per process if the fuzzy RPC isn't there, rather than one per
// failed search.
let warnedNoFuzzy = false;

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

  // The filter runs against the raw `name` column, which still carries its
  // apostrophes. Someone typing "team rockets persian ex" produces the token
  // "rockets", and `name ilike '%rockets%'` does not match "Team Rocket's
  // Persian ex" — so the card is never fetched and never gets a chance to be
  // scored, however well the scorer would have handled it. 25 of the 455 cards
  // in the audit set are trainer-owned cards named this way: Team Rocket's,
  // Misty's, Brock's, Erika's, N's, Gladion's.
  //
  // Dropping a trailing "s" turns "rockets" into "rocket", which matches
  // "Rocket's" as a substring. It can only ever WIDEN the net — a shorter
  // needle matches a superset — and ranking still happens in JS, where norm()
  // deletes the apostrophe so the full name matches exactly. The length floor
  // keeps it from turning short tokens into noise.
  const forFilter = (w) => {
    const t = w.toLowerCase();
    return t.length >= 5 && t.endsWith("s") ? t.slice(0, -1) : t;
  };
  const tokensOf = (ws) => ws.map(forFilter).filter((t) => t.length >= 2).slice(0, 4);
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
  // Retry while there is nothing to OFFER, not merely nothing fetched. Rows can
  // come back and then be scored away entirely — "Latios ex EX Dragon" matched
  // something on latio + ex + dragon, every candidate scored at or below zero,
  // and because the fetch was non-empty the fallback never ran and the query
  // returned nothing at all.
  const rankFor = (rows, p) => rankCards(rows || [], p);

  let usedWords = words;
  let data = await fetchByTokens(tokens);
  if (data === null) return NextResponse.json({ ok: true, parsed, candidates: [], confident: false });

  let parsedFor = parsed;
  let ranked = rankFor(data, parsedFor);
  while (!ranked.candidates.length && usedWords.length > 1) {
    usedWords = usedWords.slice(0, -1);
    const retry = await fetchByTokens(tokensOf(usedWords));
    if (retry === null) break;
    const dropped = words.slice(usedWords.length).join(" ");
    parsedFor = {
      ...parsed,
      name: usedWords.join(" "),
      // A dropped word only becomes a set hint if it could plausibly BE one.
      // "Umbeon ex" trims to "Umbeon" and offered "ex" as the hint, which then
      // matched every EX-era set — "EX Sandstorm", "EX Dragon" — for a bogus
      // +40 and put a 2003 Umbreon above the card actually being searched for.
      setHint: [parsed.setHint, dropped.length >= 3 ? dropped : ""].filter(Boolean).join(" ")
    };
    ranked = rankFor(retry, parsedFor);
  }
  // LAST RESORT: trigram similarity. Only reached when nothing matched by
  // substring at any token depth, which is exactly the case a substring filter
  // cannot serve — a typo ("Umbeon"), or a name whose stored form carries
  // punctuation the visitor didn't type ("N's Zoroark ex"). Measured typo
  // tolerance before this existed was 0% of 360 queries.
  //
  // Degrades silently if migration 020 has not been run: the page keeps its
  // previous behaviour rather than erroring.
  if (!ranked.candidates.length) {
    // The ORIGINAL name, not the trimmed one. Trimming is a strategy for the
    // exact path — drop words until something matches — and it is precisely
    // wrong here: "Umbeon ex" had already been cut down to "Umbeon", so the
    // fuzzy search looked for the wrong card and ranked a 2003 Umbreon above
    // the Umbreon ex being searched for. Similarity wants everything typed.
    const { data: fuzzyRows, error: fuzzyError } = await supabase
      .rpc("search_catalog_fuzzy", { q: parsed.name, lim: 60 });
    if (fuzzyError) {
      if (!warnedNoFuzzy) {
        warnedNoFuzzy = true;
        console.warn("fuzzy catalogue search unavailable (migration 020 not run?):", fuzzyError.message);
      }
    } else if (fuzzyRows && fuzzyRows.length) {
      // Scored against the original parse too, for the same reason.
      ranked = rankCards(fuzzyRows.map((r) => ({ ...r, _similarity: r.similarity })), parsed);
      if (ranked.candidates.length) parsedFor = parsed;
    }
  }

  parsed = parsedFor;

  const { candidates, confident } = ranked;

  return NextResponse.json({
    ok: true,
    parsed,
    confident,
    fuzzy: !!ranked.fuzzy,
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
