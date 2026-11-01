import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken, addFixedPriceListing, fetchItemQuantity, reviseItemQuantity } from "@/lib/ebay";
import { isMtgListingSku } from "@/lib/mtgstock";
import { isMissingSchema } from "@/lib/copyqueue";
import { isUnorderedStack } from "@/lib/toploader";
import { maxPosition } from "@/lib/checkout";

/**
 * File one card's copies into a stack AND put them on sale, as one step.
 *
 * POST {
 *   action: "create" | "add",
 *   stackId,
 *   copies: { title, scans: [url|null, …] },   // one entry per physical copy
 *   listing?: {...},                            // create: from listingFor()
 *   itemId?                                     // add: the listing to add to
 * }
 * → { ok, itemId, quantity, positions, stackName, scanGuard }
 *
 * **The stack is written first and undone if eBay refuses.** The other order
 * is the dangerous one: a listing whose quantity went up for copies that never
 * reached a stack sells cards the pull sheet cannot find. A copy filed with
 * nothing behind it on eBay is merely not for sale yet — and if the undo
 * itself fails, mtgstock.js folds those copies into the next run's listing.
 *
 * **An add reads the live quantity and adds to THAT**, never the synced row:
 * eBay has already taken a sale off its count, and the copy that sold is
 * still sitting in a stack until somebody pulls it, so the stack's own count
 * would put a sold card back on sale. Same rule as `/api/ebay/end-listing`.
 *
 * **A listing that is over is not added to.** The answer says so (`ended`),
 * and the screen offers to create a fresh listing instead.
 *
 * **The SKU an add files under is read here, off our own listing row**, not
 * taken from the request: the copies must carry exactly what an order from
 * that listing will carry, or the pull sheet never finds them.
 */
