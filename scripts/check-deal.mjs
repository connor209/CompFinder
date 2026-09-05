/**
 * The Current Deal — one basket, one customer, one number.
 *
 *   node scripts/check-deal.mjs      (or: npm run check)
 *
 * A customer puts four cards on the table and asks for a price on the lot.
 * Everything expensive about that happens in the last half second, when one
 * tap sells all four, so this file is mostly about what must be TRUE before
 * and after that tap.
 *
 * Four things earn their place here, and none of them fail loudly in the app:
 *
 * - **The split has to sum to the money that changed hands.** Allocate a £100
 *   lot across four cards by proportion and rounding leaves you at £99.99 —
 *   the takings total then disagrees with the notes in the tin by a penny per
 *   deal, for ever, and nobody ever finds it. The last line absorbs the
 *   remainder; case 2 asserts the sum over awkward numbers.
 * - **A card with no price cannot be sold.** Same rule as exportGuard() in
 *   zero-price.js: a card recorded as sold for nothing is indistinguishable
 *   on every screen from a card sold for a pound.
 * - **A failed eBay call must never roll the money back.** Venue wifi is worst
 *   exactly when you are busiest. Case 5 fails the end-listing call and
 *   asserts the sale is still written, reported, and offered as a retry.
 * - **The listing is ended ONCE.** The whole point of the basket over ⤴ Show
 *   then £ Sold is that it does not hide a listing only to end it a moment
 *   later. Case 6 counts the calls.
 *
 * The Supabase client and the eBay call are both faked, so this runs offline
 * with no framework and no network.
 */
import { readFileSync } from "node:fs";
import {
  listingLine, checkoutLine, emptyDeal, inDeal, addLine, removeLine,
  setLineOn, setLinePrice, setDealTotal, activeLines, dealSubtotal,
  splitDeal, dealPrices, dealBlockers, dealSummary, sellLine, sellDeal,
  retryEnds, parseDealPence, priceSourceLabel, FROM_BOX, FROM_LIVE,
  loadDeal, saveDeal, DEAL_TTL_MS
} from "../apps/app/lib/deal.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (what, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) fail(`${what}: got ${a}, expected ${b}`);
};
const ok = (what, cond) => { if (!cond) fail(what); };

/* ------------------------------------------------------------ fake Supabase
 * Enough of the client to record what the code TRIED to do. Every table it
 * touches is one this repo already has; a new one would show up here as an
 * unexpected key rather than as a migration nobody ran.
 */
function fakeSb({ stackCards = [], stacks = [], failInsert = false, resolved = [] } = {}) {
  const log = { updates: [], inserts: [], selects: [] };
  const table = (name) => {
    const q = {
      _name: name, _filters: {}, _updated: false,
      select() { log.selects.push(name); return q; },
      eq(col, val) { q._filters[col] = val; return q; },
      // `.is("resolved_at", null)` is how sellLine refuses to resolve a
      // checkout twice, so the fake has to be able to match nothing.
      is(col, val) { q._filters[col] = val; return q; },
      ilike(col, val) { q._filters[col] = val; return q; },
      // .update(patch).eq("id", …) — the filter lands AFTER update(), so keep
      // the live filters object rather than a snapshot taken too early.
      update(patch) { q._updated = true; log.updates.push({ table: name, patch, where: q._filters }); return q; },
      insert(rowIn) {
        if (failInsert) return { select: () => ({ single: async () => ({ data: null, error: { message: "insert refused" } }) }) };
        log.inserts.push({ table: name, row: rowIn });
        return { select: () => ({ single: async () => ({ data: { id: `new-${log.inserts.length}` }, error: null }) }) };
      },
      maybeSingle: async () => ({ data: stacks.find((s) => s.id === q._filters.id) || null, error: null }),
      then(res) {
        let data = [];
        if (q._updated && name === "stock_checkouts") {
          // An update guarded on resolved_at IS null matches nothing when the
          // row has already been resolved elsewhere.
          const blocked = "resolved_at" in q._filters && resolved.includes(q._filters.id);
          data = blocked ? [] : [{ id: q._filters.id }];
        } else if (name === "stack_cards" && !q._updated) {
          data = stackCards.filter((c) => !q._filters.sku || String(c.sku).toLowerCase() === String(q._filters.sku).toLowerCase());
        }
        return Promise.resolve({ data, error: null }).then(res);
      }
    };
    return q;
  };
  return { from: table, auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, _log: log };
}
const endsOk = (calls) => async (itemId) => { calls.push(itemId); return { ok: true }; };
const endsFail = (calls) => async (itemId) => { calls.push(itemId); return { ok: false, error: "eBay timed out" }; };

