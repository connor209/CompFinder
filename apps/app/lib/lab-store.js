/**
 * The only file that names the lab's tables (migrations 039–042). Every read
 * filters on `user_id` by hand as well as through RLS, because the route that
 * calls this uses the user's own session for reads but the eBay token needs
 * the admin client, and a missing filter on the wrong client would read
 * everybody's lab.
 *
 * SINCE THE FOLD (042, docs/LAB_FOLD.md) A LAB COPY IS A STACK CARD: a
 * `stack_cards` row with `lab_listing_id` set. `lab_copies` is read once more,
 * by the move, and never written again after it. Until every copy has moved,
 * the lab refuses to act — there is never a moment with two records of a card.
 */
import { liveRanks } from "./stackpos.js";
import { movePlan, stackRowFrom, asLabCopy, labStackNameFor } from "./lab-stacks.js";

export const LAB_TABLES = { listings: "lab_listings", copies: "lab_copies", events: "lab_events", settings: "listing_settings" };
const CARDS = "stack_cards";
const STACKS = "card_stacks";

/** Postgres saying the table isn't there: migration 039 has not been run. */
export function isMissingLab(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /lab_(listings|copies|events)|schema cache|does not exist/i.test(msg);
}

/**
 * Every row of one table for one account, past PostgREST's 1,000-row cap.
 * Each page is in a TOTAL order (the caller's column, then id), or a page
 * boundary can repeat some rows and skip others with nothing erroring — the
 * pull-sheet bug pagedSelect.js documents. Unlike pagedSelect, a failed page
 * is RETURNED, never swallowed: a lab that read half its copies would show
 * stock as sold out and send photos for the wrong copy.
 */
const PAGE = 1000;
async function readAll(sb, table, userId, orderCol, narrow = (q) => q) {
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await narrow(sb.from(table).select("*").eq("user_id", userId))
      .order(orderCol, { ascending: true }).order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { error };
    rows = rows.concat(data || []);
    if (!data || data.length < PAGE) return { data: rows };
  }
}

/**
 * Where the fold stands: "pending" (042 not run), "move" (copies still in
 * lab_copies — the lab waits for the move), or "done" (the lab reads stacks).
 */
export async function foldState(sb, userId) {
  const { data, error } = await sb.from(LAB_TABLES.copies).select("id").eq("user_id", userId).is("stack_card_id", null).limit(1);
  if (error) return /stack_card_id/.test(error.message || "") ? { state: "pending" } : { state: "error", error: error.message };
  if (data?.length) {
    const { count } = await sb.from(LAB_TABLES.copies).select("id", { count: "exact", head: true }).eq("user_id", userId).is("stack_card_id", null);
    return { state: "move", unmoved: count ?? data.length };
  }
  return { state: "done" };
}

/** The lab's copies as stack cards, each with its stack's name and live rank. */
async function readLabCards(sb, userId) {
  const lab = await readAll(sb, CARDS, userId, "position", (q) => q.not("lab_listing_id", "is", null));
  if (lab.error) return lab;
  const stackIds = [...new Set(lab.data.map((c) => c.stack_id).filter(Boolean))];
  const stacks = await readAll(sb, STACKS, userId, "created_at");
  if (stacks.error) return stacks;
  // Ranks are counted over EVERY card in those stacks, lab or not, so a lab
  // card's number is the one Stacks and the pull sheet show.
  const neighbours = stackIds.length
    ? await readAll(sb, CARDS, userId, "position", (q) => q.in("stack_id", stackIds))
    : { data: [] };
  if (neighbours.error) return neighbours;
  const ranks = liveRanks(neighbours.data);
  const names = new Map(stacks.data.map((s) => [s.id, s.name]));
  return { data: lab.data.map((c) => asLabCopy(c, { ranks, names })) };
}

