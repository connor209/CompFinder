import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, fetchItemQuantity, reviseItemQuantity, reviseItemPrice, endListing } from "@/lib/ebay";
import { desiredFor, listingForGroup, nextCopySeqs, removeBlocker, queueOf, LISTABLE_CONDITIONS, MAX_SCANS } from "@/lib/lab-copies";
import {
  loadLab, loadListingSettings, saveListingSettings, logEvent, insertListing, insertCopies, undoCopies, moveLabCopies, updateListing, deleteListing, markPulled, releaseCopy, removeCopy
} from "@/lib/lab-store";
import { addLabListing, scanLoads, reviseLabText } from "@/lib/lab-ebay";
import { inventoryRows, templatePlan } from "@/lib/lab-inventory";
import { runCheck } from "@/lib/lab-run";
import { renderListing, settingsProblems, withDefaults } from "@/lib/listing-template";
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
 *   remove      { copyId }                       take one copy off its listing
 *   setPrices   { changes: [{ listingId, pence }] } bulk price, from the inventory view
 *   endMany     { listingIds }                   bulk end, from the inventory view
 *   applyTemplate { listingIds, title, description } re-write live listings from the saved templates
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
  // Not yet moved into the stacks, or 042 still to run: the page needs to say
  // so and offer the move, so these are answers, not server errors.
  if (!lab.ok) return json(lab, lab.missing || lab.needsMove || lab.foldPending ? 200 : 500);
  const ls = await loadListingSettings(sb, user.id);
  return json({ ...lab, listingSettings: withDefaults(ls.settings), listingSettingsSaved: Boolean(ls.settings), listingSettingsMissing: Boolean(ls.missing) });
}

