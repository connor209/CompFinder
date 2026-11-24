/**
 * The catalogue rows for a set of Cardmarket set names, one read per set —
 * what a card has to be matched against (lib/cm-match.js matchCatalog). The
 * one place the matching read is written, shared by the price guide route and
 * the lab's catalogue link, so the two can never match a card differently.
 *
 * Returns Map(lower-cased set name → rows | { error }).
 */
const escape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function catalogRowsForSets(sb, setNames) {
  const sets = [...new Set((setNames || []).map((s) => String(s || "").trim()).filter(Boolean))];
  const bySet = new Map();
  await Promise.all(sets.map(async (set) => {
    const { data, error } = await sb.from("card_catalog").select("cardmarket_id,name,collector_number,expansion").ilike("expansion", escape(set)).limit(3000);
    bySet.set(set.toLowerCase(), error ? { error: error.message } : data || []);
  }));
  return bySet;
}
