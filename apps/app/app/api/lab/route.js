import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, fetchItemQuantity, reviseItemQuantity, endListing } from "@/lib/ebay";
import { desiredFor, listingForGroup, nextCopySeqs, LISTABLE_CONDITIONS, MAX_SCANS } from "@/lib/lab-copies";
import {
  loadLab, logEvent, insertListing, insertCopies, deleteCopies, updateListing, deleteListing, markPulled, releaseCopy
} from "@/lib/lab-store";
import { addLabListing, scanLoads } from "@/lib/lab-ebay";
import { runCheck } from "@/lib/lab-run";
import { getNotificationState, enableSaleNotifications, disableSaleNotifications } from "@/lib/lab-notify";

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
      case "check": return json(await check(sb, user));
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
      case "notifyState":
      case "notifyOn":
      case "notifyOff": {
        const token = await tokenFor(user.id);
        if (!token) return json({ ok: false, error: "eBay account not connected." });
        if (body.action === "notifyState") return json({ ok: true, state: await getNotificationState(token) });
        if (body.action === "notifyOff") {
          const state = await disableSaleNotifications(token);
          await logEvent(sb, user.id, null, "notifications", { saleEnabled: false });
          return json({ ok: true, state });
        }
        const url = String(body.url || "");
        if (!/^https:\/\/[^/]+\/api\/lab\/ebay-notify$/.test(url)) return json({ ok: false, error: "That isn't this app's notification address." });
        // The delivery URL is app-wide. Never replace a different one silently.
        const before = await getNotificationState(token);
        if (before.url && before.url !== url && !body.replace) {
          return json({ ok: false, needsReplace: true, current: before.url, error: `eBay already sends this app's notifications to ${before.url}.` });
        }
        const state = await enableSaleNotifications(token, url);
        await logEvent(sb, user.id, null, "notifications", { saleEnabled: state.saleEnabled, url, replaced: before.url && before.url !== url ? before.url : undefined });
        return json({ ok: true, state });
      }
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
  if (!LISTABLE_CONDITIONS.includes(group.condition)) return { ok: false, error: `Condition ${group.condition} can't be listed.` };

  const have = new Set(lab.copies.map((c) => String(c.sku).toLowerCase()));
  const dup = group.copies.find((c) => have.has(String(c.sku).toLowerCase()));
  if (dup) return { ok: false, error: `${dup.sku} is already in the lab.` };

  // A card + condition already live: the new copies join the back of its
  // queue and its quantity goes up. No second listing for the same card.
  const existing = listingForGroup(lab.listings, group);
  if (existing) return join(sb, user, lab, existing, group);
  if (!Number.isInteger(price) || price < 99) return { ok: false, error: "Type a price of at least £0.99." };

  // copy_seq = pile order, so the queue sells them front to back. Left null,
  // every copy would tie on added_at (one insert) and fall to a random id.
  const copies = group.copies.map((c) => ({ sku: c.sku, pile_seq: c.seq, copy_seq: c.seq, scans: (c.scans || []).slice(0, MAX_SCANS) }));
  const head = copies.slice().sort((a, b) => a.pile_seq - b.pile_seq)[0];
  if (!(await scanLoads(head.scans[0]))) {
    return { ok: false, error: `${head.sku}'s first scan doesn't load from CardUploader — nothing was listed.` };
  }

  // Ours first, so a listing eBay accepted always has a row to belong to.
  const listing = await insertListing(sb, user.id, { title: group.title, condition: group.condition, price_pence: price, card_key: group.key || null });
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

async function check(sb, user) {
  const token = await tokenFor(user.id);
  if (!token) return { ok: false, error: "eBay account not connected." };
  return runCheck(sb, user.id, token, { source: "button" });
}

/**
 * New copies onto the back of a live listing. The listing keeps its price:
 * changing what a live listing asks is its own decision, not a side effect of
 * shelving more copies. Ours first, then eBay's count; if eBay refuses, the
 * copies are taken back out so the lab never holds copies eBay isn't selling.
 */
async function join(sb, user, lab, listing, group) {
  const seqs = nextCopySeqs(lab.copies, listing.id, group.copies.length);
  const copies = group.copies.map((c, i) => ({ sku: c.sku, pile_seq: c.seq, copy_seq: seqs[i], scans: (c.scans || []).slice(0, MAX_SCANS) }));
  const token = await tokenFor(user.id);
  if (!token) return { ok: false, error: "eBay account not connected." };
  const before = await fetchItemQuantity(token, listing.ebay_item_id);
  if (before.listingStatus && before.listingStatus !== "Active") {
    return { ok: false, error: `"${listing.title}" is ${before.listingStatus} on eBay — end it in the lab, then list these as a new listing.` };
  }
  const rows = await insertCopies(sb, user.id, listing.id, copies);
  const to = (before.available ?? 0) + rows.length;
  try {
    await reviseItemQuantity(token, listing.ebay_item_id, to);
  } catch (e) {
    await deleteCopies(sb, user.id, rows.map((r) => r.id));
    return { ok: false, error: `eBay refused the new quantity for "${listing.title}": ${e.message}` };
  }
  await logEvent(sb, user.id, listing.id, "joined", { added: rows.map((r) => r.sku), from: before.available, to });
  return { ok: true, joined: true, itemId: listing.ebay_item_id, from: before.available, to, pricePence: listing.price_pence, warnings: [] };
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