/* ================================================================= 1. lines
 * The price a card starts at is a FALLBACK CHAIN, best evidence first:
 * sticker, then what we ask on eBay, then the market figure. A sticker is a
 * decision somebody made holding the card; a market figure is the engine
 * guessing. Quoting the wrong end of that chain without saying so is how you
 * argue with a customer holding the receipt.
 */
console.log("1. where a line's price comes from");
{
  const box = checkoutLine({ id: "co-1", sku: "C4", title: "Gengar VMAX 020/172", sticker_pence: 3400, ebay_item_id: "111", stack_card_id: "sc-1", hide_method: "quantity" });
  eq("sticker wins", [box.price, box.priceSource], [3400, "sticker"]);
  eq("a box line knows where it came from", box.from, FROM_BOX);

  const noSticker = checkoutLine({ id: "co-2", sku: "AB11", title: "Umbreon V 189/203" }, { listedPence: 2200 });
  eq("no sticker falls through to the eBay ask", [noSticker.price, noSticker.priceSource], [2200, "listed"]);

  const bare = checkoutLine({ id: "co-3", sku: "Z9", title: "Some card" });
  eq("nothing to go on is null, never zero", [bare.price, bare.priceSource], [null, null]);

  const live = listingLine({ ebay_item_id: "222", sku: "AB2", title: "Iron Hands ex 070/162", price_value: 12.5 });
  eq("a listing line takes the ask", [live.price, live.priceSource, live.from], [1250, "listed", FROM_LIVE]);

  const unpriced = listingLine({ ebay_item_id: "333", sku: "D17", title: "Charizard ex", price_value: null }, { marketPence: 4199 });
  eq("an unpriced listing falls through to market", [unpriced.price, unpriced.priceSource], [4199, "market"]);

  // A £0.00 listing is a card nothing priced (zero-price.js), not a free card.
  // It must not arrive in the basket looking like a priced line.
  const zero = listingLine({ ebay_item_id: "444", sku: "E1", title: "Zeroed card", price_value: 0 });
  eq("a zero ask is a price of zero, and the sale below refuses it", zero.price, 0);
  ok("every source has prose", ["sticker", "listed", "market", "hand"].every((s) => priceSourceLabel(s) !== "no price"));

  // The same card, checked out AND still carrying a live listing row, must go
  // in once — otherwise it sells to one customer at two prices.
  let d = addLine(emptyDeal(), box);
  d = addLine(d, listingLine({ ebay_item_id: "999", sku: "c4", title: "Gengar VMAX 020/172", price_value: 34 }));
  eq("the same SKU cannot enter twice from two screens", d.lines.length, 1);
  ok("and inDeal knows it by SKU alone", inDeal(d, { sku: "C4" }));
  eq("adding the identical line again is a no-op", addLine(d, box).lines.length, 1);
}

/* ============================================================ 2. the split
 * The rule that costs money if it is wrong.
 */
