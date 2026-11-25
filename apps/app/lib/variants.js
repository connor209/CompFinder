/**
 * Printings that share a card's name and number and do not share its price.
 *
 * Riolu BW33 is a ~£3 promo; Riolu BW33 Cosmos Holo sold eleven times in the
 * UK for £18–£105. Same name, same number, and nothing in the engine could
 * tell them apart, because the collector number — the thing everything else
 * here is anchored on — is identical. So a base-card search pooled the Cosmos
 * sales in, and a Cosmos search, once Quick Search had cleaned "(Cosmos Holo)"
 * off the catalogue name, became a base-card search.
 *
 * The rule is symmetric, like the engine's reverse-holo rule: a BASE card
 * excludes every comp naming a variant, and a VARIANT card requires its own
 * term and excludes every other variant's.
 *
 * Reverse holo and stamped copies are already subject facts in packages/core
 * (subjectReverse, subjectStamp) and the engine handles both directions
 * itself. They are listed here so a card can SAY it is one — from a variant
 * column, a name in brackets, a dropdown — and the subject text handed to
 * settingsForText() carries the word core reads. `engine: true` marks those:
 * this file does not filter on them a second time, because two readings of
 * one fact would eventually disagree about a title.
 *
 * App-side, like matching.js. packages/core is untouched.
 */

/**
 * Each variant:
 *   key      the stable id, used in the API and the dropdown
 *   label    what a person reads
 *   subject  reads the CARD's own text (name, variant column, set). Narrow,
 *            because a false positive here empties the pool.
 *   comp     reads a comp TITLE. Tolerant, because a stray drop costs one
 *            comp and a seller spells things every way.
 *   query    words added to the SoldComps search for a card that IS this
 *   engine   core already reads it off the subject text (see above)
 *   reverseKind  the printing IS a reverse holo, so a sale calling it
 *            "reverse" is describing this card, not another printing
 *   soft     a sale need not SAY it (sellers mostly don't); a plain card
 *            still drops a sale that does
 *   says     the word written into the subject text so core reads it too
 */
