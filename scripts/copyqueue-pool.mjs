/**
 * Fold several single listings of the same card into ONE multi-copy listing.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   EBAY_CLIENT_ID=… EBAY_CLIENT_SECRET=… \
 *     node scripts/copyqueue-pool.mjs --skus FN22,FN28,FM11            # dry
 *   …   node scripts/copyqueue-pool.mjs --skus FN22,FN28,FM11 --keep 4063… # choose the listing kept
 *   …   node scripts/copyqueue-pool.mjs --skus FN22,FN28,FM11 --apply   # do it
 *
 * Name the copies by the SKUs on their sleeves. The first one's listing is
 * kept unless --keep names another of theirs (keep the one with the watchers
 * or the sales history — it is the one that survives). Every rule about what
 * may be pooled is in apps/app/lib/copypool.js; this file only reads, prints,
 * and on --apply writes.
 *
 * DRY BY DEFAULT. A dry run reads eBay (the unshipped orders, and each
 * listing's live quantity) but changes nothing anywhere.
 *
 * WHAT --apply DOES, IN THIS ORDER, and why the order
 *
 *   1. Re-reads every listing LIVE. A copy whose listing has sold since the
 *      dry run, or ended, is dropped from the pool; the kept one doing so
 *      stops everything.
 *   2. ENDS the other copies' listings. First, so there is never a moment
 *      when a copy is on its own listing AND counted in the pool's quantity —
 *      that is a card sold twice. A listing eBay won't end keeps its copy out
 *      of the pool.
 *   3. Points each pooled copy's stack row at the kept listing, with its
 *      `copy_seq` and its scans (`scan_urls`, migration 036). Each copy keeps
 *      its own SKU.
 *   4. Revises the kept listing to quantity N with copy 1's photos (uploaded
 *      to eBay first — see revisePooledListing in ebay.js).
 *
 * If step 4 fails the copies are already off their own listings and the kept
 * one is still at its old quantity: fewer on sale than you hold, never more.
 * Re-run `copyqueue-run.mjs --item <kept> --apply` to finish it.
 *
 * An ended listing can be relisted from Seller Hub if you change your mind;
 * this script does not undo itself.
 *
 * Needs migrations 027 (copy_seq, scan_url) and ideally 035 and 036. Run it
 * locally, never off a push: it holds the service-role key and your eBay
 * token, and its output carries your SKUs and stack positions.
 */
import { createClient } from "@supabase/supabase-js";
import { planPool } from "../apps/app/lib/copypool.js";
import { recordPictured, scanUrlsOf } from "../apps/app/lib/copyqueue.js";
import { scansBySku } from "../apps/app/lib/import-store.js";
import {
  getValidUserAccessToken, fetchPendingOrders, fetchItemQuantity, endListing, revisePooledListing
} from "../apps/app/lib/ebay.js";

const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null; };
const SKUS = String(argOf("--skus") || "").split(/[\s,]+/).filter(Boolean);
const KEEP = (argOf("--keep") || "").replace(/[^0-9]/g, "") || null;
const APPLY = args.includes("--apply");

