// How an ungraded card's condition is told to eBay (apps/app/lib/ebay-condition.js).
// Born from the platform review of 2026-11-26: ListForm and BulkListModal put
// the descriptor value (400010) in <ConditionID>, where the lab sends 4000
// plus descriptor 40001 — and offered a Damaged grade eBay doesn't have.
import { readFileSync } from "node:fs";
import { conditionXml, CONDITION_DESCRIPTOR } from "../apps/app/lib/ebay-condition.js";
import { CONDITION_DESCRIPTOR as LAB } from "../apps/app/lib/lab-copies.js";

let fails = 0, n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

eq("near mint is ConditionID 4000 with descriptor 40001",
  conditionXml("400010"),
  "<ConditionID>4000</ConditionID><ConditionDescriptors><ConditionDescriptor><Name>40001</Name><Value>400010</Value></ConditionDescriptor></ConditionDescriptors>");
eq("a descriptor value is never sent as the ConditionID", /<ConditionID>4000\d\d<\/ConditionID>/.test(conditionXml("400013")), false);
eq("a plain ConditionID passes through", conditionXml("3000"), "<ConditionID>3000</ConditionID>");
eq("no condition, nothing", conditionXml(""), "");
eq("Damaged is refused, never listed as a better grade", throws(() => conditionXml("400014")), true);
eq("junk is refused", throws(() => conditionXml("near mint")), true);
eq("the lab reads the same table", LAB, CONDITION_DESCRIPTOR);

const ebay = readFileSync(new URL("../apps/app/lib/ebay.js", import.meta.url), "utf8");
eq("addFixedPriceListing writes the condition through conditionXml", /conditionXml\(L\.conditionId\)/.test(ebay) && !/<ConditionID>\$\{escapeXml\(L\.conditionId\)\}/.test(ebay), true);
for (const f of ["BulkListModal.js", "ListForm.js"]) {
  const src = readFileSync(new URL(`../apps/app/app/panel/${f}`, import.meta.url), "utf8");
  eq(`${f} offers no Damaged grade`, /v: "400014"/.test(src), false);
}

if (fails) { console.error(`\n${fails} of ${n} eBay condition checks failed.`); process.exit(1); }
console.log(`✓ ${n} eBay condition checks pass.`);