export const VARIANTS = [
  {
    key: "reverse",
    label: "Reverse Holo",
    subject: /\brev(?:erse)?\b[\s.\-]*(?:holo(?:foil)?|foil)\b/i,
    comp: /\brev(?:erse)?\b[\s.\-]*(?:holo(?:foil)?|foil)\b|\breverse\b/i,
    query: "Reverse Holo",
    engine: true,
    says: "Reverse Holo"
  },
  {
    key: "cosmos",
    label: "Cosmos Holo",
    subject: /\bcosmos\b/i,
    comp: /\bcosmo(?:s)?\b/i,
    query: "Cosmos Holo"
  },
  {
    key: "crackedIce",
    label: "Cracked Ice",
    subject: /\bcracked[\s-]*ice\b/i,
    comp: /\bcracked[\s-]*ice\b|\bice[\s-]*foil\b/i,
    query: "Cracked Ice"
  },
  {
    key: "prizePack",
    label: "Prize Pack",
    subject: /\bprize[\s-]*pack\b|\bplay!?\s*pok[eé]mon\s*prize\b/i,
    comp: /\bprize[\s-]*pack\b|\bplay!?\s*pok[eé]mon\b|\bplay\s*stamp/i,
    query: "Prize Pack"
  },
  {
    key: "stamped",
    label: "Stamped (League / Staff / Prerelease)",
    subject: /\bstamp(?:ed)?\b(?!\s+(?:addressed|envelope|sae))|\bpre[\s-]?release\b|\bstaff\b|\bleague\b/i,
    comp: /\bstamp(?:ed)?\b(?!\s+(?:addressed|envelope|sae))|\bpre[\s-]?release\b|\bstaff\s+(?:stamp|promo|pre)|\bleague\b|\bchampionship\b/i,
    query: "Stamped",
    engine: true,
    says: "Stamped"
  },
  // World Championship Deck reprints (Cardmarket's set "World Championship
  // Decks", the player in brackets: "Uxie (Tsubasa Nakamura) 43/146"). Gold
  // border, a different back, not tournament legal — and the SAME number as
  // the card it reprints, so a plain search pools the Legends Awakened Uxie
  // and the 30th Celebration reprint with it and every sale clears the number
  // check (2026-11-25: 70 counted, none the card). A WCD card requires its
  // own words; a plain card drops a sale that says them.
  // The subject is narrow on purpose: "World Championships 2022" on a stamped
  // Worlds promo is the stamped variant, not a deck.
  {
    key: "worldChampionship",
    label: "World Championship Deck",
    subject: /\bworld\s*championships?\s*decks?\b|\bwcd\b/i,
    comp: /\bworld\s*champ(?:ion(?:ship)?s?)?\b|\bwcd\b|\bchampionships?\s*decks?\b|\bworlds?\s*(?:decks?|19\d\d|20[0-2]\d)\b/i,
    query: "World Championship",
    // A bracketed aside is the player whose deck it was, not a printing.
    asidesArePlayers: true
  },
  {
    key: "firstEdition",
    label: "1st Edition",
    subject: /\b1st[\s-]*ed(?:ition|\.)?\b|\bfirst[\s-]*edition\b/i,
    // Never bare "1st": "Free 1st Class Postage" is on half the UK titles.
    comp: /\b1st[\s-]*ed(?:ition|\.)?\b|\bfirst[\s-]*edition\b/i,
    query: "1st Edition"
  },
  {
    key: "shadowless",
    label: "Shadowless",
    subject: /\bshadowless\b/i,
    comp: /\bshadowless\b/i,
    query: "Shadowless"
  },
  {
    key: "gamestop",
    label: "GameStop exclusive",
    subject: /\bgame\s*stop\b/i,
    comp: /\bgame\s*stop\b/i,
    query: "GameStop"
  },
  {
    key: "ebGames",
    label: "EB Games exclusive",
    subject: /\beb\s*games\b/i,
    comp: /\beb\s*games\b/i,
    query: "EB Games"
  },
  {
    key: "holidayCalendar",
    label: "Holiday Calendar",
    subject: /\b(?:holiday|advent)\s*calendar\b/i,
    comp: /\b(?:holiday|advent)\s*calendar\b/i,
    query: "Holiday Calendar"
  },
  {
    key: "generalMills",
    label: "General Mills",
    subject: /\bgeneral\s*mills\b/i,
    comp: /\bgeneral\s*mills\b|\bcereal\b/i,
    query: "General Mills"
  },
  {
    key: "mcdonalds",
    label: "McDonald's",
    subject: /\bmc\s*donald'?s?\b/i,
    comp: /\bmc\s*donald'?s?\b|\bhappy\s*meal\b|\bmcd\b/i,
    query: "McDonalds"
  },
  // Pattern reverse holos (151, Prismatic Evolutions, MEGA Dream ex):
  // Cardmarket writes "(Master Ball Pattern)", "(Poke Ball Pattern)", sellers
  // write "Master Ball Holo", "Masterball Reverse", "Pokeball". A plain copy
  // goes for pennies beside a Master Ball one, so both directions matter: the
  // pattern card requires its pattern, a plain card drops every pattern sale.
  // "Master Ball" and "Poké Ball" are also TRAINER cards; variantExclusion's
  // cardName guard stands a variant down when it is the card's own name.
  {
    key: "masterBall",
    reverseKind: true,
    label: "Master Ball pattern",
    subject: /\bmaster[\s-]*ball[\s-]*(?:pattern|reverse|holo(?:foil)?|foil|mirror)\b/i,
    comp: /\bmaster[\s-]*ball\b|\bmasterball\b/i,
    query: "Master Ball"
  },
  {
    key: "pokeBall",
    reverseKind: true,
    label: "Poké Ball pattern",
    subject: /\bpok[eé][\s-]*ball[\s-]*(?:pattern|reverse|holo(?:foil)?|foil|mirror)\b/i,
    comp: /\bpok[eé][\s-]*ball\b|\bpokeball\b/i,
    query: "Poke Ball"
  },
  {
    key: "energyPattern",
    reverseKind: true,
    label: "Energy symbol pattern",
    subject: /\benergy[\s-]*symbol[\s-]*pattern\b/i,
    // Never bare "energy reverse": "Lightning Energy Reverse Holo" is an energy card.
    comp: /\benergy[\s-]*(?:symbol|pattern)\b/i,
    query: "Energy Pattern"
  },
  // Japanese "Mirror Holofoil" (Shiny Star V, Shiny Treasure ex, VSTAR
  // Universe): recognised, so it never becomes a required NAME word, but
  // SOFT — a sale is not required to say "mirror", because most don't. A plain
  // card still drops a sale that does.
  {
    key: "mirror",
    label: "Mirror holo",
    subject: /\bmirror[\s-]*(?:holo(?:foil)?|foil)?\b/i,
    comp: /\bmirror\b/i,
    query: "",
    soft: true
  },
  // A jumbo / oversized card shares the name and often the number, and is a
  // different object at a different price. Symmetric like the rest: a normal
  // card drops jumbo sales, a jumbo card requires them.
  {
    key: "jumbo",
    label: "Jumbo / oversized",
    subject: /\bjumbo\b|\boversi[sz]ed?\b/i,
    comp: /\bjumbo\b|\boversi[sz]ed?\b|\bxl\s+card\b/i,
    query: "Jumbo"
  },
  {
    key: "ditto",
    label: "Peelable Ditto",
    subject: /\bpeel(?:able)?\b[\s-]*ditto\b|\bditto\b[\s-]*(?:peel|sticker)/i,
    comp: /\bditto\b/i,
    query: "Ditto"
  }
];

