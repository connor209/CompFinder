/**
 * The label file the Nimbot printer imports.
 *
 *   node scripts/check-labels.mjs      (or: npm run check)
 *
 * The format is not ours to design: two columns, `Price` then `Name`, and the
 * printer's app generates a label per row. So the column names and their ORDER
 * are pinned here as literals. Getting them wrong doesn't fail loudly — the
 * import either refuses the file or, worse, prints a hundred labels with the
 * price where the name should be.
 *
 * The workbook is built for real and its bytes read back, rather than the
 * writer being trusted. A hand-rolled ZIP is exactly the kind of thing that
 * looks right and is rejected by the one program that has to open it, and the
 * failure would land on a show morning with a roll of labels waiting.
 *
 * The NAME rule is the judgement call. A label is physically small and the
 * printer does not wrap, so an over-long name is cut off at the edge of the
 * sticker — which is why the cut happens in our code, where the screen can
 * show it first. The cases below are real eBay listing titles: the fixture is
 * that a title is written for search engines and has to be reduced to what a
 * person needs to read across a table.
 */
import { readFileSync } from "node:fs";
import { labelName, fit, stickerRows, NAME_LENGTHS, DEFAULT_NAME_MAX } from "../apps/app/lib/showstock.js";
import { labelRows, labelPrice, labelWorkbook, labelFile, xmlText, LABEL_COLUMNS } from "../apps/app/lib/labelexport.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};
const ok = (label, cond) => { if (!cond) fail(label); };

// --- 1. the printer's format, which is not ours to change ------------------
eq("Price first, Name second — the printer's order", LABEL_COLUMNS, ["Price", "Name"]);

// --- 2. the price as it prints ---------------------------------------------
// The cash ladder only ever lands on whole pounds, so a sticker never needs
// pence. "£3.00" would read like a listing price and cost three characters.
eq("whole pounds, no pence", labelPrice(300), "£3");
eq("a big one", labelPrice(84000), "£840");
eq("the minimum", labelPrice(100), "£1");
eq("no price is an empty cell, not '£0'", labelPrice(null), "");
eq("nonsense is an empty cell", labelPrice("nope"), "");

// --- 3. the name, cut to something a label can hold ------------------------
// [title, max, expected, why this case is here]
const NAMES = [
  ["Pokemon TCG Umbreon VMAX 215/203 Evolving Skies Alt Art Ultra Rare NM", 30,
    "Umbreon VMAX 215/203",
    "everything after the collector number is set, rarity and condition"],
  ["Charizard V 154/185 Vivid Voltage Full Art Near Mint", 30,
    "Charizard V 154/185",
    "the number is the natural end of the name"],
  ["Mew ex 232/165 151 Special Illustration Rare", 30,
    "Mew ex 232/165",
    "a set called 151 does not confuse the number match"],
  ["Pikachu Illustrator Promo (Graded PSA 9) Rare", 30,
    "Pikachu Illustrator Promo Rare",
    "bracketed asides are qualifiers, never the name"],
  ["Pokemon Blastoise 2/102 Base Set", 30,
    "Blastoise 2/102",
    "a leading noise word costs label width and carries nothing"],
  ["Iron Hands ex 070/162 Temporal Forces", 20,
    "Iron Hands… 070/162",
    "one char over: the NAME gives way so the number survives, because the number is what matches a stray label to a card"],
  ["Iron Hands ex 070/162 Temporal Forces", 30,
    "Iron Hands ex 070/162",
    "with room, nothing is cut at all"],
  ["Roaring Moon ex 124/182 Paradox Rift Special Illustration Rare", 16,
    "Roaring… 124/182",
    "squeezed hard, the number still survives"],
  ["Some Really Long Card Name Without Any Number At All", 30,
    "Some Really Long Card Name…",
    "no number to cut at, so it truncates on a word and says so"],
  ["", 30, "", "nothing in, nothing out"],
  [null, 30, "", "null in, nothing out"],
  ["Pokemon TCG", 30, "Pokemon TCG",
    "a title that is ALL noise keeps its original — a nameless label is useless"]
];
for (const [title, max, want, why] of NAMES) {
  eq(`name: ${why}`, labelName(title, max), want);
}

