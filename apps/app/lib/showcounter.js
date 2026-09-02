/**
 * Comp Finder — the counter view: the show stock, as a customer may see it.
 *
 * Tested for real on 2026-08-29, before any of it was built: someone asked
 * "do you have any gengars", the Show Desk was searched in front of them, and
 * cards that were in a box under the table sold. That is the whole product —
 * the tool works, it just isn't dressed for an audience.
 *
 * The Show Desk is a working screen and shows working data: the SKU (a stack
 * name plus a position, so it says how deep the stock runs), whether the card
 * is still live on eBay (an invitation to go and price-check the sticker in
 * front of you), and a `£ Sold` button one mis-tap from being pressed by
 * somebody holding the tablet. None of that is wrong on the desk. All of it is
 * wrong facing outward.
 *
 * So this file is an ALLOW-LIST, not a tidy-up. `counterRow()` builds a new
 * object out of the four things a buyer needs; it never deletes fields from
 * the checkout row. A projection that starts from the row and strips what is
 * private is one added column away from leaking — the column arrives, nobody
 * remembers this file, and the leak is invisible because the screen still
 * looks right. Starting from nothing fails the other way: a field nobody
 * allowed simply doesn't appear.
 *
 * **This is also the projection the public storefront needs.** See
 * docs/SHOW_STOREFRONT.md: an anonymous route can serve exactly this shape and
 * nothing else, so the hard part gets settled here, on a tablet in your own
 * hands where you can see what a customer sees. Two projections would
 * eventually disagree about what is private, and the one that disagrees
 * quietly is the one on the internet.
 *
 * Framework-free and app-import-free on purpose, so scripts/check-showcounter.mjs
 * can load it under bare node.
 */
import { showView, matchesQuery, normalise } from "./showfilter.js";
import { labelName } from "./showstock.js";
import { isListingAvailable } from "./stockcheck.js";
import SoldCompsApi from "@compfinder/core/soldcomps.js";

/**
 * What a buyer is shown when there is no sticker price.
 *
 * `stickerFor()` holds a price back on low or no confidence, and on prices
 * built from active listings. Facing a customer that is not a blank — a blank
 * reads as free, or as a bug — and it is emphatically not the eBay price,
 * which carries ~13.25% of fees and £1.35 of postage a table sale never pays.
 * The honest answer is that this one needs a person.
 */
export const ASK_TEXT = "Ask at the table";

/**
 * A generous width for a customer-facing name. `labelName()` is reused rather
 * than reimplemented — it already drops bracketed asides, cuts the marketing
 * tail after the collector number and strips noise words, which turns
 * "Pokemon Card Gengar VMAX 020/198 Chilling Reign Ultra Rare NM" into
 * "Gengar VMAX 020/198". The width is wider than any label because a screen is
 * not a sticker: truncation here should be the rare case, not the usual one.
 */
export const COUNTER_NAME_MAX = 64;

/**
 * Every key a counter row may carry. The check asserts the projection produces
 * exactly these and no others, so adding a field here is a deliberate act with
 * a test behind it.
 */
export const COUNTER_FIELDS = ["id", "name", "condition", "pricePence", "priceText", "image", "imageLarge"];

/**
 * The trade's shorthand, written out.
 *
 * "NM" is what a seller types and what every price guide prints; it is not
 * what somebody across a table reads. This screen is the one place in the app
 * where the audience isn't us.
 */
const CONDITION_WORDS = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged"
};

/**
 * eBay's own condition values that say nothing about a card.
 *
 * `ConditionDisplayName` on a TCG single is usually "Ungraded", "New" or
 * "Used" — true, and useless to somebody deciding whether to buy this copy.
 * The title is the better source precisely because sellers write the grade
 * there, so those values are discarded rather than shown as if they answered
 * the question.
 */
const EMPTY_CONDITIONS = /^(ungraded|new|used|brand new|not specified|--)$/i;

/**
 * What can honestly be said about this copy's condition, or null.
 *
 * The title comes first and eBay's field second, which is the opposite of what
 * you'd expect from an authoritative-looking API field — but on trading cards
 * the seller writes "NM" in the title and leaves the dropdown on "Ungraded".
 *
 * `inferCondition()` is `packages/core`'s, not a third copy: the pricing engine
 * splits its comps on exactly this reading, and a counter that disagreed with
 * it about what "NM" means would be a second opinion nobody asked for.
 */
