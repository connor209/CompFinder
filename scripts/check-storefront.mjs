/**
 * The storefront: our stock behind the QR on the table, on a stranger's phone.
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
 * - The page opens on a slice (the dearest cards and the filters), never the
 *   whole inventory — that was the slow QR. A search comes a page at a time,
 *   the sections never interleave, a set is only ever asked for inside its
 *   game, and a stranger's search reads the name and not the SKU.
 * - Greps: noindex and no-referrer on the page, no Supabase client in the
 *   component a visitor runs, the table named in one file, and the route left
 *   out of the middleware's login wall.
 */
import { readFileSync } from "node:fs";
import {
  storefrontStock, storefrontSearch, storefrontLanding, storefrontCard, cardMatches,
  STOREFRONT_FIELDS, STOREFRONT_COPY_FIELDS, BOX, ONLINE, ASK_TEXT,
  storefrontFacets, priceMatches, searchCriteria, searchQueryString, SEARCH_KEYS,
  STOREFRONT_PAGE, FEATURED_PER_SECTION
} from "../apps/app/lib/storefront.js";
import { buildSetGameIndex } from "../apps/app/lib/games.js";
import {
  wishKey, wishItem, toggleWish, reconcileWishlist, cleanWishlist, removeWish,
  loadWishlist, saveWishlist, wishStorageKey, WISH_FIELDS, WISHLIST_MAX,
  wishCode, wishCodes, wishHandoffUrl, parseWishCodes, matchWishCodes, WISH_HANDOFF_PATH
} from "../apps/app/lib/wishlist.js";
import { binderView } from "../apps/app/lib/binder.js";
import { buildSetIndex } from "@compfinder/core/setmatch.js";
import {
  loadPublicStorefront, loadPublicStorefrontCached, newToken, isWellFormedToken, storefrontStatus, expiresAtFor,
  storefrontUrl, CHECKOUT_COLUMNS, LISTING_COLUMNS, newStorefrontRow, isShopLink, SHOP, SHOW
} from "../apps/app/lib/storefront-store.js";
import { qrMatrix, qrPath } from "../apps/app/lib/qr.js";

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
  ok(gengar && gengar.image && /s-l300/.test(gengar.image), "the box card did not pick up the photo off its own listing, at the storefront's pocket size");
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

