import { queuesBySku, isSellableCopy } from "./copyqueue.js";
import { isCuListingSku, listingSkuKey, titlesDisagree } from "./cu-files.js";

/**
 * Which physical card each unit of each order line is — the pull sheet's one
 * reading of it.
 *
 * Three ways in, tried in this order for a unit not already pulled:
 *
 *   "sku"        the line's SKU IS a stack card's SKU (A50, YGO-AA50). The
 *                ordinary case, unchanged: copyqueue's order picks the copy.
 *   "cardUploader"  a CardUploader variation line (CS-P3NSJY…) and the pick
 *                list export says which copy CardUploader chose for this
 *                order. Taken first, so the copy we pull is the copy it marks
 *                picked — two systems disagreeing about which of fourteen
 *                identical commons went is invisible until the next export
 *                lists a card that is not there.
 *   "variation"  a CardUploader variation line with no file: the front-most
 *                copy on the shelf, in walk order. The caller says so on the
 *                row, because CardUploader may choose a different one.
 *
 * **A unit pulled for THIS line is done, and says which card it was.**
 * `stack_cards.pulled_line` (migration 037) is written on Commit. Without it,
 * a line with several copies behind its SKU breaks the moment it is
 * committed: the pulled copy leaves the queue, the next copy is still there,
 * and a reload hands the same line the next copy — which Commit then pulls
 * as well. Before 037 there is no such record and the caller's old reading
 * (the SKU is pulled ⇒ the line is done) still applies, which is right for
 * the one-card-per-SKU case it was written for.
 *
 * **A copy whose title is plainly another card is never taken** for a
 * variation line (titlesDisagree). The link from a CS- SKU to a stack card
 * comes from CardUploader's location SKU, and its older locations were never
 * ours: a Sableye order went to our E42, which is a different card.
 *
 * A card is given to at most one unit. Units with no card come back with
 * `card: null` and a `reason` the caller can show.
 */
export function assignPulls(lines, cards, { walkCompare, stackNameOf = () => "", cuChoice = null } = {}) {
  const pulledFor = new Map(); // lineItemId -> [card], the cards pulled for that line
  for (const c of cards || []) {
    if (!c?.pulled_at || !c.pulled_line) continue;
    const k = String(c.pulled_line);
    if (!pulledFor.has(k)) pulledFor.set(k, []);
    pulledFor.get(k).push(c);
  }
  for (const list of pulledFor.values()) list.sort((a, b) => String(a.pulled_at).localeCompare(String(b.pulled_at)) || String(a.id).localeCompare(String(b.id)));

  const bySku = queuesBySku(cards);
  const front = (a, b) => {
    const s = walkCompare ? walkCompare(stackNameOf(a.stack_id), stackNameOf(b.stack_id)) : 0;
    return s || (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id));
  };
  const byListing = new Map(); // variation key -> sellable copies, front-most first
  const bySkuExact = new Map(); // location sku -> sellable card, for the file's choice
  const stacked = new Set(); // every variation key with a copy on our stacks, in any state
  for (const c of cards || []) {
    if (c?.listing_sku) stacked.add(listingSkuKey(c.listing_sku));
    if (!isSellableCopy(c)) continue;
    if (c.sku) bySkuExact.set(String(c.sku).trim().toLowerCase(), c);
    const k = c.listing_sku ? listingSkuKey(c.listing_sku) : null;
    if (!k) continue;
    if (!byListing.has(k)) byListing.set(k, []);
    byListing.get(k).push(c);
  }
  for (const list of byListing.values()) list.sort(front);

  const claimed = new Set();
  const units = [];
  for (const l of lines || []) {
    const count = Math.max(1, Number(l.quantity) || 1);
    const done = pulledFor.get(String(l.lineItemId)) || [];
    for (let n = 0; n < count; n++) {
      const key = count > 1 ? `${l.lineItemId}#${n + 1}` : String(l.lineItemId);
      const base = { line: l, n, key, unitOf: count > 1 ? { unit: n + 1, ofUnits: count } : null };
      if (n < done.length) {
        claimed.add(done[n].id);
        units.push({ ...base, card: done[n], done: true, via: "pulled" });
      } else units.push({ ...base, card: null, done: false, via: null });
    }
  }

  const skl = (l) => (l.sku ? String(l.sku).trim().toLowerCase() || null : null);
  const take = (u, card, via) => { claimed.add(card.id); u.card = card; u.via = via; };

  // CardUploader's choices first, so a default pick for one order can never
  // take the copy the file gave another.
  if (cuChoice) {
    for (const u of units) {
      if (u.done || u.card || !isCuListingSku(u.line.sku)) continue;
      const want = listingSkuKey(u.line.sku);
      for (const s of cuChoice.get(String(u.line.orderId)) || []) {
        const c = bySkuExact.get(s);
        if (c && !claimed.has(c.id) && listingSkuKey(c.listing_sku) === want && !titlesDisagree(c.title, u.line.title)) { take(u, c, "cardUploader"); break; }
      }
    }
  }
  for (const u of units) {
    if (u.done || u.card) continue;
    const k = skl(u.line);
    if (!k) { u.reason = "nosku"; continue; }
    const q = (bySku.get(k) || []).find((c) => !claimed.has(c.id));
    if (q) { take(u, q, "sku"); continue; }
    if (isCuListingSku(k)) {
      const list = (byListing.get(listingSkuKey(k)) || []).filter((x) => !claimed.has(x.id));
      const c = list.find((x) => !titlesDisagree(x.title, u.line.title));
      if (c) take(u, c, "variation");
      else u.reason = list.length ? "wrongcard" : stacked.has(listingSkuKey(k)) ? "nocopyleft" : "notstacked";
    }
  }
  return { units, pulledFor };
}

/**
 * How a CardUploader file's choices landed, for one line under the upload
 * button: how many lines followed it, and which of its SKUs named nothing
 * on the shelf — a card CardUploader holds that is not on our stacks, most
 * likely because the inventory export has not been uploaded since its load.
 */
export function cuChoiceReport(units, cuChoice, cards) {
  if (!cuChoice) return null;
  const known = new Set((cards || []).filter((c) => c?.sku).map((c) => String(c.sku).trim().toLowerCase()));
  const lineOrders = new Set(units.map((u) => String(u.line.orderId)));
  const unknown = [];
  for (const [oid, skus] of cuChoice) {
    if (!lineOrders.has(oid)) continue;
    for (const s of skus) if (!known.has(s)) unknown.push(s.toUpperCase());
  }
  const cuLines = units.filter((u) => !u.done && isCuListingSku(u.line.sku));
  return {
    followed: cuLines.filter((u) => u.via === "cardUploader").length,
    defaulted: cuLines.filter((u) => u.via === "variation").length,
    unknown
  };
}

/**
 * Was this card marked pulled somewhere OTHER than the pull sheet's Commit —
 * Reconcile, Stacks' Pull, a stack check — and so possibly still sitting in
 * its stack? Pack offers those "↩ Back to Pick".
 *
 * Commit writes `pulled_line` (migration 037); nothing else does. So a pulled
 * card without one was pulled elsewhere. Before 037 the column is absent from
 * the row altogether and there is no telling the two apart: every pulled card
 * is offered, and the confirm says to use it only for a card still stacked.
 * A card that is not pulled has nothing to undo.
 */
export function pulledOutsideSheet(card) {
  if (!card?.pulled_at) return false;
  if (!("pulled_line" in card)) return true;
  return !card.pulled_line;
}
