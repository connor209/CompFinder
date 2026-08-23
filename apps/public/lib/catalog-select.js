/**
 * Catalogue column list, tolerant of migration 022 not having been run yet.
 *
 * Selecting a column that doesn't exist isn't a degraded result — PostgREST
 * rejects the whole query, so the resolver returns nothing and the page stops
 * finding cards at all. That turns "the images aren't in yet" into an outage,
 * and makes the deploy depend on someone having run a migration first.
 *
 * The same posture as the SoldComps pacer and the fuzzy-search RPC before it:
 * notice once, carry on without the new thing. The flag is per-process, so a
 * cold lambda pays one failed query and then behaves.
 */
const BASE = "cardmarket_id,name,collector_number,rarity,expansion,expansion_code,game";
const WITH_IMAGES = `${BASE},image_small`;

let imagesAvailable = true;
let warned = false;

export function catalogColumns() {
  return imagesAvailable ? WITH_IMAGES : BASE;
}

/** True when this error is "that column isn't there", rather than a real fault. */
export function isMissingImageColumn(error) {
  if (!error) return false;
  const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return text.includes("image_small");
}

export function noteImagesMissing() {
  imagesAvailable = false;
  if (!warned) {
    warned = true;
    console.warn("card_catalog has no image_small column — run migration 022. Serving cards without art.");
  }
}

/**
 * Run a catalogue query, and if the image column is the reason it failed, run
 * it again without. `build` is handed the column list so the caller keeps
 * control of its own filters and ordering.
 */
export async function selectCatalog(build) {
  const first = await build(catalogColumns());
  if (first && first.error && imagesAvailable && isMissingImageColumn(first.error)) {
    noteImagesMissing();
    return build(catalogColumns());
  }
  return first;
}
