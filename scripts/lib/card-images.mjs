/**
 * Matching our catalogue rows to card art.
 *
 * Our catalogue is Cardmarket-derived: set NAME, collector number, card name,
 * and no images. tcgdex is a different index with its own set ids, its own
 * zero-padding and its own idea of where a sub-set begins. So the join is
 * set + number, and the card NAME is a guard on the result rather than part of
 * the key — if set and number agree but the names don't, the mapping is wrong
 * and the image is refused. A missing picture is a gap; a picture of a
 * different card is a lie about what's being priced.
 *
 * Measured over the 400 English cards in the audit sets (2026-08-23): 87%
 * matched with names agreeing, no number misses, one name clash, and 84% end
 * up with art once tcgdex's own gaps are counted.
 *
 * Kept apart from the backfill so the rules can be tested without a network or
 * a database — see scripts/check-images.mjs.
 */

export const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Collector numbers, comparably.
 *
 * "060" and "60" are the same card. So are "SV001", "SV01" and "SV1": tcgdex
 * pads the numeric part differently from sub-set to sub-set — SV001 in Shining
 * Fates, SV1 in Hidden Fates — so the zeros have to come off after the letter
 * prefix, not merely at the front of the string. Anything that isn't
 * letters-then-digits is left alone rather than mangled.
 */
export function numKey(n) {
  const flat = String(n || "").toLowerCase().replace(/\s+/g, "");
  return flat.replace(/^([a-z]*)0*(\d+)$/, (_, prefix, digits) => prefix + String(Number(digits)));
}

/**
 * Sub-sets that Cardmarket keeps INSIDE their parent set, with a letter
 * prefix on the collector number — TG24, GG45, SV99. These three, and only
 * these three, because they are the ones whose numbering says so.
 *
 * A whitelist rather than "any set name that extends another", which is what
 * this did first and which the tests caught: by that rule "Base Set 2" is a
 * sub-set of "Base Set", and so are Dragon Frontiers, Dragon Majesty, Dragon
 * Vault, Team Rocket Returns, Mega Evolution Energy, Triumphant Light, the XY
 * Black Star Promos and eight XY Trainer Kits. All separate products. Merging
 * any of them would put one card's art on another card's number.
 */
const SUBSET_SUFFIXES = ["trainer gallery", "galarian gallery", "shiny vault"];

/**
 * Their sets that make up one of ours.
 *
 * Matched on NAME rather than id, because Hidden Fates is `sm115` and its
 * vault is `sma` — the ids have nothing in common, but "Hidden Fates Shiny
 * Vault" still starts with "Hidden Fates".
 *
 * The parent comes first, and callers let it win a number collision: a plain
 * number belongs to the main set.
 */
export function setFamily(ourSetName, theirSets) {
  const key = norm(ourSetName);
  if (!key) return [];
  const parent = theirSets.find((s) => norm(s.name) === key);
  if (!parent) return [];
  const subsets = theirSets.filter((s) => {
    if (s.id === parent.id) return false;
    const name = norm(s.name);
    if (!name.startsWith(`${key} `)) return false;
    const suffix = name.slice(key.length + 1);
    return SUBSET_SUFFIXES.includes(suffix);
  });
  return [parent, ...subsets];
}

/**
 * Suffixes that describe the card rather than name it. Only ever compared
 * within one set at one number, which is unique — so a parenthetical can't be
 * the thing telling two cards apart, and treating it as significant just
 * refuses art for cards we have matched correctly.
 */
const PARENTHETICAL = /\s*\([^)]*\)\s*$/;
const GRADE_WORDS = /\b(ex|gx|v|vmax|vstar|lv x)\b/g;

export function nameKey(n) {
  return norm(String(n || "").replace(PARENTHETICAL, "")).replace(GRADE_WORDS, "").replace(/\s+/g, " ").trim();
}

export function nameAgrees(ours, theirs) {
  return nameKey(ours) === nameKey(theirs) && nameKey(ours) !== "";
}

/**
 * tcgdex serves image URLs without an extension; the caller picks the size.
 * low.webp is about 35KB and is what a thumbnail wants; high.png is around
 * 380KB and is only worth it full-size.
 */
export function imageUrls(base) {
  if (!base) return { small: null, large: null };
  const clean = String(base).replace(/\/+$/, "");
  return { small: `${clean}/low.webp`, large: `${clean}/high.png` };
}

/**
 * Index a set family's cards by comparable number. Parent wins collisions.
 */
export function indexByNumber(family, cardsBySetId) {
  const byNumber = new Map();
  const parentId = family.length ? family[0].id : null;
  for (const part of family) {
    for (const card of cardsBySetId.get(part.id) || []) {
      const key = numKey(card.localId);
      if (!byNumber.has(key) || part.id === parentId) byNumber.set(key, card);
    }
  }
  return byNumber;
}

/**
 * The whole decision for one catalogue row.
 *
 * Returns an outcome rather than throwing, so a backfill can report a
 * breakdown instead of stopping at the first oddity.
 */
export function matchCard(ours, byNumber) {
  const hit = byNumber.get(numKey(ours.number ?? ours.collector_number));
  if (!hit) return { outcome: "no-number" };
  if (!nameAgrees(ours.name, hit.name)) {
    return { outcome: "name-clash", theirName: hit.name, theirId: hit.id };
  }
  const { small, large } = imageUrls(hit.image);
  if (!small) return { outcome: "no-art", theirId: hit.id, theirName: hit.name };
  return { outcome: "matched", theirId: hit.id, theirName: hit.name, small, large };
}
