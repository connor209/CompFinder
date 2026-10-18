/**
 * Comp Finder — which ERA a Pokémon set belongs to, for the storefront's set
 * picker: "Wizards of the Coast" holding Base Set, Jungle and Fossil, then the
 * eras after it, so a visitor scrolls ten headings rather than two hundred sets.
 *
 * The catalogue has no era and no release date — `cm_sets` is Cardmarket's set
 * name and code, nothing else — so the eras are written down here, as
 * Cardmarket names the sets, oldest era first and each era's sets in release
 * order. That order IS the picker's order.
 *
 * A name is read in three steps, and a set none of them place is "Other sets",
 * never guessed into an era:
 *   1. the name exactly, as listed below;
 *   2. the LONGEST listed name it starts with — "Crown Zenith Galarian
 *      Gallery" is Crown Zenith, "Dragon Majesty" is not the EX era's "Dragon",
 *      "Base Set 2" is not "Base Set";
 *   3. an era's own prefix — "SM Black Star Promos", "XY Trainer Kit",
 *      "Sun & Moon Promos", Cardmarket's "EX " on every 2003–07 set.
 *
 * "&" and "and" are one word, as in set-index.js, because sellers and
 * catalogues spell them both ways.
 *
 * Framework-free, so the checks can load it under bare node.
 */
import { normalizeForMatch } from "@compfinder/core/setmatch.js";

export const OTHER_ERA = "other";

export const POKEMON_ERAS = [
  {
    key: "wotc", label: "Wizards of the Coast",
    prefixes: ["wizards", "wotc"],
    sets: [
      "Base Set", "Jungle", "Fossil", "Base Set 2", "Team Rocket", "Gym Heroes", "Gym Challenge",
      "Neo Genesis", "Neo Discovery", "Southern Islands", "Neo Revelation", "Neo Destiny",
      "Legendary Collection", "Expedition Base Set", "Aquapolis", "Skyridge",
      "Wizards Black Star Promos", "Best of Game"
    ]
  },
  {
    key: "ex", label: "EX",
    prefixes: ["ex", "nintendo"],
    sets: [
      "EX Ruby & Sapphire", "EX Sandstorm", "EX Dragon", "EX Team Magma vs Team Aqua", "EX Hidden Legends",
      "EX FireRed & LeafGreen", "EX Team Rocket Returns", "EX Deoxys", "EX Emerald", "EX Unseen Forces",
      "EX Delta Species", "EX Legend Maker", "EX Holon Phantoms", "EX Crystal Guardians",
      "EX Dragon Frontiers", "EX Power Keepers", "Nintendo Black Star Promos",
      "POP Series 1", "POP Series 2", "POP Series 3", "POP Series 4", "POP Series 5",
      // The same sets as tcgdex spells them, without Cardmarket's prefix.
      "Ruby & Sapphire", "Sandstorm", "Dragon", "Team Magma vs Team Aqua", "Hidden Legends",
      "FireRed & LeafGreen", "Team Rocket Returns", "Deoxys", "Emerald", "Unseen Forces",
      "Delta Species", "Legend Maker", "Holon Phantoms", "Crystal Guardians", "Dragon Frontiers", "Power Keepers"
    ]
  },
  {
    key: "dp", label: "Diamond & Pearl",
    prefixes: ["dp", "diamond and pearl"],
    sets: [
      "Diamond & Pearl", "Mysterious Treasures", "Secret Wonders", "Great Encounters", "Majestic Dawn",
      "Legends Awakened", "Stormfront", "DP Black Star Promos",
      "POP Series 6", "POP Series 7", "POP Series 8", "POP Series 9"
    ]
  },
  {
    key: "platinum", label: "Platinum",
    prefixes: ["platinum"],
    sets: ["Platinum", "Rising Rivals", "Supreme Victors", "Arceus"]
  },
  {
    key: "hgss", label: "HeartGold & SoulSilver",
    prefixes: ["hgss", "heartgold and soulsilver", "heartgold soulsilver"],
    sets: ["HeartGold & SoulSilver", "Unleashed", "Undaunted", "Triumphant", "Call of Legends", "HGSS Black Star Promos"]
  },
  {
    key: "bw", label: "Black & White",
    prefixes: ["bw", "black and white"],
    sets: [
      "Black & White", "Emerging Powers", "Noble Victories", "Next Destinies", "Dark Explorers",
      "Dragons Exalted", "Dragon Vault", "Boundaries Crossed", "Plasma Storm", "Plasma Freeze",
      "Plasma Blast", "Legendary Treasures", "BW Black Star Promos"
    ]
  },
  {
    key: "xy", label: "XY",
    prefixes: ["xy", "kalos"],
    sets: [
      "XY", "Flashfire", "Furious Fists", "Phantom Forces", "Primal Clash", "Double Crisis",
      "Roaring Skies", "Ancient Origins", "BREAKthrough", "BREAKpoint", "Generations",
      "Fates Collide", "Steam Siege", "Evolutions", "XY Black Star Promos"
    ]
  },
  {
    key: "sm", label: "Sun & Moon",
    prefixes: ["sm", "sun and moon"],
    sets: [
      "Sun & Moon", "Guardians Rising", "Burning Shadows", "Shining Legends", "Crimson Invasion",
      "Ultra Prism", "Forbidden Light", "Celestial Storm", "Dragon Majesty", "Lost Thunder",
      "Team Up", "Detective Pikachu", "Unbroken Bonds", "Unified Minds", "Hidden Fates",
      "Cosmic Eclipse", "SM Black Star Promos"
    ]
  },
  {
    key: "swsh", label: "Sword & Shield",
    prefixes: ["swsh", "sword and shield"],
    sets: [
      "Sword & Shield", "Rebel Clash", "Darkness Ablaze", "Champion's Path", "Vivid Voltage",
      "Shining Fates", "Battle Styles", "Chilling Reign", "Evolving Skies", "Celebrations",
      "Fusion Strike", "Brilliant Stars", "Astral Radiance", "Pokémon GO", "Lost Origin",
      "Silver Tempest", "Crown Zenith", "SWSH Black Star Promos"
    ]
  },
  {
    key: "sv", label: "Scarlet & Violet",
    prefixes: ["sv", "scarlet and violet"],
    sets: [
      "Scarlet & Violet", "Paldea Evolved", "Obsidian Flames", "151", "Paradox Rift", "Paldean Fates",
      "Temporal Forces", "Twilight Masquerade", "Shrouded Fable", "Stellar Crown", "Surging Sparks",
      "Prismatic Evolutions", "Journey Together", "Destined Rivals", "Black Bolt", "White Flare",
      "SV Black Star Promos"
    ]
  },
  {
    key: "me", label: "Mega Evolution",
    prefixes: ["mega evolution"],
    sets: ["Mega Evolution", "Phantasmal Flames"]
  }
];

