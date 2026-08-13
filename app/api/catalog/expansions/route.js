import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectLanguage } from "@/lib/catalog.js";

/**
 * Search catalog expansions (sets) by name. Type-to-filter — there are ~4,400
 * expansions, so a query of 2+ chars is required.
 *
 * GET /api/catalog/expansions?q=base -> { ok, available, expansions:[...] }
 */
export async function GET(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, available: true, expansions: [] });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_catalog")
    .select("expansion,expansion_code")
    .ilike("expansion", `%${q}%`)
    .limit(2000);
  if (error) return NextResponse.json({ ok: true, available: false, expansions: [] });

  const seen = new Map();
  for (const row of data || []) {
    const name = row.expansion || "";
    if (!name || seen.has(name)) continue;
    seen.set(name, { name, code: row.expansion_code || "", language: detectLanguage(name), count: 0 });
  }
  // rough per-expansion count from the sampled rows
  for (const row of data || []) {
    const e = seen.get(row.expansion || "");
    if (e) e.count += 1;
  }
  const expansions = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80);
  return NextResponse.json({ ok: true, available: true, expansions });
}
