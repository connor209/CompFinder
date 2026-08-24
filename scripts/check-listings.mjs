/**
 * Which live listings may be shown, and which one may be the hero.
 *
 *   node scripts/check-listings.mjs      (or: npm run check)
 *
 * This guards the one number on the page that has no robustness. Everywhere
 * else a stray comp is absorbed by a median; the "buy it today for" figure is
 * a MINIMUM, so the worst match in the set is the headline — in the largest
 * type on the page, with an affiliate link under it.
 *
 * The fixture below is the real failure, from the live page on 24 Aug 2026:
 * Umbreon VMAX 215 Evolving Skies, eight sold comps, median £837.48, and a
 * hero reading "Buy it today for £44.75" pointing at a listing that was not
 * the card. Two leaks put it there — a title with no collector number sailing
 * through the sold-side guard, and cheap listings that DID carry 215/203 and
 * still weren't the card — so both a stricter number rule and a price floor
 * are needed, and this asserts each of them separately.
 */
import { safeListings, requireNumber, LISTING_FLOOR_FRACTION } from "../apps/public/lib/listings.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => { if (got !== want) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };

const listing = (pence, title) => ({ totalPence: pence, itemPricePence: pence, title, _source: { url: `https://www.ebay.co.uk/itm/${pence}` } });

// --- 1. the Umbreon that shipped -------------------------------------------
// Titles shortened as they appeared in the print, prices exact.
const UMBREON = [
  listing(4475, "The Pokémon Company Pokémon TCG Umbreon VMAX Evolving Skies"),  // no number at all
  listing(5772, "Umbreon VMAX 215/203 Secret Rare Holo Evolving Skies"),
  listing(6164, "Pokémon TCG Umbreon VMAX Holo Full Art Evolving Skies"),
  listing(8556, "Pokémon TCG Umbreon VMAX 215/203 Evolving Skies"),
  listing(74000, "Umbreon VMAX 215/203 Alt Art Evolving Skies NM"),
  listing(81000, "Pokemon Umbreon VMAX 215/203 Evolving Skies Secret Rare")
];
const SOLD_PENCE = 80845;   // what the page showed as "sells for"
const SOLD_USED = 8;

const umbreon = safeListings({ candidates: UMBREON, number: "215", soldPence: SOLD_PENCE, soldUsed: SOLD_USED });
if (!umbreon.listings.length) {
  fail("every Umbreon listing was rejected — an empty buy module is not the fix");
} else {
  const hero = umbreon.listings[0];
  if (hero.totalPence === 4475) {
    fail("the £44.75 listing is still the hero — this is the exact bug that shipped");
  }
  if (hero.totalPence < Math.round(SOLD_PENCE * LISTING_FLOOR_FRACTION)) {
    fail(`hero at ${hero.totalPence}p is below the floor for an ${SOLD_PENCE}p card — "${hero.title}"`);
  }
  // The four cheap ones all go: one for having no number, three for being
  // impossible at 5-10% of what the card sells for.
  eq("four implausible Umbreon listings rejected", umbreon.listings.length, 2);
  if (umbreon.suppressed < 1) fail("suppressed count should tell the page something was hidden");
}

// --- 2. the number rule, on its own ----------------------------------------
// A title with NO number is dropped here, unlike the sold-side guard where it
// is deliberately kept. Positive evidence, not absence of contrary evidence.
const NUMBERED = [
  listing(10000, "Umbreon VMAX 215/203 Evolving Skies"),
  listing(11000, "Umbreon VMAX 215/203 alt art"),
  listing(900, "Pokemon Umbreon VMAX Evolving Skies card"),      // no number
  listing(800, "Umbreon VMAX 095/203 Evolving Skies")            // a different print
];
const numbered = requireNumber(NUMBERED, "215");
eq("kept only the listings that say 215", numbered.kept.length, 2);
if (numbered.kept.some((l) => /095/.test(l.title))) fail("kept a listing for a different collector number");
if (numbered.kept.some((l) => !/215/.test(l.title))) fail("kept a listing with no collector number");

// An empty buy module is worse than a cautious one: where too few carry a
// number, fall back rather than showing nothing.
const FEW = [listing(1000, "Umbreon VMAX Evolving Skies"), listing(1100, "Umbreon VMAX holo")];
eq("falls back when almost nobody writes the number", requireNumber(FEW, "215").kept.length, 2);
// A card with no number of its own can't be filtered on one.
eq("no number to match on, nothing dropped", requireNumber(FEW, null).kept.length, 2);

// --- 3. the floor only applies where it can stand --------------------------
const CHEAP_CARD = [listing(80, "Weedle 12/102 Base Set"), listing(300, "Weedle 12/102 Base Set NM")];
eq(
  "a 90p card has no floor worth applying",
  safeListings({ candidates: CHEAP_CARD, number: "12", soldPence: 200, soldUsed: 9 }).suppressed,
  0
);
// One sale is not a market to measure listings against — suppressing real
// listings against it trades a visible error for an invisible one.
const THIN = [listing(4000, "Umbreon VMAX 215/203"), listing(90000, "Umbreon VMAX 215/203 alt art")];
eq(
  "no floor on a single-comp price",
  safeListings({ candidates: THIN, number: "215", soldPence: 90000, soldUsed: 1 }).suppressed,
  0
);
eq(
  "no floor when there is no price at all",
  safeListings({ candidates: THIN, number: "215", soldPence: null, soldUsed: 0 }).suppressed,
  0
);

// If EVERY listing is under the floor, the floor is likelier wrong than every
// seller — usually a sold figure inflated by graded slabs that shouldn't have
// counted. Show them and let the caveats carry the doubt.
const ALL_LOW = [listing(1000, "Umbreon VMAX 215/203"), listing(1200, "Umbreon VMAX 215/203 NM")];
const allLow = safeListings({ candidates: ALL_LOW, number: "215", soldPence: 90000, soldUsed: 9 });
eq("all-below-floor shows the listings anyway", allLow.listings.length, 2);
eq("and reports nothing suppressed, because nothing was", allLow.suppressed, 0);

// --- 4. a genuine bargain still gets through -------------------------------
// The job is catching a 5%-of-market fake, not adjudicating a good deal.
const BARGAIN = [listing(52000, "Umbreon VMAX 215/203 Evolving Skies played"), listing(90000, "Umbreon VMAX 215/203 NM")];
const bargain = safeListings({ candidates: BARGAIN, number: "215", soldPence: 84000, soldUsed: 8 });
eq("a keen seller at 62% of market survives", bargain.listings.length, 2);
eq("cheapest-first is still the order", bargain.listings[0].totalPence, 52000);

if (failures) {
  console.error(`\nlistings: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log("listings: the £44.75 Umbreon hero is rejected; number rule, floor, fallbacks and bargains all hold.");
