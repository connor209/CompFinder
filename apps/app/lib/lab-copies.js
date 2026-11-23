/**
 * The quantity-listing LAB: one eBay listing per card + condition at quantity
 * N, showing the scans of the copy that goes next, with that copy reserved the
 * moment it sells. See docs/LAB_COPIES.md for the test this exists to run.
 *
 * A SIDE BUILD, on purpose. Nothing here reads or writes `stack_cards`,
 * `stock_checkouts` or `listing_copy_state`, and nothing outside the lab
 * imports this file. The lab's copies are its own rows (`lab_copies`), so the
 * pull sheet, Reconcile, the Show Desk and the nightly import never see them
 * as stack cards. The one thing the rest of the app CAN see is the eBay
 * listing itself, which the nightly sync stores like any other; it carries no
 * Custom Label, so the stack import skips it, and its orders reach the pull
 * sheet as loose picks with no stack card behind them.
 *
 * Pure: no I/O. lab-store.js reads and writes, app/api/lab does the eBay
 * calls, and every decision about which copy is which is made here.
 */

import { reconcile } from "./copyqueue.js";

/** eBay allows 24; a card needs a front, a back and a couple of close-ups. */
export const MAX_SCANS = 12;

/**
 * Ungraded card condition, as eBay's trading-card category takes it:
 * ConditionID 4000 with descriptor 40001. The values are the ones ListForm
 * already sends; DMG has no eBay grade below "heavily played", so it is
 * refused rather than listed under a better one.
 */
export const CONDITION_DESCRIPTOR = { NM: "400010", LP: "400011", MP: "400012", HP: "400013" };
export const LISTABLE_CONDITIONS = Object.keys(CONDITION_DESCRIPTOR);

/** What the listing says about the photo, because it is now a promise. */
export const PHOTO_PROMISE =
  "The photos show the exact copy you will receive. If you buy more than one, " +
  "the others are further copies of the same card in the same condition.";

const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** One listing's key: the card, then its condition. Two conditions are two listings. */
export function groupKey(item) {
  return [norm(item?.cardName), norm(item?.cardNumber), norm(item?.set), String(item?.condition || "").toUpperCase()].join("|");
}

/**
 * The listings a CardUploader export becomes. `items` are
 * CardUploaderCsv.extractItems() rows, in file order — which is scan order,
 * and therefore the order the copies sit in the pile.
 *
 * Returns `{ groups, refused }`. A copy is refused, by SKU and with the
 * reason, rather than listed wrongly: no scans (there would be no photo to
 * promise), graded (a slab is not this test), a condition eBay cannot be
 * told, or a SKU used twice in the file.
 */
export function groupsFromItems(items) {
  const groups = new Map();
  const refused = [];
  const seen = new Set();
  (items || []).forEach((it, i) => {
    const sku = String(it?.sku || "").trim();
    const why =
      !sku ? "no SKU (CustomLabel) on the row"
      : seen.has(sku.toLowerCase()) ? "the same SKU appears twice in the file"
      : !(it.images || []).length ? "no scans in PicURL"
      : it.graded ? "a graded card — not part of this test"
      : !LISTABLE_CONDITIONS.includes(String(it.condition || "").toUpperCase())
        ? `condition "${it.conditionLabel || it.condition || "blank"}" can't be listed as an ungraded card`
      : null;
    if (sku) seen.add(sku.toLowerCase());
    if (why) { refused.push({ sku: sku || `row ${i + 2}`, title: it?.title || "", why }); return; }
    const key = groupKey(it);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: String(it.title || `${it.cardName} ${it.cardNumber} ${it.set}`).replace(/\s+/g, " ").trim().slice(0, 80),
        cardName: it.cardName, cardNumber: it.cardNumber, set: it.set,
        language: it.language || "English",
        condition: String(it.condition).toUpperCase(),
        copies: []
      });
    }
    groups.get(key).copies.push({ sku, seq: i, scans: (it.images || []).slice(0, MAX_SCANS) });
  });
  return { groups: [...groups.values()], refused };
}

/**
 * The order copies of one listing are sold in: `copy_seq`, then when it was
 * added, then the id — the same three keys copyqueue.js uses, so the head of
 * the queue never changes between two reads of the same rows.
 */
export function copyOrder(a, b) {
  const sa = Number.isFinite(Number(a?.copy_seq)) ? Number(a.copy_seq) : Infinity;
  const sb = Number.isFinite(Number(b?.copy_seq)) ? Number(b.copy_seq) : Infinity;
  if (sa !== sb) return sa - sb;
  const ta = String(a?.added_at || "");
  const tb = String(b?.added_at || "");
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a?.id).localeCompare(String(b?.id));
}

/**
 * Still for sale: not reserved for an order and not pulled. Reserved is the
 * half copyqueue.js does not have, and the reason this lab exists — a copy
 * that has SOLD but is still on the shelf must leave the queue at once, or the
 * listing keeps showing a card somebody has already bought.
 */
export function isForSale(c) {
  return Boolean(c) && !c.pulled_at && !c.reserved_line;
}

/** One listing's queue, head first. */
export function queueOf(listingId, copies) {
  const id = String(listingId || "");
  return (copies || []).filter((c) => String(c.listing_id) === id && isForSale(c)).sort(copyOrder);
}

/**
 * What one listing should show, in the shape copyqueue's reconcile() reads:
 * the head copy's scans and the number of copies for sale.
 */
