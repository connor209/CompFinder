/**
 * Comp Finder — keep multi-copy listings in step with the box, unattended.
 *
 * copyqueue.js says what a listing SHOULD show. This is what runs it, from
 * four places, all through `runCopySync()` so they cannot disagree:
 *
 *   | trigger   | from                                  | changes            |
 *   |-----------|---------------------------------------|--------------------|
 *   | "sale"    | eBay's sale notification (/api/ebay/  | picture only       |
 *   |           | notify) and the 15-minute sweep       |                    |
 *   |           | (/api/cron/copies)                    |                    |
 *   | "box"     | the pull sheet's Commit               | picture + quantity |
 *   |           | (/api/ebay/copies)                    | (live eBay read)   |
 *   | "nightly" | /api/cron/sync, after the listings    | picture + quantity |
 *   |           | refresh                               | (fresh mirror)     |
 *
 * **A sale changes the picture and nothing else.** eBay takes the quantity
 * down itself when a copy sells, so the only thing out of date is the
 * photograph — and deciding that needs no eBay read at all, only the
 * unshipped orders and which copy `listing_copy_state` says is pictured. That
 * is what makes a sweep every fifteen minutes affordable: it costs one orders
 * read per account and a revision only where a picture is wrong.
 *
 * **A quantity is only set off a number read the same minute** — eBay's live
 * one ("box") or the mirror the nightly sync has just refreshed. The mirror at
 * any other time is up to a day old, and a copy that sold since would be put
 * back on sale.
 *
 * **Never blind.** If the unshipped orders cannot be read, nothing is changed:
 * without them a sold, unpulled copy is indistinguishable from a spare one,
 * and the picture could be a card that already belongs to someone.
 *
 * **Only pooled listings are touched** — an item id with two or more stack
 * rows ever filed against it, pulled ones included, so a pool keeps being
 * looked after down to its last copy. The ~11,000 single listings have one row
 * each and are never in the target set, whatever any caller asks for.
 *
 * **Off unless switched on.** `COPY_SYNC` on the comp-finder project: unset or
 * "off" does nothing, "dry" works everything out and logs it without calling
 * eBay, "on" sends the revisions. The same posture as Turnstile and EPN —
 * inert until configured — because this is the first thing in the app that
 * edits listings with nobody watching.
 */
import { desiredStateFor, reconcile, loadCopyState, recordPictured } from "./copyqueue.js";
import {
  getValidUserAccessToken, fetchPendingOrders, fetchItemQuantity, revisePooledListing
} from "./ebay.js";

/** The env var that switches this on. Named once. */
export const COPY_SYNC_VAR = "COPY_SYNC";

/**
 * A ceiling on revisions in one run. One sale is one revision; this is only
 * ever reached by something going wrong — a bad migration, a stack import
 * filing copies against the wrong listing — and then the damage stops here.
 */
export const MAX_REVISIONS_PER_RUN = 40;

/** How many live quantity reads a "box" run may make. */
export const MAX_LIVE_READS = 25;

/** "off" | "dry" | "on". Anything unrecognised is off. */
export function copySyncMode(env = process.env) {
  const v = String(env?.[COPY_SYNC_VAR] ?? "").trim().toLowerCase();
  if (v === "on" || v === "1" || v === "true") return "on";
  if (v === "dry") return "dry";
  return "off";
}

/**
 * The listings this is allowed to touch: item ids with two or more stack rows
 * filed against them, in any state. A single listing is one row and is never
 * here, so no caller — a forged notification, a typo in an id list — can turn
 * this loose on the ordinary inventory.
 */
export function pooledItemIds(cards) {
  const n = new Map();
  for (const c of cards || []) {
    const id = c?.ebay_item_id == null ? "" : String(c.ebay_item_id).trim();
    if (id) n.set(id, (n.get(id) || 0) + 1);
  }
  return new Set([...n].filter(([, k]) => k >= 2).map(([id]) => id));
}

/**
 * What to do, per listing. Pure: everything it needs is handed in.
 *
 *   cards       stack_cards rows
 *   lines       unshipped order lines — REQUIRED; null means "not read" and
 *               the plan is empty, never a guess
 *   listings    Map<itemId, ebay_listings row>
 *   state       Map<itemId, listing_copy_state row>
 *   itemIds     narrow to these (still only pooled ones); null = every pool
 *   trigger     "sale" strips quantity changes; "box"/"nightly" keep them
 *   liveQuantity Map<itemId, number> — for "box", what eBay said just now.
 *               An item with no live read gets no quantity change.
 */
