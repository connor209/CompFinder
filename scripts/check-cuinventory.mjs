/**
 * CardUploader's variation listings, from the inventory file to the pull sheet.
 *
 *   node scripts/check-cuinventory.mjs      (or: npm run check)
 *
 * CardUploader sells a card as one copy of a "pick your card" variation whose
 * SKU (CS-P3NSJY_982a1be2) names the card and condition, shared by every copy
 * — fourteen copies of one common in the first export. The copy's location
 * (IR19) is only in CardUploader's own files. What costs cards here:
 *
 * - A committed line handed the NEXT copy on reload. Several copies share a
 *   SKU, so "the SKU is pulled" no longer means "this line is done", and the
 *   sheet would pull a second card for one order.
 * - Two lines given one card, or a default pick taking the copy CardUploader
 *   chose for another order — after which the two systems disagree about
 *   which of N identical cards went, silently.
 * - A file that resurrects a pulled card, or one read as the other file.
 * - Reconcile pre-ticking a whole load to pull because none of it has a
 *   listing under its stack SKU.
 *
 * Fixtures are shaped on the real exports of 2026-11-15; the rows are made up.
 */
import { readFileSync } from "node:fs";
import {
  isCuListingSku, listingSkuKey, parseInventoryCsv, parsePickListCsv, cuChoiceIndex,
  planInventoryImport, inventoryRowHeld, inventoryImportNote, isMissingListingSku
} from "../apps/app/lib/cu-files.js";
import { assignPulls, cuChoiceReport, pulledOutsideSheet } from "../apps/app/lib/pullmatch.js";
import { cardOffSaleReason, offSaleIndex } from "../apps/app/lib/stockcheck.js";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message || String(e); } };

// ── the SKUs ─────────────────────────────────────────────────────────────────

console.log("Which SKUs are CardUploader's");
check("the screen's spelling and the export's are one key", listingSkuKey("CS-P3NSJY") === listingSkuKey("CS-P3NSJY_982a1be2"));
check("two different variations stay apart", listingSkuKey("CS-P3NSJY_982a1be2") !== listingSkuKey("CS-DP6TAR_f20a8034"));
check("a stack SKU is not a variation", !isCuListingSku("IR19") && !isCuListingSku("YGO-AA50") && !isCuListingSku("MTG-C37"));
check("an underscore in a stack SKU is part of its name", listingSkuKey("A_50") === "a_50");
check("the variation SKU is read as one", isCuListingSku("cs-qeaqj4_af29a8af") && isCuListingSku("CS-QEAQJ4"));

// ── the two files ────────────────────────────────────────────────────────────

const INV_HEAD = "Title,User SKU,Catalog SKU,eBay SKU,TCGplayer SKU,TCGplayer Product ID,TCG,Set,Card Number,Rarity,Condition,Variant,Finish,Price,Qty,Status,Grading Company,Cert Number,Grade,Image URLs";
const inv = (title, user, ebay, { qty = "1", status = "listed", cond = "LP" } = {}) =>
  `${title},${user},${ebay.split("_")[0]},${ebay},1,1,pokemon english,Set,1/1,Common,${cond},Normal,,2.49,${qty},${status},,,,https://images.carduploader.com/cards/a.jpg|https://images.carduploader.com/cards/b.jpg`;
const PICK_HEAD = '"Pile","SKU","Card","Number","Set","Condition","Variant","Platform","Order ID","Buyer","Ship To Name","Ship To","Sale Date","Status","Image"';
const pick = (pile, sku, card, order, status = "Matched") =>
  `"${pile}","${sku}","${card}","","","","","ebay","${order}","buyer","Name","Town, GB","2026-11-14","${status}",""`;

console.log("Reading the files");
{
  const rows = parseInventoryCsv(["﻿" + INV_HEAD, inv("Lapras 36/236 Unified Minds Pokemon LP", "IR19", "CS-P3NSJY_982a1be2")].join("\r\n"));
  check("inventory: location, eBay SKU and the first scan", rows.length === 1 && rows[0].userSku === "IR19" && rows[0].listingSku === "CS-P3NSJY_982a1be2" && rows[0].image.endsWith("a.jpg"), JSON.stringify(rows[0]));
  const p = parsePickListCsv([PICK_HEAD, pick(27, "IR19", "Lapras 36/236 Unified Minds Pokemon LP", "25-15400-35244")].join("\n"));
  check("pick list: order and chosen SKU", p.length === 1 && p[0].orderId === "25-15400-35244" && p[0].sku === "IR19");
  const wrongA = throws(() => parseInventoryCsv(PICK_HEAD));
  check("the pick list is refused as an inventory, and says which it is", wrongA && /pick list/.test(wrongA), wrongA);
  const wrongB = throws(() => parsePickListCsv(INV_HEAD));
  check("the inventory is refused as a pick list, and says which it is", wrongB && /inventory/.test(wrongB), wrongB);
  check("an empty file is refused", !!throws(() => parseInventoryCsv("")));
  const ci = cuChoiceIndex([
    { orderId: "O1", sku: "IR19", status: "Matched" },
    { orderId: "O1", sku: "", status: "no inventory" },
    { orderId: "O1", sku: "IT35", status: "Matched" }
  ]);
  check("choices kept per order, in file order; 'no inventory' chooses nothing", JSON.stringify(ci.get("O1")) === '["ir19","it35"]');
}

