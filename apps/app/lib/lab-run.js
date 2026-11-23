/**
 * One "check for sales" for one account: read the sales, reserve the copies,
 * move each listing's photos on to its new head copy. Shared by the lab's
 * button and by eBay's sale notification (app/api/lab/ebay-notify), so the
 * two can never disagree about what a sale does.
 *
 * Server-only. `sb` may be the signed-in user's client or the admin client:
 * every lab-store call filters on `userId` by hand, so both are safe.
 *
 * SAFE TO RUN TWICE AT ONCE, which a notification arriving while somebody
 * presses the button will do. A reservation is guarded on the copy still
 * being free and the unique index on reserved_line refuses one unit twice;
 * a reservation that loses that race reloads and goes again rather than
 * leaving its sale without a copy. The photos are planned again after they
 * are sent, so two runs revising at once still end on the right copy.
 */
import { fetchRecentOrders, fetchItemQuantity, reviseFixedPriceListing } from "./ebay.js";
import { assignSales, planFor } from "./lab-copies.js";
import { loadLab, logEvent, reserveCopy, updateListing } from "./lab-store.js";
import { scanLoads } from "./lab-ebay.js";

const ROUNDS = 3;

export async function runCheck(sb, userId, token, { source = "button", itemId = null } = {}) {
  const notes = [];
  let reserved = 0;
  let mismatched = 0;
  let oversold = 0;
  let lines = null;

  // 1. Sales → reservations, against what each listing was showing.
  for (let round = 0; round < ROUNDS; round++) {
    const lab = await loadLab(sb, userId);
    if (!lab.ok) return { ok: false, error: lab.error, missing: lab.missing };
    const live = lab.listings.filter((l) => l.ebay_item_id && !l.ended_at);
    if (!live.length) return { ok: true, reserved, mismatched, oversold, moved: 0, quantities: [], notes: ["No live lab listings."], sawItem: false };
    if (!lines) lines = await fetchRecentOrders(token, 30);
    const { reservations, oversold: over } = assignSales(lab.copies, live, lines);
    let lost = 0;
    for (const r of reservations) {
      const res = await reserveCopy(sb, userId, r);
      if (!res.ok) { lost += 1; continue; }
      reserved += 1;
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

  // 2. Photos. Planned, sent, then planned again: a second run that reserved
  //    a copy while this one was revising leaves a plan that still differs.
  let moved = 0;
  let quantities = [];
  for (let pass = 0; pass < 2; pass++) {
    const lab = await loadLab(sb, userId);
    if (!lab.ok) break;
    const live = lab.listings.filter((l) => l.ebay_item_id && !l.ended_at);
    let changed = 0;
    quantities = [];
    for (const l of live) {
      let available = null;
      let status = null;
      try {
        const q = await fetchItemQuantity(token, l.ebay_item_id);
        available = q.available;
        status = q.listingStatus;
      } catch (e) {
        if (pass === 0) notes.push(`${l.title}: couldn't read eBay's count (${e.message}).`);
      }
      const plan = planFor(l, lab.copies, available);
      if (plan.quantityMismatch) quantities.push({ listingId: l.id, title: l.title, ...plan.quantityMismatch });
      if (pass === 0 && status && status !== "Active") notes.push(`${l.title}: eBay says the listing is ${status}.`);
      if (pass === 0) for (const b of plan.blocked) notes.push(`${l.title}: ${b}.`);
      if (!plan.pictureUrls || (status && status !== "Active")) continue;

      if (!(await scanLoads(plan.pictureUrls[0]))) {
        notes.push(`${l.title}: ${plan.desired.head.sku}'s scan doesn't load from CardUploader — the listing stays on its current photo.`);
        await logEvent(sb, userId, l.id, "error", { message: "next scan does not load", sku: plan.desired.head.sku, via: source });
        continue;
      }
      try {
        const r = await reviseFixedPriceListing(token, l.ebay_item_id, { imageUrls: plan.pictureUrls });
        await updateListing(sb, userId, l.id, { pictured_copy_id: plan.headId });
        moved += 1;
        changed += 1;
        await logEvent(sb, userId, l.id, "pictures", { showing: plan.desired.head.sku, pictures: plan.pictureUrls.length, warning: r.warning, via: source });
        if (r.warning) notes.push(`${l.title}: eBay accepted the photos with a warning — ${r.warning}`);
      } catch (e) {
        notes.push(`${l.title}: photo change failed — ${e.message}`);
        await logEvent(sb, userId, l.id, "error", { message: e.message, sku: plan.desired.head.sku, via: source });
      }
    }
    if (!changed) break;
  }

  const lab = await loadLab(sb, userId);
  const now = new Date().toISOString();
  if (lab.ok) for (const l of lab.listings.filter((x) => x.ebay_item_id && !x.ended_at)) await updateListing(sb, userId, l.id, { checked_at: now }).catch(() => {});
  const sawItem = itemId ? (lines || []).some((ln) => String(ln.ebay_item_id) === String(itemId)) : null;
  return { ok: true, reserved, mismatched, oversold, moved, quantities, notes, sawItem };
}
