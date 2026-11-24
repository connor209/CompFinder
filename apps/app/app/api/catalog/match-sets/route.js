import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { matchSetFromTitle } from "@/lib/set-index.js";
import { sharedSetIndex } from "@/lib/set-index-shared.js";

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

  // Shared across instances (lib/set-index-shared.js): read per instance, the
  // cm_sets view cost ~12s of every pull-sheet open.
  const { index, available } = await sharedSetIndex(supabase);
  if (!index) return NextResponse.json({ ok: true, available: false, matches: {} });

  const matches = {};
  for (const t of new Set(titles)) {
    const hit = matchSetFromTitle(t, index);
    if (hit) matches[t] = hit;
  }
  return NextResponse.json({ ok: true, available, matches });
}