console.log("2. an agreed lot price, split back over the cards");
{
  const lines = [{ price: 3400 }, { price: 2200 }, { price: 1250 }, { price: 4199 }];
  const sub = lines.reduce((t, l) => t + l.price, 0);
  eq("subtotal", sub, 11049);

  const parts = splitDeal(lines, 10000);
  eq("the parts sum to exactly the agreed total", parts.reduce((t, n) => t + n, 0), 10000);
  eq("and they are proportional", parts, [3077, 1991, 1131, 3801]);

  // The awkward ones: thirds, and a lot dearer than the sum.
  for (const [total, ls] of [
    [10000, [{ price: 100 }, { price: 100 }, { price: 100 }]],
    [1, [{ price: 500 }, { price: 500 }]],
    [12345, [{ price: 1 }, { price: 99999 }]],
    [5000, [{ price: 1000 }]],
    [7777, [{ price: 0 }, { price: 0 }, { price: 0 }]]
  ]) {
    const p = splitDeal(ls, total);
    eq(`${ls.length} cards for ${total}p sums exactly`, p.reduce((t, n) => t + n, 0), total);
    ok(`${ls.length} cards for ${total}p stays non-negative`, p.every((n) => n >= 0));
  }

  eq("no lot total means every card keeps its own price", splitDeal(lines, null), [3400, 2200, 1250, 4199]);
  eq("no lines, no parts", splitDeal([], 5000), []);
}

/* ========================================================= 3. the basket UI
 */
console.log("3. ticking, untick, typing a price");
{
  let d = emptyDeal("Glasgow Card Show");
  d = addLine(d, checkoutLine({ id: "a", sku: "C4", title: "Gengar", sticker_pence: 3400 }));
  d = addLine(d, checkoutLine({ id: "b", sku: "AB11", title: "Umbreon", sticker_pence: 2200 }));
  d = setDealTotal(d, 5000);
  eq("two ticked", dealSummary(d).count, 2);
  eq("the payable figure is the lot total", dealSummary(d).payablePence, 5000);
  eq("and the discount is named", dealSummary(d).discountPence, 600);

  // Unticking keeps the line — that is how you sell one and keep the other in
  // play while they think about it.
  d = setLineOn(d, "C:b", false);
  eq("an unticked line stays in the basket", d.lines.length, 2);
  eq("but is not sold", activeLines(d).length, 1);
  eq("and leaves the subtotal", dealSubtotal(d), 3400);

  d = setLineOn(d, "C:b", true);
  // Typing over one price clears the lot total: you have gone back to pricing
  // card by card, so there is no agreed figure left for the split to honour.
  d = setLinePrice(d, "C:a", 3000);
  eq("typing a line price clears the lot total", d.totalPence, null);
  eq("and marks the line as hand-typed", d.lines[0].priceSource, "hand");
  eq("the payable figure is the sum again", dealSummary(d).payablePence, 5200);

  d = removeLine(d, "C:a");
  eq("removed", d.lines.length, 1);

  eq("a typed zero is refused, the way an override is", parseDealPence("0").pence, null);
  ok("and says why", Boolean(parseDealPence("0").error));
  eq("a real number parses", parseDealPence("12.50").pence, 1250);
}

/* ======================================================= 4. the price guard
 */
console.log("4. a card with no price cannot be sold");
{
  let d = emptyDeal();
  d = addLine(d, checkoutLine({ id: "a", sku: "C4", title: "Gengar", sticker_pence: 3400 }));
  d = addLine(d, checkoutLine({ id: "b", sku: "AB11", title: "Umbreon V 189/203" })); // no sticker, no ask
  const s = dealSummary(d);
  eq("one blocker", s.blockers.length, 1);
  ok("the sale is refused", !s.canSell);
  ok("and the refusal NAMES the card, rather than being gone hunting for", /AB11/.test(s.blockedReason || ""));

  const sb = fakeSb();
  const calls = [];
  const res = await sellDeal(sb, d, { endListing: endsOk(calls) });
  ok("sellDeal refuses outright", res.ok === false);
  eq("and nothing was written", [sb._log.inserts.length, sb._log.updates.length], [0, 0]);
  eq("and eBay was not called", calls.length, 0);

  // Untick it and the rest goes.
  const after = await sellDeal(sb, setLineOn(d, "C:b", false), { endListing: endsOk(calls) });
  ok("with the unpriced card unticked, the rest sells", after.ok);
  eq("one card sold", after.results.length, 1);
}

