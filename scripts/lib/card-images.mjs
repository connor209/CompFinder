/**
 * Matching our catalogue rows to card art.
 *
 * Our catalogue is Cardmarket-derived: set NAME, collector number, card name,
 * and no images. Every source of art is a different index with its own set
 * ids, its own zero-padding and its own idea of where a sub-set begins. So the
 * join is set + number, and the card NAME is a guard on the result rather than
 * part of the key — if set and number agree but the names don't, the mapping
 * is wrong and the image is refused. A missing picture is a gap; a picture of
 * a different card is a lie about what's being priced.
 *
 * NOTHING HERE KNOWS WHICH SOURCE ANSWERED. Both are flattened to one card
 * shape first (tcgdexCards / pokemontcgCards below), which is what lets a
 * second source be added without the rules that decide a match — the ones with
 * the expensive failure mode — being touched at all. Which sources are asked,
 * and in what order, is lib/image-sources.mjs.
 *
 * Measured over the 455 published cards (2026-08-26): 438 matched with names
 * agreeing, no name clashes, and the 17 left are products neither index
 * holds.
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
/**
 * Set names we and tcgdex spell differently, where no rule covers it.
 * Deliberately tiny and explicit: a fuzzy set match puts a whole set's art on
 * the wrong cards at once, which is the worst failure available here.
 */
const SET_ALIASES = new Map([
  // Three names for one set: ours, tcgdex's, and pokemontcg.io's. A list
  // rather than a single string because the alias has to reach whichever
  // source is being asked — only one of them will be in any given set list.
  ["sv black star promos", ["svp black star promos", "scarlet violet black star promos"]]
]);

export function setFamily(ourSetName, theirSets) {
  const key = norm(ourSetName);
  if (!key) return [];
  const find = (name) => theirSets.find((s) => norm(s.name) === name);

  // Cardmarket prefixes the whole 2003-2007 era with "EX " — "EX Unseen
  // Forces", "EX Deoxys", "EX Holon Phantoms" — where tcgdex just names the
  // set. That one prefix accounts for around a thousand cards. Tried only
  // after the exact name fails, and only accepted on an exact match of what's
  // left, so it can't reach a set that merely looks similar.
  let parent = find(key);
  for (const alias of SET_ALIASES.get(key) || []) parent = parent || find(alias);
  if (!parent && key.startsWith("ex ")) parent = find(key.slice(3));
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
// Repeated, because a card can carry two: "Team Magma's Baltoy (Fighting)
// (Peck)" is tcgdex's "Team Magma's Baltoy".
const PARENTHETICAL = /(\s*\([^)]*\))+\s*$/;
// No suffix stripping. It was here to fold "Umbreon ex" into "Umbreon EX",
// which lowercasing already does — and it was quietly merging Charizard with
// Charizard ex, Charizard V and Charizard LV.X, which are four different cards
// at four different prices. Nothing that separates two real cards may be
// normalised away.

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
  // Other bracketed letters are the SP-era owner marks — "Charizard [G]" is
  // tcgdex's "Charizard G" — so the brackets go and the letter stays.
  t = t.replace(/\[\s*([a-z])\s*\]/g, " $1 ");
  // The δ says "Delta Species" already; Cardmarket writes both, and puts it at
  // the opposite end: "Rainbow Energy Delta" against "δ Rainbow Energy".
  t = t.replace(/\u03b4/g, " ").replace(/\bdelta species\b/g, " ").replace(/\bdelta\b/g, " ");
  // Gold Star cards, which our sources write three ways: "Espeon \u2606" for most
  // of them, but "Pikachu Star" and "Mewtwo Star" for the five Holon-era ones,
  // against Cardmarket's "Espeon Gold Star" throughout. A trailing bare "star"
  // is that marker and nothing else — the word only ever appears mid-name
  // ("Team Star Grunt", "Star Piece"), and VSTAR carries no word boundary
  // before it, so Charizard VSTAR is untouched.
  t = t.replace(/\u2606|\u2605/g, " gold star ").replace(/\s*\b(?:gold\s+)?star\b\s*$/, " gold star ");
  // The printed level is decoration on a DP-era card and Cardmarket keeps it:
  // "Dialga Lv.68" is tcgdex's "Dialga". Not to be confused with LV.X, which
  // is a different card and has no digits after it.
  t = t.replace(/\blv\.?\s*\d+\b/g, " ");
  return norm(t).replace(/\s+/g, "");
}

/**
 * What may appear on our side of a name and not theirs. A closed list: these
 * are card variants, and anything not on it is a different card.
 */
