import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Landing from "./Landing";

export default async function RootPage() {
  // Logged-in visitors go straight to the app; everyone else sees the
  // public landing page. (/panel itself is still guarded by middleware.)
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user) redirect("/panel");
  return <Landing />;
}
