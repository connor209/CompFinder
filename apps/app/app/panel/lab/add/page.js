import LabAdd from "./LabAdd";

/** /panel/lab/add — load CardUploader exports, price and edit them, list them. */
export const metadata = { title: "Lab · add copies", robots: { index: false } };

export default function LabAddPage() {
  return <LabAdd />;
}
