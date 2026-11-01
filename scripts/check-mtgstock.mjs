/**
 * Magic stock — one listing per card, the copies chaos-sorted in stacks.
 *
 *   node scripts/check-mtgstock.mjs      (or: npm run check)
 *
 * Every failure this pins is silent. A row whose condition went missing does
 * not error: it builds a different SKU and opens a second listing for a card
 * we already list. Two sets that slug alike would share one listing and ship
 * the wrong card. A SKU shaped like `MTG-A12` would be filed by the nightly
 * auto-import as one card at a stack position. And a pull sheet that takes
 * one copy each from two stacks when one stack held both looks perfectly
 * correct — it is just the long way round, every order, for ever.
 *
 * The pick-order fixture is the case that asked for this: Lightning Bolt, ten
 * copies — two in MTG-A, four in MTG-G, four in MTG-AZ — and an order for two.
 */
import { readFileSync } from "node:fs";
import {
  mtgIdentity, isMtgListingSku, isMtgItem, finishOf, numberKey, languageOf,
  planMtgIntake, listingFor, stackRowsFor, titleCouldBe, filePricePence, copiesOf
} from "../apps/app/lib/mtgstock.js";
import { allocateCopies, allocateLines, queuesBySku, pullPlanFor } from "../apps/app/lib/copyqueue.js";
import { stackFromSku } from "../apps/app/lib/stackpos.js";

let failures = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const ok = (label, v) => { if (!v) fail(`${label} — expected truthy, got ${JSON.stringify(v)}`); };
const no = (label, v) => { if (v) fail(`${label} — expected falsy, got ${JSON.stringify(v)}`); };

/** A CardUploader row, as extractItems() / restoreItems() hand it over. */
const row = (over = {}) => ({
  title: "MTG Lightning Bolt 146/249 Magic 2010 NM",
  cardName: "Lightning Bolt",
  cardNumber: "146/249",
  set: "Magic 2010",
  condition: "NM",
  game: "Magic: The Gathering",
  language: "English",
  graded: false,
  quantity: "1",
  startPrice: "2.49",
  images: [`https://cdn.carduploader.example/${Math.random().toString(36).slice(2)}.jpg`],
  ...over
});

// --- 1. which card a row is --------------------------------------------------
{
  const a = mtgIdentity(row());
  const b = mtgIdentity(row({ cardNumber: "0146", title: "Lightning Bolt M10 146 Magic the Gathering" }));
  ok("a clean row identifies", a.ok);
  eq("two copies of one card build one SKU, however the number was written", b.sku, a.sku);
  ok("…and that SKU is ours", isMtgListingSku(a.sku));

  const lp = mtgIdentity(row({ condition: "LP" }));
  const foil = mtgIdentity(row({ title: "MTG Lightning Bolt 146/249 Magic 2010 Foil NM" }));
  const ja = mtgIdentity(row({ language: "Japanese" }));
  const alt = mtgIdentity(row({ cardNumber: "146a" }));
  const otherSet = mtgIdentity(row({ set: "Magic 2011" }));
  for (const [what, other] of [["condition", lp], ["finish", foil], ["language", ja], ["collector number", alt], ["set", otherSet]]) {
    ok(`a different ${what} is a different listing`, other.ok && other.sku !== a.sku);
  }
  eq("'Non-Foil' in a title is the ordinary card", finishOf("Lightning Bolt Non-Foil NM"), "nonfoil");
  eq("'Non Foil' too", finishOf("Lightning Bolt Non Foil"), "nonfoil");
  eq("'Foil' is foil", finishOf("Lightning Bolt FOIL"), "foil");
  eq("'Etched Foil' is etched", finishOf("Sol Ring Etched Foil"), "etched");
  eq("a number's denominator is not part of it", numberKey("146/249"), "146");
  eq("leading zeros go", numberKey("007"), "7");
  eq("a lone zero stays", numberKey("0"), "0");
  eq("a letter stays", numberKey("146a"), "146A");
  eq("a blank language is English", languageOf({ language: "", title: "Lightning Bolt" }), "EN");
  eq("the title can name it", languageOf({ language: "", title: "Lightning Bolt Japanese" }), "JA");

  // Two sets whose names slug the same must never share a listing.
  const mh1 = mtgIdentity(row({ cardName: "Force of Negation", cardNumber: "52", set: "Modern Horizons" }));
  const mh1b = mtgIdentity(row({ cardName: "Force of Negation", cardNumber: "52", set: "Modern Horizons!" }));
  const mh2 = mtgIdentity(row({ cardName: "Force of Negation", cardNumber: "52", set: "Modern Horizons 2" }));
  ok("Modern Horizons and Modern Horizons 2 are two listings", mh1.sku !== mh2.sku);
  eq("punctuation in a set name is not a different set", mh1b.sku, mh1.sku);
  const long = mtgIdentity(row({ cardName: "Emrakul, the Aeons Torn and Something Longer" }));
  const long2 = mtgIdentity(row({ cardName: "Emrakul, the Aeons Torn and Something Else" }));
  ok("names that truncate alike still differ", long.sku !== long2.sku);
  ok("a SKU fits eBay's 50 characters", long.sku.length <= 50 && mtgIdentity(row({ language: "Chinese Traditional", title: "x Etched Foil", cardName: "Emrakul, the Aeons Torn" })).sku.length <= 50);
}

