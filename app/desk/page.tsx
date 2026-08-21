import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformContext } from "../../src/platform/context";
import { ConversationRepository } from "../../src/db/repositories/conversation-repository";
import { UserRepository } from "../../src/db/repositories/user-repository";
import { getConversationCostSummaries } from "../../src/analytics/cost";
import { getSessionUser } from "../../src/auth/session";
import { SignOutButton } from "../../components/desk/SignOutButton";
import { now } from "../../src/core/clock";
import { suggestAssignees } from "../../src/desk/skill-match";
import type { ConversationChannel } from "../../src/core/types";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";

export const dynamic = "force-dynamic";

const CHANNEL_FILTERS: { label: string; value: ConversationChannel | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Widget", value: "widget" },
  { label: "Email", value: "email" },
];

function slaBadge(c: { priority: string; slaDueAt: string | null }, nowIso: string) {
  if (!c.slaDueAt) return null;
  const breaching = c.slaDueAt < nowIso;
  return <Badge variant={breaching ? "danger" : "neutral"}>{breaching ? "SLA breached" : `due ${new Date(c.slaDueAt).toLocaleTimeString()}`}</Badge>;
}

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ channel?: string; view?: string }> }) {
  const { db, tenant } = await getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect("/login");

  const { channel, view } = await searchParams;
  const activeChannel = channel === "widget" || channel === "email" ? channel : "all";
  const slaOnly = view === "sla";
  const nowIso = now();

  const conversationRepo = new ConversationRepository(db, tenant);
  const allConversations = slaOnly ? conversationRepo.listSlaBreaching(nowIso) : conversationRepo.listByStates(["awaiting_human", "human_active"]);
  const conversations = activeChannel === "all" ? allConversations : allConversations.filter((c) => c.channel === activeChannel);
  const costs = getConversationCostSummaries(
    db,
    tenant,
    conversations.map((c) => c.id),
  );
  const staffUsers = new UserRepository(db, tenant).list().filter((u) => u.status === "active");

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
      <p className="mt-1 flex gap-3 text-xs">
        <Link href="/desk/review-queue" className="text-accent hover:underline">
          Review queue →
        </Link>
        <Link href="/analytics" className="text-accent hover:underline">
          Analytics →
        </Link>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {CHANNEL_FILTERS.map((f) => {
          const params = new URLSearchParams();
          if (f.value !== "all") params.set("channel", f.value);
          if (slaOnly) params.set("view", "sla");
          const qs = params.toString();
          return (
            <Link
              key={f.value}
              href={qs ? `/desk?${qs}` : "/desk"}
              className={`rounded-full border px-3 py-1 text-xs ${activeChannel === f.value ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg"}`}
            >
              {f.label}
            </Link>
          );
        })}
        <span className="mx-1 h-4 w-px bg-border" />
        <Link
          href={(() => {
            const params = new URLSearchParams();
            if (activeChannel !== "all") params.set("channel", activeChannel);
            if (!slaOnly) params.set("view", "sla");
            const qs = params.toString();
            return qs ? `/desk?${qs}` : "/desk";
          })()}
          className={`rounded-full border px-3 py-1 text-xs ${slaOnly ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg"}`}
        >
          SLA breaching
        </Link>
      </div>

      {conversations.length === 0 ? (
        <p className="mt-8 text-sm text-muted">{slaOnly ? "No conversations are currently breaching their SLA." : "Nothing needs attention right now."}</p>
      ) : (
        <Card className="mt-6 divide-y divide-border overflow-hidden p-0">
          {conversations.map((c) => {
            const cost = costs.get(c.id);
            const suggested = suggestAssignees(c.tags, staffUsers)[0];
            return (
              <Link key={c.id} href={`/desk/${c.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-bg">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
                    {c.id}
                    <Badge>{c.channel}</Badge>
                    {c.priority !== "normal" && <Badge>{c.priority}</Badge>}
                    {slaBadge(c, nowIso)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {c.state} · updated {new Date(c.updatedAt).toLocaleString()}
                    {suggested && <span className="ml-1 text-accent">· suggested: {suggested.email}</span>}
                  </p>
                </div>
                <div className="text-right text-xs text-muted">
                  <p>{cost?.turnCount ?? 0} turn(s)</p>
                  <p>${(cost?.totalCostUsd ?? 0).toFixed(4)}</p>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </main>
  );
}
