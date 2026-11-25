import Panel from "../Panel";

/**
 * /panel/lab — the quantity-listing lab (docs/LAB_COPIES.md), in the panel
 * shell under the Lab module of the nav. Its own route beside the catch-all,
 * behind the same login wall (middleware protects every /panel path).
 */
export const metadata = { title: "Lab · quantity listings", robots: { index: false } };

export default function LabPage() {
  return <Panel initialSection="lab" />;
}
