/**
 * PulseTCG's biggest movers, transcribed from the dashboard.
 *
 * Deliberately harder than the top-100 list: promo numbering that doesn't look
 * like a collector number (MEP029, SWSH291, SVP088), Trainer Gallery codes
 * (TG02/TG30), printing variants that are separately priced (Reverse Holo,
 * Cosmos Holo, Cracked Ice Holo), graded entries sitting in a raw price list
 * (ACE 10), and a lot of cards with one to three sales behind them.
 *
 * `variant` and `graded` are what Pulse's price actually refers to — without
 * them a comparison would mark our raw price wrong against their slab price.
 */
export const MOVERS = [
  { name: "Snorunt", number: "200/193", set: "MEGA Dream ex", pulse: 203, chg: 70.6, vol: 2, variant: "Holo" },
  { name: "Starmie", number: "121/165", set: "Scarlet & Violet 151", pulse: 384, chg: 62.7, vol: 1, variant: "Reverse Holo" },
  { name: "Legacy Energy", number: "167/167", set: "Twilight Masquerade", pulse: 382, chg: 57.2, vol: 17, variant: "Holo" },
  { name: "Mega Charizard X ex", number: "MEP029", set: "Mega Evolutions Promos", pulse: 587, chg: 54.9, vol: 10, variant: "Holo" },
  { name: "Charizard V", number: "153/172", set: "Brilliant Stars", pulse: 2790, chg: 52.0, vol: 10 },
  { name: "Vaporeon", number: "TG02/TG30", set: "Brilliant Stars Trainer Gallery", pulse: 1891, chg: 46.7, vol: 15, variant: "Holo" },
  { name: "Inkay", number: "SV17/SV94", set: "Hidden Fates", pulse: 349, chg: 44.2, vol: 3, variant: "Holo" },
  { name: "Lucario VSTAR", number: "SWSH291", set: "Sword & Shield Promos", pulse: 1513, chg: 44.1, vol: 17 },
  { name: "Galarian Slowpoke", number: "SWSH126", set: "Sword & Shield Promos", pulse: 998, chg: 43.0, vol: 4, variant: "Cosmos Holo" },
  { name: "Charcadet", number: "MEP022", set: "Mega Evolutions Promos", pulse: 385, chg: 41.0, vol: 7, variant: "Holo" },
  { name: "Pikachu V", number: "170/185", set: "Vivid Voltage", pulse: 2399, chg: 40.3, vol: 1, variant: "Holo" },
  { name: "Rayquaza V", number: "SWSH147", set: "Sword & Shield Promos", pulse: 1418, chg: 40.1, vol: 5 },
  { name: "Chesnaught V", number: "015/195", set: "Silver Tempest", pulse: 154, chg: 40.0, vol: 1 },
  { name: "Spearow", number: "151/132", set: "Mega Evolution", pulse: 561, chg: 39.9, vol: 12, variant: "Holo" },
  { name: "Salazzle ex", number: "101/088", set: "Perfect Order", pulse: 545, chg: 39.7, vol: 11, variant: "Holo" },
  { name: "Primarina", number: "020/084", set: "Pitch Black", pulse: 159, chg: 39.5, vol: 6, variant: "Reverse Holo" },
  { name: "Tyranitar ex", number: "064/131", set: "Prismatic Evolutions", pulse: 182, chg: 38.9, vol: 5, variant: "Holo" },
  { name: "Xurkitree", number: "SV14/SV94", set: "Hidden Fates", pulse: 532, chg: 38.9, vol: 4, variant: "Holo" },
  { name: "Mega Venusaur ex", number: "MEP013", set: "Mega Evolutions Promos", pulse: 275, chg: 38.2, vol: 5, variant: "Holo" },
  { name: "Latias ex", number: "076/191", set: "Surging Sparks", pulse: 584, chg: 37.7, vol: 12 },
  { name: "Mega Gengar ex", number: "125/217", set: "Ascended Heroes", pulse: 405, chg: 35.9, vol: 12, variant: "Holo" },
  { name: "Umbreon V", number: "094/203", set: "Evolving Skies", pulse: 734, chg: 35.7, vol: 2 },
  { name: "Greninja ex", number: "106/167", set: "Twilight Masquerade", pulse: 388, chg: 35.7, vol: 7 },
  { name: "Dondozo", number: "207/198", set: "Scarlet & Violet", pulse: 1345, chg: 35.5, vol: 9 },
  { name: "Air Balloon", number: "166/132", set: "Mega Evolution", pulse: 338, chg: 35.2, vol: 4, variant: "Holo" },
  { name: "Dusk Mane Necrozma GX", number: "145/156", set: "Ultra Prism", pulse: 1745, chg: 35.0, vol: 1, variant: "Holo" },
  { name: "Horsea", number: "067/064", set: "Night Wanderer", pulse: 816, chg: 34.9, vol: 5, variant: "Holo" },
  { name: "Pikachu", number: "SVP088", set: "Scarlet & Violet Promos", pulse: 3448, chg: 34.5, vol: 7 },
  { name: "Meltan", number: "179/162", set: "Temporal Forces", pulse: 510, chg: 34.2, vol: 3 },
  { name: "Meganium", number: "010/132", set: "Mega Evolution", pulse: 134, chg: 34.0, vol: 2, variant: "Holo" },
  { name: "Jirachi", number: "119/185", set: "Vivid Voltage", pulse: 5059, chg: 33.6, vol: 3, variant: "Holo", graded: "ACE 10" },
  { name: "Flareon", number: "SVP167", set: "Scarlet & Violet Promos", pulse: 220, chg: 33.3, vol: 3, variant: "Cosmos Holo" },
  { name: "Celebi V", number: "007/198", set: "Chilling Reign", pulse: 261, chg: 33.2, vol: 1 },
  { name: "Tornadus VMAX", number: "125/198", set: "Chilling Reign", pulse: 260, chg: 32.6, vol: 2 },
  { name: "Ting-Lu ex", number: "275/193", set: "Paldea Evolved", pulse: 546, chg: 32.2, vol: 2 },
  { name: "Mega Pyroar ex", number: "099/086", set: "Chaos Rising", pulse: 566, chg: 31.9, vol: 16, variant: "Holo" },
  { name: "Misty's Water Command", number: "63/68", set: "Hidden Fates", pulse: 186, chg: -32.6, vol: 3, variant: "Holo" },
  { name: "Mega Golurk ex", number: "109/076", set: "Storm Emerald", pulse: 1805, chg: -32.6, vol: 3, variant: "Holo" },
  { name: "Regieleki VMAX", number: "058/195", set: "Silver Tempest", pulse: 119, chg: -33.1, vol: 3 },
  { name: "Gourgeist ex", number: "041/086", set: "Chaos Rising", pulse: 111, chg: -33.5, vol: 8, variant: "Holo" },
  { name: "Gengar", number: "050/088", set: "Perfect Order", pulse: 186, chg: -33.8, vol: 11, variant: "Reverse Holo" },
  { name: "Brock's Scouting", number: "179/159", set: "Journey Together", pulse: 240, chg: -33.9, vol: 5 },
  { name: "Latias & Latios GX", number: "169/181", set: "Team Up", pulse: 4329, chg: -34.5, vol: 1, variant: "Holo" },
  { name: "Scorbunny", number: "225/217", set: "Ascended Heroes", pulse: 625, chg: -34.6, vol: 7, variant: "Holo" },
  { name: "Galarian Rapidash", number: "082/202", set: "Sword & Shield", pulse: 324, chg: -35.3, vol: 3 },
  { name: "Firebreather", number: "119/094", set: "Phantasmal Flames", pulse: 190, chg: -35.4, vol: 7, variant: "Holo" },
  { name: "Slowbro", number: "090/084", set: "Pitch Black", pulse: 4433, chg: -36.6, vol: 8, variant: "Holo", graded: "ACE 10" },
  { name: "Team Rocket's Persian ex", number: "150/182", set: "Destined Rivals", pulse: 142, chg: -37.7, vol: 8, variant: "Holo" },
  { name: "Pikachu ex", number: "033/106", set: "Super Electric Breaker", pulse: 204, chg: -40.5, vol: 3, variant: "Holo" },
  { name: "Blastoise", number: "25/181", set: "Team Up", pulse: 933, chg: -64.1, vol: 2, variant: "Cracked Ice Holo" }
].map((c) => ({ ...c, q: `${c.name} ${c.number} ${c.set}` }));