// --- 2. a SKU is never a stack position --------------------------------------
{
  for (const r of [row(), row({ condition: "DMG", title: "MTG Bolt Foil" }), row({ cardNumber: "1", cardName: "A" })]) {
    const sku = mtgIdentity(r).sku;
    eq(`stackFromSku leaves ${sku} alone`, stackFromSku(sku), null);
  }
  no("MTG-A12 is a stack position, not our SKU", isMtgListingSku("MTG-A12"));
  no("A50 is not ours", isMtgListingSku("A50"));
  no("YGO-A12 is not ours", isMtgListingSku("YGO-A12"));
  no("a blank is not ours", isMtgListingSku(""));
}

// --- 3. what is refused, and that it says why ---------------------------------
{
  const refuse = (label, r, word) => {
    const id = mtgIdentity(r);
    if (id.ok) return fail(`${label} — should be refused, built ${id.sku}`);
    if (word && !id.reason.toLowerCase().includes(word)) fail(`${label} — reason "${id.reason}" doesn't mention ${word}`);
  };
  refuse("a Pokémon row", row({ game: "Pokémon TCG" }), "pok");
  refuse("bare 'magic' in a title is Magic Cylinder, not MTG", row({ game: "", title: "Magic Cylinder LOB-EN104" }), "magic");
  refuse("a slab", row({ graded: true }), "graded");
  refuse("an unrecognised condition", row({ condition: "Unknown" }), "condition");
  refuse("a blank condition", row({ condition: "" }), "condition");
  refuse("CardUploader's set placeholder", row({ set: "Miscellaneous Cards & Products" }), "set");
  refuse("no set", row({ set: "" }), "set");
  refuse("no number", row({ cardNumber: "" }), "number");
  ok("a blank Game column with MTG in the title is Magic", isMtgItem({ game: "", title: "MTG Lightning Bolt" }));
  ok("'Magic: The Gathering' in the title too", mtgIdentity(row({ game: "", title: "Magic: The Gathering Lightning Bolt 146" })).ok);
}

