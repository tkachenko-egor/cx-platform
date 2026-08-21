import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../gateway/embeddings/types";
import { ModelGateway } from "../gateway/gateway";
import type { ChatMessage, ChatRequest } from "../gateway/types";
import type { AgentDef } from "../db/repositories/agent-def-repository";
import type { TenantContext } from "../tenancy/context";
import { today } from "../core/clock";
import { hybridSearch, type KbScope } from "../kb/retrieval";
import { knowledgeBlock, sessionBlock, handoffBlock } from "./system-prompt";
import { scanForHumanRequest, scanForReactionMention, scanForSevereSymptoms } from "./escalation";
import { executeTool, toGatewayToolDefinitions } from "../tools/registry";
import type { AgentGuardrailConfig } from "../guardrails/types";
import { checkUserInputGuardrails, checkRetrievedChunkGuardrails, checkOutputGuardrails } from "../guardrails/runner";
import { HANDOFF_TOOL_NAME, handoffToolDefinition, parseHandoffPackage, type HandoffPackage } from "./handoff";

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
  | "router_low_confidence";

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
 * The tool-calling loop: ported in shape from amarelle-handoff's
 * lib/agent/loop.ts (round cap, parallel tool execution, tool_result
 * feedback), rebuilt on the model gateway, tool registry and hybrid
 * retrieval instead of a raw Anthropic client, a hardcoded switch, and
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
): Promise<AgentTurnResult> {
  const messages: ChatMessage[] = [...history, { role: "user", content: userText }];
  const guardrailConfig = (agent.guardrails as AgentGuardrailConfig | undefined) ?? {};

  // FR-6.13: cheap, deterministic, and worth failing fast on before spending
  // a retrieval call or a model turn.
  const userInputGuardrail = checkUserInputGuardrails(guardrailConfig, userText);
  if (userInputGuardrail.blocked) {
    const fallback = "I'm not able to help with that request.";
    return {
      assistantText: fallback,
      cards: [],
      citableDocs: [],
      escalate: true,
      escalationReasons: ["guardrail_blocked"],
      loopCapHit: false,
      guardrailBlocked: true,
      guardrailReasons: userInputGuardrail.reasons,
      updatedHistory: [...messages, { role: "assistant", content: fallback }],
    };
  }

  const severe = scanForSevereSymptoms(userText);
  const humanRequest = scanForHumanRequest(userText);
  const reactionMention = scanForReactionMention(userText);

  const kbScope = (agent.kbScope as KbScope | undefined) ?? { audience: ["customer"] };
  const retrieved = await hybridSearch(deps.db, tenant, kbScope, userText, KB_TOP_K, deps.embeddings);

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
      updatedHistory: [...messages, { role: "assistant", content: fallback }],
    };
  }

  const knowledge = knowledgeBlock(retrieved.map((r) => ({ docId: r.article.docId, title: r.article.title, effective: r.article.effective, text: r.chunk.text })));
  const session = sessionBlock({ today: today(), severeSymptomSignal: severe.hit });
  const handoff = handoffContext ? handoffBlock(handoffContext) : null;

  const toolDefinitions = toGatewayToolDefinitions(agent.toolIds);
  if (agent.handoffTargets.length > 0) {
    toolDefinitions.push(handoffToolDefinition(agent.handoffTargets));
  }
  const cards: unknown[] = [];
  const toolResultTexts: string[] = [];
  let round = 0;
  let finalText = "";
  let approvalRequested = false;
  const genericEscalationReasons: EscalationReason[] = [];
  let handoffRequested: { target: string; package: HandoffPackage } | undefined;

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

  while (round < ROUND_CAP) {
    round++;
    finalText = "";

    const systemMessages = [{ role: "system" as const, content: agent.systemPrompt }, { role: "system" as const, content: knowledge }, { role: "system" as const, content: session }];
    if (handoff) systemMessages.push({ role: "system" as const, content: handoff });

    const request: ChatRequest = {
      messages: [...systemMessages, ...messages],
      tools: toolDefinitions,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    };

    const response = await deps.gateway.chatStream(tenant, agent.modelAlias, runId, request, forwardDelta);

    messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls.length ? response.toolCalls : undefined });

    if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
      break;
    }

    for (const call of response.toolCalls) {
      if (call.name === HANDOFF_TOOL_NAME) {
        const target = typeof call.arguments.target === "string" ? call.arguments.target : "";
        handoffRequested = { target, package: parseHandoffPackage(call.arguments) };
        messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: JSON.stringify({ ok: true, handoff: true }) });
        continue;
      }

      callbacks.onToolStart?.(call.name);
      const result = executeTool(deps.db, tenant, conversationId, runId, call.name, call.arguments);

      if (isCardBearing(result) && result.card) cards.push(result.card);
      if (isEscalatingResult(result) && result.escalate?.reason) {
        genericEscalationReasons.push(result.escalate.reason as EscalationReason);
      }
      if (isApprovalPendingResult(result) && result.needsApproval) {
        approvalRequested = true;
      }

      const resultText = JSON.stringify(result);
      toolResultTexts.push(resultText);
      messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: resultText });
    }

    if (handoffRequested) break;
  }

  const loopCapHit = round >= ROUND_CAP;
  const citableDocs = [...new Map(retrieved.map((r) => [r.article.docId, { docId: r.article.docId, title: r.article.title }])).values()];

  const outputGuardrail = checkOutputGuardrails(guardrailConfig, finalText, citableDocs.map((d) => d.docId), toolResultTexts.join("\n"));

  if (blockingMode) {
    if (outputGuardrail.blocked) {
      finalText = "Let me get a colleague to double-check that before I send it over.";
      callbacks.onTextDelta?.(finalText);
    } else {
      for (const delta of bufferedDeltas) callbacks.onTextDelta?.(delta);
    }
  }

  const escalationReasons: EscalationReason[] = [];
  if (severe.hit) escalationReasons.push("severe_symptom");
  else if (reactionMention.hit) escalationReasons.push("reaction_mention");
  if (humanRequest.hit) escalationReasons.push("human_request");
  escalationReasons.push(...genericEscalationReasons);
  if (approvalRequested) escalationReasons.push("approval_requested");
  if (outputGuardrail.blocked) escalationReasons.push("guardrail_blocked");
  if (loopCapHit) escalationReasons.push("loop_cap");

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
    updatedHistory: messages,
  };
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