// A cut name never exceeds the label it was cut for, at any offered width —
// the ellipsis counts, and so does the number kept on the end.
const LONG = [
  "Charizard ex Special Illustration Rare Obsidian Flames Full Art English",
  "Roaring Moon ex 124/182 Paradox Rift Special Illustration Rare",
  "Pokemon TCG Umbreon VMAX 215/203 Evolving Skies Alt Art Ultra Rare NM"
];
for (const max of Object.values(NAME_LENGTHS)) {
  for (const title of LONG) {
    ok(`"${title.slice(0, 20)}…" cut to ${max} fits`, labelName(title, max).length <= max);
  }
}
eq("the default width is one of the offered ones",
  Object.values(NAME_LENGTHS).includes(DEFAULT_NAME_MAX), true);

// fit() itself, since the name rule leans on it
eq("short text is untouched", fit("Umbreon VMAX", 30), "Umbreon VMAX");
eq("exact length is untouched", fit("x".repeat(30), 30), "x".repeat(30));
ok("over-long text is cut to the limit", fit("x".repeat(80), 30).length <= 30);
ok("over-long text is marked as cut", fit("x".repeat(80), 30).endsWith("…"));
eq("no space is left stranded before the ellipsis",
  fit("Iron Hands ex Special Illustration", 20).endsWith(" …"), false);

// --- 4. which cards get a label --------------------------------------------
const rec = (over = {}) => ({
  finalPence: 83500, confidence: "High", dataSource: "sold",
  included: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], ...over
});
const RESULTS = [
  { sku: "AB11", title: "Pokemon Umbreon VMAX 215/203 Evolving Skies", rec: rec() },
  { sku: "AB12", title: "Charizard V 154/185 Vivid Voltage", rec: rec({ confidence: "Low", included: [1] }) },
  { sku: "AB13", title: "Snorlax 131/198", rec: null, failed: "SoldComps timed out" },
  { sku: "AB14", title: "Mew ex 232/165", rec: rec({ dataSource: "active" }) },
  { sku: "AB15", title: "Blastoise 2/102 Base Set", rec: rec({ finalPence: 1249, confidence: "Medium" }) }
];
const rows = labelRows(RESULTS);
eq("only the priced cards get a label", rows.map((r) => r.Name),
  ["Umbreon VMAX 215/203", "Blastoise 2/102"]);
eq("and they carry their cash price", rows.map((r) => r.Price), ["£840", "£12"]);
ok("a held card has no blank label waiting to be priced at the table",
  !rows.some((r) => !r.Price));
eq("every row has exactly the printer's two keys",
  [...new Set(rows.flatMap((r) => Object.keys(r)))], ["Price", "Name"]);

// A price set by hand reaches the label — including on a card the engine
// held. That is the whole point of being able to type one: the alternative is
// carrying the card to the table with no sticker on it.
const HAND = labelRows(RESULTS, { overrides: { 1: 500, 3: 1500 } });
eq("hand-set prices are on the labels", HAND.map((r) => r.Price),
  ["£840", "£5", "£15", "£12"]);
eq("and in run order, next to the right cards", HAND.map((r) => r.Name),
  ["Umbreon VMAX 215/203", "Charizard V 154/185", "Mew ex 232/165", "Blastoise 2/102"]);

// --- 5. XML the sheet can actually hold ------------------------------------
eq("ampersands and angle brackets are escaped",
  xmlText("Charizard & <friends>"), "Charizard &amp; &lt;friends&gt;");
eq("a control character is dropped rather than written",
  xmlText(`a${String.fromCharCode(7)}b`), "ab");
