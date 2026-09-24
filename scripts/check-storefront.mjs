/**
 * The storefront: the binder behind the QR on the table, on a stranger's phone.
 *
 *   node scripts/check-storefront.mjs      (or: npm run check)
 *
 * The app's first anonymous surface, read with the service-role key — so
 * row-level security is not there to catch a mistake. What this pins:
 *
 * - **Nothing private crosses to the browser.** Rows are stuffed with every
 *   private value the app knows and the serialised payload is searched for
 *   each, through the real loader against a fake Supabase.
 * - **Every read is filtered on the link owner by hand.** A service-role read
 *   without `user_id` would serve every account's stock under one token.
 * - **The projection is an allow-list**: exactly the keys declared, nothing
 *   spread from a row.
 * - **A dead link serves nothing**: switched off, run out, malformed, unknown.
 * - It is the same binder: nine to a page, sections never share one, a
 *   stranger's search reads the name and not the SKU.
 * - Greps: noindex and no-referrer on the page, no Supabase client in the
 *   component a visitor runs, the table named in one file, and the route left
 *   out of the middleware's login wall.
 */
import { readFileSync } from "node:fs";
import {
  storefrontStock, storefrontView, storefrontCard, cardMatches,
  STOREFRONT_FIELDS, STOREFRONT_COPY_FIELDS, BOX, ONLINE, ASK_TEXT
} from "../apps/app/lib/storefront.js";
import {
  loadPublicStorefront, newToken, isWellFormedToken, storefrontStatus, expiresAtFor,
  storefrontUrl, CHECKOUT_COLUMNS, LISTING_COLUMNS
} from "../apps/app/lib/storefront-store.js";
import { qrMatrix, qrPath } from "../apps/app/lib/qr.js";
import { BINDER_PAGE } from "../apps/app/lib/binder.js";

let failures = 0;
let checks = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++; };
const ok = (cond, msg) => { checks++; if (!cond) fail(msg); };
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- Rows carrying everything we would never show a stranger --------------
const OWNER = "11111111-aaaa-4bbb-8ccc-000000000001";
const STRANGER = "22222222-aaaa-4bbb-8ccc-000000000002";
const PRIVATE = [
  "SKU-SECRET-A50", "SKU-SECRET-B7", "SKU-LISTED-C9",
  "Stack Secret", "Event Secret London",
  "note-secret", "hide-error-secret",
  "co-uuid-secret-0001", "co-uuid-secret-0002",
  "998877665544", "887766554433",
  "https://www.ebay.co.uk/itm/998877665544",
  OWNER, STRANGER, "7777", "cost-secret"
];
const checkouts = [
  {
    id: "co-uuid-secret-0001", user_id: OWNER, sku: "SKU-SECRET-A50", stack_name: "Stack Secret",
    event: "Event Secret London", note: "note-secret", hide_error: "hide-error-secret",
    ebay_item_id: "998877665544", sold_price_pence: 7777, cost: "cost-secret",
    title: "Pokemon Card Gengar VMAX 020/198 Chilling Reign NM", sticker_pence: 4000
  },
  {
    id: "co-uuid-secret-0002", user_id: OWNER, sku: "SKU-SECRET-B7", stack_name: "Stack Secret",
    event: "Event Secret London", note: "note-secret",
    title: "Umbreon VMAX 215/203 Evolving Skies", sticker_pence: null
  }
];
const listings = [
  // The photo for the Gengar in the box, and a card that is only listed.
  { ebay_item_id: "998877665544", user_id: OWNER, sku: "SKU-SECRET-A50", title: "Gengar VMAX 020/198", price_value: 45, quantity: 1,
    image_url: "https://i.ebayimg.com/images/g/abc/s-l140.jpg", url: "https://www.ebay.co.uk/itm/998877665544" },
  { ebay_item_id: "887766554433", user_id: OWNER, sku: "SKU-LISTED-C9", title: "Charizard ex 199/165 151", price_value: 120, quantity: 2,
    image_url: "https://i.ebayimg.com/images/g/def/s-l140.jpg", url: "https://www.ebay.co.uk/itm/887766554433" },
  // A sold shell: eBay leaves it in the ActiveList at quantity zero.
  { ebay_item_id: "111", user_id: OWNER, sku: "SKU-SOLD", title: "Mew ex 151/165", price_value: 9, quantity: 0, image_url: null }
];