/**
 * The era base sets, which the catalogue names after the era alone. A visitor
 * typing "base" into the picker is looking for these too — "Sun & Moon" is
 * the Sun & Moon BASE SET — so each carries "base set" as a word to find it by.
 */
const BASE_SETS = new Set(["Base Set", "Base Set 2", "Expedition Base Set", "EX Ruby & Sapphire", "Ruby & Sapphire",
  "Diamond & Pearl", "Platinum", "HeartGold & SoulSilver", "Black & White", "XY", "Sun & Moon",
  "Sword & Shield", "Scarlet & Violet", "Mega Evolution"].map(norm));

export function norm(s) {
  return normalizeForMatch(String(s || "").replace(/&/g, " and ")).trim();
}

const ERA_INDEX = new Map(POKEMON_ERAS.map((e, i) => [e.key, i]));
const EXACT = new Map();
const NAMES = [];
for (const era of POKEMON_ERAS) {
  era.sets.forEach((name, i) => {
    const n = norm(name);
    if (!EXACT.has(n)) EXACT.set(n, { era: era.key, order: i });
    NAMES.push({ n, era: era.key, order: i });
  });
}
NAMES.sort((a, b) => b.n.length - a.n.length);
const PREFIXES = POKEMON_ERAS
  .flatMap((e) => e.prefixes.map((p) => ({ p: norm(p), era: e.key })))
  .sort((a, b) => b.p.length - a.p.length);

/** { era, order } for a set name; era OTHER_ERA when nothing places it. */
export function eraPlace(setName) {
  const n = norm(setName);
  if (!n) return { era: OTHER_ERA, order: 0 };
  const exact = EXACT.get(n);
  if (exact) return exact;
  const longer = NAMES.find((x) => n.startsWith(`${x.n} `));
  if (longer) return { era: longer.era, order: longer.order + 0.5 };
  const pre = PREFIXES.find((x) => n.startsWith(`${x.p} `));
  if (pre) return { era: pre.era, order: 1000 };
  return { era: OTHER_ERA, order: 0 };
}

export function eraOf(setName) {
  return eraPlace(setName).era;
}

export function eraLabel(key) {
  if (key === OTHER_ERA) return "Other sets";
  return POKEMON_ERAS.find((e) => e.key === key)?.label || key;
}

export function isEra(key) {
  return key === OTHER_ERA || ERA_INDEX.has(key);
}

/** Oldest era first, Other last. */
export function eraRank(key) {
  return ERA_INDEX.has(key) ? ERA_INDEX.get(key) : POKEMON_ERAS.length;
}

/** Extra words a set can be found by in the picker's search. */
export function setSearchWords(setName) {
  return BASE_SETS.has(norm(setName)) ? "base set" : "";
}
