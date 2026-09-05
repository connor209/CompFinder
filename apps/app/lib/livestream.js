/**
 * Comp Finder — the live stream lot: what goes on air, and what may not.
 *
 * We run eBay Live auctions off pre-scanned photographs rather than holding
 * every card up to a camera. The cards are already SKU'd, scanned and priced;
 * pulling each one again to wave it at a lens is handling we have already
 * paid for once. A live host still talks through every lot — eBay ends a
 * stream that goes unhosted, and an unhosted stream was never the idea.
 *
 * This file owns the LOT: the object the host's screen hands to OBS. It is
 * the same discipline as counterRow() in showcounter.js and dealLine() in
 * deal.js, for a harder reason than either — this projection is not shown to
 * one customer across a table, it is BROADCAST, and a stream is recorded.
 *
 * Four rules, and the middle two exist because of what eBay Live actually
 * asks of a seller (see docs/LIVE_STREAM.md for the policy reading):
 *
 * 1. **A lot is an ALLOW-LIST**, built key by key. Never a listing row or a
 *    checkout row with the private parts dropped. The leak worth designing
 *    against is the column added to `stock_checkouts` or `ebay_listings` a
 *    year from now for an unrelated reason, arriving on a public broadcast.
 *    The SKU is the clearest case and it is excluded: it is a stack name plus
 *    a position, so it says out loud how deep the stock runs.
 *
 * 2. **A held price is never broadcast as a figure.** eBay's rule is that a
 *    seller makes no false or misleading claim about condition, authenticity
 *    or value, and this repo already knows which of its own prices are not
 *    worth standing behind: stickerFor() in showstock.js holds back low and
 *    no-confidence prices, and prices built from ASKING prices rather than
 *    sales. Every one of those reasons is stronger on a stream than on a
 *    sticker — a sticker is peeled off in front of one person, and a claim
 *    made on a broadcast is in the recording. So the same gate runs here, and
 *    a held lot goes out with NO value line rather than a hedged one.
 *
 * 3. **Nothing is held quietly.** The reason goes to the HOST — who can talk
 *    about the card instead — and never to the audience, who would only see
 *    an empty box where a number was on the last lot.
 *
 * 4. **The pictures are the LISTING's pictures.** eBay requires that what is
 *    shown live matches the listing, and the cheapest way to be sure of that
 *    is to show the photographs the listing itself is showing. It also
 *    settles the dispute-exposure worry the whole format raises: a buyer who
 *    says the card was not as described is looking at the same four pictures
 *    the stream showed them.
 *
 * Deliberately framework-free and app-import-free (bar showcounter.js and
 * showstock.js, which are the same), so scripts/check-livestream.mjs can load
 * it under bare node — and so the relay in tools/stream-relay can be a dumb
 * pipe that never builds one of these itself.
 */

import { conditionOf, counterName, imageAt } from "./showcounter.js";
import { stickerFor } from "./showstock.js";
import { effectivePence } from "./price-override.js";

/**
 * Where the relay listens.
 *
 * 127.0.0.1 rather than localhost, and never 0.0.0.0: the machine running OBS
 * is on hall or hotel wifi, and a relay bound to every interface serves the
 * stock list, the queue and the prices to whoever else is on that network.
 * The port is high and arbitrary; it only has to be free.
 */
export const RELAY_PORT = 4455;
export const RELAY_ORIGIN = `http://127.0.0.1:${RELAY_PORT}`;

/** A relay URL, from an origin that may have been overridden in settings. */
export function relayUrl(path = "/", origin = RELAY_ORIGIN) {
  const base = String(origin || RELAY_ORIGIN).replace(/\/+$/, "");
  return `${base}${String(path).startsWith("/") ? path : `/${path}`}`;
}

/**
 * How many pictures a lot may cycle.
 *
 * Four is the format: front, back, front edges and corners, back edges and
 * corners. It is a CAP rather than a requirement — a listing with two
 * pictures cycles two, because refusing to stream a card until somebody
 * re-photographs it is a rule that stops the stream rather than the card.
 */
