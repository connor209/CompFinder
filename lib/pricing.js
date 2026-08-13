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
    // Price-magnitude sanity check (2026-08-11) — deliberately wide (8x),
    // one-sided (only flags implausibly HIGH prices, never low ones — see
    // splitPriceOutliers comment for why symmetric trimming backfired on
    // real test data).
    priceOutlierMultiplier: 8,
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
      graded: ["psa", "cgc", "bgs", "sgc", "graded", "slab", "slabbed"],
      promoVariant: ["promo", "league", "championship", "worlds", "prerelease"],
      bundle: ["bundle", "playset", "lot of", "job lot", "joblot", "x2", "x3", "x4", "x5", "x6",
                "personal collection", "whole collection", "collection includes"],
      pickYourOwn: ["choose your card", "pick your own", "you choose", "select your", "pick a card", "you pick", "u pick", "make your selection", "choose your own"]
    }
  };

  // Grading companies are very often expressed as "PSA 9", "ACE 10", "CGC 8" with
  // no other keyword nearby (no literal word "graded" anywhere in the title) —
  // caught live on real search results, e.g. "...ACE 10 🔥" and "...ACE 1 Poor".
  // This regex catches that pattern on top of the plain keyword list above.
  const GRADED_NUMBER_PATTERN = /\b(psa|cgc|bgs|sgc|ace)\s*-?\s*\d{1,2}\b/i;

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
    const nameNumberMatches = [...t.matchAll(/\b[A-Z][a-zA-Z]+\s+(\d{2,4})\b/g)].filter((m) => {
      const n = parseInt(m[1], 10);
      const isYearLike = m[1].length === 4 && n >= 1990 && n <= 2035;
      return !isYearLike;
    });
    if (nameNumberMatches.length >= 2) return true;

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
   * Deliberately ONE-SIDED (only flags implausibly HIGH prices), and
   * deliberately wide (8x). Tested this both ways against a real 25-comp
   * data pull (2026-08-11): a symmetric version also flagged unusually
   * CHEAP comps as outliers whenever the group median itself was already
   * skewed high by other contamination — which actively excluded the
   * genuinely correct cheap comps instead of protecting them, making the
   * final price worse, not better. A cheap comp is never treated as
   * suspicious here, only a wildly expensive one.
   */
  function splitPriceOutliers(included, settings) {
    if (included.length < settings.postageOutlierMinComps) return { kept: included, flagged: [] };
    const totals = included.map((c) => c.totalPence).sort((a, b) => a - b);
    const med = median(totals);
    if (!med) return { kept: included, flagged: [] };
    const kept = [];
    const flagged = [];
    for (const c of included) {
      if (c.totalPence > med * settings.priceOutlierMultiplier) {
        flagged.push({ ...c, exclusionReason: "priceOutlier" });
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
    return simplifiedQuery
      .replace(/\b[A-Z]{0,3}\d{1,4}\s*\/\s*[A-Z]{0,3}\d{1,4}\b/i, "")
      .replace(/[()[\]#]/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);
  }

  function nameTokensMatch(title, nameTokens) {
    if (!nameTokens || nameTokens.length === 0) return true;
    const t = title || "";
    return nameTokens.every((tok) => {
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

  function classifyExclusion(listingTitle, excludeKeywords = DEFAULT_SETTINGS.excludeKeywords, nameTokens = null, cardNumber = null) {
    const t = listingTitle || "";
    if (!nameTokensMatch(t, nameTokens)) return "nameMismatch";
    // Reverse Holo is a distinct, separately-priced variant (see simplifyTitle
    // comments). nameTokens only checks required words ARE present, which
    // catches a search FOR reverse holo pulling in a non-reverse comp — but
    // not the reverse case: a plain search pulling in a reverse-holo comp.
    // Confirmed live: without this, a £7.97 Reverse Holo listing pooled
    // straight into a £2.34-£3.48 regular-printing comp set.
    const queryWantsReverseHolo = (nameTokens || []).some((tok) => /^reverse$/i.test(tok));
    if (!queryWantsReverseHolo && /\breverse\s*holo\b/i.test(t)) return "variantMismatch";
    if (GRADED_NUMBER_PATTERN.test(t)) return "graded";
    if (looksLikeNamedMultiCardLot(t, cardNumber)) return "multiCardLot";
    for (const [reason, words] of Object.entries(excludeKeywords)) {
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
    const kept = [];
    const flagged = [];
    for (const c of included) {
      if ((c.postagePence || 0) > threshold) flagged.push({ ...c, exclusionReason: "highPostage" });
      else kept.push(c);
    }
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
      const reason = classifyExclusion(comp.title, settings.excludeKeywords, nameTokens, cardNumber);
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
        excluded
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
          : `Median of ${included.length} comparable sale(s): ${toPoundsStr(rawPence)}${roundedNote}.`) + locationNote + catalogNote + setNote + spreadNote;

    return { rawPence, finalPence, confidence, dataSource, note, included, excluded };
  }

  function isGradedTitle(title) {
    const t = title || "";
    return GRADED_NUMBER_PATTERN.test(t) || /\b(graded|slab|slabbed)\b/i.test(t);
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
