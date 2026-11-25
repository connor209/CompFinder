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
import { rowStatus, liveCopies } from "./lab-draft.js";

const TABLE = "lab_batches";
const BASE_COLUMNS = "id,name,created_at,updated_at,rev,files,card_count,copy_count,listed_count";
/** What a tile shows beyond 047's counts (migration 049). Read and written only where the columns exist. */
export const TILE_FIELDS = ["cover_url", "value_pence", "listed_value_pence", "priced_count", "language", "game"];
const TILE_COLUMNS = `${BASE_COLUMNS},${TILE_FIELDS.join(",")}`;

// Migrations are run by hand and the code ships first: a database without 049
// is told about once, and from then on asked only for what it has.
let tilesMissing = false;
const isMissingTileColumn = (err) => TILE_FIELDS.some((f) => String(err?.message || "").includes(f));
const withoutTiles = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !TILE_FIELDS.includes(k)));
const listColumns = () => (tilesMissing ? BASE_COLUMNS : TILE_COLUMNS);

export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /lab_batches|does not exist|schema cache/i.test(msg);
}
const fail = (error) => (isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error?.message || String(error) });

/** The most common non-empty value, or null. */
function commonest(values) {
  const n = new Map();
  for (const v of values) if (v) n.set(v, (n.get(v) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/**
 * What the batch list shows, read off the rows so it is never typed twice:
 * counts, the first scan as a cover, what the batch is worth at the prices
 * set (price × copies, left-out rows not counted) and what has listed.
 */
export function batchSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let copies = 0, listed = 0, priced = 0, value = 0, listedValue = 0, cards = 0;
  for (const r of list) {
    copies += (r.copies || []).length;
    const st = rowStatus(r, null);
    if (st === "excluded" || st === "nocopies") continue;
    cards += 1;
    const n = liveCopies(r).length;
    if (st === "listed") listed += 1;
    if (r.pricePence != null) {
      priced += 1;
      value += r.pricePence * n;
      if (st === "listed") listedValue += r.pricePence * n;
    }
  }
  const files = [...new Set(list.map((r) => r.file).filter(Boolean))];
  const cover = list.map((r) => liveCopies(r)[0]?.scans?.[0] || r.copies?.[0]?.scans?.[0]).find(Boolean) || null;
  return {
    card_count: list.length, copy_count: copies, listed_count: listed, files,
    cover_url: cover, value_pence: value, listed_value_pence: listedValue, priced_count: priced,
    language: commonest(list.map((r) => r.language)), game: commonest(list.map((r) => r.card?.game))
  };
}

/**
 * The settings a batch was loaded with, read back off its rows — the next file
 * loaded into it is loaded the same way. Rows carry these already, so nothing
 * else needs storing.
 */
export function batchDefaults(rows) {
  const list = (rows || []).filter((r) => !r.excluded);
  return {
    language: commonest(list.map((r) => r.language)) || "English",
    anyLanguage: list.length > 0 && list.every((r) => r.anyLanguage),
    overseas: list.length > 0 && list.every((r) => r.overseas)
  };
}

/** What a batch is, as a tile's kicker says it: "English · Pokémon". */
export function batchKind(b) {
  return [b?.language, b?.game].filter(Boolean).join(" · ") || "Cards";
}

/**
 * Where a batch has got to, for the chip on its tile. `pricing` is whether
 * the queue has an open job for it. Listed beats everything; an empty batch
 * says so rather than "ready".
 */
export function batchStage(b, { pricing = false } = {}) {
  const cards = b?.card_count || 0;
  if (!cards) return { key: "empty", label: "Empty" };
  if (pricing) return { key: "pricing", label: "Pricing…" };
  if (b.listed_count >= cards) return { key: "listed", label: "All listed" };
  if (b.listed_count > 0) return { key: "listing", label: `${b.listed_count} of ${cards} listed` };
  if (b.priced_count == null) return { key: "open", label: "In progress" };
  if (b.priced_count < cards) return { key: "pricing-needed", label: b.priced_count ? `${b.priced_count} of ${cards} priced` : "Not priced" };
  return { key: "ready", label: "Ready to list" };
}

/** The counts the steps show. Pure, so the check pins it; the step bar (app/panel/lab/add/BatchSteps.js) draws it. */
export function batchProgress(rows, joinsOf = () => null, queued = new Set()) {
  const p = { cards: 0, copies: 0, priced: 0, queued: 0, unpriced: 0, needsPrice: 0, check: 0, ready: 0, failed: 0, sending: 0, listed: 0, readyIds: [] };
  for (const r of rows || []) {
    const st = rowStatus(r, joinsOf(r));
    if (st === "excluded" || st === "nocopies") continue;
    p.cards += 1;
    p.copies += liveCopies(r).length;
    if (queued.has(String(r.id))) p.queued += 1;
    if (st === "listed") { p.listed += 1; p.priced += 1; continue; }
    if (st === "sending") { p.sending += 1; p.priced += 1; continue; }
    if (st === "failed") p.failed += 1;
    if (r.pricePence != null || joinsOf(r)) p.priced += 1;
    else if (!r.comps && !queued.has(String(r.id))) p.unpriced += 1;
    if (st === "needsprice" || st === "toolow") { if (r.comps || r.pricePence != null) p.needsPrice += 1; }
    if (st === "thin") p.check += 1;
    if (st === "ready") { p.ready += 1; p.readyIds.push(r.id); }
  }
  return p;
}

/** The next thing to do, in the order a batch goes. */
export function nextStep(p) {
  if (!p.cards) return { key: "empty", text: "This batch has no cards in it yet — add an export." };
  if (p.unpriced) return { key: "price", text: `${p.unpriced} card${p.unpriced === 1 ? " hasn't" : "s haven't"} been priced yet.`, button: `£ Price ${p.unpriced} card${p.unpriced === 1 ? "" : "s"}` };
  if (p.queued) return { key: "wait", text: `${p.queued} card${p.queued === 1 ? " is" : "s are"} in the pricing queue — prices fill in here as they arrive. You can close this tab.` };
  if (p.needsPrice) return { key: "needsprice", text: `${p.needsPrice} card${p.needsPrice === 1 ? "" : "s"} found no usable price. Type one, or leave the card out.`, button: `Show ${p.needsPrice} without a price` };
  if (p.check) return { key: "thin", text: `${p.check} price${p.check === 1 ? " is" : "s are"} on thin evidence — worth a look (🔍 see sales) before listing.`, button: `Check ${p.check}`, also: p.ready ? `List the ${p.ready} ready` : null };
  if (p.failed) return { key: "failed", text: `${p.failed} card${p.failed === 1 ? "" : "s"} failed to list.`, button: `Show ${p.failed} failed` };
  if (p.ready) return { key: "list", text: `${p.ready} card${p.ready === 1 ? " is" : "s are"} priced and ready.`, button: `List ${p.ready} on eBay` };
  if (p.sending) return { key: "sending", text: `${p.sending} card${p.sending === 1 ? " is" : "s are"} listing on eBay now — on the server, so you can leave.` };
  return { key: "done", text: "Everything in this batch is listed. ✓" };
}

export const BATCH_SORTS = [["newest", "Newest"], ["oldest", "Oldest"], ["value", "Value, highest"], ["name", "Name"], ["cards", "Most cards"]];
export const BATCH_STAGES = [["", "Any stage"], ["pricing-needed", "Needs pricing"], ["ready", "Ready to list"], ["listing", "Part listed"], ["listed", "All listed"]];

/** Search (name, file, kind), stage and language, then sort. Never changes the list given. */
export function viewBatches(batches, { q = "", stage = "", language = "", sort = "newest", pricingIds = new Set() } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const out = (batches || []).filter((b) => {
    if (language && b.language !== language) return false;
    if (stage && batchStage(b, { pricing: pricingIds.has(b.id) }).key !== stage) return false;
    if (!words.length) return true;
    const hay = [b.name, batchKind(b), ...(b.files || [])].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const by = {
    newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
    oldest: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
    value: (a, b) => (b.value_pence || 0) - (a.value_pence || 0),
    name: (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }),
    cards: (a, b) => (b.card_count || 0) - (a.card_count || 0)
  }[sort] || (() => 0);
  return [...out].sort(by);
}

/** The line over the grid: "12 batches · 600 cards · 410 listed · £1,240 total · £880 listed". */
export function batchesTotals(batches) {
  const t = { batches: 0, cards: 0, listed: 0, value: 0, listedValue: 0 };
  for (const b of batches || []) {
    t.batches += 1;
    t.cards += b.card_count || 0;
    t.listed += b.listed_count || 0;
    t.value += b.value_pence || 0;
    t.listedValue += b.listed_value_pence || 0;
  }
  return t;
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
    const read = () => sb.from(TABLE).select(listColumns()).order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(500);
    let { data, error } = await read();
    if (error && !tilesMissing && isMissingTileColumn(error)) { tilesMissing = true; ({ data, error } = await read()); }
    if (error) return fail(error);
    return { ok: true, batches: data || [], tiles: !tilesMissing };
  } catch (e) { return fail(e); }
}

/** One batch with its rows. */
export async function loadLabBatch(sb, id) {
  try {
    const read = () => sb.from(TABLE).select(`${listColumns()},rows`).eq("id", id).maybeSingle();
    let { data, error } = await read();
    if (error && !tilesMissing && isMissingTileColumn(error)) { tilesMissing = true; ({ data, error } = await read()); }
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
    const full = { user_id: user.id, name: String(name || defaultBatchName([], at)).slice(0, 120), rows: rows || [], rev: 0, created_at: iso, updated_at: iso, ...batchSummary(rows) };
    const insert = () => sb.from(TABLE).insert(tilesMissing ? withoutTiles(full) : full).select(listColumns()).single();
    let { data, error } = await insert();
    if (error && !tilesMissing && isMissingTileColumn(error)) { tilesMissing = true; ({ data, error } = await insert()); }
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
    const full = { rows: rows || [], rev: rev + 1, updated_at: new Date(at).toISOString(), ...batchSummary(rows) };
    const update = () => sb.from(TABLE).update(tilesMissing ? withoutTiles(full) : full).eq("id", id).eq("rev", rev).select("id,rev");
    let { data, error } = await update();
    if (error && !tilesMissing && isMissingTileColumn(error)) { tilesMissing = true; ({ data, error } = await update()); }
    if (error) return fail(error);
    if (!data || data.length === 0) return { ok: false, conflict: true };
    return { ok: true, rev: data[0].rev };
  } catch (e) { return fail(e); }
}

/**
 * Fill in a tile for a batch saved before migration 049 — its cover, value
 * and counts are only written on a save, and a batch nobody has touched since
 * would show "no scan" and £0.00 for ever. Reads the rows once, writes only the
 * columns read OFF them (never the rows, never the rev), so it cannot clash
 * with a tab saving the batch. A batch with no scan at all is written "" so it
 * isn't asked again on every visit. `{ ok, tile }` — the new tile fields.
 */
export async function refreshTile(sb, id) {
  if (tilesMissing) return { ok: false, missing: true };
  try {
    const { data, error } = await sb.from(TABLE).select("id,rows").eq("id", id).maybeSingle();
    if (error) return fail(error);
    if (!data) return { ok: false, notFound: true };
    const { files, ...summary } = batchSummary(Array.isArray(data.rows) ? data.rows : []);
    const tile = { ...summary, files, cover_url: summary.cover_url || "" };
    const up = await sb.from(TABLE).update(tile).eq("id", id);
    if (up.error) {
      if (isMissingTileColumn(up.error)) tilesMissing = true;
      return fail(up.error);
    }
    return { ok: true, tile };
  } catch (e) { return fail(e); }
}

/** The batches whose tiles were never filled in (saved before 049). */
export function tilesToFill(batches, limit = 40) {
  return (batches || []).filter((b) => b.cover_url == null && (b.card_count || 0) > 0).slice(0, limit);
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
