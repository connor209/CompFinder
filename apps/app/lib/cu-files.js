import { parseCsvText, isCardmarketStack } from "./cardmarket.js";
import { stackFromSku } from "./stackpos.js";

/**
 * CardUploader's two exports, and the one fact that ties them to a stack.
 *
 * CardUploader lists our newer stock as "pick your card" variation listings.
 * Each card still has a LOCATION SKU — IR19, stack IR, card 19 — but eBay is
 * never told it. The variation is sold under CardUploader's own SKU,
 * `CS-P3NSJY_982a1be2`, which names a card in a condition, not a copy: every
 * LP Lapras 36/236 shares it, and one SKU in the first export covered
 * fourteen copies. So an order line names WHICH CARD sold and never which
 * copy, and our stack import could not stack these cards at all, because
 * `stackFromSku()` cannot read a CS- SKU (and must not try).
 *
 * The inventory export holds both halves on one row — `User SKU` (the
 * location) and `eBay SKU` (what a sale reports) — so it is what puts these
 * cards on the stacks. The pick list export holds CardUploader's choice of
 * copy for each line of each order, which is what keeps the copy we pull and
 * the copy CardUploader marks picked the same card.
 *
 * Both are read by column NAME, and each refuses the other's file: they are
 * downloaded from neighbouring pages and look alike from a distance.
 */

/** A CardUploader variation SKU: `CS-P3NSJY`, with or without `_982a1be2`. */
export function isCuListingSku(sku) {
  return /^cs-[a-z0-9]+(?:_[a-z0-9]+)?$/i.test(String(sku || "").trim());
}

/**
 * The key two spellings of one variation SKU share. CardUploader's screen
 * shows `CS-P3NSJY`; its export and eBay carry `CS-P3NSJY_982a1be2`. The part
 * before the underscore is the same in both and identifies the card and
 * condition, so that is what is compared. Any other SKU is compared whole —
 * an underscore in a stack SKU (`A_50`) is part of its name.
 */
export function listingSkuKey(sku) {
  const s = String(sku || "").trim().toLowerCase();
  if (!s) return null;
  return isCuListingSku(s) ? s.replace(/_.*$/, "") : s;
}

function table(text, required, kind, wrongFileHint) {
  const rows = parseCsvText(text, ",");
  if (rows.length === 0) throw new Error(`That file is empty — expected CardUploader's ${kind}.`);
  const header = rows[0].map((h) => String(h || "").trim());
  const at = new Map(header.map((h, i) => [h.toLowerCase(), i]));
  const missing = required.filter((h) => !at.has(h.toLowerCase()));
  if (missing.length) {
    const hint = wrongFileHint(at) ? ` ${wrongFileHint(at)}` : "";
    throw new Error(`That isn't CardUploader's ${kind} — no ${missing.map((m) => `"${m}"`).join(", ")} column.${hint}`);
  }
  const get = (row, name) => {
    const i = at.get(name.toLowerCase());
    return i == null ? "" : String(row[i] ?? "").trim();
  };
  return { body: rows.slice(1), get };
}

/**
 * Is this inventory row a card we still hold? CardUploader keeps a card
 * `listed` until somebody presses Pick, so a card that sold yesterday is
 * still listed today — and it is also still physically in its stack, which
 * is the question here. Only an explicit zero, or a status that says it went,
 * is gone. A missing quantity is silence, never a zero (as isListingAvailable).
 */
export function inventoryRowHeld(row) {
  const q = row?.qty;
  if (q != null && q !== "") {
    const n = Number(q);
    if (Number.isFinite(n) && n <= 0) return false;
  }
  return !/sold|archiv|delet|remov/i.test(String(row?.status || ""));
}

/** Rows of the inventory export: { userSku, listingSku, title, condition, qty, status, image }. */
export function parseInventoryCsv(text) {
  const { body, get } = table(text, ["User SKU", "eBay SKU", "Title"], "inventory export", (at) =>
    at.has("order id") ? "This looks like the pick list — upload that on the Pull sheet." : ""
  );
  return body.map((r) => ({
    userSku: get(r, "User SKU"),
    listingSku: get(r, "eBay SKU"),
    title: get(r, "Title"),
    condition: get(r, "Condition"),
    qty: get(r, "Qty"),
    status: get(r, "Status"),
    image: get(r, "Image URLs").split("|").map((u) => u.trim()).filter(Boolean)[0] || null
  }));
}

