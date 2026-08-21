"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }

    const redirectTo = searchParams.get("redirectedFrom") || "/panel";
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">CF</span>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, margin: 0 }}>
            Comp&nbsp;Finder
          </h1>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ justifyContent: "center", marginTop: 4 }}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          No account yet? <a href="/signup">Create one</a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams() (used in LoginForm) must sit inside a Suspense
  // boundary, otherwise Next.js can't statically pre-render this page and
  // the production build fails. The fallback is null — the form paints
  // instantly on the client anyway.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