export const LOT_IMAGES_MAX = 4;

/**
 * How long a lot is on screen, and therefore how long each picture is.
 *
 * ~30 seconds is the auction, not a design decision — it is how long a lot
 * runs. The floor is: below about two and a half seconds a cycle stops
 * reading as a sequence of photographs and starts reading as a flicker, and
 * the one thing a buyer is doing with these pictures is looking hard at the
 * edges of a card.
 */
export const LOT_MS = 30_000;
export const MIN_IMAGE_MS = 2_500;

export function cycleTiming(imageCount, lotMs = LOT_MS) {
  const n = Math.max(1, Math.round(Number(imageCount) || 0));
  const total = Math.max(MIN_IMAGE_MS, Math.round(Number(lotMs) || LOT_MS));
  return { images: n, perImageMs: Math.max(MIN_IMAGE_MS, Math.round(total / n)) };
}

/** How many lots the relay will hold. A stream is a session, not an archive. */
export const MAX_QUEUE = 200;

/**
 * The label over the figure.
 *
 * The figure is what the card has recently SOLD for, and saying so is the
 * difference between a fact and a claim. It is the same rule the public
 * page's share image runs under: an asking price is evidence of nothing, and
 * a number on a broadcast outlives the listing it was taken from.
 */
export const VALUE_LABEL = "Recent sold";

/**
 * eBay's own picture CDN encodes the size in the filename, so the same
 * photograph appears under a dozen URLs. Two of them in one cycle is the same
 * card twice, which on a stream reads as a second picture that failed to
 * load. Identity is the URL with the size taken out of it.
 */
function pictureIdentity(url) {
  return String(url || "").replace(/\/s-l\d+\./i, "/s-l.").toLowerCase();
}

/**
 * The listing's pictures, in the listing's order, as big as eBay serves them.
 *
 * The ORDER is the seller's upload order and nothing more. It is not labelled
 * on screen — captioning the third picture "Edges" when the person listing
 * that card happened to upload the back shot third is exactly the kind of
 * confident wrong statement a broadcast makes permanent. The pictures speak
 * for themselves; the host does the talking.
 *
 * `imageAt()` is showcounter's, not a second copy of the filename rule: the
 * day eBay changes that CDN there should be one thing to fix.
 */
