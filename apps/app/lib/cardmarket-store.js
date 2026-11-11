/**
 * The only file that reads or writes `stack_cards.cm` (migration 035).
 *
 * The rules are in cardmarket.js; this is I/O. Every read and write names
 * `user_id` by hand, the same as stack-import.js, so it is correct with the
 * browser client and would stay correct under a service-role one.
 */
import { isCardmarketStack, cmFields, cmTitle } from "./cardmarket.js";

const looksMissing = (error) => /\bcm\b|column|schema cache/i.test(error?.message || "");

/**
 * The Cardmarket dividers and every card in them, pulled cards included —
 * matchOrders needs those to know which orders were already picked.
 * Returns { stacks, cards, missing, error }.
 */
export async function loadCardmarket(sb, userId) {
  const probe = await sb.from("stack_cards").select("id,cm").limit(0);
  if (probe.error) return { stacks: [], cards: [], missing: looksMissing(probe.error), error: probe.error.message };

  const { data: all, error: stErr } = await sb.from("card_stacks").select("id,name").eq("user_id", userId);
  if (stErr) return { stacks: [], cards: [], missing: false, error: stErr.message };
  const stacks = (all || []).filter(isCardmarketStack);
  if (stacks.length === 0) return { stacks, cards: [], missing: false, error: null };

  // Paged in a total order (see check-pagedselect.mjs): a short read here
  // reads as cards that are not in the box.
  const ids = stacks.map((s) => s.id);
  const cards = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("stack_cards")
      .select("*")
      .eq("user_id", userId)
      .in("stack_id", ids)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) return { stacks, cards: [], missing: false, error: error.message };
    cards.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { stacks, cards, missing: false, error: null };
}

/** Has a file with this fingerprint been loaded before? */
export function alreadyLoaded(cards, fingerprint) {
  return (cards || []).some((c) => c.cm?.file === fingerprint);
}

/**
 * Write a planned load: one stack per divider, then its cards. A divider whose
 * cards fail to insert is deleted again, so a half-written divider never
 * looks like a short one. Returns { loaded, failed: [names], error }.
 */
export async function writeLoad(sb, userId, plan, fingerprint) {
  let loaded = 0;
  const failed = [];
  for (const d of plan.dividers) {
    const { data: st, error } = await sb.from("card_stacks").insert({ user_id: userId, name: d.name }).select("id").single();
    if (error || !st) { failed.push(d.name); continue; }
    const rows = d.cards.map((c) => ({
      user_id: userId,
      stack_id: st.id,
      position: c.position,
      sku: c.sku,
      title: cmTitle(c),
      cm: cmFields(c, fingerprint)
    }));
    const { error: insErr } = await sb.from("stack_cards").insert(rows);
    if (insErr) {
      await sb.from("card_stacks").delete().eq("id", st.id).eq("user_id", userId);
      failed.push(d.name);
      if (looksMissing(insErr)) return { loaded, failed, error: "Run migration 035_cardmarket_stock.sql first." };
      continue;
    }
    loaded += rows.length;
  }
  return { loaded, failed, error: null };
}

/**
 * Mark picked cards pulled, each carrying the order it went to.
 * `writes` is [{ id, cm }]. Returns { done, failed }.
 */
export async function commitPicks(sb, userId, writes) {
  const at = new Date().toISOString();
  let done = 0;
  let failed = 0;
  for (const w of writes) {
    const { error } = await sb
      .from("stack_cards")
      .update({ pulled_at: at, cm: w.cm })
      .eq("id", w.id)
      .eq("user_id", userId)
      .is("pulled_at", null);
    if (error) failed += 1;
    else done += 1;
  }
  return { done, failed };
}

// ── prices (migration 036) ───────────────────────────────────────────────────

const pricesMissing = (error) => /cardmarket_prices|does not exist|schema cache/i.test(error?.message || "");

/**
 * Every saved price, as Map<article_key, { price, priced_at }>.
 * Returns { prices, missing, error }: a pending migration is `missing`, and
 * the stock list then shows every card unpriced and says why — never an empty
 * box.
 */
export async function loadPrices(sb, userId) {
  const prices = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("cardmarket_prices")
      .select("article_key,price,priced_at")
      .eq("user_id", userId)
      .order("article_key", { ascending: true })
      .range(from, from + 999);
    if (error) return { prices: new Map(), missing: pricesMissing(error), error: error.message };
    for (const r of data || []) prices.set(r.article_key, { price: Number(r.price), priced_at: r.priced_at });
    if (!data || data.length < 1000) break;
  }
  return { prices, missing: false, error: null };
}

/** Upsert prices from a TCG PowerTools export. Returns { saved, error }. */
export async function savePrices(sb, userId, rows) {
  const at = new Date().toISOString();
  const all = (rows || []).map((r) => ({ user_id: userId, article_key: r.article_key, price: r.price, priced_at: at }));
  let saved = 0;
  for (let i = 0; i < all.length; i += 500) {
    const { error } = await sb.from("cardmarket_prices").upsert(all.slice(i, i + 500), { onConflict: "user_id,article_key" });
    if (error) return { saved, error: pricesMissing(error) ? "Run migration 036_cardmarket_prices.sql first." : error.message };
    saved += Math.min(500, all.length - i);
  }
  return { saved, error: null };
}
