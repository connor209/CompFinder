import { stackFromSku } from "./stackpos.js";
import { isListingAvailable } from "./stockcheck.js";

/**
 * Auto-import: turn eBay listing SKUs into stack cards. A SKU like A50 becomes
 * Stack A, position 50; YGO-A12 becomes Stack YGO-A, position 12
 * (`stackFromSku`). Existing stacks are reused and a SKU already in any stack
 * card — pulled ones included — is never added twice.
 *
 * Two callers: the ⤓ button on Stacks, and the nightly sync
 * (`/api/cron/sync`), which runs it unattended right after the listings
 * refresh. So the rules live here once, and so does the thing that matters
 * more at 3am than on a button: **a read that failed is never an empty
 * read.** `pagedSelect` stops quietly on an error and hands back what it had,
 * and a `stack_cards` read that came back short would make every SKU look new
 * — the night's import would then add a second copy of the whole inventory.
 * `readAll()` below throws instead, and the import does nothing.
 *
 * A listing at quantity 0 is skipped and counted. eBay leaves a SOLD
 * fixed-price listing in the ActiveList at zero (see `isListingAvailable`),
 * so importing it would put a card that has gone into a stack — and nightly,
 * with nobody looking, it would do it every night a new sale lands. A missing
 * quantity is still a card we have.
 */

/** Which stacks to create and which cards to insert. Pure; no I/O. */
export function planStackImport({ listings, existingSkus, stacks }) {
  const have = new Set([...(existingSkus || [])].map((s) => String(s).trim().toLowerCase()));
  const stackByName = new Map((stacks || []).map((s) => [String(s.name).toUpperCase(), s.id]));
  let unparseable = 0;
  let soldOut = 0;
  let already = 0;
  const seen = new Set();
  const cards = [];
  for (const l of listings || []) {
    if (!l?.sku) continue;
    const sku = String(l.sku).trim();
    const at = stackFromSku(sku);
    if (!at) { unparseable += 1; continue; }
    const key = sku.toLowerCase();
    if (have.has(key)) { already += 1; continue; }
    if (!isListingAvailable(l)) { soldOut += 1; continue; }
    // Two listings under one SKU are one card on the shelf.
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ prefix: at.prefix, num: at.num, sku, title: l.title || "", ebay_item_id: l.ebay_item_id || null });
  }
  const newStacks = [...new Set(cards.map((c) => c.prefix))].filter((p) => !stackByName.has(p));
  return { cards, newStacks, stackByName, unparseable, soldOut, already };
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
 * Run the import for one user. Works with the browser client (RLS) and the
 * service-role client alike, because every read and write names `user_id` by
 * hand — the nightly job has no RLS behind it to catch a missing filter.
 *
 * Returns { imported, stacks, created, already, soldOut, unparseable, failed }.
 */
export async function runStackImport(sb, userId) {
  if (!userId) throw new Error("No user.");
  const listings = await readAll(() => sb.from("ebay_listings").select("id,sku,title,ebay_item_id,quantity").eq("user_id", userId).not("sku", "is", null));
  const existing = await readAll(() => sb.from("stack_cards").select("id,sku").eq("user_id", userId).not("sku", "is", null));
  const { data: stacks, error: stErr } = await sb.from("card_stacks").select("id,name").eq("user_id", userId);
  if (stErr) throw new Error(stErr.message || "Couldn't read stacks.");

  const plan = planStackImport({ listings, existingSkus: existing.map((e) => e.sku), stacks });
  let created = 0;
  for (const prefix of plan.newStacks) {
    const { data, error } = await sb.from("card_stacks").insert({ user_id: userId, name: prefix }).select("id,name").single();
    if (error) throw new Error(`Couldn't create stack ${prefix}: ${error.message}`);
    plan.stackByName.set(prefix, data.id);
    created += 1;
  }
  const rows = plan.cards
    .filter((c) => plan.stackByName.has(c.prefix))
    .map((c) => ({ user_id: userId, stack_id: plan.stackByName.get(c.prefix), position: c.num, sku: c.sku, title: c.title, ebay_item_id: c.ebay_item_id }));
  let imported = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from("stack_cards").insert(chunk);
    if (error) failed += chunk.length;
    else imported += chunk.length;
  }
  return {
    imported,
    failed,
    created,
    stacks: new Set(plan.cards.map((c) => c.prefix)).size,
    already: plan.already,
    soldOut: plan.soldOut,
    unparseable: plan.unparseable
  };
}

/** One sentence for the result. */
export function stackImportNote(r) {
  let s = `Imported ${r.imported} card(s) into ${r.stacks} stack(s)${r.created ? ` (${r.created} new)` : ""}. Skipped ${r.already} already added`;
  if (r.soldOut) s += `, ${r.soldOut} sold out on eBay`;
  if (r.unparseable) s += `, ${r.unparseable} with non-standard SKUs`;
  s += ".";
  if (r.failed) s += ` ${r.failed} couldn't be saved — run it again.`;
  return s;
}