eq("a newline survives — it is legal in XML text", xmlText("a\nb"), "a\nb");

// --- 6. the file is a file the printer can open ----------------------------
// Built for real, then read back out of its own bytes. Entries are STORED, so
// the XML appears verbatim and can be found without a decompressor.
const bytes = labelWorkbook([{ Price: "£3", Name: "Umbreon VMAX 215/203" }]);
const text = Buffer.from(bytes).toString("latin1");

ok("starts with the ZIP local-file signature", bytes[0] === 0x50 && bytes[1] === 0x4b);
ok("ends with the end-of-central-directory record", text.includes("PK\x05\x06"));
for (const part of [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/styles.xml",
  "xl/worksheets/sheet1.xml"
]) {
  ok(`the workbook contains ${part}`, text.includes(part));
}

// The header row, in the printer's order, in the sheet itself.
const sheet = text.slice(text.indexOf("<worksheet"));
const headerAt = LABEL_COLUMNS.map((c) => sheet.indexOf(`>${c}<`));
ok("both column headers are written", headerAt.every((i) => i !== -1));
ok("Price is written before Name", headerAt[0] < headerAt[1]);
ok("the header is row 1", sheet.includes('<row r="1">'));
ok("a card lands in row 2", sheet.includes('<row r="2">'));
ok("prices are text cells, so £ prints as typed", sheet.includes('t="inlineStr"'));
ok("the £ survives as UTF-8", Buffer.from(bytes).includes(Buffer.from("£3", "utf8")));

// Same rows in, same bytes out — nothing reads the clock, so a run is
// reproducible and this test can't go stale on a Tuesday.
ok("the writer is deterministic",
  Buffer.compare(
    Buffer.from(labelWorkbook([{ Price: "£3", Name: "A" }])),
    Buffer.from(labelWorkbook([{ Price: "£3", Name: "A" }]))
  ) === 0);

// An empty run must not hand back a workbook with a header and no cards.
eq("a run with nothing priced writes no file", labelFile([]).length, 0);

// --- 7. one definition of what a label says --------------------------------
// The name shown in the sticker panel and the name printed on the label are
// the same string, because both come off stickerRows(). Two of them would
// disagree about what was cut, and the screen is the only preview there is.
eq("the panel and the file agree on the cut name",
  stickerRows(RESULTS, { nameMax: 20 })[0].label,
  labelRows(RESULTS, { nameMax: 20 })[0].Name);

// The same for a price typed by hand: what the panel shows and what the label
// prints must be one number. Two would be invisible — both look like prices.
const opts = { nameMax: 20, overrides: { 1: 500 } };
eq("the panel and the file agree on a hand-set price",
  `£${Math.round(stickerRows(RESULTS, opts)[1].stickerPence / 100)}`,
  labelRows(RESULTS, opts).find((r) => r.Price === "£5").Price);
eq("and the file carries every priced card the panel shows",
  labelRows(RESULTS, opts).length,
  stickerRows(RESULTS, opts).filter((r) => !r.held).length);

const panel = readFileSync(new URL("../apps/app/app/panel/Panel.js", import.meta.url), "utf8");
if (!panel.includes("labelFile(")) {
  fail("Panel.js no longer builds the label file through labelFile()");
}
if (/\blabelName\s*\(/.test(panel)) {
  fail("Panel.js cuts names itself — it should read `label` off stickerRows(), or the preview and the print diverge");
}
const exporter = readFileSync(new URL("../apps/app/lib/labelexport.js", import.meta.url), "utf8");
if (/^\s*import\s+.*from\s+["']@\//m.test(exporter)) {
  fail("labelexport.js has picked up an app-aliased import — it has to stay loadable under bare node for this check");
}

if (failures) {
  console.error(`\ncheck-labels: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-labels: OK — Price then Name, whole pounds, names cut to fit, and a workbook that opens.");
