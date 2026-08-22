/**
 * PulseTCG's published figures, transcribed from their dashboard, kept in one
 * place so the comparison scripts cannot drift apart on the reference data
 * itself.
 *
 * WHAT A GAP DOES AND DOESN'T MEAN. Pulse is not a marketplace — it is a
 * scraper like ours, reading a different mix of sources. So a difference is
 * two estimates disagreeing, not automatically our error. What the comparison
 * is good for is SHAPE: an order-of-magnitude gap, or a card we cannot price
 * at all, is ours to explain. Cards within a sensible band are two independent
 * measurements agreeing, which is the strongest evidence available to us short
 * of tracking real sales ourselves.
 *
 * pulse = their market price in pence; vol30 = their 30-day sales volume.
 */
// PulseTCG monthly best sellers, transcribed from the dashboard.
// pulse = their market price in pence; vol30 = their 30-day sales volume.
export const REFERENCE = [
  { name: "Slowbro",              number: "090/084", set: "Pitch Black",   rarity: "IR",  pulse: 1200,  vol30: 584 },
  { name: "Goldeen",              number: "087/084", set: "Pitch Black",   rarity: "IR",  pulse: 961,   vol30: 543 },
  { name: "Mega Darkrai ex",      number: "116/084", set: "Pitch Black",   rarity: "SIR", pulse: 16106, vol30: 419 },
  { name: "Dhelmise",             number: "091/084", set: "Pitch Black",   rarity: "IR",  pulse: 447,   vol30: 413 },
  { name: "Fomantis",             number: "085/084", set: "Pitch Black",   rarity: "IR",  pulse: 396,   vol30: 359 },
  { name: "Primarina",            number: "088/084", set: "Pitch Black",   rarity: "IR",  pulse: 398,   vol30: 347 },
  { name: "Armarouge",            number: "086/084", set: "Pitch Black",   rarity: "IR",  pulse: 489,   vol30: 334 },
  { name: "Manectric",            number: "089/084", set: "Pitch Black",   rarity: "IR",  pulse: 334,   vol30: 331 },
  { name: "Morpeko ex",           number: "117/084", set: "Pitch Black",   rarity: "SIR", pulse: 6709,  vol30: 325 },
  { name: "Silvally",             number: "095/084", set: "Pitch Black",   rarity: "IR",  pulse: 418,   vol30: 307 },
  { name: "Toucannon",            number: "094/084", set: "Pitch Black",   rarity: "IR",  pulse: 403,   vol30: 301 },
  { name: "Morpeko ex",           number: "102/084", set: "Pitch Black",   rarity: "UR",  pulse: 682,   vol30: 289 },
  { name: "Mega Darkrai ex",      number: "101/084", set: "Pitch Black",   rarity: "UR",  pulse: 817,   vol30: 290 },
  { name: "Mega Zeraora ex",      number: "098/084", set: "Pitch Black",   rarity: "UR",  pulse: 765,   vol30: 290 },
  { name: "Mega Excadrill ex",    number: "103/084", set: "Pitch Black",   rarity: "UR",  pulse: 543,   vol30: 283 },
  { name: "Froakie",              number: "088/086", set: "Chaos Rising",  rarity: "IR",  pulse: 1015,  vol30: 279 },
  { name: "Thievul",              number: "092/084", set: "Pitch Black",   rarity: "IR",  pulse: 335,   vol30: 279 },
  { name: "Wailord ex",           number: "097/084", set: "Pitch Black",   rarity: "UR",  pulse: 471,   vol30: 276 },
  { name: "Mega Chandelure ex",   number: "099/084", set: "Pitch Black",   rarity: "UR",  pulse: 774,   vol30: 274 },
  { name: "Bastiodon",            number: "093/084", set: "Pitch Black",   rarity: "IR",  pulse: 423,   vol30: 273 },
  { name: "Mega Zeraora ex",      number: "114/084", set: "Pitch Black",   rarity: "SIR", pulse: 3885,  vol30: 260 },
  { name: "Misty's Vitality",     number: "111/084", set: "Pitch Black",   rarity: "UR",  pulse: 1405,  vol30: 257 },
  { name: "Rampardos ex",         number: "100/084", set: "Pitch Black",   rarity: "UR",  pulse: 488,   vol30: 255 },
  { name: "Xerneas",              number: "091/086", set: "Chaos Rising",  rarity: "IR",  pulse: 818,   vol30: 249 },
  { name: "Clefairy",             number: "094/088", set: "Perfect Order", rarity: "IR",  pulse: 1809,  vol30: 242 },
  { name: "Lurantis ex",          number: "096/084", set: "Pitch Black",   rarity: "UR",  pulse: 463,   vol30: 238 },
  { name: "Mega Chandelure ex",   number: "115/084", set: "Pitch Black",   rarity: "SIR", pulse: 3112,  vol30: 233 },
  { name: "Gladion's Final Battle", number: "118/084", set: "Pitch Black", rarity: "SIR", pulse: 2415, vol30: 235 },
  { name: "Gwynn",                number: "109/084", set: "Pitch Black",   rarity: "UR",  pulse: 586,   vol30: 230 },
  { name: "Ampharos",             number: "090/086", set: "Chaos Rising",  rarity: "IR",  pulse: 766,   vol30: 232 }
];

export default { REFERENCE };
