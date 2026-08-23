import Workings from "./Workings";
import { windowFromParam } from "@/lib/windows";

export async function generateMetadata({ params }) {
  const { q } = await params;
  const query = decodeURIComponent(q || "");
  return { title: `${query} — the workings` };
}

export default async function WorkingsPage({ params, searchParams }) {
  const { q } = await params;
  // Whatever window the answer screen was showing — the workings exist to
  // explain that number, so they must count the same sales.
  const { days } = (await searchParams) || {};
  return <Workings query={decodeURIComponent(q || "")} days={windowFromParam(days)} />;
}
