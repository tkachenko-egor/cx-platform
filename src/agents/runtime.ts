import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../gateway/embeddings/types";
import { ModelGateway } from "../gateway/gateway";
import type { ChatMessage, ChatRequest, NativeToolConfig } from "../gateway/types";
import type { AgentDef } from "../db/repositories/agent-def-repository";
import { KbCollectionRepository } from "../db/repositories/kb-collection-repository";
import type { TenantContext } from "../tenancy/context";
import { today } from "../core/clock";
import { hybridSearch, type KbScope, type RetrievedChunk } from "../kb/retrieval";
import { getRerankProvider } from "../gateway/rerank";
import { lookupCache, writeCache } from "../kb/semantic-cache";
import { knowledgeBlock, sessionBlock, handoffBlock, renderTemplate, personaBlock, languageBlock, scopeBlock } from "./system-prompt";
import { scanForHumanRequest, scanForNegativeSentiment, scanForReactionMention, scanForSevereSymptoms } from "./escalation";
import { getOrCreateSession } from "./sessions-store";
import { executeTool, toGatewayToolDefinitions } from "../tools/registry";
import type { AgentGuardrailConfig } from "../guardrails/types";
import { checkUserInputGuardrails, checkRetrievedChunkGuardrails, checkOutputGuardrails } from "../guardrails/runner";
import { analyzePii, type PiiSpan } from "../guardrails/presidio";
import { HANDOFF_TOOL_NAME, handoffToolDefinition, parseHandoffPackage, type HandoffPackage } from "./handoff";
import { KbRetrievalLogRepository } from "../db/repositories/kb-retrieval-log-repository";
import { LlmCallRepository } from "../db/repositories/llm-call-repository";
import { DEFAULT_LOW_CONFIDENCE_THRESHOLD } from "../analytics/coverage";

export interface RuntimeDeps {
  db: Database.Database;
  gateway: ModelGateway;
  embeddings: EmbeddingProvider;
}

export type EscalationReason =
  | "severe_symptom"
  | "reaction_mention"
  | "human_request"
  | "eligible_return"
  | "loop_cap"
  | "approval_requested"
  | "guardrail_blocked"
  | "handoff_cycle_detected"
  | "negative_sentiment"
  | "cost_ceiling_exceeded"
  | "target_agent_unavailable"
  | "low_kb_confidence_escalation"
  | "n_failed_attempts";

export interface AgentTurnResult {
  assistantText: string;
  cards: unknown[];
  /** FR-7.8: the docs retrieved this turn, so the UI can resolve [doc_id] markers to titles/links without a DB round trip. */
  citableDocs: { docId: string; title: string }[];
  escalate: boolean;
  escalationReasons: EscalationReason[];
  loopCapHit: boolean;
  guardrailBlocked: boolean;
  guardrailReasons: string[];
  /** Set when this specialist called handoff_to_agent mid-turn instead of finishing the reply itself (FR-6.7). */
  handoffRequested?: { target: string; package: HandoffPackage };
  /** Phase 2 M5: true when this turn's best retrieval score was below the coverage-gap threshold — a candidate for the human review queue even on a non-escalating turn. Always false on a cache hit or blocked turn (no fresh retrieval happened). */
  lowKbConfidence: boolean;
  updatedHistory: ChatMessage[];
}

export interface AgentTurnCallbacks {
  onTextDelta?: (chunk: string) => void;
  onToolStart?: (name: string) => void;
}

const ROUND_CAP = 8;
const MAX_OUTPUT_TOKENS = 1024;
const KB_TOP_K = 5;

/**
 * The tool-calling loop: a round cap, tool execution, and tool_result
 * feedback, built on the model gateway, tool registry and hybrid
 * retrieval rather than a raw provider client, a hardcoded switch, and
 * full-corpus injection.
 */