export function conditionOf(source) {
  const code = SoldCompsApi.inferCondition(source?.title || "");
  if (code && code !== "Unknown" && CONDITION_WORDS[code]) return CONDITION_WORDS[code];
  const stated = String(source?.extra?.condition || source?.condition || "").trim();
  if (stated && !EMPTY_CONDITIONS.test(stated)) return stated;
  return null;
}

/**
 * The same eBay photo, asked for at a size worth looking at.
 *
 * `image_url` is `PictureDetails.GalleryURL`, which eBay serves at thumbnail
 * size — fine in a 44px frame, useless when somebody wants to see the card.
 * eBay's image CDN encodes the size in the filename (`s-l140.jpg`), so a
 * larger one is a string swap rather than an API call, which matters on a
 * route that must not cost a request per row.
 *
 * A URL that doesn't match the pattern is returned unchanged: a smaller
 * picture is a worse view, a broken one is no view at all. One definition of
 * that filename rule, because a second copy of it in the binder would be a
 * second thing to fix the day eBay changes the CDN.
 */
export function imageAt(url, px) {
  const u = String(url || "").trim();
  if (!u) return null;
  const size = Math.round(Number(px));
  if (!Number.isFinite(size) || size <= 0) return u;
  return /\/s-l\d+\.(jpe?g|png|webp)/i.test(u) ? u.replace(/\/s-l\d+\./i, `/s-l${size}.`) : u;
}

/**
 * The same picture, as big as eBay serves it. The one size the counter list
 * asks for; the binder asks for a middle one through imageAt() rather than
 * writing the filename rule out a second time.
 */
export function largeImage(url) {
  return imageAt(url, 1600);
}

/**
 * How many online-only cards a search may show.
 *
 * The box is a hundred-odd cards; the eBay listings are thousands. Uncapped,
 * the second list buries the first, and the first is the one you can actually
 * put in somebody's hand.
 */
export const ONLINE_LIMIT = 24;

/**
 * Cash, the way a label writes it: whole pounds lose their ".00".
 *
 * Deliberately not the app's `pounds()`/`toPoundsStr()`. Sticker prices land on
 * whole pounds almost always (stickerPence() rounds to £1/£5/£10 bands), and
 * "£3" reads as cash across a table where "£3.00" reads as a listing price —
 * the same reasoning labelexport.js uses for the printed file. Pence are still
 * shown when they exist, because a hand-typed sticker can carry them.
 */
export function counterPrice(pence) {
  if (pence == null || !Number.isFinite(Number(pence))) return ASK_TEXT;
  const n = Math.round(Number(pence));
  if (n <= 0) return ASK_TEXT;
  return n % 100 === 0 ? `£${n / 100}` : `£${(n / 100).toFixed(2)}`;
}

/**
 * Phrases that are the words "Pokemon Card", not a card called Card.
 *
 * `labelName()` strips "pokemon" and "tcg" as single words, which is right for
 * a label but leaves "Pokemon Card Gengar VMAX 020/198" reading as "Card
 * Gengar VMAX 020/198" — fine for a sticker we read ourselves, poor facing a
 * customer. Removed as a PHRASE rather than by adding "card" to that noise
 * list, for two reasons: widening the shared list would change every printed
 * label, and a bare leading "card" is a real name — Yu-Gi-Oh has Card Trooper,
 * and the app prices every game even though the public page does not.
 */
const CARD_PHRASE = /\b(?:pok[eé]mon|tcg|trading)\s+cards?\b/gi;

/** The card's name as a customer should read it. */
export function counterName(title) {
  const pre = String(title || "").replace(CARD_PHRASE, " ").replace(/\s+/g, " ").trim();
  const cleaned = labelName(pre || String(title || ""), COUNTER_NAME_MAX);
  return cleaned || "Card";
}

/**
 * A picture, if we have one we did not have to fetch.
 *
 * `ebay_listings.image_url` is a photo of THIS copy — the actual card with its
 * actual condition — which beats catalogue art for anything being sold in
 * person. Cards checked out by ENDING their listing drop out of `ebay_listings`
 * on the next sync, so plenty of rows have none; that is a gap, and a gap is
 * fine. Catalogue art is deliberately NOT substituted in here: it would show a
 * mint scan of a played card to the person holding it.
 */
