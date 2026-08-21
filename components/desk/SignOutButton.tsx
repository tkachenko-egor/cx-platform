"use client";

import { useRouter } from "next/navigation";

/** endpoint/redirectTo default to the tenant-scoped logout; platform-admin pages pass the platform-admin variants (see app/platform-admin/tenants/page.tsx). */
export function SignOutButton({
  endpoint = "/api/auth/logout",
  redirectTo = "/login",
  className = "text-xs text-muted hover:text-fg hover:underline",
}: { endpoint?: string; redirectTo?: string; className?: string } = {}) {
  const router = useRouter();

  const signOut = async () => {
    await fetch(endpoint, { method: "POST" });
    router.push(redirectTo);
    router.refresh();
  };

  return (
    <button type="button" onClick={signOut} className={className}>
      Sign out
    </button>
  );
}
