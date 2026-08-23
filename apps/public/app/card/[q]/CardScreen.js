"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CompFinderPricing from "@compfinder/core/pricing.js";
import { epnLink, relFor } from "@compfinder/core/epn.js";
import { ebaySearchUrl } from "@compfinder/core/marketplace.js";
import { assessAsk } from "@/lib/verdict";
import { useCard, queryForCard, SOLD_WINDOW_DAYS } from "@/lib/use-card";
import { CardArt, Crumb, gbp } from "../../ui";

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export default function CardScreen({ query }) {
  const state = useCard(query);

  if (state.status === "loading") {
    return (
      <main>
        <Crumb label={query} />
        <div className="screen">
          <p className="body"><span className="spinner" /> &nbsp;Reading the last 90 days of sold listings…</p>
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

  return <Answer query={query} card={state.card} d={state.derived} />;
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
function Answer({ query, card, d }) {
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
  const workings = `/card/${encodeURIComponent(query)}/workings`;
  const searchUrl = ebaySearchUrl(card.q || query, { sold: false, customId: "buy-see-all" });

  return (
    <main>
      <Crumb
        label={[card.name, card.number].filter(Boolean).join(" ")}
        scope={`🇬🇧 ${SOLD_WINDOW_DAYS}d`}
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
                : <>nothing listed in the UK right now · {d.used} recent sale{d.used === 1 ? "" : "s"}</>}
            </span>
          </span>
        </div>

        {cheapest && cheapest.url ? (
          <a className="cta" href={epnLink(cheapest.url, { customId: "buy-hero" })}
             target="_blank" rel={relFor(cheapest.url, "noopener noreferrer")}>
            See it on eBay UK →
          </a>
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
        <div className="pair">
          <div className="panel">
            <span className="eyebrow">Sells for</span>
            <span className="figure sm">{gbp(d.marketPence)}</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>
              {d.used} sale{d.used === 1 ? "" : "s"}{med != null ? <> · median {gbp(med)}</> : null}
            </span>
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
