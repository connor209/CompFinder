/**
 * Which picture goes beside a card on the pull sheet.
 *
 *   node scripts/check-pullimages.mjs      (or: npm run check)
 *
 * The pull sheet's job is finding the right card, so a picture of the WRONG
 * card is worse than none. These cases pin the order (this copy's scan, then
 * the listing it sold from, then an import scan, then any listing with the
 * SKU), that a variation pick never borrows the "choose your card" listing's
 * one gallery shot, and greps that the sheet never reaches for catalogue art.
 */
import { readFileSync } from "node:fs";
import { pullImageIndex, pullImageFor } from "../apps/app/lib/pull-images.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => { if (got !== want) fail(`${label} — expected ${want}, got ${got}`); };

const index = pullImageIndex({
  listings: [
    { ebay_item_id: "111", sku: "A12", image_url: "https://i.ebayimg.com/a12/s-l140.jpg" },
    { ebay_item_id: "222", sku: "PICK", image_url: "https://i.ebayimg.com/pick/s-l140.jpg" },
    { ebay_item_id: "333", sku: "B7", image_url: "https://i.ebayimg.com/b7-new/s-l140.jpg" },
    { ebay_item_id: "444", sku: "C1", image_url: "" },
    { ebay_item_id: "555", sku: "D1", image_url: "javascript:alert(1)" }
  ],
  importScans: new Map([["b7", "https://cdn.example/b7-scan.jpg"], ["pick", "https://cdn.example/pick-copy.jpg"], ["e9", "https://cdn.example/e9.jpg"]])
});

eq("the copy's own scan beats everything", pullImageFor({ card: { scan_url: "https://x/own.jpg" }, itemId: "111", sku: "A12" }, index), "https://x/own.jpg");
eq("then the listing the order sold from", pullImageFor({ card: {}, itemId: "111", sku: "A12" }, index), "https://i.ebayimg.com/a12/s-l140.jpg");
eq("item id beats an import scan", pullImageFor({ itemId: "333", sku: "B7" }, index), "https://i.ebayimg.com/b7-new/s-l140.jpg");
eq("an ended listing falls to the import scan", pullImageFor({ itemId: "999", sku: "b7" }, index), "https://cdn.example/b7-scan.jpg");
eq("an import scan survives the listing", pullImageFor({ itemId: "999", sku: "E9" }, index), "https://cdn.example/e9.jpg");
eq("then any listing carrying the SKU", pullImageFor({ itemId: "999", sku: "a12" }, index), "https://i.ebayimg.com/a12/s-l140.jpg");
eq("a variation pick never gets the listing's shot", pullImageFor({ itemId: "222", sku: "NOPE", variation: "Pikachu 25" }, index), null);
eq("…not by SKU either", pullImageFor({ itemId: "999", sku: "A12", variation: "Pikachu 25" }, index), null);
eq("…but its own copy's scan is fine", pullImageFor({ itemId: "222", sku: "PICK", variation: "Pikachu 25" }, index), "https://cdn.example/pick-copy.jpg");
eq("an empty image is no image", pullImageFor({ itemId: "444", sku: "C1" }, index), null);
eq("a non-http URL is no image", pullImageFor({ itemId: "555", sku: "D1" }, index), null);
eq("nothing known draws nothing", pullImageFor({ itemId: null, sku: null }, index), null);
eq("no index draws nothing", pullImageFor({ sku: "A12" }, undefined), null);

const sheet = readFileSync(new URL("../apps/app/app/panel/PullSheet.js", import.meta.url), "utf8");
if (/image_small|card_catalog|tcgdex|pokemontcg/i.test(sheet)) fail("PullSheet.js reaches for catalogue art — a mint scan where a played card is");
if (!/pullImageFor\(/.test(sheet)) fail("PullSheet.js chooses its pictures without pullImageFor()");

if (failures) {
  console.error(`check-pullimages: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-pullimages: ok");