// --- One search, and the page it opens on --------------------------------
{
  const many = [];
  for (let i = 0; i < 40; i++) many.push({ key: `box-${i}`, source: BOX, name: `Card ${i} ${i}/100`, game: "pokemon", pricePence: (i + 1) * 100, priceText: "", copies: [] });
  for (let i = 0; i < 3; i++) many.push({ key: `online-${i}`, source: ONLINE, name: `Listed ${i}`, game: "pokemon", pricePence: null, priceText: ASK_TEXT, copies: [] });
  const first = storefrontSearch(many, {});
  ok(first.cards.length === STOREFRONT_PAGE && first.next === STOREFRONT_PAGE && first.shown === 43, `a search does not come a page at a time: ${first.cards.length}, next ${first.next}`);
  const rest = storefrontSearch(many, { offset: first.next });
  ok(rest.cards.length === 13 && rest.next === null, "the second page is not the rest");
  const all = [...first.cards, ...rest.cards];
  ok(new Set(all.map((c) => c.key)).size === 43, "paging a search skipped or repeated a card");
  // The sections are never merged: the whole of one, then the other.
  const firstOnline = all.findIndex((c) => c.source === ONLINE);
  ok(firstOnline === 40 && all.slice(firstOnline).every((c) => c.source === ONLINE), "a search interleaved the box with the stock at home");
  const shopAll = storefrontSearch(many, {}, { onlineFirst: true, limit: 100 }).cards;
  ok(shopAll[0].source === ONLINE && shopAll.slice(3).every((c) => c.source === BOX), "a shop search does not open on the stock at home");
  ok(first.cards[0].pricePence === 4000, "dearest first is not the default order");
  const dear = storefrontSearch(many, { sort: "value-desc" }, { limit: 100 }).cards.filter((c) => c.source === ONLINE);
  ok(dear.every((c) => c.pricePence == null), "an unpriced card did not sort last");
  ok(storefrontSearch(many, { sort: "value-asc" }).cards[0].pricePence === 100, "cheapest first does not start at the cheapest");
  ok(storefrontSearch(many, { query: "card 39 39/100" }).shown === 1, "search by name and number found the wrong count");
  ok(storefrontSearch(many, { price: "ask" }).shown === 3, "the ask filter did not find the unpriced cards");
  ok(!cardMatches({ name: "Gengar VMAX 020/198" }, "SKU-SECRET-A50"), "a stranger's search matched on something that is not the name");

  // The landing is a slice, not the inventory: that was the slow first load.
  const land = storefrontLanding({ cards: many, box: 40, online: 3 });
  ok(land.featured.length === FEATURED_PER_SECTION, `the front page is not the dearest few: ${land.featured.length}`);
  ok(land.featured[0].pricePence === 4000 && land.featured.every((c) => c.pricePence != null), "the front page does not open on the dearest priced cards");
  ok(land.box === 40 && land.online === 3, "the front page lost the stock counts");
  ok(JSON.stringify(Object.keys(land)) === JSON.stringify(["featured", "facets", "box", "online"]), `the landing carries more than it should: ${Object.keys(land)}`);

  // Only the search's own keys go up, and only they are read back.
  const qs = searchQueryString({ query: " gengar ", game: "pokemon", set: "Chilling Reign", price: "u5", condition: "", sort: "value-desc", wish: ["box:gengar"], list: "x" }, 30);
  const keys = [...new URLSearchParams(qs).keys()];
  ok(keys.every((k) => SEARCH_KEYS.includes(k) || k === "offset"), `a search sends keys nobody allowed: ${keys}`);
  ok(!/wish|gengar.*box/.test(qs.replace("q=gengar", "")), `the wish list rode along with a search: ${qs}`);
  ok(!new URLSearchParams(searchQueryString({ set: "Chilling Reign" })).has("set"), "a set was sent without its game");
  const back = searchCriteria(new URLSearchParams(qs));
  ok(back.query === "gengar" && back.game === "pokemon" && back.set === "Chilling Reign" && back.price === "u5" && back.offset === 30, `the search did not survive the URL: ${JSON.stringify(back)}`);
  const junk = searchCriteria(new URLSearchParams("price=free&sort=evil&offset=-4"));
  ok(junk.price === "any" && junk.sort === "value-desc" && junk.offset === 0, `junk criteria were acted on: ${JSON.stringify(junk)}`);
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
function fakeAdmin({ link, checkoutsError = null, missingTable = false, missingKind = false } = {}) {
  const calls = [];
  const tables = {
    stock_checkouts: checkouts,
    ebay_listings: listings,
    cm_sets: [{ set_name: "Chilling Reign", set_code: "CRE" }, { set_name: "Evolving Skies", set_code: "EVS" }, { set_name: "151", set_code: "MEW" }]
  };
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
          if (missingKind && /\bkind\b/.test(q.select || "")) return { data: null, error: { code: "42703", message: "column show_storefronts.kind does not exist" } };
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
  // cm_sets is the public catalogue — the one read with no owner, and it may
  // ask for nothing but set names, codes and the game a set belongs to (the
  // Show Desk's game chips share this loader). An allow-list of columns, not
  // "anything in the view", for the same reason every projection here is one.
  const SET_COLUMNS = new Set(["game", "set_name", "set_code"]);
  const setReads = admin.calls.filter((c) => c.table === "cm_sets");
  for (const c of setReads) {
    const cols = String(c.select || "").split(",").map((x) => x.trim());
    ok(cols.length > 0 && cols.every((x) => SET_COLUMNS.has(x)), `the set-list read asks for more than catalogue columns: ${c.select}`);
  }
  const reads = admin.calls.filter((c) => c.table && c.table !== "show_storefronts" && c.table !== "cm_sets");
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
  const g = r.stock.cards.find((c) => /gengar/i.test(c.name));
  ok(g?.set === "Chilling Reign", `the loader did not read the set out of the title: ${g?.set}`);
  const u = r.stock.cards.find((c) => /umbreon/i.test(c.name));
  ok(u?.set === "Evolving Skies", `the loader did not read the set out of the title: ${u?.set}`);
}
{
  // A search is not a visit, and it reads the inventory at most once a minute.
  const admin = fakeAdmin({ link: LINK });
  const at = new Date("2026-09-24T12:00:00Z");
  const inventory = () => admin.calls.filter((c) => c.table === "stock_checkouts" || c.table === "ebay_listings").length;
  const one = await loadPublicStorefrontCached(admin, TOKEN, { now: at });
  const reads = inventory();
  const two = await loadPublicStorefrontCached(admin, TOKEN, { now: new Date(at.getTime() + 30000) });
  ok(one.ok && two.ok && inventory() === reads, "a second search inside the minute read the inventory again");
  ok(!admin.calls.some((c) => c.rpc === "storefront_hit"), "a search counted as a view");
  await loadPublicStorefrontCached(admin, TOKEN, { now: new Date(at.getTime() + 61000) });
  ok(inventory() > reads, "a search a minute later served the old stock");
  const offAdmin = fakeAdmin({ link: { ...LINK, revoked_at: "2026-09-24T10:00:00Z" } });
  const off = await loadPublicStorefrontCached(offAdmin, TOKEN, { now: new Date(at.getTime() + 62000) });
  ok(!off.ok, "a link switched off within the minute still answered searches");
  const lr = admin.calls.find((c) => c.table === "ebay_listings");
  ok(/extra->>category/.test(lr?.select || "") && !/(^|,)extra(,|$)/.test(lr?.select || ""), `the listings read takes the whole extra blob, or no category: ${lr?.select}`);
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
// --- A shop link: the whole stock, for good --------------------------------
{
  const at = new Date("2026-09-24T12:00:00Z");
  // A shop row edited by hand to look like a narrow show link must still
  // serve everything: the QR is already in somebody's wallet.
  const SHOP_LINK = { ...LINK, kind: SHOP, event: "Event Secret London", include_online: false };
  const admin = fakeAdmin({ link: SHOP_LINK });
  const r = await loadPublicStorefront(admin, TOKEN, { now: at });
  ok(r.ok && r.storefront.shop === true, "a shop link did not load as a shop");
  ok(r.storefront.includeOnline === true && r.stock.online === 1, `a shop link left the online stock out: ${r.stock?.online}`);
  ok(r.stock.box === 2, `a shop link left out the cards away at a show: ${r.stock?.box}`);
  const co = admin.calls.find((c) => c.table === "stock_checkouts");
  ok(!co?.filters.some((f) => f[1] === "event"), "a shop link was narrowed to one show's event");
  const json = JSON.stringify(r);
  for (const p of PRIVATE) ok(!json.includes(p), `a shop link's payload carries a private value: ${p}`);
  const off = await loadPublicStorefront(fakeAdmin({ link: { ...SHOP_LINK, revoked_at: "2026-09-24T10:00:00Z" } }), TOKEN, { now: at });
  ok(!off.ok && off.reason === "ended" && off.shop === true && !off.stock, "a switched-off shop link served stock, or did not say it was a shop");

  // Before 032 there is no kind column: every link is a show link, and none breaks.
  const pre = await loadPublicStorefront(fakeAdmin({ link: LINK, missingKind: true }), TOKEN, { now: at });
  ok(pre.ok && pre.storefront.shop === false, "a database without 032 stopped serving show links");
  const show = await loadPublicStorefront(fakeAdmin({ link: LINK }), TOKEN, { now: at });
  ok(show.ok && show.storefront.shop === false, "a link with no kind read as a shop");

  const sr = newStorefrontRow(OWNER, { kind: SHOP, event: "Glasgow", includeOnline: false, days: 3 }, at);
  ok(sr.kind === SHOP && sr.event === null && sr.include_online === true && sr.expires_at === null, `a new shop link is not the whole stock for good: ${JSON.stringify(sr)}`);
  const sh = newStorefrontRow(OWNER, { kind: SHOW, event: "Glasgow", includeOnline: false, days: 3 }, at);
  ok(!("kind" in sh), "a show link names the kind column, so it cannot be made before 032");
  ok(sh.event === "Glasgow" && sh.include_online === false && sh.expires_at === "2026-09-27T12:00:00.000Z", "a show link lost its own settings");
  ok(isShopLink({ kind: SHOP }) && !isShopLink({}) && !isShopLink({ kind: SHOW }), "isShopLink() misreads a row");

  const mixed = [];
  for (let i = 0; i < 10; i++) mixed.push({ key: `box-${i}`, source: BOX, name: `Box ${i}`, pricePence: 100, priceText: "", copies: [] });
  for (let i = 0; i < 3; i++) mixed.push({ key: `online-${i}`, source: ONLINE, name: `Listed ${i}`, pricePence: 100, priceText: "", copies: [] });
  ok(storefrontLanding({ cards: mixed }, { onlineFirst: true }).featured[0].source === ONLINE, "a shop's front page does not open on the stock at home");
  ok(storefrontSearch(mixed, { query: "listed 2" }, { onlineFirst: true }).shown === 1, "a shop search did not reach the stock at home");
}

// --- Paged reads: the rest of the pages at once, and none of them missed -----
{
  const many = Array.from({ length: 2500 }, (_, i) => ({ ebay_item_id: String(100000 + i), user_id: OWNER, sku: `P${i}`, title: `Card ${i} ${i}/2500`, price_value: 1 + (i % 50), quantity: 1 }));
  let inFlight = 0, peak = 0;
  const admin = {
    from(table) {
      const q = { filters: [], opts: null };
      const b = {
        select(cols, opts) { q.opts = opts; return b; },
        eq(c, v) { q.filters.push([c, v]); return b; }, is() { return b; }, order() { return b; },
        async maybeSingle() { return { data: table === "show_storefronts" ? LINK : null, error: null }; },
        async range(from, to) {
          inFlight++; peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          const rows = table === "ebay_listings" ? many : [];
          return { data: rows.slice(from, to + 1), error: null, count: q.opts?.count === "exact" ? rows.length : null };
        }
      };
      return b;
    },
    rpc() { return Promise.resolve({ data: null, error: null }); }
  };
  const r = await loadPublicStorefront(admin, TOKEN, { now: new Date("2026-09-24T12:00:00Z"), loadSets: async () => ({ index: null }) });
  ok(r.ok && r.stock.online === 2500, `a paged read lost or doubled rows: ${r.stock?.online} of 2500`);
  ok(peak >= 2, "the pages after the first were read one after another, not at once");
  ok(r.timing && Number.isFinite(r.timing.readMs) && !("timing" in storefrontLanding(r.stock)), "the loader's timing is missing, or reached the page");
}

ok(!CHECKOUT_COLUMNS.includes("*") && !/note|hide_error|sold_price|stack_name|event/.test(CHECKOUT_COLUMNS), `the checkout read asks for columns the projection never uses: ${CHECKOUT_COLUMNS}`);

// --- Sets, filters -----------------------------------------------------------
{
  const index = buildSetIndex([{ set_name: "Chilling Reign", set_code: "CRE" }, { set_name: "Evolving Skies", set_code: "EVS" }]);
  const { matchSetFromTitle } = await import("@compfinder/core/setmatch.js");
  const setOf = (t) => matchSetFromTitle(t, index);
  const rows = [
    { id: "a", sku: "S1", title: "Gengar VMAX 020/198 Chilling Reign", sticker_pence: 500 },
    // No set in the checkout's own title: it comes off the listing.
    { id: "b", sku: "S2", title: "Umbreon VMAX 215/203", sticker_pence: 9000 },
    { id: "c", sku: "S3", title: "Mystery Card 1/2", sticker_pence: null }
  ];
  const lst = [{ ebay_item_id: "1", sku: "S2", title: "Umbreon VMAX 215/203 Evolving Skies Alt Art", price_value: 99, quantity: 1 }];
  const st = storefrontStock(rows, lst, { includeOnline: false, setOf });
  const by = (re) => st.cards.find((c) => re.test(c.name));
  ok(by(/gengar/i)?.set === "Chilling Reign", "the set was not read off the checkout's title");
  ok(by(/umbreon/i)?.set === "Evolving Skies", "a checkout with no set in its title did not fall back to its listing's");
  ok(by(/mystery/i)?.set === null, "a card nothing names was given a set");
  const f = storefrontFacets(st.cards);
  ok(JSON.stringify((f.sets.unknown || []).map((x) => x.name)) === JSON.stringify(["Chilling Reign", "Evolving Skies"]), `set facets wrong: ${JSON.stringify(f.sets)}`);
  const view = (c) => storefrontSearch(st.cards, c, { limit: 100 });
  ok(view({ game: "unknown", set: "Chilling Reign" }).shown === 1, "the set filter did not narrow to one set");
  ok(view({ set: "Chilling Reign" }).shown === 3, "a set with no game narrowed the search — the dropdown never sends one");
  ok(view({ query: "evolving" }).shown === 1, "search does not look at the set name");
  ok(view({ price: "u5" }).shown === 0 && view({ price: "5-20" }).shown === 1, "£5 sits in the wrong band");
  ok(view({ price: "50-100" }).shown === 1, "£90 is not in £50–£100");
  ok(!priceMatches({ pricePence: null }, "u5"), "a card with no price counted as under £5");
  ok(view({ price: "ask" }).shown === 1, "the ask filter lost the unpriced card");
  const nm = [{ key: "box-0", source: BOX, name: "A", condition: "Near Mint", pricePence: 100, copies: [{ condition: "Near Mint" }, { condition: "Lightly Played" }] }];
  ok(storefrontSearch(nm, { condition: "Lightly Played" }).shown === 1, "a pocket holding an LP copy is hidden from the LP filter");
  // The game: eBay's category, then the title, then a set only one game uses —
  // and a box card borrows its listing's category. Sets are offered per game.
  {
    const gi = buildSetGameIndex([{ game: "pokemon", set_name: "Chilling Reign" }, { game: "magic", set_name: "Dominaria United" }]);
    const gRows = [
      { id: "a", sku: "G1", title: "Gengar VMAX 020/198 Chilling Reign", sticker_pence: 500 },
      { id: "b", sku: "G2", title: "Sheoldred 107/281", sticker_pence: 9000 }
    ];
    const gLst = [
      { ebay_item_id: "1", sku: "G2", title: "Sheoldred 107/281", category: "Magic: The Gathering Individual Cards", price_value: 99, quantity: 1 },
      { ebay_item_id: "2", sku: "G3", title: "Dark Magician LOB-EN005", price_value: 5, quantity: 1 }
    ];
    const gs = storefrontStock(gRows, gLst, { includeOnline: true, gameIndex: gi, setOf });
    const by = (re) => gs.cards.find((c) => re.test(c.name));
    ok(by(/gengar/i)?.game === "pokemon", `a set only Pokémon uses did not make the card Pokémon: ${by(/gengar/i)?.game}`);
    ok(by(/sheoldred/i)?.game === "magic", `a box card did not borrow its listing's eBay category: ${by(/sheoldred/i)?.game}`);
    ok(by(/dark magician/i)?.game === "yugioh", `a Yu-Gi-Oh code did not read as Yu-Gi-Oh: ${by(/dark magician/i)?.game}`);
    const gf = storefrontFacets(gs.cards);
    ok(gf.games.map((g) => g.slug).join(",") === "pokemon,magic,yugioh", `game facets wrong: ${JSON.stringify(gf.games)}`);
    ok(JSON.stringify(Object.keys(gf.sets)) === JSON.stringify(["pokemon"]) && gf.sets.pokemon[0].name === "Chilling Reign", `a set was offered outside its game: ${JSON.stringify(gf.sets)}`);
    ok(storefrontSearch(gs.cards, { game: "magic" }).shown === 1, "the game filter did not narrow to one game");
    ok(storefrontSearch(gs.cards, { game: "magic", set: "Chilling Reign" }).shown === 0, "a set from another game matched inside this one");
  }
  const none = storefrontStock(rows, lst, { includeOnline: false });
  ok(none.cards.every((c) => c.set === null), "with no catalogue, cards should carry no set rather than guess");
}

// --- The visitor's list ------------------------------------------------------
{
  const g = { key: "box-4", source: BOX, name: "Gengar VMAX 020/198", set: "Chilling Reign", condition: "Near Mint", pricePence: 4000, priceText: "£40", priceFrom: false, image: "https://i.ebayimg.com/x/s-l500.jpg", copies: [] };
  const u = { key: "box-7", source: BOX, name: "Umbreon VMAX 215/203", set: null, condition: null, pricePence: null, priceText: ASK_TEXT, priceFrom: false, image: null, copies: [] };
  let l = toggleWish([], g, 1).list;
  l = toggleWish(l, u, 2).list;
  ok(l.length === 2 && l[0].id === wishKey(u), "the newest card is not first on the list");
  ok(JSON.stringify(Object.keys(l[0])) === JSON.stringify(WISH_FIELDS), `a list item carries fields nobody allowed: ${Object.keys(l[0])}`);
  ok(toggleWish(l, g).list.length === 1, "tapping ♡ again did not take the card off");
  // Positions move when stock changes; the list must follow the CARD.
  const moved = [{ ...g, key: "box-0", pricePence: 3500, priceText: "£35" }];
  const rec = reconcileWishlist(l, moved);
  const gr = rec.rows.find((r) => /gengar/i.test(r.name));
  ok(gr && !gr.gone && gr.pricePence === 3500, "the list did not follow a card whose position moved, or quoted the old price");
  ok(rec.rows.find((r) => /umbreon/i.test(r.name))?.gone === true, "a card that left the binder is not marked gone");
  ok(rec.totalPence === 3500 && rec.gone === 1, `a gone card counted in the total: ${rec.totalPence}`);
  const box = wishKey({ source: BOX, name: "Gengar" }), online = wishKey({ source: ONLINE, name: "Gengar" });
  ok(box !== online, "a card at the table and the same card online share one list entry");
  ok(cleanWishlist([null, 7, { id: "" }, { id: "box:x", name: "X" }, { id: "box:x", name: "dupe" }]).length === 1, "junk from storage was drawn");
  let full = [];
  for (let i = 0; i < WISHLIST_MAX; i++) full = toggleWish(full, { source: BOX, name: `Card ${i}` }).list;
  const over = toggleWish(full, { source: BOX, name: "One more" });
  ok(over.full && over.list.length === WISHLIST_MAX, "a full list silently dropped a card");
  ok(removeWish(l, wishKey(g)).length === 1, "remove did not remove");
  // Storage that throws (private mode) must never throw at the visitor.
  const bad = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  ok(loadWishlist(bad, "k").length === 0 && saveWishlist(bad, "k", l) === false, "storage that refuses broke the list");
  const mem = new Map();
  const ok2 = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  saveWishlist(ok2, "k", l);
  ok(loadWishlist(ok2, "k").length === 2, "the list did not survive a reload");
  ok(wishStorageKey("/show/AbC?x=1") === "cf-wish:/show/AbC", "two links could share a list, or a query string splits one");
}

// --- The list handed to us: a QR off their screen, scanned into the desk ----
{
  // The same rows seen two ways: the stranger's projected storefront, and the
  // desk's own binder pockets. A code made on one must land on the other.
  const rows = [
    { id: "co-1", sku: "A1", title: "Pokemon Card Gengar VMAX 020/198 Chilling Reign NM", sticker_pence: 4000 },
    { id: "co-2", sku: "A2", title: "Gengar VMAX 020/198 (Chilling Reign) LP", sticker_pence: 2500 },
    { id: "co-3", sku: "A3", title: "Umbreon VMAX 215/203", sticker_pence: null }
  ];
  const lst = [{ ebay_item_id: "887766554433", sku: "B9", title: "Charizard ex 199/165", price_value: 120, quantity: 1 }];
  const store = storefrontStock(rows, lst, { includeOnline: true });
  let wl = [];
  for (const c of store.cards) wl = toggleWish(wl, c).list;
  const codes = wishCodes(reconcileWishlist(wl, store.cards).rows);
  ok(codes.length === 3, `three cards picked should be three codes, got ${codes.length}`);
  const url = wishHandoffUrl("https://app.test", codes);
  ok(url.startsWith(`https://app.test${WISH_HANDOFF_PATH}?wish=`) && WISH_HANDOFF_PATH.startsWith("/panel/"), `the handoff does not land behind the login: ${url}`);
  for (const p of ["A1", "A2", "co-1", "887766554433", "B9"]) ok(!url.includes(p), `the handoff URL carries a private value: ${p}`);
  ok(url.length < 200, `a three-card handoff is too long to scan comfortably: ${url.length}`);
  const back = parseWishCodes(new URL(url).searchParams.get("wish"));
  ok(JSON.stringify(back) === JSON.stringify(codes), "the codes do not survive the URL");
  const desk = binderView(rows, { sort: "name", scope: "all" }, { listings: lst }).cards;
  const m = matchWishCodes(back, desk);
  ok(m.matched.length === 3 && m.missing.length === 0, `the desk did not find the cards the visitor picked: ${m.matched.length} found, ${m.missing.length} missing`);
  const g = m.matched.find((c) => /gengar/i.test(c.name));
  ok(g && g.copies.length === 2 && g.copies.every((cp) => cp.id), "the desk's match lost the copies it needs to locate and sell");
  // A card sold since they tapped ♡ is counted, not dropped.
  const gone = matchWishCodes(back, desk.filter((c) => !/umbreon/i.test(c.name)));
  ok(gone.missing.length === 1 && gone.matched.length === 2, "a card that has gone was not counted as missing");
  ok(parseWishCodes("abc.<script>.ABC.abc..toolongcode").join(",") === "abc", `junk in wish= was accepted: ${parseWishCodes("abc.<script>.ABC.abc..toolongcode")}`);
  ok(wishCode("box:gengar") === wishCode("box:gengar") && wishCode("box:gengar") !== wishCode("online:gengar"), "a card's code is not stable, or the two sections share one");
  const full = wishHandoffUrl("https://app.test", Array.from({ length: WISHLIST_MAX }, (_, i) => wishCode(`box:card ${i}`)));
  ok(full.length < 520, `a full list's QR is too dense to read off a screen: ${full.length} chars`);
}

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
  // One request, the search, and it is built by searchQueryString() — which
  // carries SEARCH_KEYS and nothing else. The list stays on their phone.
  const fetches = comp.match(/fetch\(/g) || [];
  ok(fetches.length === 1 && /fetch\(`\$\{[^`]*\}\/search\?\$\{searchQueryString\(criteria, offset\)\}`/.test(comp), "the visitor's component sends something other than the search");
  ok(!/XMLHttpRequest|sendBeacon|method:\s*"POST"/.test(comp), "the visitor's component sends something somewhere — the list is meant to stay on their phone");
  ok(!/\bstock=\{|stock\.cards/.test(src("apps/app/app/show/[token]/page.js")), "the page hands the whole stock to the browser again — that is what made the QR slow");
  const route = src("apps/app/app/show/[token]/search/route.js");
  ok(/loadPublicStorefrontCached\(/.test(route) && !/\.from\(/.test(route), "the search reads a table itself instead of going through the loader");
  ok(/searchCriteria\(/.test(route) && /storefrontSearch\(/.test(route), "the search acts on something other than searchCriteria()");
  const wl = src("apps/app/lib/wishlist.js");
  ok(!/fetch\(|supabase|sendBeacon/i.test(wl.replace(/\/\*[\s\S]*?\*\//g, "")), "wishlist.js reaches for a network or a database");

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
  ok(/customerMode \|\| wishCodesIn\.length === 0 \? null : \(\s*<WishPickup/.test(desk), "the visitor's scanned list renders on a customer screen — locations and deal buttons would face them");
  ok(/redirectedFrom", request\.nextUrl\.pathname \+ request\.nextUrl\.search/.test(mw), "a signed-out scan loses the list at the login wall");
  const login = src("apps/app/app/login/page.js");
  ok(/\^\\\/\(\?!\[\\\/\\\\\]\)/.test(login), "the login page follows redirectedFrom off the site");
  ok(/customerMode \? null : <StorefrontPanel/.test(desk), "the link panel renders on a customer screen — the switch-off button would face them");
  const qrLib = src("apps/app/lib/qr.js");
  ok(!/https?:\/\//.test(qrLib.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")), "qr.js calls out to a service — every token we print would be handed to it");
}

if (failures > 0) {
  console.error(`\ncheck-storefront: ${failures} failure(s) across ${checks} checks`);
  process.exit(1);
}
console.log(`check-storefront: ${checks} checks passed`);
