import LabInventory from "./LabInventory";

/** /panel/lab/inventory — the lab's stock as cards, copies underneath (docs/LISTING_STUDIO.md, C). */
export const metadata = { title: "Lab · inventory", robots: { index: false } };

export default function LabInventoryPage() {
  return <LabInventory />;
}