const BY_KEY = Object.fromEntries(VARIANTS.map((v) => [v.key, v]));

/**
 * A match the seller has negated in front of it: "not 1st edition", "non
 * stamped", "unstamped", "no shadow­less". Read off the few characters before
 * each match rather than by composing a bigger pattern, because a pattern's
 * leading \b would refuse the joined spelling ("unstamped").
 */
function hasUnnegated(re, text) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of String(text || "").matchAll(g)) {
    const before = text.slice(Math.max(0, m.index - 6), m.index);
    if (!/(?:\bnot|\bnon|\bno|\bun)[\s-]*$/i.test(before)) return true;
  }
  return false;
}

/**
 * Words a variant column carries that mean "the ordinary printing" — Normal,
 * Holofoil, Holo, Regular — and so say nothing worth flagging.
 */
const BASE_WORDS = /^\s*(?:normal|regular|standard|holo(?:foil)?|holo\s*rare|rare\s*holo|non[\s-]*holo|unlimited|base|none|n\/a|-)?\s*$/i;

/**
 * What a card IS, from everything known about it.
 *
 * `variantKeys` (an explicit choice — the dropdown, an API field naming keys)
 * wins outright. Otherwise the variant column, the name's bracketed aside,
 * the title and the set are read. The set matters for the cards whose whole
 * set IS the variant: a "McDonald's Collection 2021" card is a McDonald's
 * card without anybody writing it in the name.
 *
 * Returns { keys, unrecognised }. `unrecognised` is variant-column or bracket
 * text this file could not place — what `variant_uncertain` reports, rather
 * than guessing which printing it means.
 */