/* ===================================================== 5. selling, per world
 */
console.log("5. what one tap actually does to each card");
{
  // (a) a card already in the box: today's markSold path.
  {
    const sb = fakeSb();
    const calls = [];
    const line = checkoutLine({ id: "co-1", sku: "C4", title: "Gengar", sticker_pence: 3400, ebay_item_id: "111", stack_card_id: "sc-1", hide_method: "quantity" });
    const r = await sellLine(sb, line, 3077, { endListing: endsOk(calls) });
    ok("sold", r.ok);
    const co = sb._log.updates.find((u) => u.table === "stock_checkouts" && u.patch.resolution);
    eq("the open checkout is resolved sold at the SPLIT price", [co.patch.resolution, co.patch.sold_price_pence], ["sold", 3077]);
    eq("and it is the row this line came from", co.where.id, "co-1");
    const sc = sb._log.updates.find((u) => u.table === "stack_cards");
    ok("the stack card is pulled and no longer away", sc.patch.pulled_at && sc.patch.checked_out_at === null);
    eq("the listing was ended, once", calls, ["111"]);
    eq("no second checkout row was invented", sb._log.inserts.length, 0);
  }

  // (b) a card still live on eBay: the new path, and the one that saves a call.
  {
    const sb = fakeSb({ stackCards: [{ id: "sc-9", sku: "AB2", stack_id: "st-1", pulled_at: null, checked_out_at: null }], stacks: [{ id: "st-1", name: "AB" }] });
    const calls = [];
    const line = listingLine({ ebay_item_id: "222", sku: "AB2", title: "Iron Hands ex 070/162", price_value: 12.5 });
    const r = await sellLine(sb, line, 1131, { event: "Glasgow", endListing: endsOk(calls) });
    ok("sold", r.ok);
    const ins = sb._log.inserts.find((i) => i.table === "stock_checkouts");
    ok("a checkout row is written ALREADY resolved", ins.row.resolved_at && ins.row.resolution === "sold");
    eq("at the split price", ins.row.sold_price_pence, 1131);
    ok("matched to the card in its stack", ins.row.stack_card_id === "sc-9");
    eq("with the show on it", ins.row.event, "Glasgow");
    // The row must not claim the listing was pulled before the call that pulls it.
    eq("hide_method starts honest", ins.row.hide_method, "none");
    ok("and becomes 'ended' only after the call succeeded",
      sb._log.updates.some((u) => u.table === "stock_checkouts" && u.patch.hide_method === "ended"));
    eq("ONE eBay call — no hide, then end", calls, ["222"]);
  }

  // (c) no SKU, or a SKU in no stack: the money is still the money.
  {
    const sb = fakeSb();
    const calls = [];
    const line = listingLine({ ebay_item_id: "333", sku: null, title: "Loose card", price_value: 5 });
    const r = await sellLine(sb, line, 500, { endListing: endsOk(calls) });
    ok("a card with no SKU still sells", r.ok);
    const ins = sb._log.inserts.find((i) => i.table === "stock_checkouts");
    eq("recorded against no stack card, rather than refused", ins.row.stack_card_id, null);
    eq("and the listing still ends", calls, ["333"]);
  }

  // (d) already ended at checkout — nothing to end, and no wasted call.
  {
    const sb = fakeSb();
    const calls = [];
    const line = checkoutLine({ id: "co-4", sku: "D1", title: "Card", sticker_pence: 900, ebay_item_id: "444", stack_card_id: "sc-4", hide_method: "ended" });
    const r = await sellLine(sb, line, 900, { endListing: endsOk(calls) });
    ok("sold", r.ok);
    eq("an already-ended listing costs no call", calls, []);
    ok("and the receipt says so", r.did.includes("listing was already ended"));
  }
}

/* ============================================== 6. wifi, and the money first
 * The rule the whole ordering exists for.
 */
