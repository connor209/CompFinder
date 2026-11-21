import { parseCsvText, isCardmarketStack } from "./cardmarket.js";
import { stackFromSku } from "./stackpos.js";
import { titlesDisagree } from "./stockcheck.js";

export { titlesDisagree };

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
 * eBay Seller Hub's orders report (Orders → Download report), read for the
 * two things it can prove: which stack SKU (`Custom label`) sold, as which
 * card (`Item title`). eBay puts a blank line or two above the header and a
 * "records downloaded" line under the data, so the header is FOUND rather
 * than assumed, and a row with no SKU is skipped. Seller Hub exports a
 * limited date range at a time, so several reports can be read together.
 *
 * Returns [{ sku, title, soldDate, orderId }] — the shape of `ebay_sales`.
 */
export function parseEbayOrdersCsv(text) {
  const rows = parseCsvText(text, ",");
  const lc = (v) => String(v || "").trim().toLowerCase();
  const h = rows.slice(0, 10).findIndex((r) => r.some((c) => lc(c) === "custom label") && r.some((c) => lc(c) === "item title"));
  if (h < 0) throw new Error("That isn't an eBay orders report — no \"Custom label\" and \"Item title\" columns. In Seller Hub: Orders → Download report.");
  const head = rows[h].map(lc);
  const col = (name) => head.indexOf(name);
  const sku = col("custom label"), title = col("item title"), date = col("sale date"), order = col("order number");
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const k = String(r[sku] ?? "").trim();
    if (!k) continue;
    out.push({ sku: k, title: String(r[title] ?? "").trim(), soldDate: date >= 0 ? String(r[date] ?? "").trim() || null : null, orderId: order >= 0 ? String(r[order] ?? "").trim() || null : null });
  }
  return out;
}

/** Which of the files this screen reads a CSV is: "inventory", "ebayOrders" or null. */
export function csvKind(text) {
  const head = parseCsvText(String(text || "").split(/\r?\n/).slice(0, 10).join("\n"), ",").map((r) => r.map((c) => String(c || "").trim().toLowerCase()));
  if (head.some((r) => r.includes("user sku") && r.includes("ebay sku"))) return "inventory";
  if (head.some((r) => r.includes("custom label") && r.includes("item title"))) return "ebayOrders";
  return null;
}

/**
 * The CardUploader rows that are stock it still calls Listed but we know is
 * gone, as a file to work through in CardUploader: its own columns first so
 * a row can be found there, then why we think so.
 */
export function purgeCsv(stale) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["User SKU", "eBay SKU", "Title", "Why it is gone", "Sold on"].map(q).join(",")];
  for (const r of stale || []) lines.push([r.sku, r.listingSku, r.title, r.why === "pulled" ? "Pulled here" : "Sold on eBay under this SKU", r.soldDate || ""].map(q).join(","));
  return lines.join("\r\n") + "\r\n";
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
 * - A SKU that is ours but a DIFFERENT CARD (titlesDisagree) is a clash: it
 *   is reported and nothing is written. If an earlier upload already linked
 *   that card to this row's eBay SKU, the link is taken off (`unlink`) — it
 *   is how a Sableye order came to be sent to somebody else's card.
 * - A row whose location SKU already SOLD on eBay as the same card (`sales`,
 *   from ebay_sales and any orders report uploaded with it), or is already
 *   PULLED here as the same card, is STALE: CardUploader calls it Listed only
 *   because nobody pressed Pick there (the Sableye at G16, sold 2 Sep). It is
 *   not stacked or linked, an earlier link is taken off, and it goes on the
 *   purge list. Stack SKU sales only: a variation sale reports the CS- SKU,
 *   so a sale under the stack SKU was the card's old single listing.
 * - A card gone from CardUploader is never added, and nothing is ever pulled
 *   from a file: a card in our stacks that the file no longer lists is
 *   counted, for somebody to look at.
 */
