/**
 * The words and figures on a SET's shareable image.
 *
 * A set page is the one page here with real search volume behind it — "most
 * valuable cards in Prismatic Evolutions" is a thing people look up and link
 * to, which an individual card page never will be — and until now it unfurled
 * as a bare blue link. The card pages got a designed image months ago; the
 * pages people actually post got nothing.
 *
 * WHAT IT DRAWS IS A LEADERBOARD, not a price. The card image answers one
 * question with one number; a set has no single figure worth putting in 104px
 * type, and inventing one ("this set is worth £3,410") would be a claim about
 * a basket nobody owns. The top few cards WITH their values is the honest
 * version of the same hook, and it is what someone deciding whether to open
 * the link wants to know anyway.
 *
 * The standing rules from lib/share-card.js apply here unchanged and for the
 * same reasons: sold figures only — never an asking price, because this PNG
 * will still be legible in a Facebook group in March — and always DATED.
 * `fit` and `shortDate` are imported rather than re-written so the two images
 * cut long names and write dates identically.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";
import { fit, shortDate } from "./share-card.js";

const gbp = (pence) => (pence == null ? "—" : CompFinderPricing.toPoundsStr(pence));

/**
 * How many cards make the image.
 *
 * Five. At the size a platform actually unfurls this — a card in a chat
 * window, often half the width of a phone — the fourth and fifth rows are
 * already at the edge of legible, and a longer list makes every row smaller
 * rather than saying more. The link is one tap away from all 48.
 */
export const TOP_ROWS = 5;

export function setShareFields({ set, cards = [], now = new Date() } = {}) {
  const all = (Array.isArray(cards) ? cards : []).filter(Boolean);
  // Sorted here as well as in loadSetCards. It arrives dearest-first today,
  // but this is the file that promises a LEADERBOARD, and a board that is only
  // in order because its caller happened to sort is one refactor from being
  // wrong in public, on the image, under our own mark.
  const priced = all
    .filter((c) => c.pence != null)
    .sort((a, b) => b.pence - a.pence);

  return {
    name: fit((set && set.name) || "This set", 30),
    eyebrow: "Most valuable cards in",
    rows: priced.slice(0, TOP_ROWS).map((c, i) => ({
      rank: i + 1,
      // Shorter than the card image's 34: this name shares its line with a
      // price, and the price is the half nobody may lose.
      name: fit(c.name || "", 26),
      number: c.number ? `#${c.number}` : "",
      value: gbp(c.pence)
    })),
    // Says what the board is OF, and quietly why a card someone expected
    // isn't on it. "All 48" reads better than "48 of 48".
    basis: all.length && priced.length === all.length
      ? `All ${all.length} cards priced`
      : `${priced.length} of ${all.length} cards priced`,
    stamp: `eBay UK sold prices · ${shortDate(now)}`,
    domain: "lastcomp.co.uk"
  };
}

export default { setShareFields, TOP_ROWS };
