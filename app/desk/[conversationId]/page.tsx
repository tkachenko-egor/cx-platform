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
import { loginRedirectPath } from "../../../src/auth/login-redirect";
import { Card } from "../../../components/ui/Card";
import { Badge } from "../../../components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function DeskConversationPage({ params }: PageProps<"/desk/[conversationId]">) {
  const { conversationId } = await params;
  const { db, tenant } = await getPlatformContext();

  const user = await getSessionUser(db, tenant);
  if (!user) redirect(await loginRedirectPath());

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
  const agentPath = (conversation.metadata.agentPath as string[] | undefined) ?? [];
  const handoffs = events
    .filter((e) => e.type === "handoff")
    .map((e) => e.payload as { from: string; to: string; reason: string; summary: string; extractedEntities: Record<string, string>; instructionsForReceivingAgent: string; sentiment?: "negative" | "neutral" });

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
      <Link href={`/desk/${conversationId}/replay`} className="mt-1 inline-block text-xs text-accent hover:underline">
        Replay →
      </Link>
      {agentPath.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          Agent path: {agentPath.map((key, i) => (
            <span key={`${key}-${i}`}>
              {i > 0 && " → "}
              <span className={key === conversation.currentAgentId && i === agentPath.length - 1 ? "font-medium text-fg" : ""}>{key}</span>
            </span>
          ))}
        </p>
      )}

      {handoffs.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-fg">Handoff context</h2>
          <div className="mt-3 space-y-2">
            {handoffs.map((h, i) => (
              <Card key={i} className="p-4 text-xs">
                <p className="flex items-center gap-2 text-fg">
                  {h.from} → {h.to}
                  {h.sentiment === "negative" && <Badge variant="danger">Negative sentiment</Badge>}
                </p>
                {h.reason && <p className="mt-1 text-muted">Reason: {h.reason}</p>}
                {h.summary && <p className="mt-1 text-muted">Summary: {h.summary}</p>}
                {h.extractedEntities && Object.keys(h.extractedEntities).length > 0 && (
                  <p className="mt-1 text-muted">
                    Known facts: {Object.entries(h.extractedEntities).map(([k, v]) => `${k}: ${v}`).join(", ")}
                  </p>
                )}
                {h.instructionsForReceivingAgent && <p className="mt-1 text-muted">Instructions: {h.instructionsForReceivingAgent}</p>}
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-fg">Transcript</h2>
        <Card className="mt-3 space-y-3 p-5">
          {messages.map((m) => (
            <div key={m.id} className={m.visibility === "internal" ? "opacity-60" : ""}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{m.role}</p>
              <p className="whitespace-pre-wrap text-sm text-fg">{m.content}</p>
            </div>
          ))}
        </Card>
      </section>

      <ApprovalsPanel conversationId={conversationId} approvals={pendingApprovals} />

      <DeskComposer conversationId={conversationId} />

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fg">Trace — why did it say that?</h2>
        <div className="mt-3 space-y-3">
          {trace.length === 0 && <p className="text-xs text-muted">No runs yet.</p>}
          {trace.map(({ run, llmCalls: calls, toolCalls: tCalls }) => (
            <Card key={run.id} className="p-4 text-xs">
              <details>
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
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
