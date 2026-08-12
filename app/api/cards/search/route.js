import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Card-name typeahead, backed by the free pokemontcg.io database. Proxied
 * server-side so POKEMONTCG_API_KEY never reaches the browser. The key is
 * optional but strongly recommended — without it the keyless daily/burst
 * limit is easily exhausted by per-keystroke typeahead traffic.
 *
 * Narrowing: pokemontcg's own query only matches the card NAME, so a search
 * like "Wartortle Base Set" can't be expressed as one API query (the set is a
 * different field, and users don't type in a fixed order). Instead we seed the
 * upstream query with the first real word, pull a wide page, then filter/rank
 * locally against name + set + number so the extra words genuinely narrow it.
 *
 * GET /api/cards/search?q=wartortle%20base -> { ok, cards: [...] }
 */
const API = "https://api.pokemontcg.io/v2/cards";

// Filler words that shouldn't be required matches (set/condition/rarity noise).
const STOP = new Set([
  "set", "pokemon", "pokémon", "card", "cards", "tcg", "the", "a", "of",
  "holo", "holographic", "reverse", "foil", "rare", "common", "uncommon",
  "promo", "full", "art", "nm", "lp", "mp", "hp", "mint", "near", "edition"
]);

function tokenize(raw) {
  return raw
    .toLowerCase()
    .replace(/[":()[\]{}^~?\\/#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
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

  const tokens = tokenize(raw);
  const numeric = tokens.filter((t) => /^\d{1,4}$/.test(t));
  const words = tokens.filter((t) => !/^\d/.test(t));
  const seed = words.find((w) => !STOP.has(w)) || words[0];
  const required = tokens.filter((t) => !STOP.has(t)); // words + numbers, minus filler

  if (!seed && !numeric.length) {
    return NextResponse.json({ ok: true, cards: [] });
  }

  const parts = [];
  if (seed) parts.push(`name:${seed}*`);
  if (numeric[0]) parts.push(`number:${numeric[0]}`);

  const params = new URLSearchParams({
    q: parts.join(" "),
    pageSize: "50",
    orderBy: "-set.releaseDate",
    select: "id,name,number,rarity,set,images"
  });

  const headers = { Accept: "application/json" };
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;

  try {
    const res = await fetch(`${API}?${params}`, { headers, next: { revalidate: 86400 } });
    if (!res.ok) {
      // 429 etc. — surface it so the client can tell "throttled" from "no matches".
      return NextResponse.json({ ok: false, error: `Card database returned ${res.status}.`, cards: [] }, { status: 502 });
    }
    const json = await res.json();
    const all = json.data || [];

    // Keep only cards that match every non-filler token across name + set +
    // number; fall back to the raw seed results if that leaves nothing.
    const matches = all.filter((c) => {
      const hay = `${c.name} ${c.set?.name || ""} ${c.set?.series || ""} ${c.number} ${c.set?.printedTotal || ""}`.toLowerCase();
      return required.every((t) => hay.includes(t));
    });
    const list = (matches.length ? matches : all).slice(0, 8);

    const cards = list.map((c) => ({
      id: c.id,
      name: c.name,
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
