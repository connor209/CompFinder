/**
 * Comp Finder — "do we already have this card?"
 *
 * When a batch is priced, every row is checked against two things we already
 * know:
 *
 *   1. our LIVE eBay listings (`ebay_listings`) — are we selling one right
 *      now, and at what price?
 *   2. our OWN price history (`price_checks`) — what did we decide this card
 *      was worth last time we looked?
 *
 * Both answers matter for the same reason: a new copy should go up in line
 * with the one already on the shelf, not undercut it by accident.
 *
 * Matching is deliberately conservative. A SKU match is exact and trusted. A
 * card match (collector number + first word of the name) is only trusted when
 * it is unambiguous — if two different listings answer to the same key, the
 * row is reported as ambiguous with the count, rather than picking one — and
 * when it is the same PRINTING: the reverse holo and the plain copy share a
 * key, share a name and a number, and are two different cards at two
 * different prices. See printingOf() below.
 */
import CompFinderPricing from "@compfinder/core/pricing.js";

/** Normalise a word for keying: lowercase, letters and digits only. */
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Normalise a collector number: "030 / 149" and "30/149" are the same card. */
function normNumber(n) {
  const s = String(n || "").toLowerCase().replace(/\s+/g, "");
  const m = /^([a-z]{0,3})0*(\d+)\s*\/\s*([a-z]{0,3})0*(\d+)$/.exec(s);
  if (m) return `${m[1]}${m[2]}/${m[3]}${m[4]}`;
  return s.replace(/^0+(?=\d)/, "");
}

/**
 * The key a card is filed under: its collector number plus the first
 * meaningful word of its name. Number alone would collide across sets and
 * games; the full name is too brittle (M-Rayquaza vs "M Rayquaza EX").
 * Returns null when there isn't enough to key on — better no match than a
 * wrong one.
 */
export function cardKey({ name, number }) {
  const num = normNumber(number);
  const word = norm(String(name || "").split(/\s+/)[0]);
  if (!num || !word) return null;
  return `${num}|${word}`;
}

/** The same key, derived from a free-text listing title. */
export function keyFromTitle(title) {
  const { number, nameTokens } = CompFinderPricing.buildCardQuery(title || "");
  return cardKey({ name: (nameTokens || [])[0] || "", number });
}

/**
 * WHICH PRINTING of a card a title is talking about.
 *
 * `cardKey()` above stops at the collector number and one word of the name,
 * and that is as far as identity goes: a Shedinja 14/107 and a Shedinja
 * 14/107 Reverse Holo are one key and are not one card. They are printed,
 * collected and PRICED separately — the engine already refuses to pool them
 * (`variantMismatch` in packages/core/pricing.js, after a £7.97 Reverse Holo
 * landed in a £2.34-£3.48 comp set) — so a batch row reading "In stock ·
 * £2.37" off the copy we hold in the other printing is that same mistake one
 * screen further on, with a price and a delta attached to it.
 *
 * A slab is the same problem with a bigger gap. A PSA 10 on the shelf is not
 * evidence about the raw copy in the run, and the difference between them is
 * multiples rather than pennies.
 *
 * Read off the TITLE, because that is where it is written. CardUploader's own
 * `*C:Finish` column is unreliable for exactly this — 25 of 30 Reverse Holo
 * cards left it blank, see the note at the top of lib/carduploader.js — and
 * `\breverse\s*holo\b` is the spelling core and the CSV reader already agree
 * on, so this is the same reading in a third place rather than a new one.
 */
const REVERSE_HOLO_PATTERN = /\breverse\s*holo\b/i;

export function printingOf(title) {
  const t = String(title || "");
  // subjectGradeFrom() rather than a grade regex of our own: it is the one
  // definition of "the card in my hand is a slab", NOT_GRADED_PATTERN guard
  // and all. Both sides here are titles of cards we hold, which is exactly
  // the question it answers.
  const graded = CompFinderPricing.subjectGradeFrom(t);
  return {
    reverse: REVERSE_HOLO_PATTERN.test(t),
    graded: !!graded,
    // Grades kept apart, companies pooled — the same split the engine makes
    // on its comps. PSA over CGC is a real premium and nothing like the gap
    // between a 10 and an 8.
    grade: graded ? graded.grade : null
  };
}

