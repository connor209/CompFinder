/**
 * The "Sync with eBay" button, wherever it is. Three screens call it — My
 * listings, Settings, and Stacks before an auto-import — and each used to
 * phrase the result its own way, so only one of them ever mentioned a capped
 * read and none could say why a sync failed when the function timed out:
 * Vercel answers a timeout with an HTML page, `r.json()` throws on it, and
 * the screen said "Sync failed." with nothing behind it.
 *
 * No React here; the server side is `syncUserListings()` in `ebay.js`.
 */

/** POST /api/ebay/sync. Always resolves to `{ ok, ... }`, never throws. */
export async function syncListings() {
  let res;
  try {
    res = await fetch("/api/ebay/sync", { method: "POST" });
  } catch {
    return { ok: false, error: "Sync failed — couldn't reach the server. Check the connection and try again." };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON: a platform error page */
  }
  if (body) return body;
  if (res.status === 504) {
    return { ok: false, error: "Sync timed out before eBay finished answering. Nothing was removed — try again." };
  }
  return { ok: false, error: `Sync failed (${res.status}). Try again.` };
}

/** One sentence for the result, the same on every screen. */
export function syncNote(res) {
  if (!res?.ok) return res?.error || "Sync failed.";
  const n = res.count ?? 0;
  let note = `Synced ${n} listing${n === 1 ? "" : "s"}.`;
  if (res.truncated) {
    note += " Capped — not every listing was read, so nothing was removed.";
  } else if (res.complete === false) {
    // A listing that ended while the pages were read shifts the rest along
    // and one gets skipped; see fetchAllActiveListings().
    note += res.missed
      ? ` eBay's list moved while it was being read (${res.missed} not seen), so ended listings weren't removed this time — sync again to tidy up.`
      : " eBay's answer was incomplete, so ended listings weren't removed this time — sync again to tidy up.";
  }
  return note;
}
