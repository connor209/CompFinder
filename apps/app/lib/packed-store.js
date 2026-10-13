/**
 * Comp Finder — which orders WE have packed, as opposed to which eBay calls
 * dispatched.
 *
 * Printing a postage label through eBay uploads the tracking number, and eBay
 * marks the order dispatched (fulfilment status FULFILLED) the moment it does.
 * The pull sheet read "still to do" straight off that status, so an order whose
 * label was printed first left the sheet before its card was pulled or packed —
 * which made printing the labels before making the piles impossible.
 *
 * So eBay's "dispatched" is read as "label printed", and done is ours: an
 * order is packed when its pile is completed on the Pack screen. A
 * label-printed order stays on the sheet until then.
 *
 * `packed_orders` (migration 033) is named in THIS FILE ONLY, and every call
 * degrades rather than throws — until 033 is run the sheet behaves exactly as
 * it always did and says why.
 *
 * Framework-free apart from the Supabase client it is handed, so
 * scripts/check-packed.mjs can load it under bare node.
 */

/** How far back a label-printed order is still asked about. Labels are printed
 *  the day the piles are made, or the day before; a week covers a weekend away
 *  and keeps the first run after this shipped from dredging up a month. */
export const LABELLED_WINDOW_DAYS = 7;

/** A packed row is only needed while eBay still hands its order back in that
 *  window. Older rows are swept on the next write. */
const KEEP_DAYS = 30;

export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || /packed_orders|does not exist|schema cache/i.test(msg);
}

/**
 * Which of these orders have been packed. `{ ok, ids: Set, missing }`.
 * A failed read is NOT an empty set: the caller is told it failed, because
 * guessing "none packed" would put a week of sent orders back on the sheet.
 */
export async function loadPackedOrderIds(sb, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { ok: true, ids: new Set() };
  try {
    const found = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb.from("packed_orders").select("order_id").in("order_id", ids.slice(i, i + 200));
      if (error) return isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error.message };
      for (const r of data || []) found.add(String(r.order_id));
    }
    return { ok: true, ids: found };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function markOrdersPacked(sb, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { ok: true };
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };
    const now = new Date().toISOString();
    const { error } = await sb
      .from("packed_orders")
      .upsert(ids.map((order_id) => ({ user_id: user.id, order_id, packed_at: now })), { onConflict: "user_id,order_id" });
    if (error) return isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error.message };
    // Housekeeping, and never a reason to report failure.
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
    await sb.from("packed_orders").delete().lt("packed_at", cutoff).then(() => {}, () => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function unmarkOrdersPacked(sb, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { ok: true };
  try {
    const { error } = await sb.from("packed_orders").delete().in("order_id", ids);
    if (error) return isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Which order lines belong on the sheet.
 *
 * - An order eBay has NOT dispatched is always on it — whatever we recorded.
 *   Packed-then-label-later is the old order of work and must keep working.
 * - A label-printed order is on it until we have packed it.
 * - A label-printed order we packed in THIS deal stays on the Pack screen
 *   (`keepKeys` are the line keys of piles completed on this device): dropping
 *   it mid-deal would renumber every pile after it under somebody's hand.
 * - If whether it was packed is UNKNOWN (`packedIds` null — migration pending
 *   or the read failed), a label-printed order is left off, which is exactly
 *   what the sheet always did. Showing a week of sent orders is the worse
 *   guess.
 */
export function sheetLines(lines, packedIds, keepKeys = new Set()) {
  return (lines || []).filter((l) => {
    if (!l.labelPrinted) return true;
    if (!packedIds) return false;
    if (!packedIds.has(String(l.orderId))) return true;
    return keepKeys.has(l.lineItemId);
  });
}
