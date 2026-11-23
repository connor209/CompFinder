/**
 * The only file that names the lab's tables (migration 039). Every read
 * filters on `user_id` by hand as well as through RLS, because the route that
 * calls this uses the user's own session for reads but the eBay token needs
 * the admin client, and a missing filter on the wrong client would read
 * everybody's lab.
 */

export const LAB_TABLES = { listings: "lab_listings", copies: "lab_copies", events: "lab_events", settings: "listing_settings" };

/** Postgres saying the table isn't there: migration 039 has not been run. */
export function isMissingLab(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /lab_(listings|copies|events)|schema cache|does not exist/i.test(msg);
}

/**
 * Every row of one lab table for one account, past PostgREST's 1,000-row cap.
 * Each page is in a TOTAL order (the caller's column, then id), or a page
 * boundary can repeat some rows and skip others with nothing erroring — the
 * pull-sheet bug pagedSelect.js documents. Unlike pagedSelect, a failed page
 * is RETURNED, never swallowed: a lab that read half its copies would show
 * stock as sold out and send photos for the wrong copy.
 */
const PAGE = 1000;
async function readAll(sb, table, userId, orderCol) {
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select("*").eq("user_id", userId)
      .order(orderCol, { ascending: true }).order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { error };
    rows = rows.concat(data || []);
    if (!data || data.length < PAGE) return { data: rows };
  }
}

export async function loadLab(sb, userId) {
  const [l, c, e] = await Promise.all([
    readAll(sb, LAB_TABLES.listings, userId, "created_at"),
    readAll(sb, LAB_TABLES.copies, userId, "pile_seq"),
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
/**
 * Columns added by later migrations (040, 041). Postgres refuses a whole
 * insert that names a missing column, so an insert that fails on one of
 * these is tried again without them: the listing is still made, it just
 * carries less. Every one is optional for exactly that reason.
 */
const OPTIONAL_LISTING_COLUMNS = ["card_key", "card", "subtype", "extra_images", "db_image_url", "market_pence", "market_at"];

export async function insertListing(sb, userId, row) {
  let { data, error } = await sb.from(LAB_TABLES.listings).insert({ ...row, user_id: userId }).select("*").single();
  if (error && OPTIONAL_LISTING_COLUMNS.some((c) => c in row && new RegExp(`\\b${c}\\b`).test(error.message || ""))) {
    const rest = Object.fromEntries(Object.entries(row).filter(([k]) => !OPTIONAL_LISTING_COLUMNS.includes(k)));
    ({ data, error } = await sb.from(LAB_TABLES.listings).insert({ ...rest, user_id: userId }).select("*").single());
  }
  if (error) throw new Error(error.message);
  return data;
}

/** The account's listing settings, or null if none saved (or migration 041 not run). */
export async function loadListingSettings(sb, userId) {
  const { data, error } = await sb.from(LAB_TABLES.settings).select("settings, updated_at").eq("user_id", userId).maybeSingle();
  if (error) return { settings: null, missing: isMissingLab(error) || /listing_settings/.test(error.message || ""), error: error.message };
  return { settings: data?.settings || null, updatedAt: data?.updated_at || null };
}

export async function saveListingSettings(sb, userId, settings) {
  const { error } = await sb.from(LAB_TABLES.settings)
    .upsert({ user_id: userId, settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(/listing_settings/.test(error.message || "") ? "Run migration 041 in Supabase first — listing settings have nowhere to be saved yet." : error.message);
}

export async function deleteCopies(sb, userId, ids) {
  if (!ids.length) return;
  const { error } = await sb.from(LAB_TABLES.copies).delete().eq("user_id", userId).in("id", ids);
  if (error) throw new Error(error.message);
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

/**
 * Whose lab listing is this eBay item? The ONE lookup not filtered on a user,
 * because it is how a notification from eBay finds its user in the first
 * place. Called with the admin client by app/api/lab/ebay-notify only, and it
 * returns the owner and nothing else; everything after it filters on that.
 */
export async function ownerOfLiveItem(admin, itemId) {
  const id = String(itemId || "").replace(/[^0-9]/g, "");
  if (!id) return null;
  const { data, error } = await admin.from(LAB_TABLES.listings)
    .select("id, user_id, checked_at").eq("ebay_item_id", id).is("ended_at", null).limit(1);
  if (error || !data?.length) return null;
  return { listingId: data[0].id, userId: data[0].user_id, checkedAt: data[0].checked_at };
}

/**
 * Every account with a live lab listing — what the nightly sweep walks. The
 * second (and last) read not filtered on a user, for the same reason as
 * ownerOfLiveItem: it is how a job with no user finds its users. Admin client,
 * app/api/lab/sweep only.
 */
export async function usersWithLiveListings(admin) {
  const { data, error } = await admin.from(LAB_TABLES.listings)
    .select("user_id").not("ebay_item_id", "is", null).is("ended_at", null);
  if (error) throw new Error(error.message);
  return [...new Set((data || []).map((r) => r.user_id))];
}

/**
 * Take one copy out of the lab. Deleted rather than marked, so its SKU can be
 * added again later; the log keeps the record. Guarded on it still being for
 * sale, so a copy that sold in the meantime is never removed from its buyer.
 */
export async function removeCopy(sb, userId, copyId) {
  const { data, error } = await sb.from(LAB_TABLES.copies).delete()
    .eq("user_id", userId).eq("id", copyId).is("reserved_line", null).is("pulled_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data || []).length === 1;
}
