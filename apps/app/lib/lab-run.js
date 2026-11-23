/**
 * One check for one account: read the sales, reserve the copies, move the
 * affected listings' photos on to their new head copy. Shared by the lab's
 * button, eBay's sale notification (app/api/lab/ebay-notify) and the nightly
 * sweep (app/api/lab/sweep), so none of them can disagree about what a sale
 * does.
 *
 * BUILT TO SCALE. The cost of a check is the orders in its window plus a
 * couple of calls per listing that CHANGED — never a call per listing held:
 *   - orders are read over a narrow window (ORDER_WINDOW_HOURS): two hours
 *     for a notification, three days for the button and the sweep;
 *   - eBay is asked only about listingsToTouch(): one that just had a copy
 *     reserved, the one a notification named, or one whose photos are behind
 *     its queue by our own rows.
 *
 * Server-only. `sb` may be the signed-in user's client or the admin client:
 * every lab-store call filters on `userId` by hand.
 *
 * SAFE TO RUN TWICE AT ONCE (a notification while somebody presses the
 * button). A reservation is guarded on the copy still being free and the
 * unique index on reserved_line refuses one unit twice; a reservation that
 * loses that race reloads and goes again. Photos are planned again after
 * they are sent, so two runs revising at once still end on the right copy.
 */
import { fetchRecentOrders, fetchItemQuantity, reviseFixedPriceListing } from "./ebay.js";
import { assignSales, planFor, isTransientEbayError, listingsToTouch, ORDER_WINDOW_HOURS } from "./lab-copies.js";
import { loadLab, logEvent, reserveCopy, updateListing } from "./lab-store.js";
import { scanLoads } from "./lab-ebay.js";

