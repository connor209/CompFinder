/**
 * Asking the same card more than one way.
 *
 *   node scripts/check-searchpasses.mjs      (or: npm run check)
 *
 * One query per card is one sample. Measured on a 50-card reverse-holo commons
 * run, SoldComps RETURNED a median of 11 listings per card — six under five —
 * while the filter kept 8 of them. The loss is upstream of the rules, and the
 * time lever is gone because SoldComps holds no data far enough back. So the
 * remaining lever is to ask differently and cross-reference the answers.
 *
 * Four things here would each be invisible if they broke:
 *
 * - **A sale counted twice.** The same listing returned by two passes must
 *   count once, or the median is weighted toward whatever the easy searches
 *   found — which is exactly the bias more passes are meant to remove.
 * - **Paying twice for one query.** A card with no set has nothing to drop, so
 *   the rungs collapse; a ladder that ran them anyway spends real requests on
 *   identical searches.
 * - **A widened query becoming a widened CARD.** Dropping "Reverse Holo" from
 *   the SEARCH is the point; reading the printing off that stripped text would
 *   pool the two printings, which is what three cards sold under market for.
 * - **Stopping when there is nothing to gain.** SoldComps returns one page,
 *   newest first — a card that came back FULL does not have more sales waiting
 *   behind a wider query, it has a different, wider page, which on a reverse
 *   holo means a page of plain copies.
 */
import { readFileSync } from "node:fs";
import CardUploaderCsv from "../apps/app/lib/carduploader.js";
import {
  PASSES, MAX_DEPTH, passesFor, stripPrinting, compKey, mergeComps,
  needsAnotherPass, agreementOf, agreementNote, ENOUGH_COMPS
} from "../apps/app/lib/searchpasses.js";

let failures = 0;
const fail = (msg) => { console.error(`  ${msg}`); failures++; };
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

const build = (item, options) => CardUploaderCsv.buildQueryFromItem(item, options);
const EMBOAR = {
  cardName: "Emboar", cardNumber: "33/236", set: "Cosmic Eclipse",
  title: "Emboar 33/236 Cosmic Eclipse Pokemon Reverse Holo NM", condition: "NM"
};

// --- 1. the ladder, narrowest first ---------------------------------------
{
  const ladder = passesFor(EMBOAR, {}, MAX_DEPTH, build);
  eq("every rung, in order", ladder.map((p) => p.key), ["exact", "noset", "noprinting", "bare"]);
  eq("the queries they actually send", ladder.map((p) => p.query), [
    "Emboar Reverse Holo 33/236 Cosmic Eclipse",
    "Emboar Reverse Holo 33/236",
    "Emboar 33/236 Cosmic Eclipse",
    "Emboar 33/236"
  ]);
  eq("depth 1 is what the app has always done", passesFor(EMBOAR, {}, 1, build).map((p) => p.query),
    ["Emboar Reverse Holo 33/236 Cosmic Eclipse"]);
  eq("a depth of 0 or nonsense still runs one pass", passesFor(EMBOAR, {}, 0, build).length, 1);
  eq("a depth past the ladder does not invent rungs", passesFor(EMBOAR, {}, 99, build).length, MAX_DEPTH);

  // Real requests. A rung that reproduces a query already sent must be dropped.
  const noSet = { ...EMBOAR, set: "", title: "Emboar 33/236 Pokemon NM" };
  eq("a card with nothing to drop collapses to one search, not four",
    passesFor(noSet, {}, MAX_DEPTH, build).map((p) => p.query), ["Emboar 33/236"]);

  // The printing leaves the QUERY and nothing else.
  eq("the printing comes out of the search text", stripPrinting("Emboar 33/236 Reverse Holo NM"), "Emboar 33/236 NM");
  for (const spelling of ["Rev Holo", "Reverse Foil", "reverse-holofoil", "REVERSE"]) {
    if (/rev/i.test(stripPrinting(`Emboar 33/236 ${spelling}`))) {
      fail(`stripPrinting left "${spelling}" in the query — the widest pass is not wider than the narrow one`);
    }
  }
  eq("a card that was never a reverse holo is untouched",
    stripPrinting("Emboar 33/236 Cosmic Eclipse NM"), "Emboar 33/236 Cosmic Eclipse NM");
}

