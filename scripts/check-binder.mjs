/**
 * The digital binder: what is in a pocket, and what a thumb across it means.
 *
 *   node scripts/check-binder.mjs      (or: npm run check)
 *
 * Counter mode is a list; the binder is the same stock nine to a page, flipped
 * with a button or a thumb. Three things about it can go wrong quietly, and
 * they are what this file pins:
 *
 * 1. **A pocket is an allow-list**, exactly like counterRow(). Same reasoning
 *    as check-showcounter.mjs and the same test: a checkout row stuffed with
 *    every private thing the desk knows, projected, then the whole serialised
 *    result searched for any of those values. The leak worth designing against
 *    is not one anybody writes — it is the column added to `stock_checkouts` a
 *    year from now, appearing on a tablet somebody is holding.
 *
 * 2. **Folding copies must not lose stock.** Four Gengars become one pocket,
 *    which is the point; four DIFFERENT cards becoming one pocket is stock
 *    nobody can see, and rows with no title merging into a single pocket
 *    labelled "Card" is the same fault wearing a disguise.
 *
 * 3. **A vertical drag is a scroll, not a page turn.** The binder sits in a
 *    page you scroll. Get that test the wrong way round and a customer cannot
 *    read past the first page without it flipping under them — and it is
 *    exactly the sort of thing that works on a mouse and fails in a hall.
 *
 * Offline, no Supabase, no framework.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  binderView, binderPages, binderKey, binderCopy, pocketOf,
  clampPage, turnPage, swipeDirection, copyLocations, placeOf, isFiltering,
  onlineStock, onlineItem, boxItem, BOX, ONLINE, BINDER_SCOPES, DEFAULT_SCOPE, SECTION_LABELS,
  BINDER_FIELDS, BINDER_COPY_FIELDS, BINDER_PAGE, BINDER_COLS, BINDER_ROWS,
  BINDER_SORTS, DEFAULT_BINDER_SORT, BINDER_PRICE_FILTERS, SWIPE_MIN_PX,
  POCKET_PX, PREVIEW_PX, ASK_TEXT
} from "../apps/app/lib/binder.js";
import { imageAt, largeImage } from "../apps/app/lib/showcounter.js";
import { locationsBySku } from "../apps/app/lib/stackpos.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (what, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) fail(`${what}: got ${a}, expected ${b}`);
};
const ok = (what, cond) => { if (!cond) fail(what); };

const src = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
/**
 * A file with its comments taken out.
 *
 * The greps below ask what the CODE does, and every one of these rules is
 * written out in prose right above the code that keeps it — so grepping the
 * raw file makes a file fail for explaining itself, which is the fastest way
 * to get a check deleted.
 */
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

// A checkout row carrying every private thing the desk knows about a card —
// the same fixture check-showcounter.mjs uses, for the same reason.
const PRIVATE = {
  sku: "AB12",
  stack_name: "Stack A",
  stack_id: "stack-uuid",
  stack_card_id: "card-uuid",
  event: "Cardiff Expo",
  ebay_item_id: "115566778899",
  hide_method: "quantity",
  hide_error: "eBay said no",
  note: "bought in the Wilson lot for £4",
  sold_price_pence: 1200,
  return_stack_id: "other-uuid",
  relisted_item_id: "999888777",
  sticker_batch_id: "batch-uuid",
  user_id: "user-uuid"
};
const co = (over = {}) => ({
  id: "co-1",
  title: "Pokemon Card Gengar VMAX 020/198 Chilling Reign Ultra Rare NM",
  sticker_pence: 4000,
  checked_out_at: "2026-08-29T09:00:00Z",
  ...PRIVATE,
  ...over
});
const IMG = new Map([["ab12", "https://i.ebayimg.com/images/g/abc/s-l140.jpg"]]);

// --- 1. a pocket is an allow-list ----------------------------------------
const one = binderView([co()], {}, { images: IMG });
eq("a pocket carries exactly the allowed keys", Object.keys(one.cards[0]).sort(), [...BINDER_FIELDS].sort());
eq("a copy carries exactly the allowed keys", Object.keys(one.cards[0].copies[0]).sort(), [...BINDER_COPY_FIELDS].sort());

