import { redirect } from "next/navigation";

export default function RootPage() {
  // middleware.js handles the auth check — an unauthenticated visitor gets
  // bounced to /login automatically, so this can redirect unconditionally.
  redirect("/panel");
}