/** Rows of the pick list export: { orderId, sku, status, card }. */
export function parsePickListCsv(text) {
  const { body, get } = table(text, ["SKU", "Order ID"], "pick list export", (at) =>
    at.has("user sku") ? "This looks like the inventory export — upload that on Stacks." : ""
  );
  return body.map((r) => ({
    orderId: get(r, "Order ID"),
    sku: get(r, "SKU"),
    status: get(r, "Status"),
    card: get(r, "Card")
  }));
}

/**
 * CardUploader's choices, by order: orderId → [location SKU, lowercased], in
 * the file's order. A row CardUploader could not match ("no inventory") has no
 * SKU and chooses nothing — that line stays a loose pick here too.
 */
export function cuChoiceIndex(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const oid = String(r?.orderId || "").trim();
    const sku = String(r?.sku || "").trim().toLowerCase();
    if (!oid || !sku || /no inventory/i.test(String(r?.status || ""))) continue;
    if (!out.has(oid)) out.set(oid, []);
    out.get(oid).push(sku);
  }
  return out;
}

/**
 * What an inventory upload would do. Pure; no I/O.
 *
 * - A new location SKU becomes a stack card at that position, carrying the
 *   eBay SKU it is sold under. Stacks are made as needed.
 * - A SKU already in ANY stack card — pulled ones included, exactly as the
 *   eBay auto-import — is never added twice, so the next export after the
 *   next load only adds the new load. A pulled card is not resurrected by a
 *   file that still lists it: CardUploader keeps a card listed until Pick is
 *   pressed there, and our pull is the later fact.
 * - A card already stacked that is still on the shelf and is MISSING its eBay
 *   SKU (or has a different one) has it set, which is how a card stacked by
 *   hand becomes matchable.
 * - A card gone from CardUploader is never added, and nothing is ever pulled
 *   from a file: a card in our stacks that the file no longer lists is
 *   counted, for somebody to look at.
 */
export function planInventoryImport({ rows, existing, stacks }) {
  const bySku = new Map();
  for (const c of existing || []) {
    if (!c?.sku) continue;
    const k = String(c.sku).trim().toLowerCase();
    // An unpulled copy is the one a listing SKU belongs on.
    if (!bySku.has(k) || (!c.pulled_at && bySku.get(k).pulled_at)) bySku.set(k, c);
  }
  const stackByName = new Map((stacks || []).map((s) => [String(s.name).toUpperCase(), s.id]));
  const cards = [];
  const updates = [];
  const seen = new Set();
  const inFile = new Set();
  let already = 0, gone = 0, unparseable = 0, noLocation = 0, noListingSku = 0, repeated = 0;
  for (const r of rows || []) {
    const sku = String(r?.userSku || "").trim();
    if (!sku) { noLocation += 1; continue; }
    const key = sku.toLowerCase();
    if (seen.has(key)) { repeated += 1; continue; }
    seen.add(key);
    const at = stackFromSku(sku);
    // A Cardmarket divider is not a CardUploader stack, and filing a card
    // behind one puts it on the Magic pick list.
    if (!at || isCardmarketStack(at.prefix)) { unparseable += 1; continue; }
    const held = inventoryRowHeld(r);
    if (held) inFile.add(key);
    const listingSku = String(r?.listingSku || "").trim() || null;
    const have = bySku.get(key);
    if (have) {
      if (held && listingSku && !have.pulled_at && have.listing_sku !== listingSku) updates.push({ id: have.id, sku, listing_sku: listingSku });
      else already += 1;
      continue;
    }
    if (!held) { gone += 1; continue; }
    if (!listingSku) noListingSku += 1;
    cards.push({ prefix: at.prefix, num: at.num, sku, title: r.title || "", listing_sku: listingSku });
  }
  const filePrefixes = new Set([...inFile].map((k) => stackFromSku(k)?.prefix).filter(Boolean));
  // Only asked of the stacks the file covers: a stack CardUploader has never
  // heard of (BL, GX — listed under their own SKUs) is not missing from it.
  const notInFile = (existing || []).filter((c) => {
    if (!c?.sku || c.pulled_at || !c.listing_sku) return false;
    const at = stackFromSku(c.sku);
    return at && filePrefixes.has(at.prefix) && !inFile.has(String(c.sku).trim().toLowerCase());
  }).map((c) => c.sku);
  const newStacks = [...new Set(cards.map((c) => c.prefix))].filter((p) => !stackByName.has(p));
  return { cards, updates, newStacks, stackByName, already, gone, unparseable, noLocation, noListingSku, repeated, notInFile };
}

