/**
 * What survives when a batch run is saved and re-opened.
 *
 *   node scripts/check-batchsave.mjs      (or: npm run check)
 *
 * A run of the Batch screen costs one SoldComps request per card. Until the
 * run was saved, the results lived only in React state, and opening a deep
 * dive navigates to another section — which remounts the panel and threw the
 * lot away. A 59-card run was one click from being gone.
 *
 * The round trip below is the whole promise, so it is asserted field by field
 * rather than by count: a run that comes back with its prices but not the
 * comps behind them still LOOKS fine, and the screen it comes back on exists
 * to answer "why that price". The fixture is one priced card with a dropped
 * comp, one card that failed outright, and one card whose asking prices were
 * fetched — the three shapes a real run contains.
 *
 * The grep at the end is the same guard the rest of these checks use against a
 * second derivation: the shape of a saved run is defined once, in
 * apps/app/lib/batch-store.js, because the sessionStorage copy and the
 * Supabase copy disagreeing would be invisible until the day one was needed.
 */
import { readFileSync } from "node:fs";
import {
  batchRows,
  restoreResults,
  slimComp,
  storableText,
  labelFor,
  expiresAtIso,
  RETENTION_DAYS
} from "../apps/app/lib/batch-store.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

// --- the fixture -----------------------------------------------------------
// A comp carries a lot more than this from SoldComps; these are the fields the
// results screen actually renders (CompsDetail in Panel.js).
const comp = (over = {}) => ({
  title: "Umbreon VMAX 215/203 Evolving Skies",
  itemPricePence: 83000,
  postagePence: 199,
  totalPence: 83199,
  itemLocation: null,
  epid: "ignored-by-the-screen",
  categoryId: "183454",
  _source: { url: "https://www.ebay.co.uk/itm/1", endedAt: "2026-08-19T10:00:00Z", seller: "ignored" },
  ...over
});

const RESULTS = [
  {
    title: "Umbreon VMAX 215/203",
    sku: "SKU-1",
    query: "Umbreon VMAX 215/203",
    rec: {
      rawPence: 83199,
      finalPence: 83500,
      confidence: "High",
      dataSource: "sold",
      note: "Recency-weighted price from 2 sale(s).",
      graded: [{ label: "PSA 10", count: 3, medianPence: 190000, loPence: 175000, hiPence: 210000 }],
      included: [comp(), comp({ itemPricePence: 81000, totalPence: 81000, postagePence: 0 })],
      excluded: [
        comp({ itemPricePence: 4475, totalPence: 4475, exclusionReason: "priceOutlier", itemLocation: "Germany" })
      ]
    },
    nameTokens: ["umbreon", "vmax"],
    set: "Evolving Skies",
    cardNumber: "215/203",
    csvItem: { sku: "SKU-1", startPrice: "799.99", cardNumber: "215/203" }
  },
  {
    title: "Kingdra 106/144",
    sku: "SKU-2",
    query: "Kingdra 106/144",
    csvItem: null,
    rec: null,
    failed: "SoldComps returned 0 raw results for this exact query."
  },
  {
    title: "Charizard 4/102",
    sku: "",
    query: "Charizard 4/102",
    rec: {
      rawPence: 12000, finalPence: 11995, confidence: "Medium", dataSource: "sold",
      note: "Median of 4 comparable sale(s).", graded: [],
      included: [comp({ title: "Charizard 4/102 Base Set", itemPricePence: 12000, totalPence: 12000 })],
      excluded: []
    },
    nameTokens: ["charizard"],
    set: null,
    cardNumber: "4/102"
  }
];
// Asking prices were fetched for the third card only — the sparse case, which
// is the one an index-keyed map gets wrong.
const ACTIVE = {
  2: { loading: false, rec: { rawPence: 14000, finalPence: 13999, confidence: "Medium", dataSource: "active", note: "3 ACTIVE (asking) price(s).", graded: [], included: [comp({ title: "Charizard 4/102 listed now" })], excluded: [] } }
};

// --- 1. the round trip -----------------------------------------------------
const stored = batchRows(RESULTS, ACTIVE);
const back = restoreResults(stored);

eq("every card comes back", back.results.length, RESULTS.length);

