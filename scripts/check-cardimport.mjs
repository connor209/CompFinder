/**
 * A CardUploader export, kept — and what survives keeping it.
 *
 *   node scripts/check-cardimport.mjs      (or: npm run check)
 *
 * The Batch screen read these files for a year and kept four fields out of
 * twenty-five, which is why a row could only ever say its title. The scans of
 * the copy in your hand were in `PicURL` the whole time; so were the set, the
 * rarity, the year, the illustrator and the type.
 *
 * Three things here are worth failing loudly over:
 *
 * - **The serialiser and migration 028 have to agree.** A field added to one
 *   and not the other is invisible until Postgres rejects the whole insert,
 *   and it rejects the whole run of rows, not the bad column.
 * - **`title_original` must never be writable.** The title is what the engine
 *   searches on, so editing it changes the price — which only stays honest
 *   while the file's own wording survives beside it. Same discipline as
 *   `finalPence` sitting under `overridePence`.
 * - **A batch run must price the EDITED title.** That is the entire point of
 *   being able to correct one; handing the original to the engine would make
 *   the edit a decoration.
 */
import { readFileSync } from "node:fs";
import CardUploaderCsv from "../apps/app/lib/carduploader.js";
import {
  importRows, restoreItems, isEdited, batchItemsFrom, labelFor, priceToPence,
  isMissingTable, updateItem
} from "../apps/app/lib/import-store.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// A real export's header, and one real row off one. The column names are the
// literals that matter: eBay files the Pokémon type under the MAGIC colour
// aspect, and a rename here silently empties a field on screen.
const HEADER = [
  "CustomLabel", "*Title", "*C:Card Name", "*C:Card Number", "*C:Set", "C:Card Condition",
  "*StartPrice", "*Quantity", "*C:Graded", "PicURL", "*C:Attribute/MTG:Colour", "*C:Rarity",
  "*C:Year Manufactured", "*C:Illustrator", "*C:Stage", "*C:Language", "*C:Character",
  "*C:Game", "*C:Finish"
];
const ROW = [
  "BB1", "Emboar 33/236 Cosmic Eclipse Pokemon Reverse Holo NM", "Emboar", "33/236",
  "Cosmic Eclipse", "Near Mint or Better:", "2.49", "1", "No",
  "https://images.carduploader.com/a.jpg|https://images.carduploader.com/b.jpg",
  "Fire", "Rare", "2019", "kawayoo", "Stage 2", "English", "Emboar", "Pokémon TCG", ""
];
const csv = [HEADER, ROW].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");

// --- 1. what comes out of the file ----------------------------------------
const [item] = CardUploaderCsv.extractItems(csv);
if (!item) {
  fail("extractItems() read nothing out of a well-formed export");
} else {
  eq("the scans, in the file's order", item.images,
    ["https://images.carduploader.com/a.jpg", "https://images.carduploader.com/b.jpg"]);
  eq("the type, off eBay's Magic colour aspect", item.cardType, "Fire");
  eq("rarity", item.rarity, "Rare");
  eq("year", item.year, "2019");
  eq("illustrator", item.illustrator, "kawayoo");
  eq("stage", item.stage, "Stage 2");
  eq("language", item.language, "English");
  eq("quantity", item.quantity, "1");
  // The reason this app reads the TITLE for the printing and not the file's
  // own finish column: on a real 50-card export it was filled on 2 rows while
  // 49 titles said Reverse Holo. The row above is one of the 48.
  eq("a blank *C:Finish next to a Reverse Holo title is the normal case",
    [/reverse holo/i.test(item.title), ROW[HEADER.indexOf("*C:Finish")]], [true, ""]);
}

// The scan list is a list, not a string, and nothing that isn't a URL survives.
eq("pipe-separated, trimmed, junk dropped",
  CardUploaderCsv.splitPicUrls(" https://a/1.jpg | not-a-url |https://a/2.jpg "),
  ["https://a/1.jpg", "https://a/2.jpg"]);
eq("no PicURL is an empty list, never a crash", CardUploaderCsv.splitPicUrls(""), []);

// --- 2. the details a row shows, in the order it shows them ----------------
eq("the specifics, ordered and named once",
  CardUploaderCsv.itemSpecifics(item).map((s) => s.label),
  ["Card name", "Number", "Type", "Set", "Year", "Rarity", "Stage", "Illustrator", "Language"]);
eq("an empty field is dropped, not rendered as a labelled blank",
  CardUploaderCsv.itemSpecifics({ cardName: "Ekans", rarity: "", year: null }).map((s) => s.label),
  ["Card name"]);

// --- 3. the round trip ----------------------------------------------------
{
  const rows = importRows([{ ...item, titleOriginal: item.title }], { userId: "u1", importId: "i1" });
  const back = restoreItems(rows.map((r, i) => ({ ...r, id: `row-${i}` })));
  const [b] = back;
  eq("the scans survive being saved", b.images, item.images);
  eq("so do the details", [b.cardType, b.rarity, b.year, b.illustrator, b.stage, b.language],
    ["Fire", "Rare", "2019", "kawayoo", "Stage 2", "English"]);
  eq("the set comes back off set_name", b.set, "Cosmic Eclipse");
  eq("£2.49 in the file is 249 pence and comes back as it went", [rows[0].start_price_pence, b.startPrice], [249, "2.49"]);
  eq("quantity is a number in the column and survives", [rows[0].quantity, b.quantity], [1, 1]);
  eq("rows come back in the file's order however they arrive",
    restoreItems([{ position: 2, title: "c" }, { position: 0, title: "a" }, { position: 1, title: "b" }])
      .map((r) => r.title), ["a", "b", "c"]);
  eq("a row with no price is not a free card", priceToPence(""), null);
  eq("...and neither is one at zero", priceToPence("0"), null);
}

