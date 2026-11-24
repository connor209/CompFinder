import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSetRows, setIndexFromRows, getSetIndex } from "@/lib/set-index.js";

/**
 * The catalogue's set list, shared ACROSS server instances — for the pull
 * sheet's set names (/api/catalog/match-sets). Server-only.
 *
 * `cm_sets` is a view that groups the whole card catalogue on every read, a
 * thousand rows a page, and set-index.js's own cache lives in ONE instance.
 * Vercel hands the pull sheet a cold instance most mornings, so it paid for
 * the whole aggregate every open: 12 of the 18 seconds measured on 2026-11-24.
 *
 * Next's data cache keeps the rows for every instance and serves the last good
 * copy while it refreshes in the background, so after the first fill nobody
 * waits on the view. Six hours, because the catalogue changes only when it is
 * re-imported, and a set missing for an afternoon costs one card filed under
 * "All sets". The storefront keeps its own ten-minute copy (app/show/[token]/
 * sets.js); both read through readSetRows, so they cannot disagree about which
 * sets exist.
 *
 * A failed read throws inside the cache, so a failure is never what gets
 * cached; this then falls back to the per-instance loader.
 */
const TTL_S = 6 * 60 * 60;

const cachedRows = unstable_cache(
  async () => {
    const rows = await readSetRows(createAdminClient());
    if (!rows) throw new Error("cm_sets could not be read");
    return rows;
  },
  ["cm-sets-shared-v1"],
  { revalidate: TTL_S }
);

let built = { at: 0, sets: null };

export async function sharedSetIndex(fallbackClient) {
  if (built.sets && Date.now() - built.at < TTL_S * 1000) return built.sets;
  try {
    const sets = setIndexFromRows(await cachedRows());
    built = { at: Date.now(), sets };
    return sets;
  } catch {
    return getSetIndex(fallbackClient);
  }
}
