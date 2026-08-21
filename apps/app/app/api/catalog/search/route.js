import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Catalog-backed typeahead over the card_catalog table (CardMarket export).
 * Covers every set/language, unlike the pokemontcg.io lookup. If the table
 * isn't loaded yet, returns { available:false } so the client falls back.
 *
 * GET /api/catalog/search?q=charizard%20base -> { ok, available, cards:[...] }
 */
function tokenize(raw) {
  return raw
    .toLowerCase()
    .replace(/[":()[\]{}^~?\\/#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
}

export async function GET(request) {
  const raw = (new URL(request.url).searchParams.get("q") || "").trim();
  if (raw.length < 2) return NextResponse.json({ ok: true, available: true, cards: [] });

  const tokens = tokenize(raw);
  const words = tokens.filter((t) => !/^\d/.test(t));
  const numToken = (raw.match(/\b(\d{1,4})\b/) || [])[1] || "";
  if (words.length === 0) return NextResponse.json({ ok: true, available: true, cards: [] });

  // The catalogue is multi-game; this typeahead is the Pokémon path (Magic uses
  // Scryfall, "other" has no catalogue). Default to Pokémon, overridable.
  const gameFilter = (new URL(request.url).searchParams.get("game") || "pokemon").trim();

  const supabase = await createClient();
  let query = supabase
    .from("card_catalog")
    .select("cardmarket_id,name,collector_number,rarity,expansion,expansion_code")
    .eq("game", gameFilter)
    .limit(60);
  // Every alphabetic token must appear in the name (trigram-indexed ilike).
  for (const w of words) query = query.ilike("name", `%${w}%`);

  const { data, error } = await query;
  if (error) {
    // Table missing / not imported yet — let the client fall back.
    return NextResponse.json({ ok: true, available: false, cards: [] });
  }

  const first = words[0];
  const stripZero = (s) => String(s || "").replace(/^0+/, "");
  const wantNum = stripZero(numToken);
  const ranked = (data || [])
    .map((c) => {
      const nl = c.name.toLowerCase();
      let score = 0;
      if (nl === first) score += 5;
      if (nl.startsWith(first)) score += 3;
      if (wantNum && stripZero(c.collector_number) === wantNum) score += 4;
      score -= Math.min(nl.length / 40, 2); // prefer tighter names
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map(({ c }) => ({
      id: `cm-${c.cardmarket_id}`,
      name: c.name,
      number: c.collector_number || "",
      set: c.expansion || "",
      series: c.expansion_code || "",
      rarity: c.rarity || "",
      image: null
    }));

  return NextResponse.json({ ok: true, available: true, cards: ranked });
}