export function desiredFor(listing, copies) {
  const queue = queueOf(listing?.id, copies);
  const head = queue[0] || null;
  const scans = head ? (head.scan_urls || []).filter(Boolean).slice(0, MAX_SCANS) : [];
  return { itemId: String(listing?.ebay_item_id || ""), queue, head, quantity: queue.length, pictureUrls: scans.length ? scans : null };
}

/**
 * What to change on eBay for one listing. `available` is eBay's own live
 * count (GetItem), or null if it could not be read.
 *
 * Built on copyqueue's reconcile(), with `pictured_copy_id` standing in for
 * its state row. Quantity is REPORTED, never sent from here: eBay takes a
 * sold copy off the count itself, so a difference means something we did not
 * do (a cancelled order, an edit in Seller Hub) and is a question for a
 * person, with a button, rather than a write on a schedule.
 */
export function planFor(listing, copies, available) {
  const desired = desiredFor(listing, copies);
  const r = reconcile(desired, { quantity: available }, { pictured_copy_id: listing?.pictured_copy_id || null });
  return {
    desired,
    pictureUrls: r.changes.pictureUrls || null,
    headId: desired.head ? String(desired.head.id) : null,
    quantityMismatch: available != null && available !== desired.quantity
      ? { ebay: available, ours: desired.quantity }
      : null,
    reasons: r.reasons.filter((x) => !/^quantity/.test(x)),
    blocked: r.blocked
  };
}

/** The key one unit of one order line is reserved under. */
export const unitKey = (lineItemId, unit) => `${lineItemId}#${unit}`;

/**
 * Which copy each newly seen sale takes.
 *
 * `lines` are fetchRecentOrders() rows; only those on a lab listing count.
 * They are taken in SALE order (date, then line id), each unit in turn, and
 * each takes the head of its listing's queue at that moment — which is the
 * copy the listing was showing, unless two sales landed between checks.
 *
 * `shownCopyId` is what the listing was showing when the check started. A
 * reservation whose copy is not that one is FLAGGED: the buyer saw a
 * different photo from the card they will be sent, and that count is the
 * number this whole test is measuring.
 *
 * Idempotent: a unit already reserved is skipped, so running it twice
 * reserves nothing the second time. A unit with no copy left is `oversold` —
 * eBay sold a card we do not have — and is reported, never invented.
 */
export function assignSales(copies, listings, lines) {
  const byItem = new Map((listings || []).map((l) => [String(l.ebay_item_id), l]));
  const taken = new Set((copies || []).filter((c) => c.reserved_line).map((c) => String(c.reserved_line)));
  // A unit released by hand (a cancelled order) is still in eBay's order list;
  // without this it would take the copy straight back on the next check.
  for (const l of listings || []) for (const k of l.released_lines || []) taken.add(String(k));
  const queues = new Map((listings || []).map((l) => [String(l.id), queueOf(l.id, copies)]));
  const shown = new Map((listings || []).map((l) => [String(l.id), l.pictured_copy_id ? String(l.pictured_copy_id) : null]));

  const ordered = (lines || [])
    .filter((ln) => ln && byItem.has(String(ln.ebay_item_id || "")))
    .sort((a, b) => String(a.sold_date || "").localeCompare(String(b.sold_date || "")) || String(a.line_item_id).localeCompare(String(b.line_item_id)));

  const reservations = [];
  const oversold = [];
  for (const ln of ordered) {
    const listing = byItem.get(String(ln.ebay_item_id));
    const q = queues.get(String(listing.id)) || [];
    const n = Math.max(1, Number(ln.quantity) || 1);
    for (let u = 1; u <= n; u++) {
      const key = unitKey(ln.line_item_id, u);
      if (taken.has(key)) continue;
      const copy = q.shift();
      if (!copy) { oversold.push({ listingId: listing.id, orderId: ln.order_id, line: key, title: ln.title }); continue; }
      taken.add(key);
      const saw = shown.get(String(listing.id));
      reservations.push({
        copyId: copy.id,
        sku: copy.sku,
        listingId: listing.id,
        orderId: ln.order_id,
        line: key,
        unit: u,
        soldAt: ln.sold_date || null,
        // Unit 1 is the one the photo promised; later units of the same line
        // are "further copies", which the listing says in words.
        mismatch: u === 1 && saw != null && saw !== String(copy.id)
      });
    }
  }
  return { reservations, oversold };
}

/**
 * Where a copy is in the LAB pile right now: its rank among copies not yet
 * pulled, in pile (file) order. A reserved copy is still on the shelf, so it
 * still counts — the same rule stackpos.js keeps for a sold card nobody has
 * pulled yet.
 */
export function pilePositions(copies) {
  const present = (copies || []).filter((c) => !c.pulled_at).sort((a, b) => (a.pile_seq - b.pile_seq) || String(a.id).localeCompare(String(b.id)));
  return new Map(present.map((c, i) => [String(c.id), i + 1]));
}

/** Reserved and still on the shelf, deepest first — pull from the back and every number above stays true. */
export function pickList(copies) {
  const pos = pilePositions(copies);
  return (copies || [])
    .filter((c) => c.reserved_line && !c.pulled_at)
    .map((c) => ({ ...c, position: pos.get(String(c.id)) || null }))
    .sort((a, b) => (b.position || 0) - (a.position || 0));
}
