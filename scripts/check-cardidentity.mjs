/**
 * One identity per card (lib/card-identity.js, migration 045): the Cardmarket
 * product a card IS, matched once and kept, with the printing, language and
 * grade beside it — never the condition, which is the copy's.
 *
 *   node scripts/check-cardidentity.mjs      (or: npm run check)
 */
import { readFileSync } from "node:fs";
import { identityKey, isLinked, duplicateListings, languagePart, isReversePrinting } from "../apps/app/lib/card-identity.js";
import { linkCatalog } from "../apps/app/lib/lab-store.js";

let failed = 0, passed = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; return; }
  failed++;
  console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---- the key ----
eq("a linked card is its product", identityKey({ cardmarketId: 274512, name: "Geodude", number: "074/165" }), "cm:274512");
eq("the reverse holo is the same product, a different card", identityKey({ cardmarketId: 274512, finish: "Reverse Holo" }), "cm:274512|rev");
eq("a Japanese copy is a different card; English adds nothing", [identityKey({ cardmarketId: 5, language: "Japanese" }), identityKey({ cardmarketId: 5, language: "English" })], ["cm:5|ja", "cm:5"]);
eq("a slab carries its grade", identityKey({ cardmarketId: 5, grade: "PSA 10" }), "cm:5|gpsa10");
eq("condition is never part of it", identityKey({ cardmarketId: 5, condition: "LP" }), identityKey({ cardmarketId: 5, condition: "NM" }));
eq("Reverse Valley is a card, not a printing", isReversePrinting({ title: "Reverse Valley 110/123" }), false);
eq("an unlinked card keys off its own text, zeros and accents off", identityKey({ name: "Pokémon Center", number: "007/101", set: "Plasma Blast" }), "txt:pokemon center#7#plasma blast");
eq("a text key and a product key are told apart", [isLinked("cm:1"), isLinked("txt:x#1#y"), isLinked(null)], [true, false, false]);
eq("nothing to key on is null", identityKey({ name: "Charizard" }), null);
eq("languages", ["Japanese", "korean", "", "English", "Thai"].map(languagePart), ["ja", "ko", "", "", "thai"]);

// ---- the same card on two live listings ----
{
  const rows = [
    { id: "a", identity: "cm:1", condition: "NM", status: "live" },
    { id: "b", identity: "cm:1", condition: "nm", status: "live" },
    { id: "c", identity: "cm:1", condition: "LP", status: "live" },
    { id: "d", identity: "cm:1|rev", condition: "NM", status: "live" },
    { id: "e", identity: "cm:1", condition: "NM", status: "ended" },
    { id: "f", identity: null, condition: "NM", status: "live" }
  ];
  const d = duplicateListings(rows);
  eq("same card + condition, both selling, flag each other; another condition, the reverse, an ended listing and an unkeyed one don't", [...d.entries()], [["a", ["b"]], ["b", ["a"]]]);
}

// ---- linking, against a fake database ----
{
  const catalog = [
    { cardmarket_id: 10, name: "Geodude", collector_number: "74", expansion: "Pokemon Card 151" },
    { cardmarket_id: 11, name: "Geodude (Master Ball Pattern)", collector_number: "74", expansion: "Pokemon Card 151" },
    { cardmarket_id: 20, name: "Zubat", collector_number: "41", expansion: "Dark Phantasma" }
  ];
  const writes = [];
  const fake = (missing = false) => ({
    from(table) {
      const q = { table, filters: [], patch: null };
      const api = {
        select() { return api; },
        ilike(_, v) { q.ilike = v; return api; },
        limit() { return Promise.resolve({ data: catalog.filter((r) => r.expansion.toLowerCase() === String(q.ilike).toLowerCase()), error: null }); },
        update(p) { q.patch = p; return api; },
        eq(k, v) { q.filters.push([k, v]); return api; },
        is(k, v) { q.filters.push([k, v]); return api; },
        then(res) {
          if (missing) return res({ data: null, error: { message: "column stack_cards.cardmarket_id does not exist" } });
          writes.push(q);
          return res({ data: [{ id: "x" }, { id: "y" }], error: null });
        }
      };
      return api;
    }
  });
  const listings = [
    { id: "L1", title: "Geodude 074/165", card: { name: "Geodude", number: "074/165", set: "Pokemon Card 151" } },
    { id: "L2", title: "Geodude MB", card: { name: "Geodude (Master Ball Pattern)", number: "074/165", set: "Pokemon Card 151" } },
    { id: "L3", title: "Zubat 041", card: { name: "Golbat", number: "041/071", set: "Dark Phantasma" } },
    { id: "L4", title: "Done", card: { name: "Zubat", number: "041/071", set: "Dark Phantasma" } }
  ];
  const copies = [{ listing_id: "L1", cardmarket_id: null }, { listing_id: "L2", cardmarket_id: null }, { listing_id: "L3", cardmarket_id: null }, { listing_id: "L4", cardmarket_id: 20 }];
  const r = await linkCatalog(fake(), "u1", listings, copies);
  eq("the plain card and its pattern link to their own products; a number belonging to another card is refused, never borrowed",
    [r.ok, writes.map((w) => [w.filters.find((f) => f[0] === "lab_listing_id")[1], w.patch.cardmarket_id]), r.unmatched.map((u) => u.listingId), r.already],
    [true, [["L1", 10], ["L2", 11]], ["L3"], 1]);
  eq("every write names the user and only fills cards with no link", writes.every((w) => w.filters.some((f) => f[0] === "user_id" && f[1] === "u1") && w.filters.some((f) => f[0] === "cardmarket_id" && f[1] === null)), true);
  const m = await linkCatalog(fake(true), "u1", listings.slice(0, 1), copies);
  eq("before 045 it says so rather than failing quietly", [m.ok, m.missing], [false, true]);
}

// ---- the greps ----
{
  const route = read("apps/app/app/api/cardmarket/prices/route.js");
  if (!/catalogRowsForSets\(/.test(route) || /from\("card_catalog"\)/.test(route)) { failed++; console.error("✗ the price guide route must read the catalogue through lib/catalog-read.js, the same read the link uses"); } else passed++;
  if (!/cardmarketId/.test(route)) { failed++; console.error("✗ a linked card must be priced off its stored product, not re-matched"); } else passed++;
  const lab = read("apps/app/app/api/lab/route.js");
  if ((lab.match(/linkCatalog\(sb, user\.id, \[listing\]/g) || []).length < 2) { failed++; console.error("✗ both a new listing and a join must link the copies to their product"); } else passed++;
  if (!/add column if not exists cardmarket_id/.test(read("supabase/migrations/045_card_identity.sql"))) { failed++; console.error("✗ migration 045 must add stack_cards.cardmarket_id"); } else passed++;
}

if (failed) { console.error(`\n${failed} of ${failed + passed} identity checks failed.`); process.exit(1); }
console.log(`✓ ${passed} identity checks pass.`);