export function planInventoryImport({ rows, existing, stacks, sales = [] }) {
  const bySku = new Map();
  const soldAs = new Map(); // sku -> [{ title, date, why }]: evidence the copy at that SKU has gone
  const evidence = (k, e) => { if (!soldAs.has(k)) soldAs.set(k, []); soldAs.get(k).push(e); };
  for (const sl of sales || []) {
    if (sl?.sku) evidence(String(sl.sku).trim().toLowerCase(), { title: sl.title || "", date: sl.soldDate || sl.sold_date || null, why: "sold" });
  }
  for (const c of existing || []) {
    if (!c?.sku) continue;
    const k = String(c.sku).trim().toLowerCase();
    if (c.pulled_at) evidence(k, { title: c.title || "", date: null, why: "pulled" });
    // An unpulled copy is the one a listing SKU belongs on.
    if (!bySku.has(k) || (!c.pulled_at && bySku.get(k).pulled_at)) bySku.set(k, c);
  }
  const stackByName = new Map((stacks || []).map((s) => [String(s.name).toUpperCase(), s.id]));
  const cards = [];
  const updates = [];
  const unlink = []; // { id, sku } — wrongly linked by an earlier upload
  const stale = []; // { sku, listingSku, title, why, soldDate } — CardUploader says Listed, we know it went
  const clashes = []; // { sku, ours, theirs }
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
    const wentAs = held ? (soldAs.get(key) || []).find((e) => !titlesDisagree(e.title, r.title)) : null;
    if (wentAs) {
      stale.push({ sku, listingSku: listingSku || "", title: r.title || "", why: wentAs.why, soldDate: wentAs.date || null });
      if (have && !have.pulled_at && listingSku && have.listing_sku && listingSkuKey(have.listing_sku) === listingSkuKey(listingSku)) unlink.push({ id: have.id, sku });
      continue;
    }
    if (have) {
      if (titlesDisagree(have.title, r.title)) {
        clashes.push({ sku, ours: have.title || "", theirs: r.title || "" });
        if (listingSku && have.listing_sku && listingSkuKey(have.listing_sku) === listingSkuKey(listingSku)) unlink.push({ id: have.id, sku });
        continue;
      }
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
  return { cards, updates, unlink, clashes, stale, newStacks, stackByName, already, gone, unparseable, noLocation, noListingSku, repeated, notInFile };
}

/** Migration 037 not applied: Postgres names the missing column. */
export function isMissingListingSku(err) {
  const m = String(err?.message || err || "");
  return /listing_sku|pulled_line/.test(m) && /column|schema cache|does not exist/i.test(m);
}

async function readAll(makeQuery, { key = "id", pageSize = 1000 } = {}) {
  let from = 0;
  let all = [];
  for (;;) {
    const { data, error } = await makeQuery().order(key, { ascending: true }).range(from, from + pageSize - 1);
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
export async function runInventoryImport(sb, userId, rows, { extraSales = [] } = {}) {
  if (!userId) throw new Error("No user.");
  let existing;
  try {
    existing = await readAll(() => sb.from("stack_cards").select("id,sku,title,listing_sku,pulled_at").eq("user_id", userId).not("sku", "is", null));
  } catch (e) {
    if (isMissingListingSku(e)) return { ok: false, missing: true };
    throw new Error(e?.message || "Couldn't read your stacks.");
  }
  const { data: stacks, error: stErr } = await sb.from("card_stacks").select("id,name").eq("user_id", userId);
  if (stErr) throw new Error(stErr.message || "Couldn't read stacks.");

  // eBay's own record of what sold, ~90 days of it. A failed read is not "no
  // sales": the import goes ahead on what was uploaded and says so.
  let synced = [];
  let salesRead = true;
  try {
    synced = await readAll(() => sb.from("ebay_sales").select("sku,title,sold_date,line_item_id").eq("user_id", userId).not("sku", "is", null), { key: "line_item_id" });
  } catch {
    salesRead = false;
  }
  const plan = planInventoryImport({ rows, existing, stacks, sales: [...synced, ...(extraSales || [])] });
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
  let unlinked = 0;
  for (const u of plan.unlink) {
    const { error } = await sb.from("stack_cards").update({ listing_sku: null }).eq("id", u.id).eq("user_id", userId);
    if (error) failed += 1;
    else unlinked += 1;
  }
  return {
    ok: true, imported, updated, failed, created, unlinked, clashes: plan.clashes, stale: plan.stale, salesRead,
    reports: (extraSales || []).length,
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
  if (r.clashes?.length) {
    const eg = r.clashes.slice(0, 3).map((c) => `${c.sku} is ${c.theirs || "?"} in CardUploader but ${c.ours || "?"} here`).join("; ");
    s += ` ${r.clashes.length} SKU(s) name a different card in CardUploader than on your stacks (${eg}${r.clashes.length > 3 ? "; …" : ""}) — left alone, not stacked.`;
  }
  if (r.stale?.length) s += ` ${r.stale.length} CardUploader still calls Listed had already sold or been pulled — not stacked; download the purge list to clear them out of CardUploader.`;
  if (r.salesRead === false) s += " Couldn't read your synced eBay sales, so only an uploaded orders report was checked for cards that already sold.";
  if (r.unlinked) s += ` Took the CardUploader SKU off ${r.unlinked} card(s) an earlier upload had linked to the wrong card.`;
  if (r.failed) s += ` ${r.failed} couldn't be saved — upload it again.`;
  return s;
}
