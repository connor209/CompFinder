import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * List the cards in a given expansion, ordered by collector number.
 *
 * GET /api/catalog/cards?expansion=Base%20Set -> { ok, cards:[...] }
 */
function numKey(n) {
  const s = String(n || "");
  const m = s.match(/\d+/);
  return { num: m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER, s };
}

export async function GET(request) {
  const expansion = (new URL(request.url).searchParams.get("expansion") || "").trim();
  if (!expansion) return NextResponse.json({ ok: true, cards: [] });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_catalog")
    .select("cardmarket_id,name,collector_number,rarity")
    .eq("expansion", expansion)
    .limit(1000);
  if (error) return NextResponse.json({ ok: true, available: false, cards: [] });

  const cards = (data || [])
    .map((c) => ({ id: `cm-${c.cardmarket_id}`, name: c.name, number: c.collector_number || "", rarity: c.rarity || "" }))
    .sort((a, b) => {
      const ka = numKey(a.number);
      const kb = numKey(b.number);
      return ka.num - kb.num || ka.s.localeCompare(kb.s) || a.name.localeCompare(b.name);
    });
  return NextResponse.json({ ok: true, available: true, cards });
}
