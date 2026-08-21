import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../gateway/embeddings/types";
import { ModelGateway } from "../gateway/gateway";
import type { ChatMessage, ChatRequest } from "../gateway/types";
import type { AgentDef } from "../db/repositories/agent-def-repository";
import type { TenantContext } from "../tenancy/context";
import { today } from "../core/clock";
import { hybridSearch, type KbScope } from "../kb/retrieval";
import { knowledgeBlock, sessionBlock } from "./system-prompt";
import { scanForHumanRequest, scanForReactionMention, scanForSevereSymptoms } from "./escalation";
import { executeTool, toGatewayToolDefinitions } from "../tools/registry";

export interface RuntimeDeps {
  db: Database.Database;
  gateway: ModelGateway;
  embeddings: EmbeddingProvider;
}

export type EscalationReason = "severe_symptom" | "reaction_mention" | "human_request" | "eligible_return" | "loop_cap";

export interface AgentTurnResult {
  assistantText: string;
  cards: unknown[];
  /** FR-7.8: the docs retrieved this turn, so the UI can resolve [doc_id] markers to titles/links without a DB round trip. */
  citableDocs: { docId: string; title: string }[];
  escalate: boolean;
  escalationReasons: EscalationReason[];
  loopCapHit: boolean;
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
): Promise<AgentTurnResult> {
  const messages: ChatMessage[] = [...history, { role: "user", content: userText }];

  const severe = scanForSevereSymptoms(userText);
  const humanRequest = scanForHumanRequest(userText);
  const reactionMention = scanForReactionMention(userText);

  const kbScope = (agent.kbScope as KbScope | undefined) ?? { audience: ["customer"] };
  const retrieved = await hybridSearch(deps.db, tenant, kbScope, userText, KB_TOP_K, deps.embeddings);
  const knowledge = knowledgeBlock(retrieved.map((r) => ({ docId: r.article.docId, title: r.article.title, effective: r.article.effective, text: r.chunk.text })));
  const session = sessionBlock({ today: today(), severeSymptomSignal: severe.hit });

  const toolDefinitions = toGatewayToolDefinitions(agent.toolIds);
  const cards: unknown[] = [];
  let round = 0;
  let finalText = "";
  let eligibleReturnSeen = false;

  while (round < ROUND_CAP) {
    round++;
    finalText = "";

    const request: ChatRequest = {
      messages: [{ role: "system", content: agent.systemPrompt }, { role: "system", content: knowledge }, { role: "system", content: session }, ...messages],
      tools: toolDefinitions,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    };

    const response = await deps.gateway.chatStream(tenant, agent.modelAlias, runId, request, (delta) => {
      finalText += delta;
      callbacks.onTextDelta?.(delta);
    });

    messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls.length ? response.toolCalls : undefined });

    if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
      break;
    }

    for (const call of response.toolCalls) {
      callbacks.onToolStart?.(call.name);
      const result = executeTool(deps.db, tenant, runId, call.name, call.arguments);

      if (isCardBearing(result) && result.card) cards.push(result.card);
      if (call.name === "check_return_eligibility" && isEligibilityResult(result) && result.verdict === "ELIGIBLE") {
        eligibleReturnSeen = true;
      }

      messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: JSON.stringify(result) });
    }
  }

  const loopCapHit = round >= ROUND_CAP;
  const escalationReasons: EscalationReason[] = [];
  if (severe.hit) escalationReasons.push("severe_symptom");
  else if (reactionMention.hit) escalationReasons.push("reaction_mention");
  if (humanRequest.hit) escalationReasons.push("human_request");
  if (eligibleReturnSeen) escalationReasons.push("eligible_return");
  if (loopCapHit) escalationReasons.push("loop_cap");

  const citableDocs = [...new Map(retrieved.map((r) => [r.article.docId, { docId: r.article.docId, title: r.article.title }])).values()];

  return { assistantText: finalText, cards, citableDocs, escalate: escalationReasons.length > 0, escalationReasons, loopCapHit, updatedHistory: messages };
}

function isCardBearing(result: unknown): result is { card?: unknown } {
  return typeof result === "object" && result !== null && "card" in result;
}

function isEligibilityResult(result: unknown): result is { verdict: string } {
  return typeof result === "object" && result !== null && "verdict" in result;
}
