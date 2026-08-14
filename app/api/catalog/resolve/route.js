import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import CompFinderPricing from "@/lib/pricing.js";
import { detectLanguage } from "@/lib/catalog.js";

/**
 * Canonical title resolution. Maps a messy eBay title to the best-matching
 * catalog card, then builds a tight, language-aware SoldComps query from it:
 * the canonical name + localised collector number, plus the language term for
 * non-English sets. Used by arbitrage / inventory / quick-search to price
 * accurately across languages.
 *
 * GET  /api/catalog/resolve?title=...            -> { ok, available, result }
 * POST { titles: [...] }                          -> { ok, available, results }
 */
const SET_STOP = new Set([
  "set", "sets", "pokemon", "pokémon", "the", "and", "promo", "promos", "collection", "box",
  "booster", "gift", "deck", "display", "pack", "series", "card", "cards", "tin", "elite",
  "trainer", "premium", "starter", "blister", "bundle", "edition"
]);
const stripZero = (s) => String(s || "").replace(/^0+(?=\d)/, "");

function parseNumber(title) {
  const m = (title || "").match(/\b([A-Za-z]{0,3}\d{1,4})\s*\/\s*([A-Za-z]{0,3}\d{1,4})\b/);
  if (m) return { numerator: m[1], denominator: m[2] };
  const m2 = (title || "").match(/\b(\d{1,4})\b/);
  return { numerator: m2 ? m2[1] : "", denominator: "" };
}

async function resolveOne(supabase, title) {
  const parsed = CompFinderPricing.buildCardQuery(title || "");
  if (parsed.lot) return { matched: false, lot: true };
  const nameTokens = (parsed.nameTokens || []).filter((t) => t && t.length >= 2);
  if (nameTokens.length === 0) return { matched: false };

  const { numerator, denominator } = parseNumber(title);
  const titleLc = (title || "").toLowerCase();
  const hintedLang = detectLanguage(title); // language named in the listing itself

  let query = supabase
    .from("card_catalog")
    .select("cardmarket_id,name,collector_number,rarity,expansion,expansion_code")
    .eq("game", "pokemon") // this resolver is Pokémon-specific; the catalogue is now multi-game
    .limit(60);
  for (const w of nameTokens) query = query.ilike("name", `%${w}%`);

  const { data, error } = await query;
  if (error) return { available: false, matched: false };
  if (!data || data.length === 0) return { matched: false };

  const wantNum = stripZero(numerator);
  const scored = data.map((c) => {
    const nl = c.name.toLowerCase();
    let s = 0;
    if (nl === nameTokens.join(" ")) s += 4;
    if (nl.startsWith(nameTokens[0])) s += 2;
    const numMatch = wantNum && stripZero(c.collector_number) === wantNum;
    if (numMatch) s += 6;
    const setWords = (c.expansion || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4 && !SET_STOP.has(w));
    const setHits = setWords.filter((w) => titleLc.includes(w)).length;
    s += Math.min(setHits, 3) * 2;
    const lang = detectLanguage(c.expansion);
    if (hintedLang !== "English") {
      if (lang === hintedLang) s += 3;
      else if (lang !== "English") s -= 1;
    } else {
      s += lang === "English" ? 1 : -1; // no hint → prefer English prints
    }
    s -= Math.min(nl.length / 50, 1.5);
    return { c, s, numMatch, setHits };
  });
  scored.sort((a, b) => b.s - a.s);
  const top = scored[0];

  const best = top.c;
  const lang = detectLanguage(best.expansion);
  const canonNum = stripZero(best.collector_number || numerator);
  const englishQuery = `${best.name} ${canonNum}${denominator ? `/${denominator}` : ""}`.replace(/\s+/g, " ").trim();
  const langQuery = `${best.name} ${canonNum} ${lang}`.replace(/\s+/g, " ").trim();
  const outQuery = lang === "English" ? englishQuery : langQuery;
  const bestTokens = best.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 2);

  const confidence = top.numMatch && top.setHits >= 1 ? "high" : top.numMatch || top.setHits >= 1 ? "medium" : "low";

  return {
    matched: true,
    name: best.name,
    number: canonNum,
    denominator,
    expansion: best.expansion || "",
    expansionCode: best.expansion_code || "",
    language: lang,
    query: outQuery,
    nameTokens: bestTokens,
    confidence,
    graded: parsed.graded
  };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export async function GET(request) {
  const supabase = await createClient();
  const title = (new URL(request.url).searchParams.get("title") || "").trim();
  if (!title) return NextResponse.json({ ok: true, available: true, result: { matched: false } });
  const result = await resolveOne(supabase, title);
  const available = result.available !== false;
  return NextResponse.json({ ok: true, available, result });
}

export async function POST(request) {
  const supabase = await createClient();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const titles = Array.isArray(body.titles) ? body.titles.slice(0, 60) : [];
  const results = await pool(titles, 6, (t) => resolveOne(supabase, t));
  const available = !results.some((r) => r && r.available === false) || results.some((r) => r && r.matched);
  return NextResponse.json({ ok: true, available, results });
}