/** Migration 037 not applied: Postgres names the missing column. */
export function isMissingListingSku(err) {
  const m = String(err?.message || err || "");
  return /listing_sku|pulled_line/.test(m) && /column|schema cache|does not exist/i.test(m);
}

async function readAll(makeQuery, pageSize = 1000) {
  let from = 0;
  let all = [];
  for (;;) {
    const { data, error } = await makeQuery().order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Run an inventory upload. Every read and write names `user_id` by hand, the
 * same as runStackImport(). A read that fails stops it before anything is
 * written — a short `stack_cards` read would make every SKU look new.
 *
 * Returns { ok:true, imported, updated, created, ... } or
 * { ok:false, missing:true } when migration 037 is still to run: without the
 * eBay SKU column these cards would be stacked and unmatchable, and Reconcile
 * would call every one "not listed", so it refuses rather than half-works.
 */
export async function runInventoryImport(sb, userId, rows) {
  if (!userId) throw new Error("No user.");
  let existing;
  try {
    existing = await readAll(() => sb.from("stack_cards").select("id,sku,listing_sku,pulled_at").eq("user_id", userId).not("sku", "is", null));
  } catch (e) {
    if (isMissingListingSku(e)) return { ok: false, missing: true };
    throw new Error(e?.message || "Couldn't read your stacks.");
  }
  const { data: stacks, error: stErr } = await sb.from("card_stacks").select("id,name").eq("user_id", userId);
  if (stErr) throw new Error(stErr.message || "Couldn't read stacks.");

  const plan = planInventoryImport({ rows, existing, stacks });
  let created = 0;
  for (const prefix of plan.newStacks) {
    const { data, error } = await sb.from("card_stacks").insert({ user_id: userId, name: prefix }).select("id,name").single();
    if (error) throw new Error(`Couldn't create stack ${prefix}: ${error.message}`);
    plan.stackByName.set(prefix, data.id);
    created += 1;
  }
  const inserts = plan.cards
    .filter((c) => plan.stackByName.has(c.prefix))
    .map((c) => ({ user_id: userId, stack_id: plan.stackByName.get(c.prefix), position: c.num, sku: c.sku, title: c.title, listing_sku: c.listing_sku }));
  let imported = 0, failed = 0;
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500);
    const { error } = await sb.from("stack_cards").insert(chunk);
    if (error) failed += chunk.length;
    else imported += chunk.length;
  }
  let updated = 0;
  for (const u of plan.updates) {
    const { error } = await sb.from("stack_cards").update({ listing_sku: u.listing_sku }).eq("id", u.id).eq("user_id", userId);
    if (error) failed += 1;
    else updated += 1;
  }
  return {
    ok: true, imported, updated, failed, created,
    stacks: new Set(plan.cards.map((c) => c.prefix)).size,
    already: plan.already, gone: plan.gone, unparseable: plan.unparseable,
    noLocation: plan.noLocation, noListingSku: plan.noListingSku, repeated: plan.repeated,
    notInFile: plan.notInFile
  };
}

/** One sentence for the result. */
export function inventoryImportNote(r) {
  if (!r?.ok) return r?.missing
    ? "Migration 037 hasn't been run yet — run supabase/migrations/037_carduploader_inventory.sql in Supabase, then upload again. Nothing was added."
    : "Import failed. Nothing was added.";
  let s = `Added ${r.imported} card(s) to ${r.stacks} stack(s)${r.created ? ` (${r.created} new)` : ""}`;
  if (r.updated) s += `, linked ${r.updated} already stacked to their eBay SKU`;
  s += `. Skipped ${r.already} already on your stacks`;
  if (r.gone) s += `, ${r.gone} CardUploader no longer holds`;
  if (r.unparseable) s += `, ${r.unparseable} whose SKU isn't a stack position`;
  if (r.noLocation) s += `, ${r.noLocation} with no SKU`;
  s += ".";
  if (r.noListingSku) s += ` ${r.noListingSku} had no eBay SKU, so an order can't find them.`;
  if (r.notInFile?.length) {
    const names = r.notInFile.slice(0, 5).join(", ");
    s += ` ${r.notInFile.length} card(s) on those stacks aren't in this file (${names}${r.notInFile.length > 5 ? ", …" : ""}) — sold or removed in CardUploader? Nothing was pulled.`;
  }
  if (r.failed) s += ` ${r.failed} couldn't be saved — upload it again.`;
  return s;
}
