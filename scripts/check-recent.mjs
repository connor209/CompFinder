/**
 * The recents list: what "the cards you looked at" is allowed to contain.
 *
 *   node scripts/check-recent.mjs      (or: npm run check)
 *
 * Small rules, but every one of them is visible on the search screen the
 * moment it is wrong: a card listed twice under two spellings, a list that
 * grows without limit, or the one you looked at last sitting at the bottom.
 *
 * Offline. localStorage is stubbed, because the rules are about the shape of
 * the list and none of them are about a browser.
 */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

const { readRecent, rememberSearch, clearRecent, RECENT_LIMIT } =
  await import("../apps/public/lib/recent-searches.js");

let failures = 0;
const check = (label, got, want) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    console.error(`  WRONG  ${label}\n         expected ${b}\n         got      ${a}`);
    failures++;
  }
};

const card = (name, number, set) => ({ name, number, set, q: [name, number, set].join(" ") });
const names = () => readRecent().map((r) => r.name);

// Nothing stored is an empty list, not a throw and not a null.
check("an empty history", readRecent(), []);

// Most recent first — the whole point of the list.
rememberSearch(card("Umbreon VMAX", "215", "Evolving Skies"));
rememberSearch(card("Charizard ex", "223", "Obsidian Flames"));
check("newest first", names(), ["Charizard ex", "Umbreon VMAX"]);

// Looking at a card again MOVES it, and never adds a second row of it.
rememberSearch(card("Umbreon VMAX", "215", "Evolving Skies"));
check("a repeat moves to the front", names(), ["Umbreon VMAX", "Charizard ex"]);

// Deduped on the normalised query, so case and spacing are one card. Two rows
// for one card is the failure a visitor sees first.
rememberSearch({ name: "Umbreon VMAX", number: "215", set: "Evolving Skies", q: "  umbreon   VMAX 215   evolving skies " });
check("case and spacing are the same card", names(), ["Umbreon VMAX", "Charizard ex"]);

// A different printing of the same NAME is a different card and keeps its row.
rememberSearch(card("Umbreon VMAX", "215", "Evolving Skies Alt"));
check("a different set is a different card", names().length, 3);

// A grade the visitor typed rides on the row, so coming back to a graded
// search asks about the slab again rather than quietly swapping to the raw
// card. Still ONE row per card — the graded and the raw search dedupe
// together, and the latest way it was asked is the way the row asks it.
clearRecent();
rememberSearch(card("Umbreon VMAX", "215", "Evolving Skies"));
rememberSearch(card("Umbreon VMAX", "215", "Evolving Skies"), "PSA 10 umbreon vmax 215");
check("a graded repeat is still one row", names(), ["Umbreon VMAX"]);
check("the row replays the graded ask", readRecent()[0].q, "PSA 10 Umbreon VMAX 215 Evolving Skies");
rememberSearch(card("Umbreon VMAX", "215", "Evolving Skies"), "umbreon vmax 215");
check("a raw repeat is still one row", names(), ["Umbreon VMAX"]);
check("and the latest ask wins", readRecent()[0].q, "Umbreon VMAX 215 Evolving Skies");

// The cap holds, and it drops the OLDEST rather than refusing the newest.
clearRecent();
for (let i = 1; i <= RECENT_LIMIT + 4; i++) rememberSearch(card(`Card ${i}`, String(i), "Set"));
check(`capped at ${RECENT_LIMIT}`, readRecent().length, RECENT_LIMIT);
check("the newest survives", readRecent()[0].name, `Card ${RECENT_LIMIT + 4}`);
check("the oldest is gone", names().includes("Card 1"), false);

// Nothing without a query or a name is storable: a row that can't be clicked
// is a row that shouldn't be drawn.
clearRecent();
rememberSearch({ name: "No query anywhere" });
rememberSearch({ q: "no name" });
rememberSearch(null);
check("unusable rows are refused", readRecent(), []);

// A query passed alongside a card with none of its own is used.
rememberSearch({ name: "Typed It Myself" }, "typed it myself");
check("the fallback query is used", readRecent().map((r) => r.q), ["typed it myself"]);

// Junk from an older build of the site is dropped on read, not rendered.
store.set("lc-recent", JSON.stringify([{ q: "Good 1 Set", name: "Good" }, { name: "no q" }, null, "nope"]));
check("junk rows are dropped on read", readRecent().map((r) => r.name), ["Good"]);
store.set("lc-recent", "{not json");
check("unparseable storage is an empty list", readRecent(), []);

// Clear means clear, and says so.
rememberSearch(card("Anything", "1", "Set"));
check("clear returns an empty list", clearRecent(), []);
check("clear empties the store", readRecent(), []);

if (failures) {
  console.error(`\nrecent: ${failures} case(s) failed.`);
  process.exit(1);
}
console.log("recent: order, dedupe, cap, junk and clear all hold.");
