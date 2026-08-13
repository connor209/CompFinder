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
const SELECT = "id,name,number,rarity,set,images,cardmarket";

// EUR→GBP for CardMarket prices (reported in EUR). Live daily rate, cached, with
// a sensible fallback if the FX service is unreachable.
async function eurToGbp() {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=GBP", { next: { revalidate: 86400 } });
    if (res.ok) {
      const j = await res.json();
      if (j.rates?.GBP) return j.rates.GBP;
    }
  } catch {
    /* fall through */
  }
  return 0.86;
}

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
  const wantNum = stripZero(number);
  const setWords = setName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const pick = (arr) => {
    let best = null;
    for (const c of arr) {
      let s = 0;
      if (wantNum && stripZero(c.number) === wantNum) s += 5;
      if (setWords.length) {
        const cs = (c.set?.name || "").toLowerCase();
        s += setWords.filter((w) => cs.includes(w)).length * 2;
      }
      if (c.name.toLowerCase() === name.toLowerCase()) s += 1;
      if (!best || s > best.s) best = { c, s };
    }
    return best;
  };

  try {
    // Exact-phrase name first, then rank by set + number. If that yields no
    // meaningful match (no number/set overlap), widen to a prefix query and
    // re-rank across everything — so a wrong-set card can't win by default.
    const { data } = await fetchCards(`name:"${name}"`, 25);
    let best = pick(data);
    if ((!best || best.s === 0) && words[0]) {
      const more = await fetchCards(`name:${words[0]}*`, 50);
      best = pick([...data, ...more.data]);
    }
    if (!best) return NextResponse.json({ ok: true, card: null });
    const c = best.c;

    // CardMarket price guide (EUR) → GBP.
    let cardmarket = null;
    const cm = c.cardmarket;
    if (cm && cm.prices) {
      const rate = await eurToGbp();
      const g = (v) => (v != null && v > 0 ? Math.round(v * rate * 100) : null);
      cardmarket = {
        trendPence: g(cm.prices.trendPrice),
        avgPence: g(cm.prices.averageSellPrice),
        lowPence: g(cm.prices.lowPrice),
        avg7Pence: g(cm.prices.avg7),
        avg30Pence: g(cm.prices.avg30),
        url: cm.url || null,
        updatedAt: cm.updatedAt || null
      };
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
        image: c.images?.large || c.images?.small || null,
        cardmarket
      }
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Card lookup failed.", card: null }, { status: 500 });
  }
}
