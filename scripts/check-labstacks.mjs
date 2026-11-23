// The lab folded into the stacks (docs/LAB_FOLD.md): what a lab stack is,
// how lab_copies move onto stack_cards, and that the rest of the app leaves
// lab cards where they are.
//
//   node scripts/check-labstacks.mjs
import { readFileSync } from "node:fs";
import {
  LAB_STACK_PREFIX, isLabStack, labStackNameFor, skuNumber, isLabCard, movePlan, stackRowFrom, asLabCopy
} from "../apps/app/lib/lab-stacks.js";
import { fileableStacks } from "../apps/app/lib/toploader.js";
import { pilePositions, isForSale, queueOf } from "../apps/app/lib/lab-copies.js";
import { liveRanks } from "../apps/app/lib/stackpos.js";

let failed = 0;
let n = 0;
function eq(name, got, want) {
  n += 1;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failed += 1; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); }
}
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// ---- names ------------------------------------------------------------------
eq("a pile's stack is LAB-<pile>", [labStackNameFor("TEST2-14"), labStackNameFor("TEST-1"), labStackNameFor("LAB7"), labStackNameFor("kb12")], ["LAB-TEST2", "LAB-TEST", "LAB-LAB", "LAB-KB"]);
eq("the prefix is LAB-", LAB_STACK_PREFIX, "LAB-");
eq("a lab stack is recognised by name, either case", [isLabStack("LAB-TEST2"), isLabStack({ name: "lab-kb" }), isLabStack("LABRADOR"), isLabStack("KA")], [true, true, false, false]);
eq("a SKU's number orders the pile", [skuNumber("TEST2-14"), skuNumber("LAB7"), skuNumber("X")], [14, 7, 0]);
eq("a lab card is one with lab_listing_id, nothing else", [isLabCard({ lab_listing_id: "L" }), isLabCard({ sku: "LAB-TEST2-1" }), isLabCard(null)], [true, false, false]);

// ---- filing plans never choose a lab stack ----------------------------------
eq("Reallocate / Pick a stack never offer a LAB- stack",
  fileableStacks([{ id: 1, name: "KA" }, { id: 2, name: "LAB-TEST2" }, { id: 3, name: "MTG-C" }]).map((s) => s.name), ["KA"]);

// ---- the move -----------------------------------------------------------------
{
  const stacks = [{ id: "S-KA", name: "KA" }, { id: "S-LT", name: "LAB-TEST" }];
  const stackCards = [
    { id: "k1", stack_id: "S-KA", sku: "KA1", position: 1 },
    { id: "t9", stack_id: "S-LT", sku: "OTHER9", position: 4 },                      // already in LAB-TEST
    { id: "ad", stack_id: "S-KA", sku: "TEST2-5", position: 2 },                     // stacked by a CU import
    { id: "pp", stack_id: "S-KA", sku: "TEST2-6", position: 3, pulled_at: "t" },     // pulled
    { id: "ll", stack_id: "S-KA", sku: "TEST2-7", position: 4, lab_listing_id: "X" } // already lab
  ];
  const copies = [
    { id: "c3", sku: "TEST-3", pile_seq: 2, listing_id: "A" },
    { id: "c1", sku: "TEST-1", pile_seq: 0, listing_id: "A" },
    { id: "d1", sku: "TEST2-1", pile_seq: 0, listing_id: "B" },
    { id: "d5", sku: "TEST2-5", pile_seq: 4, listing_id: "B" },
    { id: "d6", sku: "TEST2-6", pile_seq: 5, listing_id: "B" },
    { id: "d7", sku: "TEST2-7", pile_seq: 6, listing_id: "B" },
    { id: "done", sku: "TEST-2", pile_seq: 1, listing_id: "A", stack_card_id: "already" }
  ];
  const p = movePlan(copies, stackCards, stacks);
  eq("an already-moved copy is skipped (the move can run twice)", p.steps.some((s) => s.copy.id === "done"), false);
  eq("new copies go to the BACK of an existing lab stack, in SKU order", p.steps.filter((s) => s.kind === "insert" && s.stackName === "LAB-TEST").map((s) => [s.copy.sku, s.position]), [["TEST-1", 5], ["TEST-3", 6]]);
  eq("a missing lab stack is made, numbering from 1", [p.newStacks, p.steps.filter((s) => s.stackName === "LAB-TEST2").map((s) => [s.copy.sku, s.position])], [["LAB-TEST2"], [["TEST2-1", 1]]]);
  eq("an unpulled stack card with the SKU is ADOPTED where it sits", p.steps.filter((s) => s.kind === "adopt").map((s) => [s.copy.sku, s.stackCard.id]), [["TEST2-5", "ad"]]);
  eq("a pulled or already-lab SKU is refused, never overwritten", p.steps.filter((s) => s.kind === "refuse").map((s) => [s.copy.sku, s.why]), [["TEST2-6", "on a stack, but pulled"], ["TEST2-7", "already a lab card on a stack"]]);

  const row = stackRowFrom({ sku: "TEST-1", listing_id: "A", scan_urls: ["a.jpg"], copy_seq: 0, reserved_line: "x#1", reserved_order: "o", pulled_at: null }, { title: "Mareep" });
  eq("the stack card carries the lab listing, scans, queue order and reservation", [row.lab_listing_id, row.scan_urls, row.copy_seq, row.reserved_line, row.title], ["A", ["a.jpg"], 0, "x#1", "Mareep"]);
  eq("…and never an eBay item id (copyqueue-run must not see it)", "ebay_item_id" in row, false);
}

