import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformContext } from "../../src/platform/context";
import { ConversationRepository } from "../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../src/db/repositories/message-repository";
import { UserRepository } from "../../src/db/repositories/user-repository";
import { getConversationCostSummaries } from "../../src/analytics/cost";
import { getSessionUser } from "../../src/auth/session";
import { loginRedirectPath } from "../../src/auth/login-redirect";
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

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ channel?: string; view?: string; q?: string }> }) {
  const { db, tenant } = await getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect(await loginRedirectPath());

  const { channel, view, q } = await searchParams;
  const activeChannel = channel === "widget" || channel === "email" ? channel : "all";
  const slaOnly = view === "sla";
  const nowIso = now();
  const query = (q ?? "").trim().toLowerCase();

  const conversationRepo = new ConversationRepository(db, tenant);
  const allConversations = slaOnly ? conversationRepo.listSlaBreaching(nowIso) : conversationRepo.listByStates(["awaiting_human", "human_active"]);
  const channelFiltered = activeChannel === "all" ? allConversations : allConversations.filter((c) => c.channel === activeChannel);
  const costs = getConversationCostSummaries(
    db,
    tenant,
    channelFiltered.map((c) => c.id),
  );
  const previews = new MessageRepository(db, tenant).latestByConversationIds(channelFiltered.map((c) => c.id));
  const staffUsers = (await new UserRepository(db, tenant).list()).filter((u) => u.status === "active");

  const isBreaching = (c: { slaDueAt: string | null }) => Boolean(c.slaDueAt && c.slaDueAt < nowIso);

  // DA-01: the raw row list had no message preview or customer identity to
  // triage by, and SLA-breached conversations weren't surfaced above the
  // rest — you had to open every conversation to find out what it was about.
  // Search matches the conversation id, the last message text, and — for
  // email — the subject/sender captured in metadata at ensureConversation
  // time (widget conversations carry no customer identity to search on).
  const searched = query
    ? channelFiltered.filter((c) => {
        const subject = (c.metadata.subject as string | undefined) ?? "";
        const from = (c.metadata.from as string | undefined) ?? "";
        const preview = previews.get(c.id)?.content ?? "";
        return [c.id, subject, from, preview].some((field) => field.toLowerCase().includes(query));
      })
    : channelFiltered;
  const conversations = [...searched].sort((a, b) => Number(isBreaching(b)) - Number(isBreaching(a)));

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
          if (q) params.set("q", q);
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
            if (q) params.set("q", q);
            const qs = params.toString();
            return qs ? `/desk?${qs}` : "/desk";
          })()}
          className={`rounded-full border px-3 py-1 text-xs ${slaOnly ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg"}`}
        >
          SLA breaching
        </Link>
      </div>

      <form className="mt-3 flex gap-2" action="/desk">
        {activeChannel !== "all" && <input type="hidden" name="channel" value={activeChannel} />}
        {slaOnly && <input type="hidden" name="view" value="sla" />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by subject, sender, message, or conversation id…"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
        />
        <button type="submit" className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-fg hover:bg-bg">
          Search
        </button>
      </form>

      {conversations.length === 0 ? (
        <p className="mt-8 text-sm text-muted">
          {query ? `No conversations match "${q}".` : slaOnly ? "No conversations are currently breaching their SLA." : "Nothing needs attention right now."}
        </p>
      ) : (
        <Card className="mt-6 divide-y divide-border overflow-hidden p-0">
          {conversations.map((c) => {
            const cost = costs.get(c.id);
            const suggested = suggestAssignees(c.tags, staffUsers)[0];
            const subject = c.metadata.subject as string | undefined;
            const from = c.metadata.from as string | undefined;
            const preview = previews.get(c.id)?.content;
            // Email conversations carry a subject/sender; widget conversations
            // are anonymous unless a tool captured an identity mid-conversation
            // (not modeled yet) — fall back to the last message so there's
            // still something to triage by besides the raw id.
            const headline = subject || preview || "(no messages yet)";
            const identity = from ?? (c.channel === "widget" ? "Anonymous visitor" : null);
            return (
              <Link key={c.id} href={`/desk/${c.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-bg">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
                    <span className="truncate">{headline}</span>
                    <Badge>{c.channel}</Badge>
                    {c.priority !== "normal" && <Badge>{c.priority}</Badge>}
                    {slaBadge(c, nowIso)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {identity && <span className="text-fg/80">{identity} · </span>}
                    {c.state} · updated {new Date(c.updatedAt).toLocaleString()}
                    {suggested && <span className="ml-1 text-accent">· suggested: {suggested.email}</span>}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted/70">#{c.id.replace(/^CONV-/, "").slice(0, 8)}</p>
                </div>
                <div className="shrink-0 pl-4 text-right text-xs text-muted">
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
