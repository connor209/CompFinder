import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildSetIndex, matchSetFromTitle } from "@compfinder/core/setmatch.js";

/**
 * Resolve eBay listing titles to catalogue sets (name + code).
 *
 * The pull sheet needs a real set name to alphabetise variation picks by, and
 * the set code to print beside it — neither of which eBay sends with an order.
 * The catalogue does know them, so titles are matched against every set name /
 * code we hold. Matching happens here (not in the browser) so the ~4k-row set
 * index never crosses the wire.
 *
 * POST { titles: string[] } -> { ok, available, matches: { title: {name, code} } }
 */

// The set list changes only when the catalogue is re-imported, so a warm
// instance can reuse it. Short TTL keeps a fresh import from going unnoticed.
let cache = { at: 0, index: null, available: false };
const TTL_MS = 10 * 60 * 1000;

async function getIndex(supabase) {
  if (cache.index && Date.now() - cache.at < TTL_MS) return cache;

  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("cm_sets")
      .select("set_name,set_code")
      .range(from, from + 999);
    if (error) {
      // View missing (catalogue migration not run yet) — degrade quietly.
      cache = { at: Date.now(), index: null, available: false };
      return cache;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  cache = { at: Date.now(), index: buildSetIndex(rows), available: rows.length > 0 };
  return cache;
}

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const titles = Array.isArray(body.titles) ? body.titles.filter((t) => typeof t === "string").slice(0, 500) : [];
  if (titles.length === 0) return NextResponse.json({ ok: true, available: true, matches: {} });

  const { index, available } = await getIndex(supabase);
  if (!index) return NextResponse.json({ ok: true, available: false, matches: {} });

  const matches = {};
  for (const t of new Set(titles)) {
    const hit = matchSetFromTitle(t, index);
    if (hit) matches[t] = hit;
  }
  return NextResponse.json({ ok: true, available, matches });
}
