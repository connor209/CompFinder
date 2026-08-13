import { NextResponse } from "next/server";

/**
 * Magic: The Gathering typeahead — proxies Scryfall's card search so the
 * client gets suggestions (name, set, collector number, rarity, art) in the
 * same shape the Pokémon catalog returns. Scryfall is a free public API with
 * no key; it asks callers to send a descriptive User-Agent and Accept header,
 * which we do here. Server-side so there's no browser CORS hop.
 *
 * GET /api/mtg/search?q=lightning
 */
export const revalidate = 86400; // Scryfall data is stable day-to-day

function imageFrom(card) {
  if (card.image_uris) return card.image_uris.small || card.image_uris.normal || null;
  // Double-faced / split cards carry art on the faces instead.
  const face = Array.isArray(card.card_faces) ? card.card_faces.find((f) => f.image_uris) : null;
  return face ? face.image_uris.small || face.image_uris.normal || null : null;
}

export async function GET(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, cards: [] });

  try {
    // unique=cards collapses reprints of the same name to distinct printings;
    // order=edhrec surfaces the recognisable versions first.
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CompFinder/1.0 (card pricing tool)", Accept: "application/json" },
      // Scryfall caches well; let Next cache the upstream response for a day.
      next: { revalidate: 86400 }
    });
    if (res.status === 404) return NextResponse.json({ ok: true, cards: [] }); // no matches
    if (!res.ok) return NextResponse.json({ ok: false, error: `Scryfall ${res.status}` }, { status: 502 });
    const data = await res.json();
    const cards = (data.data || []).slice(0, 10).map((c) => ({
      name: c.name,
      number: c.collector_number || "",
      set: c.set_name || "",
      series: (c.set || "").toUpperCase(),
      rarity: c.rarity ? c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1) : "",
      image: imageFrom(c),
      game: "mtg"
    }));
    return NextResponse.json({ ok: true, cards });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Scryfall lookup failed." }, { status: 502 });
  }
}