// --- 2. the widened QUERY must never widen the CARD -----------------------
// Reading the printing off a stripped title pools the reverse holo with the
// plain copy — the fault three cards sold under market for. The ladder changes
// what is SEARCHED; the filter still reads the real title.
{
  const panel = readFileSync(new URL("../apps/app/app/panel/Panel.js", import.meta.url), "utf8");
  const start = panel.indexOf("if (passRuns && passRuns.length > 1)");
  if (start === -1) {
    fail("Panel.js no longer cross-references the passes");
  } else {
    const body = panel.slice(start, start + 1200);
    if (/settingsForText\(/.test(body)) {
      fail("the cross-reference builds settings of its own — every pass must be priced with the REAL card's settings, or a pass that dropped the printing prices a different card");
    }
    if (!/cardSettings/.test(body)) {
      fail("the per-pass prices are not built with cardSettings — that is what keeps a widened search from becoming a widened card");
    }
  }
  if (!/fromCache = passResults\.every\(/.test(panel)) {
    fail("a ladder counts as cached unless EVERY pass was — one paid request in a ladder is still a paid run, and the budget estimate must not read flatter than the bill");
  }
}

// --- 3. a sale counted once, however many searches found it ---------------
{
  const c = (id, price) => ({ _source: { itemId: id }, title: `t${id}`, totalPence: price });
  const merged = mergeComps([
    { key: "exact", comps: [c("1", 700), c("2", 720)] },
    { key: "noset", comps: [c("2", 720), c("3", 690)] },        // "2" again
    { key: "bare", comps: [c("3", 690), c("4", 710)] }          // "3" again
  ]);
  eq("four distinct sales out of six sightings", merged.comps.length, 4);
  eq("and each pass is credited only with what it ADDED", merged.addedBy, { exact: 2, noset: 1, bare: 1 });

  // Identity, in the order it is trustworthy.
  eq("the item id is the identity", compKey({ _source: { itemId: "abc" } }), "id:abc");
  eq("the URL when there is no id", compKey({ _source: { url: "https://x/1" } }), "id:https://x/1");
  const a = { title: "Emboar 33/236", totalPence: 700, _source: { endedAt: "2026-09-01" } };
  eq("and title+total+date when there is neither — the same sale still keys the same",
    compKey(a) === compKey({ ...a }), true);
  if (compKey(a) === compKey({ ...a, totalPence: 900 })) {
    fail("two different sales of the same card collapsed into one — the merge would lose a real comp");
  }
}

// --- 4. stop when another request cannot help -----------------------------
eq("a FULL page stops the ladder — there is no more of this card behind a wider query, only a wider page",
  needsAnotherPass({ hasNextPage: true, comps: new Array(40) }), false);
// The case above passes on the comp count alone, so it cannot tell whether the
// cap is being read at all. THIS one can: SoldComps saying there is more while
// returning few (most of a page filtered out as non-GBP) is the only shape
// where the two rules disagree, and the cap has to win — a wider query on a
// capped card returns a wider page, not an older one.
eq("...even when the page came back thin, which is the only case that tests the cap",
  needsAnotherPass({ hasNextPage: true, comps: new Array(4) }), false);
eq("a thin page keeps asking", needsAnotherPass({ hasNextPage: false, comps: new Array(3) }), true);
eq("so does nothing at all", needsAnotherPass(null), true);
eq(`plenty already found stops too (${ENOUGH_COMPS})`,
  needsAnotherPass({ hasNextPage: false, comps: new Array(ENOUGH_COMPS) }), false);
eq("one short of plenty does not", needsAnotherPass({ hasNextPage: false, comps: new Array(ENOUGH_COMPS - 1) }), true);

// --- 5. agreement is what makes a price STRONG rather than bigger ---------
{
  eq("one pass corroborates nothing", agreementOf([{ pence: 700 }]).corroborated, false);
  eq("two searches landing close agree", agreementOf([{ pence: 700 }, { pence: 760 }]).corroborated, true);
  eq("two landing far apart do not", agreementOf([{ pence: 300 }, { pence: 900 }]).corroborated, false);
  eq("a pass that found no price is not a vote", agreementOf([{ pence: 700 }, { pence: 0 }]).passes, 1);
  eq("...and cannot make a spread out of nothing", agreementOf([{ pence: 700 }, { pence: 0 }]).spreadPct, null);

  // Disagreement must READ as a warning. A corroborated price and a
  // contradicted one looking the same on the row is the whole failure here.
  const agree = agreementNote(agreementOf([{ pence: 700 }, { pence: 720 }]), { exact: 5, noset: 3 });
  const differ = agreementNote(agreementOf([{ pence: 300 }, { pence: 900 }]), { exact: 5, noset: 3 });
  if (!/agreed/.test(agree)) fail("a corroborated price does not say so");
  if (!/⚠/.test(differ)) fail("a contradicted price carries no warning mark");
  if (/⚠/.test(agree)) fail("a corroborated price is being warned about");
  if (!/3 from "noset"/.test(agree)) fail("the note does not say which search found the extra comps");
  eq("nothing to say about a single pass", agreementNote(agreementOf([{ pence: 700 }])), "");
}

// --- 6. the ladder is one definition -------------------------------------
{
  const panel = readFileSync(new URL("../apps/app/app/panel/Panel.js", import.meta.url), "utf8");
  if (!/passesFor\(/.test(panel)) fail("Panel.js builds its own ladder instead of using searchpasses.js");
  if (!/needsAnotherPass\(/.test(panel)) {
    fail("Panel.js runs every pass regardless — a card that came back full is paying for searches that can only make its sample worse");
  }
  const lib = readFileSync(new URL("../apps/app/lib/searchpasses.js", import.meta.url), "utf8");
  if (/buildQueryFromItem|parts\.push|\.join\(" "\)/.test(lib.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    fail("searchpasses.js is composing a query itself — every rung must go through the one builder, or a pass searches for something the app does not think it searches for");
  }
  eq("every rung is a change to the ITEM, not a query of its own",
    PASSES.every((p) => typeof p.item === "function"), true);
}

if (failures) {
  console.error(`\ncheck-searchpasses: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log("check-searchpasses: OK — four ways to ask, each sale counted once, a full page stops the ladder, and agreement is said out loud.");
