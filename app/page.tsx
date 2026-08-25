import { redirect } from "next/navigation";

/** Phase 4 M6: the Phase-1 demo landing page (a hardcoded chat widget for a single tenant) is retired now that agents are built/deployed from the admin — root is the login entry point instead. */
export default function RootPage() {
  redirect("/login");
}
