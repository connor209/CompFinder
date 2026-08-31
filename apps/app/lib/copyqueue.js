/**
 * Comp Finder — one listing, several copies.
 *
 * A multi-quantity listing is one eBay item id backed by several physical
 * cards. Each copy is its own `stack_cards` row with its own SKU, its own
 * position and — the point of the exercise — its own scan. The copy at the
 * head of the queue is the one in the listing's photo and the one to pull
 * next; when it goes, the next copy's scan takes its place.
 *
 * **eBay reports the LISTING's SKU on a sale, never the copy's.** A sale says
 * "this item id sold two" and carries nothing that distinguishes copy 1 from
 * copy 2. So the ordering is ours, and this file is where it is defined once.
 *
 * ## This is a RECONCILIATION, not a ledger
 *
 * The first design here consumed sale line items against the queue and kept an
 * event log so a replayed sync couldn't double-consume. Reading PullSheet.js
 * killed that: the pull sheet ALREADY matches unshipped orders to stack cards,
 * you tick what you picked, and Commit marks them pulled. The card leaving the
 * stack is the consumption, it is already recorded, and it is recorded by the
 * person holding the card.
 *
 * So nothing here consumes anything. The desired state of a listing is a pure
 * function of which copies are still in the box:
 *
 *     quantity   = how many copies are sellable right now
 *     picture    = the head copy's scan
 *
 * Compare that with what eBay currently shows, revise the difference. Running
 * it twice does nothing the second time, a missed run costs nothing but
 * staleness, and there is no log to fall out of step with reality. An event
 * ledger would have been a second opinion about stock, and the disagreement
 * would have been silent.
 *
 * ## Why a state row is still needed
 *
 * One thing genuinely cannot be derived: whether the listing already shows the
 * head copy's scan. eBay REHOSTS uploaded pictures, so what comes back on the
 * listing is `i.ebayimg.com/…`, never the storage URL we sent. There is no
 * comparison to make. `listing_copy_state` records which copy the listing was
 * last revised to show, and that is all it records.
 *
 * ## Degrading before migration 027
 *
 * Migrations here are applied by hand and the code ships first. Without 027
 * there is no `copy_seq` and no `scan_url`: the queue still orders itself (by
 * `added_at`, then id — the order the cards were scanned in, which is the
 * right default anyway) and `desiredStateFor` returns `pictureUrls: null`,
 * meaning "propose no picture change". Quantity reconciliation still works.
 * Nothing throws.
 *
 * Framework-free apart from the Supabase client the store functions are
 * handed, so scripts/check-copyqueue.mjs can load it under bare node.
 */
import { liveRanks, stackDepths, positionLabel } from "./stackpos.js";

/**
 * `listing_copy_state` (migration 027) is named in THIS FILE ONLY — the rule
 * batch-store.js and wants-store.js follow. A second file naming it is a
 * second place to update, and Postgres rejects a whole statement that names a
 * missing column, so the failure lands on a screen rather than in a log.
 */
export const COPY_STATE_TABLE = "listing_copy_state";

/**
 * How many pictures a revision may send. eBay allows 24; the listing carries
 * the head copy's scan plus whatever shared shots the listing uses (a back, a
 * condition guide), and a dozen is far past what any card needs. The cap
 * exists so a bad `extras` list can't build a request eBay rejects wholesale.
 */
export const MAX_PICTURES = 12;

/** Lowercased SKU, or null. The key every SKU-shaped lookup here uses. */
const skuKey = (v) => (v ? String(v).toLowerCase() : null);

/**
 * The order copies of one card are sold in.
 *
 * `copy_seq` first, so the order can be set by hand — you scanned three copies
 * and the sharpest one goes last, or a customer complaint means a copy jumps
 * the queue. Then `added_at`, which is the order they were scanned, and which
 * is what every copy has before anyone thinks about it. Then the row id, so
 * two rows that agree on everything still come back in the same order on every
 * render: without a stable last key the head of the queue could change between
 * two reads of the same data, and the head is the card in the photograph.
 */
