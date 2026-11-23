/**
 * The only file that names the lab's tables (migration 039). Every read
 * filters on `user_id` by hand as well as through RLS, because the route that
 * calls this uses the user's own session for reads but the eBay token needs
 * the admin client, and a missing filter on the wrong client would read
 * everybody's lab.
 */

export const LAB_TABLES = { listings: "lab_listings", copies: "lab_copies", events: "lab_events" };

/** Postgres saying the table isn't there: migration 039 has not been run. */
export function isMissingLab(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /lab_(listings|copies|events)|schema cache|does not exist/i.test(msg);
}

export async function loadLab(sb, userId) {
  const [l, c, e] = await Promise.all([
    sb.from(LAB_TABLES.listings).select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    sb.from(LAB_TABLES.copies).select("*").eq("user_id", userId).order("pile_seq", { ascending: true }),
    sb.from(LAB_TABLES.events).select("*").eq("user_id", userId).order("at", { ascending: false }).limit(200)
  ]);
  const err = l.error || c.error || e.error;
  if (err) return { ok: false, missing: isMissingLab(err), error: err.message };
  return { ok: true, listings: l.data || [], copies: c.data || [], events: e.data || [] };
}

export async function logEvent(sb, userId, listingId, kind, detail = {}) {
  // A failed log must never fail the action it describes.
  await sb.from(LAB_TABLES.events).insert({ user_id: userId, listing_id: listingId || null, kind, detail }).then(() => {}, () => {});
}

/** The listing row first, so its copies have something to belong to. */
export async function insertListing(sb, userId, row) {
  const { data, error } = await sb.from(LAB_TABLES.listings).insert({ ...row, user_id: userId }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function insertCopies(sb, userId, listingId, copies) {
  const rows = copies.map((c) => ({
    user_id: userId, listing_id: listingId, sku: c.sku, pile_seq: c.pile_seq, copy_seq: c.copy_seq ?? null, scan_urls: c.scans
  }));
  const { data, error } = await sb.from(LAB_TABLES.copies).insert(rows).select("*");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function updateListing(sb, userId, id, patch) {
  const { error } = await sb.from(LAB_TABLES.listings).update(patch).eq("user_id", userId).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteListing(sb, userId, id) {
  const { error } = await sb.from(LAB_TABLES.listings).delete().eq("user_id", userId).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Reserve one copy for one order unit. Guarded on the copy still being free,
 * and the unique index on reserved_line refuses the same unit twice, so two
 * checks running at once cannot hand one sale two copies or one copy two sales.
 */
export async function reserveCopy(sb, userId, r) {
  const { data, error } = await sb.from(LAB_TABLES.copies)
    .update({ reserved_line: r.line, reserved_order: r.orderId, reserved_at: r.soldAt || new Date().toISOString(), reserved_mismatch: !!r.mismatch })
    .eq("user_id", userId).eq("id", r.copyId).is("reserved_line", null).is("pulled_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: (data || []).length === 1 };
}

export async function markPulled(sb, userId, copyId) {
  const { data, error } = await sb.from(LAB_TABLES.copies)
    .update({ pulled_at: new Date().toISOString() })
    .eq("user_id", userId).eq("id", copyId).is("pulled_at", null).not("reserved_line", "is", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data || []).length === 1;
}

/** A cancelled order: the copy goes back to its place in the queue. */
export async function releaseCopy(sb, userId, copyId) {
  const { data: rows, error: readErr } = await sb.from(LAB_TABLES.copies)
    .select("id, listing_id, reserved_line").eq("user_id", userId).eq("id", copyId).is("pulled_at", null);
  if (readErr) throw new Error(readErr.message);
  const copy = (rows || [])[0];
  if (!copy?.reserved_line) return false;
  // Remember the unit first: if the copy were freed and this write then
  // failed, the next check would hand the cancelled order the copy again.
  const { data: l, error: lErr } = await sb.from(LAB_TABLES.listings)
    .select("released_lines").eq("user_id", userId).eq("id", copy.listing_id).single();
  if (lErr) throw new Error(lErr.message);
  const released = [...new Set([...(l?.released_lines || []), copy.reserved_line])];
  const { error: uErr } = await sb.from(LAB_TABLES.listings).update({ released_lines: released }).eq("user_id", userId).eq("id", copy.listing_id);
  if (uErr) throw new Error(uErr.message);
  const { data, error } = await sb.from(LAB_TABLES.copies)
    .update({ reserved_line: null, reserved_order: null, reserved_at: null, reserved_mismatch: false })
    .eq("user_id", userId).eq("id", copyId).is("pulled_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data || []).length === 1;
}