// "star" is deliberately absent: Gold Star normalises to "goldstar" and needs
// no help, while a bare "star" would let VSTAR pass as V — two cards.
const VARIANT_SUFFIX = /^(lvx|ex|gx|v|vmax|vstar|goldstar)$/;

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
  if (a.length < 5 || b.length < 5) return false;
  // OUR name carrying a variant suffix theirs omits is the common case and a
  // safe one: tcgdex writes DP promo 37 as "Dialga" where Cardmarket writes
  // "Dialga LV.X", and within one set one number is one card, so a shared base
  // name means the set matched. 148 cards, nearly all of them LV.X.
  //
  // Only in that direction. Accepting THEIR name as the longer one would
  // quietly upgrade our plain Charizard to their Charizard V, which is a
  // different card at a different price — and nothing in the data suggests
  // tcgdex is the more verbose of the two.
  if (a.startsWith(b) && VARIANT_SUFFIX.test(a.slice(b.length))) return true;

  // Otherwise one name extending the other is never a typo, and only a
  // substitution in the middle gets the benefit of the doubt.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.startsWith(short) || long.endsWith(short)) return false;
  return withinOneEdit(a, b);
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
 * One card shape, whatever answered.
 *
 * Two sources describe a card differently — tcgdex hands back one extensionless
 * base URL and calls the number `localId`, pokemontcg.io hands back two ready
 * URLs and calls it `number` — and the matcher has no business knowing either.
 * So each source is flattened to `{ id, localId, name, small, large }` here,
 * once, and everything downstream reads that. A second place deriving a URL is
 * how one of them eventually ends up pointing at nothing.
 */
export function tcgdexCards(cards) {
  return (cards || []).map((c) => {
    const { small, large } = imageUrls(c.image);
    return { id: c.id, localId: c.localId, name: c.name, small, large };
  });
}

/**
 * pokemontcg.io. `images.small` is a ~40KB PNG and `images.large` the hi-res
 * one; a card of theirs without an `images` object is a listing without art,
 * which the matcher reports as a gap rather than a match with a null URL.
 *
 * PNG on both sides is incidentally what share.png needs — `drawableArt()`
 * only knows how to turn tcgdex's low.webp into a high.png, and a URL that is
 * already a PNG passes through it untouched.
 */
export function pokemontcgCards(cards) {
  return (cards || []).map((c) => ({
    id: c.id,
    localId: c.number,
    name: c.name,
    small: (c.images && c.images.small) || null,
    large: (c.images && c.images.large) || (c.images && c.images.small) || null
  }));
}

/**
 * Index a set family's cards by comparable number. Parent wins collisions.
 */
export function indexByNumber(family, cardsBySetId) {
  const byNumber = new Map();
  // Second index, on the digits alone. The Black Star Promos sets number their
  // cards SWSH001, SM01, XY01 where our catalogue holds the bare number —
  // about 1,200 cards across the six of them. Only consulted when the exact
  // key misses, and only where the digits pick out exactly ONE card in the
  // set: in a set holding both 1 and SV1, "1" is ambiguous and guessing would
  // put the Shiny Vault card's picture on the main-set one.
  const digitCounts = new Map();
  const byDigits = new Map();
  const parentId = family.length ? family[0].id : null;

  for (const part of family) {
    for (const card of cardsBySetId.get(part.id) || []) {
      const key = numKey(card.localId);
      if (!byNumber.has(key) || part.id === parentId) byNumber.set(key, card);
      const digits = key.replace(/^[a-z]+/, "");
      if (!digits) continue;
      digitCounts.set(digits, (digitCounts.get(digits) || 0) + 1);
      if (!byDigits.has(digits) || part.id === parentId) byDigits.set(digits, card);
    }
  }
  for (const [digits, n] of digitCounts) if (n > 1) byDigits.delete(digits);
  byNumber.set(DIGIT_INDEX, byDigits);
  return byNumber;
}

/** Where indexByNumber stashes the digits-only index on the returned map. */
export const DIGIT_INDEX = Symbol("digits");

/**
 * The whole decision for one catalogue row.
 *
 * Returns an outcome rather than throwing, so a backfill can report a
 * breakdown instead of stopping at the first oddity.
 */
export function matchCard(ours, byNumber) {
  const key = numKey(ours.number ?? ours.collector_number);
  const digits = byNumber.get(DIGIT_INDEX);
  const hit = byNumber.get(key) || (digits && !/^[a-z]/.test(key) ? digits.get(key) : undefined);
  if (!hit) return { outcome: "no-number" };
  if (!nameAgrees(ours.name, hit.name)) {
    return { outcome: "name-clash", theirName: hit.name, theirId: hit.id };
  }
  if (!hit.small) return { outcome: "no-art", theirId: hit.id, theirName: hit.name };
  return { outcome: "matched", theirId: hit.id, theirName: hit.name, small: hit.small, large: hit.large };
}
