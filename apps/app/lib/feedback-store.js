/**
 * Comp Finder — where 👍 / 👎 on a price is kept.
 *
 * `price_feedback` (migration 046) is named in THIS FILE ONLY, and every call
 * degrades rather than throws: until 046 is run the buttons still work on
 * screen and say the vote was not saved. Rules live in price-feedback.js.
 *
 * Takes the Supabase client as an argument, so scripts/check-feedback.mjs can
 * run it against a fake one under bare node.
 */
import { feedbackRecord, verdictsByPosition } from "./price-feedback.js";

export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || /price_feedback|does not exist|schema cache/i.test(msg);
}

/** Write one vote. `{ ok, row }`, `{ ok: false, missing: true }` before 046, or `{ ok: false, error }`. */
export async function recordFeedback(sb, args) {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };
    const row = feedbackRecord({ ...args, userId: user.id });
    const { error } = await sb.from("price_feedback").insert(row);
    if (error) return isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error.message };
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** A saved run's votes: `{ ok, byPosition }` — one read for the whole run, never one per row. */
export async function loadBatchFeedback(sb, batchId) {
  if (!batchId) return { ok: true, byPosition: new Map() };
  try {
    const { data, error } = await sb
      .from("price_feedback")
      .select("id,created_at,verdict,reason,surface,batch_id,batch_position,query")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) return isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error.message };
    return { ok: true, byPosition: verdictsByPosition(data || []) };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
