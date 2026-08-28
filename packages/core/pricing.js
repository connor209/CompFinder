/**
 * Comp Finder — pricing & filtering logic.
 *
 * This file is intentionally framework-free and DOM-free so it can be
 * unit-tested on its own (see test.html) and reused if this ever moves
 * beyond a content script. All money is handled in pence internally to
 * avoid floating-point rounding bugs, and converted to £ only for display.
 */
const CompFinderPricing = (() => {

  // ---- Configurable defaults (overridable via the options page / storage) ----

  const DEFAULT_SETTINGS = {
    floorPence: 249,          // £2.49 floor
    ladderStepPence: 50,      // ladder rungs every 50p (…2.49, 2.99, 3.49, 3.99…)
    poolConditionsBelowPence: 1500, // pool NM/LP/MP together under £15 raw cluster
    lowConfidenceMax: 3,      // 0-3 comps => Low
    mediumConfidenceMax: 9,   // 4-9 comps => Medium, 10+ => High
    // THE CARD BEING PRICED, when it is itself a slab — null for a raw card,
    // which is every card unless a caller says otherwise. Set it with
    // subjectGradeFrom(title); see the block above classifyExclusion for what
    // it changes and why the exclusion has to invert rather than stand down.
    //
    // A per-card fact rather than a preference, and in settings anyway because
    // that is already where per-card policy enters the engine — settingsForText()
    // in the app and settingsForCard() on the public page both build one of
    // these per card, so neither had to grow a new argument to say this.
    subjectGrade: null,
    // How many same-grade comps a slab needs before its price is published.
    // Below this the answer is NO price, never a fall back to the raw copies:
    // the raw market for a card is not soft evidence about the slab, it is
    // evidence about a different object. Same number as the app's
    // MIN_SOLD_COMPS_TO_PRICE, for the same reason — two comps is not a price.
    gradedMinComps: 3,
    freePostage: true,        // add buyer's postage to seller's item price for a fair "total price" comp
    interItemDelayMs: 1500,   // pause between items in a batch — gentler pacing, and doubles as
                              // a diagnostic: if a "breaks after ~N items" issue disappears at a
                              // slower pace, that's evidence it was timing/load-related.
    maxConsecutiveFailures: 3, // stop a batch early after this many failures in a row, rather than
                              // burning through the rest of a 100-item batch on a persistent issue
    // eBay staff have confirmed Terapeak enforces a hard 250 queries/day cap, and that EVERY
    // search plus every filter/tab/date-range change counts as its own query. A batch of N items
    // can cost 2-3 queries each (search, tab switch to Active, switch back), so this tracks usage
    // and stops proactively rather than grinding into a wall mid-batch.
    dailyQueryLimit: 250,
    dailyQueryLimitBuffer: 15, // stop once within this many queries of the cap — tracking here is
                              // an estimate, not exact, so leave headroom rather than cut it fine
    serverErrorRetryAttempts: 2,   // "Our server failed to respond" is a known, widely-reported,
    serverErrorRetryDelayMs: 4000, // often-transient eBay-side issue (confirmed via eBay's own
                              // community forum) — worth a couple of retries with backoff before
                              // giving up, unlike a genuine daily-limit hit, which never recovers
                              // same-day so isn't worth retrying at all.
    // Postage-outlier detection (2026-08-11) — SUPERSEDED 2026-08-12 by
    // splitByNonUkLocation, which now does directly (real eBay location
    // data) what this could only ever proxy for (shipping cost as a stand-
    // in for "probably a foreign seller"). Left in as a secondary
    // safeguard rather than removed — e.g. for the rare case where
    // itemLocation data is genuinely missing rather than null-because-
    // domestic — but deliberately dialled back: with the real signal doing
    // the primary work, this now mostly sees an already-cleaned pool, where
    // a "postage outlier" is more likely a genuine UK seller paying for
    // tracked/signed postage on a valuable item than a foreign one. A wide
    // multiplier keeps it from double-flagging that legitimate variance.
    postageOutlierMultiplier: 8,     // flag a comp if its postage is > this many times the group's median postage...
    postageOutlierFloorPence: 600,   // ...AND exceeds this absolute floor (avoids flagging trivial differences when everything's cheap)
    postageOutlierMinComps: 6,       // only apply with enough comps to make a group median meaningful
    postageDwarfsItemMultiplier: 2,  // ...or flag it if postage exceeds this many times the group's median ITEM price AND the comp's own item price
    // Price-magnitude sanity check (2026-08-11) — deliberately wide (8x),
    // one-sided (only flags implausibly HIGH prices, never low ones — see
    // splitPriceOutliers comment for why symmetric trimming backfired on
    // real test data).
    priceOutlierMultiplier: 8,
    // Low side is a separate, wider width — see splitPriceOutliers. At 8x it
    // removes genuine played copies; at 12x, across 278 cards, it removed
    // nothing but contamination.
    priceOutlierLowDivisor: 12,
    priceOutlierLowMaxShare: 0.2,   // stand down if the cheap group is a cluster, not strays
    // Wide-spread confidence downgrade (2026-08-11) — real evidence: 17
    // genuine comps for the same card/number split cleanly into two tiers
    // (£2.25-£3.99 and £12.26-£24.95) with nothing in between at all. No
    // exclusion rule here safely resolves which tier is "correct" without
    // risking harm elsewhere — a symmetric trim tried and made it worse
    // (see splitPriceOutliers). Instead of pretending a median across that
    // kind of spread is trustworthy just because the comp count is high,
    // this downgrades confidence and flags it plainly so it reads as
    // "worth a manual look" rather than a confident number.
    wideSpreadQ3Q1Ratio: 3,
    // Recency weighting (2026-08-12) — a plain median treats a sale from
    // today and one from two months ago as equally valid, which drags a
    // risen/recovered price back down toward stale comps. Instead, weight
    // each sold comp by an exponential decay on its age: a comp loses half
    // its influence every `recencyHalfLifeDays`. Recent sales lead the
    // price; older ones still count, just less. Falls back to a plain
    // median when no comp carries a usable sold date.
    recencyHalfLifeDays: 30,
    // Set-mismatch exclusion (2026-08-12) — real evidence: a Kabutops
    // search with a confirmed CardUploader set ("Arceus") came back with
    // only 4 of 38 comps actually mentioning that set at all, prices
    // ranging up to £115 — overwhelmingly "same card number, different
    // card/set" contamination, not a pricing-tier or geography issue. When
    // a KNOWN, specific (non-generic) set is available and the match rate
    // is this low, the non-matching majority gets excluded rather than
    // just noted — but only when enough matching comps remain to still
    // make a reasonable call; with too few, this stays a soft warning
    // instead of acting on a tiny sample.
    setMismatchExcludeBelowRatio: 0.5,
    setMismatchMinKept: 4,
    // Catalog-signal exclusion (2026-08-12) — uses eBay's own epid
    // (catalog product ID) and categoryId fields, when SoldComps returns
    // them, as a more authoritative alternative to text-based matching.
    // Same conservative shape as the set-mismatch settings above: needs a
    // real majority, not just "more than half by one", and needs enough
    // comps left over afterwards to still make a reasonable call.
    catalogSignalMinComps: 6,        // need at least this many comps WITH a value before judging
    catalogSignalMajorityRatio: 0.6, // the leading value must hold at least this share to act on it
    catalogSignalMinKept: 4,         // ...and at least this many must remain after excluding the rest
    // SoldComps API (replaces Terapeak UI-scraping for the primary Sold-comp
    // fetch, as of v0.8 — the Active-listing fallback still uses the
    // Terapeak page directly, so the daily Terapeak limit above still
    // matters, just for a much smaller slice of traffic now).
    soldCompsApiKey: "",       // set via the Settings page, never hardcoded/shipped in any file
    soldCompsMonthlyQuota: 100, // match to your actual plan: Free 100, Starter 2000, Growth 10000, Scale 50000
    soldCompsQuotaBuffer: 10,   // stop once within this many requests of the monthly cap
    // Confirmed 2026-08-11 from SoldComps' own docs (enum: default/domestic/
    // worldwide) — "domestic" filters to genuinely UK-located sellers, the
    // real fix for cross-listed international sellers showing up in
    // "ebay.co.uk, GBP" results at inflated prices. Configurable in case it
    // proves too restrictive for a low-volume card (fewer comps overall).
    soldCompsItemLocation: "domestic",
    stripWords: [
      // condition words
      "nm", "near mint", "lp", "lightly played", "mp", "moderately played",
      "hp", "heavily played", "damaged", "mint", "m",
      // finish adjectives that don't change the underlying card/price meaningfully
      "holofoil", "non-holo", "non holo", "foil",
      // NOTE: plain "holo" is handled separately below (not in this list) so
      // it can be stripped EXCEPT when it's part of "Reverse Holo" — that's
      // a distinct printing of the same card with its own price point (real
      // example: "Tyrogue...Reverse Holo" sold for £7.97 vs £2.34-£2.51 for
      // the regular non-holo printing of the identical card/number), so
      // dropping "Reverse Holo" down to just "Reverse" would both lose the
      // meaningful part and wrongly pool two different-value variants.
      // rarity tiers — describe scarcity, not the card's actual name.
      // NOTE: no combined "holo rare"/"rare holo" phrase here — bare "holo"
      // and bare "rare" already cover that case individually, and a combined
      // phrase caused a real bug: it greedily matched "Holo Rare" inside
      // "Non Holo Rare...", leaving a stray dangling "Non" behind instead of
      // correctly stripping "Non Holo" as its own protected unit.
      "rare", "ultra rare", "secret rare", "common", "uncommon",
      // game/brand filler
      "pokemon", "pokémon", "tcg", "card", "trading card"
    ],
    excludeKeywords: {
      // NOTE: deliberately no bare "ace" here — it's too common a normal
      // English word ("Ace Attorney...", playing-card listings) and produced
      // false positives in testing. ACE-graded listings ("ACE 10", "ACE 1")
      // are still caught below by GRADED_NUMBER_PATTERN, which requires the
      // grading company name to be directly followed by a 1-2 digit grade.
      graded: ["psa", "cgc", "bgs", "sgc", "graded", "slab", "slabbed", "getgraded"],
      promoVariant: ["promo", "league", "championship", "worlds", "prerelease"],
      bundle: ["bundle", "playset", "lot of", "job lot", "joblot", "x2", "x3", "x4", "x5", "x6",
                "personal collection", "whole collection", "collection includes"],
      // "choose your" rather than "choose your card": a £1.09 "Choose Your
      // Pikachu" was sitting under a £15.54 Pikachu VMAX, and sellers put
      // whatever the search term was in that slot.
      pickYourOwn: ["choose your", "pick your own", "you choose", "select your", "pick a card", "you pick", "u pick", "make your selection"],
      // Things that are not the card. A £1000 Umbreon ex was being priced
      // with a "(Custom Proxy Replica)" at £9.19 and a "Novelty Keychain" at
      // £10.89 in the same comp set, dragging the floor by two orders of
      // magnitude — and because both titles name the card and its number
      // correctly, every other rule let them through.
      //
      // Measured against 1,351 real sold titles before adding: proxy 3,
      // replica 3, novelty 1, keychain 1, binder 1, jumbo 2, oversized 1, and
      // nothing at all for the rest. Deliberately omits "sticker", "badge" and
      // "custom" on their own — each is a plausible word in an honest listing,
      // and the cost of wrongly excluding a real sale is higher than the cost
      // of occasionally keeping a novelty.
      notACard: ["proxy", "replica", "orica", "counterfeit", "custom card", "novelty",
                 "keyring", "keychain", "jumbo", "oversized", "binder insert",
                 "coaster", "plush", "figurine", "display case"]
    }
  };

  // Grading companies are very often expressed as "PSA 9", "ACE 10", "CGC 8" with
  // no other keyword nearby (no literal word "graded" anywhere in the title) —
  // caught live on real search results, e.g. "...ACE 10 🔥" and "...ACE 1 Poor".
  // This regex catches that pattern on top of the plain keyword list above.
  //
  // ONE list, three uses: the exclusion pattern here, parseGrade for the graded
  // panel, and the display ordering in gradedBreakdown. They are derived from
  // this array because they had already drifted apart once.
  //
  // TAG, GRAAD, MGC and AGS were added after running the pattern over 11,063
  // real sold titles: TAG alone appeared 45 times and 44 of those were caught
  // by nothing at all — more than every fake-card term put together — and a
  // graded slab is almost always the top comp on its card. Measured hits not
  // already excluded: TAG 44, ACE-with-a-word-between 7, AGS 6, GetGraded 2,
  // GRAAD 2, MGC 2.
  //
  // Deliberately NOT included: "GG", which is Galarian Gallery card numbering
  // (GG12/GG70) and would exclude a whole subset on sight; and "gem mint",
  // which hits 335 titles but only 31 not already caught, and which sellers
  // use freely on raw cards.
  //
  // "grade"/"graded"/"grading" is allowed between the company and the number
  // for "ACE Grading 9", "Ace Grade 10" and "PSA Grade 9", all seen live.
  // "tag" needs the digit to follow it directly, which is what keeps TAG TEAM
  // cards ("Reshiram & Charizard GX ... TAG TEAM") out of it.
  // "pristine" is a grade rather than a company (CGC's top tier), but it is
  // written on its own often enough to matter: "PRISTINE 10 GOLD LABEL TOP
  // POP" and "Certified Pristine 10" name no company at all, and the first of
  // those was a £303 slab sitting in a five-comp set whose other four ran
  // £22-£26. All 13 titles carrying "pristine" followed by a digit are slabs;
  // requiring the digit is what keeps "pristine condition" out.
  const GRADERS = ["psa", "cgc", "bgs", "sgc", "ace", "tag", "graad", "mgc", "ags", "pristine"];
  const GRADER_ALT = GRADERS.join("|");
  // The words a slab's own label puts between the company and the number. PSA
  // prints "GEM MINT 10", "MINT 9" and "NM-MT 8" on the flip and sellers copy
  // it verbatim — "PSA GEM MINT 10" was read as NOT graded, which excluded the
  // best comps on a slab's own search as "rawCopy" and left the subject test
  // blind to a slab whose title was written the way PSA writes it. Our own
  // stripWords can also leave "PSA GEM 10" or "PSA -MT 8" behind, so the
  // middle tolerates up to three fragments, not one exact phrase.
  //
  // Only after a company whose name is never card text. "…TAG TEAM Mint 9/10"
  // is a raw TAG TEAM card and One Piece sells a raw "…Ace Mint 9/10", so
  // "tag" and "ace" keep requiring the digit directly — the same reasoning
  // that kept bare "ace" out of the keyword list. "pristine" IS the grade
  // word, with nothing to sit between. And a companyless "Gem Mint 10" stays
  // raw: sellers use it freely about ungraded cards (335 corpus hits, mostly
  // raw — see the excludeKeywords note), so it is the company's name that
  // makes it a slab, never the label wording alone.
  const GRADER_COMPANIES = GRADERS.filter((g) => g !== "tag" && g !== "ace" && g !== "pristine");
  const GRADER_COMPANY_ALT = GRADER_COMPANIES.join("|");
  const GRADE_LINK = `\\s*(?:grad(?:e|ed|ing)\\s*)?-?\\s*`;
  const LABEL_LINK = `\\s*(?:grad(?:e|ed|ing)\\s*)?(?:[\\s.\\-]*(?:gem|mint|mt|nm|near)\\b){1,3}[\\s.\\-]*`;
  const GRADED_NUMBER_PATTERN = new RegExp(
    `\\b(?:(?:${GRADER_ALT})${GRADE_LINK}|(?:${GRADER_COMPANY_ALT})${LABEL_LINK})\\d{1,2}\\b`, "i"
  );

  // The same pattern, for CUTTING the grade out of a string rather than
  // detecting one in it — a fourth use of the one GRADERS list. Two
  // differences, both because a leftover is worse than a miss when cutting:
  // it takes the half grade with it (the detector stops at "CGC 9" and is
  // right to, but cutting there strands a ".5" that then becomes a name
  // token), and it is global, since a title can carry the grade twice.
  const GRADED_PREFIX_PATTERN = new RegExp(
    `\\b(?:(?:${GRADER_ALT})${GRADE_LINK}|(?:${GRADER_COMPANY_ALT})${LABEL_LINK})(?:10|\\d(?:\\.5)?)\\b`, "ig"
  );

  // For parseGrade: the same two shapes, with the company and the grade
  // captured. Kept beside the patterns above because all of them must agree
  // about what counts as "a company followed by its grade" — a title the
  // detector calls graded but the parser cannot read becomes a slab of
  // unknown grade, which is a wide answer where a precise one was available.
  const PARSE_GRADE_PATTERNS = [
    new RegExp(`\\b(${GRADER_ALT})${GRADE_LINK}(10|\\d(?:\\.5)?)\\b`, "i"),
    new RegExp(`\\b(${GRADER_COMPANY_ALT})${LABEL_LINK}(10|\\d(?:\\.5)?)\\b`, "i")
  ];

  // Bundles written with a COUNT rather than a bundle word. The keyword list
  // has "lot of", "job lot" and "x2".."x6", but a leading count is at least as
  // common and matched none of them: "Pokémon TCG 10 Card Lot Mewtwo VSTAR
  // 086/078" was sitting in that card's comp set, as was a "3 Card Lot" of
  // Deoxys promos and a "2 Card Lot" Chesnaught V. Four hits in 11,534 real
  // titles, all genuine multi-card listings.
  const COUNTED_LOT_PATTERN = /\b\d{1,3}\s*cards?\s*(?:lot|bundle|set)\b/i;

  // Three or more capitalised names joined by "+", which is how an evolution
  // line gets sold as one item: "SHINY HOLO RARE Gible + Gabite + Garchomp SET
  // Pokemon SV40/SV94" was the top comp on Garchomp SV40 at four times its
  // median. Deliberately three and not two, and deliberately case-sensitive:
  // a bare "set" token appears in 301 of those titles and is far too common to
  // key off, while three plus-joined proper nouns appear once.
  const PLUS_JOINED_NAMES = /\b[A-Z][a-z]+\s*\+\s*[A-Z][a-z]+\s*\+\s*[A-Z][a-z]+/;

  // Things shaped like a card listing that are not the card. The keyword list
  // above covers the plain words; this covers the shapes a keyword cannot,
  // because wordBoundaryMatch falls back to a literal substring test for
  // anything containing a space and so cannot match "Custom-Art", "D-I-Y" or
  // "Fan made art work".
  //
  // Every term here was run over the same 11,063 titles first and is correct
  // on every hit: custom art 1, handmade 2, fan art 3, DIY/D-I-Y 3, inspired
  // art 2, gold metal / metal card 4. They are rare but they land at the very
  // bottom of the range — "D-I-Y Mega Charizard Y ex 294/217" at £7.96 against
  // a £300 median, "Fan made art work Charizard 136/135" at £21 against £591.
  //
  // Rejected by the same measurement: "read description", which looked like a
  // reliable tell on two £9.99 fakes and turned out to be ordinary seller
  // language on genuine full-price sales (a £1,063 Umbreon ex "Great
  // Centering! Read Descript"); and "gold plated", "24k", "fake", "sticker"
  // and "poster", which matched nothing at all.
  // Added 2026-08-23, after "Charizard ex 223/197 Obsidian Flames Extended
  // Binder Art Inserts" at £14.89 turned up as the cheapest live listing for a
  // card whose real floor is £72.54 — and, on the redesigned public page, as
  // the headline "buy it today for" figure.
  //
  // The keyword list already held "binder insert", which the literal
  // substring test cannot see inside "Binder Art Inserts", and "display case",
  // which cannot see "Display Stand". Both are shapes rather than phrases, so
  // they belong here.
  //
  // Measured before widening, over 11,534 sold titles and 400 live listings:
  // binder-with-insert 4 hits, all of them art inserts rather than cards;
  // art-insert 2, same; display box/case/stand/frame/folder 1, a stand.
  // Bare "binder" was REJECTED on the same evidence — it matches "Charizard EX
  // 4/100 Crystal Guardians (HP - Binder Worthy)", a real sale of a real card.
  // Bare "display" was rejected too: its only other hit is a "Gold Metal Fan
  // Art Display Card" that two existing patterns already catch. Booster-box
  // and ETB terms matched nothing at all and are not here.
  const NOT_A_CARD_PATTERN = /\bcustom[\s-]?art\b|\bhand[\s-]?made\b|\bfan[\s-]?(made|art)\b|\bd[\s.-]?i[\s.-]?y\b|\binspired\s+(art|by)\b|\b(gold|silver)[\s-]?metal\b|\bmetal\s+card\b|\bbinder\b[^|]*\binserts?\b|\binserts?\b[^|]*\bbinder\b|\bart\s+inserts?\b|\bdisplay\s+(box|case|stand|frame|folder)\b/i;

  /**
   * Detects multi-card lot listings that name several different Pokémon
   * rather than using generic bundle language ("bundle", "x3") — found on
   * real search results (2026-08-11): "Horsea 030, Seadra 031 and Kingdra
   * 032/182", "Horsea 030 Seadra 031 Kingdra 032/182 - Sv04...", "Horsea,
   * Seadra, Kingdra 030/182, 031/182, 032/182" — three different real
   * phrasings, none matching the existing bundle/"x3" keyword list. Two
   * complementary checks, since no single one covers all three real
   * examples: (1) two-or-more "Capitalised word + number" pairs in the
   * title (catches the first two phrasings), (2) two-or-more distinct
   * numerators sharing the same denominator as the number being searched
   * for (catches the third, where names and numbers are grouped
   * separately). Years (1990-2035) are excluded from check (1) so a normal
   * "...Base Set 1999..." title doesn't false-positive.
   *
   * Denominator match (2) was digit-only until a real miss on 2026-08-12:
   * "Flabebe + Floette RC17/RC32 RC18/RC32 Generations Common..." wasn't
   * caught because "RC17/RC32" has a letter prefix, which the old
   * digit-only regex couldn't parse at all (numbers like this are common —
   * Radiant Collection, promo sets, etc. all use letter-prefixed numbering).
   * Now allows an optional short letter prefix on both sides.
   */
  function looksLikeNamedMultiCardLot(title, cardNumber) {
    const t = title || "";

    // Check (3): two or more distinct "<Name> <N>/<M>" groups. Added after
    // "Nintendo Pokemon TCG EX Dragon Latias ex 93/97 & Latios ex 94/97 Holo
    // Lot" priced as a single Latios at £444 against a £143 median, having
    // survived all of: the bundle words (it says "Lot", not "lot of"), check
    // (1) below (the "ex" sits between the name and the number, so its
    // name/number pair never matches), and check (2) (which needs the
    // searched-for number to carry its denominator — the public page's
    // catalogue gives bare numbers like "94", so that check is dead there).
    //
    // Run over 11,063 real sold titles this matched 28 titles, of which three
    // were wrong, and each taught its own guard:
    //   "FRI 21/08 MEGA GENGAR EX 284/217"                    — a date
    //   "...210/189 Astral Radiance PSA 10. NEW CERT 03/2026" — a year
    //   "PIKACHU VMAX 044/185 ... VIVID VOLTAGE 44/185"       — one card, twice
    // So a group is ignored when its denominator is too small to be a set
    // total or reads as a year, and numerators are compared with leading zeros
    // stripped. What survives is all genuine: Latias ex 93/97 & Latios ex
    // 94/97, Flying Pikachu 110/108 & Surfing Pikachu 111/108, Articuno EX
    // 25/135 Zapdos 48/135 Moltres 14/135.
    const NUMBER_GROUP = /\b[A-Z][a-zA-Z']+\s+(?:ex|EX|Ex|gx|GX|Gx|v|V|vmax|VMAX|VMax|vstar|VSTAR|VStar)?\s*(\d{1,4})\s*\/\s*(\d{1,4})\b/g;
    const withDenominator = new Set();
    for (const m of t.matchAll(NUMBER_GROUP)) {
      const denom = parseInt(m[2], 10);
      if (denom < 20) continue;                             // "21/08" is a date
      if (denom >= 1900 && denom <= 2100) continue;         // "03/2026" is a year
      withDenominator.add(String(parseInt(m[1], 10)));      // "044" and "44" are one card
    }
    if (withDenominator.size >= 2) return true;

    // Check (1): "<Name> <number>" pairs with no denominator at all, which is
    // how the original three real examples were written ("Horsea 030, Seadra
    // 031 and Kingdra 032/182").
    //
    // Two things this must NOT do, both found by running it over the corpus.
    // It must skip a number that carries a denominator, because check (3) has
    // already judged that group properly — without the skip, "PIKACHU VMAX
    // 044/185 ... VIVID VOLTAGE 44/185" counts as two cards when it is one
    // card written twice, and "FRI 21/08 ... GENGAR EX 284/217" counts a date
    // as a card. And it must count distinct numbers rather than matches, or a
    // set whose name is a number — "Pokemon 151 Charizard ex 199/165" — pairs
    // its own set name with the card and reads as a lot.
    const bareNumbers = new Set();
    for (const m of t.matchAll(/\b[A-Z][a-zA-Z]+\s+(\d{2,4})\b(\s*\/)?/g)) {
      if (m[2]) continue;                                   // belongs to check (3)
      const n = parseInt(m[1], 10);
      if (m[1].length === 4 && n >= 1990 && n <= 2035) continue;   // a year
      bareNumbers.add(String(n));
    }
    if (bareNumbers.size >= 2) return true;

    const numMatch = /^\s*[A-Za-z]{0,3}\d{1,4}\s*\/\s*([A-Za-z]{0,3}\d{1,4})\s*$/.exec((cardNumber || "").trim());
    if (numMatch) {
      const denominator = numMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sameDenomRe = new RegExp(`\\b([A-Za-z]{0,3}\\d{1,4})\\s*/\\s*${denominator}\\b`, "gi");
      const numerators = new Set([...t.matchAll(sameDenomRe)].map((m) => m[1].toUpperCase()));
      if (numerators.size >= 2) return true;
    }
    return false;
  }

  /**
   * The actual fix for cross-listed international sellers — direct, not
   * inferred. `ebaySite=ebay.co.uk` only selects which eBay marketplace to
   * search, not where the seller/item actually is (confirmed the hard way
   * across several turns: the `itemLocation` request parameter turned out
   * not to work for the UK site, then `soldAfter` and other fixes still
   * left real cross-border contamination in place). The per-item
   * `itemLocation` RESPONSE field looked like a dead end too — SoldComps'
   * docs say it's "null on ebay.co.uk" in a way that reads as "doesn't work
   * for this site". Real evidence (2026-08-12, user-verified against actual
   * listings) says the opposite: eBay's own UI shows a location badge
   * specifically to flag CROSS-BORDER items, and shows nothing for genuine
   * UK-domestic ones. Null isn't missing data, it's the positive signal —
   * a populated itemLocation means the seller is somewhere other than the
   * UK, on the UK site.
   *
   * This supersedes the postage-outlier heuristic (see its own comment) as
   * the primary defence against exactly the contamination that motivated
   * it in the first place — postage was only ever a proxy for this,
   * because this real signal wasn't known to be usable yet.
   */
  function splitByNonUkLocation(included) {
    const kept = [];
    const flagged = [];
    for (const c of included) {
      if (c.itemLocation) flagged.push({ ...c, exclusionReason: "nonUkLocation" });
      else kept.push(c);
    }
    return { kept, flagged };
  }

  /**
   * The most structurally-grounded exclusion in this file — everything else
   * (postage-outlier, price-outlier, set-mismatch) infers "this comp might
   * be wrong" from title text or shipping cost, proxies for a signal we
   * didn't have direct access to. `epid` and `categoryId` are eBay's own
   * fields: epid is documented by SoldComps as "stable across sellers for
   * the same variant" — eBay's own catalog-level product-identity match —
   * and categoryId is which listing category eBay itself placed the item
   * in. Neither depends on how a seller happened to word their title.
   *
   * Real motivating case: a Kingdra search where titles saying "Paradox
   * Rift" clustered at £2.25-£3.99 and titles saying "Miscellaneous Cards &
   * Products" (the same generic placeholder CardUploader itself falls back
   * to) clustered at £12.26-£24.95 — a clean, roughly 8-vs-9 split with
   * nothing in between. That's the key design constraint here: a near-even
   * split gives plurality voting no confident basis to pick a side — unlike
   * splitSetMismatch, which trusts a CardUploader-confirmed set name even
   * when it's the minority, this only has vote-counting to go on, so it
   * can't safely auto-resolve a genuine near-tie the same way.
   *
   * So this does two different things depending on how lopsided the split
   * is:
   *  - Strong majority (default ≥60%, plus enough comps left over): auto-
   *    excludes the minority, same shape as splitSetMismatch.
   *  - A real split exists (2+ groups, enough coverage) but no confident
   *    majority: doesn't guess — instead reports each group's own median
   *    in the note, so a genuine near-tie (like the real Kingdra case) is
   *    surfaced as "here are the two actual products and their prices"
   *    instead of either a silent blended median or a forced, weakly-
   *    justified pick.
   *
   * Tries epid first (most authoritative), falls back to categoryId if
   * epid coverage is too sparse to judge (plausible for granular TCG
   * variants, where eBay's catalog may not have a clean per-printing
   * match).
   *
   * ⚠️ Built from reasoning about documented field semantics, not yet
   * validated against a real response showing this pattern — the real
   * test is what the next live run on Kingdra actually returns.
   */
  function splitByCatalogSignal(included, settings) {
    const empty = { kept: included, flagged: [], signalUsed: null, groupBreakdown: null };
    if (included.length < settings.catalogSignalMinComps) return empty;

    const analyze = (getField) => {
      const withValue = included.filter((c) => getField(c));
      if (withValue.length < settings.catalogSignalMinComps) return null; // too sparse to judge

      const groups = {};
      for (const c of withValue) {
        const v = getField(c);
        (groups[v] = groups[v] || []).push(c);
      }
      const groupEntries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
      if (groupEntries.length < 2) return null; // everyone agrees — nothing to split

      return { groupEntries, withValueCount: withValue.length };
    };

    const summarizeGroups = (groupEntries) =>
      groupEntries.map(([value, comps]) => {
        const totals = comps.map((c) => c.totalPence).sort((a, b) => a - b);
        return { value, count: comps.length, medianPence: median(totals) };
      });

    const tryField = (getField, reason, label) => {
      const analysis = analyze(getField);
      if (!analysis) return null;
      const { groupEntries, withValueCount } = analysis;
      const [modeValue, modeComps] = groupEntries[0];
      const majorityRatio = modeComps.length / withValueCount;

      if (majorityRatio >= settings.catalogSignalMajorityRatio) {
        // Confident majority — auto-exclude the rest, same shape as splitSetMismatch.
        const kept = included.filter((c) => !getField(c) || getField(c) === modeValue);
        const flagged = included.filter((c) => getField(c) && getField(c) !== modeValue);
        if (kept.length < settings.catalogSignalMinKept) return null; // wouldn't leave enough to price from
        return {
          kept,
          flagged: flagged.map((c) => ({ ...c, exclusionReason: reason })),
          signalUsed: label,
          modeCount: modeComps.length,
          totalWithValue: withValueCount,
          groupBreakdown: null,
          resolved: true
        };
      }

      // No confident majority, but a real split exists — report it rather
      // than guess. Only worth surfacing if at least two groups are big
      // enough to be a real cluster, not one outlier comp splintering off.
      const realGroups = groupEntries.filter(([, comps]) => comps.length >= 3);
      if (realGroups.length < 2) return null;
      return { kept: included, flagged: [], signalUsed: label, groupBreakdown: summarizeGroups(realGroups), resolved: false };
    };

    const epidResult = tryField((c) => c.epid, "catalogMismatch", "epid");
    if (epidResult) return epidResult;

    const categoryResult = tryField((c) => c.categoryId, "categoryMismatch", "categoryId");
    if (categoryResult) return categoryResult;

    return empty;
  }

  /**
   * When a KNOWN, specific (non-generic) set name is available (e.g. from
   * CardUploader's confirmed *C:Set field) and only a small minority of
   * comps actually mention it, prefer the confirmed-matching subset over
   * the larger unconfirmed majority — real evidence: a Kabutops search
   * with set "Arceus" returned only 4/38 comps mentioning Arceus at all,
   * with the other 34 spanning up to £115, almost certainly a different
   * card/set that happens to share the same number. Only acts when enough
   * matching comps remain to make a reasonable call (default: at least 4)
   * — with too few, this is left as a soft note instead (see content.js),
   * since acting on a tiny sample is its own risk.
   */
  function splitSetMismatch(included, set, settings) {
    if (!set || included.length === 0) return { kept: included, flagged: [], matchCount: null };
    const setRe = new RegExp(`\\b${set.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const matching = included.filter((c) => setRe.test(c.title));
    const nonMatching = included.filter((c) => !setRe.test(c.title));
    const matchRatio = matching.length / included.length;

    if (
      matching.length > 0 &&
      nonMatching.length > 0 &&
      matchRatio <= settings.setMismatchExcludeBelowRatio &&
      matching.length >= settings.setMismatchMinKept
    ) {
      return {
        kept: matching,
        flagged: nonMatching.map((c) => ({ ...c, exclusionReason: "setMismatch" })),
        matchCount: matching.length
      };
    }
    return { kept: included, flagged: [], matchCount: matching.length };
  }

  /**
   * Sanity-check for a comp priced wildly outside the rest of its own comp
   * set — real example: a "Swirl" pattern Kingdra sold for £143.18 against
   * an otherwise ~£1.50-£17 range for the same card/number, almost
   * certainly a genuinely different, much rarer parallel that isn't caught
   * by the graded/bundle/promo/variant checks above.
   *
   * The HIGH side is deliberately wide (8x). Tested both ways against a real
   * 25-comp data pull (2026-08-11): a symmetric version at that same 8x also
   * flagged unusually CHEAP comps whenever the group median was already
   * skewed high by other contamination — which excluded the genuinely correct
   * cheap comps instead of protecting them, making the final price worse.
   *
   * Re-tested on 2026-08-22 across 278 cards, and that result reproduces
   * exactly: at median/8 the rule removes a £10.80 "Latios Ex Dragon holo
   * 94/97 LP", a £25.68 Shining Magikarp and a £14.96 Charizard VMAX
   * Champions Path — all genuine low-condition sales, and the Latios alone
   * moved that card's median by 25%.
   *
   * At median/12 it removes 14 comps across 11 cards and every one of them is
   * contamination: two "D-I-Y" cards, two "Fan made art work", a "Custom
   * Handmade Fan Art", a "Custom-Art Gold Metal", two "Premium Gold Metal"
   * novelties, a "Choose Your Pikachu", and three of the "holo and textured
   * ... read descrip" template that no keyword can safely catch (£9.99 against
   * a £1,511 median, £8.99 against £633). All three genuine cheap cards
   * survive. Wide spans across the run: 21 -> 10.
   *
   * The low side therefore exists, but at a different width from the high
   * side and with a share guard. The August failure is a CLUSTER of cheap
   * comps being read as outliers; a handful of strays is a different shape,
   * so the rule stands down entirely once the low group stops looking like
   * strays. Across those 278 cards nothing came close to the guard — it costs
   * nothing here and is the thing that stops the old failure recurring.
   */
  function splitPriceOutliers(included, settings) {
    if (included.length < settings.postageOutlierMinComps) return { kept: included, flagged: [] };
    const totals = included.map((c) => c.totalPence).sort((a, b) => a - b);
    const med = median(totals);
    if (!med) return { kept: included, flagged: [] };
    // Low side stands down when the cheap comps are a cluster rather than a
    // few strays — that shape is a bimodal comp set (or a median skewed by
    // contamination further up), not a handful of fakes, and trimming it is
    // what went wrong last time.
    const lowFloor = med / settings.priceOutlierLowDivisor;
    const lowCount = included.filter((c) => c.totalPence < lowFloor).length;
    const trimLow = lowCount > 0 && lowCount <= included.length * settings.priceOutlierLowMaxShare;

    const kept = [];
    const flagged = [];
    for (const c of included) {
      if (c.totalPence > med * settings.priceOutlierMultiplier) {
        flagged.push({ ...c, exclusionReason: "priceOutlier" });
      } else if (trimLow && c.totalPence < lowFloor) {
        flagged.push({ ...c, exclusionReason: "priceOutlierLow" });
      } else {
        kept.push(c);
      }
    }
    return { kept, flagged };
  }

  function loadSettings() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage) {
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }
      chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => resolve(stored));
    });
  }

  // ---- Step 1: simplify a listing title down to "name + number" ----

  function simplifyTitle(rawTitle, stripWords = DEFAULT_SETTINGS.stripWords) {
    if (!rawTitle) return "";
    let title = rawTitle.trim();

    // Pull out the card number pattern first (e.g. "30/149", "SV049", "TG12/TG30")
    // so we never accidentally strip it as a stray word.
    const numberMatch = title.match(/\b([A-Z]{0,3}\d{1,4}\s*\/\s*[A-Z]{0,3}\d{1,4})\b/i);
    const numberToken = numberMatch ? numberMatch[1].replace(/\s+/g, "") : "";

    // Remove the number from the working string and punctuation first, then
    // strip the configured phrase/word list (this removes "non holo" etc as
    // whole phrases, which must happen BEFORE the bare-"Holo" cleanup below
    // so "Non Holo" doesn't get broken apart into a stray leftover "Non").
    let working = title.replace(numberMatch ? numberMatch[0] : "", " ");
    working = working.replace(/[()\[\]#]/g, " ");

    const sortedStops = [...stripWords].sort((a, b) => b.length - a.length); // longest phrases first
    for (const stop of sortedStops) {
      const escaped = stop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "gi");
      working = working.replace(re, " ");
    }

    // Now strip any remaining bare "Holo" EXCEPT when it's part of "Reverse
    // Holo" — a distinct, separately-priced printing of the same card that
    // must survive into the search query (real example: "Tyrogue...Reverse
    // Holo" sold for £7.97 vs £2.34-£2.51 for the regular printing of the
    // identical card/number — pooling them would badly skew the price).
    working = working.replace(/(?<!reverse\s)\bholo\b/gi, " ");

    // Deduplicate repeated words (case-insensitive) — a card whose actual
    // name contains a word that also appears as a separate descriptor (e.g.
    // "Moltres EX" + "EX Rare" before "Rare" is stripped above) would
    // otherwise leave a redundant "EX EX" in the query, which was confirmed
    // live to change what eBay's search actually matches, not just add
    // harmless noise.
    const seen = new Set();
    const dedupedWords = working
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => {
        if (!w) return false;
        const key = w.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const name = dedupedWords.join(" ").trim();
    return numberToken ? `${name} ${numberToken}`.trim() : name;
  }

  // ---- Safety net: does a returned comp's title actually match the name we
  // searched for? A search query can pull in unrelated cards (confirmed
  // live: a 6-word query still matched some listings that didn't contain
  // the actual card name at all) — this doesn't rely on eBay's search
  // quality alone to keep the wrong card out of the comp pool. ----

  function extractNameTokens(simplifiedQuery) {
    // The query is "<name words> <number>" — strip the trailing number
    // token, drop punctuation that isn't part of a meaningful word (card
    // names like "Kingdra (Cosmos Holo)" or "Unown (E)" would otherwise
    // leak literal "(" / ")" into a token and break the word-boundary
    // regex in nameTokensMatch), and keep words of reasonable length.
    //
    // THE GRADE IS NOT PART OF THE CARD'S NAME. nameTokensMatch requires
    // EVERY token, so a graded title left intact here makes "PSA" and "10"
    // things a comp has to say to count — which drops a CGC 10 of the same
    // card, and drops a "PSA10" written without the space, since \bPSA\b
    // does not match inside it. Both are the card. The grade is carried
    // structurally now, on settings.subjectGrade, which is a better place for
    // it than a word a seller may or may not have spaced.
    //
    // buildCardQuery already filtered these out of its own token list; this
    // is the same rule reaching the callers that build tokens from a
    // simplified title instead — the app's batch run above all, where every
    // stock title is an eBay listing title with the grade written into it.
    // No effect on a raw card: the pattern does not match one.
    return simplifiedQuery
      .replace(GRADED_PREFIX_PATTERN, " ")
      .replace(/\b(?:graded|slab|slabbed)\b/gi, " ")
      // A grader named without a number ("PSA Graded Charizard", a trailing
      // "…PSA"), and the label words the cut above can strand ("PSA 10 GEM
      // MINT" loses only "PSA 10"). None of these is ever the card's name, so
      // dropping them only loosens what a comp must contain — leaving them
      // makes "PSA" a required word, which drops a CGC slab of the same card
      // as nameMismatch one rule before the pooling decision can be reached.
      // "ace", "tag" and "pristine" deliberately stay: ACE SPEC and TAG TEAM
      // are card text and "pristine" is seller talk on raw cards — all three
      // pinned in check-exclusions. Mt. Coronet and Gem-Knight each lose one
      // generic token to this and keep the ones that identify them.
      .replace(new RegExp(`\\b(?:${GRADER_COMPANY_ALT}|gem|mint|mt|nm|near)\\b`, "gi"), " ")
      .replace(/\b[A-Z]{0,3}\d{1,4}\s*\/\s*[A-Z]{0,3}\d{1,4}\b/i, "")
      .replace(/[()[\]#]/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);
  }

  /**
   * A COLLECTOR NUMBER is written both padded and unpadded, and the catalogue
   * and the seller rarely agree. Measured across 4,778 sold titles from 120
   * cheap cards: 212 comps on 12 of those cards match the card's name and fail
   * only because the catalogue says "2" and the listing says "002/073" or
   * "02/73". \b2\b cannot match inside "002", so every one of them was thrown
   * out as a name mismatch.
   *
   * So a purely numeric token tolerates leading zeros on either side. It
   * cannot over-match: \b0*2\b finds "2", "02" and "002", and rejects "12"
   * (no boundary before the 2) and "20" (no boundary after it).
   *
   * This also generalises the reason bareNumber keeps its leading zeros — it
   * was added because \b90\b cannot match inside "090/084", which is the same
   * problem in the other direction. Both now work whichever way round they are
   * written.
   */
  function nameTokensMatch(title, nameTokens) {
    if (!nameTokens || nameTokens.length === 0) return true;
    const t = title || "";
    return nameTokens.every((tok) => {
      if (/^\d{1,4}$/.test(tok)) {
        const stripped = tok.replace(/^0+(?=\d)/, "");
        return new RegExp(`\\b0*${stripped}\\b`, "i").test(t);
      }
      const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(t);
    });
  }

  // ---- Step 4: exclusion rules ----

  function wordBoundaryMatch(text, phrase) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b works fine for single words; for multi-word phrases a plain substring
    // check is fine since spaces already act as natural boundaries.
    const re = phrase.includes(" ") ? new RegExp(escaped, "i") : new RegExp(`\\b${escaped}\\b`, "i");
    return re.test(text);
  }

  /**
   * Why one comp is not evidence about this card — or null when it is.
   *
   * `subjectGrade` is the card WE are pricing, from subjectGradeFrom(). For a
   * raw card it is null and nothing below changes: graded slabs are excluded,
   * as they have been since the beginning, because a slab is a different
   * object at a different price and pooling the two moves a raw median by
   * multiples.
   *
   * When the card we are pricing is ITSELF a slab, that same reasoning runs
   * the other way and the exclusion has to INVERT rather than stand down. A
   * raw copy is not weak evidence about a graded one, it is evidence about a
   * different object — so it goes, with its own reason.
   *
   * This is the fault that made it worth writing. A PSA 10 Umbreon VMAX
   * 215/203 was fetched with "PSA 10" in the query, so nearly every comp that
   * came back was the right card in the right slab — and every one of them was
   * dropped as "graded". What survived was a proxy, a sleeve and a raw copy,
   * and the card priced at the £2.49 floor while the graded panel on the same
   * screen showed the PSA 10 tier at £875, worked out from the very comps the
   * price had just thrown away. Nothing about that was visible on the row: it
   * read as an ordinary cheap card with a confident number on it.
   *
   * Grades are then kept apart, because they are as different from each other
   * as a slab is from a raw card — a PSA 10 routinely goes for several times
   * the same card in a PSA 8, and pooling every grade would swap one confident
   * wrong number for another. A comp whose grade we cannot read is kept: it is
   * a slab of unknown grade, which is a wide answer, not a wrong one.
   *
   * The company is deliberately NOT part of that test. PSA does command a
   * premium over CGC and BGS, but the gap between companies is nothing like
   * the gap between grades, and splitting on it as well empties most pools —
   * and an empty pool here means no price at all. Worth revisiting with a
   * corpus behind it; not worth guessing at.
   */
  function classifyExclusion(listingTitle, excludeKeywords = DEFAULT_SETTINGS.excludeKeywords, nameTokens = null, cardNumber = null, subjectGrade = null) {
    const t = listingTitle || "";
    const pricingASlab = !!(subjectGrade && subjectGrade.graded);
    if (!nameTokensMatch(t, nameTokens)) return "nameMismatch";
    // Reverse Holo is a distinct, separately-priced variant (see simplifyTitle
    // comments). nameTokens only checks required words ARE present, which
    // catches a search FOR reverse holo pulling in a non-reverse comp — but
    // not the reverse case: a plain search pulling in a reverse-holo comp.
    // Confirmed live: without this, a £7.97 Reverse Holo listing pooled
    // straight into a £2.34-£3.48 regular-printing comp set.
    const queryWantsReverseHolo = (nameTokens || []).some((tok) => /^reverse$/i.test(tok));
    if (!queryWantsReverseHolo && /\breverse\s*holo\b/i.test(t)) return "variantMismatch";
    if (pricingASlab) {
      if (!isGradedTitle(t)) return "rawCopy";
      const compGrade = parseGrade(t);
      if (subjectGrade.grade != null && compGrade && compGrade.grade !== subjectGrade.grade) return "otherGrade";
    } else if (GRADED_NUMBER_PATTERN.test(t)) {
      return "graded";
    }
    if (NOT_A_CARD_PATTERN.test(t)) return "notACard";
    if (COUNTED_LOT_PATTERN.test(t) || PLUS_JOINED_NAMES.test(t)) return "bundle";
    if (looksLikeNamedMultiCardLot(t, cardNumber)) return "multiCardLot";
    for (const [reason, words] of Object.entries(excludeKeywords)) {
      // The keyword list carries its own "psa"/"cgc"/"slab" group, which would
      // undo the inversion above one word later and leave a slab priced from
      // nothing at all. It is the same rule as the pattern, so it stands down
      // in the same case.
      if (reason === "graded" && pricingASlab) continue;
      if (words.some((w) => wordBoundaryMatch(t, w))) return reason;
    }
    return null; // not excluded
  }

  // ---- Money helpers (pence-based to avoid float errors) ----

  const toPence = (pounds) => Math.round(Number(pounds) * 100);
  const toPoundsStr = (pence) => `£${(pence / 100).toFixed(2)}`;

  // ---- Step 5 (floor + charm-price rounding ladder) ----

  function applyFloorAndRounding(rawPence, settings = DEFAULT_SETTINGS) {
    const { floorPence, ladderStepPence } = settings;
    if (rawPence <= floorPence) return floorPence;
    const steps = Math.ceil((rawPence - floorPence) / ladderStepPence);
    return floorPence + steps * ladderStepPence;
  }

  // ---- Confidence tier ----

  function confidenceTier(comparableCount, settings = DEFAULT_SETTINGS) {
    if (comparableCount === 0) return "None";
    if (comparableCount <= settings.lowConfidenceMax) return "Low";
    if (comparableCount <= settings.mediumConfidenceMax) return "Medium";
    return "High";
  }

  // ---- Median (used as the cluster centre for the raw price) ----

  function median(sortedNums) {
    const n = sortedNums.length;
    if (n === 0) return null;
    const mid = Math.floor(n / 2);
    return n % 2 === 0 ? (sortedNums[mid - 1] + sortedNums[mid]) / 2 : sortedNums[mid];
  }

  /**
   * Recency-weighted centre price. Each comp's weight halves every
   * settings.recencyHalfLifeDays of age (measured from its sold date), so
   * the most recent sales dominate while older ones still nudge the figure.
   * Returns { pence, weighted } — `weighted` is false when no comp carried a
   * usable sold date, in which case this falls back to the plain median so
   * behaviour is unchanged for date-less data (e.g. active listings).
   */
  function recencyWeightedPrice(comps, settings = DEFAULT_SETTINGS) {
    const now = Date.now();
    const halfLife = settings.recencyHalfLifeDays || 30;
    let weightSum = 0;
    let weightedTotal = 0;
    let anyDated = false;
    for (const c of comps) {
      const dateStr = c._source && c._source.endedAt;
      let weight = 1;
      if (dateStr) {
        const ended = Date.parse(dateStr);
        if (!Number.isNaN(ended)) {
          anyDated = true;
          const ageDays = Math.max(0, (now - ended) / 86400000);
          weight = Math.pow(0.5, ageDays / halfLife);
        }
      }
      weightSum += weight;
      weightedTotal += weight * c.totalPence;
    }
    if (!anyDated || weightSum === 0) {
      const sorted = comps.map((c) => c.totalPence).sort((a, b) => a - b);
      return { pence: median(sorted), weighted: false };
    }
    return { pence: weightedTotal / weightSum, weighted: true };
  }

  /**
   * Second-pass filter, applied after the normal exclusion rules: flags
   * comps whose postage is a large outlier relative to the rest of the set
   * as a proxy for "probably not a genuine domestic sale" — international
   * shipping costs meaningfully more than UK-domestic post, and a
   * currency/marketplace filter alone doesn't catch a cross-listed seller
   * whose listing is still GBP-denominated on the UK site. Only applies
   * with enough comps to make a group median meaningful, and requires
   * BOTH a large relative multiple AND a real absolute floor, so it
   * doesn't fire on trivial differences within an already-cheap set.
   */
  function splitPostageOutliers(included, settings) {
    if (included.length < settings.postageOutlierMinComps) {
      return { kept: included, flagged: [] };
    }
    const postages = included.map((c) => c.postagePence || 0).sort((a, b) => a - b);
    const medPostage = median(postages);
    const threshold = Math.max(medPostage * settings.postageOutlierMultiplier, settings.postageOutlierFloorPence);

    // Second test, against the CARD rather than against the other postages.
    // The multiplier above compares each comp's postage to the group median
    // postage, which silently stops working when high postage is the norm for
    // the card: Hydreigon ex 161/086 came back with a median postage of £9.85,
    // so the threshold was £78 and nothing was flagged — and the card priced
    // £0.74 to £22.96, a 31x span in which every expensive comp was the same
    // £2 card with £10-£21 of postage bolted on.
    //
    // A £2 card posted for £20 is not a £22 comp in the UK market, and on a
    // £1,100 Umbreon the same £20 is noise. So the second threshold scales
    // with the median ITEM price, and only fires when the postage also exceeds
    // the item's own price — which is what stops it touching an expensive card.
    const items = included.map((c) => c.itemPricePence || 0).sort((a, b) => a - b);
    const medItem = median(items);
    const dwarfThreshold = Math.max(medItem * settings.postageDwarfsItemMultiplier, settings.postageOutlierFloorPence);

    const kept = [];
    const flagged = [];
    for (const c of included) {
      const post = c.postagePence || 0;
      const dwarfs = post > dwarfThreshold && post > (c.itemPricePence || 0);
      if (post > threshold || dwarfs) flagged.push({ ...c, exclusionReason: "highPostage" });
      else kept.push(c);
    }
    // Never let this empty the comp set. Where high postage is genuinely how
    // the whole market for a card behaves, excluding all of it leaves nothing
    // to price from, which is worse than a wide span.
    if (kept.length < settings.postageOutlierMinComps / 2) return { kept: included, flagged: [] };
    return { kept, flagged };
  }

  /**
   * Full pipeline: raw scraped comps in -> recommendation out.
   * `comps` is an array of { title, itemPricePence, postagePence, condition }.
   * `dataSource` is "sold" (default) or "active" — active-listing prices are
   * asking prices, not confirmed sales, so confidence is capped and the note
   * carries an explicit caveat rather than reading as equally trustworthy.
   * `cardNumber` (e.g. "032/182") enables the multi-card-lot check in
   * classifyExclusion — optional, that check just doesn't run without it.
   */
  function recommend(comps, settings = DEFAULT_SETTINGS, nameTokens = null, dataSource = "sold", cardNumber = null, set = null) {
    let included = [];
    const excluded = [];

    for (const comp of comps) {
      const reason = classifyExclusion(comp.title, settings.excludeKeywords, nameTokens, cardNumber, settings.subjectGrade);
      if (reason) {
        excluded.push({ ...comp, exclusionReason: reason });
      } else {
        const totalPence = comp.itemPricePence + (settings.freePostage ? (comp.postagePence || 0) : 0);
        included.push({ ...comp, totalPence });
      }
    }

    // Non-UK location runs first of all — the most direct, ground-truth
    // signal available (see splitByNonUkLocation), ahead of even the
    // set-mismatch/catalog checks, since it answers a more fundamental
    // question ("is this even a UK sale") than either of those.
    const locationSplit = splitByNonUkLocation(included);
    const locationExcludedCount = locationSplit.flagged.length;
    included = locationSplit.kept;
    excluded.push(...locationSplit.flagged);

    // Set-mismatch runs FIRST when a confirmed, specific set is available —
    // that's curated ground truth (from CardUploader), a stronger signal
    // than an automated catalog match for a variant-dense category like TCG
    // singles. Confirmed necessary by a real regression: running catalog
    // signal first let its own independent epid/categoryId majority vote
    // exclude the CardUploader-confirmed-correct comps before set-mismatch
    // got a chance to protect them (a live Kabutops run went from a
    // validated "10 comps used, Set confirmed 10/10" result down to "17
    // comps used, Set confirmed 0/17" once catalog signal ran first — the
    // correct subset was already gone by the time set-mismatch checked).
    // When there's no confirmed set to defer to (e.g. Kingdra, where
    // CardUploader's own set field was the generic placeholder), this is a
    // no-op and catalog signal is effectively first regardless.
    const setSplit = splitSetMismatch(included, set, settings);
    const setMismatchExcluded = setSplit.flagged.length > 0;
    included = setSplit.kept;
    excluded.push(...setSplit.flagged);

    // Catalog signal (epid/categoryId) next — still runs ahead of the more
    // general price/postage checks below, since it's a more structurally-
    // grounded signal than either of those, just not as trustworthy as a
    // human/tool-confirmed set name when one is actually available.
    const catalogSplit = splitByCatalogSignal(included, settings);
    const catalogExcluded = catalogSplit.flagged.length > 0;
    included = catalogSplit.kept;
    excluded.push(...catalogSplit.flagged);

    // Price-magnitude sanity check first (so one wild anomaly, e.g. a rare
    // parallel that isn't caught above, doesn't skew the group median that
    // the postage-outlier check compares against), then postage.
    const priceSplit = splitPriceOutliers(included, settings);
    included = priceSplit.kept;
    excluded.push(...priceSplit.flagged);

    const { kept, flagged } = splitPostageOutliers(included, settings);
    included = kept;
    excluded.push(...flagged);

    // A slab priced from a handful of slabs is a wide answer; a slab priced
    // from the raw copies underneath it is a wrong one, and classifyExclusion
    // is what stops the second. This is what stops the first quietly taking
    // its place: below gradedMinComps there is no fall back to the raw market,
    // because there is no sense in which evidence about a different object
    // adds up to an answer about this one. The tiers still ride along on
    // `graded`, so the screen can show what WAS found and let a human judge it
    // — which is the whole difference between a thin answer and a silent one.
    //
    // Ahead of the empty-pool return below, so a slab with nothing to price
    // from says WHY rather than giving the generic line: on a graded card
    // "no comps found" is the most misleading way to put it, since the comps
    // were found and then deliberately not used.
    const pricingASlab = !!(settings.subjectGrade && settings.subjectGrade.graded);
    if (pricingASlab && included.length < settings.gradedMinComps) {
      const tierName = settings.subjectGrade.grade != null ? `grade ${settings.subjectGrade.grade}` : "this grade";
      return {
        rawPence: null,
        finalPence: null,
        confidence: included.length === 0 ? "None" : "Low",
        priceHeld: true,
        dataSource,
        note: `This is a graded card, and only ${included.length} ${dataSource === "active" ? "listed" : "sold"} slab(s) at ${tierName} were found — too few to price from. The raw copies were NOT used to make up the difference: a raw card and a slab are different objects at different prices, so a price built from the wrong one is worse than no price. Any graded sales that were found are below.`,
        included,
        excluded,
        graded: gradedBreakdown(comps, settings, nameTokens)
      };
    }

    if (included.length === 0) {
      return {
        rawPence: null,
        finalPence: null,
        confidence: "Low",
        dataSource,
        note:
          dataSource === "active"
            ? "No sold or active comps found after exclusions — no price forced."
            : "No sold comps found after exclusions — no price forced.",
        included,
        excluded,
        graded: gradedBreakdown(comps, settings, nameTokens)
      };
    }

    const totals = included.map((c) => c.totalPence).sort((a, b) => a - b);
    const priceBasis = recencyWeightedPrice(included, settings);
    const rawPence = Math.round(priceBasis.pence);
    const finalPence = applyFloorAndRounding(rawPence, settings);
    let confidence = confidenceTier(included.length, settings);
    // Asking prices are inherently softer than confirmed sales — never let
    // an active-only result read as "High" confidence.
    if (dataSource === "active" && confidence === "High") confidence = "Medium";

    // A high comp COUNT doesn't mean much if those comps don't agree with
    // each other — a wide, possibly-bimodal spread (see settings comment)
    // isn't safely resolved by more exclusion rules without risking harm
    // elsewhere, so surface it honestly instead of reading as confidently
    // "High" just because there were a lot of comps.
    let wideSpread = false;
    if (totals.length >= 2) {
      const q1 = totals[Math.floor(totals.length * 0.25)];
      const q3 = totals[Math.floor(totals.length * 0.75)];
      if (q1 > 0 && q3 / q1 >= settings.wideSpreadQ3Q1Ratio) wideSpread = true;
    }
    if (wideSpread && confidence === "High") confidence = "Medium";
    // An unresolved catalog split (see splitByCatalogSignal) is at least as
    // serious a signal as a wide price spread — it's confirmed, structured
    // evidence of multiple products, not just a suspicious price gap — so
    // cap confidence at Low rather than let a big comp count read as
    // trustworthy when the comps demonstrably don't agree on what product
    // this even is.
    if (catalogSplit.groupBreakdown && confidence !== "Low") confidence = "Low";

    const roundedNote = finalPence !== rawPence
      ? ` (raw comps ~${toPoundsStr(rawPence)}, rounded to ${toPoundsStr(finalPence)})`
      : "";
    const spreadNote = wideSpread
      ? ` ⚠ Comps used span a wide price range (${toPoundsStr(totals[0])}-${toPoundsStr(totals[totals.length - 1])}) — may include more than one distinct product tier, worth a manual check rather than trusting the median alone.`
      : "";
    // A graded price has to say so on the row. It is a different market from
    // the raw card of the same name, the figure will look wrong beside every
    // other row in a run, and "priced from slabs" is the one sentence that
    // makes it read as an answer rather than an error.
    const gradedSubjectNote = pricingASlab
      ? ` (Graded card: priced from ${included.length} ${dataSource === "active" ? "listed" : "sold"} ${settings.subjectGrade.grade != null ? `grade ${settings.subjectGrade.grade}` : "graded"} slab(s). Raw copies were excluded — a slab is a different object at a different price. Grading companies are pooled; grades are not.)`
      : "";
    const locationNote = locationExcludedCount > 0
      ? ` (Note: ${locationExcludedCount} comp(s) excluded as non-UK sellers, per eBay's own item-location data — priced from UK-domestic sales only.)`
      : "";
    const catalogNote = catalogExcluded
      ? ` (Note: ${catalogSplit.flagged.length} comp(s) excluded as a likely different product — eBay's own ${catalogSplit.signalUsed === "epid" ? "catalog match" : "listing category"} disagreed with the majority (${catalogSplit.modeCount}/${catalogSplit.totalWithValue} comps agreed) — priced from the matching comps.)`
      : catalogSplit.groupBreakdown
        ? ` ⚠ eBay's own ${catalogSplit.signalUsed === "epid" ? "catalog match" : "listing category"} splits these comps into ${catalogSplit.groupBreakdown.length} distinct products with no clear majority — this price blends them, which may not represent either one accurately: ${catalogSplit.groupBreakdown.map((g) => `${g.count} comp(s) @ ${toPoundsStr(g.medianPence)}`).join(", ")}. Worth checking which product this listing actually is before trusting the blended figure.`
        : "";
    const setNote = (() => {
      if (!set || included.length === 0) return "";
      const setRe = new RegExp(`\\b${set.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const finalMatchCount = included.filter((c) => setRe.test(c.title)).length;
      if (setMismatchExcluded) {
        return ` (Note: ${setSplit.flagged.length} comp(s) not mentioning set "${set}" were excluded as likely a different card sharing the same number — priced from the remaining ${finalMatchCount}.)`;
      }
      if (finalMatchCount < included.length) {
        return ` ⚠ Set "${set}" confirmed in only ${finalMatchCount}/${included.length} comps used — some may be a different print, worth a quick check.`;
      }
      return "";
    })();
    const note =
      (dataSource === "active"
        ? `No sold comps — based on ${included.length} ACTIVE (asking) price(s), median ${toPoundsStr(rawPence)}${roundedNote}. Actual sold price is typically lower than asking — treat as a starting estimate.`
        : priceBasis.weighted
          ? `Recency-weighted price from ${included.length} sale(s): ${toPoundsStr(rawPence)}${roundedNote} (recent sales weighted more heavily).`
          : `Median of ${included.length} comparable sale(s): ${toPoundsStr(rawPence)}${roundedNote}.`) + gradedSubjectNote + locationNote + catalogNote + setNote + spreadNote;

    const graded = gradedBreakdown(comps, settings, nameTokens);

    return { rawPence, finalPence, confidence, dataSource, note, included, excluded, graded };
  }

  function isGradedTitle(title) {
    const t = title || "";
    return GRADED_NUMBER_PATTERN.test(t) || /\b(graded|slab|slabbed)\b/i.test(t);
  }

  /**
   * Pull the grading company + numeric grade out of a listing title
   * ("PSA 10 Charizard" -> { company: "PSA", grade: 10 }). Handles the common
   * spacings ("PSA10", "PSA-10", "CGC 9.5", "BGS 9.5"). Returns null when the
   * title has no company+number grade (e.g. a bare "graded" with no number).
   */
  function parseGrade(title) {
    const t = title || "";
    let m = null;
    for (const p of PARSE_GRADE_PATTERNS) {
      m = t.match(p);
      if (m) break;
    }
    if (!m) return null;
    const company = m[1].toUpperCase();
    const grade = parseFloat(m[2]);
    if (Number.isNaN(grade) || grade < 1 || grade > 10) return null;
    return { company, grade };
  }

  const NOT_GRADED_PATTERN = /\b(?:un|non[\s-]?|not\s+)graded\b|\braw\b/i;

  /**
   * The card WE are pricing, read off its own title, for settings.subjectGrade.
   *
   * Returns null for a raw card — which is the overwhelming majority, and the
   * reason every caller that does not ask this question keeps the behaviour it
   * has always had. `grade` is null for a title that says it is graded without
   * saying what to ("graded slab", "PSA graded"): that is still a slab and
   * still must not be priced against raw copies, we just cannot pick a tier
   * out of it, so every grade is kept rather than none.
   *
   * ONE definition, because both apps ask it about different text — the app
   * about an eBay listing title it holds in stock, the public page about what
   * a visitor typed — and two parsers would eventually disagree about whether
   * the same card was a slab.
   */
  function subjectGradeFrom(text) {
    const t = String(text || "");
    // A seller saying what the card ISN'T. On a comp this never mattered —
    // "ungraded" carries no word boundary before "graded" so it never matched
    // anyway, and a stray drop costs one comp out of forty. On the SUBJECT it
    // matters a great deal: reading "Charizard 4/102 — not graded, raw" as a
    // slab inverts the whole rule and throws away every comp that is the card.
    // The blast radius is the reason this guard exists and the comp side never
    // needed one.
    if (NOT_GRADED_PATTERN.test(t)) return null;
    if (!isGradedTitle(t)) return null;
    const g = parseGrade(t);
    return { graded: true, company: g ? g.company : null, grade: g ? g.grade : null };
  }

  /**
   * Graded-value breakdown for a card: group the GRADED sold comps by
   * company + grade (PSA 10, PSA 9, CGC 9.5 …) and price each tier from its
   * own sales. Runs off the same comp set recommend() already fetched — the
   * graded comps it otherwise discards — so no extra API calls. Requires a
   * name-token match so a different card's slab can't contaminate a tier, and
   * only returns tiers with at least `minPerTier` sales (default 1). Sorted
   * strongest grade first within each company (PSA before CGC before BGS).
   */
  function gradedBreakdown(comps, settings = DEFAULT_SETTINGS, nameTokens = null, minPerTier = 1) {
    const COMPANY_ORDER = Object.fromEntries(GRADERS.map((g, i) => [g.toUpperCase(), i]));
    const tiers = new Map(); // key -> { company, grade, prices: [] }
    for (const comp of comps) {
      const title = comp.title || "";
      if (!nameTokensMatch(title, nameTokens)) continue;
      // Skip obvious multi-card lots — a graded single is the point here.
      if (looksLikeNamedMultiCardLot(title, "")) continue;
      const g = parseGrade(title);
      if (!g) continue;
      const totalPence = comp.itemPricePence + (settings.freePostage ? (comp.postagePence || 0) : 0);
      if (!Number.isFinite(totalPence) || totalPence <= 0) continue;
      const key = `${g.company} ${g.grade}`;
      if (!tiers.has(key)) tiers.set(key, { key, company: g.company, grade: g.grade, prices: [] });
      tiers.get(key).prices.push(totalPence);
    }
    const out = [];
    for (const t of tiers.values()) {
      if (t.prices.length < minPerTier) continue;
      const sorted = t.prices.slice().sort((a, b) => a - b);
      out.push({
        key: t.key,
        company: t.company,
        grade: t.grade,
        label: `${t.company} ${t.grade}`,
        count: sorted.length,
        medianPence: Math.round(median(sorted)),
        loPence: sorted[0],
        hiPence: sorted[sorted.length - 1]
      });
    }
    out.sort((a, b) => {
      const co = (COMPANY_ORDER[a.company] ?? 9) - (COMPANY_ORDER[b.company] ?? 9);
      if (co !== 0) return co;
      return b.grade - a.grade; // strongest grade first
    });
    return out;
  }

  function isBundleTitle(title, cardNumber) {
    const raw = title || "";
    const t = raw.toLowerCase();
    if (DEFAULT_SETTINGS.excludeKeywords.bundle.some((w) => t.includes(w))) return true;
    // "21 Card Lot", "10 cards bundle"
    if (/\b\d{1,3}\s*(?:card|cards)\b/i.test(raw) && /\b(lot|bundle|joblot|job lot|collection)\b/i.test(raw)) return true;
    // Strip grading prefixes ("PSA 10") and any X/Y collector number BEFORE the
    // named-lot heuristic — otherwise "PSA 10 Gumshoo AR 075/063" reads as two
    // "name + number" pairs and a graded single gets mis-flagged as a lot.
    const cleaned = raw
      .replace(GRADED_NUMBER_PATTERN, " ")
      .replace(/\b[A-Z]{0,3}\d{1,4}\s*\/\s*[A-Z]{0,3}\d{1,4}\b/gi, " ");
    return looksLikeNamedMultiCardLot(cleaned, "");
  }

  /**
   * Turn a raw eBay listing title into a *tight, searchable* sold-comp query.
   *
   * The problem with feeding a whole title to SoldComps is that long, noisy
   * titles ("Squirtle 132/165 Expedition Base Set 2002 E-Reader NM") match few
   * or no sold listings, and the extra words then over-filter whatever does
   * come back. A card's identity is really its NAME + collector NUMBER, so we
   * anchor on those: the leading 1–2 name words plus the number, with the name
   * filter kept lenient (primary name only) so genuine comps aren't dropped.
   *
   * Returns { query, nameTokens, number, graded, lot } — the caller can skip
   * lots (unpriceable) and flag graded cards (priced against raw comps).
   */
  function buildCardQuery(rawTitle, stripWords = DEFAULT_SETTINGS.stripWords) {
    const title = (rawTitle || "").trim();
    const numberMatch = title.match(/\b([A-Z]{0,3}\d{1,4}\s*\/\s*[A-Z]{0,3}\d{1,4})\b/i);
    const number = numberMatch ? numberMatch[1].replace(/\s+/g, "") : "";
    const graded = isGradedTitle(title);
    const lot = isBundleTitle(title, number);

    const simplified = simplifyTitle(title, stripWords);
    const nameOnly = simplified.replace(/\b[A-Z]{0,3}\d{1,4}\s*\/\s*[A-Z]{0,3}\d{1,4}\b/i, "").trim();
    const nameWords = nameOnly
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 2 &&
          !/^\d+$/.test(w) && // stray numbers / years
          !/^(psa|cgc|bgs|sgc|ace|gem|graded|slab|nm|lp|mp|hp|vg|mint|japanese|korean|chinese|english|german|french|italian|spanish)$/i.test(w)
      );

    const queryWords = nameWords.slice(0, number ? 2 : 3);
    const nameTokens = nameWords.slice(0, number ? 1 : 2);
    const query = [queryWords.join(" "), number].filter(Boolean).join(" ").trim();

    return {
      query: query || simplified,
      nameTokens: nameTokens.length ? nameTokens : extractNameTokens(simplified),
      number,
      graded,
      lot
    };
  }

  return {
    DEFAULT_SETTINGS,
    loadSettings,
    simplifyTitle,
    buildCardQuery,
    isGradedTitle,
    parseGrade,
    subjectGradeFrom,
    gradedBreakdown,
    isBundleTitle,
    extractNameTokens,
    nameTokensMatch,
    classifyExclusion,
    applyFloorAndRounding,
    confidenceTier,
    recommend,
    toPence,
    toPoundsStr
  };
})();

if (typeof module !== "undefined") module.exports = CompFinderPricing;
