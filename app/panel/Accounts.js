"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CompFinderPricing from "@/lib/pricing.js";
import { pagedSelect } from "@/lib/pagedSelect";

const pounds = (p) => (p == null ? "£0.00" : CompFinderPricing.toPoundsStr(Math.round(p)));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// UK tax year runs 6 April → 5 April. Returns the start year for a given date.
function taxYearStart(d) {
  const y = d.getFullYear();
  const sixthApril = new Date(y, 3, 6);
  return d >= sixthApril ? y : y - 1;
}
function taxYearRange(startYear) {
  return { from: `${startYear}-04-06`, to: `${startYear + 1}-04-05`, label: `${startYear}/${String(startYear + 1).slice(2)}` };
}

const BUSINESS = [
  { key: "hobbyist", label: "Hobbyist" },
  { key: "sole_trader", label: "Sole trader" },
  { key: "limited", label: "Limited company" }
];

// Buy-ledger categories → accounting lines.
function expenseLine(r) {
  if (r.kind === "card") return "stock"; // deals = stock bought
  const c = r.category || "Other";
  if (c === "Singles" || c === "Sealed / boxes") return "stock";
  if (c === "Postage") return "postage";
  if (c === "Supplies") return "packaging";
  if (c === "Fees") return "subs";
  return "other";
}

/**
 * Accounts — a cash-basis profit & loss report. Pulls income from cached eBay
 * sales and costs from the Buy ledger over a chosen period (UK tax year aware),
 * then presents it at the depth the business needs: a light summary for a
 * hobbyist, an allowable-expenses breakdown for a sole trader, and a
 * cost-of-sales / overheads layout for a limited company. Same data in — the
 * report out is what changes. Not tax advice.
 */
