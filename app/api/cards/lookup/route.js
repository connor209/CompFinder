import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Look up a single card's canonical art + metadata, for the deep-dive header
 * and to enrich a photo scan (name/number in -> clean image, set, rarity out).
 * Returns the best match, or { card: null } when the database has nothing
 * confident — the UI then falls back to a neutral placeholder rather than
 * showing the wrong card.
 *
 * GET /api/cards/lookup?name=Butterfree%20VMAX&number=2
 */
const API = "https://api.pokemontcg.io/v2/cards";

export async function GET(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in.", card: null }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const name = (sp.get("name") || "").replace(/[":()[\]{}^~?\\/]/g, " ").trim();
  const number = (sp.get("number") || "").trim().split(/[\/-]/)[0]; // "4/102" -> "4"
  if (!name) {
    return NextResponse.json({ ok: false, error: "A card name is required.", card: null }, { status: 400 });
  }

  const parts = [`name:"${name}"`];
  if (/^\d{1,4}$/.test(number)) parts.push(`number:${number}`);

  const params = new URLSearchParams({
    q: parts.join(" "),
    pageSize: "1",
    select: "id,name,number,rarity,set,images"
  });

  const headers = { Accept: "application/json" };
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;

  try {
    const res = await fetch(`${API}?${params}`, { headers, next: { revalidate: 86400 } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Card database returned ${res.status}.`, card: null }, { status: 502 });
    }
    const json = await res.json();
    const c = (json.data || [])[0];
    if (!c) {
      return NextResponse.json({ ok: true, card: null });
    }
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
