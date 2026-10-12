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