// --- The projection ------------------------------------------------------
{
  const stock = storefrontStock(checkouts, listings, { includeOnline: true });
  const json = JSON.stringify(stock);
  for (const p of PRIVATE) ok(!json.includes(p), `a private value reached the storefront payload: ${p}`);
  ok(stock.box === 2, `two cards in the box, got ${stock.box}`);
  ok(stock.online === 1, `one card only listed online (the in-box one and the sold shell kept out), got ${stock.online}`);
  ok(!json.includes("Mew"), "a sold shell (quantity 0) reached the storefront");
  for (const c of stock.cards) {
    ok(JSON.stringify(Object.keys(c)) === JSON.stringify(STOREFRONT_FIELDS), `card keys drifted: ${Object.keys(c).join(",")}`);
    for (const cp of c.copies) ok(JSON.stringify(Object.keys(cp)) === JSON.stringify(STOREFRONT_COPY_FIELDS), `copy keys drifted: ${Object.keys(cp).join(",")}`);
    ok(/^(box|online)-\d+$/.test(c.key), `a card key is not source-and-position: ${c.key}`);
  }
  const gengar = stock.cards.find((c) => /gengar/i.test(c.name));
  ok(gengar && gengar.image && /s-l500/.test(gengar.image), "the box card did not pick up the photo off its own listing, at pocket size");
  ok(gengar && gengar.priceText === "£40", `the sticker, not the eBay price, is a box card's price: got ${gengar?.priceText}`);
  const umbreon = stock.cards.find((c) => /umbreon/i.test(c.name));
  ok(umbreon && umbreon.priceText === ASK_TEXT && umbreon.pricePence == null, "a held (unstickered) price must ask, not show a number");
  ok(gengar && !/pokemon card/i.test(gengar.name), "the name was not cleaned for a customer");

  const boxOnly = storefrontStock(checkouts, listings, { includeOnline: false });
  ok(boxOnly.online === 0 && boxOnly.box === 2, "a link without the online stock still showed listings");
  ok(boxOnly.cards.find((c) => /gengar/i.test(c.name))?.image, "leaving the online stock out also lost the box card's photo");

  // An unnameable checkout is keyed by its id inside binder.js; that key must
  // not survive to a stranger.
  const bare = storefrontStock([{ id: "co-uuid-secret-0001", sku: "SKU-SECRET-A50", title: "" }], [], {});
  ok(!JSON.stringify(bare).includes("co-uuid-secret-0001"), "an untitled checkout's id leaked through the card key");

  // Spread-and-delete would carry an unknown field; the allow-list cannot.
  const card = storefrontCard({ source: "box", name: "X", copies: [{ id: "998877665544", condition: "NM", pricePence: 100, sku: "SKU-SECRET-A50" }], stack_name: "Stack Secret" }, 0);
  ok(!JSON.stringify(card).includes("SECRET") && !JSON.stringify(card).includes("998877665544"), "storefrontCard() passes through fields nobody allowed");
}

// --- The browser's view over projected cards -----------------------------
{
  const many = [];
  for (let i = 0; i < 11; i++) many.push({ key: `box-${i}`, source: BOX, name: `Card ${String.fromCharCode(65 + i)} ${i}/100`, pricePence: (i + 1) * 100, priceText: "", copies: [] });
  for (let i = 0; i < 2; i++) many.push({ key: `online-${i}`, source: ONLINE, name: `Listed ${i}`, pricePence: null, priceText: ASK_TEXT, copies: [] });
  const v = storefrontView(many, {});
  ok(v.pages.every((p) => p.length === BINDER_PAGE), "a storefront page is not nine pockets");
  ok(v.pageCount === 3, `11 box + 2 online should be 2 box pages and 1 online page, got ${v.pageCount}`);
  ok(JSON.stringify(v.pageKinds) === JSON.stringify([BOX, BOX, ONLINE]), `sections shared a page: ${v.pageKinds}`);
  ok(v.pages.every((p, i) => p.every((c) => c == null || c.source === v.pageKinds[i])), "a page carries a card from the other section");
  const cheap = storefrontView(many, { sort: "value-asc" });
  ok(cheap.pages[0][0].pricePence === 100, "cheapest first does not start at the cheapest");
  const dear = storefrontView(many, { sort: "value-desc", scope: "all" });
  ok(dear.pages[dear.pageCount - 1].filter(Boolean).every((c) => c.pricePence == null), "an unpriced card did not sort last");
  ok(storefrontView(many, { query: "card c 2" }).shown === 1, "search by name and number found the wrong count");
  ok(storefrontView(many, { scope: BOX }).online === 0, "scope 'box' still showed listed cards");
  ok(storefrontView(many, { price: "ask" }).shown === 2, "the ask filter did not find the unpriced cards");
  ok(!cardMatches({ name: "Gengar VMAX 020/198" }, "SKU-SECRET-A50"), "a stranger's search matched on something that is not the name");
}

