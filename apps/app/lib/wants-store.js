/**
 * Comp Finder — the want list: what people asked for, including what we didn't
 * have.
 *
 * Recorded because on 2026-08-29 somebody asked "do you have any gengars", the
 * answer happened to be yes, and cards sold that were never on the table. The
 * asks where the answer is NO leave nothing behind at all — no sale, no
 * checkout, no row anywhere — and those are the ones worth money: they are a
 * buying list and a packing list, and they are the only demand signal a show
 * produces. A day of them is unreconstructable the following morning.
 *
 * `show_wants` (migration 026) is named in THIS FILE ONLY, the same rule
 * batch-store.js follows for the saved-run tables and for the same reason: a
 * second place naming the table is a second place to update, and Postgres
 * rejects the whole statement when a column is missing, so the failure lands
 * on a screen rather than in a log.
 *
 * **Every call degrades rather than throws.** Migrations here are applied by
 * hand and the code always ships first, so until 026 is run every function
 * returns `{ ok: false, missing: true }` and the Show Desk keeps working with
 * the want button explaining itself. A desk that white-screens at a show
 * because a migration is pending is a worse outcome than no want list.
 *
 * Framework-free apart from the Supabase client it is handed, so
 * scripts/check-showcounter.mjs can load it under bare node.
 */
import { normalise } from "./showfilter.js";

/** How many wants the desk reads back. A show is a day, not an archive. */
export const WANTS_LIMIT = 200;

/**
 * Does this error mean "migration 026 hasn't been run"?
 *
 * Postgres says `relation "public.show_wants" does not exist`; PostgREST says
 * the schema cache doesn't know it. Either way it is a pending migration and
 * not a bug worth showing a stack trace for.
 */
export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || /show_wants|does not exist|schema cache/i.test(msg);
}

/**
 * The grouping key. Reused from the search box rather than redefined, so
 * "Gengar", "gengar" and "GENGAR VMAX " group the way the same words find the
 * same cards — one definition of "these are the same words" across the desk.
 */
export function normaliseWant(text) {
  return normalise(text);
}

/**
 * Record one ask.
 *
 * `hadMatch` is passed in rather than worked out here because the desk knows
 * it for free: it is whether the search that was on screen at that moment
 * found anything. Working it out later would mean re-running a search against
 * stock that has since changed, which answers a different question.
 */
export async function recordWant(sb, { query, event = "", hadMatch = false, note = "" } = {}) {
  const raw = String(query || "").trim();
  if (!raw) return { ok: false, error: "Nothing to record." };
  const norm = normaliseWant(raw);
  if (!norm) return { ok: false, error: "Nothing to record." };
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };
    const { data, error } = await sb
      .from("show_wants")
      .insert({
        user_id: user.id,
        query: raw,
        query_norm: norm,
        event: String(event || "").trim() || null,
        had_match: Boolean(hadMatch),
        note: String(note || "").trim() || null
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }
    return { ok: true, row: data };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true };
    return { ok: false, error: err?.message || "Could not record that." };
  }
}

/** The recent wants, newest first. */
export async function loadWants(sb, { limit = WANTS_LIMIT } = {}) {
  try {
    const { data, error } = await sb
      .from("show_wants")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true, rows: [] };
      return { ok: false, error: error.message, rows: [] };
    }
    return { ok: true, rows: data || [] };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true, rows: [] };
    return { ok: false, error: err?.message || "Could not read the want list.", rows: [] };
  }
}

/** Remove one — a mis-tap at a busy table should be one tap to undo. */
export async function deleteWant(sb, id) {
  if (!id) return { ok: false, error: "No want to remove." };
  try {
    const { error } = await sb.from("show_wants").delete().eq("id", id);
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true };
    return { ok: false, error: err?.message || "Could not remove that." };
  }
}

/**
 * The wants grouped for reading: one row per thing asked for, commonest first.
 *
 * **Ties break toward the misses**, and ties are common — most things are
 * asked for once. Two cards asked for once each are not equally interesting
 * when we had one and not the other, and the list exists to be acted on with a
 * dealer's float in hand, so the thing to buy sorts above the thing we already
 * stock.
 */
export function wantsSummary(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const key = r?.query_norm || normaliseWant(r?.query);
    if (!key) continue;
    const g = groups.get(key) || { key, query: r.query || key, asks: 0, misses: 0, last: null, ids: [] };
    g.asks += 1;
    if (!r.had_match) g.misses += 1;
    if (r.id) g.ids.push(r.id);
    const at = r.created_at ? Date.parse(r.created_at) : null;
    if (at && (!g.last || at > g.last)) { g.last = at; g.query = r.query || g.query; }
    groups.set(key, g);
  }
  return [...groups.values()].sort(
    (a, b) => b.asks - a.asks || b.misses - a.misses || (b.last || 0) - (a.last || 0)
  );
}