console.log("Which inventory rows are still ours");
check("listed, qty 1", inventoryRowHeld({ qty: "1", status: "listed" }));
check("listed but sold yesterday and not Picked in CardUploader — still in the stack", inventoryRowHeld({ qty: "1", status: "listed" }));
check("an explicit zero is gone", !inventoryRowHeld({ qty: "0", status: "listed" }));
check("a missing quantity is silence, not a zero", inventoryRowHeld({ qty: "", status: "listed" }));
check("a sold status is gone", !inventoryRowHeld({ qty: "1", status: "sold" }));

// ── the import plan ─────────────────────────────────────────────────────────

console.log("What an inventory upload adds");
{
  const rows = [
    { userSku: "IR19", listingSku: "CS-P3NSJY_982a1be2", title: "Lapras", qty: "1", status: "listed" },
    { userSku: "IR15", listingSku: "CS-DP6TAR_f20a8034", title: "Lapras PF", qty: "1", status: "listed" },
    { userSku: "IR15", listingSku: "CS-DP6TAR_f20a8034", title: "Lapras PF again", qty: "1", status: "listed" },
    { userSku: "IR3", listingSku: "CS-AAAAAA_1", title: "Pulled already", qty: "1", status: "listed" },
    { userSku: "IR4", listingSku: "CS-BBBBBB_1", title: "Stacked by hand", qty: "1", status: "listed" },
    { userSku: "IR5", listingSku: "CS-CCCCCC_1", title: "Gone", qty: "0", status: "listed" },
    { userSku: "MTG-C37", listingSku: "CS-DDDDDD_1", title: "Divider", qty: "1", status: "listed" },
    { userSku: "", listingSku: "CS-EEEEEE_1", title: "No location", qty: "1", status: "listed" },
    { userSku: "IT1", listingSku: "", title: "No eBay SKU", qty: "1", status: "listed" }
  ];
  const existing = [
    { id: "p3", sku: "IR3", pulled_at: "2026-11-10", listing_sku: "CS-AAAAAA_1" },
    { id: "h4", sku: "IR4", pulled_at: null, listing_sku: null },
    { id: "x9", sku: "IR9", pulled_at: null, listing_sku: "CS-ZZZZZZ_1" },
    { id: "b30", sku: "BL30", pulled_at: null, listing_sku: null }
  ];
  const p = planInventoryImport({ rows, existing, stacks: [{ id: "s-ir", name: "IR" }] });
  const skus = p.cards.map((c) => c.sku);
  check("a new location becomes a stack card at that position, carrying its eBay SKU",
    p.cards.some((c) => c.sku === "IR19" && c.prefix === "IR" && c.num === 19 && c.listing_sku === "CS-P3NSJY_982a1be2"));
  check("one row per location SKU", skus.filter((s) => s === "IR15").length === 1 && p.repeated === 1);
  check("a PULLED card is never resurrected by a file still listing it", !skus.includes("IR3") && !p.updates.some((u) => u.id === "p3"));
  check("a card stacked by hand gets its eBay SKU set, not a second row", !skus.includes("IR4") && p.updates.some((u) => u.id === "h4" && u.listing_sku === "CS-BBBBBB_1"));
  check("a card CardUploader no longer holds is not added", !skus.includes("IR5") && p.gone === 1);
  check("a Cardmarket divider is never a CardUploader stack", !skus.includes("MTG-C37") && p.unparseable === 1);
  check("a row with no location is counted, not guessed", p.noLocation === 1);
  check("a row with no eBay SKU is added and counted", skus.includes("IT1") && p.noListingSku === 1);
  check("only the stack CardUploader doesn't have is made", JSON.stringify(p.newStacks) === '["IT"]');
  check("a card on a file stack the file no longer lists is reported, never pulled", JSON.stringify(p.notInFile) === '["IR9"]');
  check("a stack CardUploader never covered is not 'missing' from it", !p.notInFile.includes("BL30"));
  const again = planInventoryImport({ rows, existing: [...existing.filter((c) => c.id !== "h4"), ...p.cards.map((c, i) => ({ id: `n${i}`, sku: c.sku, listing_sku: c.listing_sku, pulled_at: null })), { id: "h4", sku: "IR4", listing_sku: "CS-BBBBBB_1", pulled_at: null }], stacks: [] });
  check("the same file twice adds nothing", again.cards.length === 0 && again.updates.length === 0, JSON.stringify(again.cards.map((c) => c.sku)));
}

