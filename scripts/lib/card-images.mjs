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

/**
 * The same card, written two ways.
 *
 * The first version of this compared names almost literally and refused 1,477
 * pairings across the catalogue, every sampled one of which was the same card:
 *
 *   MAggron EX          vs  M Aggron EX          spacing of the Mega prefix
 *   Nidoran [M]         vs  Nidoran♂             symbols spelled out
 *   Pikachu δ Delta Species vs Pikachu δ         the suffix written twice
 *
 * Spaces carry no information once both sides are down to letters and digits,
 * so they come out entirely — which folds the Mega case away — and the gender
 * symbols are mapped before the punctuation is stripped, or ♂ and ♀ both
 * vanish and every Nidoran becomes the same card.
 */
export function nameKey(n) {
  let t = String(n || "").toLowerCase().replace(PARENTHETICAL, "");
  // Before norm() removes them: ♂ and ♀ are the whole difference between two
  // real, differently-numbered cards, so they must survive as letters. Spelled
  // out rather than kept as "m" and "f", because the one-edit tolerance below
  // would otherwise treat Nidoran♂ and Nidoran♀ as the same card — which is
  // precisely the confusion that would put one's picture on the other.
  t = t.replace(/♂/g, " male ").replace(/♀/g, " female ");
  t = t.replace(/\[\s*m\s*\]/g, " male ").replace(/\[\s*f\s*\]/g, " female ");
  // The δ says "Delta Species" already; Cardmarket writes both.
  t = t.replace(/\bdelta species\b/g, " ");
  return norm(t).replace(GRADE_WORDS, "").replace(/\s+/g, "");
}

/** Levenshtein, bounded — we only ever care whether it exceeds 1. */
function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  let j = 0;
  while (j < short.length - i && short[short.length - 1 - j] === long[long.length - 1 - j]) j++;
  // What's left unmatched in the middle: one character on each side at most.
  return long.length - i - j <= 1;
}

/**
 * A guard, not a key. Set and number already identify the card, so what this
 * has to catch is a whole SET matched to the wrong set — where the name isn't
 * a character out, it's a different Pokémon entirely. One edit of tolerance
 * catches "Imposter Professor Oak" against "Impostor Professor Oak" without
 * letting Charizard through as Blastoise.
 */
export function nameAgrees(ours, theirs) {
  const a = nameKey(ours);
  const b = nameKey(theirs);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && withinOneEdit(a, b);
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
