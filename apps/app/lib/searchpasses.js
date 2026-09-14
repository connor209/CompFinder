/**
 * Comp Finder — asking the same card more than one way.
 *
 * One query per card is one sample. Measured on a 50-card reverse-holo commons
 * run, SoldComps RETURNED a median of 11 listings per card and six cards got
 * fewer than five — while the filter kept 8 of the 11. **The loss is upstream
 * of the rules**: the search found little, not the engine threw much away. And
 * the time lever is gone, because SoldComps holds no data far enough back for
 * a wider window to reach.
 *
 * So the remaining lever is to ask differently. A pass drops one term from the
 * query and keeps everything else — including the FILTER, which is the whole
 * reason this is safe: a wider search cannot admit a wrong card, because every
 * comp it returns still goes through `classifyExclusion` against the real
 * card's settings. Widening the search is not widening what counts.
 *
 * Two things come out of running several:
 *
 * - **More comps**, merged and de-duplicated, for one price off a bigger pool.
 * - **Corroboration.** Passes that find different listings and agree on a
 *   figure are evidence of a kind one query cannot produce. Passes that
 *   disagree are worth saying so, because that means the narrow search was a
 *   biased sample rather than a small one — and a confident number built on a
 *   biased sample is exactly what this repo keeps finding at the bottom of its
 *   worst bugs.
 *
 * Framework-free and app-import-free, so `scripts/check-searchpasses.mjs` can
 * load it under bare node.
 */

/**
 * The ladder, narrowest first.
 *
 * Each rung is expressed as a CHANGE TO THE ITEM rather than a query string of
 * its own, so every rung goes through `buildQueryFromItem` — the one place
 * that knows how a query is composed. A second query builder here would drift
 * from the real one, and the drift would show up as passes that quietly search
 * for something the app does not think they search for.
 *
 * Order is deliberate. Dropping the SET is the safest widening: the collector
 * number is the anchor and the set was only steering, and it is the term
 * sellers spell most variously — CardUploader writes Cardmarket's names, and
 * "Deck Exclusives" or "SM Base Set" are not what anybody titles a listing.
 * Dropping the PRINTING is later because it carries a real risk: plain copies
 * vastly outnumber reverse holos, so on a card with many sales a page that no
 * longer asks for the printing can come back full of the wrong one. That risk
 * is why `needsAnotherPass()` stops at a full page.
 */
export const PASSES = [
  {
    key: "exact",
    label: "As the file describes it",
    detail: "name, printing, number and set",
    item: (item) => item
  },
  {
    key: "noset",
    label: "Without the set",
    detail: "the number is the anchor; the set was only steering, and it is the term sellers spell most variously",
    item: (item) => ({ ...item, set: "" })
  },
  {
    key: "noprinting",
    label: "Without the printing",
    detail: "finds \"Rev Holo\" and \"Reverse Foil\" listings the literal words never return — the filter still keeps only this printing",
    item: (item) => ({ ...item, title: stripPrinting(item.title) })
  },
  {
    key: "bare",
    label: "Name and number only",
    detail: "the widest ask — everything the filter then has to judge",
    item: (item) => ({ ...item, set: "", title: stripPrinting(item.title) })
  }
];

/** How many passes each depth runs. 1 is what the app has always done. */
export const MAX_DEPTH = PASSES.length;

/**
 * Take the printing words out of a title so the query stops demanding them.
 *
 * ONLY the query. The card is still a reverse holo and the filter still knows
 * it, because the filter reads the REAL title. Handing a stripped title to
 * `settingsForText` would undo the printing rule and pool the two printings —
 * the bug three cards sold under market for. `check-searchpasses.mjs` pins it.
 */