// --- 4. the plan --------------------------------------------------------------
const BOLT = mtgIdentity(row()).sku;
{
  // Nothing listed, nothing filed: one new listing for three rows of one card.
  const r1 = row(); const r2 = row(); const r3 = row({ quantity: "2" });
  const p = planMtgIntake({ items: [r1, r2, r3], listings: [], stackCards: [] });
  eq("three rows of one card are one card", p.groups.length, 1);
  eq("…with four copies (a quantity-2 row is two)", p.groups[0].copies, 4);
  eq("…to create", p.groups[0].action, "create");
  eq("a quantity-2 row's photograph is claimed by its first copy only", p.groups[0].scans, [r1.images[0], r2.images[0], r3.images[0], null]);
  eq("CardUploader's £2.49 is not a price", p.groups[0].pricePence, null);
  eq("a real price in the file is kept", filePricePence({ startPrice: "0.99" }), 99);
  eq("a silly quantity is one", copiesOf({ quantity: "9999" }), 1);
}
{
  // A listing with our SKU exists: add to it.
  const listing = { ebay_item_id: "111", sku: BOLT, title: "Lightning Bolt", quantity: 6 };
  const p = planMtgIntake({ items: [row(), row()], listings: [listing], stackCards: [] });
  eq("an existing listing for the card is added to", p.groups[0].action, "add");
  eq("…the right one", p.groups[0].listing.ebay_item_id, "111");
  eq("SKU case is not a different listing",
    planMtgIntake({ items: [row()], listings: [{ ...listing, sku: BOLT.toLowerCase() }] }).groups[0].action, "add");

  // Listed a minute ago, not synced yet — the copies carry its item id.
  const fresh = planMtgIntake({ items: [row()], listings: [], stackCards: [{ id: "c1", sku: BOLT, ebay_item_id: "222", stack_id: "A" }] });
  eq("a listing not yet synced is found through its copies, not listed twice", [fresh.groups[0].action, fresh.groups[0].listing?.ebay_item_id], ["add", "222"]);

  // Two listings carrying one SKU: refuse rather than pick.
  const two = planMtgIntake({ items: [row()], listings: [listing, { ...listing, ebay_item_id: "333" }] });
  eq("two listings with one SKU are not guessed between", two.groups[0].action, "ambiguous");

  // A run whose eBay call fell over left copies with nothing behind them.
  const orphan = planMtgIntake({ items: [row()], listings: [], stackCards: [
    { id: "o1", sku: BOLT, ebay_item_id: null, stack_id: "A" },
    { id: "o2", sku: BOLT, ebay_item_id: null, stack_id: "A", pulled_at: "x" },
    { id: "o3", sku: "A50", ebay_item_id: null, stack_id: "A" }
  ] });
  eq("copies filed with no listing are counted into the new one (not pulled ones, not other SKUs)", orphan.groups[0].orphans, 1);
  eq("…and into its quantity", listingFor(orphan.groups[0], { pricePence: 99, title: "x" }).quantity, 2);
}
{
  // The same file twice adds nothing the second time.
  const r = row();
  const p = planMtgIntake({ items: [r, row()], listings: [], stackCards: [{ id: "c", sku: BOLT, scan_url: r.images[0], stack_id: "A" }] });
  eq("a row whose scan is already on a stack card is already in stock", p.already.length, 1);
  eq("…and only the new row is filed", p.groups[0].copies, 1);
  const twiceInOneFile = planMtgIntake({ items: [r, { ...r }], listings: [], stackCards: [] });
  eq("the same row twice in one file is one copy", twiceInOneFile.groups[0].copies, 1);
  const unguarded = planMtgIntake({ items: [r], listings: [], stackCards: [{ id: "c", sku: BOLT, scan_url: r.images[0] }], scanGuard: false });
  eq("without the scan guard nothing is claimed as already in", unguarded.already.length, 0);
}
{
  // A hand-made listing that could be this card is OFFERED, never chosen.
  const hand = { ebay_item_id: "999", sku: "A50", title: "MTG Lightning Bolt 146 M10 NM", quantity: 1 };
  const p = planMtgIntake({ items: [row()], listings: [hand] });
  eq("a hand-made listing is a candidate, and the default is still a new listing", [p.groups[0].action, p.groups[0].candidates.map((l) => l.ebay_item_id)], ["create", ["999"]]);
  const id = mtgIdentity(row());
  no("a foil title is not the non-foil card", titleCouldBe("MTG Lightning Bolt 146 FOIL", id));
  no("an LP title is not the NM card", titleCouldBe("Lightning Bolt 146 LP", id));
  no("another number is not this card", titleCouldBe("Lightning Bolt 147", id));
  no("'1460' is not 146", titleCouldBe("Lightning Bolt 1460", id));
  ok("a title with no condition can still be it", titleCouldBe("Lightning Bolt 146/249 Magic 2010", id));
}
{
  // What a create sends, and what a stack row carries.
  const p = planMtgIntake({ items: [row(), row()], listings: [] });
  const L = listingFor(p.groups[0], { pricePence: 125, title: "Lightning Bolt M10 146 NM" });
  eq("a new listing carries our SKU", L.sku, BOLT);
  eq("…the copies as its quantity", L.quantity, 2);
  eq("…the price typed", L.price, 1.25);
  eq("…eBay's NM descriptor", L.conditionId, "400010");
  ok("…and says the photo is of one copy", /photograph is of one copy/i.test(L.description));
  const rows = stackRowsFor(p.groups[0], { sku: BOLT, stackId: "S", userId: "U", startPosition: 41 });
  eq("copies go to the back of the stack, in order", rows.map((r) => r.position), [41, 42]);
  eq("every copy carries the listing's SKU", [...new Set(rows.map((r) => r.sku))], [BOLT]);
}