console.log("6. a failed eBay call never rolls a sale back");
{
  const sb = fakeSb();
  const calls = [];
  let d = emptyDeal("Glasgow");
  d = addLine(d, checkoutLine({ id: "co-1", sku: "C4", title: "Gengar", sticker_pence: 3400, ebay_item_id: "111", stack_card_id: "sc-1", hide_method: "quantity" }));
  d = addLine(d, checkoutLine({ id: "co-2", sku: "AB11", title: "Umbreon", sticker_pence: 2200, ebay_item_id: "112", stack_card_id: "sc-2", hide_method: "quantity" }));
  d = setDealTotal(d, 5000);

  const res = await sellDeal(sb, d, { endListing: endsFail(calls) });
  ok("the deal still went through", res.ok);
  eq("both cards were tried", res.results.length, 2);
  eq("the takings are the agreed lot price, to the penny", res.soldPence, 5000);
  eq("nothing failed outright", res.failed.length, 0);
  eq("both listings are flagged for a retry", res.unended.length, 2);
  ok("every sale is recorded", sb._log.updates.filter((u) => u.patch.resolution === "sold").length === 2);
  ok("and the failure is written on the row too, not only on screen",
    sb._log.updates.some((u) => u.patch.hide_error && /not ended/.test(u.patch.hide_error)));

  // The retry only ever touches eBay.
  const retryCalls = [];
  const still = await retryEnds(sb, res.unended, { endListing: endsOk(retryCalls) });
  eq("the retry ends both", retryCalls.length, 2);
  eq("and nothing is left over", still.length, 0);

  // A write that genuinely fails is reported as a failure, not swallowed.
  const broken = fakeSb({ failInsert: true });
  const one = await sellLine(broken, listingLine({ ebay_item_id: "555", sku: "X1", title: "Card", price_value: 3 }), 300, { endListing: endsOk([]) });
  ok("an unwritable sale is reported", one.ok === false && Boolean(one.error));
}

/* ================================================ 7. a card sold twice, and
 *                                                     a basket left overnight
 */
console.log("7. the basket sitting on the counter while the world moves on");
{
  // A card sold from the DESK while it was in the basket. Resolving that
  // checkout a second time would count the takings twice — silently, since
  // both writes succeed and the row looks the same afterwards.
  const sb = fakeSb({ resolved: ["co-1"] });
  const calls = [];
  const line = checkoutLine({ id: "co-1", sku: "C4", title: "Gengar", sticker_pence: 3400, ebay_item_id: "111", stack_card_id: "sc-1", hide_method: "quantity" });
  const r = await sellLine(sb, line, 3400, { endListing: endsOk(calls) });
  ok("a checkout already resolved elsewhere is refused", r.ok === false);
  ok("and the refusal says where to look", /already sold or returned/.test(r.error || ""));
  eq("the card is not pulled a second time", sb._log.updates.filter((u) => u.table === "stack_cards").length, 0);
  eq("and no listing call is spent on it", calls, []);

  // An unresolved one still goes through, so the guard is a guard and not a wall.
  const fresh = fakeSb();
  const ok2 = await sellLine(fresh, line, 3400, { endListing: endsOk([]) });
  ok("an open checkout still sells", ok2.ok);
}

console.log("8. a basket does not survive the night");
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k)
  };

  let d = addLine(emptyDeal("Glasgow"), checkoutLine({ id: "a", sku: "C4", title: "Gengar", sticker_pence: 3400 }));
  saveDeal(d);
  eq("a basket from a moment ago comes back", loadDeal().lines.length, 1);
  eq("with its show on it", loadDeal().event, "Glasgow");

  // Yesterday's basket is junk: the cards in it have moved on, and figures
  // about stock that has moved are worse than no figures.
  const tomorrow = Date.now() + DEAL_TTL_MS + 1000;
  eq("yesterday's basket is dropped, not drawn", loadDeal(tomorrow).lines.length, 0);

  // So is anything a older build wrote.
  store.set("cf-current-deal", JSON.stringify({ v: 0, startedAt: new Date().toISOString(), lines: [{ id: "x" }] }));
  eq("and so is a basket from an older build", loadDeal().lines.length, 0);
  store.set("cf-current-deal", "{not json");
  eq("and so is junk", loadDeal().lines.length, 0);
  delete globalThis.localStorage;
}

