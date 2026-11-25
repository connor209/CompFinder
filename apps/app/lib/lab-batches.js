/**
 * Comp Finder — Add copies batches: the working list, kept on the server.
 *
 * Each upload makes a batch with its own URL (/panel/lab/add?batch=<id>), so
 * tabs and devices work on separate batches instead of sharing the one
 * localStorage slot that four tabs once overwrote each other through
 * (2026-11-25). The list itself is lib/lab-draft.js's, unchanged — this file
 * only says where it lives.
 *
 * The same batch open twice is guarded by `rev`: a save names the rev it was
 * loaded at, and a save from the stale tab changes nothing and reports a
 * CONFLICT rather than overwriting the newer list. Last-write-wins is the bug
 * this file exists to remove; it must not come back one level up.
 *
 * `lab_batches` (migration 047) is named in THIS FILE ONLY, and every call
 * degrades: before 047 the screen keeps the old one-list-per-browser draft.
 * Takes the Supabase client as an argument, so scripts/check-labbatches.mjs
 * runs it against a fake one under bare node.
 */
import { rowStatus } from "./lab-draft.js";

const TABLE = "lab_batches";
const LIST_COLUMNS = "id,name,created_at,updated_at,rev,files,card_count,copy_count,listed_count";

export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /lab_batches|does not exist|schema cache/i.test(msg);
}
const fail = (error) => (isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error?.message || String(error) });

/** The counts the batch list shows, read off the rows so they are never typed twice. */
export function batchSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let copies = 0, listed = 0;
  for (const r of list) {
    copies += (r.copies || []).length;
    if (rowStatus(r, null) === "listed") listed += 1;
  }
  const files = [...new Set(list.map((r) => r.file).filter(Boolean))];
  return { card_count: list.length, copy_count: copies, listed_count: listed, files };
}

/** "base-set.csv · 25 Nov 14:05", or "3 files · …" — a name somebody can tell apart in a list. */
export function defaultBatchName(fileNames = [], at = new Date()) {
  const names = [...new Set((fileNames || []).filter(Boolean))];
  const when = new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const what = names.length === 0 ? "Batch" : names.length === 1 ? names[0].replace(/\.csv$/i, "") : `${names.length} files`;
  return `${what} · ${when}`.slice(0, 120);
}

/** The batch's own backup on this device, so a dropped connection never costs a typed price. */
export function localKeyFor(batchId) {
  return `cf-lab-batch-${batchId}`;
}

/** The batch id in a URL's query string, or null. Only a uuid is accepted. */
export function batchIdFrom(search) {
  const id = new URLSearchParams(String(search || "")).get("batch") || "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
}

/** Every batch, newest first — counts only, never the rows. */
export async function listLabBatches(sb) {
  try {
    const { data, error } = await sb.from(TABLE).select(LIST_COLUMNS).order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(200);
    if (error) return fail(error);
    return { ok: true, batches: data || [] };
  } catch (e) { return fail(e); }
}

/** One batch with its rows. */
export async function loadLabBatch(sb, id) {
  try {
    const { data, error } = await sb.from(TABLE).select(`${LIST_COLUMNS},rows`).eq("id", id).maybeSingle();
    if (error) return fail(error);
    if (!data) return { ok: false, notFound: true, error: "That batch isn't there — deleted, or it belongs to another account." };
    return { ok: true, batch: { ...data, rows: Array.isArray(data.rows) ? data.rows : [] } };
  } catch (e) { return fail(e); }
}

/** A new batch holding `rows`. */
export async function createLabBatch(sb, { name, rows, at = new Date() }) {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };
    const iso = new Date(at).toISOString();
    const row = { user_id: user.id, name: String(name || defaultBatchName([], at)).slice(0, 120), rows: rows || [], rev: 0, created_at: iso, updated_at: iso, ...batchSummary(rows) };
    const { data, error } = await sb.from(TABLE).insert(row).select(LIST_COLUMNS).single();
    if (error) return fail(error);
    return { ok: true, batch: data };
  } catch (e) { return fail(e); }
}

/**
 * Save the rows over the batch IF nobody has saved since `rev`.
 * `{ ok, rev }` on success; `{ ok: false, conflict: true }` when another tab
 * or device got there first — nothing is written then.
 */
export async function saveLabBatch(sb, { id, rows, rev, at = new Date() }) {
  try {
    const patch = { rows: rows || [], rev: rev + 1, updated_at: new Date(at).toISOString(), ...batchSummary(rows) };
    const { data, error } = await sb.from(TABLE).update(patch).eq("id", id).eq("rev", rev).select("id,rev");
    if (error) return fail(error);
    if (!data || data.length === 0) return { ok: false, conflict: true };
    return { ok: true, rev: data[0].rev };
  } catch (e) { return fail(e); }
}

export async function renameLabBatch(sb, id, name) {
  const clean = String(name || "").trim().slice(0, 120);
  if (!clean) return { ok: false, error: "A batch needs a name." };
  try {
    const { error } = await sb.from(TABLE).update({ name: clean }).eq("id", id);
    return error ? fail(error) : { ok: true, name: clean };
  } catch (e) { return fail(e); }
}

export async function deleteLabBatch(sb, id) {
  try {
    const { error } = await sb.from(TABLE).delete().eq("id", id);
    return error ? fail(error) : { ok: true };
  } catch (e) { return fail(e); }
}
