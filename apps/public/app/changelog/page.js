import { Crumb } from "../ui";
import { CHANGELOG } from "@/lib/changelog";

/**
 * A public record of what has changed, and what was wrong.
 *
 * Linked from the footer beside the privacy and affiliate pages, because it
 * belongs with them: all three are the site saying what it is doing and why.
 */

export const metadata = {
  title: "What's changed",
  description:
    "Every change to Last Comp, newest first — new features, and the things we got wrong and fixed.",
  alternates: { canonical: "/changelog" }
};

function when(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function ChangelogPage() {
  return (
    <main>
      <Crumb label="What&rsquo;s changed" />

      <div className="screen tight">
        <h1 className="hero-h" style={{ fontSize: 30, margin: "6px 0 8px" }}>What&rsquo;s changed</h1>
        <p className="body" style={{ margin: "0 0 6px", maxWidth: "46ch" }}>
          Newest first. The fixes are here as well as the features &mdash; if we get a price wrong, you
          should be able to find out that we did, and when we stopped.
        </p>

        {CHANGELOG.map((entry) => (
          <section className="panel" style={{ marginTop: 12 }} key={entry.date}>
            <p className="eyebrow soft" style={{ margin: "2px 0 8px" }}>
              <time dateTime={entry.date}>{when(entry.date)}</time>
            </p>
            <ul className="changelist">
              {entry.changes.map((c, i) => <li className="body" key={i}>{c}</li>)}
            </ul>
          </section>
        ))}

        <p className="body soft" style={{ marginTop: 20 }}>
          Prices come from real eBay UK sold listings, with the ones that would distort the answer taken out
          first. <a className="link" href="/">Price a card &rarr;</a>
        </p>
      </div>
    </main>
  );
}
