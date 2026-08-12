import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Card-name typeahead, backed by the free pokemontcg.io database. Proxied
 * server-side so POKEMONTCG_API_KEY never reaches the browser, and so results
 * can be trimmed to just what the suggestion dropdown needs. The key is
 * optional — without it the API still works at a lower daily limit.
 *
 * GET /api/cards/search?q=char  ->  { ok, cards: [{ id, name, number, set, rarity, image }] }
 */
const API = "https://api.pokemontcg.io/v2/cards";

// pokemontcg.io uses a Lucene-ish query language; strip characters that would
// break it, then wildcard each word (prefix match) and treat a bare number
// like "4" or "4/102" as a collector-number filter.
function buildQuery(raw) {
  const cleaned = raw.replace(/[":()[\]{}^~?\\/]/g, " ").trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean).slice(0, 6);
  return tokens
    .map((t) => (/^\d{1,4}$/.test(t) ? `number:${t}` : `name:${t}*`))
    .join(" ");
}

export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in.", cards: [] }, { status: 401 });
  }

  const raw = (new URL(request.url).searchParams.get("q") || "").trim();
  if (raw.length < 2) {
    return NextResponse.json({ ok: true, cards: [] });
  }

  const params = new URLSearchParams({
    q: buildQuery(raw),
    pageSize: "8",
    select: "id,name,number,rarity,set,images"
  });

  const headers = { Accept: "application/json" };
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;

  try {
    // Card metadata barely changes — cache each query for a day.
    const res = await fetch(`${API}?${params}`, { headers, next: { revalidate: 86400 } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Card database returned ${res.status}.`, cards: [] }, { status: 502 });
    }
    const json = await res.json();
    const cards = (json.data || []).map((c) => ({
      id: c.id,
      name: c.name,
      // Reconstruct the familiar "9/108" from the printed number + set total.
      number: c.set?.printedTotal ? `${c.number}/${c.set.printedTotal}` : c.number,
      set: c.set?.name || "",
      series: c.set?.series || "",
      rarity: c.rarity || "",
      image: c.images?.small || null
    }));
    return NextResponse.json({ ok: true, cards });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Card search failed.", cards: [] }, { status: 500 });
  }
}
