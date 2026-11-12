/**
 * Cardmarket stock: the Magic chaos sort, loaded from CardUploader and picked
 * from Cardmarket's paid-orders file.
 *
 *   node scripts/check-cardmarket.mjs      (or: npm run check)
 *
 * The fixtures are rows from the real files of 2026-11-11: a CardUploader
 * Magic export, a TCG PowerTools stock export and an ArticlesInPaidOrders.
 * What costs money here is quiet:
 *
 * - The wrong card in an envelope. A sale names a product and a grade, never
 *   our SKU, so a foil and a plain copy, or an LP and an NM, must never answer
 *   for each other — and two copies that agree on everything may.
 * - A second copy picked for one order, because the same file was uploaded
 *   twice.
 * - A position that lies. Every card behind a divider counts, including one
 *   with no product id, or every card after it is off by one.
 * - An eBay screen reasoning about a box that was never on eBay: Reconcile
 *   calling every MTG card "not listed", a filing plan putting a returned
 *   Pokémon card behind MTG-C, a nightly import filing an eBay SKU into one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCardmarketStack, dividerLetters, letterIndex, lettersOf, nextDivider, compareDividers,
  parseCsvText, parsePrice, parseCardUploaderMtg, planLoad, fileFingerprint, cmFields, cmCondition,
  parsePaidOrders, matchOrders, walkOrder, pilesOf, pulledCm,
  parseTcgptExport, checkListings, tcgptImportCsv, tcgptImportName,
  pricesFromExport, stockRows, filterStock, sortStock, stockTotals, dividerTotals, soldRows, locationText, articleKey
} from "../apps/app/lib/cardmarket.js";
import { liveRanks } from "../apps/app/lib/stackpos.js";
import { fileableStacks } from "../apps/app/lib/toploader.js";
import { planStackImport } from "../apps/app/lib/stack-import.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

// `stack_cards.cm` is written in one place.
const files = [];
const walkDir = (d) => {
  for (const f of readdirSync(join(root, d))) {
    const p = join(d, f);
    if (f === "node_modules" || f.startsWith(".")) continue;
    if (statSync(join(root, p)).isDirectory()) walkDir(p);
    else if (/\.(js|mjs)$/.test(f)) files.push(p);
  }
};
walkDir("apps/app/app");
walkDir("apps/app/lib");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── fixtures, from the real files ───────────────────────────────────────────

const CU = `"quantity","name","set","rarity","cn","condition","language","isFirstEd","isReverseHolo","isFoil","isSigned","price","comment","cardmarketId","tcgplayerId"
"1","Loyal Tutor","Reality Fracture","Rare","14","NM","English","","","true","","","","907284","715863"
"1","Predatory Sliver","Magic 2014 (M14)","Common","189","DMG","English","","","","","","","262359","69180"
"1","Predatory Sliver","Magic 2014 (M14)","Common","189","LP","English","","","","","","","262359","69180"
"1","Last-Ditch Effort","Urza's Legacy","Uncommon","83","MP","English","","","","","","","10640","6335"
"1","Thoughtcast","Mirrodin","Common","54","LP","English","","","","","","","54","1"
"1","Vault of Whispers","Mirrodin","Common","286","LP","English","","","","","","","286","11311"
"1","Mystery card","Somewhere","Common","1","LP","English","","","","","","","",""
"1","Ghostly Flicker","Avacyn Restored","Common","57","LP","English","","","","","","","254240","58293"
"2","Ghostly Flicker","Avacyn Restored","Common","57","LP","English","","","","","","","254240","58293"
"1","Arcane Denial - Fatalism (Borderless) (JP Exclusive)","Buy-A-Box Promos","Promo","1","NM","English","","","true","","","","830479","637512"
"1","Plated Seastrider","Conspiracy","Common","103","LP","English","","","true","","","","267071","83277"
"1","Plated Seastrider","Conspiracy","Common","103","LP","English","","","","","","","267071","83277"`;

const ORDERS = `Magic the Gathering Singles;Product ID;-;3 Articles;Localized Article Name;Expansion;4.81;Comments;Condition;Rarity;Collector Number;Language;Order ID;isFoil;isSigned;isAltered
1;54;1;Thoughtcast;Thoughtcast;Mirrodin;1;;EX;Common;54;English;1313779150;false;false;false
1;286;1;Vault of Whispers;Vault of Whispers;Mirrodin;1.9;;EX;Common;286;English;1313779150;false;false;false
2;254240;1;Ghostly Flicker;Ghostly Flicker;Avacyn Restored;1.91;;EX;Common;57;English;1313921932;false;false;false
`;

const TCGPT = `﻿"cardmarketId","quantity","name","set","setCode","cn","condition","language","isFoil","isPlayset","isSigned","oldPrice","price","comment","nameDE","nameES","nameFR","nameIT","rarity","listedAt"
"907284","1","Loyal Tutor","Reality Fracture","FRA","14","NM","English","true","","","1000","0.85","","","","","","Rare",""
"262359","1","Predatory Sliver","Magic 2014","M14","189","LP","English","","","","1000","0.08","","","","","","Common",""
"10640","1","Last-Ditch Effort","Urza's Legacy","ULG","83","GD","English","","","","1000","0.8","","","","","","Uncommon",""
"54","1","Thoughtcast","Mirrodin","MRD","54","LP","English","","","","1000","1","","","","","","Common",""
"286","1","Vault of Whispers","Mirrodin","MRD","286","LP","English","","","","1000","1.94","","","","","","Common",""
"254240","3","Ghostly Flicker","Avacyn Restored","AVR","57","LP","English","","","","1000","2.35","","","","","","Common",""
"830479","1","Arcane Denial","FINAL FANTASY: Promos","PFIN","","NM","English","true","","","","1000","","","","","","Rare",""
"267071","1","Plated Seastrider","Conspiracy","CNS","103","LP","English","true","","","1000","0.08","","","","","","Common",""
"267071","1","Plated Seastrider","Conspiracy","CNS","103","LP","English","","","","1000","0.08","","","","","","Common",""
"5529","1","Animate Dead","Revised","3ED","","GD","English","","","","1000","5.15","","","","","","Uncommon",""`;

// ── dividers ────────────────────────────────────────────────────────────────

console.log("Dividers: MTG-A … Z, AA, AB, like spreadsheet columns");
check("A=1, Z=26, AA=27, AB=28", letterIndex("A") === 1 && letterIndex("Z") === 26 && letterIndex("AA") === 27 && letterIndex("AB") === 28);
check("…and back", lettersOf(26) === "Z" && lettersOf(27) === "AA" && lettersOf(52) === "AZ" && lettersOf(53) === "BA");
check("after Z comes AA", nextDivider([{ name: "MTG-Y" }, { name: "MTG-Z" }]) === "AA");
check("nothing loaded starts at A", nextDivider([]) === "A");
check("Pokémon and YGO stacks don't count toward the next divider", nextDivider([{ name: "Z" }, { name: "YGO-Z" }, { name: "MTG-B" }]) === "C");
check("MTG-C is a Cardmarket divider", isCardmarketStack({ name: "MTG-C" }) && isCardmarketStack("mtg-ab"));
check("Stack A, YGO-A, Toploaders and a bare MTG- are not",
  !isCardmarketStack("A") && !isCardmarketStack("YGO-A") && !isCardmarketStack("Toploaders") && !isCardmarketStack("MTG-") && !isCardmarketStack("Show Binder 1"));
check("walk order puts Z before AA", ["MTG-AA", "MTG-Z", "MTG-B"].sort(compareDividers).join() === "MTG-B,MTG-Z,MTG-AA");
check("letters off a divider", dividerLetters("MTG-ac") === "AC" && dividerLetters("YGO-A") === null);

// ── CSV ─────────────────────────────────────────────────────────────────────

console.log("\nReading the files");
check("a byte-order mark does not rename the first column", parseCsvText(TCGPT)[0][0] === "cardmarketId");
check("quotes and doubled quotes", parseCsvText('"a ""b""","c,d"\n')[0].join("|") === 'a "b"|c,d');
check("prices in either locale", parsePrice("1.9") === 1.9 && parsePrice("1,9") === 1.9 && parsePrice("") === null);

// ── the load ────────────────────────────────────────────────────────────────

console.log("\nLoading a CardUploader Magic export");
const cu = parseCardUploaderMtg(CU);
check("parses", !cu.error, cu.error);
check("a quantity-2 row is two cards in the box", cu.cards.length === 13, `${cu.cards.length}`);
check("a card with no product id is KEPT, so the cards after it keep their place", cu.cards[6].name === "Mystery card" && cu.noProduct === 1);
check("the house guide's table: NM→NM, LP→EX, MP→GD, HP→LP, DMG→PO",
  cmCondition("NM") === "NM" && cmCondition("LP") === "EX" && cmCondition("MP") === "GD" && cmCondition("HP") === "LP" && cmCondition("DMG") === "PO");
check("a grade that isn't ours is not guessed at", cmCondition("GD") === null && cmCondition("EX") === null && cmCondition("") === null);
check("foil is read", cu.cards[0].foil === true && cu.cards[12].foil === false);
check("the eBay-format export is refused", !!parseCardUploaderMtg('"*Action(SiteID=UK|Country=GB|Currency=GBP|Version=1193)","*Title"\n"Add","x"').error);

const many = Array.from({ length: 124 }, (_, i) => ({ ...cu.cards[i % cu.cards.length] }));
const plan = planLoad(many, { start: "C", stacks: [{ name: "MTG-A" }, { name: "MTG-B" }] });
check("124 cards are 50, 50 and 24 behind C, D and E",
  !plan.error && plan.dividers.map((d) => `${d.name}:${d.cards.length}`).join() === "MTG-C:50,MTG-D:50,MTG-E:24", plan.error || plan.dividers.map((d) => d.name).join());
check("positions run 1–50 in scan order, and the SKU names it", plan.dividers[1].cards[0].position === 1 && plan.dividers[1].cards[49].sku === "MTG-D50");
check("a divider already in use is refused, not topped up", !!planLoad(many, { start: "B", stacks: [{ name: "MTG-A" }, { name: "MTG-B" }] }).error);
check("…including one the load would run into", !!planLoad(many, { start: "A", stacks: [{ name: "MTG-C" }] }).error);
check("loads wrap past Z", planLoad(many, { start: "Y", stacks: [] }).dividers.map((d) => d.letters).join() === "Y,Z,AA");
check("the same file has the same fingerprint, CRLF or not", fileFingerprint(CU) === fileFingerprint(CU.replace(/\n/g, "\r\n")) && fileFingerprint(CU) !== fileFingerprint(CU + "x"));

// ── a box, as the store would hold it ───────────────────────────────────────

const stacks = [{ id: "sA", name: "MTG-A" }, { id: "sB", name: "MTG-B" }];
const boxPlan = planLoad(cu.cards, { start: "A", stacks: [], size: 7 });
let n = 0;
const box = boxPlan.dividers.flatMap((d) => d.cards.map((c) => ({
  id: `c${++n}`, stack_id: d.name === "MTG-A" ? "sA" : "sB", position: c.position, sku: c.sku, title: c.name,
  pulled_at: null, checked_out_at: null, cm: cmFields(c, "f1")
})));
const bySku = (sku) => box.find((c) => c.sku === sku);
// MTG-A: 1 Loyal Tutor, 2 Pred DMG, 3 Pred LP, 4 Last-Ditch MP, 5 Thoughtcast, 6 Vault, 7 Mystery
// MTG-B: 1 Flicker, 2 Flicker, 3 Flicker, 4 Arcane Denial, 5 Seastrider foil, 6 Seastrider

console.log("\nMatching Cardmarket's paid-orders file");
const po = parsePaidOrders(ORDERS);
check("parses by position, past a header that changes every file", !po.error && po.lines.length === 3, po.error);
check("order id, product, grade and price", po.lines[1].orderId === "1313779150" && po.lines[1].productId === 286 && po.lines[1].condition === "EX" && po.lines[1].price === 1.9);
check("Cardmarket's own order number is kept for the pile", po.lines[0].seq === 1 && po.lines[2].seq === 2);
check("a file whose columns moved is refused", !!parsePaidOrders(ORDERS.replace("Product ID", "Produkt-ID")).error);
check("a comma-decimal file reads the same", parsePaidOrders(ORDERS.replace(";1.9;", ";1,9;")).lines[1].price === 1.9);

const m = matchOrders(po.lines, box, stacks);
check("all three units find a card", m.picks.length === 3 && m.unmatched.length === 0, `${m.picks.length} / ${m.unmatched.length}`);
check("the right cards", m.picks.map((p) => p.card.sku).sort().join() === "MTG-A5,MTG-A6,MTG-B1");
check("of three identical Flickers, the one nearest the front", m.picks.find((p) => p.line.productId === 254240).card.sku === "MTG-B1");

const foilSale = { ...po.lines[0], productId: 267071, foil: true, orderId: "9", quantity: 1 };
const plainSale = { ...foilSale, foil: false, orderId: "10" };
const mf = matchOrders([foilSale, plainSale], box, stacks);
check("a foil sale takes the foil, a plain sale the plain", mf.picks.map((p) => p.card.sku).join() === "MTG-B5,MTG-B6");

const nmSale = { ...po.lines[0], productId: 262359, condition: "NM", orderId: "11" };
const mg = matchOrders([nmSale], box, stacks);
check("an NM sale is never sent the LP or DMG copy", mg.picks.length === 0 && mg.unmatched.length === 1);

const gdSale = { ...po.lines[0], productId: 10640, condition: "GD", orderId: "12" };
const mm = matchOrders([gdSale], box, stacks);
check("a GD sale is our MP card", mm.picks.length === 1 && mm.picks[0].card.sku === "MTG-A4");
const lpSale = matchOrders([{ ...gdSale, condition: "LP", orderId: "13" }], box, stacks);
check("a Cardmarket LP sale is never sent our MP card — their LP is our HP", lpSale.picks.length === 0);
check("…it is unmatched, naming the grade the box does hold", lpSale.unmatched[0]?.boxGrades.join() === "MP");
const oldListing = matchOrders([{ ...po.lines[0], condition: "LP", orderId: "14" }], box, stacks);
check("a sale off an old listing (our LP put up as Cardmarket LP) is not picked", oldListing.picks.length === 0 && oldListing.unmatched[0]?.boxGrades.join() === "LP");
const stale = box.map((c) => (c.sku === "MTG-A5" ? { ...c, cm: { ...c.cm, cm_condition: "LP" } } : c));
check("the grade is worked out from OURS every time, never read off a stored copy", matchOrders([po.lines[0]], stale, stacks).picks[0]?.card.sku === "MTG-A5");

const two = matchOrders([{ ...po.lines[2], quantity: 2 }], box, stacks);
check("quantity 2 is two cards from two places", two.picks.length === 2 && new Set(two.picks.map((p) => p.card.id)).size === 2);

check("a card away at a show is not offered",
  matchOrders([po.lines[0]], box.map((c) => (c.sku === "MTG-A5" ? { ...c, checked_out_at: "x" } : c)), stacks).unmatched.length === 1);

// The same file uploaded twice, after the first was committed.
const afterCommit = box.map((c) => {
  const p = m.picks.find((x) => x.card.id === c.id);
  return p ? { ...c, pulled_at: "2026-11-12", cm: pulledCm(c, p.line) } : c;
});
const again = matchOrders(po.lines, afterCommit, stacks);
check("the same file again picks nothing new", again.picks.length === 0 && again.done === 3, `${again.picks.length} picks, ${again.done} done`);
check("…but a NEW order for the same card still gets one",
  matchOrders([{ ...po.lines[2], orderId: "999" }], afterCommit, stacks).picks[0]?.card.sku === "MTG-B2");
check("a committed card carries its order and sale", pulledCm(bySku("MTG-B1"), po.lines[2]).order_id === "1313921932" && pulledCm(bySku("MTG-B1"), po.lines[2]).product_id === 254240);

console.log("\nThe walk and the piles");
const ranks = liveRanks(box.map((c) => (c.sku === "MTG-A1" ? { ...c, pulled_at: "x" } : c)));
check("a pulled card closes the count up behind it", ranks.get(bySku("MTG-A5").id) === 4);
const walk = walkOrder(m.picks, stacks, ranks);
check("dividers in letter order", walk.map((g) => g.name).join() === "MTG-A,MTG-B");
check("front to back within a divider, at the positions as they are now", walk[0].rows.map((r) => `${r.card.sku}@${r.rank}`).join() === "MTG-A5@4,MTG-A6@5");
const piles = pilesOf(m.picks);
check("one pile per order, in Cardmarket's numbering", piles.length === 2 && piles[0].seq === 1 && piles[0].picks.length === 2 && piles[1].orderId === "1313921932");

// ── the listing check ───────────────────────────────────────────────────────

console.log("\nChecking a TCG PowerTools export against the box");
const tp = parseTcgptExport(TCGPT);
check("parses through the byte-order mark", !tp.error && tp.rows.length === 10, tp.error);
const ck = checkListings(box, tp.rows);
check("the DMG Predatory Sliver is not listed, and kept apart as the floor deciding", ck.damaged.some((u) => u.name === "Predatory Sliver") && !ck.unlisted.some((u) => u.condition === "DMG"));
check("Last-Ditch Effort listed as GD is right: our MP is GD", !ck.regraded.some((r) => r.name === "Last-Ditch Effort") && !ck.unlisted.some((u) => u.name === "Last-Ditch Effort"));
check("our LP cards listed as Cardmarket LP are flagged — they should be EX", ck.regraded.some((r) => r.name === "Thoughtcast" && r.listedAs === "LP" && r.boxCondition === "LP"));
check("…and are not ALSO called unlisted", !ck.unlisted.some((u) => u.name === "Thoughtcast"));
check("Arcane Denial at 1000 is flagged", ck.placeholder.some((r) => r.name === "Arcane Denial"));
check("the card with no product id is not reported as anything", !ck.unlisted.some((u) => /Mystery/.test(u.name)));
check("both Seastriders are listed, foil and plain apart", !ck.unlisted.some((u) => u.name === "Plated Seastrider") && ck.regraded.filter((r) => r.name === "Plated Seastrider").length === 2);
check("a listing the box doesn't hold is counted, not listed", ck.elsewhere === 1, `${ck.elsewhere}`);

console.log("\nThe file TCG PowerTools imports");
const imp1 = tcgptImportCsv(CU);
const back = parseCsvText(imp1.csv);
const orig = parseCsvText(CU);
const ci = orig[0].indexOf("condition");
const pi = orig[0].indexOf("cardmarketId");
check("same header, same rows, same order", back.length === orig.length && back[0].join() === orig[0].join() && back.every((r, i) => r[pi] === orig[i][pi]));
check("grades rewritten into Cardmarket's", back.slice(1).map((r) => r[ci]).join() === orig.slice(1).map((r) => cmCondition(r[ci])).join());
check("…NM stays NM, DMG is PO, LP is EX, MP is GD", back[1][ci] === "NM" && back[2][ci] === "PO" && back[3][ci] === "EX" && back[4][ci] === "GD");
check("every other column is untouched", back.every((r, i) => r.every((v, j) => j === ci || v === orig[i][j])));
check("named after the CardUploader file", tcgptImportName("magic101.csv") === "magic101-cardmarket-grades.csv");

// ── the stock list ──────────────────────────────────────────────────────────

console.log("\nThe stock list");
const saved = pricesFromExport(tp.rows);
check("the 1000 placeholder is not saved as a price", !saved.some((r) => r.price >= 1000));
check("two listings of one article keep the LOWER price",
  pricesFromExport([{ ...tp.rows[3], price: 2 }, { ...tp.rows[3], price: 1.5 }])[0]?.price === 1.5);
// The fixture's listings are the OLD ones (our LP put up as Cardmarket LP), so
// the Flicker is priced here as it will be listed from now on: EX.
const savedNow = [...saved, ...pricesFromExport([{ ...tp.rows.find((r) => r.name === "Ghostly Flicker"), condition: "EX" }])];
const priceMap = new Map(savedNow.map((r) => [r.article_key, { price: r.price, priced_at: "2026-11-12T10:00:00Z" }]));
const sranks = liveRanks(box);
const srows = stockRows(box, stacks, sranks, priceMap);
const flick = srows.find((r) => r.name === "Ghostly Flicker");
check("three identical Flickers are one row of three", flick?.count === 3 && srows.filter((r) => r.name === "Ghostly Flicker").length === 1);
check("…with where each copy is, as the pick list counts it", locationText(flick) === "MTG-B 1, 2, 3", locationText(flick));
check("a foil and a plain copy are two rows", srows.filter((r) => r.name === "Plated Seastrider").length === 2);
check("each row carries both grades", flick.grade === "LP" && flick.cmGrade === "EX");
check("the card with no product id is still in the stock, keyless", srows.some((r) => r.name === "Mystery card" && !r.hasKey));
check("a price is the article's, and the value is price × copies", flick.price === 2.35 && flick.value === 7.05);
check("a price saved for another grade is not this card's", srows.find((r) => r.name === "Predatory Sliver" && r.grade === "LP")?.price === null);
const tot = stockTotals(srows);
check("totals count every card", tot.cards === box.length, `${tot.cards}`);
check("unpriced cards are counted, never valued at zero", tot.unpriced > 0 && tot.priced + tot.unpriced === tot.cards);
check("a pulled card is not stock", stockRows(afterCommit, stacks, liveRanks(afterCommit), priceMap).find((r) => r.name === "Ghostly Flicker")?.count === 2);

check("search is every word, either order", filterStock(srows, { q: "flicker avacyn" }).length === 1 && filterStock(srows, { q: "avacyn flicker" }).length === 1);
check("search ignores accents and case", filterStock([{ ...flick, name: "Ghöstly Flicker" }], { q: "GHOSTLY" }).length === 1);
check("divider filter", filterStock(srows, { divider: "MTG-A" }).every((r) => r.dividers.includes("MTG-A")) && filterStock(srows, { divider: "MTG-A" }).length > 0);
check("grade filter is OUR grade", filterStock(srows, { grade: "MP" }).map((r) => r.name).join() === "Last-Ditch Effort");
check("foil filter", filterStock(srows, { foil: "foil" }).every((r) => r.foil) && filterStock(srows, { foil: "plain" }).every((r) => !r.foil));
const asc = sortStock(srows, "value-asc");
const desc = sortStock(srows, "value-desc");
check("an unpriced card sorts LAST cheapest-first", asc[asc.length - 1].value === null && asc[0].value !== null);
check("…and last dearest-first too", desc[desc.length - 1].value === null && desc[0].value >= desc[1].value);
const dt = dividerTotals(srows);
check("per divider: every card counted once", dt.reduce((n, d) => n + d.cards, 0) === box.length && dt.map((d) => d.divider).join() === "MTG-A,MTG-B");

const sold = soldRows(afterCommit, stacks);
check("sold lists what was pulled, with its order and price",
  sold.length === 3 && sold.every((r) => r.orderId) && sold.some((r) => r.name === "Vault of Whispers" && r.price === 1.9));

const ui = read("apps/app/app/panel/CardmarketStock.js");
check("Tick all ticks the pick list and nothing else", /function tickAll\(\)[\s\S]{0,120}matched\.picks\.map\(\(p\) => p\.card\.id\)/.test(ui));
check("nothing is pulled until Mark pulled is confirmed", /if \(!confirm\(`Mark /.test(ui));
const priceUsers = files.filter((f) => /from\(\s*["']cardmarket_prices/.test(read(f)) && !/cardmarket-store\.js$/.test(f));
check("only cardmarket-store.js names cardmarket_prices", priceUsers.length === 0, priceUsers.join(", "));

// ── the eBay screens leave the boxes alone ──────────────────────────────────

console.log("\nThe eBay side never reasons about an MTG divider");
const stacksSrc = read("apps/app/app/panel/Stacks.js");
const recon = stacksSrc.slice(stacksSrc.indexOf("async function runReconcile"), stacksSrc.indexOf("function toggleRecon"));
check("Reconcile skips the Cardmarket dividers", /isCardmarketStack/.test(recon) && /cmStackIds\.has/.test(recon));
check("no filing plan can choose MTG-C", fileableStacks([{ name: "A" }, { name: "MTG-C" }, { name: "YGO-A" }]).map((s) => s.name).join() === "A,YGO-A");
const imp = planStackImport({ listings: [{ sku: "MTG-C37", title: "x", quantity: 1 }, { sku: "YGO-A12", title: "y", quantity: 1 }], existingSkus: [], stacks: [] });
check("the nightly import never files an eBay SKU behind a Cardmarket divider", !imp.newStacks.includes("MTG-C") && !imp.cards.some((c) => c.sku === "MTG-C37"));
check("…and still imports YGO-A12", imp.cards.some((c) => c.sku === "YGO-A12"));


const writers = files.filter((f) => !/cardmarket-store\.js$/.test(f)).filter((f) => {
  const s = read(f);
  return /stack_cards/.test(s) && /\bcm\s*:\s*(cmFields|w\.cm|pulledCm)/.test(s);
});
check("only cardmarket-store.js writes the cm column", writers.length === 0, writers.join(", "));
check("cardmarket.js imports nothing (toploader.js imports it)", !/^import /m.test(read("apps/app/lib/cardmarket.js")));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
