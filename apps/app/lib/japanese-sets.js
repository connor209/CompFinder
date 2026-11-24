/**
 * Cardmarket's names for Japanese Pokémon sets → the set code printed on the
 * card and written by sellers ("Pokemon Card 151" → sv2a).
 *
 * CardUploader exports carry Cardmarket's set NAME and no code, and Japanese
 * cards sell under the code far more than under any English name — so the
 * search ladder's set-code rung and the language marker both read this.
 * Hand-written, modern sets only; a set not listed simply has no code rung.
 * A wrong code costs one wasted search and never a card: the rung is a
 * search, and the filter still judges every sale. Add a line when a batch
 * brings a new set.
 *
 * App-side. packages/core is untouched.
 */

const TABLE = {
  // Scarlet & Violet era
  "scarlet ex": "sv1S",
  "violet ex": "sv1V",
  "triplet beat": "sv1a",
  "snow hazard": "sv2P",
  "clay burst": "sv2D",
  "pokemon card 151": "sv2a",
  "ruler of the black flame": "sv3",
  "raging surf": "sv3a",
  "ancient roar": "sv4K",
  "future flash": "sv4M",
  "shiny treasure ex": "sv4a",
  "wild force": "sv5K",
  "cyber judge": "sv5M",
  "crimson haze": "sv5a",
  "mask of change": "sv6",
  "night wanderer": "sv6a",
  "stellar miracle": "sv7",
  "paradise dragona": "sv7a",
  "super electric breaker": "sv8",
  "terastal festival ex": "sv8a",
  "battle partners": "sv9",
  "hot air arena": "sv9a",
  "glory of the rocket gang": "sv10",
  "black bolt": "sv11B",
  "white flare": "sv11W",
  "mega brave": "m1L",
  "mega symphonia": "m1S",
  "inferno x": "m2",
  "mega dream ex": "m2a",
  // Sword & Shield era
  "sword": "s1W",
  "shield": "s1H",
  "vmax rising": "s1a",
  "rebellion crash": "s2",
  "explosive walker": "s2a",
  "infinity zone": "s3",
  "legendary heartbeat": "s3a",
  "amazing volt tackle": "s4",
  "shiny star v": "s4a",
  "single strike master": "s5I",
  "rapid strike master": "s5R",
  "matchless fighters": "s5a",
  "silver lance": "s6H",
  "jet black spirit": "s6K",
  "jet black poltergeist": "s6K",
  "skyscraping perfection": "s7D",
  "blue sky stream": "s7R",
  "pokemon go": "s10b",
  "eevee heroes": "s6a",
  "fusion arts": "s8",
  "vmax climax": "s8b",
  "star birth": "s9",
  "battle region": "s9a",
  "time gazer": "s10D",
  "space juggler": "s10P",
  "dark phantasma": "s10a",
  "lost abyss": "s11",
  "incandescent arcana": "s11a",
  "paradigm trigger": "s12",
  "vstar universe": "s12a",
  "25th anniversary collection": "s8a",
  // Sun & Moon era
  "collection sun": "sm1S",
  "collection moon": "sm1M",
  "islands awaiting you": "sm2K",
  "alolan moonlight": "sm2L",
  "facing a new trial": "sm2+",
  "did you see the fighting rainbow": "sm3H",
  "to have seen the battle rainbow": "sm3H",
  "light consuming darkness": "sm3N",
  "darkness that consumes light": "sm3N",
  "shining legends": "sm3+",
  "awakened heroes": "sm4S",
  "the awoken hero": "sm4S",
  "ultradimensional beasts": "sm4A",
  "gx battle boost": "sm4+",
  "ultra sun": "sm5S",
  "ultra moon": "sm5M",
  "ultra force": "sm5+",
  "forbidden light": "sm6",
  "dragon storm": "sm6a",
  "champion road": "sm6b",
  "sky splitting charisma": "sm7",
  "thunderclap spark": "sm7a",
  "fairy rise": "sm7b",
  "super burst impact": "sm8",
  "dark order": "sm8a",
  "gx ultra shiny": "sm8b",
  "tag bolt": "sm9",
  "night unison": "sm9a",
  "full metal wall": "sm9b",
  "double blaze": "sm10",
  "gg end": "sm10a",
  "sky legend": "sm10b",
  "miracle twin": "sm11",
  "remix bout": "sm11a",
  "dream league": "sm11b",
  "alter genesis": "sm12",
  "tag all stars": "sm12a"
};

const key = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The printed set code for a Cardmarket Japanese set name, or "". */
export function japaneseSetCode(setName) {
  return TABLE[key(setName)] || "";
}

export const JAPANESE_SET_CODES = Object.freeze({ ...TABLE });
