import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { cleanSearchName } from "@compfinder/core/cardname.js";
import { parseQuery, rankCards, languageOf } from "@/lib/resolve";
import { selectCatalog } from "@/lib/catalog-select";

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

  // Columns come from the helper so a deployment that lands before migration
  // 022 loses the art rather than the whole dropdown.
  const build = (columns) => {
    let query = supabase
      .from("card_catalog")
      .select(columns)
      // Pokémon only — see the note in ../resolve/route.js for what the audit
      // measured about the other games.
      .eq("game", "pokemon")
      // Fetch a POOL and rank it, rather than ranking an arbitrary eight. With
      // limit(8) the database handed back eight rows in physical order and
      // scoring then discarded most of them: "charizard" dropped from eight
      // suggestions to two, both of them Radiant Charizard, with no Base Set,
      // no ex and no VMAX anywhere. Ranking only helps if it has something to
      // rank.
      .limit(60);

    for (const w of words) {
      // A number in the query is far more likely to be a collector number than
      // part of the name, so don't force it to match the name field too.
      if (/^\d+$/.test(w)) continue;
      query = query.ilike("name", `%${w}%`);
    }
    if (digits) query = query.ilike("collector_number", `${digits[0]}%`);
    return query;
  };

  const { data, error } = await selectCatalog(build);
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

  // Someone typing only a collector number — "223", "161/165" — has already
  // had the work done by the collector_number filter above. Ranking would then
  // throw those rows away, because scoreCard asks whether the card's NAME
  // contains what was typed and no card is called "223". Hand them back as
  // they are; a number is a perfectly good thing to browse by.
  if (!/[a-z]/i.test(parsed.name)) return NextResponse.json({ ok: true, cards: shape(data || []) });

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
      .rpc("search_catalog_fuzzy", { q: parsed.name, lim: 150 });
    if (!fuzzyError && fuzzyRows && fuzzyRows.length) {
      const pokemonOnly = fuzzyRows.filter((r) => (r.game || "pokemon") === "pokemon");
      ranked = rankCards(pokemonOnly.map((r) => ({ ...r, _similarity: r.similarity })), parsed, 8);
    }
  }

  return NextResponse.json({ ok: true, cards: shape(ranked.candidates.map((c) => c.row)) });
}

function shape(rows) {
  return rows.map((row) => ({
    id: row.cardmarket_id,
    name: cleanSearchName(row.name, row.game),
    number: row.collector_number,
    set: row.expansion,
    code: row.expansion_code,
    rarity: row.rarity,
    game: row.game,
    language: languageOf(row),
    image: row.image_small || null
  }));
}