if (SKUS.length < 2) {
  console.error("Name at least two copies: --skus FN22,FN28,FM11");
  process.exit(1);
}
const need = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"].filter((k) => !process.env[k]);
if (need.length) {
  console.error(`Set ${need.join(", ")}. The eBay keys are needed even dry: without the unshipped orders a copy that has just sold looks like a spare.`);
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

async function readAll(make) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

async function main() {
  let userId = argOf("--user");
  if (!userId) {
    const { data } = await sb.from("ebay_accounts").select("user_id").order("connected_at", { ascending: false }).limit(1);
    userId = data?.[0]?.user_id || null;
  }
  if (!userId) die("no connected eBay account");
  const token = await getValidUserAccessToken(sb, userId);
  if (!token) die("could not get an eBay token — reconnect the account in the app");

  const cards = await readAll(() => sb.from("stack_cards").select("*").eq("user_id", userId));
  const { data: stacks } = await sb.from("card_stacks").select("id,name").eq("user_id", userId);
  const stackName = new Map((stacks || []).map((s) => [s.id, s.name]));
  const itemIds = [...new Set(cards.filter((c) => SKUS.some((s) => s.toLowerCase() === String(c.sku || "").toLowerCase())).map((c) => c.ebay_item_id).filter(Boolean).map(String))];
  if (KEEP && !itemIds.includes(KEEP)) itemIds.push(KEEP);
  const listings = new Map();
  if (itemIds.length) {
    const { data, error } = await sb.from("ebay_listings").select("ebay_item_id,title,quantity,price_value,sku").eq("user_id", userId).in("ebay_item_id", itemIds);
    if (error) die(`listings: ${error.message}`);
    for (const l of data || []) listings.set(String(l.ebay_item_id), l);
  }
  const { lines } = await fetchPendingOrders(token, { labelledWithinDays: 7 });
  const sc = await scansBySku(sb, userId, SKUS);
  if (sc.missing) console.log("· migration 028 (imports) isn't applied — no scans can be found.");

  const plan = planPool({ skus: SKUS, keepItemId: KEEP, cards, listings, lines, scans: sc.scans });

  const kept = listings.get(plan.keep);
  console.log(`\nPool into listing ${plan.keep || "?"}  ${kept?.title || ""}`);
  for (const c of plan.copies) {
    const at = stackName.get(c.card.stack_id) || "?";
    const own = c.itemId === plan.keep ? "kept listing" : `ends ${c.itemId}`;
    console.log(`  ${c.seq}. ${c.sku.padEnd(8)} stack ${at} · ${own} · ${c.scans.length ? `${c.scans.length} scan(s)` : "no scan"}${c.seq === 1 ? "  ← pictured first" : ""}`);
  }
  for (const w of plan.warnings) console.log(`  ! ${w}`);
  if (!plan.ok) {
    for (const e of plan.errors) console.log(`  ✗ ${e}`);
    die("not pooled — fix the above, or leave those SKUs out");
  }
  console.log(`  → listing ${plan.keep} to quantity ${plan.copies.length}; ${plan.end.length} listing(s) ended`);
  if (!APPLY) { console.log("\n(dry run — nothing changed. Add --apply to do it.)"); return; }

  // 1. live re-read
  const pooled = [];
  for (const c of plan.copies) {
    let q;
    try { q = await fetchItemQuantity(token, c.itemId); } catch (err) { q = { error: err?.message || String(err) }; }
    const okLive = !q.error && (!q.listingStatus || q.listingStatus === "Active") && (q.available == null || q.available > 0);
    if (!okLive) {
      if (c.itemId === plan.keep) die(`the kept listing ${plan.keep} is no longer on sale (${q.error || q.listingStatus || "quantity 0"}) — nothing changed`);
      console.log(`  ! ${c.sku} dropped: its listing ${c.itemId} has sold or ended since (${q.error || q.listingStatus || "quantity 0"})`);
      continue;
    }
    pooled.push(c);
  }

  // 2. end the others first
  const inPool = [];
  for (const c of pooled) {
    if (c.itemId === plan.keep) { inPool.push(c); continue; }
    try {
      await endListing(token, c.itemId);
      await sb.from("ebay_listings").delete().eq("user_id", userId).eq("ebay_item_id", c.itemId);
      console.log(`  ✓ ended ${c.itemId} (${c.sku})`);
      inPool.push(c);
    } catch (err) {
      console.log(`  ! ${c.sku} left on its own listing: eBay wouldn't end ${c.itemId} (${err?.message || err})`);
    }
  }
  if (inPool.length < 2) die("fewer than two copies left to pool — the kept listing is untouched");

  // 3. stack rows. The link first (always exists), then 027's and 036's
  // columns separately, so a pending migration costs the order or the
  // scans rather than the pool.
  inPool.forEach((c, i) => { c.seq = i + 1; });
  for (const c of inPool) {
    const { error } = await sb.from("stack_cards").update({ ebay_item_id: plan.keep }).eq("id", c.card.id).eq("user_id", userId);
    if (error) die(`${c.sku}: couldn't tie it to the listing (${error.message}). Ended listings stay ended; re-run once fixed.`);
    const s1 = await sb.from("stack_cards").update({ copy_seq: c.seq }).eq("id", c.card.id);
    if (s1.error) console.log(`  ! ${c.sku}: copy order not saved (${s1.error.message}) — is migration 027 applied?`);
    if (c.scans.length) {
      const s2 = await sb.from("stack_cards").update({ scan_urls: c.scans }).eq("id", c.card.id);
      if (s2.error) {
        const s3 = await sb.from("stack_cards").update({ scan_url: c.scans[0] }).eq("id", c.card.id);
        console.log(`  ! ${c.sku}: ${s3.error ? "scans not saved" : "front scan only"} (${s2.error.message}) — apply migration 036 for front and back`);
        c.card.scan_url = s3.error ? c.card.scan_url : c.scans[0];
      } else {
        c.card.scan_urls = c.scans;
      }
    }
  }

  // 4. the kept listing: quantity, and copy 1's photos if it has any
  const head = inPool[0];
  const photos = scanUrlsOf({ ...head.card, scan_urls: head.card.scan_urls || head.scans });
  try {
    const res = await revisePooledListing(token, plan.keep, { quantity: inPool.length, imageUrls: photos.length ? photos : null });
    await sb.from("ebay_listings").update({ quantity: inPool.length }).eq("user_id", userId).eq("ebay_item_id", plan.keep);
    if (photos.length) {
      const rec = await recordPictured(sb, { itemId: plan.keep, copyId: head.card.id, pictureUrl: photos[0], userId });
      if (!rec.ok) console.log(`  ! picture not recorded (${rec.missing ? "migration 027" : rec.error}) — the copy sync will revise it once more`);
    }
    console.log(`  ✓ listing ${plan.keep} now quantity ${inPool.length}${photos.length ? `, showing ${head.sku}'s ${photos.length} photo(s)` : ""}${res.warning ? ` — eBay warned: ${res.warning}` : ""}`);
  } catch (err) {
    die(`couldn't revise ${plan.keep}: ${err?.message || err}. The copies are off their own listings and tied to this one; run copyqueue-run.mjs --item ${plan.keep} --apply to finish.`);
  }
  console.log("\nDone. Look at the listing on eBay: the photo, the quantity, and that the ended ones are gone.");
}

main().catch((err) => { console.error(err?.message || err); process.exit(1); });
