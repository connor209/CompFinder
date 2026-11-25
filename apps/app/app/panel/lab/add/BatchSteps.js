"use client";

/**
 * Where an open batch has got to, as four steps, and the ONE thing to do
 * next as the big button. The table below can do everything; this answers
 * "what now?", which a 50-row table with eleven buttons above it did not.
 *
 * Pure reading of the rows (rowStatus from lib/lab-draft.js) — no state of
 * its own, so it can never disagree with the table's chips.
 */
import { nextStep } from "@/lib/lab-batches.js";

export default function BatchSteps({ progress: p, onPrice, onFilter, onListReady, busy }) {
  const step = nextStep(p);
  const steps = [
    { label: "Loaded", value: `${p.cards} card${p.cards === 1 ? "" : "s"}`, sub: `${p.copies} cop${p.copies === 1 ? "y" : "ies"}`, done: p.cards > 0, filter: "all" },
    { label: "Priced", value: `${p.priced} of ${p.cards}`, sub: p.queued ? `${p.queued} in the queue` : p.unpriced ? `${p.unpriced} not yet` : "", done: p.cards > 0 && p.priced >= p.cards, filter: "needsprice" },
    { label: "Checked", value: p.check ? `${p.check} to check` : "nothing to check", sub: p.needsPrice ? `${p.needsPrice} need a price` : "", done: p.cards > 0 && !p.check && !p.needsPrice && p.priced >= p.cards, filter: "thin" },
    { label: "Listed", value: `${p.listed} of ${p.cards}`, sub: p.sending ? `${p.sending} listing now` : p.failed ? `${p.failed} failed` : "", done: p.cards > 0 && p.listed >= p.cards, filter: "listed" }
  ];
  const act = () => {
    if (step.key === "price") onPrice();
    else if (step.key === "list") onListReady();
    else if (["needsprice", "thin", "failed"].includes(step.key)) onFilter(step.key);
  };
  return (
    <div className="bs">
      <ol className="bs-steps">
        {steps.map((s, i) => (
          <li key={s.label} className={s.done ? "done" : ""}>
            <button type="button" onClick={() => onFilter(s.filter)} title={`Show ${s.label.toLowerCase()}`}>
              <span className="bs-dot">{s.done ? "✓" : i + 1}</span>
              <span className="bs-txt"><b>{s.label}</b><span>{s.value}</span>{s.sub ? <small>{s.sub}</small> : null}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={`bs-next bs-${step.key}`}>
        <span>{step.text}</span>
        <span className="li-spacer" />
        {step.also ? <button className="li-btn" disabled={busy} onClick={onListReady}>{step.also}</button> : null}
        {step.button ? <button className="li-btn primary" disabled={busy} onClick={act}>{step.button}</button> : null}
      </div>
    </div>
  );
}

export const BATCH_STEPS_CSS = `
.bs { border:1px solid var(--line); border-radius:12px; background:var(--surface); margin-bottom:10px; overflow:hidden; }
.bs-steps { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); }
.bs-steps li { border-right:1px solid var(--line); min-width:0; }
.bs-steps li:last-child { border-right:0; }
.bs-steps button { width:100%; display:flex; gap:10px; align-items:flex-start; text-align:left; padding:10px 12px; background:none; border:0; font:inherit; color:var(--ink); cursor:pointer; }
.bs-steps button:hover { background:var(--surface-2); }
.bs-dot { flex:0 0 auto; width:24px; height:24px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; border:1px solid var(--line-strong); color:var(--ink-soft); }
.bs-steps li.done .bs-dot { background:var(--good); border-color:var(--good); color:#fff; }
.bs-txt { display:flex; flex-direction:column; gap:1px; font-size:13px; min-width:0; }
.bs-txt b { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft); }
.bs-txt small { color:var(--ink-faint); }
.bs-next { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; padding:10px 12px; border-top:1px solid var(--line); background:var(--surface-2); font-size:14px; }
.bs-next.bs-done { color:var(--good); }
@media (max-width: 640px) { .bs-steps { grid-template-columns:repeat(2, minmax(0, 1fr)); } .bs-steps li:nth-child(2) { border-right:0; } .bs-steps li:nth-child(-n+2) { border-bottom:1px solid var(--line); } }
`;
