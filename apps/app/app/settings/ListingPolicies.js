"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Pick which eBay Business Policies (shipping, payment, return) CompFinder-
 * created listings should use. Selection is saved to profiles.settings
 * .ebayPolicies and applied server-side to every listing. Falls back to inline
 * flat postage when nothing is selected. Needs the sell.account.readonly scope
 * — prompts a reconnect if the stored token predates it.
 */
export default function ListingPolicies({ initialSettings }) {
  const saved = initialSettings?.ebayPolicies || {};
  const [state, setState] = useState({ status: "loading" }); // loading|ok|scope|disconnected|error
  const [policies, setPolicies] = useState({ fulfillment: [], payment: [], return: [] });
  const [fulfillmentPolicyId, setFulfillment] = useState(saved.fulfillmentPolicyId || "");
  const [paymentPolicyId, setPayment] = useState(saved.paymentPolicyId || "");
  const [returnPolicyId, setReturn] = useState(saved.returnPolicyId || "");
  const [msg, setMsg] = useState("");
  const [savingState, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ebay/policies").then((r) => r.json());
        if (res.ok) { setPolicies(res.policies); setState({ status: "ok" }); }
        else if (res.scopeError) setState({ status: "scope" });
        else if (res.connected === false) setState({ status: "disconnected" });
        else setState({ status: "error", error: res.error });
      } catch {
        setState({ status: "error", error: "Couldn't reach eBay." });
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setMsg("");
    const nameOf = (list, id) => (list.find((p) => p.id === id) || {}).name || "";
    const ebayPolicies = fulfillmentPolicyId
      ? {
          fulfillmentPolicyId,
          fulfillmentName: nameOf(policies.fulfillment, fulfillmentPolicyId),
          paymentPolicyId: paymentPolicyId || null,
          paymentName: nameOf(policies.payment, paymentPolicyId),
          returnPolicyId: returnPolicyId || null,
          returnName: nameOf(policies.return, returnPolicyId)
        }
      : null;
    try {
      const sb = createClient();
      const {
        data: { user }
      } = await sb.auth.getUser();
      const { error } = await sb.from("profiles").update({ settings: { ...initialSettings, ebayPolicies } }).eq("id", user.id);
      if (error) throw new Error(error.message);
      setMsg(ebayPolicies ? "Saved — listings will use your selected policies." : "Saved — listings will use inline flat postage.");
    } catch (e) {
      setMsg(e.message || "Save failed.");
    }
    setSaving(false);
  }

  return (
    <section className="panel" style={{ maxWidth: 480, marginTop: 20 }}>
      <div className="panel-head"><span className="eyebrow">eBay listing policies</span></div>

      {state.status === "loading" ? (
        <p className="hint hint-small" style={{ marginTop: 0 }}><span className="spinner" /> &nbsp;Loading your eBay policies…</p>
      ) : state.status === "disconnected" ? (
        <p className="hint hint-small" style={{ marginTop: 0 }}>Connect your eBay account first to use business policies.</p>
      ) : state.status === "scope" ? (
        <div>
          <p className="hint hint-small" style={{ marginTop: 0 }}>
            Reading your business policies needs one extra permission added after your first connect.
          </p>
          <a className="btn btn-primary" href="/api/ebay/connect" style={{ marginTop: 6 }}>Reconnect eBay account →</a>
        </div>
      ) : state.status === "error" ? (
        <p className="compfinder-error" style={{ marginTop: 0 }}>{state.error || "Couldn't load policies."}</p>
      ) : policies.fulfillment.length === 0 ? (
        <p className="hint hint-small" style={{ marginTop: 0 }}>
          No business policies found on your eBay account. Opt in via eBay <b>Account settings → Business policies</b>, create a
          shipping/return/payment policy, then reload. Until then, listings use inline flat postage.
        </p>
      ) : (
        <>
          <p className="hint hint-small" style={{ marginTop: 0 }}>
            Choose the policies CompFinder listings should use. Leave shipping on “inline flat postage” to keep the current behaviour.
          </p>
          <label className="field" style={{ marginTop: 8 }}>
            <span>Shipping policy</span>
            <select value={fulfillmentPolicyId} onChange={(e) => setFulfillment(e.target.value)}>
              <option value="">Inline flat postage (default)</option>
              {policies.fulfillment.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field" style={{ marginTop: 8 }}>
            <span>Return policy</span>
            <select value={returnPolicyId} onChange={(e) => setReturn(e.target.value)} disabled={!fulfillmentPolicyId}>
              <option value="">Default</option>
              {policies.return.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field" style={{ marginTop: 8 }}>
            <span>Payment policy</span>
            <select value={paymentPolicyId} onChange={(e) => setPayment(e.target.value)} disabled={!fulfillmentPolicyId}>
              <option value="">Default</option>
              {policies.payment.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" onClick={save} disabled={savingState} style={{ marginTop: 12, justifyContent: "center" }}>
            {savingState ? "Saving…" : "Save policies"}
          </button>
          {msg ? <p className="hint hint-small" style={{ color: "var(--conf-high)", marginTop: 8 }}>{msg}</p> : null}
        </>
      )}
    </section>
  );
}