export async function POST(request) {
  const { sb, user } = await session();
  if (!user) return json({ ok: false, error: "Not signed in." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }

  // The move runs BEFORE the lab can load: it is what makes it loadable.
  if (body.action === "moveToStacks") {
    try {
      const r = await moveLabCopies(sb, user.id);
      await logEvent(sb, user.id, null, "moved", { moved: r.moved, adopted: r.adopted, refused: r.refused });
      return json({ ok: true, ...r });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }
  const lab = await loadLab(sb, user.id);
  if (!lab.ok) return json(lab, lab.missing || lab.needsMove || lab.foldPending ? 409 : 500);

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
      case "remove": return json(await remove(sb, user, lab, body.copyId));
      case "setPrices": return json(await setPrices(sb, user, lab, body.changes));
      case "endMany": return json(await endMany(sb, user, lab, body.listingIds));
      case "applyTemplate": return json(await applyTemplate(sb, user, lab, body));
      case "saveSettings": {
        const next = withDefaults(body.settings);
        const problems = settingsProblems(next);
        if (problems.length) return json({ ok: false, error: problems.join(" ") });
        await saveListingSettings(sb, user.id, next);
        await logEvent(sb, user.id, null, "settings", { descriptions: next.descriptions.length, shopImages: next.shopImages.length, bestOffer: next.bestOffer.enabled });
        return json({ ok: true, settings: next });
      }
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

async function create(sb, user, lab, { group, pricePence, subtype = "", marketPence = null, settings = {} }) {
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

  // Written from the SAVED settings through the same renderListing() the
  // preview used. Older device-side settings (category, postcode…) fill in
  // anything an account that never saved settings is missing.
  const saved = await loadListingSettings(sb, user.id);
  const r = renderListing({ ...settings, ...(saved.settings || {}) }, group, { subtype, pricePence: price });
  if (r.bestOffer?.error) return { ok: false, error: `Best Offer: ${r.bestOffer.error}` };
  if (r.unknownPlaceholders.length) return { ok: false, error: `The description uses ${r.unknownPlaceholders.map((k) => `{${k}}`).join(", ")}, which isn't a placeholder — fix the template first.` };

  // Ours first, so a listing eBay accepted always has a row to belong to.
  const listing = await insertListing(sb, user.id, {
    title: r.title, condition: group.condition, price_pence: price, card_key: group.key || null,
    card: group.card || null, subtype: subtype || null, extra_images: r.extraImages,
    db_image_url: group.dbImage || null,
    market_pence: Number.isInteger(marketPence) ? marketPence : null, market_at: Number.isInteger(marketPence) ? new Date().toISOString() : null
  });
  let rows;
  try {
    rows = await insertCopies(sb, user.id, listing.id, copies, { title: r.title });
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
  // Undo the stack cards BEFORE the listing: the foreign key would otherwise
  // leave them on the stacks as ordinary cards with no listing.
  if (!token) { await undoCopies(sb, user.id, rows); await deleteListing(sb, user.id, listing.id); return { ok: false, error: "eBay account not connected." }; }

  let result;
  try {
    result = await addLabListing(token, {
      ...settings,
      categoryId: r.categoryId, postcode: r.postcode, shippingCost: r.shippingCost, dispatchDays: r.dispatchDays, returnsDays: r.returnsDays,
      title: r.title, descriptionHtml: r.descriptionHtml, bestOffer: r.bestOffer,
      pricePence: price, quantity: rows.length, condition: group.condition,
      cardName: group.cardName, cardNumber: group.cardNumber, set: group.set, language: group.language,
      // Read back off the stored row, so this is exactly the arrangement every
      // later photo rotation sends. Before 041 there's no column to keep them
      // in, so no shop images rather than shop images that vanish on rotation.
      pictureUrls: desiredFor({ ...listing, extra_images: listing.extra_images || [] }, rows).pictureUrls
    });
  } catch (e) {
    await undoCopies(sb, user.id, rows);
    await deleteListing(sb, user.id, listing.id);
    return { ok: false, error: e.message };
  }
  await updateListing(sb, user.id, listing.id, { ebay_item_id: result.itemId, pictured_copy_id: headRow.id });
  await logEvent(sb, user.id, listing.id, "listed", {
    itemId: result.itemId, quantity: rows.length, showing: headRow.sku, pricePence: price, title: r.title, titleCut: r.titleCut || undefined, warnings: result.warnings
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
  const rows = await insertCopies(sb, user.id, listing.id, copies, { title: listing.title });
  const to = (before.available ?? 0) + rows.length;
  try {
    await reviseItemQuantity(token, listing.ebay_item_id, to);
  } catch (e) {
    await undoCopies(sb, user.id, rows);
    return { ok: false, error: `eBay refused the new quantity for "${listing.title}": ${e.message}` };
  }
  await logEvent(sb, user.id, listing.id, "joined", { added: rows.map((r) => r.sku), from: before.available, to });
  return { ok: true, joined: true, itemId: listing.ebay_item_id, from: before.available, to, pricePence: listing.price_pence, warnings: [] };
}

/**
 * One copy off its listing: eBay's quantity down by one FIRST (nothing changes
 * if eBay refuses), then our row. If it was the copy on show, the listing
 * moves on to the next copy's photos in the same request. The card itself is
 * still in the pile — the screen says to take it out.
 */
async function remove(sb, user, lab, copyId) {
  const copy = lab.copies.find((c) => c.id === copyId);
  const listing = copy ? lab.listings.find((l) => l.id === copy.listing_id) : null;
  const why = removeBlocker(copy, listing, lab.copies);
  if (why) return { ok: false, error: why };
  const token = await tokenFor(user.id);
  if (!token) return { ok: false, error: "eBay account not connected." };

  const ours = queueOf(listing.id, lab.copies).length;
  const before = await fetchItemQuantity(token, listing.ebay_item_id);
  if (before.listingStatus && before.listingStatus !== "Active") return { ok: false, error: `eBay says the listing is ${before.listingStatus}.` };
  // A sale eBay has counted but we haven't reserved yet would make the
  // numbers disagree; removing on top of that could take the count below the
  // copies buyers have paid for. Check first, then remove.
  if (before.available != null && before.available !== ours) {
    return { ok: false, error: `eBay has ${before.available} for sale and the queue has ${ours} — press Check for sales first, then remove.` };
  }
  await reviseItemQuantity(token, listing.ebay_item_id, ours - 1);
  const gone = await removeCopy(sb, user.id, copy.id);
  if (!gone) {
    await logEvent(sb, user.id, listing.id, "error", { action: "remove", sku: copy.sku, message: "eBay quantity lowered but the copy changed meanwhile" });
    return { ok: false, error: `${copy.sku} changed while it was being removed — press Check for sales, which will show any quantity difference.` };
  }
  await logEvent(sb, user.id, listing.id, "removed", { sku: copy.sku, from: ours, to: ours - 1 });
  let moved = 0;
  if (String(listing.pictured_copy_id || "") === String(copy.id)) {
    const r = await runCheck(sb, user.id, token, { source: "button", itemId: listing.ebay_item_id });
    moved = r.moved || 0;
  }
  return { ok: true, sku: copy.sku, from: ours, to: ours - 1, moved };
}

/** The most a bulk action takes in one request — a screen's worth, never the whole stock. */
const BULK_MAX = 50;

/**
 * Bulk price. Each change is checked again here (a live lab listing of this
 * account, at least £0.99), sent to eBay, then recorded; one failure is
 * reported and the rest carry on. Never more than a page at a time.
 */
async function setPrices(sb, user, lab, changes) {
  const list = Array.isArray(changes) ? changes.slice(0, BULK_MAX + 1) : [];
  if (!list.length) return { ok: false, error: "Nothing to change." };
  if (list.length > BULK_MAX) return { ok: false, error: `At most ${BULK_MAX} listings at once.` };
  const token = await tokenFor(user.id);
  if (!token) return { ok: false, error: "eBay account not connected." };
  const results = [];
  for (const ch of list) {
    const l = lab.listings.find((x) => x.id === ch?.listingId);
    const pence = Number(ch?.pence);
    if (!l?.ebay_item_id || l.ended_at) { results.push({ listingId: ch?.listingId, ok: false, error: "Not a live lab listing." }); continue; }
    if (!Number.isInteger(pence) || pence < 99) { results.push({ listingId: l.id, ok: false, error: "Price under £0.99." }); continue; }
    try {
      await reviseItemPrice(token, l.ebay_item_id, pence / 100);
      await updateListing(sb, user.id, l.id, { price_pence: pence });
      await logEvent(sb, user.id, l.id, "price", { from: l.price_pence, to: pence });
      results.push({ listingId: l.id, ok: true, from: l.price_pence, to: pence });
    } catch (e) {
      await logEvent(sb, user.id, l.id, "error", { action: "price", message: e.message });
      results.push({ listingId: l.id, ok: false, error: e.message });
    }
  }
  return { ok: true, results, changed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

/**
 * Re-write live listings from the SAVED templates. Planned here with the same
 * templatePlan() the screen previewed, on this request's own read of the
 * rows, so a settings change in another tab since the preview is what goes
 * out — and the screen's figures are never trusted. One failure (eBay
 * refusing a title change on a listing with sales, say) is reported and the
 * rest carry on.
 */
async function applyTemplate(sb, user, lab, { listingIds, title = true, description = true }) {
  const ids = Array.isArray(listingIds) ? listingIds.slice(0, BULK_MAX + 1) : [];
  if (!ids.length) return { ok: false, error: "Nothing ticked." };
  if (ids.length > BULK_MAX) return { ok: false, error: `At most ${BULK_MAX} listings at once.` };
  const saved = await loadListingSettings(sb, user.id);
  if (!saved.settings) return { ok: false, error: "No listing settings saved yet — save them under Listing settings first." };
  const want = new Set(ids.map(String));
  const rows = inventoryRows(lab.listings, lab.copies).filter((r) => want.has(String(r.id)));
  const plan = templatePlan(rows, saved.settings, { title: Boolean(title), description: Boolean(description) });
  const token = await tokenFor(user.id);
  if (!token) return { ok: false, error: "eBay account not connected." };
  const results = [];
  for (const p of plan) {
    if (p.skip) { results.push({ listingId: p.row.id, ok: false, skipped: true, error: p.skip }); continue; }
    try {
      const r = await reviseLabText(token, p.row.itemId, {
        title: p.titleChanges ? p.toTitle : null,
        descriptionHtml: p.descriptionHtml
      });
      if (p.titleChanges) await updateListing(sb, user.id, p.row.id, { title: p.toTitle });
      await logEvent(sb, user.id, p.row.id, "template", { fromTitle: p.titleChanges ? p.fromTitle : undefined, toTitle: p.titleChanges ? p.toTitle : undefined, description: Boolean(p.descriptionHtml), warnings: r.warnings });
      results.push({ listingId: p.row.id, ok: true });
    } catch (e) {
      await logEvent(sb, user.id, p.row.id, "error", { action: "template", message: e.message });
      results.push({ listingId: p.row.id, ok: false, error: e.message });
    }
  }
  return {
    ok: true, results,
    changed: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length
  };
}

async function endMany(sb, user, lab, ids) {
  const list = Array.isArray(ids) ? ids.slice(0, BULK_MAX + 1) : [];
  if (!list.length) return { ok: false, error: "Nothing ticked." };
  if (list.length > BULK_MAX) return { ok: false, error: `At most ${BULK_MAX} listings at once.` };
  const results = [];
  for (const id of list) {
    try {
      const r = await end(sb, user, lab, id);
      results.push({ listingId: id, ok: r.ok, error: r.error });
    } catch (e) {
      results.push({ listingId: id, ok: false, error: e.message });
    }
  }
  return { ok: true, results, changed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
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
