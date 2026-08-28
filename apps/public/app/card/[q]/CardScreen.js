"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { epnLink, relFor } from "@compfinder/core/epn.js";
import { bareNumber } from "@compfinder/core/cardnumber.js";
import { ebaySearchUrl } from "@compfinder/core/marketplace.js";
import { cardCustomId } from "@/lib/epn-tag";
import { assessAsk } from "@/lib/verdict";
import { useCard, queryForCard } from "@/lib/use-card";
import { rememberSearch } from "@/lib/recent-searches";
import { SOLD_WINDOWS, cardHref } from "@/lib/windows";
import { VARIANTS, variantQueryTerms } from "@/lib/variants";
import { listingsVerdict } from "@/lib/listings";
import TrendChart from "../../TrendChart";
import { CardArt, Crumb, SearchProgress, gbp } from "../../ui";
import ShareButton from "../../ShareButton";

function when(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export default function CardScreen({ query, days, initial = null, set = null, siblings = [] }) {
  const router = useRouter();
  // The window comes from the URL, the same way a variant does: changing it is
  // a different search, not a filter over what we already hold, and the
  // workings link has to carry it or it would explain a different number.
  const setDays = (w) => router.replace(cardHref(query, w), { scroll: false });
  // `initial` is a cached price the server already read, so the first paint
  // (and the HTML a crawler gets) carries the answer rather than a spinner.
  const state = useCard(query, days, initial);

  // Recorded HERE rather than at the search box, because this is the one place
  // every route in arrives at: the dropdown, a typed query, a chip, a set
  // page, a sibling link, a pasted URL. Recording at the box would have caught
  // the first of those and none of the rest. Only a card that actually
  // resolved counts — a search that failed is not somewhere to send someone
  // back to. The effect can run twice as the listings land; the store dedupes
  // on the query, so a second write moves the row rather than adding one.
  const readyCard = state.status === "ready" ? state.card : null;
  useEffect(() => {
    if (readyCard) rememberSearch(readyCard, query);
  }, [readyCard, query]);

  if (state.status === "loading") {
    return (
      <main>
        <Crumb label={query} />
        <div className="screen">
          <SearchProgress stage={state.stage} days={days} />
        </div>
      </main>
    );
  }

  if (state.status === "choose") return <WhichOne query={query} candidates={state.candidates} fuzzy={state.fuzzy} />;
  if (state.status === "error") {
    // A failed search is nearly always worth one more attempt — a shed request,
    // a wobbly upstream, a human check that didn't complete — and until now the
    // only way to make one was to leave the page. Worse on the human check,
    // where the server's "one moment" landed under NO LUCK as if the card were
    // the problem, so the heading says which of the two this is.
    return (
      <main>
        <Crumb label={query} />
        <div className="screen">
          <h2 className="scr-h">{state.needsChallenge ? "Still there?" : "No luck"}</h2>
          <p className="body" style={{ marginTop: 9 }}>{state.error}</p>
          <p style={{ marginTop: 14, display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
            <button type="button" className="link" onClick={state.retry}>Try again →</button>
            <Link className="link" href="/">← Try another card</Link>
          </p>
          {/* Small print, and it earns its place: this site has no analytics
              by promise, so a check that fails on a stranger's phone is
              otherwise invisible to us. The codes tell the causes apart. */}
          {state.diagnostic && (
            <p className="micro" style={{ marginTop: 18 }}>Check reported: {state.diagnostic}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <Answer query={query} card={state.card} d={state.derived} set={set} siblings={siblings} pending={state.listingsPending}
            days={days} setDays={setDays} />
  );
}

/* -------------------------------------------------------------------------
   Screen 2 — which one?
------------------------------------------------------------------------- */
function WhichOne({ query, candidates, fuzzy }) {
  const router = useRouter();
  const number = candidates[0] && candidates[0].number;
  const count = candidates.length;
  const spelled = ["", "One", "Two", "Three", "Four", "Five", "Six"][count] || String(count);

  // The first two get the full treatment; the long tail is a compact row, so a
  // six-way collision doesn't become six identical squares to read through.
  const big = candidates.slice(0, 2);
  const rest = candidates.slice(2);
  const go = (c) => router.push(`/card/${encodeURIComponent(queryForCard(c))}`);
  const name = candidates[0] ? candidates[0].name : query;

  return (
    <main>
      <Crumb label={query} />
      <div className="screen roomy">
        <h2 className="scr-h">Which {name}?</h2>
        <p className="body" style={{ margin: "9px 0 0" }}>
          {fuzzy
            ? <>Nothing matched exactly. Tap the one that looks like your card.</>
            : <>{spelled} sets print a {number}. Tap the one that matches your card&rsquo;s set symbol.</>}
        </p>

        <div className="picks">
          {big.map((c, i) => (
            <button key={c.id} type="button" className="pick" data-best={i === 0} onClick={() => go(c)}>
              <CardArt src={c.image} alt={c.name} />
              <span className="meta">
                <span className="set">{c.set}</span>
                <span className="num">
                  {[c.number, c.rarity].filter(Boolean).join(" · ")}
                </span>
                {c.language && c.language !== "English"
                  ? <span className="num" style={{ color: "var(--warn)" }}>{c.language} print</span>
                  : null}
              </span>
            </button>
          ))}
          {rest.map((c) => (
            <button key={c.id} type="button" className="pick compact" onClick={() => go(c)}>
              <CardArt src={c.image} alt={c.name} className="xs" />
              <span className="meta">
                <span className="set">{c.set}</span>
                <span className="num">
                  {[c.number, c.rarity, c.language !== "English" ? c.language : null]
                    .filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>

        <p className="micro" style={{ margin: "18px 0 0" }}>
          Still stuck? Check the tiny number in the bottom corner of the card — that&rsquo;s the one we want.
        </p>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------
   Screen 3 — the answer
------------------------------------------------------------------------- */
function Answer({ query, card, d, set = null, siblings = [], pending, days, setDays }) {
  const [ask, setAsk] = useState("");

  const askPence = useMemo(() => {
    const n = parseFloat(String(ask).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  }, [ask]);

  const verdict = useMemo(
    () => (askPence
      ? assessAsk({ askPence, comps: d.usedComps, marketPence: d.marketPence, liquidity: d.liquidity })
      : null),
    [askPence, d]
  );

  const cheapest = d.cheapest;
  const heroPence = cheapest ? cheapest.totalPence : d.marketPence;
  // What we are entitled to say about the live listings. An empty buy module
  // used to print "nothing listed in the UK right now" whatever had emptied it
  // — including a request that never came back. See lib/listings.js.
  const live = listingsVerdict({ pending, unknown: d.listingsUnknown, ...(d.listingCounts || {}) });
  const med = median(d.usedComps.map((c) => c.totalPence ?? c.itemPricePence).filter(Boolean));
  const workings = cardHref(query, days, "/workings");
  // Every outbound eBay link reports which card it was on, not just which
  // module — the EPN dashboard is the only per-page traffic signal this site
  // has, and "which sets earn" is what decides what gets published next.
  const tag = (slot) => cardCustomId(slot, card);
  // What the shareable PNG is drawn from. Sold figures only — see
  // lib/share-card.js for why "buy it today for" is deliberately absent from
  // an image that will still be legible in a thread six months from now.
  const sharePayload = {
    query,
    card: { name: card.name, set: card.set, number: card.number, image: card.image },
    marketPence: d.marketPence,
    used: d.used,
    windowDays: days,
    lastSale: d.sales && d.sales[0]
      ? { pence: d.sales[0].pence, endedAt: d.sales[0].endedAt }
      : null
  };
  const searchUrl = ebaySearchUrl(card.q || query, { sold: false, customId: tag("buy-see-all") });

  return (
    <main>
      <Crumb
        label={[card.name, card.number].filter(Boolean).join(" ")}
        scope={`🇬🇧 ${days}d`}
      />
      {set && (
        <p className="body soft" style={{ margin: "-4px 0 10px", fontSize: 12.5 }}>
          in <a className="link" href={`/set/${set.slug}`}>{set.name}</a> · {set.total} cards priced
        </p>
      )}

      <div className="headblock answer">
        <span className="wash" aria-hidden="true" />
        <span className="sheen" aria-hidden="true" />
        <div className="hero">
          <CardArt src={card.image} alt={card.name} className="lg" />
          <span className="col">
            <span className="eyebrow lg soft">
              {[card.set, card.rarity].filter(Boolean).join(" · ") || "Sold comps"}
            </span>
            <span className="name">{card.name}</span>
            <span className="eyebrow soft" style={{ letterSpacing: ".11em" }}>
              {cheapest ? "Buy it today for" : "Sells for"}
            </span>
            <span className="figure" style={{ marginTop: 3 }}>{gbp(heroPence)}</span>
            <span className="prov">
              {cheapest
                ? <>cheapest of {d.listings.length} UK listing{d.listings.length === 1 ? "" : "s"}
                    {cheapest.postagePence ? <> · +{gbp(cheapest.postagePence)} post</> : <> · free post</>}</>
                : pending
                  // The sold figure is on screen within a second; what's listed
                  // right now takes longer, and saying so beats a spinner where
                  // the answer should be.
                  ? <><span className="spinner" /> &nbsp;checking what&rsquo;s listed right now…</>
                  : <>{live.text} · {d.used} recent sale{d.used === 1 ? "" : "s"}</>}
            </span>
          </span>
        </div>

        {cheapest && cheapest.url ? (
          <a className="cta" href={epnLink(cheapest.url, { customId: tag("buy-hero") })}
             target="_blank" rel={relFor(cheapest.url, "noopener noreferrer")}>
            See it on eBay UK →
          </a>
        ) : pending ? (
          <span className="cta" data-pending="true">Finding the cheapest one…</span>
        ) : (
          // Nothing to buy is a real state, not an empty one: the useful next
          // move is a standing eBay search rather than a dead button.
          <a className="cta" href={searchUrl} target="_blank"
             rel={relFor("https://www.ebay.co.uk/", "noopener noreferrer")}>
            {live.state === "none" ? <>Watch this card on eBay →</> : <>See what&rsquo;s listed on eBay →</>}
          </a>
        )}
        <p className="disclosure">
          Affiliate link — we get a small cut if you buy. Never changes the price or which listing we show first.
        </p>
      </div>

      <div className="screen tight">
        {d.caveats.length > 0 && (
          <div className="caveats">
            {d.caveats.map((c, i) => (
              <p className="caveat" data-tone={c.tone} key={i}>{c.text}</p>
            ))}
          </div>
        )}

        {/* variantsPresent returns a COUNT MAP, not a list — reading .length off
            it silently hid this control entirely on the first attempt. */}
        {Object.keys(d.variantsHere).length > 0 && (
          <div className="variants">
            <span className="eyebrow">Which printing</span>
            <div className="pills" style={{ marginTop: 7 }}>
              {VARIANTS.filter((v) => v.key === "any" || d.variantsHere[v.key]).map((v) => {
                // A variant is just a different search, so it gets its own URL
                // rather than being a control that mutates this one.
                const target = [card.name, card.number, card.set, ...variantQueryTerms(v.key)]
                  .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
                const on = (card.q || "") === target;
                return (
                  <a key={v.key} className="pill" data-on={on}
                     href={`/card/${encodeURIComponent(target)}`}>
                    <b>{v.label}</b>
                    {d.variantsHere[v.key] ? <span>{d.variantsHere[v.key]}</span> : null}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <div className="pair">
          <div className="panel">
            <span className="eyebrow">Sells for</span>
            <span className="figure sm">{gbp(d.marketPence)}</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>
              {d.used} sale{d.used === 1 ? "" : "s"}{med != null ? <> · median {gbp(med)}</> : null}
            </span>
            {d.lastComp && (
              <span className="split">
                Last one sold <b className="lastcomp">{gbp(d.lastComp.pence)}</b>
                {d.lastComp.endedAt ? <> · {when(d.lastComp.endedAt)}</> : null}
              </span>
            )}
            {d.restPence != null && d.marketUsed > 0 && (
              <span className="split">
                UK {gbp(d.ukPence)} · rest of the market {gbp(d.restPence)}
                {premiumLine(d.ukPence, d.restPence)}
              </span>
            )}
          </div>
          <div className="panel">
            <span className="eyebrow">Shifts</span>
            <span className="dsp dsp-700" style={{ fontSize: 13, color: liquidityColour(d.liquidity.band) }}>
              {d.liquidity.label}
            </span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>
              {rateLine(d.liquidity)}
            </span>
          </div>
        </div>

        <div className="panel pad13" style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="eyebrow">Confidence</span>
            <span className="confpill" data-level={d.confidence.level}>{d.confidence.tier}</span>
          </div>
          <div className="confbar" aria-hidden="true">
            {[0, 1, 2].map((i) => <i key={i} data-on={i < d.confidence.filled} />)}
          </div>
          <p className="body" style={{ margin: "9px 0 0", fontSize: 12.5 }}>{d.confidence.prose}</p>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 9 }}>
            <a className="link" href={workings}>See the workings →</a>
            {/* Sits beside the workings rather than under the price: both are
                for someone who intends to pass the answer on. */}
            <ShareButton
              payload={sharePayload}
              filename={`lastcomp-${[card.name, card.number].filter(Boolean).join("-")
                .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "card"}.png`}
            />
          </div>
        </div>

        {d.bands && (
          <div className="panel pad13" style={{ marginTop: 10 }}>
            <span className="eyebrow">Condition is doing the work here</span>
            <div className="bands">
              <div>
                <span className="bandlabel">Near mint</span>
                <span className="figure sm">{gbp(d.bands.nmPence)}</span>
                <span className="bandn">{d.bands.nmCount} sale{d.bands.nmCount === 1 ? "" : "s"}</span>
              </div>
              <div>
                <span className="bandlabel">Played</span>
                <span className="figure sm">{gbp(d.bands.playedPence)}</span>
                <span className="bandn">{d.bands.playedCount} sale{d.bands.playedCount === 1 ? "" : "s"}</span>
              </div>
            </div>
            <p className="micro" style={{ marginTop: 9 }}>
              Only sellers who stated a condition. On this card that is a{" "}
              {Math.round((d.bands.nmPence / d.bands.playedPence - 1) * 100)}% difference,
              so which one you are holding matters more than the headline.
            </p>
          </div>
        )}

        {d.graded.length > 0 && (
          <div className="panel pad13" style={{ marginTop: 10 }}>
            <span className="eyebrow">Graded, if yours were slabbed</span>
            <div className="graded">
              {d.graded.slice(0, 6).map((g) => (
                <div className="gradedrow" key={g.key}>
                  <span className="gtier">{g.label}</span>
                  <span className="gprice">{gbp(g.medianPence)}</span>
                  <span className="gn">{g.count} sale{g.count === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
            <p className="micro" style={{ marginTop: 8 }}>
              A different market from a raw card, and none of these are in the price above.
            </p>
          </div>
        )}

        {d.sales.length >= 2 && (
          <div className="panel pad13" style={{ marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="section-title">What it&rsquo;s been doing</span>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                daily median · dashed line is the {days}-day figure
              </span>
            </div>
            <TrendChart
              sales={d.sales.filter((s) => s.t).map((s) => ({ t: s.t, v: s.pence }))}
              medianPence={d.marketPence}
              windowDays={days}
            />
          </div>
        )}

        <div className="panel pad13" style={{ marginTop: 10 }}>
          <span className="eyebrow">Someone&rsquo;s offering it to you at</span>
          <div className="askrow">
            <span className="cur">£</span>
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              aria-label="The price you are being asked"
              placeholder="0"
            />
            <span className="verdict" data-tone={verdict ? verdict.tone : undefined}>
              {verdict ? verdict.call : ""}
            </span>
          </div>
          <p className="body" style={{ margin: "9px 0 0", fontSize: 12.5, lineHeight: 1.6 }}>
            {askPence
              ? <>{onlineLine(askPence, cheapest)} {verdict ? verdict.notes[0] : null}</>
              : <>Type what they&rsquo;re asking and we&rsquo;ll tell you how it compares to what this card actually sells for.</>}
          </p>
        </div>

        <div className="windowrow">
          <span className="eyebrow">Sold window</span>
          <div className="pills" style={{ marginTop: 7 }}>
            {SOLD_WINDOWS.map((w) => (
              <button key={w} type="button" className="pill" data-on={w === days}
                      onClick={() => setDays(w)}>
                <b>Last {w} days</b>
              </button>
            ))}
          </div>
          <p className="micro" style={{ marginTop: 7 }}>
            Ninety days finds more sales; thirty is more current on a card that&rsquo;s moving.
          </p>
        </div>

        {d.listings.length > 0 && (
          <div className="panel list" style={{ marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, paddingTop: 9 }}>
              <span className="section-title">Cheapest listings now</span>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                {d.listings.length} on eBay UK
              </span>
            </div>
            {/* Said out loud rather than quietly dropped: a count that shrinks
                with no explanation reads as having found less than we did, and
                "too cheap to be this card" is the useful half of the answer —
                it tells someone what they'll see if they go and look. */}
            {d.suppressedListings > 0 && (
              <p className="body soft" style={{ margin: "0 0 8px", fontSize: 12 }}>
                {d.suppressedListings} cheaper {d.suppressedListings === 1 ? "listing is" : "listings are"} hidden
                {d.listingFloorPence ? <> — under {gbp(d.listingFloorPence)}</> : null}, which is too far below what
                this card sells for to be the same card. Fakes and wrong printings collect at the bottom of the list.
              </p>
            )}
            {d.listings.slice(0, 4).map((l, i) => (
              <a key={l.url || i} className="listing" href={epnLink(l.url, { customId: tag("buy-row") })}
                 target="_blank" rel={relFor(l.url, "noopener noreferrer")}>
                <span className="rowprice">{gbp(l.totalPence)}</span>
                <span className="title">{l.title}</span>
                <span className="cond">{l.condition || ""}</span>
              </a>
            ))}
            <a className="link" style={{ display: "inline-block", margin: "10px 0 6px" }}
               href={searchUrl} target="_blank"
               rel={relFor("https://www.ebay.co.uk/", "noopener noreferrer")}>
              All {d.listings.length} on eBay →
            </a>
          </div>
        )}

        {/* An empty buy module that ISN'T "eBay has none". The visitor can see
            the listings on eBay in ten seconds, so a page claiming there are
            none spends its credibility on the one thing it is easiest to check
            — and the honest version is also the more useful one, because it
            says what to go and look at. */}
        {!pending && d.listings.length === 0 && live.state !== "none" && (
          <div className="panel list" style={{ marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, paddingTop: 9 }}>
              <span className="section-title">
                {live.state === "unknown"
                  ? <>Couldn&rsquo;t check what&rsquo;s listed</>
                  : live.state === "elsewhere"
                    ? <>Listed, but not in the UK</>
                    : <>Listed, but not confirmed as this card</>}
              </span>
            </div>
            <p className="body soft" style={{ margin: "0 0 4px", fontSize: 12.5, lineHeight: 1.6 }}>
              {live.state === "unknown" ? (
                <>We couldn&rsquo;t check what&rsquo;s listed right now — that&rsquo;s us, not eBay.
                  The sold prices above are unaffected. Have a look yourself, or try again in a moment.</>
              ) : live.state === "elsewhere" ? (
                <>{d.listingCounts.elsewhere} listed right now, all from sellers outside the UK.
                  We only lead with UK listings, because postage and import charges make a price
                  from abroad a different number to the one above.</>
              ) : (
                <>{d.listingCounts.fetched} listed right now, and we couldn&rsquo;t confirm any of them
                  as this card — the title has to carry {bareNumber(card.number) || "the collector number"}, and an
                  asking price far below what the card sells for is where fakes and wrong printings
                  collect. Worth looking yourself.</>
              )}
            </p>
            <a className="link" style={{ display: "inline-block", margin: "8px 0 6px" }}
               href={searchUrl} target="_blank"
               rel={relFor("https://www.ebay.co.uk/", "noopener noreferrer")}>
              See what&rsquo;s on eBay →
            </a>
          </div>
        )}

        {/* Somewhere to go next, and the internal linking this site had none
            of. Rendered from the manifest, so it costs no query — the prices
            live on the set page, one click away, which does the database work
            once for the whole set instead of on every card view. */}
        {set && siblings.length > 0 && (
          <div className="panel list" style={{ marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, paddingTop: 9 }}>
              <span className="section-title">More from {set.name}</span>
              <span className="spacer" style={{ flex: 1 }} />
              <a className="link" style={{ fontSize: 12 }} href={`/set/${set.slug}`}>
                All {set.total} by value →
              </a>
            </div>
            <div className="siblings">
              {siblings.map((c) => (
                <a className="sibling" key={c.q} href={`/card/${encodeURIComponent(c.q)}`}>
                  <span className="nm">{c.name}</span>
                  <span className="mt">{c.number}</span>
                </a>
              ))}
            </div>
          </div>
        )}

      </div>
    </main>
  );
}

/** UK against the rest, when the gap is big enough to be worth a sentence. */
function premiumLine(ukPence, restPence) {
  if (!ukPence || !restPence) return null;
  const diff = ukPence / restPence - 1;
  if (Math.abs(diff) < 0.05) return <> · in line</>;
  return <> · UK is <b className={diff > 0 ? "up" : "down"}>
    {Math.abs(Math.round(diff * 100))}% {diff > 0 ? "higher" : "lower"}
  </b></>;
}

function liquidityColour(band) {
  if (band === "very-liquid" || band === "liquid") return "var(--good)";
  if (band === "slow") return "var(--warn)";
  return "var(--ink-soft)";
}

/** "~2 a week in the UK", or the honest version when there's nothing to rate. */
function rateLine(liq) {
  if (!liq || liq.band === "unknown") return "not enough sales to say";
  const perWeek = liq.recentPerWeek;
  if (perWeek >= 1) return `~${Math.round(perWeek)} a week in the UK`;
  if (perWeek > 0) return `about one every ${Math.round(7 / perWeek)} days`;
  return "nothing recently";
}

/** The vendor's price against the cheapest thing you could buy instead. */
function onlineLine(askPence, cheapest) {
  if (!cheapest) return "Nothing is listed in the UK right now, so there's nothing to buy it against.";
  const diff = Math.abs(askPence - cheapest.totalPence);
  return askPence > cheapest.totalPence
    ? `You could buy it online for ${gbp(cheapest.totalPence)} — that's ${gbp(diff)} less than they're asking.`
    : `Cheapest online is ${gbp(cheapest.totalPence)}, so this is ${gbp(diff)} cheaper than buying it.`;
}
