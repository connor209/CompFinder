"use client";

import CompFinderPricing from "@compfinder/core/pricing.js";
import { FEE_RATE, FEE_FIXED_PENCE, DEFAULT_POSTAGE_PENCE } from "@/lib/verdict";
import { useCard, SOLD_WINDOW_DAYS } from "@/lib/use-card";
import { noteFor } from "@/lib/sale-note";
import { Crumb, gbp } from "../../../ui";

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const spell = (n) => COUNT_WORDS[n] || String(n);

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Screen 4 — the workings.
 *
 * Every sale counted, every sale thrown out and why, and what you'd actually
 * keep if you sold it. This is the screen the search page's third promise
 * refers to, and the one thing a price-guide site won't show you.
 *
 * It runs off the same hook as the answer, so the two can't disagree about
 * how many sales there were — a workings screen that doesn't reconcile with
 * the number it explains is worse than no workings screen.
 */
export default function Workings({ query }) {
  const state = useCard(query);
  const backToCard = `/card/${encodeURIComponent(query)}`;

  if (state.status !== "ready") {
    return (
      <main>
        <Crumb back={backToCard} label={query} />
        <div className="screen">
          <p className="body">
            {state.status === "error"
              ? state.error
              : <><span className="spinner" /> &nbsp;Adding it up…</>}
          </p>
        </div>
      </main>
    );
  }

  const { card, derived: d } = state;
  const counted = d.sales;
  const label = [card.name, card.number].filter(Boolean).join(" ");

  // Net-after-fees, and a caption built from the very same constants. On a
  // screen called "the workings", a caption that doesn't reproduce the figure
  // above it is the worst bug available.
  const postage = DEFAULT_POSTAGE_PENCE;
  const base = d.marketPence;
  const net = base == null
    ? null
    : Math.round((base + postage) * (1 - FEE_RATE) - FEE_FIXED_PENCE - postage);
  const feePct = `${(FEE_RATE * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  const fixed = FEE_FIXED_PENCE >= 100 ? gbp(FEE_FIXED_PENCE) : `${FEE_FIXED_PENCE}p`;

  return (
    <main>
      <Crumb back={backToCard} label={label} />
      <div className="screen">
        <h2 className="scr-h sm">Every sale we counted</h2>
        <p className="body" style={{ margin: "9px 0 0" }}>
          {spell(counted.length)} UK sale{counted.length === 1 ? "" : "s"} in the last {SOLD_WINDOW_DAYS} days,
          newest first. The last comp is the one at the top.
        </p>

        {counted.length > 0 ? (
          <div className="panel list" style={{ marginTop: 16 }}>
            {counted.map((s, i) => (
              <div className="comprow" key={s.url || i}>
                <span className="rowprice lg">{gbp(s.pence)}</span>
                <span className="when">{when(s.endedAt)}</span>
                <span className="note">{noteFor(s)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="micro" style={{ marginTop: 14 }}>
            Nothing survived the filters, so there is no price to explain.
          </p>
        )}

        {d.exclusions.length > 0 && (
          <>
            <h3 className="sub-h">And what we threw out</h3>
            <p className="body" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
              {spell(d.excludedCount)} more sale{d.excludedCount === 1 ? "" : "s"} matched the name and number
              but not the card you have.
            </p>
            <div className="panel list" style={{ marginTop: 12 }}>
              {d.exclusions.map((x) => (
                <div className="exrow" key={x.reason}>
                  <span className="reason">{x.reason}</span>
                  <span className="n">{x.n} sale{x.n === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {net != null && (
          <div className="panel pad13" style={{ marginTop: 16 }}>
            <span className="eyebrow">If you sold it yourself</span>
            <div className="netrow">
              <span className="figure md">{gbp(net)}</span>
              <span>in your pocket after eBay fees and postage</span>
            </div>
            <p className="micro" style={{ margin: "9px 0 0", fontSize: 12 }}>
              Based on {gbp(base)} at {feePct} fees, {fixed} fixed, plus {gbp(postage)} postage.
              Private sellers pay no fees, so a table price beats this less often than it looks.
            </p>
          </div>
        )}

        <p className="micro foot" style={{ margin: "14px 0 0" }}>
          Data from eBay UK completed listings, refreshed daily. We are not affiliated with
          Nintendo, Creatures or The Pok&eacute;mon Company.
        </p>
      </div>
    </main>
  );
}
