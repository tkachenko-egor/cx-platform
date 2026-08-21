import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformContext } from "../../src/platform/context";
import { ConversationRepository } from "../../src/db/repositories/conversation-repository";
import { getConversationCostSummaries } from "../../src/analytics/cost";
import { getSessionUser } from "../../src/auth/session";
import { SignOutButton } from "../../components/desk/SignOutButton";
import type { ConversationChannel } from "../../src/core/types";

export const dynamic = "force-dynamic";

const CHANNEL_FILTERS: { label: string; value: ConversationChannel | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Widget", value: "widget" },
  { label: "Email", value: "email" },
];

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const { db, tenant } = getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect("/login");

  const { channel } = await searchParams;
  const activeChannel = channel === "widget" || channel === "email" ? channel : "all";

  const allConversations = new ConversationRepository(db, tenant).listByStates(["awaiting_human", "human_active"]);
  const conversations = activeChannel === "all" ? allConversations : allConversations.filter((c) => c.channel === activeChannel);
  const costs = getConversationCostSummaries(
    db,
    tenant,
    conversations.map((c) => c.id),
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Human desk</h1>
        <p className="flex items-center gap-2 text-xs text-muted">
          {user.email} · {user.role}
          <SignOutButton />
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">Conversations waiting on, or currently handled by, a colleague. Copilot mode — the bot drafts, you edit and send.</p>

      <div className="mt-4 flex gap-2">
        {CHANNEL_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/desk" : `/desk?channel=${f.value}`}
            className={`rounded-full border px-3 py-1 text-xs ${activeChannel === f.value ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {conversations.length === 0 ? (
        <p className="mt-8 text-sm text-muted">Nothing needs attention right now.</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface">
          {conversations.map((c) => {
            const cost = costs.get(c.id);
            return (
              <li key={c.id}>
                <Link href={`/desk/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-bg">
                  <div>
                    <p className="text-sm font-medium text-fg">
                      {c.id} <span className="ml-1 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted">{c.channel}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {c.state} · updated {new Date(c.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted">
                    <p>{cost?.turnCount ?? 0} turn(s)</p>
                    <p>${(cost?.totalCostUsd ?? 0).toFixed(4)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