export function detectVariants({ name = "", variant = "", set = "", title = "", variantKeys = null } = {}) {
  if (Array.isArray(variantKeys)) {
    const keys = variantKeys.filter((k) => BY_KEY[k]);
    return { keys, unrecognised: variantKeys.filter((k) => !BY_KEY[k] && k !== "base") };
  }
  const text = [name, variant, set, title].join(" ");
  const keys = VARIANTS.filter((v) => hasUnnegated(v.subject, text)).map((v) => v.key);

  // "Unown (E)" is a NAME, so a one- or two-character aside is let through.
  // A World Championship Deck card's aside names the player, which is no printing.
  const playersAside = keys.some((k) => BY_KEY[k].asidesArePlayers);
  const brackets = playersAside ? [] : [...String(name).matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
  const unrecognised = [variant, ...brackets]
    .map((s) => String(s || "").trim())
    .filter((s) => s && !BASE_WORDS.test(s) && !/^[A-Z0-9!?]{1,2}$/i.test(s))
    .filter((s) => !VARIANTS.some((v) => v.subject.test(s)));
  return { keys: [...new Set(keys)], unrecognised };
}

/** The name with every recognised variant phrase and emptied bracket removed. */
export function nameWithoutVariants(name) {
  let out = String(name || "");
  for (const v of VARIANTS) out = out.replace(new RegExp(v.subject.source, "gi"), " ");
  return out
    .replace(/\(\s*(?:holo(?:foil)?|foil)?\s*\)/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Text that makes core's subject readers (reverse, stamp) agree with this file. */
export function subjectTextFor(keys) {
  return keys.map((k) => BY_KEY[k]).filter((v) => v && v.says).map((v) => v.says).join(" ");
}

/** Query words for a card that is these variants. */
export function queryWordsFor(keys) {
  return keys.map((k) => BY_KEY[k]).filter(Boolean).map((v) => v.query).filter(Boolean).join(" ");
}

export function variantLabel(key) {
  return BY_KEY[key]?.label || key;
}

/** Which variants a comp title names, negations ("not 1st edition") aside. */
export function compVariants(title) {
  const t = String(title || "");
  if (!t) return [];
  return VARIANTS.filter((v) => hasUnnegated(v.comp, t)).map((v) => v.key);
}

/**
 * Why this comp is the wrong printing for a card that is `subjectKeys`, or
 * null. Engine-owned variants (reverse, stamped) are left to the engine.
 *
 * - The subject is a variant and the comp doesn't say so → `missingVariant`.
 * - The comp names a variant the subject isn't → `wrongVariant`.
 *
 * A variant word that is part of the card's own NAME is not evidence of
 * anything: every comp for Ditto says "Ditto", and excluding them would empty
 * the pool of the card being priced. `cardName` stands that variant down.
 */
export function variantExclusion(title, subjectKeys, cardName = "") {
  const named = compVariants(title);
  for (const k of subjectKeys) {
    if (BY_KEY[k]?.engine || BY_KEY[k]?.soft) continue;
    if (!named.includes(k)) return { reason: "missingVariant", variant: k };
  }
  for (const k of named) {
    const v = BY_KEY[k];
    if (v?.engine || subjectKeys.includes(k)) continue;
    if (cardName && v.comp.test(cardName)) continue;
    return { reason: "wrongVariant", variant: k };
  }
  return null;
}

/** Whether a card of these variants is a kind of reverse holo (a pattern). */
export function isReverseKind(keys) {
  return (keys || []).some((k) => BY_KEY[k]?.reverseKind);
}

/**
 * A comp title with its reverse-holo words taken out, for the ENGINE's eyes
 * only when the card is a pattern reverse: "Geodude Masterball Reverse Holo"
 * is this card, and core would otherwise drop it as the reverse printing of a
 * plain card. The pattern itself is still required by variantExclusion.
 */
export function withoutReverseWords(title) {
  return String(title || "").replace(/\brev(?:erse)?\b[\s.\-]*(?:holo(?:foil)?|foil)?\b/gi, " ").replace(/\s{2,}/g, " ").trim();
}

/** Whether a card's own text says it is a World Championship Deck reprint. */
export function isWorldChampionshipDeck(text) {
  return BY_KEY.worldChampionship.subject.test(String(text || ""));
}

/** A variant a sale need not say (mirror holo) — see prefilterComps for when it hardens. */
export function isSoftVariant(key) {
  return Boolean(BY_KEY[key]?.soft);
}