console.log("A location SKU is not identity (E42, 2026-11-21)");
{
  const rows = [
    { userSku: "E42", listingSku: "CS-VNUGZ5_9c3c595c", title: "Sableye 63/132 Uncommon Secret Wonders Pokemon LP", qty: "1", status: "listed" },
    { userSku: "J25", listingSku: "CS-BJ7JWT_bc585700", title: "Meowth 4/12 EX Trainer Kit 2 Plusle Pokemon LP", qty: "1", status: "listed" },
    { userSku: "F45", listingSku: "CS-VNUGZ5_9c3c595c", title: "Sableye 63/132 Uncommon Secret Wonders Pokemon LP", qty: "1", status: "listed" },
    { userSku: "K7", listingSku: "CS-QQQQQQ_1", title: "Pikachu 58/102 Base Set", qty: "1", status: "listed" }
  ];
  const existing = [
    // linked by the old import to Sableye, but it is not Sableye
    { id: "e42", sku: "E42", title: "Pokemon TCG Gengar 94/165 Expedition Rare", pulled_at: null, listing_sku: "CS-VNUGZ5_9c3c595c" },
    // never linked, and not Meowth
    { id: "j25", sku: "J25", title: "Machop 52/102 Base Set", pulled_at: null, listing_sku: null },
    // really the same card, under a different spelling
    { id: "f45", sku: "F45", title: "Pokemon Sableye 063/132 Secret Wonders NM", pulled_at: null, listing_sku: null },
    // stacked by hand with no title: can't tell, so linked as before
    { id: "k7", sku: "K7", title: "", pulled_at: null, listing_sku: null }
  ];
  const p = planInventoryImport({ rows, existing, stacks: [] });
  check("a SKU naming another card here is a clash, not a link", !p.updates.some((u) => u.id === "e42" || u.id === "j25") && p.clashes.map((c) => c.sku).sort().join() === "E42,J25", JSON.stringify(p.clashes));
  check("a wrong link from an earlier upload is taken off", p.unlink.length === 1 && p.unlink[0].id === "e42");
  check("a clash never stacks CardUploader's card on top of ours", !p.cards.some((c) => c.sku === "E42" || c.sku === "J25"));
  check("the same card spelt differently is still linked", p.updates.some((u) => u.id === "f45"));
  check("a card with no title to compare is linked as before", p.updates.some((u) => u.id === "k7"));
  check("the note names a clash", /E42 is Sableye/.test(inventoryImportNote({ ok: true, imported: 0, stacks: 0, already: 0, clashes: p.clashes, unlinked: 1 })));

  const sheet = [
    { id: "e42", sku: "E42", stack_id: "sE", position: 42, title: "Pokemon TCG Gengar 94/165 Expedition Rare", listing_sku: "CS-VNUGZ5_9c3c595c", pulled_at: null },
    { id: "jr39", sku: "JR39", stack_id: "sJR", position: 39, title: "Sableye 63/132 Uncommon Secret Wonders Pokemon LP", listing_sku: "CS-VNUGZ5_9c3c595c", pulled_at: null }
  ];
  const names = { sE: "E", sJR: "JR" };
  const line = { lineItemId: "L1", orderId: "O1", sku: "CS-VNUGZ5_9c3c595c", title: "Sableye 63/132 Uncommon Secret Wonders Pokemon LP", quantity: 1 };
  const { units } = assignPulls([line], sheet, { walkCompare: (a, b) => a.localeCompare(b), stackNameOf: (id) => names[id] });
  check("a variation order skips a front-most copy that is another card", units[0].card?.id === "jr39", units[0].card?.id);
  const cu = new Map([["O1", ["e42"]]]);
  const viaFile = assignPulls([line], sheet, { walkCompare: (a, b) => a.localeCompare(b), stackNameOf: (id) => names[id], cuChoice: cu }).units[0];
  check("CardUploader's choice of a SKU holding another card is not followed", viaFile.card?.id === "jr39" && viaFile.via === "variation");
  const only = assignPulls([line], [sheet[0]], { walkCompare: (a, b) => a.localeCompare(b), stackNameOf: (id) => names[id] }).units[0];
  check("with only the wrong card linked, the line is loose and says why", only.card === null && only.reason === "wrongcard");
}
check("a pending migration reads as pending", isMissingListingSku({ message: 'column stack_cards.listing_sku does not exist' }) && !isMissingListingSku({ message: "network error" }));
check("the note says nothing was added when 037 is pending", /037/.test(inventoryImportNote({ ok: false, missing: true })));