/**
 * Are two printings the same object?
 *
 * Only ever used to REFUSE a match, so it errs toward yes: a difference has
 * to be written down in both titles before it counts. A slab whose grade
 * would not parse is still a slab, and splitting on a number neither seller
 * typed would drop a real match on a detail nobody stated.
 */
export function samePrinting(a, b) {
  if (!a || !b) return true;
  if (a.reverse !== b.reverse) return false;
  if (a.graded !== b.graded) return false;
  if (a.graded && b.graded && a.grade != null && b.grade != null && a.grade !== b.grade) return false;
  return true;
}

/**
 * What the other printing IS, in words, from the point of view of the row
 * being priced — "non-reverse", "reverse holo", "graded 10", "raw". Empty
 * string when they are the same card.
 *
 * The near miss is worth saying rather than swallowing: "we have the
 * non-reverse" is a useful thing to know while pricing the reverse, and a
 * match that silently disappeared would look exactly like a card we have
 * never listed.
 */
export function printingDiff(want, other) {
  if (!want || !other) return "";
  const parts = [];
  if (want.reverse !== other.reverse) parts.push(other.reverse ? "reverse holo" : "non-reverse");
  if (want.graded !== other.graded) {
    parts.push(other.graded ? (other.grade != null ? `graded ${other.grade}` : "graded") : "raw");
  } else if (want.graded && other.graded && want.grade != null && other.grade != null && want.grade !== other.grade) {
    parts.push(`graded ${other.grade}`);
  }
  return parts.join(", ");
}

/**
 * Index the user's live listings by SKU and by card key.
 * `listings` are rows from `ebay_listings`.
 */
export function buildStockIndex(listings) {
  const bySku = new Map();
  const byCard = new Map();
  for (const l of listings || []) {
    const entry = {
      sku: l.sku || "",
      itemId: l.ebay_item_id,
      title: l.title || "",
      url: l.url || "",
      pricePence: l.price_value != null ? Math.round(Number(l.price_value) * 100) : null,
      currency: l.price_currency || "GBP",
      quantity: l.quantity ?? null
    };
    if (entry.sku) {
      const list = bySku.get(entry.sku) || [];
      list.push(entry);
      bySku.set(entry.sku, list);
    }
    const key = keyFromTitle(entry.title);
    if (key) {
      const list = byCard.get(key) || [];
      list.push(entry);
      byCard.set(key, list);
    }
  }
  return { bySku, byCard, size: (listings || []).length };
}

/** A printing, flattened to something a Map can key on. */
function printingSig(p) {
  return `${p.reverse ? "rev" : "-"}|${p.graded ? (p.grade != null ? `g${p.grade}` : "g") : "raw"}`;
}

/**
 * Index past price checks by SKU and card key, keeping only the most recent
 * for each — "what did we say last time" is one number, not a history.
 * `checks` are rows from `price_checks`.
 *
 * One number PER PRINTING, though. Keeping a single newest row per card key
 * would have the reverse holo priced last Tuesday answer for the plain copy
 * priced this morning, on the strength of being newer; they are different
 * cards and each has its own last price. Newest first within a key, so a
 * caller that has to fall back to a different printing falls back to the
 * freshest one.
 */
