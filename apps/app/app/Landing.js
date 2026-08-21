import Link from "next/link";

/**
 * Public landing page for logged-out visitors. Server component — pure markup,
 * styled by the .lp-* rules in globals.css. Product visuals are built from
 * CSS/SVG mocks (no external images) so the page is fast and theme-aware.
 */
const FEATURES = [
  {
    icon: "⚡",
    title: "Real sold comps, fast",
    body: "Recency-weighted prices from genuine eBay sold listings — not guesswork. UK-only or worldwide, your call."
  },
  {
    icon: "🏷️",
    title: "Your inventory, synced",
    body: "Connect eBay and pull in every active listing. Search, filter, condense duplicates, and see your portfolio value at a glance."
  },
  {
    icon: "💷",
    title: "Repricing intelligence",
    body: "Market price vs your ask on any listing — instantly spot what's overpriced or leaving money on the table."
  },
  {
    icon: "📈",
    title: "Deep-dive any card",
    body: "An interactive price-trend chart, set and rarity details, and every recent sale with a direct link to the listing."
  },
  {
    icon: "📷",
    title: "Snap to identify",
    body: "On mobile, point your camera at a card and let AI fill in the search. Confirm, and you're pricing in seconds."
  },
  {
    icon: "🌐",
    title: "Batch & any language",
    body: "Price a whole pile at once or import a CSV — and toggle Japanese, Korean or Chinese prints when you need them."
  }
];

const PROBLEMS = [
  { q: "“Am I about to undersell?”", a: "Check the true, recent market before you list — recency-weighted so a stale old sale can't drag your price down." },
  { q: "“Have I already got this listed?”", a: "CompFinder flags the card against your own live eBay listings the moment you look it up." },
  { q: "“What's my inventory actually worth?”", a: "Total value, unique cards, and duplicate spotting across everything you have listed." },
  { q: "“Is this priced right, right now?”", a: "See asking prices next to recent sold so you know if the market's firming or softening before you commit." }
];

const STEPS = [
  { n: "1", t: "Search or snap", d: "Type a card, paste a pile, or photograph one with your phone." },
  { n: "2", t: "We pull real sold comps", d: "Genuine eBay sold data, filtered and recency-weighted for you." },
  { n: "3", t: "Get a price + market read", d: "A recommended price, confidence, trend, and how it compares to what's listed now." }
];

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-brand">
          <span className="brand-mark">CF</span>
          <span className="lp-brand-name">CompFinder</span>
        </div>
        <nav className="lp-nav-actions">
          <Link href="/login" className="lp-link">Sign in</Link>
          <Link href="/signup" className="btn btn-primary">Get started</Link>
        </nav>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-eyebrow">Sold-comp pricing for resellers</span>
          <h1 className="lp-title">Know what your cards are <span className="lp-holo">actually worth</span>.</h1>
          <p className="lp-sub">
            CompFinder turns real eBay sold data into instant, recency-weighted prices — then checks it against your own
            live listings. Price faster, list smarter, and never undersell again.
          </p>
          <div className="lp-cta">
            <Link href="/signup" className="btn btn-primary lp-cta-main">Start pricing free →</Link>
            <Link href="/login" className="btn btn-ghost">I already have an account</Link>
          </div>
          <p className="lp-fineprint">Bring your own SoldComps key · works on desktop &amp; mobile · cards or anything you resell.</p>
        </div>

        <div className="lp-hero-art" aria-hidden="true">
          <div className="lp-mock lp-mock-main">
            <div className="lp-mock-top">
              <span className="lp-mock-set">Base Set · Holo Rare</span>
              <span className="lp-pill lp-pill-high">High confidence</span>
            </div>
            <div className="lp-mock-name">Charizard</div>
            <div className="lp-mock-badges"><span>#4/102</span><span>Wizards</span></div>
            <div className="lp-mock-price"><span className="cur">£</span>312<span className="dec">.00</span></div>
            <svg className="lp-spark" viewBox="0 0 320 90" preserveAspectRatio="none">
              <defs>
                <linearGradient id="lpg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 70 L40 64 L80 66 L120 50 L160 54 L200 38 L240 30 L280 22 L320 14 L320 90 L0 90 Z" fill="url(#lpg)" />
              <path d="M0 70 L40 64 L80 66 L120 50 L160 54 L200 38 L240 30 L280 22 L320 14" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="320" cy="14" r="4" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2.5" />
            </svg>
            <div className="lp-mock-sales">
              <div className="lp-sale"><span>£305.00</span><span className="lp-sale-d">2 days ago</span></div>
              <div className="lp-sale"><span>£318.50</span><span className="lp-sale-d">5 days ago</span></div>
            </div>
          </div>

          <div className="lp-mock lp-mock-badge">
            <span className="lp-warn">⚠</span>
            <div>
              <strong>Already listed</strong>
              <span>You have this up at £289.99</span>
            </div>
          </div>

          <div className="lp-mock lp-mock-stat">
            <span className="lp-stat-k">Inventory value</span>
            <span className="lp-stat-v">£8,420</span>
            <span className="lp-stat-sub">312 active · 174 unique</span>
          </div>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Everything in one place</span>
          <h2>From “what's it worth?” to “it's listed right.”</h2>
        </div>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <div className="lp-feature" key={f.title}>
              <span className="lp-feature-ic" aria-hidden="true">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section lp-problems-wrap">
        <div className="lp-section-head">
          <span className="lp-eyebrow">The questions every reseller asks</span>
          <h2>CompFinder answers them in seconds.</h2>
        </div>
        <div className="lp-problems">
          {PROBLEMS.map((p) => (
            <div className="lp-problem" key={p.q}>
              <div className="lp-problem-q">{p.q}</div>
              <div className="lp-problem-a">{p.a}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">How it works</span>
          <h2>Three steps, start to price.</h2>
        </div>
        <div className="lp-steps">
          {STEPS.map((s) => (
            <div className="lp-step" key={s.n}>
              <span className="lp-step-n">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <h2>Stop guessing. Start pricing.</h2>
        <p>Real sold data, your live inventory, and a recommended price — in the time it takes to type a card name.</p>
        <Link href="/signup" className="btn btn-primary lp-cta-main">Get started free →</Link>
      </section>

      <footer className="lp-footer">
        <div className="lp-brand">
          <span className="brand-mark">CF</span>
          <span className="lp-brand-name">CompFinder</span>
        </div>
        <div className="lp-footer-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Get started</Link>
        </div>
        <span className="lp-copy">© {new Date().getFullYear()} CompFinder</span>
      </footer>
    </div>
  );
}