// ── the pull sheet ───────────────────────────────────────────────────────────

console.log("Which copy each order line takes");
const STACKS = { ir: "IR", it: "IT", bl: "BL" };
const walk = (a, b) => (a.length !== b.length ? a.length - b.length : a.localeCompare(b));
const opts = (extra = {}) => ({ walkCompare: walk, stackNameOf: (id) => STACKS[id] || "", ...extra });
const card = (id, stack, position, sku, listing_sku = null, extra = {}) => ({ id, stack_id: stack, position, sku, listing_sku, pulled_at: null, checked_out_at: null, ...extra });
const PF = "CS-DP6TAR_f20a8034";
const base = () => [
  card("c-ir17", "ir", 17, "IR17", PF),
  card("c-ir15", "ir", 15, "IR15", PF),
  card("c-ir16", "ir", 16, "IR16", PF),
  card("c-it2", "it", 2, "IT2", PF),
  card("c-bl30", "bl", 30, "BL30")
];
const line = (lineItemId, orderId, sku, quantity = 1) => ({ lineItemId, orderId, sku, quantity, title: "t" });
const byKey = (units) => Object.fromEntries(units.map((u) => [u.key, u.card?.sku || null]));
{
  const { units } = assignPulls([line("L0", "O0", "BL30")], base(), opts());
  check("a stack SKU line is unchanged: its own card", units[0].card?.sku === "BL30" && units[0].via === "sku");
}
{
  const { units } = assignPulls([line("L1", "O1", "CS-DP6TAR_f20a8034")], base(), opts());
  check("a variation line takes the FRONT-most copy in walk order", units[0].card?.sku === "IR15" && units[0].via === "variation", byKey(units).L1);
}
{
  const { units } = assignPulls([line("L1", "O1", "CS-DP6TAR"), line("L2", "O2", "CS-DP6TAR_f20a8034")], base(), opts());
  const m = byKey(units);
  check("two orders for one variation take two different copies", m.L1 === "IR15" && m.L2 === "IR16", JSON.stringify(m));
}
{
  const { units } = assignPulls([line("L1", "O1", PF, 2)], base(), opts());
  const m = byKey(units);
  check("a quantity-2 line takes two copies", m["L1#1"] === "IR15" && m["L1#2"] === "IR16", JSON.stringify(m));
}
{
  // Order O1 is read first and has no choice; O2's file names IR15. O1 must
  // not take IR15 by default and leave CardUploader's choice unpullable.
  const cuChoice = cuChoiceIndex([{ orderId: "O2", sku: "IR15", status: "Matched" }]);
  const { units } = assignPulls([line("L1", "O1", PF), line("L2", "O2", PF)], base(), opts({ cuChoice }));
  const m = byKey(units);
  check("CardUploader's choice is honoured before any default", m.L2 === "IR15" && units[1].via === "cardUploader", JSON.stringify(m));
  check("…and the default goes round it", m.L1 === "IR16");
  const rep = cuChoiceReport(units, cuChoice, base());
  check("the report counts followed and defaulted lines", rep.followed === 1 && rep.defaulted === 1, JSON.stringify(rep));
}
{
  const cuChoice = cuChoiceIndex([{ orderId: "O1", sku: "BL30", status: "Matched" }, { orderId: "O1", sku: "IR99", status: "Matched" }]);
  const { units } = assignPulls([line("L1", "O1", PF)], base(), opts({ cuChoice }));
  check("a file choice that is a different card is not taken", units[0].card?.sku === "IR15" && units[0].via === "variation");
  const rep = cuChoiceReport(units, cuChoice, base());
  check("a chosen SKU not on our stacks is named", JSON.stringify(rep.unknown) === '["IR99"]', JSON.stringify(rep));
}
{
  // The commit wrote pulled_line on IR15. On reload the line must be DONE,
  // not handed IR16 — which Commit would then pull as well.
  const cards = base().map((c) => (c.id === "c-ir15" ? { ...c, pulled_at: "2026-11-15T10:00:00Z", pulled_line: "L1" } : c));
  const { units, pulledFor } = assignPulls([line("L1", "O1", PF), line("L2", "O2", PF)], cards, opts());
  check("a committed line stays done after a reload", units[0].done && units[0].card?.sku === "IR15", JSON.stringify(byKey(units)));
  check("…and does not take the next copy", units[1].card?.sku === "IR16");
  check("Pack finds the card a line was pulled for", pulledFor.get("L1")?.[0]?.sku === "IR15");
}
{
  const cards = base().map((c) => (c.id === "c-ir15" ? { ...c, pulled_at: "2026-11-15T10:00:00Z", pulled_line: "L1" } : c));
  const { units } = assignPulls([line("L1", "O1", PF, 2)], cards, opts());
  check("half of a quantity-2 line committed: one done, one still to pick", units[0].done && !units[1].done && units[1].card?.sku === "IR16");
}
{
  const away = base().map((c) => (c.listing_sku ? { ...c, checked_out_at: "x" } : c));
  const { units } = assignPulls([line("L1", "O1", PF)], away, opts());
  check("every copy away: no card, and says so", !units[0].card && units[0].reason === "nocopyleft");
  const { units: u2 } = assignPulls([line("L1", "O1", "CS-NOTHERE_1")], base(), opts());
  check("a variation with no stacked copy: no card, and says so", !u2[0].card && u2[0].reason === "notstacked");
}