export function streamImages(urls, { max = LOT_IMAGES_MAX } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(urls) ? urls : [urls]) {
    const u = String(raw || "").trim();
    if (!/^https:\/\//i.test(u)) continue; // an http picture on an https page does not load
    const big = imageAt(u, 1600) || u;
    const id = pictureIdentity(big);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(big);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * What may be said about the card's value, and when nothing may be.
 *
 * `stickerFor()` is the GATE and only the gate. The Show Desk has already
 * decided which prices are too thin to stick on a card, and every one of its
 * reasons is stronger in front of a camera — a price built from active
 * listings sharpest of all, since that is an asking price wearing a sold
 * price's clothes and the whole public product exists because that is where
 * people get hurt. Asking the same question twice in two places is how two
 * screens end up disagreeing about which prices we stand behind.
 *
 * The FIGURE is not the sticker's, and that distinction cost a bug in the
 * first version of this file. `stickerPence()` rounds onto a £1/£5/£10 cash
 * ladder because somebody is handing notes across a table, and it turned an
 * £84 card into "£85 recent sold" on a broadcast. What this figure claims is
 * what the card has recently SOLD for, so it is the engine's own number,
 * unrounded, straight from effectivePence() — the same function every path
 * that spends money reads.
 *
 * Returns { pence, text, held, reason }. `text` is null when held, because
 * the overlay renders no value line at all in that case: an empty box where
 * the last lot had a number invites the audience to fill it in.
 */
export function streamValue(rec, { graded = false } = {}) {
  const gate = stickerFor(rec, { graded });
  const pence = effectivePence(rec);
  if (gate.held || pence == null) {
    return { pence: null, text: null, held: true, reason: gate.reason || "no price to stand behind" };
  }
  return { pence: Math.round(pence), text: poundsText(pence), held: false, reason: null };
}

/** Cash on a screen: whole pounds lose their ".00", as on a label. */
export function poundsText(pence) {
  const n = Math.round(Number(pence));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n % 100 === 0 ? `£${n / 100}` : `£${(n / 100).toFixed(2)}`;
}

/**
 * One card, as a broadcast may see it.
 *
 * Built key by key. Do not be tempted to spread the source row and delete —
 * see the file header; the failure mode of the other direction is silent, and
 * here it is silent AND recorded.
 *
 * `id` is the only identifier that crosses: the queue has to be able to
 * address a lot, and both of its sources are already public — an eBay item id
 * is in the listing's own URL, and a checkout id is a uuid that means nothing
 * outside this database. The SKU is excluded for the reason counterRow()
 * excludes it: it is our shelf address.
 */
export function lotFrom({ id, title, source, images, rec, graded = false, condition } = {}) {
  const value = rec ? streamValue(rec, { graded }) : { pence: null, text: null, held: true, reason: "not priced" };
  const pics = streamImages(images);
  return {
    id: id == null ? null : String(id),
    name: counterName(title),
    condition: condition || conditionOf(source || { title }),
    valuePence: value.pence,
    valueText: value.text,
    valueLabel: value.text ? VALUE_LABEL : null,
    valueHeld: value.held,
    images: pics,
    imageCount: pics.length
  };
}

/**
 * Why a lot cannot go on air. Prose, and shown to the host before the queue
 * takes it — the alternative is finding out at the moment it is on screen.
 *
 * A picture-less lot is the one hard refusal. eBay ends a stream that shows
 * an empty or placeholder screen, and more to the point a card being auctioned
 * off a blank rectangle is the version of this format nobody should defend.
 */
export function lotBlockers(lot) {
  const out = [];
  if (!lot || !String(lot.name || "").trim()) out.push("no card name");
  if (!lot || !Array.isArray(lot.images) || lot.images.length === 0) {
    out.push("no pictures on the listing — nothing to show");
  }
  if (!lot || lot.id == null || lot.id === "") out.push("no id to address it by");
  return out;
}

/** Whether a lot is safe to queue. */
export function lotReady(lot) {
  return lotBlockers(lot).length === 0;
}

/**
 * The shape the relay accepts, checked ON THE RELAY as well as here.
 *
 * Not a second projection — it never builds a lot, adds a field or fills one
 * in. It is a bouncer: anything whose shape it does not recognise is refused
 * rather than half-rendered on a broadcast. The producer stays the only thing
 * that decides what a lot contains, which is what keeps this file the single
 * definition of what may be said on air.
 */
export const LOT_FIELDS = [
  "id", "name", "condition", "valuePence", "valueText", "valueLabel",
  "valueHeld", "images", "imageCount"
];

export function sanitiseLot(input) {
  if (!input || typeof input !== "object") return null;
  const lot = {};
  for (const key of LOT_FIELDS) lot[key] = input[key] === undefined ? null : input[key];
  lot.id = lot.id == null ? null : String(lot.id).slice(0, 64);
  lot.name = String(lot.name || "").slice(0, 120);
  lot.condition = lot.condition == null ? null : String(lot.condition).slice(0, 40);
  lot.valueText = lot.valueText == null ? null : String(lot.valueText).slice(0, 20);
  lot.valueLabel = lot.valueLabel == null ? null : String(lot.valueLabel).slice(0, 40);
  lot.valueHeld = lot.valueHeld === true;
  lot.valuePence = Number.isFinite(Number(lot.valuePence)) ? Math.round(Number(lot.valuePence)) : null;
  // A held lot carries no figure, whatever the producer sent. The rule is
  // enforced at both ends on purpose: this is the one field that can make the
  // stream say something untrue about a card.
  if (lot.valueHeld) {
    lot.valuePence = null;
    lot.valueText = null;
    lot.valueLabel = null;
  }
  lot.images = streamImages(lot.images);
  lot.imageCount = lot.images.length;
  return lotReady(lot) ? lot : null;
}
