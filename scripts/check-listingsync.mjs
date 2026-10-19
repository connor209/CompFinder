/**
 * What a listings sync may conclude from what it read.
 *
 *   node scripts/check-listingsync.mjs      (or: npm run check)
 *
 * "The eBay listing sync sometimes doesn't work" (2026-10-19) was two faults
 * with one symptom:
 *
 * - One page failing failed the whole sync. A 40-page account is 40 chances
 *   for an eBay 500 or a dropped connection, nothing retried, and the nightly
 *   job swallowed the error into a bare count — so all anyone saw was a stale
 *   "last synced".
 * - A read that MISSED a listing deleted it. Pages are numbered over a list
 *   that moves: a listing ending on page 3 shifts the rest forward, the first
 *   of page 4 lands on page 3 after page 3 was read, and the sweep then
 *   removed a live card from `ebay_listings` until the next sync.
 *
 * eBay and Supabase are both faked. Nothing here touches the network.
 */
import { fetchAllActiveListings, syncUserListings } from "../apps/app/lib/ebay.js";
import { syncNote } from "../apps/app/lib/listing-sync.js";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── a fake Trading API ───────────────────────────────────────────────────────

function pageXml(ids, { totalPages, totalEntries, noActiveList = false, ack = "Success" } = {}) {
  if (noActiveList) return `<GetMyeBaySellingResponse><Ack>${ack}</Ack></GetMyeBaySellingResponse>`;
  const items = ids.map((id) => `<Item><ItemID>${id}</ItemID><Title>Card ${id}</Title><SKU>A${id}</SKU><QuantityAvailable>1</QuantityAvailable></Item>`).join("");
  return (
    `<GetMyeBaySellingResponse><Ack>${ack}</Ack><ActiveList><ItemArray>${items}</ItemArray>` +
    `<PaginationResult><TotalNumberOfPages>${totalPages}</TotalNumberOfPages><TotalNumberOfEntries>${totalEntries}</TotalNumberOfEntries></PaginationResult>` +
    `</ActiveList></GetMyeBaySellingResponse>`
  );
}

/** `script(page, call)` returns { status, body } for each request. */
function fakeEbay(script) {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const page = Number(/<PageNumber>(\d+)<\/PageNumber>/.exec(init.body)?.[1]);
    calls.push(page);
    const n = calls.filter((p) => p === page).length;
    const r = script(page, n);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
  return calls;
}
const ok = (body) => ({ status: 200, body });
const fast = { pageOptions: { backoffMs: 0 } };

// ── retries ──────────────────────────────────────────────────────────────────

console.log("A page that fails once is retried, not the end of the sync");
{
  const calls = fakeEbay((page, n) => {
    if (page === 2 && n === 1) return { status: 500, body: "" };
    if (page === 1) return ok(pageXml([1, 2], { totalPages: 2, totalEntries: 4 }));
    return ok(pageXml([3, 4], { totalPages: 2, totalEntries: 4 }));
  });
  const r = await fetchAllActiveListings("t", fast);
  check("all four listings read", r.listings.length === 4, `got ${r.listings.length}`);
  check("page 2 asked twice", calls.filter((p) => p === 2).length === 2);
  check("the read is complete", r.complete === true);
}
{
  fakeEbay((page, n) => (page === 1 && n === 1 ? new Error("socket hang up") : ok(pageXml([1], { totalPages: 1, totalEntries: 1 }))));
  const r = await fetchAllActiveListings("t", fast);
  check("a dropped connection is retried too", r.listings.length === 1);
}
{
  fakeEbay((page, n) => (page === 1 && n === 1 ? ok(pageXml([], { ack: "Failure", noActiveList: true })) : ok(pageXml([1], { totalPages: 1, totalEntries: 1 }))));
  const r = await fetchAllActiveListings("t", fast);
  check("an eBay Ack=Failure is retried", r.listings.length === 1);
}

console.log("A page that keeps failing still fails, and says which page");
{
  const calls = fakeEbay((page) => (page === 1 ? ok(pageXml([1], { totalPages: 2, totalEntries: 2 })) : { status: 503, body: "" }));
  let err = null;
  try {
    await fetchAllActiveListings("t", fast);
  } catch (e) {
    err = e;
  }
  check("throws", !!err);
  check("names the page", /Page 2/.test(err?.message || ""), err?.message);
  check("gives up after three tries", calls.filter((p) => p === 2).length === 3);
}
{
  const calls = fakeEbay(() => ({ status: 401, body: "" }));
  try {
    await fetchAllActiveListings("t", fast);
  } catch {
    /* expected */
  }
  check("a refused token is not retried", calls.length === 1, `asked ${calls.length} times`);
}

// ── what counts as a complete read ──────────────────────────────────────────

