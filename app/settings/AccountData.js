"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pagedSelect } from "@/lib/pagedSelect";

/**
 * Account & data controls — profile info, export everything to JSON, and
 * permanent account deletion.
 */
export default function AccountData({ email }) {
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [msg, setMsg] = useState("");

  async function exportData() {
    setExporting(true);
    setMsg("");
    try {
      const sb = createClient();
      const {
        data: { user }
      } = await sb.auth.getUser();
      const { data: profile } = await sb.from("profiles").select("settings,created_at").eq("id", user.id).single();
      const [priceChecks, listings, costs, sales, stacks, stackCards] = await Promise.all([
        pagedSelect(() => sb.from("price_checks").select("*")),
        pagedSelect(() => sb.from("ebay_listings").select("*")),
        pagedSelect(() => sb.from("listing_costs").select("*")),
        pagedSelect(() => sb.from("ebay_sales").select("*")),
        pagedSelect(() => sb.from("card_stacks").select("*")),
        pagedSelect(() => sb.from("stack_cards").select("*"))
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        account: { email, createdAt: profile?.created_at || null },
        settings: profile?.settings || {},
        priceChecks,
        listings,
        costs,
        sales,
        stacks,
        stackCards
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "compfinder-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg(e.message || "Export failed.");
    }
    setExporting(false);
  }

  async function deleteAccount() {
    if (confirmText !== "DELETE") return;
    if (!confirm("Permanently delete your account and ALL your data? This cannot be undone.")) return;
    setDeleting(true);
    setMsg("");
    try {
      const res = await fetch("/api/account/delete", { method: "POST" }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "Delete failed.");
      await createClient().auth.signOut();
      window.location.href = "/";
    } catch (e) {
      setMsg(e.message || "Delete failed.");
      setDeleting(false);
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 480, marginTop: 20 }}>
      <div className="panel-head"><span className="eyebrow">Account &amp; data</span></div>

      <p className="hint hint-small" style={{ marginTop: 0 }}>Signed in as <b>{email}</b>.</p>

      <button className="btn btn-ghost" onClick={exportData} disabled={exporting} style={{ marginTop: 6 }}>
        {exporting ? "Preparing…" : "⤓ Export my data (JSON)"}
      </button>

      <div className="danger-zone">
        <div className="eyebrow eyebrow-small" style={{ color: "var(--bad-ink)" }}>Danger zone</div>
        <p className="hint hint-small" style={{ marginTop: 4 }}>
          Delete your account and everything in it — listings cache, costs, sales, stacks and history. This can&apos;t be undone.
        </p>
        <div className="row" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE"
            style={{ border: "1px solid var(--line-strong)", borderRadius: 10, padding: "8px 12px", background: "var(--surface-2)", color: "var(--ink)", flex: 1, minWidth: 120 }}
          />
          <button className="btn" onClick={deleteAccount} disabled={deleting || confirmText !== "DELETE"} style={{ background: "var(--bad)", color: "#fff" }}>
            {deleting ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </div>

      {msg && <p className="auth-error" style={{ marginTop: 10 }}>{msg}</p>}
    </section>
  );
}
