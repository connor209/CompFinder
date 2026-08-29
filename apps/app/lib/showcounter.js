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
import { showView } from "./showfilter.js";
import { labelName } from "./showstock.js";

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
export const COUNTER_FIELDS = ["id", "name", "pricePence", "priceText", "image"];

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
  return {
    id: co?.id ?? null,
    name: counterName(co?.title),
    pricePence: valid ? Math.round(pence) : null,
    priceText: counterPrice(valid ? pence : null),
    image: counterImage(co, images)
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
