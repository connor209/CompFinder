/**
 * What the pull sheet reads from `stack_cards`, and nothing more.
 *
 * It used to read EVERY stack card ever made, pulled ones included, every
 * column — thousands of rows a thousand at a time, one page after another,
 * after waiting for eBay. Two reads replace it:
 *
 * 1. The SHELF: every card not yet pulled. All of them, because a card's
 *    position is its rank among every card still in its stack, and the
 *    matcher's queues are built from them. Started alongside the eBay call.
 * 2. The PULLED cards the open orders can mention, once the orders are in:
 *      - a SKU on an order line, or one CardUploader's pick file chose —
 *        "this SKU is pulled ⇒ the line is done" (before migration 037), the
 *        card in your hand on Pack, and cuChoiceReport's "known" SKUs;
 *      - `pulled_line` naming an open line (037) — what makes a committed
 *        line stay done on reload;
 *      - `listing_sku` sharing a CardUploader key on an open line — the
 *        difference between "every copy is already pulled" and "not on your
 *        stacks";
 *      - `reserved_line` naming an open line's unit (042) — a lab sale
 *        already picked.
 *    Every rule that reads a pulled card asks one of those four questions,
 *    so nothing it asks about is left out.
 *
 * Named columns, so the bulky ones (scans, Cardmarket data) stay on the
 * server. A database that predates a column (027's copy_seq was missing on
 * the live database until 2026-11-24) rejects the whole select, so each read
 * falls back to `*` rather than returning nothing — an empty shelf would turn
 * every pick into a loose one.
 */
import { listingSkuKey, isCuListingSku } from "./cu-files.js";

export const SHEET_COLUMNS = [
  "id", "stack_id", "position", "sku", "title", "added_at", "pulled_at", "pulled_line", "checked_out_at",
  "listing_sku", "copy_seq", "lab_listing_id", "reserved_line", "reserved_mismatch"
].join(",");

const PAGE = 1000;
const CHUNK = 150;

/** Every page of one query, in a total order; the error is RETURNED, never swallowed. */
async function readPaged(build) {
  let rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { error };
    rows = rows.concat(data || []);
    if (!data || data.length < PAGE) return { data: rows };
  }
}

/** Named columns first; `*` if the database doesn't have one of them yet. */
async function readWithFallback(sb, narrow) {
  const named = await readPaged(() => narrow(sb.from("stack_cards").select(SHEET_COLUMNS)));
  if (!named.error) return named;
  return readPaged(() => narrow(sb.from("stack_cards").select("*")));
}

/** 1. Every card still on a shelf (or away at a show — the sheet names those too). */
export function readShelfCards(sb) {
  return readWithFallback(sb, (q) => q.is("pulled_at", null));
}

/**
 * Which pulled cards the open lines can ask about. Pure, so the check can pin
 * it: anything a rule reads that isn't asked for here is a card the sheet
 * will treat as never having existed.
 */
export function pulledQueryPlan(lines, cuChoice = null) {
  const skus = new Set();
  const lineIds = new Set();
  const unitKeys = new Set();
  const cuKeys = new Set();
  const addSku = (s) => {
    const v = String(s || "").trim();
    if (!v) return;
    // .in() is exact; the sheet compares SKUs case-insensitively. A SKU is
    // written one way in practice, so the spellings worth asking for are as
    // given, upper and lower.
    skus.add(v); skus.add(v.toUpperCase()); skus.add(v.toLowerCase());
  };
  const orderIds = new Set();
  for (const l of lines || []) {
    if (l.sku) addSku(l.sku);
    if (l.sku && isCuListingSku(l.sku)) cuKeys.add(listingSkuKey(l.sku));
    if (l.lineItemId) {
      lineIds.add(String(l.lineItemId));
      const n = Math.max(1, Number(l.quantity) || 1);
      for (let u = 1; u <= n; u++) unitKeys.add(`${l.lineItemId}#${u}`);
    }
    if (l.orderId) orderIds.add(String(l.orderId));
  }
  if (cuChoice) for (const [oid, list] of cuChoice) if (orderIds.has(String(oid))) for (const s of list) addSku(s);
  return { skus: [...skus], lineIds: [...lineIds], unitKeys: [...unitKeys], cuKeys: [...cuKeys] };
}

/** 2. The pulled cards those lines can mention, read in parallel, de-duplicated. */
export async function readPulledFor(sb, lines, cuChoice) {
  const plan = pulledQueryPlan(lines, cuChoice);
  const chunks = (list) => { const out = []; for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK)); return out; };
  const pulled = (q) => q.not("pulled_at", "is", null);
  const jobs = [
    ...chunks(plan.skus).map((c) => readWithFallback(sb, (q) => pulled(q).in("sku", c))),
    // A missing column (before 037 or 042) is an error here, and means no
    // card can carry that value — so it reads as nothing found, not a failure.
    // Through the same fallback: a database missing copy_seq must still find
    // its pulled_line cards, not lose them to an unrelated column.
    ...chunks(plan.lineIds).map((c) => readWithFallback(sb, (q) => pulled(q).in("pulled_line", c)).then(orNothing)),
    ...chunks(plan.unitKeys).map((c) => readWithFallback(sb, (q) => pulled(q).in("reserved_line", c)).then(orNothing)),
    // CardUploader keys are letters and digits only (CS-P3NSJY), so they are
    // safe inside an or() of prefix matches; the stored SKU may carry a suffix.
    ...chunks(plan.cuKeys.filter((k) => /^cs-[a-z0-9]+$/i.test(k))).map((c) =>
      readWithFallback(sb, (q) => pulled(q).or(c.map((k) => `listing_sku.ilike.${k}%`).join(","))).then(orNothing))
  ];
  const results = await Promise.all(jobs);
  const failed = results.find((r) => r.error);
  if (failed) return { error: failed.error };
  const byId = new Map();
  for (const r of results) for (const c of r.data || []) byId.set(c.id, c);
  return { data: [...byId.values()] };
}

function orNothing(r) {
  if (r.error && /column|schema cache|does not exist/i.test(r.error.message || "")) return { data: [] };
  return r;
}