export default function Accounts() {
  const [sales, setSales] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [settings, setSettings] = useState({});
  const [businessType, setBusinessType] = useState("sole_trader");
  const [feePct, setFeePct] = useState(12.8);
  const [period, setPeriod] = useState("this_tax");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  async function load() {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const [{ data: profile }, s, p] = await Promise.all([
      sb.from("profiles").select("settings").eq("id", user.id).single(),
      pagedSelect(() => sb.from("ebay_sales").select("sold_pence,sold_date,quantity")),
      pagedSelect(() => sb.from("purchases").select("kind,category,amount_pence,purchased_at"))
    ]);
    const st = profile?.settings || {};
    setSettings(st);
    if (st.accounts?.businessType) setBusinessType(st.accounts.businessType);
    if (st.accounts?.feePct != null) setFeePct(st.accounts.feePct);
    setSales(s || []);
    setPurchases(p || []);
  }
  useEffect(() => { load(); }, []);

  async function persistAccounts(patch) {
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      const nextSettings = { ...settings, accounts: { ...(settings.accounts || {}), businessType, feePct, ...patch } };
      setSettings(nextSettings);
      await sb.from("profiles").update({ settings: nextSettings }).eq("id", user.id);
    } catch { /* best-effort */ }
  }
  function saveBusiness(next) { setBusinessType(next); persistAccounts({ businessType: next }); }
  function saveFee(pct) { setFeePct(pct); persistAccounts({ feePct: pct }); }

  const now = new Date();
  const range = useMemo(() => {
    if (period === "this_tax") return taxYearRange(taxYearStart(now));
    if (period === "last_tax") return taxYearRange(taxYearStart(now) - 1);
    if (period === "this_cal") return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31`, label: String(now.getFullYear()) };
    if (period === "custom") return { from: customFrom || "1970-01-01", to: customTo || iso(now), label: "custom" };
    return { from: "1970-01-01", to: "2999-12-31", label: "all time" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo]);

  const report = useMemo(() => {
    if (sales === null) return null;
    const inRange = (dstr) => { const d = (dstr || "").slice(0, 10); return d >= range.from && d <= range.to; };
    let income = 0, unitsSold = 0;
    for (const s of sales) if (inRange(s.sold_date)) { income += s.sold_pence || 0; unitsSold += s.quantity || 1; }
    const lines = { stock: 0, postage: 0, packaging: 0, subs: 0, other: 0 };
    for (const r of purchases) if (inRange(r.purchased_at)) lines[expenseLine(r)] += r.amount_pence || 0;
    const sellingFees = Math.round(income * (Number(feePct) || 0) / 100);
    const expensesTotal = lines.stock + lines.postage + lines.packaging + lines.subs + lines.other + sellingFees;
    const netProfit = income - expensesTotal;
    const costOfSales = lines.stock + sellingFees;
    const grossProfit = income - costOfSales;
    const overheads = lines.postage + lines.packaging + lines.subs + lines.other;
    return { income, unitsSold, ...lines, sellingFees, expensesTotal, netProfit, costOfSales, grossProfit, overheads };
  }, [sales, purchases, range, feePct]);

  function exportCsv() {
    if (!report) return;
    const rows = [
      ["CompFinder P&L", range.label],
      ["Period", `${range.from} to ${range.to}`],
      ["Business type", businessType],
      [],
      ["Line", "Amount (£)"],
      ["Income (sales)", (report.income / 100).toFixed(2)],
      ["Cost of goods (stock)", (report.stock / 100).toFixed(2)],
      ["Selling fees (est.)", (report.sellingFees / 100).toFixed(2)],
      ["Postage", (report.postage / 100).toFixed(2)],
      ["Packaging & supplies", (report.packaging / 100).toFixed(2)],
      ["Subscriptions & fees", (report.subs / 100).toFixed(2)],
      ["Other expenses", (report.other / 100).toFixed(2)],
      ["Total expenses", (report.expensesTotal / 100).toFixed(2)],
      ["Net profit", (report.netProfit / 100).toFixed(2)]
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `compfinder-pnl-${range.label.replace("/", "-")}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (sales === null || !report) return <div className="panel"><span className="spinner" /> &nbsp;Loading accounts…</div>;

  const marginPct = report.income > 0 ? Math.round((report.netProfit / report.income) * 100) : null;

  const Row = ({ label, value, sub, strong, neg }) => (
    <div className={`pnl-row${strong ? " strong" : ""}`}>
      <span className="pnl-label">{label}{sub ? <span className="pnl-sub"> {sub}</span> : null}</span>
      <span className={`pnl-val${neg ? " neg" : ""}`}>{neg ? `(${pounds(value)})` : pounds(value)}</span>
    </div>
  );

  return (
    <div className="rise-group">
      <div className="ps-bar">
        <div className="pills" role="group" aria-label="Business type">
          {BUSINESS.map((b) => <button key={b.key} aria-pressed={businessType === b.key} onClick={() => saveBusiness(b.key)}>{b.label}</button>)}
        </div>
        <div className="ps-actions">
          <button className="btn btn-ghost" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn btn-ghost" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="inv-bar">
        <label className="inv-sort">Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="this_tax">This tax year</option>
            <option value="last_tax">Last tax year</option>
            <option value="this_cal">This calendar year</option>
            <option value="all">All time</option>
            <option value="custom">Custom…</option>
          </select>
        </label>
        {period === "custom" ? (
          <div className="inv-meta">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="hint-small">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        ) : (
          <div className="inv-meta"><span className="chip">{range.from} → {range.to}</span></div>
        )}
      </div>

      <div className="stat-row">
        <div className="stat"><div className="k">Income</div><div className="v">{pounds(report.income)}</div></div>
        <div className="stat"><div className="k">Expenses</div><div className="v">{pounds(report.expensesTotal)}</div></div>
        <div className="stat">
          <div className="k">Net profit</div>
          <div className="v" style={{ color: report.netProfit >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>{pounds(report.netProfit)}{marginPct != null ? ` (${marginPct}%)` : ""}</div>
        </div>
        <div className="stat"><div className="k">Items sold</div><div className="v">{report.unitsSold}</div></div>
      </div>

      <div className="panel pnl">
        <div className="print-title">Profit &amp; Loss — {range.label} ({range.from} to {range.to}) · {BUSINESS.find((b) => b.key === businessType)?.label}</div>

        {businessType === "hobbyist" ? (
          <>
            <div className="panel-head"><h3>Profit &amp; loss — {range.label}</h3></div>
            <div className="pnl-lines">
              <Row label="Money in (sales)" value={report.income} />
              <Row label="Money out (all costs)" value={report.expensesTotal} neg />
              <Row label="Profit" value={report.netProfit} strong />
            </div>
            <p className="hint hint-small">
              A simple in/out summary. If your total trading income in a tax year is under <b>£1,000</b>, the HMRC <b>trading allowance</b> usually means you don&apos;t need to report it. Over that, you may need to register for Self Assessment.
            </p>
          </>
        ) : businessType === "sole_trader" ? (
          <>
            <div className="panel-head"><h3>Self-employment summary — {range.label}</h3></div>
            <div className="pnl-lines">
              <Row label="Turnover (sales income)" value={report.income} strong />
              <div className="pnl-group">Allowable expenses</div>
              <Row label="Cost of stock bought" value={report.stock} neg />
              <Row label="Selling fees" sub="(eBay/marketplace, est.)" value={report.sellingFees} neg />
              <Row label="Postage" value={report.postage} neg />
              <Row label="Packaging &amp; supplies" value={report.packaging} neg />
              <Row label="Subscriptions &amp; fees" value={report.subs} neg />
              <Row label="Other expenses" value={report.other} neg />
              <Row label="Total allowable expenses" value={report.expensesTotal} neg />
              <Row label="Net profit" value={report.netProfit} strong />
            </div>
            <p className="hint hint-small">
              Cash-basis figures for <b>Self Assessment</b> (SA103 self-employment), UK tax year 6 Apr–5 Apr. Selling fees are estimated at {feePct}% of income. A summary to hand your accountant — not tax advice.
            </p>
          </>
        ) : (
          <>
            <div className="panel-head"><h3>Trading summary — {range.label}</h3></div>
            <div className="pnl-lines">
              <Row label="Turnover" value={report.income} strong />
              <div className="pnl-group">Cost of sales</div>
              <Row label="Stock / cost of goods" value={report.stock} neg />
              <Row label="Selling fees" sub="(est.)" value={report.sellingFees} neg />
              <Row label="Gross profit" value={report.grossProfit} strong />
              <div className="pnl-group">Administrative expenses</div>
              <Row label="Postage" value={report.postage} neg />
              <Row label="Packaging &amp; supplies" value={report.packaging} neg />
              <Row label="Subscriptions &amp; fees" value={report.subs} neg />
              <Row label="Other" value={report.other} neg />
              <Row label="Operating profit" value={report.netProfit} strong />
            </div>
            <p className="hint hint-small">
              A trading-account view for your <b>statutory accounts / CT600</b>. Set your accounting period with the Custom range if it isn&apos;t the tax year. Selling fees estimated at {feePct}% of income. A working summary, not a substitute for your accountant.
            </p>
          </>
        )}

        <label className="pnl-fee">
          Selling-fee estimate
          <input type="number" min="0" max="30" step="0.1" value={feePct} onChange={(e) => saveFee(Number(e.target.value))} /> % of sales income
        </label>
      </div>
    </div>
  );
}
