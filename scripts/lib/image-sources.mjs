/**
 * Where card art comes from, and in what order.
 *
 * tcgdex answers for most of the catalogue and is the first source for the
 * reasons in probe-images.mjs: no key, and one call returns a whole set with
 * its images. But it has holes, and measured on 2026-08-26 the holes are not
 * scattered — they are whole sets, and they are the expensive ones:
 *
 *     122  Shining Fates Shiny Vault          0 of 122 have art
 *      70  Crown Zenith Galarian Gallery      0 of 70
 *     120  four Trainer Galleries             0 of 30 each
 *      78  Shining Legends
 *      78  Dragon Majesty
 *      72  Aquapolis and Skyridge
 *     190  SM, SVP and MEP Black Star Promos
 *
 * 1,717 English cards in all. Those sub-sets are exactly what Last Comp
 * publishes — a Trainer Gallery card IS a chase card — so "some images are
 * missing" read on the site as most of the interesting ones missing.
 *
 * pokemontcg.io has every one of them. It is second rather than first because
 * it is the less reliable of the two: it was returning 500 to every call while
 * this was being written, exactly as it did on 2026-08-23, and its keyless
 * rate limit is 30 a minute against tcgdex's none. Second is where that
 * belongs — it is asked only about cards the first source had no art for, it
 * is never on a request path, and a source that cannot answer leaves the row
 * for the next run rather than marking it as having no art.
 *
 * Both are flattened to one card shape by card-images.mjs before the matcher
 * sees them, so the matching rules know nothing about either.
 *
 * One cost, and it is worth paying: their "small" is a ~180KB PNG where
 * tcgdex's is a ~35KB WEBP. Five times the weight, on the cards that had no
 * picture at all — which is why it is the fallback and not the default.
 *
 * Measured against the 455 published cards on 2026-08-26: 423 matched on
 * tcgdex alone, 438 with the second source behind it. The 17 still without art
 * are World Championship decks, Play! Prize Pack reprints and a few one-off
 * promos, which neither index holds.
 */
import { setFamily, indexByNumber, matchCard, tcgdexCards, pokemontcgCards } from "./card-images.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A paced, retrying GET.
 *
 * Returns null for "we don't know", NEVER for "empty" — a caller that treats a
 * failed call as an empty set records every card in it as having no art, and
 * then skips them on the next run because they have been checked.
 */
function http({ gapMs, headers, attempts = 4 }) {
  let last = 0;
  const stats = { calls: 0, failed: 0 };
  return {
    stats,
    async get(url) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const since = Date.now() - last;
        if (since < gapMs) await sleep(gapMs - since);
        last = Date.now();
        stats.calls++;
        try {
          const res = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
          if (res.ok) return await res.json();
        } catch { /* retried below */ }
        await sleep(1200 * (attempt + 1));
      }
      stats.failed++;
      return null;
    }
  };
}

/**
 * The only two places either API's host is written down. Everything else asks
 * a source; check-images.mjs greps to keep it that way, because a second
 * derivation of one of these URLs is a thing that quietly stops matching what
 * the backfill wrote.
 */
const TCGDEX_API = "https://api.tcgdex.net/v2/en";
const POKEMONTCG_API = "https://api.pokemontcg.io/v2";

/**
 * tcgdex. No key, and a set endpoint that hands back every card WITH its image
 * in a single call — 218 calls for the whole English catalogue. Paced at 250ms
 * anyway: they publish no limit and ask for politeness.
 */
export function tcgdex() {
  const api = http({ gapMs: 250 });
  return {
    name: "tcgdex",
    stats: api.stats,
    async sets() {
      return api.get(`${TCGDEX_API}/sets`);
    },
    async cards(setId) {
      const full = await api.get(`${TCGDEX_API}/sets/${encodeURIComponent(setId)}`);
      return full ? tcgdexCards(full.cards) : null;
    }
  };
}

/**
 * pokemontcg.io. Their documented keyless limit is 30 a minute and going over
 * it returns a bare 500 rather than a 429 — which is most of what looked like
 * unreliability the first time this was tried — so the gap is 2.1s unless
 * POKEMONTCG_API_KEY is set, which lifts the limit and the pacing with it.
 */