function copyOrder(a, b) {
  const sa = Number.isFinite(Number(a?.copy_seq)) ? Number(a.copy_seq) : Infinity;
  const sb = Number.isFinite(Number(b?.copy_seq)) ? Number(b.copy_seq) : Infinity;
  if (sa !== sb) return sa - sb;
  const ta = String(a?.added_at || "");
  const tb = String(b?.added_at || "");
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a?.id).localeCompare(String(b?.id));
}

/**
 * Is this copy one we could put in an envelope today?
 *
 * Pulled is gone. **Checked out is also not sellable** — the card is in a box
 * at a show, and a listing that stays at quantity 3 while one of the three is
 * on a table two hundred miles away sells a card twice. The show desk already
 * treats away as away; this is the same rule pointed at eBay.
 */
export function isSellableCopy(c) {
  return Boolean(c) && !c.pulled_at && !c.checked_out_at;
}

/** The sellable copies of one listing, in the order they will be sold. */
export function queueFor(itemId, cards) {
  const id = itemId == null ? "" : String(itemId);
  if (!id) return [];
  return (cards || [])
    .filter((c) => isSellableCopy(c) && String(c.ebay_item_id || "") === id)
    .sort(copyOrder);
}

/** Every listing's queue at once. Map<itemId, copy[]>. */
export function queuesByListing(cards) {
  const out = new Map();
  for (const c of cards || []) {
    if (!isSellableCopy(c)) continue;
    const id = String(c.ebay_item_id || "");
    if (!id) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(c);
  }
  for (const list of out.values()) list.sort(copyOrder);
  return out;
}

/**
 * The same queues keyed by lowercased SKU — what the pull sheet holds, since
 * an eBay order line carries a SKU and no item id.
 *
 * A QUEUE rather than the first row that happened to come back. PullSheet used
 * to keep `unpulledBySku` as first-wins over an unordered `select *`, which
 * works for one copy per SKU and picks an arbitrary one of three. Arbitrary is
 * the thing this file exists to remove: the copy that goes must be the copy in
 * the photograph.
 */
export function queuesBySku(cards) {
  const out = new Map();
  for (const c of cards || []) {
    if (!isSellableCopy(c)) continue;
    const k = skuKey(c.sku);
    if (!k) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(c);
  }
  for (const list of out.values()) list.sort(copyOrder);
  return out;
}

/**
 * The pictures a listing should carry: the head copy's scan, then any shared
 * shots the listing uses.
 *
 * **One copy's scan, never several.** Showing three scans on a quantity-3
 * listing tells a buyer three cards exist and nothing about which one they get
 * — which is worse than a single stock photo, because it looks like it is
 * telling them something. One scan, rotated, means the picture is always of
 * the card that would actually be sent.
 *
 * Returns null when the head has no scan, which means "propose no picture
 * change": before migration 027 that is every copy, and a listing keeps
 * whatever photo it was created with.
 */
export function pictureUrlsFor(head, extras = []) {
  const first = head?.scan_url ? String(head.scan_url).trim() : "";
  if (!first) return null;
  const out = [];
  for (const u of [first, ...(extras || [])]) {
    const s = u == null ? "" : String(u).trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_PICTURES) break;
  }
  return out;
}

/**
 * What one listing SHOULD look like, given the cards still in the box.
 *
 * Pure, and derived entirely from present state — that is what makes running
 * it twice a no-op and a missed run merely stale.
 */
export function desiredStateFor(itemId, cards, { extras = [] } = {}) {
  const queue = queueFor(itemId, cards);
  const head = queue[0] || null;
  return {
    itemId: String(itemId || ""),
    queue,
    head,
    quantity: queue.length,
    pictureUrls: pictureUrlsFor(head, extras)
  };
}

/**
 * What to change on eBay, if anything.
 *
 * `listing` is an `ebay_listings` row; `state` is the `listing_copy_state` row
 * (or null, meaning we have never revised this listing's picture).
 *
 * Returns `{ changes, reasons, blocked }`. `changes` is empty when the listing
 * already says what it should — the ordinary case, and the reason this is safe
 * to run on a schedule.
 */
