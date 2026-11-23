import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getValidUserAccessToken, fetchRecentOrders, fetchItemQuantity,
  reviseFixedPriceListing, reviseItemQuantity, endListing
} from "@/lib/ebay";
import { assignSales, planFor, desiredFor, LISTABLE_CONDITIONS, MAX_SCANS } from "@/lib/lab-copies";
import {
  loadLab, logEvent, insertListing, insertCopies, updateListing, deleteListing,
  reserveCopy, markPulled, releaseCopy
} from "@/lib/lab-store";
import { addLabListing, scanLoads } from "@/lib/lab-ebay";

/**
 * The quantity-listing lab (docs/LAB_COPIES.md). A side build: its own
 * tables, its own screen at /panel/lab, linked from nowhere.
 *
 * GET  → the lab's listings, copies and log.
 * POST { action, ... }:
 *   create      { group, pricePence, settings }  one listing at quantity N
 *   check       {}                               read sales, reserve, move photos on
 *   pull        { copyId }                       the reserved copy has left the pile
 *   release     { copyId }                       a cancelled order: copy back in its queue
 *   setQuantity { listingId }                    make eBay's count match the queue
 *   end         { listingId }                    end the listing on eBay
 *
 * Every eBay change is written to lab_events with what was sent.
 */
export const maxDuration = 120;

const json = (body, status = 200) => NextResponse.json(body, { status });

async function session() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
}

async function tokenFor(userId) {
  return getValidUserAccessToken(createAdminClient(), userId);
}

export async function GET() {
  const { sb, user } = await session();
  if (!user) return json({ ok: false, error: "Not signed in." }, 401);
  const lab = await loadLab(sb, user.id);
  if (!lab.ok) return json(lab, lab.missing ? 200 : 500);
  return json(lab);
}

