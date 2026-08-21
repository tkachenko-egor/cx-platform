"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Role = "owner" | "admin" | "supervisor" | "agent" | "viewer";
const ROLES: Role[] = ["owner", "admin", "supervisor", "agent", "viewer"];

export interface TeamUserRow {
  id: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
}

export interface PendingInviteRow {
  id: string;
  email: string;
  role: Role;
  /** Pre-formatted server-side (not `new Date().toLocaleDateString()` here) — a client component computing that itself would hydrate with the browser's locale after the server rendered with its own, a real mismatch this codebase hit before. */
  expiresAtFormatted: string;
}

export function TeamManagement({ users, invites, currentUserId }: { users: TeamUserRow[]; invites: PendingInviteRow[]; currentUserId: string }) {
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("agent");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendInvite = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not send invite");
      setInviteEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateUser = async (id: string, patch: { role?: Role; status?: "active" | "disabled" }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update user");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">Invite a teammate</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Email</span>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-56 rounded border border-border bg-bg px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Role</span>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className="rounded border border-border bg-bg px-2 py-1">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy || !inviteEmail} onClick={sendInvite} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">
            Send invite
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>

      {invites.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-muted">Pending invites</h2>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-fg">{invite.email}</p>
                  <p className="text-xs text-muted">
                    {invite.role} · expires {invite.expiresAtFormatted}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium text-muted">Team</h2>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-fg">
                  {u.email} {u.status === "disabled" && <span className="text-xs text-danger">(disabled)</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={u.role}
                  disabled={busy || u.id === currentUserId}
                  onChange={(e) => updateUser(u.id, { role: e.target.value as Role })}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs disabled:opacity-50"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || u.id === currentUserId}
                  onClick={() => updateUser(u.id, { status: u.status === "active" ? "disabled" : "active" })}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg disabled:opacity-50"
                >
                  {u.status === "active" ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