// --- Tokens and expiry ---------------------------------------------------
{
  const a = newToken(), b = newToken();
  ok(a !== b, "two tokens came out the same");
  ok(isWellFormedToken(a) && a.length >= 22, `a new token is short or malformed: ${a}`);
  ok(!isWellFormedToken("short") && !isWellFormedToken("../../etc/passwd-aaaaaaaaaaaaa") && !isWellFormedToken(null), "a junk token passed the shape check");
  const now = new Date("2026-09-24T12:00:00Z");
  ok(storefrontStatus({}, now) === "live", "a link with no expiry and no switch-off is not live");
  ok(storefrontStatus({ revoked_at: "2026-09-24T11:00:00Z", expires_at: "2027-01-01T00:00:00Z" }, now) === "off", "a switched-off link is still live");
  ok(storefrontStatus({ expires_at: "2026-09-24T11:59:59Z" }, now) === "expired", "an expired link is still live");
  ok(expiresAtFor(0, now) === null, "'until I switch it off' set an expiry");
  ok(expiresAtFor(3, now) === "2026-09-27T12:00:00.000Z", `three days is not three days: ${expiresAtFor(3, now)}`);
  ok(storefrontUrl("https://x.test/", "abc") === "https://x.test/show/abc", "the storefront URL is wrong");
}

// --- The loader, against a fake service-role client ----------------------
function fakeAdmin({ link, checkoutsError = null, missingTable = false } = {}) {
  const calls = [];
  const tables = { stock_checkouts: checkouts, ebay_listings: listings };
  const client = {
    calls,
    from(table) {
      const q = { table, filters: [], select: null };
      calls.push(q);
      const b = {
        select(cols) { q.select = cols; return b; },
        eq(col, val) { q.filters.push(["eq", col, val]); return b; },
        is(col, val) { q.filters.push(["is", col, val]); return b; },
        order() { return b; },
        async maybeSingle() {
          if (missingTable) return { data: null, error: { code: "42P01", message: 'relation "public.show_storefronts" does not exist' } };
          const tok = q.filters.find((f) => f[1] === "token")?.[2];
          return { data: link && link.token === tok ? link : null, error: null };
        },
        async range(from) {
          if (table === "stock_checkouts" && checkoutsError) return { data: null, error: checkoutsError };
          // Honour the owner filter, as RLS would not.
          const uid = q.filters.find((f) => f[1] === "user_id")?.[2];
          const rows = (tables[table] || []).filter((r) => uid == null || r.user_id === uid);
          return { data: from === 0 ? rows : [], error: null };
        }
      };
      return b;
    },
    rpc(name, args) { calls.push({ rpc: name, args }); return Promise.resolve({ data: null, error: null }); }
  };
  return client;
}

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const LINK = { id: "link-1", user_id: OWNER, token: TOKEN, title: "Glasgow table", event: "Event Secret London", include_online: true, expires_at: null, revoked_at: null };

{
  const admin = fakeAdmin({ link: LINK });
  const r = await loadPublicStorefront(admin, TOKEN, { now: new Date("2026-09-24T12:00:00Z") });
  ok(r.ok, `a live link did not load: ${JSON.stringify(r)}`);
  const json = JSON.stringify(r);
  for (const p of PRIVATE) ok(!json.includes(p), `the loader's output carries a private value: ${p}`);
  ok(!json.includes(TOKEN), "the loader echoes the token back into the page");
  const reads = admin.calls.filter((c) => c.table && c.table !== "show_storefronts");
  ok(reads.length >= 2, "the loader did not read the checkouts and the listings");
  for (const c of reads) {
    ok(c.filters.some((f) => f[0] === "eq" && f[1] === "user_id" && f[2] === OWNER), `a service-role read of ${c.table} is not filtered on the link owner`);
    ok(c.select && c.select !== "*" && !/\*/.test(c.select), `a service-role read of ${c.table} selects *`);
  }
  const co = reads.find((c) => c.table === "stock_checkouts");
  ok(co?.filters.some((f) => f[0] === "is" && f[1] === "resolved_at" && f[2] === null), "the storefront read resolved checkouts — sold and returned cards would show");
  ok(co?.filters.some((f) => f[0] === "eq" && f[1] === "event"), "a link for one show did not filter on its event");
  ok(admin.calls.some((c) => c.rpc === "storefront_hit" && c.args?.p_id === "link-1"), "the view was not counted");
  ok(r.storefront.title === "Glasgow table", "the heading did not arrive");
  ok(!("event" in r.storefront), "the event name — our word for the trip — went to the visitor");
}
{
  const at = new Date("2026-09-24T12:00:00Z");
  const off = await loadPublicStorefront(fakeAdmin({ link: { ...LINK, revoked_at: "2026-09-24T10:00:00Z" } }), TOKEN, { now: at });
  ok(!off.ok && off.reason === "ended" && !off.stock, "a switched-off link served stock");
  const gone = await loadPublicStorefront(fakeAdmin({ link: { ...LINK, expires_at: "2026-09-23T00:00:00Z" } }), TOKEN, { now: at });
  ok(!gone.ok && gone.reason === "ended", "an expired link served stock");
  const unknown = await loadPublicStorefront(fakeAdmin({ link: LINK }), "ZZZZZZZZZZZZZZZZZZZZZZ", { now: at });
  ok(!unknown.ok && unknown.reason === "not-found", "an unknown token did not come back not-found");
  const junkAdmin = fakeAdmin({ link: LINK });
  const junk = await loadPublicStorefront(junkAdmin, "x", { now: at });
  ok(!junk.ok && junkAdmin.calls.length === 0, "a malformed token reached the database");
  const pending = await loadPublicStorefront(fakeAdmin({ link: LINK, missingTable: true }), TOKEN, { now: at });
  ok(!pending.ok && pending.reason === "not-found", "migration 029 pending should read as not-found, not throw");
  const broken = await loadPublicStorefront(fakeAdmin({ link: LINK, checkoutsError: { message: "boom" } }), TOKEN, { now: at });
  ok(!broken.ok && broken.reason === "error", "a failed read of the box served an empty binder as if it were the answer");
}
ok(!CHECKOUT_COLUMNS.includes("*") && !/note|hide_error|sold_price|stack_name|event/.test(CHECKOUT_COLUMNS), `the checkout read asks for columns the projection never uses: ${CHECKOUT_COLUMNS}`);