// --- 5. which copy the pull sheet sends you to --------------------------------
// Lightning Bolt: two in MTG-A, four in MTG-G, four in MTG-AZ — added G first,
// so first-in-first-out alone would send you to MTG-G.
const copy = (id, stack, position, added) => ({ id, stack_id: stack, position, sku: BOLT, added_at: added, pulled_at: null, checked_out_at: null });
const TEN = [
  copy("g1", "G", 3, "2026-10-01"), copy("g2", "G", 9, "2026-10-01"), copy("g3", "G", 14, "2026-10-01"), copy("g4", "G", 20, "2026-10-01"),
  copy("z1", "AZ", 1, "2026-10-08"), copy("z2", "AZ", 2, "2026-10-08"), copy("z3", "AZ", 5, "2026-10-08"), copy("z4", "AZ", 6, "2026-10-08"),
  copy("a1", "A", 40, "2026-10-20"), copy("a2", "A", 12, "2026-10-20")
];
{
  const q = queuesBySku(TEN).get(BOLT.toLowerCase());
  eq("an order for two is pulled from the one stack holding exactly two", allocateCopies(q, 2, { stackAware: true }).map((c) => c.id), ["a2", "a1"]);
  eq("…shallowest first within it", allocateCopies(q, 2, { stackAware: true }).map((c) => c.position), [12, 40]);
  eq("an ordinary listing still takes the head of its queue", allocateCopies(q, 2).map((c) => c.id), ["g1", "g2"]);
  eq("a stack the sheet already opens wins", allocateCopies(q, 2, { stackAware: true, visited: new Set(["AZ"]) }).map((c) => c.stack_id), ["AZ", "AZ"]);
  const five = allocateCopies(q, 5, { stackAware: true });
  eq("no single stack holds five: two stacks, not three", new Set(five.map((c) => c.stack_id)).size, 2);
  eq("…and five copies", five.length, 5);
  eq("an order bigger than the stock takes what there is", allocateCopies(q, 12, { stackAware: true }).length, 10);

  // Two orders for the card on one sheet never share a copy.
  const lines = [{ lineItemId: "L1", sku: BOLT, quantity: 2 }, { lineItemId: "L2", sku: BOLT, quantity: 2 }];
  const both = allocateLines(lines, queuesBySku(TEN));
  eq("the first order empties MTG-A", both[0].map((c) => c.stack_id), ["A", "A"]);
  eq("the second goes to a whole stack, never a copy already taken", both[1].map((c) => c.stack_id), ["G", "G"]);

  // An ordinary card on the same sheet seeds which stacks are open.
  const mixed = [{ lineItemId: "M", sku: BOLT, quantity: 2 }, { lineItemId: "P", sku: "AZ5", quantity: 1 }];
  const mixedCards = [...TEN, { id: "p", stack_id: "AZ", position: 9, sku: "AZ5", added_at: "2026-09-01" }];
  const m = allocateLines(mixed, queuesBySku(mixedCards));
  eq("a stack already open for another card is used for the Bolts", m[0].map((c) => c.stack_id), ["AZ", "AZ"]);
  eq("…and that card still gets its own copy", m[1].map((c) => c.id), ["p"]);

  // After the pull: MTG-A has none left, and the next order goes elsewhere.
  const afterPull = TEN.map((c) => (c.stack_id === "A" ? { ...c, pulled_at: "2026-11-01" } : c));
  const nextQ = queuesBySku(afterPull).get(BOLT.toLowerCase());
  eq("once pulled, MTG-A holds no Bolts", nextQ.filter((c) => c.stack_id === "A").length, 0);
  eq("…and the next order for two comes from one stack elsewhere", new Set(allocateCopies(nextQ, 2, { stackAware: true }).map((c) => c.stack_id)).size, 1);

  // A copy away at a show is not pickable.
  const away = TEN.map((c) => (c.id === "a1" ? { ...c, checked_out_at: "2026-10-31" } : c));
  eq("with one MTG-A copy at a show, an order for two goes to a stack that holds two",
    new Set(allocateCopies(queuesBySku(away).get(BOLT.toLowerCase()), 2, { stackAware: true }).map((c) => c.stack_id)).size, 1);

  // pullPlanFor speaks the same allocation as the screen.
  const plan = pullPlanFor(TEN, [{ lineItemId: "L1", sku: BOLT, quantity: 2 }], new Map([["A", "MTG-A"], ["G", "MTG-G"], ["AZ", "MTG-AZ"]]));
  eq("pullPlanFor names MTG-A for both units", plan.map((u) => u.stackId), ["A", "A"]);
}

