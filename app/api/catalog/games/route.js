import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * List the games in the catalog with their card counts, for the Browse grid.
 * Metadata comes from cm_games; counts from the cm_game_counts view. If the
 * catalog isn't loaded yet, returns { available:false } so the UI can prompt.
 *
 * GET /api/catalog/games -> { ok, available, games:[{slug,name,icon,count,cardCount}] }
 */
export async function GET() {
  const supabase = await createClient();

  const { data: games, error } = await supabase
    .from("cm_games")
    .select("slug,name,short_name,icon,sort_order")
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ ok: true, available: false, games: [] });

  const { data: counts } = await supabase
    .from("cm_game_counts")
    .select("game,total_count,card_count");
  const byGame = new Map((counts || []).map((c) => [c.game, c]));

  const out = (games || []).map((g) => {
    const c = byGame.get(g.slug) || {};
    return {
      slug: g.slug,
      name: g.name,
      shortName: g.short_name || g.name,
      icon: g.icon || "🎴",
      count: c.total_count || 0,
      cardCount: c.card_count || 0
    };
  });
  return NextResponse.json({ ok: true, available: true, games: out });
}
