/**
 * What can honestly be said about one sold listing.
 *
 * The workings screen shows a line under each price explaining what that sale
 * was — and on a screen whose whole claim is "here is the arithmetic", an
 * invented detail is worse than a blank line. SoldComps gives us a title, a
 * condition field, a postage figure and a date; that is the whole budget, so
 * every phrase below is read out of one of those and nothing is guessed.
 *
 * Notably absent: auction vs Buy It Now, bid counts and seller type. The mock
 * shows them because a mock can. The API doesn't return them, so they are not
 * here rather than being inferred from a title that may not mention them.
 */
const SIGNALS = [
  [/\b(gem\s*)?mint\b(?!\s*condition\s*\d)/i, "mint"],
  [/near\s*mint|\bnm\b/i, "near mint"],
  [/lightly\s*played|\blp\b/i, "lightly played"],
  [/moderately\s*played|\bmp\b/i, "moderately played"],
  [/heavily\s*played|\bhp\b/i, "heavily played"],
  [/\bplayed\b/i, "played"],
  [/\bcrease|creased\b/i, "creased"],
  [/\bwhitening\b/i, "edge whitening"],
  [/\bdamag(e|ed)\b/i, "damaged"],
  [/\bexcellent\b/i, "described as excellent"],
  [/\bgood condition\b/i, "described as good"],
  [/reverse\s*holo/i, "reverse holo"],
  [/\bholo(graphic)?\b/i, "holo"],
  [/1st\s*ed/i, "1st edition"],
  [/\bsleeved\b/i, "sleeved"],
  [/toploade?r?e?d?/i, "toploaded"],
  [/\btracked\b/i, "tracked postage"]
];

export function noteFor(sale) {
  const title = sale.title || "";
  const bits = [];

  // Condition first, and only once — "near mint" and "mint" both match a
  // title saying near mint, and listing both reads like two opinions.
  for (const [pattern, phrase] of SIGNALS) {
    if (bits.length >= 3) break;
    if (!pattern.test(title)) continue;
    if (bits.some((b) => b.includes(phrase) || phrase.includes(b))) continue;
    bits.push(phrase);
  }

  // The seller's own condition field, when the title said nothing.
  if (!bits.length && sale.condition) bits.push(String(sale.condition).toLowerCase());

  if (typeof sale.postagePence === "number") {
    bits.push(sale.postagePence === 0 ? "free postage" : null);
  }

  const line = bits.filter(Boolean).join(", ");
  if (!line) return "No condition stated by the seller.";
  return line.charAt(0).toUpperCase() + line.slice(1) + ".";
}

export default { noteFor };
