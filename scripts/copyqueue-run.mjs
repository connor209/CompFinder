/**
 * One listing, several copies — say what needs changing, and change it.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/copyqueue-run.mjs                    # every multi-copy listing, dry
 *   … node scripts/copyqueue-run.mjs --item 1234567890  # just this one, dry
 *   … EBAY_CLIENT_ID=… EBAY_CLIENT_SECRET=… \
 *     node scripts/copyqueue-run.mjs --item 1234567890 --apply
 *
 * **Dry by default, and `--apply` needs `--item`.** The first live test of this
 * is one listing you chose, not every listing you happen to hold two of. A
 * whole-inventory apply is not offered at all — when there is a screen for
 * this, it can offer one; a script run from a terminal at the end of a long
 * day should not.
 *
 * WHAT IT DOES. Reads which copies of each card are still in the box, works
 * out what each listing should therefore say (quantity = copies left, picture
 * = the head copy's scan), and prints the difference. Every rule comes from
 * apps/app/lib/copyqueue.js, so what this prints is what the app would do.
 *
 * It is a RECONCILIATION, so running it twice does nothing the second time and
 * a missed run costs nothing but staleness. Nothing here consumes a sale: the
 * pull sheet already records a card leaving the box, made by the person
 * holding it.
 *
 * SERVICE-ROLE KEY. Reading past RLS needs it. Same posture as
 * backfill-images.mjs and dump-batch.mjs: run it locally or from a manually
 * triggered Action, never off a push, and never commit the key — the output
 * carries your SKUs and stack positions.
 */
import { createClient } from "@supabase/supabase-js";
import {
  queuesByListing, desiredStateFor, reconcile, loadCopyState, recordPictured
} from "../apps/app/lib/copyqueue.js";
import { getValidUserAccessToken, reviseFixedPriceListing } from "../apps/app/lib/ebay.js";

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ITEM = argOf("--item", null);
const USER = argOf("--user", null);
const APPLY = args.includes("--apply");
// Copies of one card that are not (yet) on a shared listing are the ordinary
// single-card case and there are thousands of them. --all shows those too.
const ALL = args.includes("--all");

if (APPLY && !ITEM) {
  console.error("--apply needs --item <ebay item id>. Run it dry first, pick one listing, then apply to that.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — needed to read past RLS).");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

/** Read every row of a table, past PostgREST's 1000-row page. */
async function all(table, select = "*") {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

const money = (l) => (l?.price_value != null ? `£${Number(l.price_value).toFixed(2)}` : "—");

async function main() {
  const [cards, listings] = await Promise.all([all("stack_cards"), all("ebay_listings")]);
  const byItem = new Map(listings.map((l) => [String(l.ebay_item_id), l]));

  let queues = queuesByListing(cards);
  if (ITEM) {
    const one = queues.get(String(ITEM));
    queues = new Map(one ? [[String(ITEM), one]] : []);
    if (!queues.size) {
      console.error(`No sellable copies are filed against item ${ITEM}.`);
      console.error("Copies are stack_cards rows sharing an ebay_item_id, not pulled and not checked out.");
      process.exit(1);
    }
  }

  const state = await loadCopyState(sb, [...queues.keys()]);
  if (state.missing) {
    console.log("· migration 027 is not applied — no picture changes can be proposed, and none will be.");
    console.log("  supabase/migrations/027_listing_copies.sql. Quantity reconciliation still works.\n");
  } else if (!state.ok) {
    console.log(`· could not read the copy state: ${state.error}\n`);
  }

  const interesting = [...queues.entries()]
    .filter(([, q]) => ALL || ITEM || q.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  if (!interesting.length) {
    console.log("Nothing holds more than one copy behind one listing. Nothing to reconcile.");
    console.log("(--all lists the single-copy listings too.)");
    return;
  }

  let toChange = 0;
  for (const [itemId, queue] of interesting) {
    const listing = byItem.get(itemId) || null;
    const desired = desiredStateFor(itemId, cards);
    const plan = reconcile(desired, listing || {}, state.state.get(itemId) || null);

    const head = desired.head;
    console.log(`${itemId}  ${listing?.title || queue[0]?.title || "(not in ebay_listings)"}`);
    console.log(`  ${queue.length} ${queue.length === 1 ? "copy" : "copies"} in the box · listed at ${money(listing)} · eBay says quantity ${listing?.quantity ?? "—"}`);
    queue.forEach((c, i) => {
      console.log(`    ${i === 0 ? "→" : " "} ${i + 1}. ${c.sku || c.id}${i === 0 ? "  (pictured, pull this one next)" : ""}${c.scan_url ? "" : "  [no scan]"}`);
    });
    if (plan.empty) {
      console.log("  ✓ already says the right thing\n");
      continue;
    }
    toChange++;
    for (const r of plan.reasons) console.log(`  · ${r}`);
    for (const b of plan.blocked) console.log(`  ! ${b}`);

    if (!APPLY) { console.log("  (dry run — nothing sent)\n"); continue; }

    // --- apply, one listing, on purpose ------------------------------------
    let userId = USER;
    if (!userId) {
      const { data } = await sb.from("ebay_accounts").select("user_id").order("connected_at", { ascending: false }).limit(1);
      userId = data?.[0]?.user_id || null;
    }
    if (!userId) { console.error("  ✗ no connected eBay account — nothing to authenticate as.\n"); process.exit(1); }

    const token = await getValidUserAccessToken(sb, userId);
    if (!token) { console.error("  ✗ could not get an eBay token for that account — reconnect it in the app.\n"); process.exit(1); }

    const res = await reviseFixedPriceListing(token, itemId, {
      imageUrls: plan.changes.pictureUrls || null,
      quantity: plan.changes.quantity ?? null
    });
    console.log(`  ✓ eBay accepted it (${res.ack})${res.warning ? ` — warning: ${res.warning}` : ""}`);

    // Recorded AFTER eBay accepts, never before: a state row claiming a picture
    // that was never set stops the reconcile proposing the one change still
    // needed, and stops it quietly.
    if (plan.changes.pictureUrls && head) {
      const rec = await recordPictured(sb, {
        itemId, copyId: head.id, pictureUrl: plan.changes.pictureUrls[0], userId
      });
      if (rec.missing) console.log("  ! migration 027 is not applied, so this revision is not recorded — the next run will propose it again.");
      else if (!rec.ok) console.log(`  ! could not record which copy is pictured: ${rec.error}`);
    }
    console.log("");
  }

  if (!APPLY && toChange) {
    console.log(`${toChange} listing(s) would change. Re-run with --item <id> --apply to send one.`);
    console.log("Then LOOK at the listing page: eBay's gallery thumbnail lags the main picture.");
  }
}

main().catch((err) => { console.error(err?.message || err); process.exit(1); });