export function reconcile(desired, listing, state = null) {
  const changes = {};
  const reasons = [];
  const blocked = [];

  // --- quantity -------------------------------------------------------------
  // A missing quantity is SILENCE, not a zero — the same rule isListingAvailable
  // holds, and for the same reason: reading an absent field as zero would have
  // us revise a listing on the strength of something eBay never sent. We still
  // propose the number, because the revision is absolute rather than a delta,
  // but the report says we could not see what it was.
  const qNow = listing?.quantity;
  const qKnown = qNow != null && qNow !== "" && Number.isFinite(Number(qNow));
  const qNowNum = qKnown ? Number(qNow) : null;
  if (!qKnown) {
    changes.quantity = desired.quantity;
    reasons.push(`quantity → ${desired.quantity} (eBay sent no quantity, so we cannot tell what it is now)`);
  } else if (qNowNum !== desired.quantity) {
    changes.quantity = desired.quantity;
    reasons.push(`quantity ${qNowNum} → ${desired.quantity} (${desired.quantity} ${desired.quantity === 1 ? "copy" : "copies"} still in the box)`);
  }

  // --- picture --------------------------------------------------------------
  // eBay rehosts what we upload, so the listing's own image URL can never be
  // compared with a storage URL. `state.pictured_copy_id` is the only record of
  // which copy the listing is showing.
  if (desired.pictureUrls) {
    const showing = state?.pictured_copy_id ? String(state.pictured_copy_id) : null;
    const wanted = desired.head ? String(desired.head.id) : null;
    if (wanted && showing !== wanted) {
      changes.pictureUrls = desired.pictureUrls;
      reasons.push(showing
        ? `picture → copy ${desired.head.sku || wanted} (was showing ${showing})`
        : `picture → copy ${desired.head.sku || wanted} (never set)`);
    }
  } else if (desired.head) {
    blocked.push(`copy ${desired.head.sku || desired.head.id} has no scan_url — picture left alone`);
  }

  // --- the queue has run out ------------------------------------------------
  // Quantity 0 hides the listing while keeping the item id, which is what
  // reviseItemQuantity documents and what the out-of-stock control is for.
  // There is no picture to rotate to, and proposing one would be proposing to
  // remove every picture from the listing.
  if (desired.quantity === 0) {
    delete changes.pictureUrls;
    reasons.push("no copies left — quantity 0 hides the listing, pictures untouched");
  }

  return { changes, reasons, blocked, empty: Object.keys(changes).length === 0 };
}

/**
 * Which physical copy answers each unit of each order line.
 *
 * **A line item carries a quantity, and one line item at quantity 2 is two
 * cards to pull.** `fetchPendingOrders` has always returned that number and
 * the pull sheet has always ignored it, which was invisible while every
 * listing was a single card and is a card short the first time one isn't.
 *
 * `lines` are pending order lines ({ lineItemId, sku, title, quantity }).
 * Returns one entry per UNIT, in queue order, each with the copy it maps to —
 * or `copy: null` with a reason when there is nothing to map it to.
 */
