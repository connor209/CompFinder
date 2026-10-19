/**
 * Which pile a pull-sheet card goes into.
 *
 * A pile is an ENVELOPE, not an order. eBay hands back one order per checkout,
 * so a buyer who buys three cards in three separate checkouts arrives as three
 * orders — and dealt one pile per order, that is three piles, three envelopes
 * and three lots of postage for one person at one address, with nothing on the
 * screen saying the three belong together.
 *
 * So the pile key is the BUYER (eBay username, which is unique and stable)
 * plus WHERE IT IS GOING. The address half is not decoration: the same account
 * can send one order to home and one to work, and folding those together puts
 * a card in the wrong parcel. Different address, different pile — always.
 *
 * An order with no buyer username cannot be matched to anything, so it keeps a
 * pile of its own rather than being guessed at. Erring apart is the cheap
 * direction: two piles you could have combined cost an envelope, one pile that
 * should have been two costs a card.
 */

/**
 * A comparable fingerprint of a ship-to address: postcode plus first address
 * line, case and spacing flattened. Either half missing still compares on the
 * other; both missing is "" (no address known), which only ever matches
 * another order from the same buyer that also has none.
 */
export function shipKeyOf(contactAddress) {
  const a = contactAddress || {};
  const flat = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const pc = flat(a.postalCode);
  const l1 = flat(a.addressLine1);
  return pc || l1 ? `${pc}|${l1}` : "";
}

/** The pile key for one order line. */
export function pileKeyOf(it) {
  const buyer = String(it?.buyer || "").trim().toLowerCase();
  if (!buyer) return `order:${it?.orderId || ""}`;
  return `buyer:${buyer}|${it?.shipKey || ""}`;
}

/**
 * Number the piles in deal order — pile 1 is the first one you hit — and give
 * each item its pile. A pile lists every order it carries, so the screen can
 * say "2 orders" and the reconciling at the end has every order id to hand.
 *
 * `seq` is the deal sequence; returns { items, piles }.
 */
export function buildPiles(seq) {
  const byKey = new Map();
  const piles = [];
  for (const it of seq) {
    const key = pileKeyOf(it);
    let p = byKey.get(key);
    if (!p) {
      p = { pileNo: piles.length + 1, key, orderIds: [], buyer: it.buyer || "", deliveryName: it.deliveryName || "", count: 0 };
      byKey.set(key, p);
      piles.push(p);
    }
    if (!p.deliveryName && it.deliveryName) p.deliveryName = it.deliveryName;
    if (it.orderId && !p.orderIds.includes(it.orderId)) p.orderIds.push(it.orderId);
    p.count += 1;
  }
  // seqNo is the card's place in the FULL deal sequence — it stays stable
  // when filters hide rows, so "card 47" is still card 47 in your hand.
  const items = seq.map((it, i) => {
    const p = byKey.get(pileKeyOf(it));
    return { ...it, pileNo: p.pileNo, pileOrders: p.orderIds.length, seqNo: i + 1 };
  });
  return { items, piles };
}

/**
 * Where each card is in the HAND — the pile of cards just pulled for the
 * orders, dealt from the top — once the completed piles have left it.
 *
 * Piles are dealt one at a time, and a finished pile's cards are out of your
 * hand: if Pile 1 took card 1, what was card 2 is card 1 when Pile 2 starts.
 * So the number is a live rank among the cards still held, never the card's
 * place in the original deal.
 *
 * A quantity-2 line is two cards in the hand, so it takes two numbers
 * ({ from: 3, to: 4 }) and everything after it counts both.
 *
 * `items` is buildPiles().items in deal order; `doneKeys` holds the line keys
 * of every completed pile. Returns { pos: Map<key, {from,to}>, depth }.
 */
export function handPositions(items, doneKeys) {
  const done = doneKeys || new Set();
  const pos = new Map();
  let n = 0;
  for (const it of items || []) {
    if (done.has(it.key)) continue;
    const q = Math.max(1, Number(it.qty) || 1);
    pos.set(it.key, { from: n + 1, to: n + q });
    n += q;
  }
  return { pos, depth: n };
}

/**
 * The pile being dealt now: the lowest-numbered pile with a card still in the
 * hand, or null when every pile is complete. A pile that gains a line on a
 * refresh (the same buyer ordered again) comes back round rather than being
 * skipped, because its envelope is not finished.
 */
export function currentPileNo(items, doneKeys) {
  const done = doneKeys || new Set();
  let best = null;
  for (const it of items || []) {
    if (done.has(it.key)) continue;
    if (best == null || it.pileNo < best) best = it.pileNo;
  }
  return best;
}

/**
 * Every pile at a glance — who it is for and whether it is packed — so the
 * whole deal can be checked against the envelopes on the table. A pile is
 * done when every one of its lines is in a completed pile; the current one is
 * currentPileNo(). `cards` counts quantity, the same as the hand does.
 */
export function pileOverview(items, piles, doneKeys) {
  const done = doneKeys || new Set();
  const current = currentPileNo(items, done);
  const byNo = new Map();
  for (const it of items || []) {
    const s = byNo.get(it.pileNo) || { cards: 0, open: 0 };
    s.cards += Math.max(1, Number(it.qty) || 1);
    if (!done.has(it.key)) s.open += 1;
    byNo.set(it.pileNo, s);
  }
  return (piles || []).map((p) => {
    const s = byNo.get(p.pileNo) || { cards: 0, open: 0 };
    const state = s.open === 0 ? "done" : p.pileNo === current ? "current" : "todo";
    return { pileNo: p.pileNo, name: p.deliveryName || p.buyer || "Buyer", buyer: p.buyer, orders: p.orderIds.length, cards: s.cards, state };
  });
}

/**
 * One pile's cards top of the hand first — card 1 at the head of the list.
 */
export function pilePullOrder(items, pileNo, pos) {
  return (items || [])
    .filter((it) => it.pileNo === pileNo && pos.has(it.key))
    .sort((a, b) => pos.get(a.key).from - pos.get(b.key).from);
}

/**
 * Where each still-unticked card in the pile is NOW, with the ticked ones
 * already out of the hand. Listed top-first, taking card 2 moves what was
 * card 9 up to 8 — so the number has to move the moment the tick lands, not
 * at Pile complete, or the second card you reach for is the wrong one.
 * Pile complete then makes the same closing-up permanent for the next pile.
 *
 * `cards` is pilePullOrder()'s list, `pos` handPositions().pos, `ticked` the
 * set of line keys already dealt. Returns Map<key, {from,to}> for unticked
 * cards only.
 */
export function pileLivePositions(cards, pos, ticked) {
  const done = ticked || new Set();
  const out = new Map();
  let gone = 0; // ticked cards above this one, counted in units
  for (const it of cards || []) {
    const at = pos.get(it.key);
    if (!at) continue;
    if (done.has(it.key)) {
      gone += at.to - at.from + 1;
      continue;
    }
    out.set(it.key, { from: at.from - gone, to: at.to - gone });
  }
  return out;
}
