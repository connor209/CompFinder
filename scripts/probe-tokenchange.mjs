/**
 * Blast radius of dropNumberingPrefixTokens, measured across every card set in
 * the repo. Writes nothing, fetches nothing, needs no token.
 *
 *   node scripts/probe-tokenchange.mjs
 *
 * The comps-level question — does the price move — needs live comps and is what
 * audit-rulechange.mjs is for. This answers the question that comes first and
 * costs nothing: on how many cards does the rule CHANGE THE TOKENS AT ALL? A
 * rule that cannot alter a single token on the public page cannot alter a
 * single price there either, and that is worth knowing before spending an
 * audit on it.
 *
 * Both call sites are measured, because they are not the same call:
 *   the app     tokenises the whole simplified query, number and all, which is
 *               where "No. 178" arrives as a required token
 *   Last Comp   tokenises the card NAME only and appends the bare number
 *               itself (apps/public/lib/tokens.js), so a numbering prefix can
 *               only ever appear if a card is literally NAMED with one
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { buildCompTokens } from "../apps/public/lib/tokens.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const { DEFAULT_SETTINGS, extractNameTokens, simplifyTitle } = CompFinderPricing;
const OLD = { ...DEFAULT_SETTINGS, dropNumberingPrefixTokens: false };
const NEW = { ...DEFAULT_SETTINGS, dropNumberingPrefixTokens: true };

const SETS = ["bigset.json", "bigset-en.json", "bigset-en2.json", "wideset.json"]
  .map((f) => join(HERE, f)).filter(existsSync);

// The published set is what actually ships on Last Comp — the 455 cards that
// are server-rendered, sitemapped and warmed. If the rule is inert there it is
// inert where it matters most.
let published = [];
try {
  const src = readFileSync(join(HERE, "..", "apps", "public", "lib", "published-cards.js"), "utf8");
  const m = src.match(/\[[\s\S]*\]/);
  if (m) published = JSON.parse(m[0]);
} catch { /* shape differs — reported as unavailable below */ }

const same = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);

console.log("Does dropping the numbering prefix change any token?\n");
console.log("  set".padEnd(26) + "cards   Last Comp path   app path");
console.log("  " + "─".repeat(62));

const examples = { public: [], app: [] };
function measure(label, cards) {
  let pubChanged = 0, appChanged = 0;
  for (const c of cards) {
    const name = c.name || c.n;
    if (!name) continue;
    const number = c.number ?? c.num ?? "";

    // Last Comp: name only, bare number appended separately.
    const pOld = buildCompTokens({ name, number }, name, OLD);
    const pNew = buildCompTokens({ name, number }, name, NEW);
    if (!same(pOld, pNew)) { pubChanged++; if (examples.public.length < 8) examples.public.push({ label, name, number, pOld, pNew }); }

    // The app: the whole simplified title, which is where "No. 178" lives.
    const q = simplifyTitle(`${name} ${number}`.trim(), DEFAULT_SETTINGS.stripWords);
    const aOld = extractNameTokens(q, OLD);
    const aNew = extractNameTokens(q, NEW);
    if (!same(aOld, aNew)) { appChanged++; if (examples.app.length < 8) examples.app.push({ label, name, number, aOld, aNew }); }
  }
  console.log(`  ${label.padEnd(24)}${String(cards.length).padStart(5)}${String(pubChanged).padStart(17)}${String(appChanged).padStart(11)}`);
  return { cards: cards.length, pubChanged, appChanged };
}

let totals = { cards: 0, pubChanged: 0, appChanged: 0 };
for (const f of SETS) {
  const r = measure(f.split("/").pop(), JSON.parse(readFileSync(f, "utf8")));
  totals.cards += r.cards; totals.pubChanged += r.pubChanged; totals.appChanged += r.appChanged;
}
if (published.length) {
  const r = measure("published (shipped)", published);
  totals.cards += r.cards; totals.pubChanged += r.pubChanged; totals.appChanged += r.appChanged;
} else {
  console.log("  published (shipped)        —   could not parse the manifest, skipped");
}
console.log("  " + "─".repeat(62));
console.log(`  ${"TOTAL".padEnd(24)}${String(totals.cards).padStart(5)}${String(totals.pubChanged).padStart(17)}${String(totals.appChanged).padStart(11)}`);

// The Neo-era batch, which is the population the rule was written for. Nothing
// in this repo's card sets is Japanese Neo, so a zero above says the rule is
// inert on the cards Last Comp ships — not that it is inert.
console.log("\n  For contrast, the batch that prompted this (Japanese Neo-era, app path):");
for (const t of ["Xatu No. 178", "Snubbull No. 209", "Gligar No. 207", "Bayleef No. 153"]) {
  console.log(`    ${t.padEnd(20)} ${JSON.stringify(extractNameTokens(t, OLD))} → ${JSON.stringify(extractNameTokens(t, NEW))}`);
}

if (examples.public.length) {
  console.log("\n  Cards where Last Comp's tokens change:");
  for (const e of examples.public) console.log(`    ${e.name} ${e.number}: ${JSON.stringify(e.pOld)} → ${JSON.stringify(e.pNew)}`);
}
if (examples.app.length) {
  console.log("\n  Cards where the app's tokens change:");
  for (const e of examples.app) console.log(`    ${e.name} ${e.number}: ${JSON.stringify(e.aOld)} → ${JSON.stringify(e.aNew)}`);
}
console.log(
  `\n  ${totals.pubChanged === 0
    ? "Zero token changes on the Last Comp path across every card set here.\n" +
      "  The public page tokenises the card NAME and appends the number itself, so a\n" +
      "  numbering prefix can only reach the tokens if a card is named with one, and\n" +
      "  no Pokémon card is. The rule cannot move a price on the public page.\n" +
      "  audit-rulechange.mjs is still the gate — it measures the SET flag too, which\n" +
      "  is live on every one of the 455."
    : `${totals.pubChanged} card(s) change tokens on the Last Comp path — read them above before shipping.`}`
);