// ---- a stack card read back as a lab copy -------------------------------------
{
  const cards = [
    { id: "s1", stack_id: "S", sku: "TEST-1", position: 1, lab_listing_id: "A", copy_seq: 0, scan_urls: ["1"] },
    { id: "s2", stack_id: "S", sku: "TEST-2", position: 2, pulled_at: "t", lab_listing_id: "A", copy_seq: 1 },
    { id: "x", stack_id: "S", sku: "KA9", position: 3 },                     // a non-lab card in the same stack
    { id: "s3", stack_id: "S", sku: "TEST-3", position: 4, lab_listing_id: "A", copy_seq: 2, scan_urls: ["3"] },
    { id: "s4", stack_id: "S", sku: "TEST-4", position: 5, lab_listing_id: "A", copy_seq: 3, checked_out_at: "t" }
  ];
  const ranks = liveRanks(cards);
  const names = new Map([["S", "LAB-TEST"]]);
  const lab = cards.filter(isLabCard).map((c) => asLabCopy(c, { ranks, names }));
  const pos = pilePositions(lab);
  eq("a lab card's position is the stack's live rank, counting non-lab cards too", ["s1", "s3"].map((id) => `${pos.get(id).pile}#${pos.get(id).position}`), ["LAB-TEST#1", "LAB-TEST#3"]);
  eq("a pulled card has no position", pos.has("s2"), false);
  eq("a checked-out lab card is not for sale", [isForSale(lab.find((c) => c.id === "s4")), queueOf("A", lab).map((c) => c.id)], [false, ["s1", "s3"]]);
}

