/**
 * Comp Finder — the audit trail for ✓ Check stack.
 *
 * One row per SAVED check (a check that found nothing to change included):
 * which stack, when, who, how far it got and what it changed. Append-only —
 * migration 038 grants no UPDATE, because a trail that can be edited in place
 * is not one.
 *
 * `stack_checks` (migration 038) is named in THIS FILE ONLY, and every call
 * degrades rather than throws: until 038 is run a check still saves the
 * stack's order exactly as before, and the screen says it was not logged.
 *
 * Framework-free apart from the Supabase client it is handed, so
 * scripts/check-stackcheck.mjs can load it under bare node.
 */

export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || /stack_checks|does not exist|schema cache/i.test(msg);
}

/** Who is signed in, as a person would write it: their name, else their email. */
export function checkerName(user) {
  const m = user?.user_metadata || {};
  const name = String(m.full_name || m.name || "").trim();
  return name || String(user?.email || "").trim() || null;
}

/**
 * The row a check writes, built key by key from the stack, the check's
 * summary and the save plan. Pure, so the check script can pin it.
 */
export function checkRecord({ stack, session, summary, plan, user, at = new Date() }) {
  const total = session?.order?.length || 0;
  const checked = Math.min(session?.cursor || 0, total);
  const pulled = plan?.pulls?.length || 0;
  return {
    user_id: user?.id ?? null,
    stack_id: stack?.id ?? null,
    stack_name: String(stack?.name || "").trim() || "(unnamed stack)",
    checked_at: new Date(at).toISOString(),
    checked_by: checkerName(user),
    cards_total: total,
    cards_checked: checked,
    moved: plan?.updates?.length || 0,
    added: plan?.inserts?.length || 0,
    pulled,
    missing_kept: Math.max(0, (session?.missing?.length || 0) - pulled),
    complete: checked >= total
  };
}

/** Write one check. `{ ok }`, `{ ok: false, missing: true }` before 038, or `{ ok: false, error }`. */
export async function recordStackCheck(sb, args) {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };
    const row = checkRecord({ ...args, user });
    const { error } = await sb.from("stack_checks").insert(row);
    if (error) return isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error.message };
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** The latest checks of one stack, newest first. `{ ok, rows }` or a failure as above. */
export async function loadStackChecks(sb, stackId, limit = 20) {
  if (!stackId) return { ok: true, rows: [] };
  try {
    const { data, error } = await sb
      .from("stack_checks")
      .select("id,stack_id,stack_name,checked_at,checked_by,cards_total,cards_checked,moved,added,pulled,missing_kept,complete")
      .eq("stack_id", stackId)
      .order("checked_at", { ascending: false })
      .limit(limit);
    if (error) return isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error.message };
    return { ok: true, rows: data || [] };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** The most recent check of every stack: Map stack_id → row. */
export async function loadLastChecks(sb) {
  try {
    const { data, error } = await sb
      .from("stack_checks")
      .select("id,stack_id,checked_at,checked_by,complete")
      .order("checked_at", { ascending: false })
      .limit(2000);
    if (error) return isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error.message };
    const last = new Map();
    for (const r of data || []) if (r.stack_id && !last.has(r.stack_id)) last.set(r.stack_id, r);
    return { ok: true, last };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** "23 Nov 2026" — the date a person writes on a stack, not a timestamp. */
export function checkDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line for a check: what it did, in words. */
export function checkLine(r) {
  const bits = [];
  if (!r.complete) bits.push(`stopped at ${r.cards_checked} of ${r.cards_total}`);
  else bits.push(`${r.cards_total} card${r.cards_total === 1 ? "" : "s"}`);
  const changes = [
    r.moved ? `${r.moved} moved` : null,
    r.added ? `${r.added} added` : null,
    r.pulled ? `${r.pulled} pulled` : null,
    r.missing_kept ? `${r.missing_kept} not found, sent to the back` : null
  ].filter(Boolean);
  bits.push(changes.length ? changes.join(", ") : "matched the app");
  return bits.join(" · ");
}