// --- 6. greps: the order of the writes, and one allocation ----------------------
{
  const route = readFileSync(new URL("../apps/app/app/api/mtg/intake/route.js", import.meta.url), "utf8");
  const insertAt = route.indexOf('from("stack_cards").insert');
  const listAt = route.indexOf("addFixedPriceListing(token");
  const reviseAt = route.indexOf("reviseItemQuantity(token");
  ok("the intake route files the copies BEFORE eBay is told about them", insertAt > 0 && insertAt < listAt && insertAt < reviseAt);
  ok("…and takes them back out if eBay refuses", /catch \(err\) \{\s*const undone = await undo\(\)/.test(route));
  ok("an add reads the live quantity, never the synced row", /fetchItemQuantity\(token, itemId\)/.test(route) && /live\.available \+ count/.test(route));
  ok("an add files under the SKU read off our own listing row", /from\("ebay_listings"\)\.select\("sku"\)/.test(route));

  const ebay = readFileSync(new URL("../apps/app/lib/ebay.js", import.meta.url), "utf8");
  ok("AddFixedPriceItem sends a SKU only when one is passed", /\(L\.sku \? `<SKU>/.test(ebay));

  const sheet = readFileSync(new URL("../apps/app/app/panel/PullSheet.js", import.meta.url), "utf8");
  ok("the pull sheet allocates through allocateLines", /allocateLines\(lines, copyQueues\)/.test(sheet));
  no("…and no longer indexes a queue by its own count", /copyQueues\.get\(skl\)[^\n]*\[seen\]/.test(sheet));

  const screen = readFileSync(new URL("../apps/app/app/panel/MtgIntake.js", import.meta.url), "utf8");
  ok("the intake screen refuses CardUploader's placeholder as a price", /PLACEHOLDER_PENCE/.test(screen) && /blockers\.length > 0/.test(screen));
  ok("…and confirms before it files or lists anything", /if \(!confirm\(/.test(screen));
}

if (failures) {
  console.error(`check-mtgstock: ${failures} failure(s)`);
  process.exit(1);
}
console.log("✓ mtgstock: one card one listing, refusals named, re-uploads add nothing, and the order for two comes out of MTG-A");
