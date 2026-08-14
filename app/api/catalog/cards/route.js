import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * List the cards in a given set, ordered by collector number. Supports an
 * optional game filter, a category filter (default: real cards only, hiding
 * tokens/code/oversized/tip), and paging for big sets.
 *
 * GET /api/catalog/cards?expansion=Base%20Set&game=pokemon&category=card&page=0
 *   -> { ok, cards:[...], hasMore }
 *
 * The pseudo-set "Other / Promos" (from the cm_sets view) collects cards with
 * no expansion, so it maps back to expansion IS NULL / ''.
 */
const PAGE_SIZE = 600;
const PSEUDO_SET = "Other / Promos";

function numKey(n) {
  const s = String(n || "");
  const m = s.match(/\d+/);
  return { num: m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER, s };
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const expansion = (params.get("expansion") || "").trim();
  const code = (params.get("code") || "").trim();
  const game = (params.get("game") || "").trim();
  const category = (params.get("category") || "card").trim(); // "card" | "all"
  const page = Math.max(0, parseInt(params.get("page") || "0", 10) || 0);
  if (!expansion) return NextResponse.json({ ok: true, cards: [] });

  const supabase = await createClient();
  const from = page * PAGE_SIZE;
  // Fetch one extra row so "is there a next page?" is exact (avoids a phantom
  // empty page when a set is an exact multiple of PAGE_SIZE).
  let query = supabase
    .from("card_catalog")
    .select("cardmarket_id,name,collector_number,rarity,category")
    .order("collector_number", { ascending: true })
    .range(from, from + PAGE_SIZE);

  if (game) query = query.eq("game", game);
  if (category === "card") query = query.eq("category", "card");
  if (expansion === PSEUDO_SET) query = query.or("expansion.is.null,expansion.eq.");
  else {
    query = query.eq("expansion", expansion);
    // Two expansions can share a name with different codes (they're distinct
    // rows in cm_sets); scope to the exact code so the drill-down matches.
    if (code) query = query.eq("expansion_code", code);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: true, available: false, cards: [] });

  const rows = data || [];
  const hasMore = rows.length > PAGE_SIZE;      // the +1 sentinel row was returned
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const cards = pageRows
    .map((c) => ({
      id: `cm-${c.cardmarket_id}`,
      cardmarketId: c.cardmarket_id,
      name: c.name,
      number: c.collector_number || "",
      rarity: c.rarity || "",
      category: c.category || "card"
    }))
    .sort((a, b) => {
      const ka = numKey(a.number);
      const kb = numKey(b.number);
      return ka.num - kb.num || ka.s.localeCompare(kb.s) || a.name.localeCompare(b.name);
    });
  return NextResponse.json({ ok: true, available: true, cards, hasMore });
}