// --- 4. an edit, and what it may not touch --------------------------------
{
  const edited = { ...item, titleOriginal: item.title, title: "Emboar 33/236 Cosmic Eclipse Reverse Holo LP" };
  const [row] = importRows([edited], { userId: "u1", importId: "i1" });
  eq("the file's wording is what title_original keeps", row.title_original, item.title);
  eq("...and the edit is what title carries", row.title, edited.title);
  eq("an edited row says so", isEdited(edited), true);
  eq("an untouched row does not", isEdited({ ...item, titleOriginal: item.title }), false);

  // The run prices what you corrected. Anything else makes the edit a decoration.
  const [batch] = batchItemsFrom([edited]);
  eq("a batch run searches the EDITED title", batch.title, edited.title);
  eq("...and carries the row along for the current-price column and the re-export",
    batch.csvItem.title, edited.title);
}

// The patch is an allow-list built key by key. Spread the row in instead and
// `title_original` goes back to the database as the edited text, which erases
// the only record of what the file said — silently, and the row still looks
// fine afterwards.
{
  let sent = null;
  const fakeSupabase = {
    from: () => ({ update: (payload) => { sent = payload; return { eq: async () => ({ error: null }) }; } })
  };
  await updateItem(fakeSupabase, "row-1", {
    title: "new title", sku: "BB9", condition: "LP", quantity: "3",
    title_original: "HACKED", titleOriginal: "HACKED", user_id: "someone-else", images: ["x"]
  });
  eq("only what a person can type is written",
    Object.keys(sent || {}).sort(), ["condition", "edited_at", "quantity", "sku", "title"]);
  eq("the file's wording is not writable from a patch", sent?.title_original, undefined);
  eq("nor is the owner", sent?.user_id, undefined);
  eq("a quantity arrives as a number", sent?.quantity, 3);

  const nothing = await updateItem(fakeSupabase, "row-1", {});
  eq("a patch with nothing in it writes nothing", nothing, { ok: true, unchanged: true });
}

// --- 5. a pending migration degrades, it does not throw -------------------
eq("Postgres's own code for a missing table", isMissingTable({ code: "42P01" }), true);
eq("PostgREST's schema cache, which says it differently",
  isMissingTable({ message: 'Could not find the table "public.card_imports" in the schema cache' }), true);
eq("an ordinary failure is NOT a pending migration — it must not be swallowed",
  isMissingTable({ message: "network error" }), false);
eq("the list label names the file, because three of them look identical without it",
  labelFor({ fileName: "stock.csv", count: 50 }), "50 cards from stock.csv");

// --- 6. the serialiser and the migration have to agree --------------------
{
  const sql = read("supabase/migrations/028_card_imports.sql");
  const body = sql.slice(sql.indexOf("create table if not exists public.card_import_items"));
  const declared = new Set(
    [...body.slice(0, body.indexOf("unique (")).matchAll(/^\s{2}([a-z_]+)\s+[a-z]/gm)].map((m) => m[1])
  );
  const written = Object.keys(importRows([item], { userId: "u", importId: "i" })[0]);
  for (const col of written) {
    if (!declared.has(col)) {
      fail(`import-store.js writes \`${col}\`, which migration 028 does not declare — Postgres rejects the whole insert, not the column`);
    }
  }
  if (!declared.has("title_original")) fail("migration 028 no longer keeps the file's own title");
  if (!/on delete cascade/.test(body)) fail("deleting an import would leave its items behind");
}

// --- 7. one file names the tables ----------------------------------------
// The rule batch-store.js and wants-store.js already keep. A second place
// naming a table is a second way for a pending migration to take out a screen.
{
  const FILES = [
    "apps/app/app/panel/Imports.js",
    "apps/app/app/panel/Panel.js",
    "apps/app/lib/carduploader.js"
  ];
  for (const f of FILES) {
    if (/from\(["']card_import/.test(read(f))) {
      fail(`${f} queries card_imports itself — import-store.js is the only file that may name those tables`);
    }
  }
  if (!/from\("card_imports"\)/.test(read("apps/app/lib/import-store.js"))) {
    fail("import-store.js no longer names card_imports — the table has moved without this check moving with it");
  }
  // Catalogue art is deliberately NOT what a row shows: these are photographs
  // of the copy in your hand, and publisher artwork would show a mint card to
  // somebody holding a played one. Counter mode settled this already.
  if (/card_catalog|image_small/.test(read("apps/app/app/panel/Imports.js"))) {
    fail("the import row is reaching for catalogue art — the scan is of THIS copy and that is the point of it");
  }
}

if (failures) {
  console.error(`\ncheck-cardimport: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-cardimport: OK — the scans and the card details survive the file, an edit is visible and reversible, and the run prices what you corrected.");