export function planCopySync({ cards, lines, listings, state, itemIds = null, trigger = "sale", liveQuantity = null }) {
  if (!Array.isArray(lines)) return { blind: true, items: [] };
  const pooled = pooledItemIds(cards);
  const wanted = itemIds ? [...new Set(itemIds.map((x) => String(x).trim()).filter(Boolean))] : [...pooled];
  const items = [];
  for (const itemId of wanted) {
    if (!pooled.has(itemId)) continue;
    const mirror = listings?.get(itemId) || null;
    if (!mirror) {
      // Not in the synced listings: ended, or never synced. Revising an ended
      // listing fails, and one we have never seen is not one to edit.
      items.push({ itemId, skipped: "not in your synced listings", plan: null });
      continue;
    }
    const desired = desiredStateFor(itemId, cards, { lines });
    const listing = { ...mirror };
    const quantityTrusted = trigger === "nightly" || (trigger === "box" && liveQuantity?.has(itemId));
    if (trigger === "box" && liveQuantity?.has(itemId)) listing.quantity = liveQuantity.get(itemId);
    const plan = reconcile(desired, listing, state?.get(itemId) || null);
    if (!quantityTrusted && "quantity" in plan.changes) {
      delete plan.changes.quantity;
      plan.reasons = plan.reasons.filter((r) => !r.startsWith("quantity"));
      plan.empty = Object.keys(plan.changes).length === 0;
    }
    items.push({ itemId, title: mirror.title || null, desired, plan });
  }
  return { blind: false, items };
}

/** Read every row a query returns, in a total order, or throw. */
async function readAll(makeQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || "Read failed.");
    out.push(...(data || []));
    if (!data || data.length < pageSize) return out;
  }
}

/**
 * Run it for one account. `sb` is the service-role client (every read names
 * `user_id` by hand — the cron and the notification have no RLS behind them).
 *
 * Returns a summary that is safe to log and to return from a route: item ids,
 * reasons and counts, never a token.
 */
