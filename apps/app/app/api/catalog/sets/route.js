import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectLanguage } from "@compfinder/core/catalog.js";

/**
 * List every set (expansion) for a game, with card counts, for the Browse
 * set list. Reads the cm_sets aggregate view so it's one cheap query even
 * though a game can hold hundreds of sets.
 *
 * GET /api/catalog/sets?game=pokemon -> { ok, available, sets:[...] }
 */
export async function GET(request) {
  const game = (new URL(request.url).searchParams.get("game") || "").trim();
  if (!game) return NextResponse.json({ ok: true, available: true, sets: [] });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cm_sets")
    .select("set_name,set_code,total_count,card_count")
    .eq("game", game)
    .limit(2000);
  if (error) return NextResponse.json({ ok: true, available: false, sets: [] });

  const sets = (data || [])
    .map((s) => ({
      name: s.set_name,
      code: s.set_code || "",
      total: s.total_count || 0,
      cards: s.card_count || 0,
      language: detectLanguage(s.set_name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ ok: true, available: true, sets });
}
