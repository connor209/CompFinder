import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSetIndex, matchSetFromTitle } from "@/lib/set-index.js";

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

// The loader and its cache live in lib/set-index.js, shared with the
// storefront, so both read a title into the same set.

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

  const { index, available } = await getSetIndex(supabase);
  if (!index) return NextResponse.json({ ok: true, available: false, matches: {} });

  const matches = {};
  for (const t of new Set(titles)) {
    const hit = matchSetFromTitle(t, index);
    if (hit) matches[t] = hit;
  }
  return NextResponse.json({ ok: true, available, matches });
}
