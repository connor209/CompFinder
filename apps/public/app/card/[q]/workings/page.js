import Workings from "./Workings";

export async function generateMetadata({ params }) {
  const { q } = await params;
  const query = decodeURIComponent(q || "");
  return { title: `${query} — the workings` };
}

export default async function WorkingsPage({ params }) {
  const { q } = await params;
  return <Workings query={decodeURIComponent(q || "")} />;
}