// The whole view is serialised and searched for each private VALUE, so a field
// renamed on the way through is caught as well as one passed straight along.
const serialised = JSON.stringify(one.cards);
for (const [field, value] of Object.entries(PRIVATE)) {
  if (typeof value === "string" && serialised.includes(value)) {
    fail(`private field ${field} ("${value}") reached the binder`);
  }
}
// The SKU is the one that would be most tempting to carry, because the preview
// wants a location. It is resolved by the desk instead — see case 9.
ok("the SKU never rides on a pocket", !serialised.toLowerCase().includes("ab12"));

// --- 2. one card, one pocket ---------------------------------------------
const THREE = [
  co({ id: "a", title: "Pokemon Card Gengar VMAX 020/198 Chilling Reign Ultra Rare NM", sticker_pence: 4000 }),
  co({ id: "b", title: "Gengar VMAX 020/198 (Chilling Reign) Holo", sticker_pence: 2500 }),
  co({ id: "c", title: "Gengar VMAX 020/198 Chilling Reign LP", sticker_pence: 3000 })
];
const folded = binderView(THREE, {}, { images: IMG });
eq("three copies of one card fill one pocket", folded.cards.length, 1);
eq("the pocket knows how many copies are behind it", folded.cards[0].count, 3);
eq("every copy is listed in the pocket", folded.cards[0].copies.length, 3);
// Nothing is dropped quietly: the count of what was folded is handed back, the
// same way showView() hands back `hidden`.
eq("the folded copies are counted", folded.folded, 2);
eq("every physical card is still accounted for", folded.shown, 3);

// A different collector number is a different card, however similar the name.
const TWO = binderView([
  co({ id: "a", title: "Gengar VMAX 020/198 Chilling Reign" }),
  co({ id: "b", title: "Gengar VMAX 271/198 Chilling Reign Alt Art" })
], {}, { images: IMG });
eq("two printings are two pockets", TWO.cards.length, 2);
eq("nothing was folded", TWO.folded, 0);

// A row with no title is a SKU nobody has matched to a card yet. There can be
// several, they are certainly not each other, and merging them would hide real
// stock behind one pocket labelled "Card".
eq("an unnameable row has no identity", binderKey({ id: "x", title: "" }), "");
eq("a title stripped to nothing has no identity either", binderKey({ id: "x", title: "Pokemon Card" }), "");
const NAMELESS = binderView([co({ id: "a", title: "" }), co({ id: "b", title: null })], {}, {});
eq("two unnameable rows never merge", NAMELESS.cards.length, 2);

// --- 3. the headline price is the cheapest copy --------------------------
eq("the pocket quotes the cheapest copy", folded.cards[0].priceText, "£25");
ok("...and says there is a dearer one behind it", folded.cards[0].priceFrom === true);

const SAME = binderView([co({ id: "a", sticker_pence: 2500 }), co({ id: "b", sticker_pence: 2500 })], {}, {});
ok("two copies at one price is not a 'from' price", SAME.cards[0].priceFrom === false);

const MIXED = binderView([co({ id: "a", sticker_pence: 2500 }), co({ id: "b", sticker_pence: null })], {}, {});
ok("a priced copy beside an unpriced one is a 'from' price", MIXED.cards[0].priceFrom === true);
eq("the priced copy leads", MIXED.cards[0].copies[0].priceText, "£25");
eq("the unpriced copy follows and asks", MIXED.cards[0].copies[1].priceText, ASK_TEXT);

const NOPRICE = binderView([co({ id: "a", sticker_pence: null })], {}, {});
eq("no sticker anywhere asks at the table", NOPRICE.cards[0].priceText, ASK_TEXT);
eq("...and carries no number", NOPRICE.cards[0].pricePence, null);
ok("...and is not a 'from' price", NOPRICE.cards[0].priceFrom === false);

// --- 4. the order the binder is read in ----------------------------------
const SORTABLE = [
  co({ id: "z", title: "Zapdos 145/165", sticker_pence: 500 }),
  co({ id: "a", title: "Alakazam 065/165", sticker_pence: 9000 }),
  co({ id: "m", title: "Mewtwo 150/165", sticker_pence: null })
];
const names = (crit) => binderView(SORTABLE, crit, {}).cards.map((c) => c.name.split(" ")[0]);
eq("A–Z", names({ sort: "name" }), ["Alakazam", "Mewtwo", "Zapdos"]);
eq("Z–A", names({ sort: "name-desc" }), ["Zapdos", "Mewtwo", "Alakazam"]);
// A card with no price sorts last whichever way the column runs — the same
// rule showfilter.js uses for stickers. Treating it as £0 would head the
// cheapest-first binder with the cards nobody has priced.
eq("dearest first, no-price last", names({ sort: "value-desc" }), ["Alakazam", "Zapdos", "Mewtwo"]);
eq("cheapest first, no-price still last", names({ sort: "value-asc" }), ["Zapdos", "Alakazam", "Mewtwo"]);
eq("order packed is the order it arrived in", names({ sort: "packed" }), ["Zapdos", "Alakazam", "Mewtwo"]);
eq("an unknown sort falls back to the default", names({ sort: "nonsense" }), names({ sort: DEFAULT_BINDER_SORT }));
ok("the default sort is one that is offered", BINDER_SORTS.some((s) => s.key === DEFAULT_BINDER_SORT));