export async function POST(request) {
  const { sb, user } = await session();
  if (!user) return json({ ok: false, error: "Not signed in." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }

  const lab = await loadLab(sb, user.id);
  if (!lab.ok) return json(lab, lab.missing ? 409 : 500);

  try {
    switch (body.action) {
      case "create": return json(await create(sb, user, lab, body));
      case "check": return json(await check(sb, user, lab));
      case "pull": {
        const ok = await markPulled(sb, user.id, body.copyId);
        if (ok) await logEvent(sb, user.id, null, "pulled", { copyId: body.copyId });
        return json({ ok, error: ok ? null : "That copy isn't reserved, or was already pulled." });
      }
      case "release": {
        const ok = await releaseCopy(sb, user.id, body.copyId);
        if (ok) await logEvent(sb, user.id, null, "released", { copyId: body.copyId });
        return json({ ok, error: ok ? null : "That copy has already been pulled." });
      }
      case "setQuantity": return json(await setQuantity(sb, user, lab, body.listingId));
      case "end": return json(await end(sb, user, lab, body.listingId));
      default: return json({ ok: false, error: "Unknown action." }, 400);
    }
  } catch (err) {
    await logEvent(sb, user.id, body.listingId || null, "error", { action: body.action, message: err.message });
    return json({ ok: false, error: err.message || "Lab action failed." }, 502);
  }
}

async function create(sb, user, lab, { group, pricePence, settings = {} }) {
  const price = Number(pricePence);
  if (!group || !Array.isArray(group.copies) || group.copies.length < 1) return { ok: false, error: "No copies to list." };
  if (!Number.isInteger(price) || price < 99) return { ok: false, error: "Type a price of at least £0.99." };
  if (!LISTABLE_CONDITIONS.includes(group.condition)) return { ok: false, error: `Condition ${group.condition} can't be listed.` };

  const have = new Set(lab.copies.map((c) => String(c.sku).toLowerCase()));
  const dup = group.copies.find((c) => have.has(String(c.sku).toLowerCase()));
  if (dup) return { ok: false, error: `${dup.sku} is already in the lab.` };

  // copy_seq = pile order, so the queue sells them front to back. Left null,
  // every copy would tie on added_at (one insert) and fall to a random id.
  const copies = group.copies.map((c) => ({ sku: c.sku, pile_seq: c.seq, copy_seq: c.seq, scans: (c.scans || []).slice(0, MAX_SCANS) }));
  const head = copies.slice().sort((a, b) => a.pile_seq - b.pile_seq)[0];
  if (!(await scanLoads(head.scans[0]))) {
    return { ok: false, error: `${head.sku}'s first scan doesn't load from CardUploader — nothing was listed.` };
  }

  // Ours first, so a listing eBay accepted always has a row to belong to.
  const listing = await insertListing(sb, user.id, { title: group.title, condition: group.condition, price_pence: price });
  let rows;
  try {
    rows = await insertCopies(sb, user.id, listing.id, copies);
  } catch (e) {
    await deleteListing(sb, user.id, listing.id);
    throw e;
  }
  const headRow = desiredFor(listing, rows).head;

  if (!settings.policies) {
    const { data: profile } = await sb.from("profiles").select("settings").eq("id", user.id).single();
    const p = profile?.settings?.ebayPolicies;
    if (p?.fulfillmentPolicyId) settings.policies = p;
  }

  const token = await tokenFor(user.id);
  if (!token) { await deleteListing(sb, user.id, listing.id); return { ok: false, error: "eBay account not connected." }; }

  let result;
  try {
    result = await addLabListing(token, {
      ...settings,
      title: group.title, pricePence: price, quantity: rows.length, condition: group.condition,
      cardName: group.cardName, cardNumber: group.cardNumber, set: group.set, language: group.language,
      scanUrls: headRow.scan_urls
    });
  } catch (e) {
    await deleteListing(sb, user.id, listing.id);
    return { ok: false, error: e.message };
  }
  await updateListing(sb, user.id, listing.id, { ebay_item_id: result.itemId, pictured_copy_id: headRow.id });
  await logEvent(sb, user.id, listing.id, "listed", {
    itemId: result.itemId, quantity: rows.length, showing: headRow.sku, pricePence: price, warnings: result.warnings
  });
  return { ok: true, itemId: result.itemId, warnings: result.warnings };
}

async function check(sb, user, lab) {
  const live = lab.listings.filter((l) => l.ebay_item_id && !l.ended_at);
  if (!live.length) return { ok: true, reserved: 0, moved: 0, notes: ["No live lab listings."] };
  const token = await tokenFor(user.id);
  if (!token) return { ok: false, error: "eBay account not connected." };

  const notes = [];
  // 1. Sales → reservations, in sale order, against what each listing was showing.
  const lines = await fetchRecentOrders(token, 30);
  const { reservations, oversold } = assignSales(lab.copies, live, lines);
  const copies = lab.copies.map((c) => ({ ...c }));
  let reserved = 0;
  let mismatched = 0;
  for (const r of reservations) {
    const res = await reserveCopy(sb, user.id, r);
    if (!res.ok) { notes.push(`${r.sku}: couldn't reserve for order ${r.orderId}${res.error ? ` — ${res.error}` : ""}.`); continue; }
    reserved += 1;
    const c = copies.find((x) => x.id === r.copyId);
    if (c) c.reserved_line = r.line;
    if (r.mismatch) mismatched += 1;
    await logEvent(sb, user.id, r.listingId, r.mismatch ? "mismatch" : "reserved", {
      sku: r.sku, orderId: r.orderId, line: r.line, soldAt: r.soldAt
    });
  }
  for (const o of oversold) {
    notes.push(`Order ${o.orderId} has no copy left to take — eBay sold more than the lab holds.`);
    await logEvent(sb, user.id, o.listingId, "oversold", o);
  }

  // 2. Each listing moves on to its new head copy's scans.
  let moved = 0;
  const quantities = [];
  for (const l of live) {
    let available = null;
    let status = null;
    try {
      const q = await fetchItemQuantity(token, l.ebay_item_id);
      available = q.available;
      status = q.listingStatus;
    } catch (e) {
      notes.push(`${l.title}: couldn't read eBay's count (${e.message}).`);
    }
    const plan = planFor(l, copies, available);
    if (plan.quantityMismatch) quantities.push({ listingId: l.id, title: l.title, ...plan.quantityMismatch });
    if (status && status !== "Active") notes.push(`${l.title}: eBay says the listing is ${status}.`);
    for (const b of plan.blocked) notes.push(`${l.title}: ${b}.`);
    if (!plan.pictureUrls || (status && status !== "Active")) continue;

    if (!(await scanLoads(plan.pictureUrls[0]))) {
      notes.push(`${l.title}: ${plan.desired.head.sku}'s scan doesn't load from CardUploader — the listing stays on its current photo.`);
      await logEvent(sb, user.id, l.id, "error", { message: "next scan does not load", sku: plan.desired.head.sku });
      continue;
    }
    try {
      const r = await reviseFixedPriceListing(token, l.ebay_item_id, { imageUrls: plan.pictureUrls });
      await updateListing(sb, user.id, l.id, { pictured_copy_id: plan.headId });
      moved += 1;
      await logEvent(sb, user.id, l.id, "pictures", { showing: plan.desired.head.sku, pictures: plan.pictureUrls.length, warning: r.warning });
      if (r.warning) notes.push(`${l.title}: eBay accepted the photos with a warning — ${r.warning}`);
    } catch (e) {
      notes.push(`${l.title}: photo change failed — ${e.message}`);
      await logEvent(sb, user.id, l.id, "error", { message: e.message, sku: plan.desired.head.sku });
    }
  }
  const now = new Date().toISOString();
  for (const l of live) await updateListing(sb, user.id, l.id, { checked_at: now }).catch(() => {});
  return { ok: true, reserved, mismatched, oversold: oversold.length, moved, quantities, notes };
}

async function setQuantity(sb, user, lab, listingId) {
  const l = lab.listings.find((x) => x.id === listingId);
  if (!l?.ebay_item_id) return { ok: false, error: "No such lab listing." };
  const token = await tokenFor(user.id);
  if (!token) return { ok: false, error: "eBay account not connected." };
  const want = desiredFor(l, lab.copies).quantity;
  const before = await fetchItemQuantity(token, l.ebay_item_id);
  await reviseItemQuantity(token, l.ebay_item_id, want);
  await logEvent(sb, user.id, l.id, "quantity", { from: before.available, to: want });
  return { ok: true, from: before.available, to: want };
}

async function end(sb, user, lab, listingId) {
  const l = lab.listings.find((x) => x.id === listingId);
  if (!l) return { ok: false, error: "No such lab listing." };
  if (l.ebay_item_id) {
    const token = await tokenFor(user.id);
    if (!token) return { ok: false, error: "eBay account not connected." };
    try {
      await endListing(token, l.ebay_item_id);
    } catch (e) {
      // Already over (sold out, or ended in Seller Hub) is not a failure here.
      if (!/ended|completed|already/i.test(e.message)) throw e;
    }
  }
  await updateListing(sb, user.id, l.id, { ended_at: new Date().toISOString() });
  await logEvent(sb, user.id, l.id, "ended", { itemId: l.ebay_item_id });
  return { ok: true };
}