for (let i = 0; i < RESULTS.length; i++) {
  const before = RESULTS[i];
  const after = back.results[i];
  eq(`card ${i} title`, after.title, before.title);
  eq(`card ${i} query`, after.query, before.query);
  eq(`card ${i} sku`, after.sku, before.sku || "");
  eq(`card ${i} csvItem`, after.csvItem, before.csvItem || null);
  // Kept so a re-check of active listings on a re-opened run can re-run the
  // same pricing call the original did, rather than a looser one.
  eq(`card ${i} nameTokens`, after.nameTokens, before.nameTokens || null);
  eq(`card ${i} set`, after.set, before.set || null);
  eq(`card ${i} cardNumber`, after.cardNumber, before.cardNumber || null);

  if (!before.rec) {
    eq(`card ${i} has no recommendation`, after.rec, null);
    // A card that failed has to say why, or a re-opened run reads as if it
    // was never asked about.
    eq(`card ${i} failure reason`, after.failed, before.failed);
    continue;
  }
  for (const key of ["rawPence", "finalPence", "confidence", "dataSource", "note", "graded"]) {
    eq(`card ${i} rec.${key}`, after.rec[key], before.rec[key]);
  }
  // Counts drive "N used / M excluded" and the exclusion breakdown under it.
  eq(`card ${i} comps used`, after.rec.included.length, before.rec.included.length);
  eq(`card ${i} comps excluded`, after.rec.excluded.length, before.rec.excluded.length);
}

// --- 2. what a comp has to carry ------------------------------------------
// Each of these is a column of the comps table on the results screen. A comp
// that loses its exclusion reason is the worst of them: the screen's whole
// job on a saved run is to say why a price is what it is.
const droppedBefore = RESULTS[0].rec.excluded[0];
const droppedAfter = back.results[0].rec.excluded[0];
eq("dropped comp — price", droppedAfter.itemPricePence, droppedBefore.itemPricePence);
eq("dropped comp — postage", droppedAfter.postagePence, droppedBefore.postagePence);
eq("dropped comp — total", droppedAfter.totalPence, droppedBefore.totalPence);
eq("dropped comp — location", droppedAfter.itemLocation, droppedBefore.itemLocation);
eq("dropped comp — why it was dropped", droppedAfter.exclusionReason, "priceOutlier");
eq("dropped comp — listing title", droppedAfter.title, droppedBefore.title);
eq("dropped comp — link back to the listing", droppedAfter._source.url, droppedBefore._source.url);
eq("dropped comp — date sold", droppedAfter._source.endedAt, droppedBefore._source.endedAt);

// A kept comp keeps no exclusion reason at all — the presence of the field is
// what the table reads.
if ("exclusionReason" in back.results[0].rec.included[0]) {
  fail("a comp that was USED came back carrying an exclusionReason");
}

// The fields nothing renders are dropped on purpose: a run is around a
// megabyte of comps as it is.
const slim = slimComp(comp());
eq("a stored comp carries only what is shown", Object.keys(slim).sort(), ["_source", "itemLocation", "itemPricePence", "postagePence", "title", "totalPence"]);

// --- 3. asking prices land back on the right card --------------------------
eq("asking prices restored for the card they were fetched for", Object.keys(back.activeByIndex), ["2"]);
eq("asking price figure", back.activeByIndex[2].rec.finalPence, 13999);
eq("asking price listings", back.activeByIndex[2].rec.included.length, 1);
if (back.activeByIndex[2].loading !== false) fail("a restored asking price must not come back still loading");

// Rows arriving out of order must not shift the index the asking prices hang
// on — that would quietly show one card's listings under another's name.
const shuffled = [stored[2], stored[0], stored[1]];
const reordered = restoreResults(shuffled);
eq("out-of-order rows are sorted by position", reordered.results.map((r) => r.title), RESULTS.map((r) => r.title));
eq("asking prices follow the sort", Object.keys(reordered.activeByIndex), ["2"]);

