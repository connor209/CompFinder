import Workings from "./Workings";
import { windowFromParam } from "@/lib/windows";
import { NOT_FOR_INDEX } from "@/lib/card-page";

/**
 * NEVER FOR THE INDEX, on any card, published or not — the same rule as an
 * unpublished card page and for the same reason. This screen runs entirely on
 * the client, so what leaves the server is a spinner: it cannot rank on
 * content it doesn't serve, and 455 of them can only dilute the pages that do.
 * It is a screen for someone who has already got an answer and wants to see
 * the arithmetic, reached by a link from that answer — which is what `follow`
 * is for. It has never been in the sitemap; this is the page itself finally
 * saying the same thing.
 */
export async function generateMetadata({ params }) {
  const { q } = await params;
  const query = decodeURIComponent(q || "");
  return { title: `${query} — the workings`, robots: NOT_FOR_INDEX };
}

export default async function WorkingsPage({ params, searchParams }) {
  const { q } = await params;
  // Whatever window the answer screen was showing — the workings exist to
  // explain that number, so they must count the same sales.
  const { days } = (await searchParams) || {};
  return <Workings query={decodeURIComponent(q || "")} days={windowFromParam(days)} />;
}