// --- The QR ---------------------------------------------------------------
{
  const m = qrMatrix("https://comp-finder-alpha.vercel.app/show/AbCdEfGhIjKlMnOpQrStUv");
  ok(m.length >= 21 && m.every((r) => r.length === m.length), "the QR is not a square of modules");
  // The three finder patterns: a dark 7x7 ring in three corners.
  const n = m.length;
  const finder = (r0, c0) => [0, 6].every((k) => [0, 1, 2, 3, 4, 5, 6].every((j) => m[r0 + k][c0 + j] && m[r0 + j][c0 + k]));
  ok(finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0), "the QR has no finder patterns — a phone will not find it");
  ok(qrPath("x").size === qrMatrix("x").length + 8, "the QR has no quiet zone");
}

// --- Greps ----------------------------------------------------------------
{
  const page = src("apps/app/app/show/[token]/page.js");
  ok(/index:\s*false/.test(page) && /follow:\s*false/.test(page), "the storefront page is indexable — the URL is the key");
  ok(/referrer:\s*"no-referrer"/.test(page), "the storefront page sends a Referer — every eBay image request would carry the token");
  ok(/loadPublicStorefront\(/.test(page) && !/\.from\(/.test(page), "the page reads a table itself instead of going through loadPublicStorefront()");

  const comp = src("apps/app/app/show/[token]/Storefront.js");
  ok(!/supabase|createClient|ShowDesk|DealBar|deal\.js|stackpos|placeOf|copyLocations/i.test(comp), "the visitor's component reaches for a database or desk code");
  ok(!/\bsku\b/i.test(comp), "the visitor's component names a SKU");

  const mw = src("apps/app/middleware.js");
  const prot = mw.match(/PROTECTED_PATHS\s*=\s*\[([^\]]*)\]/)?.[1] || "";
  ok(prot && !/"\/show|"\/"/.test(prot), "the storefront is behind the login wall — nobody at a show is signed in");

  const store = src("apps/app/lib/storefront-store.js");
  ok(!/select\(\s*"\*"\s*\)/.test(store), "storefront-store.js selects * somewhere");
  const named = ["apps/app/app/panel/ShowDesk.js", "apps/app/app/panel/StorefrontPanel.js", "apps/app/app/show/[token]/page.js", "apps/app/app/show/[token]/Storefront.js", "apps/app/lib/storefront.js"]
    .filter((f) => /["'`]show_storefronts["'`]/.test(src(f)));
  ok(named.length === 0, `show_storefronts is named outside storefront-store.js: ${named.join(", ")}`);

  const mig = src("supabase/migrations/029_show_storefronts.sql");
  ok(/revoke all on function public\.storefront_hit/.test(mig), "storefront_hit is callable with the anon key — anybody could inflate the view count");
  ok(!/for select using \(true\)|to anon/i.test(mig), "migration 029 opens show_storefronts to anon");

  const desk = src("apps/app/app/panel/ShowDesk.js");
  ok(/customerMode \? null : <StorefrontPanel/.test(desk), "the link panel renders on a customer screen — the switch-off button would face them");
  const qrLib = src("apps/app/lib/qr.js");
  ok(!/https?:\/\//.test(qrLib.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")), "qr.js calls out to a service — every token we print would be handed to it");
}

if (failures > 0) {
  console.error(`\ncheck-storefront: ${failures} failure(s) across ${checks} checks`);
  process.exit(1);
}
console.log(`check-storefront: ${checks} checks passed`);
