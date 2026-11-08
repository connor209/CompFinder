/**
 * Folding single listings into one — what may be pooled.
 *
 *   node scripts/check-copypool.mjs      (or: npm run check)
 *
 * A pooled listing ships whichever copy is next, so every refusal here is a
 * card that would otherwise go to a buyer as the wrong thing, or be sold
 * twice. Titles are real ones from the 2026-11-07 listings export.
 */
import { readFileSync } from "node:fs";
import { planPool, poolKey, editionOf } from "../apps/app/lib/copypool.js";

let failures = 0;
const fail = (m) => { console.error(`  ${m}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const ok = (label, got) => { if (!got) fail(`${label} — expected truthy, got ${JSON.stringify(got)}`); };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const HORSEA = "Horsea 49/62 Fossil Pokemon Unlimited LP";
let n = 0;
const card = (sku, title = HORSEA, over = {}) => ({
  id: `id-${sku}`, sku, title, stack_id: "F", ebay_item_id: `40${++n}`, pulled_at: null, checked_out_at: null, ...over
});
const world = (cards, over = {}) => ({
  cards,
  listings: new Map(cards.filter((c) => c.ebay_item_id).map((c) => [String(c.ebay_item_id), { title: c.title, quantity: 1, price_value: 1.49 }])),
  lines: [],
  scans: new Map(cards.map((c) => [c.sku.toLowerCase(), [`https://cdn.example/${c.sku}-front.jpg`, `https://cdn.example/${c.sku}-back.jpg`]])),
  ...over
});
const THREE = [card("FN22"), card("FN28"), card("FM11")];

// --- the ordinary case ------------------------------------------------------
const good = planPool({ skus: ["FN22", "FN28", "FM11"], ...world(THREE) });
ok("three identical copies pool", good.ok);
eq("the first copy's listing is kept by default", good.keep, THREE[0].ebay_item_id);
eq("...and the other two are ended", good.end, [THREE[1].ebay_item_id, THREE[2].ebay_item_id]);
eq("the kept listing's own card is copy 1, so its photo is already right", good.copies.map((c) => [c.sku, c.seq]), [["FN22", 1], ["FN28", 2], ["FM11", 3]]);
eq("each copy carries its own scans", good.copies[1].scans, ["https://cdn.example/FN28-front.jpg", "https://cdn.example/FN28-back.jpg"]);
const chosen = planPool({ skus: ["FN22", "FN28", "FM11"], keepItemId: THREE[2].ebay_item_id, ...world(THREE) });
eq("--keep moves that listing's card to the front", chosen.copies[0].sku, "FM11");
ok("--keep must be one of their listings", !planPool({ skus: ["FN22", "FN28"], keepItemId: "999", ...world(THREE) }).ok);

// --- not the same card ------------------------------------------------------
const mixed = (a, b) => planPool({ skus: ["A1", "A2"], ...world([card("A1", a), card("A2", b)]) });
ok("a different condition is a different listing", !mixed(HORSEA, "Horsea 49/62 Fossil Pokemon Unlimited MP").ok);
ok("1st Edition is never pooled with Unlimited",
  !mixed("Spoink 029/054 Rulers of the Heavens Pokemon Japanese 1st Edition LP", "Spoink 029/054 Rulers of the Heavens Pokemon Japanese Unlimited LP").ok);
ok("Shadowless is never pooled with Unlimited",
  !mixed("Machop 52/102 Base Set Unlimited Pokemon LP", "Machop 52/102 Common Base Set Shadowless Pokemon Unlimited LP").ok);
ok("Japanese is never pooled with English",
  !mixed("Raichu 026/165 151 Pokemon Holo NM", "Raichu 026/165 SV2a: Pokemon Card 151 Pokemon Japanese Holo NM").ok);
ok("a reverse holo is never pooled with the plain card",
  !mixed("Shinx 74/99 Common Arceus Pokemon LP", "Shinx 74/99 Common Arceus Pokemon Reverse Holo LP").ok);
ok("two grades are two cards", !mixed("Umbreon VMAX 215/203 PSA 10", "Umbreon VMAX 215/203 PSA 9").ok);
ok("a different card number is a different card", !mixed(HORSEA, "Horsea 50/62 Fossil Pokemon Unlimited LP").ok);
ok("the same card spelled two ways still pools",
  mixed("Machop 52/102 Base Set Unlimited Pokemon LP", "Machop 52/102 Common Base Set Unlimited Pokemon LP").ok);
