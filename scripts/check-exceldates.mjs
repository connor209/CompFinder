// A card number Excel turned into a date (apps/app/lib/carduploader.js).
// Born from the DP Trainer Kit cards on 2026-11-26: 6/12, 1/11 and 2/11 came
// through as "06-Dec", "01-Nov" and "02-Nov" and found no sales at all.
import CardUploaderCsv from "../apps/app/lib/carduploader.js";
import { repairDateNumbers } from "../apps/app/lib/lab-draft.js";
import { readFileSync } from "node:fs";
const { repairExcelDateMangling: fix, extractItems } = CardUploaderCsv;

let fails = 0, n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

eq("month-year, the shape it always handled: Apr-99 is 4/99", fix("Apr-99"), "4/99");
eq("day-month, UK Excel: 06-Dec is 6/12", fix("06-Dec"), "6/12");
eq("01-Nov is 1/11", fix("01-Nov"), "1/11");
eq("02-Nov is 2/11", fix("02-Nov"), "2/11");
eq("no leading zero too: 6-Dec is 6/12", fix("6-Dec"), "6/12");
eq("a real card number is untouched", fix("215/203"), "215/203");
eq("a promo code is untouched", fix("SWSH050"), "SWSH050");
eq("letters that aren't a month are untouched", fix("12-Abc"), "12-Abc");
eq("a hyphenated code is untouched", fix("TG-12"), "TG-12");
eq("blank stays blank", fix(""), "");

const csv = [
  "CustomLabel,*Title,*C:Card Name,*C:Card Number,*C:Set,C:Card Condition,PicURL",
  "KA1,Riolu 06-Dec DP Trainer Kit: Manaphy & Lucario Pokémon TCG English HP,Riolu,06-Dec,DP Trainer Kit: Manaphy & Lucario,Heavily Played,https://x/1.jpg",
  "KA2,Umbreon VMAX 215/203 Evolving Skies,Umbreon VMAX,215/203,Evolving Skies,Near Mint,https://x/2.jpg"
].join("\n");
const items = extractItems(csv, { allowNoNumber: true });
eq("the file's number is repaired", items[0].cardNumber, "6/12");
eq("…and the title says it too", items[0].title, "Riolu 6/12 DP Trainer Kit: Manaphy & Lucario Pokémon TCG English HP");
eq("…and the row says it was repaired", items[0].cardNumberRepaired, true);
eq("an untouched row's title is as written", items[1].title, "Umbreon VMAX 215/203 Evolving Skies");

// A batch saved before the fix mends itself when opened (Add copies refuses
// to reload SKUs it already has, so reloading the file was no way out).
const saved = [
  { id: "r1", key: "riolu|06-dec|dp trainer kit: manaphy & lucario|HP", title: "Riolu 06-Dec DP Trainer Kit: Manaphy & Lucario Pokémon TCG English HP",
    cardNumber: "06-Dec", card: { name: "Riolu", number: "06-Dec" }, comps: { pence: 249, n: 0 }, pricePence: 249, picks: ["x"], checkedAt: 1, copies: [{ sku: "KA1" }] },
  { id: "r2", key: "geodude|01-nov|dp trainer kit|HP|p:rev", title: "Geodude 01-Nov", cardNumber: "01-Nov", card: { number: "01-Nov" }, comps: { pence: 249 }, pricePence: 500, copies: [{ sku: "KA2" }] },
  { id: "r3", key: "umbreon vmax|215/203|evolving skies|NM", title: "Umbreon", cardNumber: "215/203", card: { number: "215/203" }, comps: { pence: 90000 }, pricePence: 90000, copies: [{ sku: "KA3" }] },
  { id: "r4", key: "x|02-nov|y|NM", title: "x 02-Nov", cardNumber: "02-Nov", card: { number: "02-Nov" }, result: { ok: true, itemId: "1" }, copies: [{ sku: "KA4" }] }
];
const mended = repairDateNumbers(saved);
eq("the number, title, card and key are put right", [mended[0].cardNumber, mended[0].title, mended[0].card.number, mended[0].key],
  ["6/12", "Riolu 6/12 DP Trainer Kit: Manaphy & Lucario Pokémon TCG English HP", "6/12", "riolu|6/12|dp trainer kit: manaphy & lucario|HP"]);
eq("the comps from the wrong search go, and a price that only came from them", [mended[0].comps, mended[0].pricePence, mended[0].picks, mended[0].checkedAt], [null, null, null, null]);
eq("a typed price stays, and the printing part of the key rides through", [mended[1].pricePence, mended[1].key], [500, "geodude|1/11|dp trainer kit|HP|p:rev"]);
eq("a clean row is the same object", mended[2], saved[2]);
eq("a listed row is never touched", mended[3], saved[3]);
const clean = [saved[2]];
eq("nothing to mend hands back the same array, so opening saves nothing", repairDateNumbers(clean) === clean, true);
const page = readFileSync(new URL("../apps/app/app/panel/lab/add/LabAdd.js", import.meta.url), "utf8");
eq("Add copies mends a batch as it opens it, and on reload", (page.match(/repairDateNumbers\(/g) || []).length >= 2, true);

if (fails) { console.error(`\n${fails} of ${n} Excel date checks failed.`); process.exit(1); }
console.log(`✓ ${n} Excel date checks pass.`);
