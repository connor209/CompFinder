import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSetRows, setIndexFromRows, getSetIndex } from "@/lib/set-index.js";

/**
 * The catalogue's set list for the storefront, shared ACROSS server instances.
 *
 * `cm_sets` is a view that groups the whole card catalogue on every read, and
 * a QR scanned at a show usually lands on a cold instance — so every scan was
 * paying for that aggregate, a page at a time, before a card could be drawn.
 * Next's data cache keeps the rows for ten minutes (set-index.js's own TTL,
 * so a fresh import still shows up promptly) for every instance at once; a
 * warm instance also keeps the built index, which is the part that costs CPU.
 *
 * A failed read throws inside the cache, so a failure is never what gets
 * cached; the storefront then falls back to the per-instance loader.
 */
const TTL_S = 600;

const cachedRows = unstable_cache(
  async () => {
    const rows = await readSetRows(createAdminClient());
    if (!rows) throw new Error("cm_sets could not be read");
    return rows;
  },
  ["storefront-cm-sets-v1"],
  { revalidate: TTL_S }
);

let built = { at: 0, sets: null };

export async function storefrontSets(admin) {
  if (built.sets && Date.now() - built.at < TTL_S * 1000) return built.sets;
  try {
    const sets = setIndexFromRows(await cachedRows());
    built = { at: Date.now(), sets };
    return sets;
  } catch {
    return getSetIndex(admin);
  }
}