export function buildHistoryIndex(checks) {
  const bySku = new Map();
  const byPrinting = new Map(); // card key -> Map(printing signature -> row)
  const keep = (map, key, row) => {
    if (!key) return;
    const cur = map.get(key);
    if (!cur || String(row.created_at) > String(cur.created_at)) map.set(key, row);
  };
  for (const c of checks || []) {
    if (c.recommended_pence == null) continue;
    const row = {
      pricePence: c.recommended_pence,
      created_at: c.created_at,
      confidence: c.confidence || "",
      title: c.title || ""
    };
    if (c.sku) keep(bySku, c.sku, row);
    const key = keyFromTitle(c.title);
    if (!key) continue;
    const bucket = byPrinting.get(key) || new Map();
    keep(bucket, printingSig(printingOf(c.title)), row);
    byPrinting.set(key, bucket);
  }
  const byCard = new Map();
  for (const [key, bucket] of byPrinting) {
    byCard.set(key, [...bucket.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
  }
  return { bySku, byCard };
}

/**
 * Look one batch row up in an index. Returns null (no match), or
 * { match, via, count, ambiguous, otherPrinting } where `via` is "sku" or
 * "card" and `otherPrinting` names the printing when the only thing found
 * under the key is a DIFFERENT one ("non-reverse", "graded 10") — empty
 * string when it is the same card.
 *
 * A SKU match is exact and stays trusted: the SKU is on the sleeve of that
 * physical copy, so it cannot be the wrong printing of it. The card key can
 * be, and is checked.
 */
function lookup(index, { sku, name, number, title, printing }) {
  if (!index) return null;
  if (sku && index.bySku.has(sku)) {
    const list = index.bySku.get(sku);
    const arr = Array.isArray(list) ? list : [list];
    return { match: arr[0], via: "sku", count: arr.length, ambiguous: false, otherPrinting: "" };
  }
  const key = name || number ? cardKey({ name, number }) : keyFromTitle(title);
  if (!key || !index.byCard.has(key)) return null;
  const list = index.byCard.get(key);
  const arr = Array.isArray(list) ? list : [list];
  const want = printing || printingOf(title);
  const same = arr.filter((e) => samePrinting(printingOf(e.title), want));
  // Several different listings under one key: report it, don't guess.
  if (same.length) {
    return { match: same[0], via: "card", count: same.length, ambiguous: same.length > 1, otherPrinting: "" };
  }
  // Nothing under this key is this printing. Hand back the nearest thing with
  // a label on it rather than nothing at all — but a caller that spends money
  // or draws a delta has to read `otherPrinting` first, because this price is
  // about a different object.
  const other = arr[0];
  return {
    match: other,
    via: "card",
    count: arr.length,
    ambiguous: false,
    otherPrinting: printingDiff(want, printingOf(other.title)) || "a different printing"
  };
}

/**
 * Annotate one batch row with what we already know about that card.
 * `row` needs { sku, title } and, when it came from a CardUploader CSV,
 * { csvItem: { cardName, cardNumber } } for the more reliable key.
 */
export function checkRow(row, { stock, history } = {}) {
  const ident = {
    sku: row?.sku || "",
    name: row?.csvItem?.cardName || "",
    number: row?.csvItem?.cardNumber || "",
    title: row?.title || "",
    // Which printing this row IS, read once off the title — the same place
    // carduploader.js reads it from when it builds the query, and for the
    // same reason: the CSV's own finish column does not say.
    printing: printingOf(row?.title || "")
  };
  return {
    stock: lookup(stock, ident),
    history: lookup(history, ident)
  };
}

/**
 * How a recommendation compares to what we're already asking. Used to flag
 * the rows worth a human glance rather than to change any price.
 */
export function priceGap(recommendedPence, listedPence) {
  if (recommendedPence == null || listedPence == null || listedPence <= 0) return null;
  const delta = recommendedPence - listedPence;
  return { delta, pct: (delta / listedPence) * 100, big: Math.abs(delta) >= 300 && Math.abs(delta / listedPence) >= 0.2 };
}

/**
 * Is a listing actually buyable, or a shell of one that has already sold?
 *
 * eBay's out-of-stock control keeps a sold-out fixed-price listing in the
 * seller's ActiveList with `QuantityAvailable` at 0 — same item id, same
 * price, still "active" as far as the API is concerned, and invisible to
 * buyers. That is how a card that sold months ago is still a row in
 * `ebay_listings`, and it is why **"the SKU is in ebay_listings" was never the
 * same question as "we still have the card"**. Everything that reads a card's
 * listing to decide whether we still own it has to ask this instead.
 *
 * **Unknown is not sold out.** `normalizeItem()` in lib/ebay.js stores null
 * when eBay sends neither QuantityAvailable nor Quantity, and reading a
 * missing field as zero would empty a seller's whole show shortlist on the
 * strength of a field eBay didn't send. Only an explicit number at or below
 * zero counts as gone.
 */
export function isListingAvailable(listing) {
  const q = listing?.quantity;
  // `Number("")` is 0, which would read an empty column as sold out. It isn't
  // one — it is the same silence as a null.
  if (q == null || q === "") return true;
  const n = Number(q);
  return Number.isFinite(n) ? n > 0 : true;
}

/** The lowercased SKUs we can still actually sell, out of a set of listings. */
export function availableSkus(listings) {
  const set = new Set();
  for (const l of listings || []) {
    if (!l?.sku || !isListingAvailable(l)) continue;
    set.add(String(l.sku).toLowerCase());
  }
  return set;
}

/**
 * Index the checkouts that are still OUT, for the question below.
 * `checkouts` are `stock_checkouts` rows; resolved ones are ignored, because
 * a card that came home or was sold at the table is not away any more.
 *
 * By item id first and SKU second: the item id is what we actually zeroed, and
 * it survives a SKU that was typed differently on the sleeve.
 */
export function awayIndex(checkouts) {
  const byItem = new Map();
  const bySku = new Map();
  for (const co of checkouts || []) {
    if (!co || co.resolved_at) continue;
    if (co.ebay_item_id) byItem.set(String(co.ebay_item_id), co);
    if (co.sku) bySku.set(String(co.sku).toLowerCase(), co);
  }
  return { byItem, bySku };
}

/**
 * WHY is this listing at quantity zero?
 *
 * There are two completely different answers and they want opposite
 * treatment, which is the whole reason this function exists:
 *
 * - **We zeroed it ourselves**, checking the card out to a show (migration
 *   016, `hide_method: "quantity"`). The card is in a box on a table and is
 *   very much still ours. Hiding that row would hide the stock you are
 *   standing next to.
 * - **eBay zeroed it**, because the card sold. The listing is a shell of one
 *   and the card left the building months ago. That row is noise in a list of
 *   what you have to sell.
 *
 * Returns `{ state, checkout, suspect }` where state is:
 *   "live"    — buyable, or quantity unknown. Unknown is never sold out; see
 *               isListingAvailable().
 *   "show"    — zero, and an open checkout explains it.
 *   "gone"    — zero, and nothing explains it.
 *   "unknown" — zero, and we could not ask (no checkout data). NOT "gone":
 *               a probe that failed is not evidence, and guessing wrong in
 *               that direction hides real stock.
 *
 * `suspect` is set when an open checkout matched but we are NOT the ones who
 * zeroed it — the card was checked out with the listing left alone, or ended
 * outright, so a zero on it is eBay's doing. The card is away AND something
 * happened to the listing, which is the double-sale case the desk warns about
 * ("it could still sell online while you're away"). Worth a second look
 * rather than a confident chip.
 */
export function listingStock(listing, away) {
  if (isListingAvailable(listing)) return { state: "live", checkout: null, suspect: false };
  if (!away) return { state: "unknown", checkout: null, suspect: false };
  const byId = listing?.ebay_item_id != null ? away.byItem.get(String(listing.ebay_item_id)) : null;
  const co = byId || (listing?.sku ? away.bySku.get(String(listing.sku).toLowerCase()) : null);
  if (!co) return { state: "gone", checkout: null, suspect: false };
  return { state: "show", checkout: co, suspect: co.hide_method !== "quantity" };
}

/**
 * The lowercased SKUs that are still listed but sold out — the ones a card
 * count based on `ebay_listings` alone gets wrong.
 *
 * A SKU with a second, in-stock listing is NOT here: two listings under one
 * SKU means we have one to sell, and reporting the card as gone on the
 * strength of the dead one would send a real card home from the show.
 */
export function soldOutSkus(listings) {
  const live = availableSkus(listings);
  const set = new Set();
  for (const l of listings || []) {
    if (!l?.sku || isListingAvailable(l)) continue;
    const k = String(l.sku).toLowerCase();
    if (!live.has(k)) set.add(k);
  }
  return set;
}
