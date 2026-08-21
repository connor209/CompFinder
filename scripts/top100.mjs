/**
 * The approved 100-card list: current, high-volume, mostly higher-value
 * Pokémon singles. Built from TCGplayer's June/July 2026 top-seller reports,
 * eBay 2026 sales rankings, the PulseTCG best-seller list, and the chase cards
 * that dominate the modern secondary market.
 *
 * `name` and `number` are what a visitor gets by picking a suggestion; `q` is
 * the search text. Where a number is omitted the card is deliberately being
 * tested on the weaker free-text path.
 */
export const TOP_100 = [
  // --- current 2026 sets -------------------------------------------------
  { name: "Mega Greninja ex", number: "116/086", set: "Chaos Rising", band: "high" },
  { name: "Cinccino ex", number: "119/086", set: "Chaos Rising", band: "high" },
  { name: "Mega Greninja ex", number: "098/086", set: "Chaos Rising", band: "mid" },
  { name: "Beedrill ex", number: "003/086", set: "Chaos Rising", band: "low" },
  { name: "Froakie", number: "088/086", set: "Chaos Rising", band: "mid" },
  { name: "Xerneas", number: "091/086", set: "Chaos Rising", band: "mid" },
  { name: "Ampharos", number: "090/086", set: "Chaos Rising", band: "mid" },
  { name: "Mega Gengar ex", number: "269/217", set: "Ascended Heroes", band: "high" },
  { name: "Mega Dragonite ex", number: "271/217", set: "Ascended Heroes", band: "high" },
  { name: "Psyduck", number: "226/217", set: "Ascended Heroes", band: "high" },
  { name: "Meowth ex", number: "062/088", set: "Perfect Order", band: "low" },
  { name: "Clefairy", number: "094/088", set: "Perfect Order", band: "mid" },
  { name: "Mega Darkrai ex", number: "116/084", set: "Pitch Black", band: "high" },
  { name: "Morpeko ex", number: "117/084", set: "Pitch Black", band: "high" },
  { name: "Mega Zeraora ex", number: "114/084", set: "Pitch Black", band: "high" },
  { name: "Mega Chandelure ex", number: "115/084", set: "Pitch Black", band: "high" },
  { name: "Gladion's Final Battle", number: "118/084", set: "Pitch Black", band: "mid" },
  { name: "Misty's Vitality", number: "111/084", set: "Pitch Black", band: "mid" },
  { name: "Slowbro", number: "090/084", set: "Pitch Black", band: "mid" },
  { name: "Goldeen", number: "087/084", set: "Pitch Black", band: "mid" },
  { name: "Slowpoke", number: "086", set: "Mega Evolution", band: "low" },
  { name: "Mega Lucario ex", number: null, set: "Mega Evolution", band: "mid" },
  { name: "Mega Venusaur ex", number: null, set: "Mega Evolution", band: "mid" },
  { name: "Mega Gengar ex", number: null, set: "Phantasmal Flames", band: "low" },
  { name: "Hilda", number: null, set: "White Flare", band: "low" },

  // --- Prismatic Evolutions ----------------------------------------------
  { name: "Umbreon ex", number: "161/131", set: "Prismatic Evolutions", band: "high" },
  { name: "Umbreon ex", number: "060/131", set: "Prismatic Evolutions", band: "mid" },
  { name: "Sylveon ex", number: "156/131", set: "Prismatic Evolutions", band: "high" },
  { name: "Espeon ex", number: "155/131", set: "Prismatic Evolutions", band: "high" },
  { name: "Leafeon ex", number: "144/131", set: "Prismatic Evolutions", band: "mid" },
  { name: "Glaceon ex", number: "145/131", set: "Prismatic Evolutions", band: "mid" },
  { name: "Flareon ex", number: "146/131", set: "Prismatic Evolutions", band: "mid" },
  { name: "Vaporeon ex", number: "147/131", set: "Prismatic Evolutions", band: "mid" },
  { name: "Jolteon ex", number: "148/131", set: "Prismatic Evolutions", band: "mid" },
  { name: "Eevee ex", number: "167/131", set: "Prismatic Evolutions", band: "high" },

  // --- 151 -----------------------------------------------------------------
  { name: "Charizard ex", number: "199/165", set: "151", band: "high" },
  { name: "Charizard ex", number: "223/165", set: "151", band: "high" },
  { name: "Mew ex", number: "205/165", set: "151", band: "high" },
  { name: "Blastoise ex", number: "200/165", set: "151", band: "mid" },
  { name: "Venusaur ex", number: "198/165", set: "151", band: "mid" },
  { name: "Alakazam ex", number: "201/165", set: "151", band: "mid" },
  { name: "Zapdos", number: "145/165", set: "151", band: "mid" },
  { name: "Erika's Invitation", number: "203/165", set: "151", band: "mid" },

  // --- Evolving Skies ------------------------------------------------------
  { name: "Umbreon VMAX", number: "215/203", set: "Evolving Skies", band: "high" },
  { name: "Rayquaza VMAX", number: "218/203", set: "Evolving Skies", band: "high" },
  { name: "Sylveon VMAX", number: "211/203", set: "Evolving Skies", band: "high" },
  { name: "Espeon VMAX", number: "213/203", set: "Evolving Skies", band: "high" },
  { name: "Glaceon VMAX", number: "209/203", set: "Evolving Skies", band: "mid" },
  { name: "Leafeon VMAX", number: "205/203", set: "Evolving Skies", band: "mid" },
  { name: "Umbreon V", number: "189/203", set: "Evolving Skies", band: "mid" },
  { name: "Rayquaza V", number: "194/203", set: "Evolving Skies", band: "mid" },

  // --- recent Scarlet & Violet ---------------------------------------------
  { name: "Pikachu ex", number: "238/191", set: "Surging Sparks", band: "high" },
  { name: "Latias ex", number: "239/191", set: "Surging Sparks", band: "mid" },
  { name: "Milotic ex", number: "230/191", set: "Surging Sparks", band: "mid" },
  { name: "Terapagos ex", number: "170/142", set: "Stellar Crown", band: "mid" },
  { name: "Hydrapple ex", number: "167/142", set: "Stellar Crown", band: "mid" },
  { name: "Greninja ex", number: "214/167", set: "Twilight Masquerade", band: "high" },
  { name: "Bloodmoon Ursaluna ex", number: "216/167", set: "Twilight Masquerade", band: "high" },
  { name: "Fezandipiti ex", number: "092/064", set: "Shrouded Fable", band: "mid" },
  { name: "Pecharunt ex", number: "089/064", set: "Shrouded Fable", band: "mid" },
  { name: "Mew ex", number: "232/091", set: "Paldean Fates", band: "mid" },
  { name: "Charizard ex", number: "234/091", set: "Paldean Fates", band: "high" },
  { name: "Gardevoir ex", number: "233/091", set: "Paldean Fates", band: "mid" },
  { name: "Charizard ex", number: "223/197", set: "Obsidian Flames", band: "high" },
  { name: "Charizard ex", number: "215/197", set: "Obsidian Flames", band: "mid" },
  { name: "Roaring Moon ex", number: "251/182", set: "Paradox Rift", band: "mid" },
  { name: "Iron Valiant ex", number: "252/182", set: "Paradox Rift", band: "mid" },
  { name: "Iron Crown ex", number: "206/162", set: "Temporal Forces", band: "mid" },
  { name: "Walking Wake ex", number: "205/162", set: "Temporal Forces", band: "mid" },
  { name: "Team Rocket's Mewtwo ex", number: null, set: "Destined Rivals", band: "mid" },
  { name: "N's Zoroark ex", number: null, set: "Journey Together", band: "mid" },

  // --- promos --------------------------------------------------------------
  { name: "Charmander", number: "044", set: "SVP Promo", band: "high" },
  { name: "Mew ex", number: "053", set: "SVP Promo", band: "high" },
  { name: "Pikachu with Grey Felt Hat", number: "085", set: "Promo", band: "high" },
  { name: "Van Gogh Pikachu", number: "085", set: "Promo", band: "high" },
  { name: "Poncho Pikachu", number: null, set: "Promo", band: "high" },

  // --- established chase ---------------------------------------------------
  { name: "Charizard", number: "4/102", set: "Base Set", band: "high" },
  { name: "Charizard VMAX", number: "074/073", set: "Champion's Path", band: "high" },
  { name: "Charizard V", number: "079/073", set: "Champion's Path", band: "mid" },
  { name: "Pikachu VMAX", number: "044/185", set: "Vivid Voltage", band: "mid" },
  { name: "Charizard", number: "11/108", set: "Evolutions", band: "mid" },
  { name: "Lugia V", number: "186/195", set: "Silver Tempest", band: "high" },
  { name: "Giratina V", number: "186/196", set: "Lost Origin", band: "high" },
  { name: "Pikachu", number: "58/102", set: "Base Set", band: "mid" },
  { name: "Blastoise", number: "2/102", set: "Base Set", band: "high" },
  { name: "Venusaur", number: "15/102", set: "Base Set", band: "mid" },
  { name: "Mewtwo GX", number: "72/73", set: "Shining Legends", band: "mid" },
  { name: "Charizard GX", number: "SM211", set: "SM Black Star Promo", band: "high" },

  // --- high-volume cheap staples -------------------------------------------
  { name: "Rare Candy", number: null, set: null, band: "low" },
  { name: "Professor's Research", number: null, set: null, band: "low" },
  { name: "Boss's Orders", number: null, set: null, band: "low" },
  { name: "Iono", number: "237/193", set: "Paldea Evolved", band: "mid" },
  { name: "Nest Ball", number: null, set: null, band: "low" },
  { name: "Ultra Ball", number: null, set: null, band: "low" },
  { name: "Arven", number: "235/198", set: "Scarlet & Violet", band: "low" },
  { name: "Buddy-Buddy Poffin", number: null, set: null, band: "low" },
  { name: "Super Rod", number: null, set: null, band: "low" },
  { name: "Earthen Vessel", number: null, set: null, band: "low" },
  { name: "Counter Catcher", number: null, set: null, band: "low" },
  { name: "Night Stretcher", number: null, set: null, band: "low" }
].map((c) => ({
  ...c,
  q: [c.name, c.number, c.set].filter(Boolean).join(" ")
}));
