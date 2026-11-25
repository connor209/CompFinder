/**
 * Where your rules for a card are kept (migration 050). `card_price_rules` is
 * named in THIS FILE ONLY, and every call degrades: before 050 nothing is
 * read, and a rule saved on screen still applies to the batch it was made in.
 * What a rule means is lib/price-rules.js.
 *
 * Takes the client it is handed and names user_id by hand, because the
 * pricing worker reads with the service-role key.
 */
import { normaliseRule, rulesByKey, isEmptyRule } from "./price-rules.js";

const TABLE = "card_price_rules";

export function isMissingTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || err?.code === "PGRST205" || /card_price_rules|does not exist|schema cache/i.test(msg);
}
const fail = (error) => (isMissingTable(error) ? { ok: false, missing: true } : { ok: false, error: error?.message || String(error) });

/** Every rule of this account: `{ ok, rules: Map key → rule, rows }`. */
export async function listRules(sb, userId) {
  try {
    if (!userId) userId = (await sb.auth.getUser())?.data?.user?.id;
    if (!userId) return { ok: false, error: "Not signed in." };
    const { data, error } = await sb.from(TABLE).select("card_key,label,kinds,words,note,updated_at").eq("user_id", userId).limit(5000);
    if (error) return fail(error);
    return { ok: true, rules: rulesByKey(data), rows: data || [] };
  } catch (e) { return fail(e); }
}

/** The rules a pricing run should apply — an empty Map, never an error, when there are none or 050 isn't run. */
export async function rulesForPricing(sb, userId) {
  const r = await listRules(sb, userId);
  return r.ok ? r.rules : new Map();
}

/** Keep (or replace) the rule for one card. An empty rule removes it. */
export async function saveRule(sb, userId, { key, label, rule }) {
  const clean = normaliseRule(rule);
  try {
    if (!userId) userId = (await sb.auth.getUser())?.data?.user?.id;
    if (!userId) return { ok: false, error: "Not signed in." };
    if (isEmptyRule(clean)) {
      const { error } = await sb.from(TABLE).delete().eq("user_id", userId).eq("card_key", key);
      return error ? fail(error) : { ok: true, removed: true };
    }
    const { error } = await sb.from(TABLE).upsert({
      user_id: userId, card_key: key, label: String(label || "").slice(0, 200) || null,
      kinds: clean.kinds, words: clean.words, note: clean.note || null, updated_at: new Date().toISOString()
    }, { onConflict: "user_id,card_key" });
    return error ? fail(error) : { ok: true, rule: clean };
  } catch (e) { return fail(e); }
}