// The price filter asks the customer's question, not the desk's.
const filtered = (price) => binderView(SORTABLE, { price }, {}).cards.length;
eq("every card", filtered("any"), 3);
eq("with a price on", filtered("priced"), 2);
eq("ask at the table", filtered("ask"), 1);
ok("every offered filter is one the view understands",
  BINDER_PRICE_FILTERS.every((f) => Number.isFinite(filtered(f.key))));
ok("a search narrows the binder", binderView(SORTABLE, { query: "zapdos" }, {}).cards.length === 1);
// The search still reads the SKU and the show — you type what you know, and
// what you type is not what a customer reads.
ok("the search still finds a card by its SKU", binderView(SORTABLE, { query: "ab12" }, {}).cards.length === 3);
ok("a plain binder is not filtering", isFiltering({}) === false);
ok("a search is filtering", isFiltering({ query: "gengar" }) === true);
ok("a price filter is filtering", isFiltering({ price: "priced" }) === true);

// --- 5. nine pockets to a page, and the last page keeps its shape --------
eq("a page is three across and three down", BINDER_PAGE, BINDER_COLS * BINDER_ROWS);
eq("which is nine", BINDER_PAGE, 9);
const nine = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}` }));
eq("nine cards is one page", binderPages(nine).length, 1);
const ten = binderPages([...nine, { key: "k9" }]);
eq("ten cards is two pages", ten.length, 2);
eq("...and the second page is still nine pockets", ten[1].length, 9);
eq("...eight of them empty", ten[1].filter((p) => p === null).length, 8);
eq("an empty binder has no pages", binderPages([]).length, 0);

// --- 6. turning a page ---------------------------------------------------
eq("forward", turnPage(0, "next", 3), 1);
eq("back", turnPage(2, "prev", 3), 1);
// A binder does not wrap. Turning past the last page and finding the first is
// how somebody reads the same nine cards twice without noticing.
eq("the last page is the last page", turnPage(2, "next", 3), 2);
eq("the first page is the first page", turnPage(0, "prev", 3), 0);
// The binder changes under the page number every time the search does.
eq("a page that no longer exists clamps back", clampPage(6, 2), 1);
eq("an empty binder clamps to nothing", clampPage(4, 0), 0);
eq("a nonsense page is page one", clampPage(undefined, 3), 0);

// --- 7. a thumb across the binder ---------------------------------------
eq("swipe left turns forward", swipeDirection(-120, 4), "next");
eq("swipe right turns back", swipeDirection(120, 4), "prev");
eq("a tap is not a swipe", swipeDirection(-6, 2), null);
eq("a nudge under the threshold is not a swipe", swipeDirection(-(SWIPE_MIN_PX - 1), 0), null);
// THE case. The binder is inside a page you scroll: a thumb moving mostly
// down is reading, and a page that turns under it is unusable in a hall.
eq("a vertical drag is a scroll", swipeDirection(-60, 200), null);
eq("a diagonal that is mostly down is a scroll", swipeDirection(-90, 95), null);
eq("a diagonal that is mostly across is a turn", swipeDirection(-90, 40), "next");

// --- 8. the picture, asked for bigger -----------------------------------
const GALLERY = "https://i.ebayimg.com/images/g/abc/s-l140.jpg";
eq("a pocket asks for a middle size", imageAt(GALLERY, POCKET_PX), "https://i.ebayimg.com/images/g/abc/s-l500.jpg");
eq("the preview asks for the big one", imageAt(GALLERY, PREVIEW_PX), "https://i.ebayimg.com/images/g/abc/s-l1600.jpg");
// The refactor that gave the binder its size must not have moved the counter's.
eq("largeImage still means 1600", largeImage(GALLERY), "https://i.ebayimg.com/images/g/abc/s-l1600.jpg");
eq("a URL that isn't eBay's is left alone", imageAt("https://example.com/card.png", POCKET_PX), "https://example.com/card.png");
eq("no picture is no picture", imageAt("", POCKET_PX), null);
eq("the pocket carries both sizes", one.cards[0].image, "https://i.ebayimg.com/images/g/abc/s-l500.jpg");
eq("...and the preview's", one.cards[0].imageLarge, "https://i.ebayimg.com/images/g/abc/s-l1600.jpg");
// A card checked out by ENDING its listing has no photo. That is a gap, and a
// gap is fine — catalogue art in its place would show a mint scan of a played
// card to the person holding it.
eq("no listing photo is an empty pocket, not a substitute", binderView([co()], {}, {}).cards[0].image, null);

// --- 9. where it is, resolved by the DESK -------------------------------
// A card in the binder is a card in the BOX: it has been checked out, so it
// has no live stack position and quoting the one it used to hold would send
// somebody counting to the wrong card on a shelf it isn't on. What finds it is
// the SKU on its sleeve, and the stack it left says which box it was packed
// out of.
eq("a SKU and the stack it left", placeOf({ sku: "AB12", stack_name: "Stack A" }), "AB12 · from Stack A");
eq("a SKU on its own is enough to find it", placeOf({ sku: "AB12" }), "AB12");
eq("no SKU still says which box", placeOf({ stack_name: "Stack A" }), "from Stack A");
// Null says "not somewhere I can send you", which is a different statement
// from "we have not got one".
eq("a card we cannot place gets no answer", placeOf({}), null);
eq("a row that isn't there gets no answer", placeOf(null), null);

// The pocket carries ids, not SKUs. The desk maps its own rows back to its own
// data, on a tap.
const card = binderView(THREE, {}, {}).cards[0];
const rowsById = new Map([
  ["a", { sku: "AB12", stack_name: "Stack A" }],
  ["b", { sku: "AB13", stack_name: "Stack A" }]
]);
const found = copyLocations(card, { rowsById });
eq("every copy gets an answer", found.length, 3);
eq("a copy the desk holds is placed", found.find((f) => f.id === "a").location, "AB12 · from Stack A");
eq("a copy the desk cannot find is not guessed at", found.find((f) => f.id === "c").location, null);
eq("no map at all is not a crash", copyLocations(card).length, 3);

// --- 9b. the eBay stock, in its own section -----------------------------
// The box is a hundred-odd cards and the listings are the rest of the shop.
// Both belong in a binder — table space is the cap the binder exists to lift —
// but a card that might be at home is not a card you can put in somebody's
// hand, so they never share a page.
const ART = "https://i.ebayimg.com/images/g/z/s-l140.jpg";
const LISTINGS = [
  { ebay_item_id: "L1", sku: "CD20", title: "Charizard ex 199/165", price_value: 120, quantity: 1, image_url: ART },
  { ebay_item_id: "L2", sku: "CD21", title: "Charizard ex 199/165 NM Holo", price_value: 140, quantity: 1 },
  // Sold, and eBay leaves it in the ActiveList with the quantity zeroed.
  { ebay_item_id: "L3", sku: "CD22", title: "Blastoise 009/165", price_value: 30, quantity: 0 },
  // No quantity at all is silence, not a zero — read as sold out, real stock
  // vanishes off the screen.
  { ebay_item_id: "L4", sku: "CD23", title: "Venusaur 001/165", price_value: 25 },
  // Checked out with its listing left live: it is in the box AND on eBay.
  { ebay_item_id: "L5", sku: "AB12", title: "Gengar VMAX 020/198", price_value: 55, quantity: 1 }
];
const both = binderView(THREE, {}, { images: IMG, listings: LISTINGS });

eq("a sold-out listing is not stock", onlineStock(LISTINGS).some((l) => l.ebay_item_id === "L3"), false);
eq("a missing quantity is not a zero", onlineStock(LISTINGS).some((l) => l.ebay_item_id === "L4"), true);
eq("a card already in the box is not offered twice",
  onlineStock(LISTINGS, { inBox: new Set(["ab12"]) }).some((l) => l.ebay_item_id === "L5"), false);

eq("the box section is the three Gengars, in one pocket", both.box.cardCount, 1);
eq("the online section is what is left", both.online.cardCount, 2); // Charizard (x2 listings), Venusaur
eq("two listings of one card share a pocket", both.cards.find((c) => c.source === ONLINE).count, 2);
eq("every pocket says which section it is from",
  both.cards.map((c) => c.source), [BOX, ONLINE, ONLINE]);

// THE rule. Each section is paginated on its own and the pages concatenated,
// so a mixed page is unrepresentable rather than merely avoided.
eq("the box gets whole pages, then the online stock starts a fresh one", both.pageKinds, [BOX, ONLINE]);
eq("the last box page is still nine pockets", both.pages[0].length, 9);
eq("...padded rather than reflowed", both.pages[0].filter((p) => p === null).length, 8);
for (const [i, page] of both.pages.entries()) {
  const kinds = new Set(page.filter(Boolean).map((c) => c.source));
  if (kinds.size > 1) fail(`page ${i + 1} mixes the box with the online stock`);
  if (![...kinds].every((k) => k === both.pageKinds[i])) fail(`page ${i + 1} is not the section pageKinds says it is`);
}

// The same card on both sides stays two pockets. Folded into one, "×4" would
// count cards that are not in the room, which is the promise the box section
// makes and the online section deliberately does not.
const SPLIT = binderView(
  [co({ id: "a", sku: "AB12", title: "Gengar VMAX 020/198", sticker_pence: 4000 })],
  {},
  { listings: [{ ebay_item_id: "L9", sku: "ZZ99", title: "Gengar VMAX 020/198", price_value: 55, quantity: 1 }] }
);
eq("a card in the box and also listed is two pockets", SPLIT.cards.length, 2);
eq("...one of each", SPLIT.cards.map((c) => c.source), [BOX, ONLINE]);
eq("...and neither says it has two", SPLIT.cards.map((c) => c.count), [1, 1]);

// An online pocket is the same allow-list. The SKU in particular is our shelf
// address and must not ride out on it — the desk resolves it on a tap.
const web = both.cards.find((c) => c.source === ONLINE);
eq("an online pocket carries exactly the allowed keys", Object.keys(web).sort(), [...BINDER_FIELDS].sort());
ok("an online pocket carries no SKU", !JSON.stringify(web).toLowerCase().includes("cd20"));
eq("the online price is eBay's, unconverted", web.priceText, "£120");
eq("...and says there is a dearer listing behind it", web.priceFrom, true);
eq("the online art goes through the same size rule", web.image, "https://i.ebayimg.com/images/g/z/s-l500.jpg");

// Scope: both by default, because half the stock being at home is the bigger
// half of the cap a binder exists to lift.
eq("the default is both", DEFAULT_SCOPE, "all");
eq("only the box", binderView(THREE, { scope: BOX }, { listings: LISTINGS }).cards.map((c) => c.source), [BOX]);
eq("only what is listed", binderView(THREE, { scope: ONLINE }, { listings: LISTINGS }).cards.map((c) => c.source), [ONLINE, ONLINE]);
ok("every offered scope is one the view understands",
  BINDER_SCOPES.every((sc) => Number.isFinite(binderView(THREE, { scope: sc.key }, { listings: LISTINGS }).cardCount)));
ok("a narrowed scope counts as filtering", isFiltering({ scope: BOX }) === true);
ok("no listings at all is not a crash", binderView(THREE, {}, {}).box.cardCount === 1);

// The wording. "Ask", never "not here": not everything that travels gets
// checked out, so a card can be in the box and absent from the box section,
// and telling a customer we haven't got it loses a sale already made.
for (const key of [BOX, ONLINE]) {
  if (!SECTION_LABELS[key]?.title || !SECTION_LABELS[key]?.note) fail(`the ${key} section has no label`);
}
ok("the online section invites a question", /ask/i.test(SECTION_LABELS[ONLINE].note));
if (/not here|we don't have|haven't got/i.test(SECTION_LABELS[ONLINE].note)) {
  fail("the online section claims the card is absent — checkout is not complete enough to know that");
}

// Where an ONLINE card is, is a different question. It has not been checked
// out, so it still has a live stack position — and that is the useful answer,
// where the box's is the SKU on its sleeve.
const shelf = locationsBySku(
  [{ id: "s1", sku: "CD20", stack_id: "st", position: 1 }, { id: "s2", sku: "CD21", stack_id: "st", position: 2 }],
  new Map([["st", "C"]])
);
const placed = copyLocations(web, {
  skuByListing: new Map([["L1", "CD20"], ["L2", "CD21"]]),
  locations: shelf
});
eq("a listed card has a live position", placed.find((f) => f.id === "L1").location, "C · 1 of 2");
eq("a listed card we cannot place is not guessed at",
  copyLocations(web, { skuByListing: new Map(), locations: shelf })[0].location, null);

// --- 10. greps: the rules that live in one file only --------------------
const binderSrc = code("apps/app/lib/binder.js");
// The PROJECTION cannot leak what it never names. Sliced to the three
// functions that build a pocket rather than run over the whole file, because
// copyLocations() below them legitimately reads the SKU — it is the desk
// resolving its own row on a tap, which is the other half of this design.
const fnBody = (name) => {
  const at = binderSrc.indexOf(`export function ${name}(`);
  if (at < 0) { fail(`binder.js no longer exports ${name}`); return ""; }
  const end = binderSrc.indexOf("\n}", at);
  return binderSrc.slice(at, end < 0 ? binderSrc.length : end);
};
for (const fn of ["pocketOf", "binderCopy", "boxItem", "onlineItem"]) {
  const body = fnBody(fn);
  for (const field of ["sku", "stack_name", "stack_id", "event", "hide_method", "hide_error", "sold_price_pence", "note", "quantity"]) {
    if (body.includes(`.${field}`) || body.includes(`"${field}"`)) {
      fail(`${fn}() names ${field} — a pocket is supposed to be an allow-list`);
    }
  }
}
const deskSrc = code("apps/app/app/panel/ShowDesk.js");
ok("the Show Desk gets the binder from lib/binder.js", /from ["']@\/lib\/binder\.js["']/.test(deskSrc));
// A second page geometry on the screen is how the page number stops meaning
// the same thing on the phone and the tablet.
ok("the page size is defined once", !/BINDER_PAGE\s*=/.test(deskSrc));
// And a second eBay CDN filename rule is a second thing to fix the day eBay
// changes it. showcounter.js's imageAt() is the only one.
const rewritesSize = (t) => t.split("\n").some((l) => /s-l/.test(l) && /replace\s*\(/.test(l));
ok("nobody rewrites an eBay image size by hand", !rewritesSize(deskSrc) && !rewritesSize(binderSrc));

// The screen renders the projection, and the reveal is a tap. Both are things
// a later edit undoes without noticing: a pocket built inline stops being an
// allow-list, and a place printed by default puts a SKU and a stack name on a
// screen somebody may be holding out to a customer.
// Anchored on the LIST branch specifically: `binderMode ? (` also opens the
// toolbar's sort block higher up, and a slice starting there runs straight
// through the binder and into the desk's own rows — which is how the first
// version of this check reported the desk's sticker button as a leak.
const at = deskSrc.indexOf(") : binderMode ? (");
if (at < 0) {
  fail("the binder branch of the render is gone");
} else {
  const branch = deskSrc.slice(at, deskSrc.indexOf("\n            ) : (", at));
  ok("the binder page is rendered from the view", /binder\.pages\[/.test(branch));
  // The section has to be named on the page. It is the only thing separating
  // a card you can hand over from one that may be at home, and the pockets
  // themselves look identical.
  ok("the page says which section it is", /SECTION_LABELS\[binder\.pageKinds\[binderAt\]\]/.test(branch));
  ok("a listed pocket is marked as one", /c\.source === ONLINE/.test(branch));
  ok("the pockets are not built inline", !/counterRow\(|pocketOf\(/.test(branch));
  if (!/binderWhere\.has\(c\.id\) \?/.test(branch)) {
    fail("a copy's place is not gated on a tap — the SKU and the stack are on screen by default");
  }
  for (const forbidden of ["markSold", "returnOne", "setSticker", "toggleSel", "stack-sku", "co.sku", "stack_name"]) {
    if (branch.includes(forbidden)) fail(`the binder renders ${forbidden} — desk data or a destructive control facing a customer`);
  }
}
// The eBay stock has to actually reach the view, and through the view rather
// than a second list stapled on beside it — one grouping path, or the two
// sections eventually disagree about what counts as the same card.
if (!/binderView\([\s\S]{0,400}?listings/.test(deskSrc)) {
  fail("ShowDesk.js does not hand its eBay listings to binderView() — the binder is box-only again");
}

if (failures) {
  console.error(`\ncheck-binder: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-binder: all cases pass");
