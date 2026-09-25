/**
 * Comp Finder — the storefront's links, and the one road from the database to
 * a stranger.
 *
 * `show_storefronts` (migration 029) is named in THIS FILE ONLY, the same rule
 * wants-store.js and batch-store.js follow: a second place naming the table is
 * a second place to update, and Postgres rejects a whole statement over one
 * missing column.
 *
 * Two halves, and they are held to different standards:
 *
 * - **The desk's half** (loadStorefronts, createStorefront, revokeStorefront)
 *   runs in the logged-in browser through RLS, like every other store here,
 *   and degrades to `{ ok: false, missing: true }` until 029 is applied.
 *
 * - **The public half** (loadPublicStorefront) runs on the server with the
 *   SERVICE-ROLE key, which bypasses row-level security. That is the only way
 *   an anonymous visitor can be served anything — they have no uid — and it is
 *   why this function is written the way it is. With RLS out of the way,
 *   every read is filtered on the link owner's `user_id` BY HAND, every select
 *   names its columns rather than `*`, and what it returns is
 *   storefrontStock()'s projection and nothing else. check-storefront.mjs runs
 *   it against a fake client and fails on a read without the owner filter.
 *
 * The TOKEN is the whole of the access control, so it is long (16 random
 * bytes), it can be switched off, and it can run out on its own — a QR printed
 * on a sign outlives the show it was printed for.
 *
 * Framework-free apart from the Supabase client it is handed, so
 * scripts/check-storefront.mjs can load it under bare node.
 */
import { storefrontStock } from "./storefront.js";
import { getSetIndex, setMatcher } from "./set-index.js";
import { showOnly } from "./streamstock.js";

/** Where a storefront lives. Short, because it is a QR: fewer modules to scan. */
export const STOREFRONT_PATH = "/show";

export function storefrontPath(token) {
  return `${STOREFRONT_PATH}/${encodeURIComponent(String(token || ""))}`;
}

export function storefrontUrl(origin, token) {
  return `${String(origin || "").replace(/\/+$/, "")}${storefrontPath(token)}`;
}

/** 16 random bytes, base64url: 22 characters, 128 bits, nothing to guess. */
export function newToken() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Could this be a token at all? Checked before the database is asked, so a
 * crawler walking `/show/anything` costs a regex rather than a query.
 */
export function isWellFormedToken(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(token);
}

/**
 * How long a new link stays up.
 *
 * Days, not "until the end of the show", because nothing here knows when a
 * show ends. Three by default: a weekend show plus the evening before, and a
 * printed sign left in a box is dead by the next one. "Until I switch it off"
 * is offered because the between-shows storefront is where docs/SHOW_STOREFRONT.md
 * says the value compounds — but it is a choice, not the default.
 */
export const EXPIRY_CHOICES = [
  { days: 1, label: "for 24 hours" },
  { days: 3, label: "for 3 days" },
  { days: 7, label: "for a week" },
  { days: 30, label: "for a month" },
  { days: 0, label: "until I switch it off" }
];
export const DEFAULT_EXPIRY_DAYS = 3;

/** When a link made now for `days` runs out, or null for never. */
export function expiresAtFor(days, now = new Date()) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return null;
  return new Date(now.getTime() + d * 24 * 60 * 60 * 1000).toISOString();
}

/** "live", "off" (switched off) or "expired". Switched off wins: it was a decision. */
export function storefrontStatus(row, now = new Date()) {
  if (!row) return "off";
  if (row.revoked_at) return "off";
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  return "live";
}

export function isLive(row, now = new Date()) {
  return storefrontStatus(row, now) === "live";
}

/** Does this error mean "migration 029 hasn't been run"? */
export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /show_storefronts|does not exist|schema cache/i.test(msg);
}

// --- The desk's half: logged in, through RLS ------------------------------

/** How many links the desk lists. Old ones are history, not a to-do list. */
export const STOREFRONTS_LIMIT = 20;

export async function loadStorefronts(sb) {
  try {
    const { data, error } = await sb
      .from("show_storefronts")
      .select("id,token,title,event,include_online,created_at,expires_at,revoked_at,views,last_viewed_at")
      .order("created_at", { ascending: false })
      .limit(STOREFRONTS_LIMIT);
    if (error) return isMissingTable(error) ? { ok: false, missing: true, rows: [] } : { ok: false, error: error.message, rows: [] };
    return { ok: true, rows: data || [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), rows: [] };
  }
}