export function counterImage(co, images) {
  const key = String(co?.sku || "").trim().toLowerCase();
  if (!key || !images) return null;
  const url = images instanceof Map ? images.get(key) : images[key];
  return url || null;
}

/**
 * One checkout row, as a customer may see it.
 *
 * Built key by key. Do not be tempted to spread `co` and delete: see the file
 * header — the failure mode of the other direction is silent.
 */
export function counterRow(co, { images } = {}) {
  const pence = co?.sticker_pence == null ? null : Number(co.sticker_pence);
  const valid = pence != null && Number.isFinite(pence) && pence > 0;
  const art = counterImage(co, images);
  return {
    id: co?.id ?? null,
    name: counterName(co?.title),
    condition: conditionOf(co),
    pricePence: valid ? Math.round(pence) : null,
    priceText: counterPrice(valid ? pence : null),
    image: art,
    imageLarge: largeImage(art)
  };
}

/**
 * The counter list: the same search and sort the desk uses, projected.
 *
 * `showView()` rather than a second filter, so what a customer finds and what
 * you find are the same set — a search that answers differently on the two
 * screens sends you to a card the customer cannot see, or worse, promises one
 * that isn't in the box.
 */
export function counterView(rows, criteria = {}, { images } = {}) {
  const view = showView(rows, criteria);
  return {
    ...view,
    rows: view.rows.map((co) => counterRow(co, { images })),
    priced: view.rows.filter((co) => co?.sticker_pence != null).length
  };
}

/**
 * A live eBay listing, projected for the counter — the same shape a checkout
 * row projects to, so one row component renders both and one allow-list covers
 * both. The SKU and the listing URL are excluded for different reasons: the
 * SKU is our shelf address, and the URL is an invitation to buy it online
 * instead of from the table you are standing at.
 *
 * The price is eBay's, unconverted. For a card that would be POSTED that is
 * the right number — the fees and postage baked into it are costs a posted
 * sale really does pay — and the section it appears under says what it is.
 */
export function listingRow(l) {
  const pounds = Number(l?.price_value);
  const pence = Number.isFinite(pounds) && pounds > 0 ? Math.round(pounds * 100) : null;
  return {
    id: l?.ebay_item_id || l?.id || null,
    name: counterName(l?.title),
    condition: conditionOf(l),
    pricePence: pence,
    priceText: counterPrice(pence),
    image: l?.image_url || null,
    imageLarge: largeImage(l?.image_url)
  };
}

/**
 * The online stock a search turns up, minus anything already in the box.
 *
 * Three rules, and the middle one is the one that costs cards:
 *
 * 1. **Only on a search.** With an empty query this returns nothing. Thousands
 *    of listings under a hundred-odd real ones is not a stock list, it is a
 *    catalogue with the useful part at the top.
 * 2. **A sold card is still a row in `ebay_listings`.** eBay's out-of-stock
 *    control leaves a sold fixed-price listing in the ActiveList with the
 *    quantity zeroed, so `isListingAvailable()` is the one definition of
 *    whether there is anything to sell — the same trap that once put sold
 *    cards at the top of the show-stock shortlist.
 * 3. **Never twice.** A card checked out with its listing left live is in both
 *    sets, and showing it under "ask us" as well as in the box reads as two
 *    copies.
 */
export function onlineMatches(listings, { query = "", inBoxSkus = null, limit = ONLINE_LIMIT } = {}) {
  if (!normalise(query)) return [];
  const skip = inBoxSkus instanceof Set ? inBoxSkus : new Set(inBoxSkus || []);
  const seen = new Set();
  const out = [];
  for (const l of listings || []) {
    if (!isListingAvailable(l)) continue;
    const key = l?.sku ? String(l.sku).toLowerCase() : "";
    if (key && (skip.has(key) || seen.has(key))) continue;
    if (!matchesQuery(l, query)) continue;
    if (key) seen.add(key);
    out.push(l);
  }
  // Dearest first: on a query that catches a lot, the cards worth a
  // conversation should be the ones that fit on the screen.
  out.sort((a, b) => (Number(b?.price_value) || 0) - (Number(a?.price_value) || 0));
  return out.slice(0, Math.max(0, limit)).map(listingRow);
}

/** The lowercased SKUs currently in the box, for keeping the two lists apart. */
export function inBoxSkus(checkouts) {
  const set = new Set();
  for (const co of checkouts || []) if (co?.sku) set.add(String(co.sku).toLowerCase());
  return set;
}
