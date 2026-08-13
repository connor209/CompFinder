import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Look up a single card's canonical art + metadata, for the deep-dive header
 * and to enrich a photo scan (name/number/set in -> clean image out).
 *
 * Catalog cards come from CardMarket, whose names/numbers don't always line up
 * with pokemontcg.io, so we pull several candidates and RANK them by set-name
 * and number match rather than trusting the first hit — otherwise a "Charizard
 * 125" lookup could grab a Charizard from the wrong set (or nothing).
 *
 * GET /api/cards/lookup?name=Charizard%20ex&number=125&set=Obsidian%20Flames
 */
const API = "https://api.pokemontcg.io/v2/cards";
const SELECT = "id,name,number,rarity,set,images";

async function fetchCards(q, pageSize) {
  const params = new URLSearchParams({ q, pageSize: String(pageSize), select: SELECT });
  const headers = { Accept: "application/json" };
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;
  const res = await fetch(`${API}?${params}`, { headers, next: { revalidate: 86400 } });
  if (!res.ok) return { error: res.status, data: [] };
  const json = await res.json();
  return { data: json.data || [] };
}

const stripZero = (s) => String(s || "").replace(/^0+(?=\d)/, "").toLowerCase();

export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in.", card: null }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const name = (sp.get("name") || "").replace(/[":()[\]{}^~?\\/]/g, " ").trim();
  const setName = (sp.get("set") || "").trim();
  const number = (sp.get("number") || "").trim().split(/[\/-]/)[0];
  if (!name) return NextResponse.json({ ok: false, error: "A card name is required.", card: null }, { status: 400 });

  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  try {
    // Exact-phrase name first; if that finds nothing, loosen to a prefix on the
    // first word (covers "Charizard ex" vs "Charizard-EX" style differences).
    let { data } = await fetchCards(`name:"${name}"`, 25);
    if (data.length === 0 && words[0]) ({ data } = await fetchCards(`name:${words[0]}*`, 25));
    if (data.length === 0) return NextResponse.json({ ok: true, card: null });

    const wantNum = stripZero(number);
    const setWords = setName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const scored = data.map((c) => {
      let s = 0;
      if (wantNum && stripZero(c.number) === wantNum) s += 5;
      if (setWords.length) {
        const cs = (c.set?.name || "").toLowerCase();
        s += setWords.filter((w) => cs.includes(w)).length * 2;
      }
      if (c.name.toLowerCase() === name.toLowerCase()) s += 1;
      return { c, s };
    });
    scored.sort((a, b) => b.s - a.s);
    const c = scored[0].c;

    return NextResponse.json({
      ok: true,
      card: {
        id: c.id,
        name: c.name,
        number: c.set?.printedTotal ? `${c.number}/${c.set.printedTotal}` : c.number,
        set: c.set?.name || "",
        series: c.set?.series || "",
        rarity: c.rarity || "",
        image: c.images?.large || c.images?.small || null
      }
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Card lookup failed.", card: null }, { status: 500 });
  }
}