// ---- greps --------------------------------------------------------------------
{
  const store = read("apps/app/lib/lab-store.js");
  eq("the lab refuses to act until every copy has moved", /needsMove: true/.test(store) && /foldState/.test(store), true);
  eq("every stack_cards write in lab-store is guarded to lab cards or a planned row",
    (store.match(/sb\.from\(CARDS\)\s*\.(update|delete)\([^;]*;/g) || []).filter((w) => !/lab_listing_id/.test(w) && !/in\("id", (made|adopted)\)/.test(w)).length, 0);
  const route = read("apps/app/app/api/lab/route.js");
  eq("a failed listing undoes its stack cards before the listing", (route.match(/await undoCopies\(sb, user\.id, rows\);\s*await deleteListing/g) || []).length, 2);
  eq("the move remaps which copy each listing is showing", /pictured_copy_id: to/.test(store), true);
}

// ---- step 2: the pull sheet, Reconcile, the picker, checkouts -------------------
{
  const { assignPulls } = await import("../apps/app/lib/pullmatch.js");
  const { cardOffSaleReason } = await import("../apps/app/lib/stockcheck.js");
  const { skuBatch } = await import("../apps/app/lib/showfilter.js");
  const cards = [
    // lab listing L, two copies; the second was reserved for order line LI-2
    { id: "lab1", stack_id: "S", sku: "TEST-1", position: 1, lab_listing_id: "L" },
    { id: "lab2", stack_id: "S", sku: "TEST-2", position: 2, lab_listing_id: "L", reserved_line: "LI-2#1" },
    { id: "lab3", stack_id: "S", sku: "TEST-3", position: 3, lab_listing_id: "L", reserved_line: "LI-3#1", pulled_at: "t" },
    { id: "ka1", stack_id: "K", sku: "KA1", position: 1 }
  ];
  const lines = [
    { lineItemId: "LI-2", orderId: "O2", itemId: "999", sku: null, quantity: 1 },   // lab sale, reserved
    { lineItemId: "LI-3", orderId: "O3", itemId: "999", sku: null, quantity: 1 },   // lab sale, already picked
    { lineItemId: "LI-4", orderId: "O4", itemId: "999", sku: null, quantity: 1 },   // lab sale, not reserved yet
    { lineItemId: "LI-5", orderId: "O5", itemId: "123", sku: "KA1", quantity: 1 },  // ordinary
    { lineItemId: "LI-6", orderId: "O6", itemId: "555", sku: "TEST-1", quantity: 1 } // a line that happens to carry a lab SKU
  ];
  const { units } = assignPulls(lines, cards, { labItemIds: new Set(["999"]) });
  const by = (k) => units.find((u) => u.key === k);
  eq("a lab sale takes the card the lab RESERVED for it", [by("LI-2").card?.id, by("LI-2").via, by("LI-2").lab], ["lab2", "lab", true]);
  eq("…a reserved card already pulled reads as done", [by("LI-3").card?.id, by("LI-3").done], ["lab3", true]);
  eq("an unreserved lab sale is never guessed — it waits for the lab", [by("LI-4").card, by("LI-4").reason], [null, "labunreserved"]);
  eq("ordinary lines are untouched", by("LI-5").card?.id, "ka1");
  eq("a lab card is never matched by SKU", by("LI-6").card, null);
  eq("Reconcile never offers a lab card (its listing has no SKU)", cardOffSaleReason(cards[0], { available: new Set(), soldDate: new Set(), soldOut: new Set() }), null);
  eq("the Show Desk picker never lists a lab card", skuBatch(cards, "", { stackId: "S" }).map((c) => c.id), []);
  eq("…while ordinary cards still list", skuBatch(cards, "", { stackId: "K" }).map((c) => c.id), ["ka1"]);

  const checkout = read("apps/app/lib/checkout.js");
  eq("checking out refuses a lab card, whatever screen asks", /if \(card\?\.lab_listing_id\) return \{ ok: false, error: LAB_CARD_REFUSAL \}/.test(checkout), true);
  eq("eBay's order lines carry their item number", /itemId: li\.legacyItemId/.test(read("apps/app/lib/ebay.js")), true);
  const deal = read("apps/app/app/panel/DealBar.js");
  eq("＋ Deal never appears on a lab listing (button and copy picker)", (deal.match(/isLabListing\(labIds,/g) || []).length, 2);
  eq("the stream button never queues a lab listing", /isLabListing\(labIds, item\.itemId\)/.test(read("apps/app/app/panel/StreamBar.js")), true);
  const inv = read("apps/app/app/panel/Inventory.js");
  eq("My listings: ⤴ Show refuses a lab listing (bulk included)", /async function showOut\(g\) \{[\s\S]{0,200}isLabListing\(labIds, g\.ebay_item_id\)/.test(inv), true);
  const stacksUi = read("apps/app/app/panel/Stacks.js");
  eq("Stacks: a lab card has no ⤴ Show or hand Pull", /isLabCard\(c\) \?[\s\S]{0,400}\) : \([\s\S]{0,100}checkOut\(c\)/.test(stacksUi), true);
  const pull = read("apps/app/app/panel/PullSheet.js");
  eq("the pull sheet passes the lab's listings to the matcher", /labItemIds: labIds/.test(pull), true);
  eq("the lab's own Pick list is gone", /Picked<\/button>/.test(read("apps/app/app/panel/lab/LabCopies.js")), false);
}

console.log(failed ? `\n${failed} of ${n} lab-stack checks failed.` : `✓ ${n} lab-stack checks pass.`);
process.exit(failed ? 1 : 0);