// ── listing checks ───────────────────────────────────────────────────────────

console.log("What Reconcile and the Show Desk call off sale");
{
  const idx = offSaleIndex([{ sku: "BL30", quantity: 1 }], []);
  check("a CardUploader copy is never 'not listed' off its stack SKU", cardOffSaleReason({ sku: "IR19", listing_sku: "CS-P3NSJY_982a1be2" }, idx) === null);
  check("an ordinary card is still asked by its SKU", cardOffSaleReason({ sku: "BL31" }, idx) === "notlisted" && cardOffSaleReason({ sku: "BL30" }, idx) === null);
}

// ── greps ────────────────────────────────────────────────────────────────────

console.log("Where it is wired");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sheet = read("apps/app/app/panel/PullSheet.js");
check("the pull sheet matches lines through assignPulls()", /assignPulls\(/.test(sheet));
check("the pull sheet keeps no second SKU→card queue of its own", !/queuesBySku\(/.test(sheet));
check("Commit records the line a card was pulled for", /pulled_line:\s*line/.test(sheet));
check("Commit still pulls when 037 is pending", /isMissingListingSku\(/.test(sheet));
for (const f of ["apps/app/app/panel/Stacks.js", "apps/app/app/panel/ShowDesk.js"]) {
  const src = read(f);
  check(`${f.split("/").pop()} asks a CARD whether it is off sale`, /cardOffSaleReason\(/.test(src) && !/offSaleReason\((c|card)\.sku/.test(src));
}
check("Stacks reads the inventory through cu-files.js", /runInventoryImport\(/.test(read("apps/app/app/panel/Stacks.js")));

// ── ↩ Back to Pick ───────────────────────────────────────────────────────────
// 2026-11-17: Reconcile pulled sold cards whose orders were still to dispatch,
// so Pack dealt cards nobody had picked. Commit is the only writer of
// pulled_line, so a pulled card without one was pulled elsewhere and may
// still be stacked — Pack offers it back to Pick. A Commit pull is never
// offered: that card IS in your hand.
console.log("Which pulled cards Pack offers back to Pick");
check("pulled by Commit is not offered", !pulledOutsideSheet({ pulled_at: "t", pulled_line: "L1" }));
check("pulled by Reconcile is offered", pulledOutsideSheet({ pulled_at: "t", pulled_line: null }));
check("before 037 there is no telling — offered", pulledOutsideSheet({ pulled_at: "t" }));
check("a card not pulled has nothing to undo", !pulledOutsideSheet({ pulled_at: null, pulled_line: null }));
check("no card, nothing offered", !pulledOutsideSheet(null));
{
  const ps = readFileSync(new URL("../apps/app/app/panel/PullSheet.js", import.meta.url), "utf8");
  check("Pack reads pulledOutsideSheet() rather than its own test", /filter\(pulledOutsideSheet\)/.test(ps));
  check("Back to Pick confirms before it un-pulls", /async function backToPick[\s\S]{0,400}confirm\(/.test(ps));
}

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll CardUploader inventory checks pass.");