const ROUNDS = 3;
const REVISE_WAITS_MS = [0, 4000, 10000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Send the photos, trying again on eBay's temporary errors. */
async function revisePictures(token, itemId, imageUrls) {
  let last;
  for (let i = 0; i < REVISE_WAITS_MS.length; i++) {
    if (REVISE_WAITS_MS[i]) await sleep(REVISE_WAITS_MS[i]);
    try {
      const r = await reviseFixedPriceListing(token, itemId, { imageUrls });
      return { ...r, tries: i + 1 };
    } catch (e) {
      last = e;
      if (!isTransientEbayError(e.message)) break;
    }
  }
  throw last;
}

export async function runCheck(sb, userId, token, { source = "button", itemId = null, windowHours = null } = {}) {
  const notes = [];
  let reserved = 0;
  let mismatched = 0;
  let oversold = 0;
  let lines = null;
  const reservedListingIds = new Set();
  const hours = windowHours || ORDER_WINDOW_HOURS[source] || 72;

  // 1. Sales → reservations, against what each listing was showing.
  for (let round = 0; round < ROUNDS; round++) {
    const lab = await loadLab(sb, userId);
    if (!lab.ok) return { ok: false, error: lab.error, missing: lab.missing };
    const live = lab.listings.filter((l) => l.ebay_item_id && !l.ended_at);
    if (!live.length) return { ok: true, reserved, mismatched, oversold, moved: 0, asked: 0, quantities: [], notes: ["No live lab listings."], sawItem: false };
    if (!lines) lines = await fetchRecentOrders(token, hours / 24);
    const { reservations, oversold: over } = assignSales(lab.copies, live, lines);
    let lost = 0;
    for (const r of reservations) {
      const res = await reserveCopy(sb, userId, r);
      if (!res.ok) { lost += 1; continue; }
      reserved += 1;
      reservedListingIds.add(String(r.listingId));
      if (r.mismatch) mismatched += 1;
      await logEvent(sb, userId, r.listingId, r.mismatch ? "mismatch" : "reserved", {
        sku: r.sku, orderId: r.orderId, line: r.line, soldAt: r.soldAt, via: source
      });
    }
    if (!lost) {
      for (const o of over) {
        oversold += 1;
        notes.push(`Order ${o.orderId} has no copy left to take — eBay sold more than the lab holds.`);
        await logEvent(sb, userId, o.listingId, "oversold", { ...o, via: source });
      }
      break;
    }
    if (round === ROUNDS - 1) notes.push(`${lost} sale${lost === 1 ? "" : "s"} couldn't be reserved after ${ROUNDS} tries — press Check again.`);
  }

  // 2. Photos, for the listings that changed. Planned, sent, then planned
  //    again: a second run that reserved a copy meanwhile leaves a plan
  //    that still differs.
  let moved = 0;
  let asked = 0;
  let quantities = [];
  for (let pass = 0; pass < 2; pass++) {
    const lab = await loadLab(sb, userId);
    if (!lab.ok) break;
    const touch = listingsToTouch(lab.listings, lab.copies, { reservedListingIds: [...reservedListingIds], itemId });
    let changed = 0;
    if (pass === 0) quantities = [];
    for (const l of touch) {
      let available = null;
      let status = null;
      try {
        const q = await fetchItemQuantity(token, l.ebay_item_id);
        asked += 1;
        available = q.available;
        status = q.listingStatus;
      } catch (e) {
        if (pass === 0) notes.push(`${l.title}: couldn't read eBay's count (${e.message}).`);
      }
      const plan = planFor(l, lab.copies, available);
      if (pass === 0 && plan.quantityMismatch) quantities.push({ listingId: l.id, title: l.title, ...plan.quantityMismatch });
      if (pass === 0 && status && status !== "Active") notes.push(`${l.title}: eBay says the listing is ${status}.`);
      if (pass === 0) for (const b of plan.blocked) notes.push(`${l.title}: ${b}.`);
      if (!plan.pictureUrls || (status && status !== "Active")) continue;

      if (!(await scanLoads(plan.pictureUrls[0]))) {
        notes.push(`${l.title}: ${plan.desired.head.sku}'s scan doesn't load from CardUploader — the listing stays on its current photo.`);
        await logEvent(sb, userId, l.id, "error", { message: "next scan does not load", sku: plan.desired.head.sku, via: source });
        continue;
      }
      try {
        const r = await revisePictures(token, l.ebay_item_id, plan.pictureUrls);
        await updateListing(sb, userId, l.id, { pictured_copy_id: plan.headId });
        moved += 1;
        changed += 1;
        await logEvent(sb, userId, l.id, "pictures", { showing: plan.desired.head.sku, pictures: plan.pictureUrls.length, warning: r.warning, tries: r.tries, via: source });
        if (r.warning) notes.push(`${l.title}: eBay accepted the photos with a warning — ${r.warning}`);
      } catch (e) {
        const transient = isTransientEbayError(e.message);
        notes.push(`${l.title}: photo change failed — ${e.message}${transient ? " (eBay may have made it anyway; the next check sends it again)" : ""}`);
        await logEvent(sb, userId, l.id, "error", { message: e.message, sku: plan.desired.head.sku, transient, via: source });
      }
    }
    if (!changed) break;
  }

  // Only the listings this check could speak for get a new "checked" time.
  const lab = await loadLab(sb, userId);
  const now = new Date().toISOString();
  if (lab.ok) {
    const scope = source === "notification"
      ? lab.listings.filter((l) => l.ebay_item_id && String(l.ebay_item_id) === String(itemId))
      : lab.listings.filter((l) => l.ebay_item_id && !l.ended_at);
    for (const l of scope) await updateListing(sb, userId, l.id, { checked_at: now }).catch(() => {});
  }
  const sawItem = itemId ? (lines || []).some((ln) => String(ln.ebay_item_id) === String(itemId)) : null;
  return { ok: true, reserved, mismatched, oversold, moved, asked, orders: (lines || []).length, windowHours: hours, quantities, notes, sawItem };
}
