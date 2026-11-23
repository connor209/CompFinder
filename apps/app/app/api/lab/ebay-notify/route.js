import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidUserAccessToken } from "@/lib/ebay";
import { ownerOfLiveItem, logEvent } from "@/lib/lab-store";
import { runCheck } from "@/lib/lab-run";
import { parseNotification, verifySignature, SALE_EVENT } from "@/lib/lab-notify";

/**
 * Where eBay delivers a sale notification (see lib/lab-notify.js). Outside the
 * login wall, because eBay is the caller.
 *
 * A notification is a POKE: if the item is a live lab listing, run the same
 * check the button runs, which reads the sale from eBay itself. Every other
 * sale on the account (most of them) is acknowledged and ignored.
 *
 * eBay's order API can lag the notification by a few seconds, so a check that
 * cannot see the sale yet waits and looks again, a few times, inside the
 * function's time limit. If it still cannot, the next notification or a press
 * of the button picks it up — nothing is lost, only later.
 *
 * Always answers 200 to anything that parsed: eBay does not need to know what
 * we did with it, and a non-200 only makes it retry.
 */
export const maxDuration = 60;

const WAITS_MS = [0, 6000, 15000];
// Without EBAY_DEV_ID nothing can be verified, so an unsigned poke for the
// same listing is ignored inside this window. A forged one can then cost at
// most one extra check every so often, and a real sale is never missed: the
// check it would have run is the one that already ran.
const UNSIGNED_MIN_GAP_MS = 20000;

const ok = () => new NextResponse("ok", { status: 200 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(request) {
  const text = await request.text().catch(() => "");
  const n = parseNotification(text);
  if (n.event !== SALE_EVENT || !n.itemId) return ok();

  const trust = verifySignature(n);
  if (trust === "bad") return new NextResponse("bad signature", { status: 401 });

  const admin = createAdminClient();
  const owner = await ownerOfLiveItem(admin, n.itemId);
  if (!owner) return ok(); // not a lab listing

  if (trust === "unverifiable" && owner.checkedAt && Date.now() - Date.parse(owner.checkedAt) < UNSIGNED_MIN_GAP_MS) {
    return ok();
  }

  const token = await getValidUserAccessToken(admin, owner.userId).catch(() => null);
  if (!token) {
    await logEvent(admin, owner.userId, owner.listingId, "error", { message: "notified, but no eBay token", itemId: n.itemId });
    return ok();
  }

  let result = null;
  let attempts = 0;
  for (const wait of WAITS_MS) {
    if (wait) await sleep(wait);
    attempts += 1;
    try {
      result = await runCheck(admin, owner.userId, token, { source: "notification", itemId: n.itemId });
    } catch (e) {
      result = { ok: false, error: e.message };
    }
    if (!result.ok || result.sawItem) break;
  }

  await logEvent(admin, owner.userId, owner.listingId, "notified", {
    itemId: n.itemId,
    signature: trust,
    attempts,
    reserved: result?.reserved ?? 0,
    moved: result?.moved ?? 0,
    sawSale: result?.sawItem ?? null,
    error: result?.ok === false ? result.error : undefined
  });
  return ok();
}
