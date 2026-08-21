import type { Tenant } from "../db/repositories/tenant-repository";
import { ConversationRepository } from "../db/repositories/conversation-repository";
import { MessageRepository } from "../db/repositories/message-repository";
import { EventRepository } from "../db/repositories/event-repository";
import { RunRepository } from "../db/repositories/run-repository";
import { AgentDefRepository } from "../db/repositories/agent-def-repository";
import type { RuntimeDeps, AgentTurnCallbacks, EscalationReason } from "../agents/runtime";
import { runAgentTurn } from "../agents/runtime";
import { getOrCreateSession } from "../agents/sessions-store";
import { withConversationLock } from "../agents/conversation-lock";
import { conversationTurnCapExceeded } from "./rate-limit";
import type { Conversation, ConversationChannel, ConversationState } from "../core/types";

export const DEFAULT_AGENT_KEY = "support-generalist";

export interface ProcessTurnResult {
  conversationId: string;
  state: ConversationState;
  assistantText?: string;
  assistantMessageId?: string;
  cards?: unknown[];
  citableDocs?: { docId: string; title: string }[];
  handoff: boolean;
  loopCapHit: boolean;
  escalationReasons?: EscalationReason[];
}

/**
 * The channel-agnostic core of "a customer said something, now what":
 * lock → append → turn-cap check → run the agent → persist → escalate.
 * Extracted from what was inlined in app/api/chat/route.ts so a second
 * channel (email, src/channel/email/) proves NFR-9.2's "one interface, zero
 * orchestrator changes" promise rather than just asserting it.
 */
export async function processInboundTurn(
  deps: RuntimeDeps,
  tenant: Tenant,
  input: { conversationId: string; text: string; channelMessageId?: string },
  callbacks: AgentTurnCallbacks = {},
): Promise<ProcessTurnResult> {
  const { db } = deps;
  const conversations = new ConversationRepository(db, tenant);
  const messages = new MessageRepository(db, tenant);
  const events = new EventRepository(db, tenant);
  const runs = new RunRepository(db, tenant);
  const agentDefs = new AgentDefRepository(db, tenant);

  return withConversationLock(input.conversationId, async (): Promise<ProcessTurnResult> => {
    const conversation = conversations.get(input.conversationId);
    if (!conversation) throw new Error(`Conversation ${input.conversationId} not found`);

    messages.append({ conversationId: input.conversationId, role: "user", content: input.text, channelMessageId: input.channelMessageId });
    const session = getOrCreateSession(input.conversationId);

    if (conversation.state !== "bot_active") {
      // Still recorded for the model's own continuity (src/agents/sessions-store.ts)
      // so a human's later "generate draft" request has full context — just
      // not auto-answered while a human is handling the conversation.
      session.history.push({ role: "user", content: input.text });
      return { conversationId: input.conversationId, state: conversation.state, handoff: true, loopCapHit: false };
    }

    if (conversationTurnCapExceeded(session.turnCount)) {
      const cannedText = "We've covered a lot of ground in this conversation — let me hand you to a colleague to pick up from here.";
      callbacks.onTextDelta?.(cannedText);
      conversations.setState(input.conversationId, "awaiting_human");
      events.append({ conversationId: input.conversationId, type: "escalated", actor: "system", payload: { reasons: ["loop_cap"] } });
      return { conversationId: input.conversationId, state: "awaiting_human", assistantText: cannedText, handoff: true, loopCapHit: true };
    }

    const agentVersion = (conversation.metadata.agentVersion as number | undefined) ?? 1;
    const agent = agentDefs.getVersion(DEFAULT_AGENT_KEY, agentVersion) ?? agentDefs.getLatestPublished(DEFAULT_AGENT_KEY);
    if (!agent) throw new Error("No agent definition available");

    const run = runs.start({ conversationId: input.conversationId, agentKey: agent.key, agentVersion: agent.version, trigger: "user_message" });
    session.turnCount++;

    try {
      const result = await runAgentTurn(deps, tenant, input.conversationId, run.id, agent, session.history, input.text, callbacks);
      session.history = result.updatedHistory;
      const assistantMessage = messages.append({ conversationId: input.conversationId, role: "assistant", content: result.assistantText });
      runs.complete(run.id, "completed");

      let state: ConversationState = "bot_active";
      if (result.escalate) {
        conversations.setState(input.conversationId, "awaiting_human");
        events.append({ conversationId: input.conversationId, type: "escalated", actor: "system", payload: { reasons: result.escalationReasons } });
        state = "awaiting_human";
      }

      return {
        conversationId: input.conversationId,
        state,
        assistantText: result.assistantText,
        assistantMessageId: assistantMessage.id,
        cards: result.cards,
        citableDocs: result.citableDocs,
        handoff: result.escalate,
        loopCapHit: result.loopCapHit,
        escalationReasons: result.escalationReasons,
      };
    } catch (err) {
      runs.complete(run.id, "failed");
      throw err;
    }
  });
}

/** Finds-or-creates the conversation a channel adapter should hand to processInboundTurn. */
export function ensureConversation(
  deps: { db: RuntimeDeps["db"] },
  tenant: Tenant,
  existing: Conversation | undefined,
  channel: ConversationChannel,
  metadata?: Record<string, unknown>,
): Conversation {
  if (existing) return existing;

  const agentDefs = new AgentDefRepository(deps.db, tenant);
  const published = agentDefs.getLatestPublished(DEFAULT_AGENT_KEY);
  if (!published) throw new Error("No published agent — run `npm run seed` first.");

  const conversations = new ConversationRepository(deps.db, tenant);
  const conversation = conversations.create({ channel, agentKey: DEFAULT_AGENT_KEY, metadata: { agentVersion: published.version, ...metadata } });
  new EventRepository(deps.db, tenant).append({ conversationId: conversation.id, type: "state_changed", actor: "system", payload: { to: "bot_active" } });
  return conversation;
}
