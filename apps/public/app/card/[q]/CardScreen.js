"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { epnLink, relFor } from "@compfinder/core/epn.js";
import { ebaySearchUrl } from "@compfinder/core/marketplace.js";
import { assessAsk } from "@/lib/verdict";
import { useCard, queryForCard } from "@/lib/use-card";
import { SOLD_WINDOWS, cardHref } from "@/lib/windows";
import { VARIANTS, variantQueryTerms } from "@/lib/variants";
import TrendChart from "../../TrendChart";
import { CardArt, Crumb, gbp } from "../../ui";

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

export default function CardScreen({ query, days }) {
  const router = useRouter();
  // The window comes from the URL, the same way a variant does: changing it is
  // a different search, not a filter over what we already hold, and the
  // workings link has to carry it or it would explain a different number.
  const setDays = (w) => router.replace(cardHref(query, w), { scroll: false });
  const state = useCard(query, days);

  if (state.status === "loading") {
    return (
      <main>
        <Crumb label={query} />
        <div className="screen">
          <p className="body"><span className="spinner" /> &nbsp;Reading the last {days} days of sold listings…</p>
        </div>
      </main>
    );
  }

  if (state.status === "choose") return <WhichOne query={query} candidates={state.candidates} fuzzy={state.fuzzy} />;
  if (state.status === "error") {
    return (
      <main>
        <Crumb label={query} />
        <div className="screen">
          <h2 className="scr-h">No luck</h2>
          <p className="body" style={{ marginTop: 9 }}>{state.error}</p>
          <p style={{ marginTop: 14 }}><a className="link" href="/">← Try another card</a></p>
        </div>
      </main>
    );
  }

  return (
    <Answer query={query} card={state.card} d={state.derived} pending={state.listingsPending}
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
function Answer({ query, card, d, pending, days, setDays }) {
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
  const med = median(d.usedComps.map((c) => c.totalPence ?? c.itemPricePence).filter(Boolean));
  const workings = cardHref(query, days, "/workings");
  const searchUrl = ebaySearchUrl(card.q || query, { sold: false, customId: "buy-see-all" });

  return (
    <main>
      <Crumb
        label={[card.name, card.number].filter(Boolean).join(" ")}
        scope={`🇬🇧 ${days}d`}
      />

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
                  : <>nothing listed in the UK right now · {d.used} recent sale{d.used === 1 ? "" : "s"}</>}
            </span>
          </span>
        </div>

        {cheapest && cheapest.url ? (
          <a className="cta" href={epnLink(cheapest.url, { customId: "buy-hero" })}
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
            Watch this card on eBay →
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
          <a className="link" style={{ display: "inline-block", marginTop: 9 }} href={workings}>
            See the workings →
          </a>
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
            {d.listings.slice(0, 4).map((l, i) => (
              <a key={l.url || i} className="listing" href={epnLink(l.url, { customId: "buy-row" })}
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