export async function runAgentTurn(
  deps: RuntimeDeps,
  tenant: TenantContext,
  conversationId: string,
  runId: string,
  agent: AgentDef,
  history: ChatMessage[],
  userText: string,
  callbacks: AgentTurnCallbacks = {},
  handoffContext?: HandoffPackage,
  tenantName = "",
): Promise<AgentTurnResult> {
  const messages: ChatMessage[] = [...history, { role: "user", content: userText }];
  const guardrailConfig = (agent.guardrails as AgentGuardrailConfig | undefined) ?? {};
  const fallbackMessage = agent.persona.cannedMessages?.default?.fallback || "I'm not able to help with that request.";

  // Phase 7 M2: a per-conversation spend cap — checked once at the start of
  // the turn (not mid-loop), so a turn already in progress is allowed to
  // finish rather than being cut off partway through.
  if (agent.costCeilingUsd != null) {
    const spentSoFar = new LlmCallRepository(deps.db, tenant).sumCostForConversation(conversationId);
    if (spentSoFar >= agent.costCeilingUsd) {
      const overBudget = "Let me get a colleague to take it from here.";
      return {
        assistantText: overBudget,
        cards: [],
        citableDocs: [],
        escalate: true,
        escalationReasons: ["cost_ceiling_exceeded"],
        loopCapHit: false,
        guardrailBlocked: false,
        guardrailReasons: [],
        lowKbConfidence: false,
        updatedHistory: [...messages, { role: "assistant", content: overBudget }],
      };
    }
  }

  // FR-6.13: cheap, deterministic, and worth failing fast on before spending
  // a retrieval call or a model turn.
  const userInputGuardrail = checkUserInputGuardrails(guardrailConfig, userText);
  if (userInputGuardrail.blocked) {
    return {
      assistantText: fallbackMessage,
      cards: [],
      citableDocs: [],
      escalate: true,
      escalationReasons: ["guardrail_blocked"],
      loopCapHit: false,
      guardrailBlocked: true,
      guardrailReasons: userInputGuardrail.reasons,
      lowKbConfidence: false,
      updatedHistory: [...messages, { role: "assistant", content: fallbackMessage }],
    };
  }

  const severe = scanForSevereSymptoms(userText, agent.escalationConfig.severeSymptomKeywords);
  const humanRequest = scanForHumanRequest(userText, agent.escalationConfig.humanRequestKeywords);
  const reactionMention = scanForReactionMention(userText, agent.escalationConfig.reactionKeywords);
  const sentiment = scanForNegativeSentiment(userText, agent.escalationConfig.negativeSentimentKeywords);
  const convoSession = getOrCreateSession(conversationId);

  // Phase 2 M3b: skip the cache lookup entirely (not just the write) for
  // anything the deterministic scanners already flagged — a severe-symptom
  // or explicit-human-request message deserves a freshly reasoned reply,
  // not a similar-but-not-identical cached one.
  const deterministicSignalHit = severe.hit || humanRequest.hit || reactionMention.hit || sentiment.hit;
  const cacheHit = agent.semanticCacheEnabled && !deterministicSignalHit ? await lookupCache(deps.db, tenant, agent.key, userText, deps.embeddings) : undefined;

  const cards: unknown[] = [];
  const toolResultTexts: string[] = [];
  let round = 0;
  let finalText = "";
  let approvalRequested = false;
  const genericEscalationReasons: EscalationReason[] = [];
  let handoffRequested: { target: string; package: HandoffPackage } | undefined;
  let retrieved: RetrievedChunk[] = [];
  let citableDocs: { docId: string; title: string }[] = [];
  let lowKbConfidence = false;

  // Output guardrails need the complete reply, but text streams live —
  // blockingMode buffers it all and releases at once once the check
  // passes; the default forwards deltas live and only flags/escalates
  // after the fact (the message already reached the customer by then).
  const blockingMode = guardrailConfig.output?.blockingMode === true;
  const bufferedDeltas: string[] = [];
  const forwardDelta = (delta: string) => {
    finalText += delta;
    if (blockingMode) bufferedDeltas.push(delta);
    else callbacks.onTextDelta?.(delta);
  };

  if (cacheHit) {
    finalText = cacheHit.responseText;
    citableDocs = cacheHit.citableDocs;
    messages.push({ role: "assistant", content: finalText });
    if (blockingMode) bufferedDeltas.push(finalText);
    else callbacks.onTextDelta?.(finalText);
  } else {
    const kbScope = (agent.kbScope as KbScope | undefined) ?? { audience: ["customer"] };
    // A1: rerank is opt-in per agent (kbScope.rerank) and needs a configured
    // sidecar (RERANKER_URL) — absent either, hybridSearch keeps today's
    // rank-only fusion. rerankRan reflects whether it actually reordered.
    let rerankRan = false;
    retrieved = await hybridSearch(deps.db, tenant, kbScope, userText, KB_TOP_K, deps.embeddings, {
      reranker: kbScope.rerank?.enabled ? getRerankProvider() : undefined,
      onRerankRan: (ran) => {
        rerankRan = ran;
      },
    });

    // Coverage-gap reporting (Phase 2 M3a): logged regardless of whether
    // this turn goes on to escalate — a low-confidence retrieval the model
    // papers over with a plausible-sounding answer should still surface.
    const bestScore = retrieved[0]?.score ?? 0;
    lowKbConfidence = bestScore < DEFAULT_LOW_CONFIDENCE_THRESHOLD;
    // Phase 8 M1: opt-in — the unconditional lowKbConfidence flag above only
    // ever enqueues a review-queue item (Phase 2 M5), never escalates. This
    // is a separate, agent-configured "actually hand off now" behavior.
    if (agent.escalationConfig.escalateOnLowConfidence && bestScore < (agent.escalationConfig.confidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD)) {
      genericEscalationReasons.push("low_kb_confidence_escalation");
    }
    new KbRetrievalLogRepository(deps.db, tenant).record({
      conversationId,
      runId,
      queryText: userText,
      bestScore,
      retrievedDocIds: retrieved.map((r) => r.article.docId),
      reranked: rerankRan,
    });

    // FR-7.13: retrieved content is untrusted — a poisoned KB article is a
    // real attack, screened the same way the user's own message just was.
    const chunkGuardrail = checkRetrievedChunkGuardrails(
      guardrailConfig,
      retrieved.map((r) => ({ docId: r.article.docId, text: r.chunk.text })),
    );
    if (chunkGuardrail.blocked) {
      const fallback = "I'm having trouble finding a reliable answer to that right now — let me get a colleague to help.";
      return {
        assistantText: fallback,
        cards: [],
        citableDocs: [],
        escalate: true,
        escalationReasons: ["guardrail_blocked"],
        loopCapHit: false,
        guardrailBlocked: true,
        guardrailReasons: chunkGuardrail.reasons,
        lowKbConfidence: false,
        updatedHistory: [...messages, { role: "assistant", content: fallback }],
      };
    }

    const knowledge = knowledgeBlock(retrieved.map((r) => ({ docId: r.article.docId, title: r.article.title, effective: r.article.effective, text: r.chunk.text })));
    const session = sessionBlock({ today: today(), severeSymptomSignal: severe.hit });
    const handoff = handoffContext ? handoffBlock(handoffContext) : null;
    const persona = personaBlock(agent.persona);
    const language = languageBlock(agent.languageConfig);
    const scope = scopeBlock(agent.conversationConfig);
    const renderedSystemPrompt = renderTemplate(agent.systemPrompt, { TENANT_NAME: tenantName, AGENT_NAME: agent.displayName || agent.key, TODAY: today(), ...agent.conversationConfig.variables });

    const toolDefinitions = await toGatewayToolDefinitions(deps.db, tenant, agent.toolIds);
    if (agent.handoffTargets.length > 0) {
      toolDefinitions.push(handoffToolDefinition(agent.handoffTargets));
    }

    const nativeTools = await buildNativeTools(deps.db, tenant, agent);
    const sandbox = agent.environment === "sandbox";

    while (round < ROUND_CAP) {
      round++;
      finalText = "";

      const systemMessages = [{ role: "system" as const, content: renderedSystemPrompt }, { role: "system" as const, content: knowledge }, { role: "system" as const, content: session }];
      if (persona) systemMessages.push({ role: "system" as const, content: persona });
      if (language) systemMessages.push({ role: "system" as const, content: language });
      if (scope) systemMessages.push({ role: "system" as const, content: scope });
      if (handoff) systemMessages.push({ role: "system" as const, content: handoff });

      const request: ChatRequest = {
        messages: [...systemMessages, ...messages],
        tools: toolDefinitions,
        nativeTools,
        maxOutputTokens: agent.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        temperature: agent.temperature ?? undefined,
      };

      const response = await deps.gateway.chatStream(tenant, agent.modelAlias, runId, request, forwardDelta);

      messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls.length ? response.toolCalls : undefined });

      if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
        break;
      }

      for (const call of response.toolCalls) {
        if (call.name === HANDOFF_TOOL_NAME) {
          const target = typeof call.arguments.target === "string" ? call.arguments.target : "";
          handoffRequested = { target, package: { ...parseHandoffPackage(call.arguments), sentiment: sentiment.hit ? "negative" : "neutral" } };
          messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: JSON.stringify({ ok: true, handoff: true }) });
          continue;
        }

        callbacks.onToolStart?.(call.name);
        const result = await executeTool(deps.db, tenant, conversationId, runId, call.name, call.arguments, { sandbox, toolSettings: agent.toolSettings });

        if (isCardBearing(result) && result.card) cards.push(result.card);
        if (isEscalatingResult(result) && result.escalate?.reason) {
          genericEscalationReasons.push(result.escalate.reason as EscalationReason);
        }
        if (isApprovalPendingResult(result) && result.needsApproval) {
          approvalRequested = true;
        }

        // Phase 8 M1: same ok:false test runAndLog (src/tools/registry.ts)
        // uses to mark a tool_calls row 'error' — this codebase doesn't
        // distinguish a real execution failure from a legitimate business
        // "no" (e.g. an ineligible return), so neither does this counter.
        if ((result as { ok?: unknown }).ok === false) convoSession.consecutiveToolFailures++;
        else convoSession.consecutiveToolFailures = 0;

        const resultText = JSON.stringify(result);
        toolResultTexts.push(resultText);
        messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: resultText });
      }

      if (agent.escalationConfig.nFailedAttempts != null && convoSession.consecutiveToolFailures >= agent.escalationConfig.nFailedAttempts) {
        genericEscalationReasons.push("n_failed_attempts");
        break;
      }

      if (handoffRequested) break;
    }

    citableDocs = [...new Map(retrieved.map((r) => [r.article.docId, { docId: r.article.docId, title: r.article.title }])).values()];
  }

  const loopCapHit = round >= ROUND_CAP;

  // A2: typed PII detection needs an async call to the Presidio sidecar, so
  // it happens here and the spans are handed to the (sync) guardrail runner.
  // Unconfigured/unreachable → analyzePii returns null and checkPiiLeakage
  // falls back to its email/phone regexes.
  let piiSpans: PiiSpan[] | null = null;
  if (guardrailConfig.output?.piiLeakageCheck !== false) {
    const piiEntities = guardrailConfig.output?.piiEntities;
    piiSpans = await analyzePii(finalText, { entities: piiEntities?.allow });
    if (piiSpans && piiEntities?.deny?.length) {
      const denied = new Set(piiEntities.deny);
      piiSpans = piiSpans.filter((s) => !denied.has(s.entityType));
    }
  }

  const outputGuardrail = checkOutputGuardrails(guardrailConfig, finalText, citableDocs.map((d) => d.docId), toolResultTexts.join("\n"), { piiSpans });

  if (blockingMode) {
    if (outputGuardrail.blocked) {
      finalText = "Let me get a colleague to double-check that before I send it over.";
      callbacks.onTextDelta?.(finalText);
    } else if (outputGuardrail.redactedText !== undefined) {
      finalText = outputGuardrail.redactedText;
      callbacks.onTextDelta?.(finalText);
    } else {
      for (const delta of bufferedDeltas) callbacks.onTextDelta?.(delta);
    }
  }

  const escalationReasons: EscalationReason[] = [];
  if (severe.hit) escalationReasons.push("severe_symptom");
  else if (reactionMention.hit) escalationReasons.push("reaction_mention");
  if (humanRequest.hit) escalationReasons.push("human_request");
  if (sentiment.hit) escalationReasons.push("negative_sentiment");
  escalationReasons.push(...genericEscalationReasons);
  if (approvalRequested) escalationReasons.push("approval_requested");
  if (outputGuardrail.blocked) escalationReasons.push("guardrail_blocked");
  if (loopCapHit) escalationReasons.push("loop_cap");

  // Phase 2 M3b: only write a fresh (non-cache-hit) answer back to the
  // cache, and only when nothing about this turn was unusual — no tool
  // call, no handoff, no guardrail block, no escalation of any kind. A
  // wrong cached answer looks exactly like a right one, so the write side
  // stays as conservative as the read side.
  if (agent.semanticCacheEnabled && !cacheHit && toolResultTexts.length === 0 && !handoffRequested && escalationReasons.length === 0) {
    await writeCache(deps.db, tenant, agent.key, userText, finalText, citableDocs, deps.embeddings);
  }

  return {
    assistantText: finalText,
    cards,
    citableDocs,
    escalate: escalationReasons.length > 0,
    escalationReasons,
    loopCapHit,
    guardrailBlocked: outputGuardrail.blocked,
    guardrailReasons: outputGuardrail.reasons,
    handoffRequested,
    lowKbConfidence,
    updatedHistory: messages,
  };
}

