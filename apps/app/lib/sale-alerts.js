import { assignPulls } from "./pullmatch.js";
import { liveRanks, stackDepths, positionLabel } from "./stackpos.js";
import { isUnorderedStack } from "./toploader.js";

/**
 * Discord alerts for new eBay orders, with where each card is.
 *
 * `/api/cron/sale-alerts` runs this every ten minutes (a GitHub Action calls
 * it — Vercel's free plan only schedules once a day). eBay's own "you've
 * sold" email already says WHAT sold; the reason to build this is the one
 * thing nothing else can say: which stack and how deep. That comes from the
 * pull sheet's own reading (`assignPulls()`, then `liveRanks()`), run over
 * EVERY open order and not just the new one, so the copy named here is the
 * copy the pull sheet will name — a variation's front-most copy, not one an
 * older order has already claimed.
 *
 * `sale_alerts` (migration 038) is named in this file only. It is the whole
 * memory of what was said:
 *
 * - **Posted, then recorded.** A post that fails is not recorded and goes out
 *   on the next run. The other order loses an alert for good on one failed
 *   request, and a missed sale is worse than a repeated one.
 * - **No table, no posts.** Before 038 every run would announce every open
 *   order again, every ten minutes. It refuses and says why.
 * - **The first run announces nothing old.** Turning this on with forty open
 *   orders must not post forty messages: the orders already open are recorded
 *   silently and one line says how many.
 * - **The buyer is their eBay username, never a name or address.** A Discord
 *   channel is one invite link from somebody it was not meant for.
 */

const TABLE = "sale_alerts";
/** Discord refuses content over 2000 characters; leave room. */
const CHUNK = 1900;
/** Lines listed per order before "and N more". */
const MAX_LINES = 12;

export function isMissingAlertsTable(err) {
  const msg = String(err?.message || err || "");
  return err?.code === "42P01" || (/sale_alerts/.test(msg) && /does not exist|schema cache|relation/i.test(msg));
}

