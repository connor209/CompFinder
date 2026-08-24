import SearchField from "./SearchField";
import Splash from "./Splash";
import { Wordmark } from "./ui";

/**
 * Screen 1 — search.
 *
 * A server component apart from the field itself, so a crawler and a
 * first-time visitor on a phone get the whole pitch as HTML without waiting on
 * JavaScript. Only the one interactive control ships as a client bundle.
 */
export const metadata = {
  title: "Last Comp — found a card, what's it worth?"
};

// The mock's three, standing in until real popularity data is wired up. A
// visitor's own recent lookups replace them client-side the moment they have
// any (see SearchField).
const SEEDS = [
  { name: "Umbreon VMAX", q: "Umbreon VMAX 215 Evolving Skies", price: "£412" },
  { name: "Charizard ex", q: "Charizard ex 223 Obsidian Flames", price: "£259" },
  { name: "Magikarp", q: "Magikarp 203 Paldea Evolved", price: "£200" }
];

const POINTS = [
  ["Name and number is enough.", "We look the set up for you."],
  ["Junk comps thrown out.", "Graded slabs, bundles, overseas sellers, damaged cards."],
  ["You see the workings.", "Every sale we counted, and every one we didn't."]
];

export default function Home() {
  return (
    <main>
      <Splash />
      <div className="headblock search">
        <span className="wash" aria-hidden="true" />
        <span className="sheen" aria-hidden="true" />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* The splash measures this and travels the mark here rather than
              fading it out, so the brand lands where it lives. */}
          <Wordmark href={null} id="lc-header-mark" />
          <span style={{ flex: 1 }} />
          <a
            href={process.env.NEXT_PUBLIC_APP_URL || "#pro"}
            style={{ fontSize: 12.5, color: "var(--ink-soft)", textDecoration: "none" }}
          >Sign in</a>
        </div>
        <h1 className="hero-h">Found a card.<br />What&rsquo;s it worth?</h1>
        <p className="body" style={{ margin: "10px 0 0", maxWidth: "30ch" }}>
          Real eBay UK sold prices, and the cheapest one you could buy today.
        </p>
      </div>

      <div className="screen tight">
        <SearchField seeds={SEEDS} />

        <div className="points">
          {POINTS.map(([lead, rest], i) => (
            <div className="point" key={lead}>
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              <p><b>{lead}</b> {rest}</p>
            </div>
          ))}
        </div>

        <p className="micro foot" style={{ marginTop: 28 }}>
          Prices from real eBay UK sold listings. Card images from{" "}
          <a className="link" href="https://tcgdex.dev" rel="noopener noreferrer nofollow" target="_blank">TCGdex</a>.
          Not affiliated with eBay, Nintendo, Creatures or The Pok&eacute;mon Company.
          {" "}Some eBay links are affiliate links &mdash; we may earn a commission at no extra cost to you, and it
          never changes the prices shown.{" "}
          <a className="link" href="/privacy">Privacy</a> &middot;{" "}
          <a className="link" href="/privacy#affiliate">Affiliate disclosure</a>.
        </p>
      </div>
    </main>
  );
}