export function pullPlanFor(cards, lines, stackNames = new Map()) {
  const queues = queuesBySku(cards);
  const taken = new Map(); // sku -> how many units of that queue are spoken for

  // Where each COPY is, not where its SKU is. `locationsBySku` keeps one label
  // per SKU — right everywhere else, because a SKU has always named one card —
  // and here it would send you to the same card twice for a quantity-2 order.
  // The rule itself is still stackpos.js's: a live rank among the cards
  // actually present, with pulled and away copies closed up behind them.
  const ranks = liveRanks(cards);
  const depths = stackDepths(cards);
  const names = stackNames instanceof Map ? stackNames : new Map(Object.entries(stackNames || {}));
  const whereIs = (c) => {
    const rank = ranks.get(c?.id);
    return rank == null ? null : positionLabel(names.get(c.stack_id), rank, depths.get(c.stack_id));
  };

  // Away and already-pulled copies answer a different question — "we own one,
  // it just isn't here" — and the pull sheet already distinguishes those, so
  // they are reported rather than silently missing.
  const awaySkus = new Set();
  const pulledSkus = new Set();
  for (const c of cards || []) {
    const k = skuKey(c?.sku);
    if (!k) continue;
    if (c.checked_out_at && !c.pulled_at) awaySkus.add(k);
    if (c.pulled_at) pulledSkus.add(k);
  }

  const units = [];
  for (const l of lines || []) {
    const k = skuKey(l?.sku);
    const qty = Math.max(1, Number(l?.quantity) || 1);
    for (let n = 0; n < qty; n++) {
      const seen = taken.get(k) || 0;
      const queue = k ? queues.get(k) || [] : [];
      const copy = queue[seen] || null;
      if (copy) taken.set(k, seen + 1);
      units.push({
        // Unique per UNIT: two units of one line item are two rows, two ticks
        // and two cards, and a shared key would collapse them back into one.
        key: `${l?.lineItemId || "?"}#${n + 1}`,
        lineItemId: l?.lineItemId || null,
        orderId: l?.orderId || null,
        unit: n + 1,
        ofUnits: qty,
        sku: l?.sku || null,
        title: l?.title || "",
        buyer: l?.buyer || null,
        copy,
        stackId: copy?.stack_id || null,
        where: copy ? whereIs(copy) : null,
        reason: copy ? null
          : !k ? "no SKU on the order line"
          : awaySkus.has(k) ? "checked out to a show"
          : pulledSkus.has(k) ? "already pulled"
          : "no copy left in the stack"
      });
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// Store — the only place `listing_copy_state` is read or written.
// ---------------------------------------------------------------------------

/**
 * Does this error mean migration 027 hasn't been run?
 *
 * Postgres says `relation "public.listing_copy_state" does not exist` for the
 * table and names the column for `copy_seq`/`scan_url`; PostgREST says its
 * schema cache doesn't know them. Either way it is a pending migration, and
 * every caller degrades to today's behaviour rather than showing a stack trace.
 */
export function isMissingSchema(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || err?.code === "42703" ||
    /listing_copy_state|copy_seq|scan_url|does not exist|schema cache/i.test(msg);
}

/** Which copy each listing is currently showing. Map<itemId, stateRow>. */
export async function loadCopyState(sb, itemIds = null) {
  try {
    let q = sb.from(COPY_STATE_TABLE).select("*");
    if (Array.isArray(itemIds) && itemIds.length) q = q.in("ebay_item_id", itemIds.map(String));
    const { data, error } = await q;
    if (error) {
      if (isMissingSchema(error)) return { ok: false, missing: true, state: new Map() };
      return { ok: false, error: error.message, state: new Map() };
    }
    return { ok: true, state: new Map((data || []).map((r) => [String(r.ebay_item_id), r])) };
  } catch (err) {
    if (isMissingSchema(err)) return { ok: false, missing: true, state: new Map() };
    return { ok: false, error: err?.message || "Could not read the copy state.", state: new Map() };
  }
}

/**
 * Record that a listing now shows a given copy's scan.
 *
 * Written AFTER eBay accepts the revision, never before: a state row claiming a
 * picture that was never set means the reconcile stops proposing the one change
 * that still needs making, and it stops quietly.
 */
export async function recordPictured(sb, { itemId, copyId, pictureUrl, userId }) {
  if (!itemId || !copyId) return { ok: false, error: "Nothing to record." };
  try {
    const { error } = await sb.from(COPY_STATE_TABLE).upsert({
      ebay_item_id: String(itemId),
      user_id: userId || null,
      pictured_copy_id: String(copyId),
      pictured_url: pictureUrl || null,
      revised_at: new Date().toISOString()
    }, { onConflict: "ebay_item_id" });
    if (error) {
      if (isMissingSchema(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    if (isMissingSchema(err)) return { ok: false, missing: true };
    return { ok: false, error: err?.message || "Could not record the picture." };
  }
}