console.log("A listing skipped by the pages moving makes the read incomplete");
{
  // eBay said 5; page 1 had 1–2, and by the time page 2 was read listing 2
  // had ended and 3 slid onto page 1 — page 2 starts at 4.
  fakeEbay((page) => (page === 1 ? ok(pageXml([1, 2], { totalPages: 3, totalEntries: 5 })) : page === 2 ? ok(pageXml([4, 5], { totalPages: 3, totalEntries: 4 })) : ok(pageXml([], { totalPages: 3, totalEntries: 4 }))));
  const r = await fetchAllActiveListings("t", fast);
  check("not complete", r.complete === false);
  check("says how many were not seen", r.missed === 1, `missed ${r.missed}`);
}
{
  fakeEbay((page) => (page === 1 ? ok(pageXml([1, 2], { totalPages: 2, totalEntries: 3 })) : ok(pageXml([2, 3], { totalPages: 2, totalEntries: 3 }))));
  const r = await fetchAllActiveListings("t", fast);
  check("a listing seen twice is one listing", r.listings.length === 3);
  check("…and the read is still complete", r.complete === true);
}
{
  fakeEbay(() => ok(pageXml([], { noActiveList: true, ack: "Warning" })));
  const r = await fetchAllActiveListings("t", fast);
  check("no ActiveList at all is NOT an empty account", r.complete === false);
}
{
  fakeEbay(() => ok(pageXml([], { totalPages: 1, totalEntries: 0 })));
  const r = await fetchAllActiveListings("t", fast);
  check("an ActiveList with nothing in it IS an empty account", r.complete === true && r.listings.length === 0);
}
{
  fakeEbay((page) => ok(pageXml([page], { totalPages: 3, totalEntries: 3 })));
  const r = await fetchAllActiveListings("t", { ...fast, maxPages: 2 });
  check("past the page cap is truncated and not complete", r.truncated === true && r.complete === false);
}

// ── the sweep ────────────────────────────────────────────────────────────────

function fakeAdmin() {
  const log = { upserts: 0, deletes: 0, stamped: false };
  const acct = { user_id: "u1", refresh_token: "r", access_token: "t", access_expires_at: new Date(Date.now() + 3_600_000).toISOString() };
  const chain = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      lt: () => q,
      single: async () => ({ data: table === "ebay_accounts" ? acct : null }),
      upsert: async () => {
        log.upserts += 1;
        return { error: null };
      },
      delete: () => {
        log.deletes += 1;
        return q;
      },
      update: () => {
        if (table === "ebay_accounts") log.stamped = true;
        return q;
      },
      then: (res) => res({ error: null })
    };
    return q;
  };
  return { admin: { from: chain }, log };
}

console.log("Ended listings are removed only on a complete read");
{
  fakeEbay(() => ok(pageXml([1, 2], { totalPages: 1, totalEntries: 2 })));
  const { admin, log } = fakeAdmin();
  const r = await syncUserListings(admin, "u1");
  check("complete read: upserts", log.upserts === 1);
  check("complete read: sweeps ended listings", log.deletes === 1);
  check("complete read: reports complete", r.complete === true);
}
{
  fakeEbay(() => ok(pageXml([1, 2], { totalPages: 1, totalEntries: 3 })));
  const { admin, log } = fakeAdmin();
  const r = await syncUserListings(admin, "u1");
  check("incomplete read: still upserts what it saw", log.upserts === 1);
  check("incomplete read: removes NOTHING", log.deletes === 0, `${log.deletes} delete(s)`);
  check("incomplete read: says so", r.complete === false && r.missed === 1);
}
{
  fakeEbay(() => ok(pageXml([], { noActiveList: true, ack: "Warning" })));
  const { admin, log } = fakeAdmin();
  await syncUserListings(admin, "u1");
  check("an answer with no ActiveList never empties the cache", log.deletes === 0);
}

// ── what the button says ─────────────────────────────────────────────────────

console.log("The result reads the same on every screen");
check("a clean sync", syncNote({ ok: true, count: 12, complete: true }) === "Synced 12 listings.");
check("one listing", syncNote({ ok: true, count: 1, complete: true }) === "Synced 1 listing.");
check("an incomplete read says nothing was removed", /weren't removed/.test(syncNote({ ok: true, count: 9, complete: false, missed: 2 })));
check("…and how many it missed", /2 not seen/.test(syncNote({ ok: true, count: 9, complete: false, missed: 2 })));
check("a capped read says so", /Capped/.test(syncNote({ ok: true, count: 9, truncated: true, complete: false })));
check("a failure carries its reason", syncNote({ ok: false, error: "Page 3: eBay listing fetch failed (503)." }).includes("Page 3"));
check("an older server with no `complete` field reads as a clean sync", syncNote({ ok: true, count: 3 }) === "Synced 3 listings.");

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall listing-sync checks passed");
