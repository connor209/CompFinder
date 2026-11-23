import LabCopies from "./LabCopies";

/**
 * /panel/lab — the quantity-listing lab (docs/LAB_COPIES.md). Its own route
 * beside the panel's catch-all, behind the same login wall (middleware
 * protects every /panel path), and linked from no menu: it is a test bench
 * until the test says otherwise.
 */
export const metadata = { title: "Lab · quantity listings", robots: { index: false } };

export default function LabPage() {
  return <LabCopies />;
}