/** Discord markdown off, so a title like "*Holo*" or "Mr_Mime" prints as written. */
export function plain(s) {
  return String(s ?? "").replace(/([\\*_~`|>#])/g, "\\$1").replace(/\s+/g, " ").trim();
}

function money(v, currency) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const sym = !currency || currency === "GBP" ? "£" : `${currency} `;
  return `${sym}${Number(v).toFixed(2)}`;
}

/**
 * The pull sheet's walk order (its stackWalkCompare): A … Z, then AA, shorter
 * names first, the toploader box and Show Binders last. The same order is
 * what makes "front-most copy" here the copy the sheet will name.
 */
export function walkCompare(a, b) {
  const na = String(a || "").trim();
  const nb = String(b || "").trim();
  const ua = isUnorderedStack(na);
  const ub = isUnorderedStack(nb);
  if (ua !== ub) return ua ? 1 : -1;
  const la = /^[A-Za-z]+$/.test(na);
  const lb = /^[A-Za-z]+$/.test(nb);
  if (la && lb && na.length !== nb.length) return na.length - nb.length;
  return na.localeCompare(nb, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Where a card is, in words, or why there is no answer. `unit` is one entry
 * of assignPulls(); `ranks`/`depths` are liveRanks()/stackDepths() over the
 * same cards.
 */
export function whereText(unit, { stackNameOf, ranks, depths }) {
  const c = unit?.card;
  if (unit?.done) return "already pulled";
  if (!c) {
    if (unit?.reason === "notstacked") return "not on a stack — upload CardUploader's inventory";
    if (unit?.reason === "nocopyleft") return "every copy is pulled or away";
    return "loose pick";
  }
  const name = stackNameOf(c.stack_id);
  const label = positionLabel(name, ranks.get(c.id) ?? null, depths.get(c.stack_id) ?? null, c.position);
  return unit.via === "variation" ? `${label} (front-most copy)` : label;
}

/**
 * The text for each new order. Pure: `lines` is every open order line (as
 * fetchPendingOrders returns them), `alerted` the order ids already
 * announced. Returns `[{ orderId, text }]`, oldest order first.
 */
export function alertMessages({ lines, alerted, cards, stackNames }) {
  const stackNameOf = (id) => stackNames.get(id) || "";
  const { units } = assignPulls(lines, cards, { walkCompare, stackNameOf });
  const ranks = liveRanks(cards);
  const depths = stackDepths(cards);
  const byOrder = new Map();
  for (const l of lines || []) {
    const oid = String(l.orderId || "");
    if (!oid || alerted.has(oid)) continue;
    if (!byOrder.has(oid)) byOrder.set(oid, { orderId: oid, buyer: l.buyer || null, date: l.orderDate || "", lines: [] });
    byOrder.get(oid).lines.push(l);
  }
  const unitsByLine = new Map();
  for (const u of units) {
    const k = String(u.line.lineItemId);
    if (!unitsByLine.has(k)) unitsByLine.set(k, []);
    unitsByLine.get(k).push(u);
  }
  const out = [];
  for (const o of [...byOrder.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    let total = 0;
    let priced = true;
    let currency = null;
    let cardsCount = 0;
    const rows = [];
    for (const l of o.lines) {
      const qty = Math.max(1, Number(l.quantity) || 1);
      cardsCount += qty;
      if (l.price == null) priced = false;
      else total += Number(l.price);
      currency = currency || l.currency;
      const each = l.price != null ? money(Number(l.price) / qty, l.currency) : null;
      for (const u of unitsByLine.get(String(l.lineItemId)) || []) {
        const name = plain(l.variation ? `${l.variation}` : l.title) || plain(l.sku) || "a card";
        rows.push(`• ${name}${each ? ` — ${each}` : ""} · **${plain(whereText(u, { stackNameOf, ranks, depths }))}**`);
      }
    }
    const head = `💷 **${priced ? money(total, currency) : "Sold"}** · ${cardsCount} card${cardsCount === 1 ? "" : "s"}${o.buyer ? ` for ${plain(o.buyer)}` : ""} · order ${plain(o.orderId)}`;
    const shown = rows.slice(0, MAX_LINES);
    if (rows.length > MAX_LINES) shown.push(`…and ${rows.length - MAX_LINES} more`);
    out.push({ orderId: o.orderId, text: [head, ...shown].join("\n") });
  }
  return out;
}

/** Messages packed into posts under Discord's limit, never splitting one order. */
export function packPosts(messages) {
  const posts = [];
  let cur = { text: "", orderIds: [] };
  for (const m of messages) {
    const text = m.text.length > CHUNK ? `${m.text.slice(0, CHUNK - 1)}…` : m.text;
    if (cur.text && cur.text.length + 2 + text.length > CHUNK) {
      posts.push(cur);
      cur = { text: "", orderIds: [] };
    }
    cur.text = cur.text ? `${cur.text}\n\n${text}` : text;
    cur.orderIds.push(m.orderId);
  }
  if (cur.text) posts.push(cur);
  return posts;
}

/** One webhook post. Mentions are switched off: a card title is not a ping. */
export async function postToDiscord(webhookUrl, content, fetchImpl = fetch) {
  const send = () => fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
  });
  let res = await send();
  if (res.status === 429) {
    let wait = 2000;
    try { wait = Math.min(10_000, Math.ceil(Number((await res.json()).retry_after || 2) * 1000)); } catch { /* default */ }
    await new Promise((r) => setTimeout(r, wait));
    res = await send();
  }
  if (!res.ok) throw new Error(`Discord answered ${res.status}.`);
}

async function readAll(makeQuery, pageSize = 1000) {
  let from = 0;
  let all = [];
  for (;;) {
    const { data, error } = await makeQuery().order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || "Read failed.");
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * One account's run. `lines` are its open order lines. Every read names
 * `user_id` by hand: the cron has no RLS behind it.
 *
 * Returns { ok, posted, orders, seeded, missing?, error? }.
 */
export async function runSaleAlerts(sb, userId, { lines, webhookUrl, post = postToDiscord }) {
  const orderIds = [...new Set((lines || []).map((l) => String(l.orderId || "")).filter(Boolean))];

  // First run for this account: nothing has ever been recorded. Record what
  // is open now without announcing it.
  const { data: any, error: anyErr } = await sb.from(TABLE).select("order_id").eq("user_id", userId).limit(1);
  if (anyErr) return isMissingAlertsTable(anyErr) ? { ok: false, missing: true } : { ok: false, error: anyErr.message };
  if (!any?.length) {
    // An empty list still leaves a marker, so the next run is not a "first
    // run" that swallows the first real sale.
    const seed = (orderIds.length ? orderIds : ["__start__"]).map((order_id) => ({ user_id: userId, order_id }));
    const { error: insErr } = await sb.from(TABLE).upsert(seed, { onConflict: "user_id,order_id", ignoreDuplicates: true });
    if (insErr) return { ok: false, error: insErr.message };
    await post(webhookUrl, `🔔 Sale alerts are on. ${orderIds.length} order${orderIds.length === 1 ? " was" : "s were"} already open and won't be announced — new sales from here on will be.`);
    return { ok: true, posted: 0, orders: 0, seeded: orderIds.length };
  }
  if (!orderIds.length) return { ok: true, posted: 0, orders: 0, seeded: 0 };

  const alerted = new Set();
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data: rows, error } = await sb.from(TABLE).select("order_id").eq("user_id", userId).in("order_id", orderIds.slice(i, i + 200));
    if (error) return { ok: false, error: error.message };
    for (const r of rows || []) alerted.add(String(r.order_id));
  }

  const fresh = orderIds.filter((id) => !alerted.has(id));
  if (!fresh.length) return { ok: true, posted: 0, orders: 0, seeded: 0 };

  const cards = await readAll(() => sb.from("stack_cards").select("*").eq("user_id", userId));
  const { data: stacks, error: stErr } = await sb.from("card_stacks").select("id,name").eq("user_id", userId);
  if (stErr) return { ok: false, error: stErr.message };
  const stackNames = new Map((stacks || []).map((s) => [s.id, s.name]));

  const messages = alertMessages({ lines, alerted, cards, stackNames });
  let posted = 0;
  let orders = 0;
  for (const p of packPosts(messages)) {
    try {
      await post(webhookUrl, p.text);
    } catch (e) {
      // Not recorded, so it goes out next run.
      return { ok: false, posted, orders, seeded: 0, error: e?.message || String(e) };
    }
    posted += 1;
    const { error: recErr } = await sb.from(TABLE).upsert(p.orderIds.map((order_id) => ({ user_id: userId, order_id })), { onConflict: "user_id,order_id", ignoreDuplicates: true });
    if (recErr) return { ok: false, posted, orders, seeded: 0, error: `Posted, but couldn't record it — it may post again: ${recErr.message}` };
    orders += p.orderIds.length;
  }
  return { ok: true, posted, orders, seeded: 0 };
}
