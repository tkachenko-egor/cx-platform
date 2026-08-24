import { getPlatformContext } from "../../../../../src/platform/context";
import { ConversationRepository } from "../../../../../src/db/repositories/conversation-repository";
import { RunRepository } from "../../../../../src/db/repositories/run-repository";
import { ToolDefRepository, ToolCallRepository } from "../../../../../src/db/repositories/tool-repository";
import { LlmCallRepository } from "../../../../../src/db/repositories/llm-call-repository";
import { requireRole, AuthError } from "../../../../../src/auth/require-role";
import { runAgentTurn } from "../../../../../src/agents/runtime";
import type { AgentDef, AgentNativeToolsConfig, AgentPersonaConfig, AgentLanguageConfig, AgentEscalationConfig, AgentConversationConfig } from "../../../../../src/db/repositories/agent-def-repository";
import type { ChatMessage } from "../../../../../src/gateway/types";

// better-sqlite3 needs the Node runtime, not edge.
export const runtime = "nodejs";

interface PreviewDraft {
  key?: string;
  displayName?: string;
  systemPrompt: string;
  modelAlias: string;
  toolIds: string[];
  guardrails?: Record<string, unknown>;
  kbScope?: Record<string, unknown>;
  nativeTools?: AgentNativeToolsConfig;
  skills?: string[];
  temperature?: number | null;
  maxOutputTokens?: number | null;
  persona?: AgentPersonaConfig;
  languageConfig?: AgentLanguageConfig;
  escalationConfig?: AgentEscalationConfig;
  conversationConfig?: AgentConversationConfig;
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Live-preview "test as you build" endpoint (agent-creation redesign): runs
 * a draft agent config — never a persisted agent_defs row — through the
 * real runAgentTurn loop so the builder's right-hand chat pane reflects
 * unsaved edits immediately, matching OpenAI's GPT Builder / Chatbase's
 * Playground pattern. Deliberately NOT reusing processInboundTurn: no
 * router/handoff/SLA/review-queue machinery applies to a one-agent test
 * conversation, and none of those side effects should exist for a draft.
 *
 * Conversation channel is 'test_harness' (an existing, previously-unused
 * ConversationChannel value) purely so it never surfaces in the desk inbox
 * or pollutes analytics — see the EXCLUDE_PREVIEW_RUNS filters added
 * alongside this route in src/analytics/agent-performance.ts and
 * kb-retrieval-log-repository.ts. It still needs a real `conversations` +
 * `runs` row because kb_retrieval_log/llm_calls have FK constraints on
 * conversation_id/run_id (foreign_keys = ON) — those two rows are the only
 * persistence this endpoint creates.
 *
 * Write-flagged tools are silently dropped from the toolset the model even
 * sees (never executed) — a preview click should never be able to enqueue a
 * real tool_approvals row or mutate tenant data; test writes in a real
 * conversation instead.
 */
export async function POST(req: Request) {
  let body: { conversationId?: string; message?: string; history?: ChatMessage[]; draft?: PreviewDraft };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  if (message.length > 2000) return Response.json({ error: "message exceeds the 2000 character limit" }, { status: 400 });
  if (!body.draft?.systemPrompt || !body.draft?.modelAlias) return Response.json({ error: "draft.systemPrompt and draft.modelAlias are required" }, { status: 400 });

  const { db, tenant, gateway, embeddings } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const draft = body.draft;
  const agentKey = draft.key && draft.key.trim() ? draft.key.trim() : "__preview__";

  const conversations = new ConversationRepository(db, tenant);
  const conversationId = body.conversationId ?? conversations.create({ channel: "test_harness", agentKey, metadata: { preview: true } }).id;

  const toolDefs = new ToolDefRepository(db, tenant);
  let droppedWriteTools = 0;
  const safeToolIds = draft.toolIds.filter((id) => {
    const def = toolDefs.getByKey(id);
    if (!def) return false;
    if (def.writeFlag) {
      droppedWriteTools++;
      return false;
    }
    return true;
  });

  const agent: AgentDef = {
    id: "preview",
    tenantId: tenant.tenantId,
    key: agentKey,
    version: 0,
    status: "draft",
    systemPrompt: draft.systemPrompt,
    modelAlias: draft.modelAlias,
    toolIds: safeToolIds,
    kbScope: draft.kbScope ?? {},
    handoffTargets: [],
    guardrails: draft.guardrails ?? {},
    skills: draft.skills ?? [],
    semanticCacheEnabled: false,
    nativeTools: draft.nativeTools ?? {},
    quickReplies: [],
    displayName: draft.displayName ?? "",
    avatarUrl: null,
    internalDescription: "",
    ownerUserId: null,
    tags: [],
    agentStatus: "active",
    // Preview always simulates writes regardless of the draft's own environment
    // setting — write tools are dropped from the toolset entirely above, so
    // this only matters if that ever changes.
    environment: "sandbox",
    changeNotes: "",
    temperature: draft.temperature ?? null,
    maxOutputTokens: draft.maxOutputTokens ?? null,
    costCeilingUsd: null,
    persona: draft.persona ?? {},
    languageConfig: draft.languageConfig ?? {},
    escalationConfig: draft.escalationConfig ?? {},
    conversationConfig: draft.conversationConfig ?? {},
    // Preview always runs on the internal test_harness channel regardless of
    // the draft's own enabledChannels setting — nothing to gate here.
    enabledChannels: [],
    // Business-hours gating isn't part of the preview turn loop (see turn.ts vs. runtime.ts) — irrelevant here either way.
    businessHours: null,
  };

  const runs = new RunRepository(db, tenant);
  const run = runs.start({ conversationId, agentKey, agentVersion: 0, trigger: "preview" });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sseEvent(data)));
      send({ type: "meta", conversationId });

      try {
        const result = await runAgentTurn(
          { db, gateway, embeddings },
          tenant,
          conversationId,
          run.id,
          agent,
          body.history ?? [],
          message,
          {
            onTextDelta: (delta) => send({ type: "text", delta }),
            onToolStart: (name) => send({ type: "tool_start", name }),
          },
          undefined,
          tenant.name,
        );
        runs.complete(run.id, "completed");

        // Milestone 6: surface what this turn actually cost/did — pulled from
        // the same llm_calls/tool_calls rows the real cost-tracking/tracing
        // path writes (runAgentTurn -> LlmCallRepository.record/ToolCallRepository.record),
        // just read back immediately instead of only ever being queried from analytics.
        const llmCalls = new LlmCallRepository(db, tenant).listByRun(run.id);
        const usage = llmCalls.reduce(
          (acc, c) => ({
            promptTokens: acc.promptTokens + c.promptTokens,
            completionTokens: acc.completionTokens + c.completionTokens,
            cachedTokens: acc.cachedTokens + c.cachedTokens,
            costUsd: acc.costUsd + c.costUsd,
          }),
          { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 },
        );
        const toolCalls = new ToolCallRepository(db, tenant)
          .listByRun(run.id)
          .map((c) => ({ toolKey: c.toolKey, status: c.status, latencyMs: c.latencyMs }));

        send({
          type: "done",
          cards: result.cards ?? [],
          citableDocs: result.citableDocs,
          escalate: result.escalate,
          escalationReasons: result.escalationReasons,
          history: result.updatedHistory,
          droppedWriteTools,
          usage,
          toolCalls,
        });
      } catch (err) {
        runs.complete(run.id, "failed");
        const detail = err instanceof Error ? err.message : String(err);
        send({ type: "error", message: "The preview run hit an error — check the model/tool configuration.", detail });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
