import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPlatformContext } from "../../../src/platform/context";
import { ConversationRepository } from "../../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../../src/db/repositories/message-repository";
import { EventRepository } from "../../../src/db/repositories/event-repository";
import { RunRepository } from "../../../src/db/repositories/run-repository";
import { LlmCallRepository } from "../../../src/db/repositories/llm-call-repository";
import { ToolCallRepository } from "../../../src/db/repositories/tool-repository";
import { ToolApprovalRepository } from "../../../src/db/repositories/tool-approval-repository";
import { DeskComposer } from "../../../components/desk/DeskComposer";
import { ApprovalsPanel } from "../../../components/desk/ApprovalsPanel";
import { getSessionUser } from "../../../src/auth/session";

export const dynamic = "force-dynamic";

export default async function DeskConversationPage({ params }: PageProps<"/desk/[conversationId]">) {
  const { conversationId } = await params;
  const { db, tenant } = getPlatformContext();

  const user = await getSessionUser(db, tenant);
  if (!user) redirect("/login");

  const conversation = new ConversationRepository(db, tenant).get(conversationId);
  if (!conversation) notFound();

  const messages = new MessageRepository(db, tenant).listByConversation(conversationId, { includeInternal: true });
  const events = new EventRepository(db, tenant).listByConversation(conversationId);
  const runs = new RunRepository(db, tenant).listByConversation(conversationId);
  const llmCalls = new LlmCallRepository(db, tenant);
  const toolCalls = new ToolCallRepository(db, tenant);

  const trace = runs.map((run) => ({
    run,
    llmCalls: llmCalls.listByRun(run.id),
    toolCalls: toolCalls.listByRun(run.id),
  }));

  const escalationReasons = events.filter((e) => e.type === "escalated").flatMap((e) => (e.payload.reasons as string[] | undefined) ?? []);
  const pendingApprovals = new ToolApprovalRepository(db, tenant).listPendingByConversation(conversationId);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/desk" className="text-xs text-accent hover:underline">
        ← Human desk
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-fg">{conversationId}</h1>
      <p className="text-sm text-muted">
        State: <span className="font-medium text-fg">{conversation.state}</span>
        {escalationReasons.length > 0 && <> · Escalated for: {escalationReasons.join(", ")}</>}
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">Transcript</h2>
        <div className="mt-2 space-y-3 rounded-xl border border-border bg-surface p-4">
          {messages.map((m) => (
            <div key={m.id} className={m.visibility === "internal" ? "opacity-60" : ""}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{m.role}</p>
              <p className="whitespace-pre-wrap text-sm text-fg">{m.content}</p>
            </div>
          ))}
        </div>
      </section>

      <ApprovalsPanel conversationId={conversationId} approvals={pendingApprovals} />

      <DeskComposer conversationId={conversationId} />

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Trace — why did it say that?</h2>
        <div className="mt-2 space-y-3">
          {trace.length === 0 && <p className="text-xs text-muted">No runs yet.</p>}
          {trace.map(({ run, llmCalls: calls, toolCalls: tCalls }) => (
            <details key={run.id} className="rounded-xl border border-border bg-surface p-3 text-xs">
              <summary className="cursor-pointer text-fg">
                {run.trigger} · {run.status} · {run.agentKey} v{run.agentVersion}
              </summary>
              <div className="mt-2 space-y-2">
                {calls.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border p-2">
                    <p className="text-fg">
                      {c.provider}:{c.model} {c.fallbackUsed && "(fallback)"}
                    </p>
                    <p className="text-muted">
                      {c.promptTokens}+{c.completionTokens} tok · ${c.costUsd.toFixed(5)} · {c.latencyMs}ms {c.errorType && `· ${c.errorType}`}
                    </p>
                  </div>
                ))}
                {tCalls.map((t) => (
                  <div key={t.id} className="rounded-lg border border-border p-2">
                    <p className="text-fg">
                      tool: {t.toolKey} ({t.status})
                    </p>
                    <p className="text-muted">{t.latencyMs}ms</p>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