eq("edition reading", [editionOf("x 1st Edition"), editionOf("x Shadowless"), editionOf("x Japanese"), editionOf("Horsea 49/62")], ["1st Edition", "Shadowless", "Japanese", ""]);
ok("the refusal names which copies differ", /A1 \| A2|A2 \| A1/.test(mixed(HORSEA, "Horsea 49/62 Fossil Pokemon Unlimited MP").errors.join(" ")));

// --- a copy that is somebody's card already ---------------------------------
const soldLine = planPool({ skus: ["FN22", "FN28", "FM11"], ...world(THREE, { lines: [{ itemId: THREE[1].ebay_item_id, sku: "FN28", quantity: 1 }] }) });
ok("a copy owed to an unshipped order is refused", !soldLine.ok && soldLine.errors.some((e) => /FN28.*unshipped/.test(e)));
const w0 = world(THREE); w0.listings.get(THREE[2].ebay_item_id).quantity = 0;
ok("a copy on a listing at quantity 0 has sold, and is refused", planPool({ skus: ["FN22", "FN28", "FM11"], ...w0 }).errors.some((e) => /FM11.*quantity 0/.test(e)));
ok("without the orders nothing pools", !planPool({ skus: ["FN22", "FN28"], ...world(THREE, { lines: null }) }).ok);

// --- not in the box, or not one card ----------------------------------------
const away = [card("B1"), card("B2", HORSEA, { checked_out_at: "2026-11-01" })];
ok("a checked-out copy is refused", !planPool({ skus: ["B1", "B2"], ...world(away) }).ok);
const twice = [card("C1"), card("C2"), card("C2")];
ok("a SKU naming two stack cards is refused", planPool({ skus: ["C1", "C2"], ...world(twice) }).errors.some((e) => /C2.*2 stack cards/.test(e)));
ok("one copy is not a pool", !planPool({ skus: ["FN22"], ...world(THREE) }).ok);

// --- pools that already exist ------------------------------------------------
const POOLED = [card("D1", HORSEA, { ebay_item_id: "777" }), card("D2", HORSEA, { ebay_item_id: "777" }), card("D3")];
const wp = world(POOLED); wp.listings.set("777", { title: HORSEA, quantity: 2, price_value: 1.49 });
ok("a copy already in another pool is refused", !planPool({ skus: ["D3", "D1"], keepItemId: POOLED[2].ebay_item_id, ...wp }).ok);
const partial = planPool({ skus: ["D1", "D3"], keepItemId: "777", ...wp });
ok("adding to a pool without naming all its copies is refused", !partial.ok && partial.errors.some((e) => /D2/.test(e)));
const whole = planPool({ skus: ["D1", "D2", "D3"], keepItemId: "777", ...wp });
ok("adding to a pool naming all its copies works", whole.ok);
eq("...and only the new copy's listing is ended", whole.end, [POOLED[2].ebay_item_id]);

// --- warnings, not refusals --------------------------------------------------
const wPrice = world(THREE); wPrice.listings.get(THREE[1].ebay_item_id).price_value = 2.49;
const priced = planPool({ skus: ["FN22", "FN28", "FM11"], ...wPrice });
ok("different asking prices still pool", priced.ok);
ok("...but say every copy sells at the kept price", priced.warnings.some((w) => /£1\.49.*£2\.49|kept listing's £1\.49/.test(w)));
const wNoScan = world(THREE); wNoScan.scans = new Map();
ok("a copy with no scans still pools, and says so", planPool({ skus: ["FN22", "FN28"], ...wNoScan }).warnings.some((w) => /no scans/.test(w)));

// --- the script's order of work ----------------------------------------------
const script = read("scripts/copyqueue-pool.mjs");
ok("the script is dry unless --apply", /if \(!APPLY\) \{[^}]*dry run/.test(script));
ok("it re-reads every listing live before acting", script.indexOf("fetchItemQuantity(") < script.indexOf("endListing("));
ok("it ends the other listings BEFORE raising the kept quantity", script.indexOf("endListing(") < script.indexOf("revisePooledListing("));
ok("it revises through the EPS upload path", /revisePooledListing\(/.test(script) && !/reviseFixedPriceListing\(/.test(script));
ok("the pull sheet ties a pull to its order when only the item id is shared",
  /itemRows\.get\(String\(card\.ebay_item_id\)\)/.test(read("apps/app/app/panel/PullSheet.js")));
ok("scans are read through import-store, the one file naming its tables",
  /scansBySku/.test(script) && !/card_import_items/.test(script));

if (failures) {
  console.error(`\ncheck-copypool: ${failures} failure(s).`);
  process.exit(1);
}
console.log("check-copypool: OK — only the same card, in the box and unsold, is pooled.");
