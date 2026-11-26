// A price change sent to eBay (apps/app/lib/price-change.js): when it is too
// big to send without asking again, and the audit row it leaves. Born from
// the platform review of 2026-11-26: the lab's Inventory revised live prices
// with no drastic-change guard and no `ebay_price_changes` row, so the eBay
// activity screen could neither show nor revert them.
import { readFileSync } from "node:fs";
import { isDrasticChange, priceChangeRow } from "../apps/app/lib/price-change.js";

let fails = 0, n = 0;
const eq = (label, got, want) => {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

eq("a small change is not drastic", isDrasticChange(1000, 1299), false);
eq("under a fifth is", isDrasticChange(1000, 199), true);
eq("exactly a fifth is not", isDrasticChange(1000, 200), false);
eq("over five times is", isDrasticChange(1000, 5001), true);
eq("units don't matter", isDrasticChange(10, 1.5), true);
eq("no current price: nothing to compare", isDrasticChange(null, 5000), false);
eq("a zero current price is not a baseline", isDrasticChange(0, 5000), false);

eq("the audit row is in pounds, as EbayActivity reads it",
  priceChangeRow({ userId: "u", itemId: 123, title: "Umbreon", fromPence: 1249, toPence: 999, source: "lab" }),
  { user_id: "u", ebay_item_id: "123", title: "Umbreon", old_price: 12.49, new_price: 9.99, currency: "GBP", source: "lab" });

// Both routes that revise a live price use the one rule and write the log.
const lab = readFileSync(new URL("../apps/app/app/api/lab/route.js", import.meta.url), "utf8");
const revise = readFileSync(new URL("../apps/app/app/api/ebay/revise-price/route.js", import.meta.url), "utf8");
eq("the lab's setPrices guards drastic changes", /isDrasticChange\(/.test(lab) && /needsConfirm/.test(lab), true);
eq("…and writes ebay_price_changes", /from\("ebay_price_changes"\)\.insert\(priceChangeRow\(/.test(lab), true);
eq("revise-price uses the same rule, not its own ratios", /isDrasticChange\(/.test(revise) && !/\* 0\.2|\* 5\)/.test(revise), true);
const inv = readFileSync(new URL("../apps/app/app/panel/lab/inventory/LabInventory.js", import.meta.url), "utf8");
eq("the lab Inventory asks again before forcing", /needsConfirm[\s\S]{0,400}force: true/.test(inv), true);

if (fails) { console.error(`\n${fails} of ${n} price-change checks failed.`); process.exit(1); }
console.log(`✓ ${n} price-change checks pass.`);