/* ============================================================= 9. the greps
 */
console.log("9. one definition, and nothing app-shaped in it");
{
  const lib = readFileSync(new URL("../apps/app/lib/deal.js", import.meta.url), "utf8");
  if (/^\s*import\s+.*from\s+["']@\//m.test(lib)) {
    fail("deal.js has picked up an app-aliased import — it has to stay loadable under bare node for this check");
  }
  if (/\breact\b|next\/|supabase-js/i.test(lib.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    fail("deal.js has picked up a framework import — the Supabase client is handed IN so this file stays testable");
  }
  // A line is an ALLOW-LIST, built key by key. Built the other way — spread
  // the row, drop the private bits — it passes every test anyone thinks to
  // write and leaks the day a column is added to stock_checkouts. Same rule as
  // counterRow(); see check-showcounter.mjs.
  if (/\.\.\.co\b|\.\.\.row\b/.test(lib)) {
    fail("a deal line spreads its source row — build the allowed keys, or the next column added rides into the basket");
  }

  // Nothing may end a listing on its own. Two callers ending listings by hand
  // is how the deal and the desk drift into disagreeing about hide_method.
  const files = {
    "apps/app/app/panel/ShowDesk.js": readFileSync(new URL("../apps/app/app/panel/ShowDesk.js", import.meta.url), "utf8"),
    "apps/app/app/panel/DealBar.js": readFileSync(new URL("../apps/app/app/panel/DealBar.js", import.meta.url), "utf8")
  };
  for (const [name, src] of Object.entries(files)) {
    if (/end-listing/.test(src)) {
      fail(`${name} names /api/ebay/end-listing directly — selling a card goes through sellLine() in lib/deal.js, which is the one place that decides whether the listing still needs ending`);
    }
  }
  // The desk's own £ Sold and the basket must be the same act.
  if (!/sellLine\(/.test(files["apps/app/app/panel/ShowDesk.js"])) {
    fail("ShowDesk no longer sells through sellLine() — the desk and the deal would be two definitions of selling a card");
  }
  // ---- what may reach a customer screen -----------------------------------
  // The line is drawn at the WRITE, not at the basket. Adding is inert (rule 1
  // at the top of deal.js), so ＋ Deal on a binder pocket is safe and is the
  // whole reason somebody is flipping the binder with a customer. £ Mark sold
  // is not: one mis-tap by a stranger records a sale and ends a listing.
  const desk = files["apps/app/app/panel/ShowDesk.js"];
  const bar = files["apps/app/app/panel/DealBar.js"];

  if (/DealBar|dealAdd/.test(desk) && !/customerMode/.test(desk)) {
    fail("the desk offers the deal without gating on customerMode — counter and binder mode are pointed at a customer");
  }
  // The full bar (the one with the sell button) renders behind the gate only.
  if (!/customerMode \? null : <DealBar/.test(desk)) {
    fail("the full deal bar is no longer gated `customerMode ? null : <DealBar` — the sell button can reach a customer screen");
  }
  // …and the read-only one that CAN face a customer must stay read-only. It is
  // the whole reason there are two components rather than a prop.
  const tally = bar.slice(bar.indexOf("export function DealTally"));
  const tallyBody = tally.slice(0, tally.indexOf("\nfunction ") + 1 || undefined);
  for (const banned of ["sellDeal", "sellLine", "retryEnds", "setLinePrice", "setDealTotal", "removeLine", "clearDeal"]) {
    if (tallyBody.includes(banned)) {
      fail(`DealTally reaches for ${banned}() — it renders on the binder, which a customer holds, and must have nothing on it to press`);
    }
  }
  if (!/DealTally/.test(desk)) {
    fail("nothing on the desk renders DealTally — the binder shows no basket at all");
  }
}

if (failures) {
  console.error(`\ncheck-deal: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-deal: OK — the split sums to the money, a priceless card can't sell, and bad wifi never costs a sale.");
