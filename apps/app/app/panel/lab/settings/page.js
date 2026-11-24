import Panel from "../../Panel";

/** /panel/lab/settings — how lab listings are written (docs/LISTING_STUDIO.md, A and B). */
export const metadata = { title: "Lab · listing settings", robots: { index: false } };

export default function LabSettingsPage() {
  return <Panel initialSection="lab/settings" />;
}