/**
 * Phase 6 M3: translates an agent's admin-configured native_tools into the
 * generic NativeToolConfig shape the gateway carries through to whichever
 * provider adapter reads it. OpenAiProvider handles all three types;
 * AnthropicProvider only has a Claude-hosted equivalent for "web_search" and
 * silently drops "file_search"/"mcp" — harmless to compute unconditionally
 * either way, since each adapter decides what it actually supports.
 */
async function buildNativeTools(db: Database.Database, tenant: TenantContext, agent: AgentDef): Promise<NativeToolConfig[]> {
  const config = agent.nativeTools;
  const tools: NativeToolConfig[] = [];
  if (config.webSearch) tools.push({ type: "web_search" });

  if (config.fileSearch) {
    const collectionIds = Array.isArray((agent.kbScope as { collectionIds?: unknown })?.collectionIds) ? ((agent.kbScope as { collectionIds: string[] }).collectionIds ?? []) : [];
    const collections = new KbCollectionRepository(db, tenant);
    const vectorStoreIds = (await Promise.all(collectionIds.map((id) => collections.getById(id))))
      .map((c) => c?.openaiVectorStoreId)
      .filter((id): id is string => Boolean(id));
    if (vectorStoreIds.length > 0) tools.push({ type: "file_search", vectorStoreIds });
  }

  if (config.mcp?.enabled && config.mcp.serverUrl) {
    tools.push({ type: "mcp", serverLabel: config.mcp.serverLabel || "mcp", serverUrl: config.mcp.serverUrl, headers: config.mcp.headers });
  }

  return tools;
}

function isCardBearing(result: unknown): result is { card?: unknown } {
  return typeof result === "object" && result !== null && "card" in result;
}

/** Generic runtime convention: any tool result may carry escalate: {reason}, not just check_return_eligibility's. */
function isEscalatingResult(result: unknown): result is { escalate?: { reason: string } } {
  return typeof result === "object" && result !== null && "escalate" in result;
}

function isApprovalPendingResult(result: unknown): result is { needsApproval?: boolean } {
  return typeof result === "object" && result !== null && "needsApproval" in result;
}