// --- 4. characters Postgres won't take -------------------------------------
// eBay titles are scraped, and an 89-card run carries several thousand of
// them. A NUL byte is rejected outright in text and jsonb; a lone surrogate —
// half a character pair, left where a title was cut mid-emoji — is not valid
// UTF-8 on the wire. Either one used to fail the insert, and the insert
// failing used to delete the whole run.
eq("a NUL byte is dropped", storableText("Umbreon\u0000 VMAX"), "Umbreon VMAX");
eq("a lone high surrogate is dropped", storableText("Charizard \ud83d"), "Charizard ");
eq("a lone low surrogate is dropped", storableText("Charizard \ude00 holo"), "Charizard  holo");
// A complete pair is a real character in a real seller's title, and stays.
eq("a whole emoji survives", storableText("Charizard \ud83d\ude00 holo"), "Charizard 😀 holo");
eq("ordinary punctuation survives", storableText("Pokémon — Umbreon VMAX 215/203 (NM)"), "Pokémon — Umbreon VMAX 215/203 (NM)");
eq("a clean title is returned untouched", storableText("Charizard 4/102"), "Charizard 4/102");
eq("a missing value stays missing", storableText(null), null);

// The cleaning has to happen where a comp is stored, not only in the helper —
// that is the path every scraped title actually takes.
const dirty = slimComp(comp({ title: "Umbreon\u0000 VMAX \ud83d", itemLocation: "Germany\u0000" }));
eq("a stored comp's title is storable", dirty.title, "Umbreon VMAX ");
eq("a stored comp's location is storable", dirty.itemLocation, "Germany");
const dirtyRow = batchRows([{ title: "Card\u0000", query: "q\u0000", sku: "S\u0000", rec: null, failed: "why\u0000" }])[0];
eq("a row's own text is storable too", [dirtyRow.title, dirtyRow.query, dirtyRow.sku, dirtyRow.failed], ["Card", "q", "S", "why"]);

// --- 5. what the list says about a run ------------------------------------
eq("a CSV run is named after its file", labelFor({ csvName: "stock-aug.csv", count: 59 }), "59 cards from stock-aug.csv");
eq("a pasted run says so", labelFor({ count: 59 }), "59 cards pasted");
eq("one card is not 1 cards", labelFor({ count: 1 }), "1 card pasted");

// --- 6. the retention promise ---------------------------------------------
// A run is a working document — priced, then listed off over the following
// days — so anything under a week defeats the point of saving it.
if (!(RETENTION_DAYS >= 7)) fail(`RETENTION_DAYS is ${RETENTION_DAYS} — a saved run has to outlast processing it`);
const days = Math.round((new Date(expiresAtIso(Date.parse("2026-08-25T12:00:00Z"))).getTime() - Date.parse("2026-08-25T12:00:00Z")) / 86400000);
eq("expiry is the stated retention", days, RETENTION_DAYS);

// The column default and the constant have to agree, or a row written by
// anything but the panel outlives (or undercuts) what the screen promises.
const migration = readFileSync(new URL("../supabase/migrations/023_price_batches.sql", import.meta.url), "utf8");
const interval = /now\(\)\s*\+\s*interval\s*'(\d+)\s*days'/.exec(migration);
if (!interval) fail("migration 023 no longer sets a default expires_at");
else eq("migration default matches RETENTION_DAYS", Number(interval[1]), RETENTION_DAYS);

// --- 7. one definition of a saved run -------------------------------------
// The Supabase copy and the sessionStorage copy go through the same
// serialiser. Two of them would disagree eventually, and the disagreement
// would surface as a run that re-opens looking complete.
const panel = readFileSync(new URL("../apps/app/app/panel/Panel.js", import.meta.url), "utf8");
for (const call of ["batchRows(", "restoreResults("]) {
  if (!panel.includes(call)) fail(`Panel.js no longer goes through ${call} — the two saved copies can now drift`);
}
for (const table of ["price_batches", "price_batch_items"]) {
  if (panel.includes(table)) {
    fail(`Panel.js names ${table} directly — the table shape belongs in lib/batch-store.js alone`);
  }
}
const store = readFileSync(new URL("../apps/app/lib/batch-store.js", import.meta.url), "utf8");
if (/^\s*import\s+.*from\s+["']@\//m.test(store)) {
  fail("batch-store.js has picked up an app-aliased import — it has to stay loadable under bare node for this check");
}

if (failures) {
  console.error(`\ncheck-batchsave: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-batchsave: OK — a saved run comes back with its comps, its exclusions and its asking prices.");