export function pokemontcg(apiKey = process.env.POKEMONTCG_API_KEY) {
  const api = http({
    gapMs: apiKey ? 300 : 2100,
    headers: apiKey ? { "X-Api-Key": apiKey } : undefined,
    // More patience than tcgdex gets, because this one has visibly bad
    // stretches — measured on 2026-08-26, a call took three tries to land
    // while its CDN served every image without a hiccup. Four attempts is
    // enough to drop the whole source on a bad afternoon, and dropping it is
    // the difference between a Trainer Gallery card having a picture and not.
    attempts: 6
  });
  const PAGE = 250;
  return {
    name: "pokemontcg",
    stats: api.stats,
    async sets() {
      const body = await api.get(`${POKEMONTCG_API}/sets?pageSize=500&select=id,name`);
      return body ? body.data || [] : null;
    },
    async cards(setId) {
      const out = [];
      for (let page = 1; ; page++) {
        const q = encodeURIComponent(`set.id:${setId}`);
        const body = await api.get(
          `${POKEMONTCG_API}/cards?q=${q}&select=id,name,number,images&page=${page}&pageSize=${PAGE}`
        );
        if (!body) return null;
        const data = body.data || [];
        out.push(...pokemontcgCards(data));
        if (data.length < PAGE) return out;
      }
    }
  };
}

/**
 * One of our set names, looked up in one source.
 *
 * null means the source couldn't be read — distinct from a set it simply
 * doesn't have, which is an empty family.
 */
async function indexFor(source, setName) {
  const family = setFamily(setName, source.setList || []);
  if (!family.length) return { family, byNumber: null };
  const bySetId = new Map();
  for (const part of family) {
    const cards = await source.cards(part.id);
    if (!cards) return null;
    bySetId.set(part.id, cards);
  }
  return { family, byNumber: indexByNumber(family, bySetId) };
}

/**
 * Fetch each source's set list once, up front. A source that won't answer at
 * all is dropped with a warning rather than taking the run down: losing the
 * fallback costs some art, and losing the run costs everything.
 */
export async function readySources(sources, log = console.log) {
  const ready = [];
  for (const source of sources) {
    const setList = await source.sets();
    if (!setList) {
      log(`  ${source.name} wouldn't answer — carrying on without it.`);
      continue;
    }
    source.setList = setList;
    ready.push(source);
    log(`  ${source.name}: ${setList.length} English sets`);
  }
  return ready;
}

/**
 * Match one of our sets, through the sources in order.
 *
 * A source is asked only about cards no earlier source found art for, so the
 * second one costs nothing on a set the first one covered — which is most of
 * them. Returns one entry per row, in the order given, each carrying the
 * outcome and which source produced it.
 *
 * `outcome: "unknown"` means every source that could have answered failed, and
 * is the one outcome a caller must not write down: the row is left for the
 * next run rather than recorded as having no art.
 */
export async function matchSet(sources, setName, rows) {
  const results = rows.map((row) => ({ row, match: { outcome: "no-set" }, source: null }));
  let anyFailed = false;

  for (const source of sources) {
    const todo = results.filter((r) => r.match.outcome !== "matched");
    if (!todo.length) break;

    const idx = await indexFor(source, setName);
    if (!idx) { anyFailed = true; continue; }
    if (!idx.byNumber) continue;   // this source doesn't have the set

    for (const r of todo) {
      const m = matchCard(r.row, idx.byNumber);
      // Never trade a specific answer for a vaguer one: "the number isn't in
      // their set" from a source that has the set says more than "no-set".
      if (m.outcome === "matched" || r.match.outcome === "no-set") {
        r.match = m;
        r.source = source.name;
      }
    }
  }

  if (anyFailed) {
    for (const r of results) if (r.match.outcome !== "matched") r.match = { outcome: "unknown" };
  }
  return results;
}

export default { tcgdex, pokemontcg, readySources, matchSet };
