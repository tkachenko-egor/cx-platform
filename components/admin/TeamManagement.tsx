"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input, Select } from "../ui/Input";
import { Badge } from "../ui/Badge";

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
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <UserPlus size={16} className="text-muted" />
          <h2 className="text-sm font-semibold text-fg">Invite a teammate</h2>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Email" htmlFor="invite-email">
            <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="w-64" />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className="w-40">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={busy || !inviteEmail} onClick={sendInvite}>
            Send invite
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </Card>

      {invites.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-fg">Pending invites</h2>
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface shadow-sm">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between px-5 py-3.5 text-sm">
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
        <h2 className="text-sm font-semibold text-fg">Team</h2>
        <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface shadow-sm">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between px-5 py-3.5 text-sm">
              <div className="flex items-center gap-2">
                <p className="font-medium text-fg">{u.email}</p>
                {u.status === "disabled" && <Badge variant="danger">Disabled</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <Select value={u.role} disabled={busy || u.id === currentUserId} onChange={(e) => updateUser(u.id, { role: e.target.value as Role })} className="w-32 py-1.5 text-xs">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  disabled={busy || u.id === currentUserId}
                  onClick={() => updateUser(u.id, { status: u.status === "active" ? "disabled" : "active" })}
                  className="px-3 py-1.5 text-xs"
                >
                  {u.status === "active" ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
