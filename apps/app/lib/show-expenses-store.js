/**
 * What a show cost to do — table fee, travel, a hotel — so Show history can
 * say what a show MADE rather than what its cards made.
 *
 * `show_expenses` (migration 030) is named in THIS FILE ONLY, the same rule
 * wants-store.js and batch-store.js follow: one place to update, and one
 * place a pending migration is recognised.
 *
 * **Every call degrades rather than throws.** Until 030 is run each function
 * returns `{ ok: false, missing: true }`, and Show history carries on with
 * gross profit and a line saying costs need the migration.
 *
 * Framework-free apart from the Supabase client it is handed.
 */

/** What a cost can be. The key is stored; the label is shown. */
export const EXPENSE_CATEGORIES = [
  { key: "table", label: "Table fee" },
  { key: "travel", label: "Travel" },
  { key: "stay", label: "Accommodation" },
  { key: "food", label: "Food" },
  { key: "other", label: "Other" }
];

export function categoryLabel(key) {
  return (EXPENSE_CATEGORIES.find((c) => c.key === key) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]).label;
}

/** Does this error mean "migration 030 hasn't been run"? */
export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || /show_expenses|does not exist|schema cache/i.test(msg);
}

/**
 * "£45", "45.50", "45" -> pence. Refuses zero, negatives and junk rather than
 * guessing: a cost typed wrong silently becomes a profit reported wrong.
 */
export function parseExpensePence(raw) {
  const cleaned = String(raw ?? "").replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const pence = Math.round(Number(cleaned) * 100);
  return pence > 0 ? pence : null;
}

/** Every cost, oldest first. */
export async function loadExpenses(sb) {
  try {
    const { data, error } = await sb
      .from("show_expenses")
      .select("id,show_key,show_label,category,amount_pence,note,created_at")
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true, rows: [] };
      return { ok: false, error: error.message, rows: [] };
    }
    return { ok: true, rows: data || [] };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true, rows: [] };
    return { ok: false, error: err?.message || "Could not read show costs.", rows: [] };
  }
}

/** Record one cost against a show. `showKey` is `showOf(row).key`. */
export async function addExpense(sb, { showKey, showLabel = "", category = "other", pence, note = "" } = {}) {
  if (!showKey) return { ok: false, error: "No show to add a cost to." };
  if (!Number.isInteger(pence) || pence <= 0) return { ok: false, error: "Enter an amount in pounds, e.g. 45 or 12.50." };
  const cat = EXPENSE_CATEGORIES.some((c) => c.key === category) ? category : "other";
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };
    const { data, error } = await sb
      .from("show_expenses")
      .insert({
        user_id: user.id,
        show_key: showKey,
        show_label: String(showLabel || "").trim() || null,
        category: cat,
        amount_pence: pence,
        note: String(note || "").trim() || null
      })
      .select("id,show_key,show_label,category,amount_pence,note,created_at")
      .single();
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }
    return { ok: true, row: data };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true };
    return { ok: false, error: err?.message || "Could not save that cost." };
  }
}

/** Remove one — a mistyped cost should be one tap to undo. */
export async function deleteExpense(sb, id) {
  if (!id) return { ok: false, error: "No cost to remove." };
  try {
    const { error } = await sb.from("show_expenses").delete().eq("id", id);
    if (error) {
      if (isMissingTable(error)) return { ok: false, missing: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, missing: true };
    return { ok: false, error: err?.message || "Could not remove that cost." };
  }
}
