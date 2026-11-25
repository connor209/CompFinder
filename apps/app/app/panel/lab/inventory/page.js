import Panel from "../../Panel";

/** /panel/lab/inventory — the lab's stock as cards, copies underneath (docs/LISTING_STUDIO.md, C). */
export const metadata = { title: "Lab · inventory", robots: { index: false } };

export default function LabInventoryPage() {
  return <Panel initialSection="lab/inventory" />;
}
