"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <button type="button" onClick={signOut} className="text-xs text-muted hover:text-fg hover:underline">
      Sign out
    </button>
  );
}