export async function createStorefront(sb, { title = "", event = "", includeOnline = true, days = DEFAULT_EXPIRY_DAYS } = {}) {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };
    const { data, error } = await sb
      .from("show_storefronts")
      .insert({
        user_id: user.id,
        token: newToken(),
        title: String(title || "").trim().slice(0, 80) || null,
        event: String(event || "").trim() || null,
        include_online: Boolean(includeOnline),
        expires_at: expiresAtFor(days)
      })
      .select("id,token,title,event,include_online,created_at,expires_at,revoked_at,views,last_viewed_at")
      .single();
    if (error) return isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error.message };
    return { ok: true, row: data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Switch a link off. Kept rather than deleted, so its view count survives. */
export async function revokeStorefront(sb, id) {
  try {
    const { error } = await sb.from("show_storefronts").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// --- The public half: service role, no RLS, so every filter is by hand ----

/**
 * Exactly the columns the projection reads. Never `*`: a column added to
 * `stock_checkouts` next year must not arrive in this process by default, even
 * though the projection would drop it — the allow-list starts at the SELECT.
 *
 * The SKU is read and never leaves the server: it is how a checkout finds the
 * photo on its listing, and how a card in the box is kept out of the online
 * section.
 */
export const CHECKOUT_COLUMNS = "id,title,sku,sticker_pence";
/** Without 024's column, so a database missing it still serves the box, unpriced. */
export const CHECKOUT_COLUMNS_PRE_024 = "id,title,sku";
/**
 * The pool column (migration 031), read so the live-stream box can be LEFT
 * OUT: those cards are checked out too, they are not on the table, and this
 * is the one screen of ours a stranger holds. Read rather than filtered in the
 * query, so a database without 031 — every row a show row — still serves.
 */
export const POOL_COLUMN = "pool";
export const LISTING_COLUMNS = "ebay_item_id,sku,title,price_value,quantity,image_url";
const LINK_COLUMNS = "id,user_id,title,event,include_online,expires_at,revoked_at";

/** A paged read that reports its error, where pagedSelect() swallows it. */
async function readAll(makeQuery, pageSize = 1000) {
  let from = 0;
  let rows = [];
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { rows, error };
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { rows, error: null };
}

/**
 * Everything a stranger holding `token` may see, or why not.
 *
 * `{ ok: false, reason: "not-found" }` for a token that is malformed, unknown,
 * or waiting on migration 029 — one answer for all three, so the page cannot
 * be used to find out which. `"ended"` for a link that existed and has been
 * switched off or run out: somebody scanning last month's sign should be told
 * the show is over rather than that the link is broken.
 */
export async function loadPublicStorefront(admin, token, { now = new Date() } = {}) {
  if (!isWellFormedToken(token)) return { ok: false, reason: "not-found" };

  const { data: link, error: linkErr } = await admin
    .from("show_storefronts")
    .select(LINK_COLUMNS)
    .eq("token", token)
    .maybeSingle();
  if (linkErr) return { ok: false, reason: isMissingTable(linkErr) ? "not-found" : "error" };
  if (!link || !link.user_id) return { ok: false, reason: "not-found" };
  if (!isLive(link, now)) return { ok: false, reason: "ended" };

  const owner = link.user_id;
  const event = String(link.event || "").trim();
  const checkoutQuery = (cols) => () => {
    let q = admin.from("stock_checkouts").select(cols).eq("user_id", owner).is("resolved_at", null);
    if (event) q = q.eq("event", event);
    return q.order("checked_out_at", { ascending: true });
  };

  // Both reads and the view count at once: on venue wifi the visitor is
  // waiting on the slowest of them, not the sum.
  const [box, live, sets] = await Promise.all([
    readAll(checkoutQuery(`${CHECKOUT_COLUMNS},${POOL_COLUMN}`))
      .then((r) => (r.error ? readAll(checkoutQuery(CHECKOUT_COLUMNS)) : r))
      .then((r) => (r.error ? readAll(checkoutQuery(CHECKOUT_COLUMNS_PRE_024)) : r)),
    // Read even when the link leaves the online stock out: a checkout's photo
    // is on the listing it came from.
    readAll(() => admin.from("ebay_listings").select(LISTING_COLUMNS).eq("user_id", owner)),
    // The public catalogue's set list, for the set filter. A failure here
    // costs the filter, never the page.
    getSetIndex(admin).catch(() => ({ index: null })),
    // A count we fail to write is a count we lose, not a page we refuse.
    Promise.resolve()
      .then(() => admin.rpc("storefront_hit", { p_id: link.id }))
      .catch(() => null)
  ]);
  if (box.error) return { ok: false, reason: "error" };

  return {
    ok: true,
    storefront: {
      // The title is written FOR visitors. The event is our name for the trip
      // and stays here, like the event filter the counter view hides.
      title: String(link.title || "").trim() || null,
      includeOnline: Boolean(link.include_online),
      at: now.toISOString()
    },
    stock: storefrontStock(showOnly(box.rows), live.error ? [] : live.rows, {
      includeOnline: Boolean(link.include_online),
      setOf: setMatcher(sets?.index)
    })
  };
}