export function stripPrinting(title) {
  return String(title || "")
    .replace(/\brev(?:erse)?\b[\s.\-]*(?:holo(?:foil)?|foil)\b/gi, " ")
    .replace(/\breverse\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The queries to run for one card at a given depth.
 *
 * `build` is `CardUploaderCsv.buildQueryFromItem`, handed in rather than
 * imported so this file stays loadable on its own. Rungs that produce a query
 * identical to one already in the list are dropped: a card with no set has
 * nothing to drop, and paying a second request for the same string is the one
 * thing a multi-pass search must never do.
 */
export function passesFor(item, options, depth, build) {
  const out = [];
  const seen = new Set();
  for (const pass of PASSES.slice(0, Math.max(1, Math.min(depth || 1, MAX_DEPTH)))) {
    const built = build(pass.item(item), options);
    const query = (built?.query || "").trim();
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    out.push({ key: pass.key, label: pass.label, detail: pass.detail, query, nameTokens: built.nameTokens, set: built.set });
  }
  return out;
}

/**
 * What identifies one sold listing across two searches.
 *
 * The item id when SoldComps gave one, then the URL. The fallback is title +
 * total + ended date, which is what remains of a sale's identity when neither
 * is present — and getting this wrong is the one failure that would be
 * invisible: the same sale counted twice weights the median toward whatever
 * the easy searches found, which is precisely the bias running more passes is
 * meant to remove.
 */
export function compKey(comp) {
  const id = comp?._source?.itemId ?? comp?.itemId ?? comp?._source?.url ?? comp?.url;
  if (id) return `id:${id}`;
  return `x:${comp?.title || ""}|${comp?.totalPence ?? comp?.itemPricePence ?? ""}|${comp?._source?.endedAt || comp?.soldDate || ""}`;
}

/**
 * One comp set out of several passes, each sale counted once.
 *
 * Keeps the FIRST sighting, so a comp belongs to the narrowest pass that found
 * it — which makes "what did the wider passes actually add" answerable rather
 * than a guess.
 */
export function mergeComps(passResults) {
  const byKey = new Map();
  const addedBy = {};
  for (const pass of passResults || []) {
    let added = 0;
    for (const comp of pass.comps || []) {
      const key = compKey(comp);
      if (byKey.has(key)) continue;
      byKey.set(key, comp);
      added++;
    }
    addedBy[pass.key] = added;
  }
  return { comps: [...byKey.values()], addedBy };
}

/**
 * Is another pass worth a request?
 *
 * No, when the last one came back FULL. SoldComps returns one page newest
 * first, so a capped card already has more sales than it showed us and a wider
 * query does not reach further back — it returns a different, wider page, which
 * on a reverse holo means a page of plain copies. Widening a card that is
 * already full spends a request to make the sample worse.
 *
 * No, when there are already plenty. `ENOUGH` is a judgement, not a
 * measurement: it is the app's own MIN_SOLD_COMPS_TO_PRICE (3) several times
 * over, chosen so a card with a real pool stops and a thin one keeps asking.
 * It should move if a corpus disagrees.
 */
export const ENOUGH_COMPS = 12;

export function needsAnotherPass(result, { enough = ENOUGH_COMPS } = {}) {
  if (!result) return true;
  if (result.hasNextPage) return false;
  return (result.comps?.length || 0) < enough;
}

/**
 * How much the passes agree, which is the part that makes a price STRONG
 * rather than merely bigger.
 *
 * Two searches that found different listings and landed on the same figure are
 * evidence of a kind one search cannot give. Two that disagree say the narrow
 * one was a biased sample rather than a small one — and nothing else in this
 * app can tell those apart.
 *
 * `AGREE_WITHIN_PCT` is NOT measured against a corpus. It is a first number,
 * written here so it is one number rather than a feeling scattered through the
 * UI, and the audit harness is how it should be settled.
 */
export const AGREE_WITHIN_PCT = 25;

export function agreementOf(passPrices, { within = AGREE_WITHIN_PCT } = {}) {
  const priced = (passPrices || []).filter((p) => p && p.pence > 0);
  if (priced.length < 2) {
    return { passes: priced.length, corroborated: false, spreadPct: null, low: null, high: null };
  }
  const values = priced.map((p) => p.pence);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spreadPct = low > 0 ? ((high - low) / low) * 100 : null;
  return {
    passes: priced.length,
    corroborated: spreadPct != null && spreadPct <= within,
    spreadPct,
    low,
    high
  };
}

/**
 * What the ladder actually DID for one card — the answer to "I set it to 4;
 * how many did this card use?"
 *
 * The app could not say. `rec.passes` was built only when more than one pass
 * ran, so a card that stopped after the first one carried nothing at all and
 * was indistinguishable from a card priced at depth 1 — which is the case you
 * most want explained, because it is the one where the setting looks like it
 * did nothing. Three separate things can end a ladder early and they mean
 * opposite things about the card:
 *
 * - **collapsed** — the wider rungs built the SAME query (a card with no set
 *   has nothing to drop), so there was never a second search to run. Nothing
 *   was saved by stopping and nothing was lost.
 * - **full** — the page came back capped. There are no older sales behind a
 *   wider query, only a wider page, so another rung spends a request to make
 *   the sample worse.
 * - **enough** — the card already has plenty. Stopping is the budget working.
 * - **exhausted** — every rung ran. This is the card the depth was for.
 *
 * Built for EVERY card, at every depth, so the row can always say which of
 * those happened. `fetched` is what the pass returned and `added` is what it
 * contributed after de-duplication — the second is the one that says whether a
 * rung earned its request, and they are very different numbers on a card whose
 * searches mostly return the same listings.
 */
export function searchSummary({ depth = 1, ladder = [], passResults = [], addedBy = {}, lastResult = null } = {}) {
  const eligible = ladder.length || passResults.length || 1;
  const ran = passResults.length;
  const asked = Math.max(1, Math.min(depth || 1, MAX_DEPTH));

  let stop = "exhausted";
  if (asked === 1) stop = "single";
  else if (eligible === 1) stop = "collapsed";
  else if (ran < eligible) stop = lastResult && lastResult.hasNextPage ? "full" : "enough";

  return {
    depth: asked,
    eligible,
    ran,
    stop,
    stopReason: STOP_REASONS[stop],
    passes: (passResults || []).map((p) => ({
      key: p.key,
      label: p.label,
      query: p.query,
      fetched: (p.comps || []).length,
      added: addedBy && Object.prototype.hasOwnProperty.call(addedBy, p.key) ? addedBy[p.key] : null,
      cached: !!p.cached
    }))
  };
}

const STOP_REASONS = {
  single: "Depth 1 — one search, which is what the app has always done.",
  collapsed: "Every wider search would have repeated the same query — this card has nothing left to drop, so one search is the whole ladder.",
  full: "The page came back FULL, so there are no older sales behind a wider query — only a wider page, which on a reverse holo is a page of plain copies.",
  enough: `Enough sales were already in hand (${ENOUGH_COMPS}+), so the remaining searches were not worth a request.`,
  exhausted: "Every search available at this depth was run."
};

/** The short form for a row: "2 of 4 searches · stopped, page was full". */
export function searchLabel(summary) {
  if (!summary) return "";
  const n = `${summary.ran} of ${summary.eligible} search${summary.eligible === 1 ? "" : "es"}`;
  if (summary.stop === "single") return `${n} · depth 1`;
  if (summary.stop === "collapsed") return `${n} · nothing left to drop`;
  if (summary.stop === "full") return `${n} · stopped, page was full`;
  if (summary.stop === "enough") return `${n} · stopped, enough sales`;
  return `${n} · ran the lot`;
}

/** One sentence for the row, because a price that was corroborated and one
 *  that was contradicted must not look the same. */
export function agreementNote(agreement, addedBy = {}) {
  if (!agreement || agreement.passes < 2) return "";
  const extra = Object.entries(addedBy)
    .filter(([key, n]) => key !== "exact" && n > 0)
    .map(([key, n]) => `${n} from "${key}"`)
    .join(", ");
  const found = extra ? ` (${extra})` : "";
  if (agreement.corroborated) {
    return `${agreement.passes} searches of this card agreed within ${Math.round(agreement.spreadPct)}%${found}, so the figure is corroborated rather than a single sample.`;
  }
  return `⚠ ${agreement.passes} searches of this card disagreed by ${Math.round(agreement.spreadPct)}%${found}. A wider search finding a different price means the narrow one was a biased sample, not just a small one — worth reading the comps before trusting this.`;
}