export async function runCopySync(sb, userId, { itemIds = null, trigger = "sale", env = process.env } = {}) {
  const mode = copySyncMode(env);
  const out = { mode, trigger, considered: 0, changed: [], skipped: [], blocked: [], errors: [] };
  if (mode === "off") return { ...out, off: true };
  if (!userId) return { ...out, errors: ["no account"] };

  const token = await getValidUserAccessToken(sb, userId);
  if (!token) return { ...out, errors: ["eBay account not connected"] };

  let cards;
  try {
    cards = await readAll(() => sb.from("stack_cards").select("*").eq("user_id", userId));
  } catch (err) {
    return { ...out, errors: [`stack cards: ${err.message}`] };
  }
  const pooled = pooledItemIds(cards);
  const targets = itemIds ? [...new Set(itemIds.map(String))].filter((id) => pooled.has(id)) : [...pooled];
  if (!targets.length) return out;

  // The orders first, and the whole run stops without them.
  let lines;
  try {
    lines = (await fetchPendingOrders(token, { labelledWithinDays: 7 })).lines;
  } catch (err) {
    return { ...out, errors: [`unshipped orders not read, nothing changed: ${err?.message || err}`] };
  }

  const listings = new Map();
  for (let i = 0; i < targets.length; i += 200) {
    const { data, error } = await sb.from("ebay_listings")
      .select("ebay_item_id,title,quantity")
      .eq("user_id", userId)
      .in("ebay_item_id", targets.slice(i, i + 200));
    if (error) return { ...out, errors: [`listings: ${error.message}`] };
    for (const l of data || []) listings.set(String(l.ebay_item_id), l);
  }
  const st = await loadCopyState(sb, targets);
  if (!st.ok && !st.missing) return { ...out, errors: [`copy state: ${st.error}`] };

  let liveQuantity = null;
  if (trigger === "box") {
    liveQuantity = new Map();
    for (const id of targets.slice(0, MAX_LIVE_READS)) {
      try {
        const q = await fetchItemQuantity(token, id);
        if (q.listingStatus && q.listingStatus !== "Active") { listings.delete(id); continue; }
        if (q.available != null) liveQuantity.set(id, q.available);
      } catch {
        /* no live number: that item gets no quantity change, see planCopySync */
      }
    }
  }

  const { items } = planCopySync({ cards, lines, listings, state: st.state, itemIds: targets, trigger, liveQuantity });
  out.considered = items.length;
  let revisions = 0;
  for (const it of items) {
    if (it.skipped) { out.skipped.push({ itemId: it.itemId, why: it.skipped }); continue; }
    for (const b of it.plan.blocked) out.blocked.push({ itemId: it.itemId, why: b });
    if (it.plan.empty) continue;
    if (revisions >= MAX_REVISIONS_PER_RUN) {
      out.errors.push(`stopped at ${MAX_REVISIONS_PER_RUN} revisions — more than one run should ever need; check what changed`);
      break;
    }
    revisions += 1;
    const entry = { itemId: it.itemId, title: it.title, reasons: it.plan.reasons, sent: false };
    if (mode === "dry") { out.changed.push(entry); continue; }
    try {
      const res = await revisePooledListing(token, it.itemId, {
        imageUrls: it.plan.changes.pictureUrls || null,
        quantity: it.plan.changes.quantity ?? null
      });
      entry.sent = true;
      if (res.warning) entry.warning = res.warning;
      // Recorded AFTER eBay accepts — a state row claiming a picture that was
      // never set stops the next run proposing the one change still needed.
      if (it.plan.changes.pictureUrls && it.desired.head) {
        const rec = await recordPictured(sb, {
          itemId: it.itemId, copyId: it.desired.head.id, pictureUrl: it.plan.changes.pictureUrls[0], userId
        });
        if (!rec.ok) entry.warning = rec.missing ? "migration 027 not applied — picture not recorded" : rec.error;
      }
      // eBay has just answered, so the mirror says so rather than waiting a
      // day to be told — the same courtesy /api/ebay/unhide pays.
      if (it.plan.changes.quantity != null) {
        await sb.from("ebay_listings").update({ quantity: it.plan.changes.quantity })
          .eq("user_id", userId).eq("ebay_item_id", it.itemId).then(() => {}, () => {});
      }
    } catch (err) {
      entry.error = err?.message || String(err);
    }
    out.changed.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// eBay's sale notification
// ---------------------------------------------------------------------------

/** How old a notification may be and still be acted on. */
export const NOTIFICATION_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Is this notification from eBay?
 *
 * eBay signs a Platform Notification with
 * `Base64(MD5(Timestamp + DevID + AppID + CertID))`, the Timestamp being the
 * one in the message body. Only eBay and we hold the CertID (our client
 * secret), so a match is eBay. The timestamp must also be recent, or a
 * captured notification could be replayed at will.
 *
 * `md5base64` is handed in so this stays pure and runs under bare node.
 */
export function verifyNotification({ timestamp, signature, devId, appId, certId, now = Date.now(), md5base64 }) {
  if (!timestamp || !signature || !devId || !appId || !certId || typeof md5base64 !== "function") return { ok: false, why: "missing" };
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return { ok: false, why: "bad timestamp" };
  if (Math.abs(now - t) > NOTIFICATION_MAX_AGE_MS) return { ok: false, why: "stale" };
  const want = md5base64(`${timestamp}${devId}${appId}${certId}`);
  return want === String(signature).trim() ? { ok: true } : { ok: false, why: "signature" };
}

/** The four facts a sale notification carries that this needs. Regex, not a SOAP stack. */
export function readNotification(xml) {
  const s = String(xml || "");
  const tag = (name) => {
    const m = s.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]*)</(?:\\w+:)?${name}>`));
    return m ? m[1].trim() : null;
  };
  return {
    signature: tag("NotificationSignature"),
    timestamp: tag("Timestamp"),
    event: tag("NotificationEventName"),
    itemId: (tag("ItemID") || "").replace(/[^0-9]/g, "") || null
  };
}

/** The events that mean "a copy of a fixed-price listing just sold". */
export const SALE_EVENTS = ["FixedPriceTransaction", "AuctionCheckoutComplete", "ItemSold"];