export async function loadLab(sb, userId) {
  const fold = await foldState(sb, userId);
  if (fold.state === "error") return { ok: false, error: fold.error };
  if (fold.state === "pending") return { ok: false, foldPending: true, error: "Run migration 042 in Supabase — the lab now keeps its copies in the stacks." };
  const [l, e] = await Promise.all([
    readAll(sb, LAB_TABLES.listings, userId, "created_at"),
    sb.from(LAB_TABLES.events).select("*").eq("user_id", userId).order("at", { ascending: false }).limit(200)
  ]);
  const err0 = l.error || e.error;
  if (err0) return { ok: false, missing: isMissingLab(err0), error: err0.message };
  if (fold.state === "move") {
    return { ok: false, needsMove: true, unmoved: fold.unmoved, listings: l.data || [], events: e.data || [],
      error: `${fold.unmoved} lab cop${fold.unmoved === 1 ? "y" : "ies"} still to move into the stacks — press Move lab copies into stacks on the lab page.` };
  }
  const c = await readLabCards(sb, userId);
  if (c.error) return { ok: false, error: c.error.message };
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

/**
 * Put new lab copies onto the stacks, through the same plan as the move: an
 * unpulled stack card already carrying the SKU is ADOPTED where it sits (it
 * is this card — a CardUploader inventory import may have stacked it), the
 * rest go at the back of LAB-<pile>, made if missing. A SKU on a pulled or
 * already-lab card is refused before anything is written.
 *
 * Returns the copies in the lab's shape, each marked `_adopted` so undoCopies
 * can put an adopted card back exactly as it was.
 */
export async function insertCopies(sb, userId, listingId, copies, { title = null } = {}) {
  const pseudo = copies.map((c, i) => ({ id: `new${i}`, sku: c.sku, pile_seq: c.pile_seq, listing_id: listingId, copy_seq: c.copy_seq ?? null, scan_urls: c.scans || [] }));
  const { plan, stacks } = await planPlacement(sb, userId, pseudo);
  const refused = plan.steps.filter((s) => s.kind === "refuse");
  if (refused.length) throw new Error(refused.map((s) => `${s.copy.sku}: ${s.why}`).join("; "));
  const stackIds = await ensureStacks(sb, userId, plan.newStacks, stacks);
  const out = [];
  try {
    for (const step of plan.steps) {
      const row = { ...stackRowFrom(step.copy, { title }), added_at: new Date().toISOString() };
      if (step.kind === "adopt") {
        const { data, error } = await sb.from(CARDS).update({ lab_listing_id: row.lab_listing_id, scan_urls: row.scan_urls, copy_seq: row.copy_seq })
          .eq("user_id", userId).eq("id", step.stackCard.id).is("lab_listing_id", null).is("pulled_at", null).select("*");
        if (error || data?.length !== 1) throw new Error(error?.message || `${step.copy.sku} changed while it was being adopted.`);
        out.push({ ...asLabCopy(data[0]), _adopted: true });
      } else {
        const { data, error } = await sb.from(CARDS).insert({ ...row, user_id: userId, stack_id: stackIds.get(step.stackName), position: step.position }).select("*").single();
        if (error) throw new Error(error.message);
        out.push(asLabCopy(data));
      }
    }
  } catch (e) {
    await undoCopies(sb, userId, out);
    throw e;
  }
  return out;
}

/** Undo insertCopies: delete what it inserted, give back what it adopted. */
export async function undoCopies(sb, userId, rows) {
  const made = (rows || []).filter((r) => !r._adopted).map((r) => r.id);
  const adopted = (rows || []).filter((r) => r._adopted).map((r) => r.id);
  if (made.length) await sb.from(CARDS).delete().eq("user_id", userId).in("id", made);
  if (adopted.length) await sb.from(CARDS).update({ lab_listing_id: null, scan_urls: null, copy_seq: null }).eq("user_id", userId).in("id", adopted);
}

/** The cards a placement plan has to see: same SKUs, and everything in the target stacks. */
async function planPlacement(sb, userId, labCopies) {
  const stacks = await readAll(sb, STACKS, userId, "created_at");
  if (stacks.error) throw new Error(stacks.error.message);
  const skus = [...new Set(labCopies.map((c) => c.sku))];
  const names = new Set(labCopies.map((c) => labStackNameFor(c.sku)));
  const targetIds = stacks.data.filter((s) => names.has(String(s.name).toUpperCase())).map((s) => s.id);
  const bySku = [];
  for (let i = 0; i < skus.length; i += 200) {
    const r = await readAll(sb, CARDS, userId, "position", (q) => q.in("sku", skus.slice(i, i + 200)));
    if (r.error) throw new Error(r.error.message);
    bySku.push(...r.data);
  }
  const inTargets = targetIds.length ? await readAll(sb, CARDS, userId, "position", (q) => q.in("stack_id", targetIds)) : { data: [] };
  if (inTargets.error) throw new Error(inTargets.error.message);
  const seen = new Map([...bySku, ...inTargets.data].map((c) => [c.id, c]));
  return { plan: movePlan(labCopies, [...seen.values()], stacks.data), stacks: stacks.data };
}

/** The ids of the named stacks, making any that don't exist yet. */
async function ensureStacks(sb, userId, newNames, stacks) {
  const ids = new Map((stacks || []).map((s) => [String(s.name).toUpperCase(), s.id]));
  for (const name of newNames || []) {
    if (ids.has(name)) continue;
    const { data, error } = await sb.from(STACKS).insert({ user_id: userId, name }).select("id").single();
    if (error) throw new Error(`Couldn't make stack ${name}: ${error.message}`);
    ids.set(name, data.id);
  }
  return ids;
}

/**
 * The move: every lab_copies row into the stacks. Idempotent — a copy already
 * moved has stack_card_id and is skipped — and each copy is recorded as moved
 * straight after its stack card is written, so a failure part-way leaves a
 * state a second press finishes. Refusals are reported and stay unmoved.
 */
export async function moveLabCopies(sb, userId) {
  const copies = await readAll(sb, LAB_TABLES.copies, userId, "pile_seq", (q) => q.is("stack_card_id", null));
  if (copies.error) throw new Error(copies.error.message);
  if (!copies.data.length) return { moved: 0, adopted: 0, refused: [] };
  const listings = await readAll(sb, LAB_TABLES.listings, userId, "created_at");
  if (listings.error) throw new Error(listings.error.message);
  const byListing = new Map(listings.data.map((l) => [l.id, l]));
  const { plan, stacks } = await planPlacement(sb, userId, copies.data);
  const stackIds = await ensureStacks(sb, userId, plan.newStacks, stacks);
  let moved = 0;
  let adopted = 0;
  const refused = [];
  const newId = new Map(); // lab_copies id → stack_cards id
  for (const step of plan.steps) {
    const c = step.copy;
    if (step.kind === "refuse") { refused.push({ sku: c.sku, why: step.why }); continue; }
    const row = stackRowFrom(c, byListing.get(c.listing_id));
    let cardId;
    if (step.kind === "adopt") {
      const { title, sku, added_at, ...lab } = row; // eslint-disable-line no-unused-vars
      const { data, error } = await sb.from(CARDS).update(lab).eq("user_id", userId).eq("id", step.stackCard.id).is("lab_listing_id", null).select("id");
      if (error || data?.length !== 1) { refused.push({ sku: c.sku, why: error?.message || "the stack card changed meanwhile" }); continue; }
      cardId = data[0].id;
      adopted += 1;
    } else {
      const { data, error } = await sb.from(CARDS).insert({ ...row, user_id: userId, stack_id: stackIds.get(step.stackName), position: step.position }).select("id").single();
      if (error) { refused.push({ sku: c.sku, why: error.message }); continue; }
      cardId = data.id;
      moved += 1;
    }
    const { error: mErr } = await sb.from(LAB_TABLES.copies).update({ stack_card_id: cardId }).eq("user_id", userId).eq("id", c.id);
    if (mErr) refused.push({ sku: c.sku, why: `moved, but not recorded as moved: ${mErr.message}` });
    newId.set(String(c.id), cardId);
  }
  // A listing names the copy it is showing by id, and the id just changed.
  // Point it at the same card's stack id, or every listing would read as
  // "photos behind the queue" and be revised again for nothing.
  for (const l of listings.data) {
    const to = l.pictured_copy_id ? newId.get(String(l.pictured_copy_id)) : null;
    if (to) await sb.from(LAB_TABLES.listings).update({ pictured_copy_id: to }).eq("user_id", userId).eq("id", l.id);
  }
  return { moved, adopted, refused };
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
  const { data, error } = await sb.from(CARDS)
    .update({ reserved_line: r.line, reserved_order: r.orderId, reserved_at: r.soldAt || new Date().toISOString(), reserved_mismatch: !!r.mismatch })
    .eq("user_id", userId).eq("id", r.copyId).not("lab_listing_id", "is", null).is("reserved_line", null).is("pulled_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: (data || []).length === 1 };
}

export async function markPulled(sb, userId, copyId) {
  const { data, error } = await sb.from(CARDS)
    .update({ pulled_at: new Date().toISOString() })
    .eq("user_id", userId).eq("id", copyId).not("lab_listing_id", "is", null).is("pulled_at", null).not("reserved_line", "is", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data || []).length === 1;
}

/** A cancelled order: the copy goes back to its place in the queue. */
export async function releaseCopy(sb, userId, copyId) {
  const { data: rows, error: readErr } = await sb.from(CARDS)
    .select("id, lab_listing_id, reserved_line").eq("user_id", userId).eq("id", copyId).not("lab_listing_id", "is", null).is("pulled_at", null);
  if (readErr) throw new Error(readErr.message);
  const copy = (rows || [])[0];
  if (!copy?.reserved_line) return false;
  // Remember the unit first: if the copy were freed and this write then
  // failed, the next check would hand the cancelled order the copy again.
  const { data: l, error: lErr } = await sb.from(LAB_TABLES.listings)
    .select("released_lines").eq("user_id", userId).eq("id", copy.lab_listing_id).single();
  if (lErr) throw new Error(lErr.message);
  const released = [...new Set([...(l?.released_lines || []), copy.reserved_line])];
  const { error: uErr } = await sb.from(LAB_TABLES.listings).update({ released_lines: released }).eq("user_id", userId).eq("id", copy.lab_listing_id);
  if (uErr) throw new Error(uErr.message);
  const { data, error } = await sb.from(CARDS)
    .update({ reserved_line: null, reserved_order: null, reserved_at: null, reserved_mismatch: false })
    .eq("user_id", userId).eq("id", copyId).not("lab_listing_id", "is", null).is("pulled_at", null)
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
  const { data, error } = await sb.from(CARDS).delete()
    .eq("user_id", userId).eq("id", copyId).not("lab_listing_id", "is", null).is("reserved_line", null).is("pulled_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data || []).length === 1;
}
