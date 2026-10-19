import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSetIndex, matchSetFromTitle, setMatcher, canonicalSetTitle, setInGame } from "@/lib/set-index.js";
import { gameOf } from "@/lib/games.js";
import { eraOf } from "@/lib/pokemon-eras.js";
import { storefrontStock } from "@/lib/storefront.js";
import { isListingAvailable } from "@/lib/stockcheck.js";

/**
 * Why a card does or doesn't reach a storefront filter — for us, behind the
 * login, read through RLS like every other desk screen.
 *
 *   /api/storefront/diagnose?q=base
 *
 * Every listing of OURS whose title contains `q`, with each step the
 * storefront takes on it: the text the set matcher reads, the set it found,
 * the game gameOf() called it, whether the catalogue holds that set for
 * Pokémon, the era, and what the card finally came out as. Plus every
 * catalogue set whose name contains `q`, with the games that hold it.
 *
 * Built because the Base Set fix was reasoned from test titles twice and
 * failed twice: the real titles and the real catalogue are the only evidence,
 * and they are behind the login. Read-only; nothing here is shown to a
 * visitor.
 */
export const dynamic = "force-dynamic";

const LIMIT = 40;

export async function GET(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const q = String(new URL(request.url).searchParams.get("q") || "").trim().slice(0, 60);
  if (!q) return NextResponse.json({ ok: false, error: "Add ?q=<word in the title>, e.g. ?q=base" }, { status: 400 });

  const sets = await getSetIndex(supabase);
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const read = async (cols) => supabase.from("ebay_listings").select(cols).ilike("title", like).order("ebay_item_id").limit(LIMIT);
  let { data: listings, error } = await read("ebay_item_id,sku,title,price_value,quantity,image_url,category:extra->>category");
  if (error) ({ data: listings, error } = await read("ebay_item_id,sku,title,price_value,quantity,image_url"));
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const isPokemonSet = (name) => setInGame(sets.index, name, "pokemon");
  const projected = storefrontStock([], listings || [], {
    includeOnline: true,
    setOf: setMatcher(sets.index),
    gameIndex: sets.gameIndex,
    isPokemonSet
  });

  const rows = (listings || []).map((l) => {
    const game = gameOf({ category: l.category, title: l.title }, sets.gameIndex);
    const hit = setMatcher(sets.index)(l.title, game);
    const anyGame = matchSetFromTitle(l.title, sets.index);
    return {
      title: l.title,
      category: l.category ?? null,
      quantity: l.quantity,
      onStorefront: isListingAvailable(l),
      readAs: canonicalSetTitle(l.title).trim(),
      set: hit?.name ?? null,
      // What the title would match ignoring its game, when that differs.
      ...(anyGame?.name !== hit?.name ? { setIgnoringGame: anyGame?.name ?? null } : {}),
      gameOf: game,
      setIsPokemon: hit ? isPokemonSet(hit.name) : null,
      setGames: hit ? [...(sets.index?.gamesByName?.get(hit.name) || [])] : null,
      era: hit ? eraOf(hit.name) : null
    };
  });

  const qn = q.toLowerCase();
  const catalogue = [...(sets.index?.gamesByName || new Map()).entries()]
    .filter(([name]) => name.toLowerCase().includes(qn))
    .slice(0, 60)
    .map(([name, games]) => ({ name, games: [...games] }));

  return NextResponse.json({
    ok: true,
    q,
    catalogueAvailable: Boolean(sets.index),
    listingsMatched: rows.length,
    listings: rows,
    // What the storefront makes of them, after folding copies into one card.
    storefrontCards: projected.cards.map((c) => ({ name: c.name, set: c.set, game: c.game, count: c.count })),
    catalogueSets: catalogue
  }, { headers: { "Cache-Control": "private, no-store" } });
}