export const maxDuration = 60;

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const action = body.action === "add" ? "add" : body.action === "create" ? "create" : null;
  if (!action) return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });

  const scans = Array.isArray(body.copies?.scans) ? body.copies.scans : [];
  const count = scans.length;
  if (count < 1 || count > 200) return NextResponse.json({ ok: false, error: "Between 1 and 200 copies at a time." }, { status: 400 });
  const title = String(body.copies?.title || "").slice(0, 200);

  const { data: stack } = await supabase
    .from("card_stacks").select("id,name").eq("id", body.stackId).eq("user_id", user.id).maybeSingle();
  if (!stack) return NextResponse.json({ ok: false, error: "That stack isn't one of yours." }, { status: 400 });
  if (isUnorderedStack(stack.name)) {
    return NextResponse.json({ ok: false, error: `${stack.name} has no positions — choose an ordinary stack.` }, { status: 400 });
  }

  const admin = createAdminClient();
  const token = await getValidUserAccessToken(admin, user.id).catch(() => null);
  if (!token) return NextResponse.json({ ok: false, error: "eBay account not connected." }, { status: 400 });

  // ---- what the copies will be filed under --------------------------------
  let sku;
  let itemId = null;
  let live = null;
  if (action === "create") {
    sku = String(body.listing?.sku || "");
    if (!isMtgListingSku(sku)) return NextResponse.json({ ok: false, error: "That isn't a Magic stock SKU." }, { status: 400 });
    if (!body.listing?.title || !(Number(body.listing?.price) > 0)) {
      return NextResponse.json({ ok: false, error: "A new listing needs a title and a price." }, { status: 400 });
    }
  } else {
    itemId = String(body.itemId || "").replace(/[^0-9]/g, "");
    if (!itemId) return NextResponse.json({ ok: false, error: "Missing item id." }, { status: 400 });
    const { data: row } = await supabase
      .from("ebay_listings").select("sku").eq("user_id", user.id).eq("ebay_item_id", itemId).maybeSingle();
    sku = row?.sku ? String(row.sku).trim() : "";
    if (!sku) {
      // A listing made a moment ago is not in the mirror until the next sync,
      // but its first copies already carry its item id and SKU.
      const { data: sib } = await supabase
        .from("stack_cards").select("sku").eq("user_id", user.id).eq("ebay_item_id", itemId).not("sku", "is", null).limit(1);
      sku = sib?.[0]?.sku ? String(sib[0].sku).trim() : "";
    }
    if (!sku) {
      return NextResponse.json({ ok: false, error: "That listing has no SKU (Custom label), so an order from it couldn't be matched to these copies. Give it one on eBay first." }, { status: 400 });
    }
    try {
      live = await fetchItemQuantity(token, itemId);
    } catch (err) {
      return NextResponse.json({ ok: false, error: `Couldn't read the listing on eBay (${err.message || "eBay unreachable"}). Nothing was filed.` }, { status: 502 });
    }
    if (live.listingStatus && live.listingStatus !== "Active") {
      return NextResponse.json({ ok: false, ended: true, error: "That listing has ended on eBay. Nothing was filed." }, { status: 409 });
    }
    if (live.available == null) {
      return NextResponse.json({ ok: false, error: "eBay didn't say how many are left on that listing. Nothing was filed." }, { status: 502 });
    }
  }

  // Copies of one of OUR cards already filed with no listing behind them — a
  // run whose eBay call fell over and whose undo did too. They are counted
  // into this quantity and linked with these copies, which is what makes
  // "run the file again" finish the job. Only our own SKUs: a hand-made
  // listing's single stack card carries no item id as a matter of course.
  let orphanIds = [];
  if (isMtgListingSku(sku)) {
    const { data: orphans } = await supabase
      .from("stack_cards").select("id").eq("user_id", user.id).eq("sku", sku)
      .is("ebay_item_id", null).is("pulled_at", null).is("checked_out_at", null);
    orphanIds = (orphans || []).map((r) => r.id);
  }

  // ---- 1. file the copies --------------------------------------------------
  // Unlinked until eBay accepts, so a failure that can't be undone leaves
  // orphans the next run picks up rather than copies claiming a listing
  // whose count never went up.
  const start = (await maxPosition(supabase, stack.id)) + 1;
  const rowsFor = (withScan) => scans.map((scan, i) => {
    const r = { user_id: user.id, stack_id: stack.id, position: start + i, sku, title, ebay_item_id: null };
    if (withScan && scan) r.scan_url = String(scan);
    return r;
  });
  let scanGuard = true;
  let ins = await supabase.from("stack_cards").insert(rowsFor(true)).select("id,position");
  if (ins.error && isMissingSchema(ins.error)) {
    scanGuard = false; // migration 027 pending: filed, but a re-upload can't be recognised
    ins = await supabase.from("stack_cards").insert(rowsFor(false)).select("id,position");
  }
  if (ins.error) return NextResponse.json({ ok: false, error: `Couldn't file the copies: ${ins.error.message}. Nothing went to eBay.` }, { status: 500 });
  const ids = (ins.data || []).map((r) => r.id);
  const positions = (ins.data || []).map((r) => r.position).sort((a, b) => a - b);

  const undo = async () => {
    const { error } = await supabase.from("stack_cards").delete().in("id", ids);
    return !error;
  };

  // The link is what the planner reads to find a listing made before the next
  // sync. Not linking costs nothing an order needs — the SKU is what matches —
  // so a failure here is not worth undoing a sale-ready listing over.
  const link = async (rowIds) => {
    if (!itemId || !rowIds.length) return;
    await supabase.from("stack_cards").update({ ebay_item_id: itemId }).in("id", rowIds);
  };

  // ---- 2. eBay ---------------------------------------------------------------
  try {
    if (action === "create") {
      const L = { ...body.listing, sku, quantity: count + orphanIds.length };
      const { data: profile } = await supabase.from("profiles").select("settings").eq("id", user.id).maybeSingle();
      const p = profile?.settings?.ebayPolicies;
      if (p && p.fulfillmentPolicyId) L.policies = p;
      const res = await addFixedPriceListing(token, L);
      itemId = res.itemId;
      await link([...ids, ...orphanIds]);
      return NextResponse.json({ ok: true, action, itemId, quantity: L.quantity, orphans: orphanIds.length, positions, stackName: stack.name, scanGuard, warnings: res.warnings || [] });
    }
    const quantity = live.available + count + orphanIds.length;
    await reviseItemQuantity(token, itemId, quantity);
    await link([...ids, ...orphanIds]);
    try {
      await admin.from("ebay_listings").update({ quantity }).eq("user_id", user.id).eq("ebay_item_id", itemId);
    } catch { /* the next sync corrects it */ }
    return NextResponse.json({ ok: true, action, itemId, quantity, orphans: orphanIds.length, positions, stackName: stack.name, scanGuard });
  } catch (err) {
    const undone = await undo();
    const msg = err.message || "eBay refused.";
    return NextResponse.json({
      ok: false,
      error: undone
        ? `eBay refused: ${msg} The copies were taken back out of ${stack.name}, so nothing changed.`
        : `eBay refused: ${msg} The copies are still filed in ${stack.name} (positions ${positions[0]}–${positions[positions.length - 1]}) with nothing on sale — ` +
          (isMtgListingSku(sku)
            ? "run the file again and they'll be counted into the listing."
            : `raise that listing's quantity by ${count} on eBay by hand, or take them out on Stacks.`),
      rolledBack: undone
    }, { status: 502 });
  }
}
