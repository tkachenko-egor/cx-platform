import { randomUUID } from "node:crypto";
import type { Tenant } from "../db/repositories/tenant-repository";
import { ConversationRepository } from "../db/repositories/conversation-repository";
import { MessageRepository } from "../db/repositories/message-repository";
import { EventRepository } from "../db/repositories/event-repository";
import { RunRepository } from "../db/repositories/run-repository";
import { AgentDefRepository } from "../db/repositories/agent-def-repository";
import { SlaPolicyRepository } from "../db/repositories/sla-policy-repository";
import { startSlaClock } from "../core/sla";
import { ReviewQueueRepository } from "../db/repositories/review-queue-repository";
import type { RuntimeDeps, AgentTurnCallbacks, EscalationReason } from "../agents/runtime";
import { runAgentTurn } from "../agents/runtime";
import { runRouterTurn } from "../agents/router";
import { detectCycle, appendToPath } from "../agents/loop-prevention";
import type { HandoffPackage } from "../agents/handoff";
import { scanForNegativeSentiment } from "../agents/escalation";
import { getOrCreateSession } from "../agents/sessions-store";
import { withConversationLock } from "../agents/conversation-lock";
import { conversationTurnCapExceeded } from "./rate-limit";
import { setConversationState } from "../core/state-transition";
import type { Conversation, ConversationChannel, ConversationState } from "../core/types";

export const DEFAULT_AGENT_KEY = "support-generalist";
/** FR-6.6: if a tenant publishes an agent_defs row with this key, new conversations route through it first. Tenants without one keep the single-agent Phase-1 behavior unchanged. */
export const ROUTER_AGENT_KEY = "router";
/** FR-6.8: a small per-request cap on specialist-to-specialist handoffs — hitting it escalates rather than looping the customer's message indefinitely. */
const MAX_HOPS_PER_REQUEST = 2;

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
  const slaPolicies = new SlaPolicyRepository(db, tenant);
  const reviewQueue = new ReviewQueueRepository(db, tenant);

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
      // Phase 7 M3: an admin-configured handoff message takes precedence over
      // the hardcoded default — best-effort lookup, falls back silently if
      // the pinned agent key/version is somehow gone.
      const pinnedAgent = agentDefs.getVersion(
        conversation.currentAgentId ?? DEFAULT_AGENT_KEY,
        (conversation.metadata.agentVersion as number | undefined) ?? 1,
      );
      const cannedText = pinnedAgent?.persona.cannedMessages?.default?.handoff || "We've covered a lot of ground in this conversation — let me hand you to a colleague to pick up from here.";
      callbacks.onTextDelta?.(cannedText);
      setConversationState(conversations, events, input.conversationId, "awaiting_human", "system");
      startSlaClock(conversations, slaPolicies, input.conversationId, conversation.priority, conversation.channel);
      events.append({ conversationId: input.conversationId, type: "escalated", actor: "system", payload: { reasons: ["loop_cap"] } });
      return { conversationId: input.conversationId, state: "awaiting_human", assistantText: cannedText, handoff: true, loopCapHit: true };
    }

    const escalateAndReturn = (reason: EscalationReason): ProcessTurnResult => {
      setConversationState(conversations, events, input.conversationId, "awaiting_human", "system");
      startSlaClock(conversations, slaPolicies, input.conversationId, conversation.priority, conversation.channel);
      events.append({ conversationId: input.conversationId, type: "escalated", actor: "system", payload: { reasons: [reason] } });
      return { conversationId: input.conversationId, state: "awaiting_human", handoff: true, loopCapHit: false, escalationReasons: [reason] };
    };

    const persistHandoff = (from: string, to: string, pkg: HandoffPackage) => {
      messages.append({ conversationId: input.conversationId, role: "handoff", content: JSON.stringify({ from, to, ...pkg }) });
      events.append({ conversationId: input.conversationId, type: "handoff", actor: "system", payload: { from, to, ...pkg } });
    };

    let agentPath = (conversation.metadata.agentPath as string[] | undefined) ?? [];
    let currentAgentKey = conversation.currentAgentId ?? DEFAULT_AGENT_KEY;
    let currentAgentVersion = (conversation.metadata.agentVersion as number | undefined) ?? 1;
    let handoffContext: HandoffPackage | undefined;

    // FR-6.6: route exactly once, on the conversation's first-ever turn, if
    // the tenant has published a router. No router published -> the
    // pinned agent (support-generalist by default) runs unchanged, same as
    // every earlier Phase 1b milestone.
    if (agentPath.length === 0) {
      const routerAgent = agentDefs.getLatestPublished(ROUTER_AGENT_KEY);
      if (routerAgent) {
        const routerRun = runs.start({ conversationId: input.conversationId, agentKey: routerAgent.key, agentVersion: routerAgent.version, trigger: "router" });
        const routed = await runRouterTurn(deps, tenant, routerRun.id, routerAgent, input.text);
        runs.complete(routerRun.id, "completed");

        const target = routed.target ? agentDefs.getForTraffic(routed.target, input.conversationId) : undefined;
        // Phase 7 M1: a draft/paused/archived target is never a valid new-routing
        // destination — only an in-flight conversation is allowed to keep running
        // an agent whose status has since changed (see the hops loop below).
        if (!target || target.agentStatus !== "active") return escalateAndReturn("router_low_confidence");

        agentPath = appendToPath(appendToPath(agentPath, ROUTER_AGENT_KEY), target.key);
        currentAgentKey = target.key;
        currentAgentVersion = target.version;
        conversations.setCurrentAgentKey(input.conversationId, currentAgentKey);
        conversations.setTags(input.conversationId, [currentAgentKey]);
        conversations.updateMetadata(input.conversationId, { agentPath, agentVersion: currentAgentVersion });

        const routingPackage: HandoffPackage = {
          reason: "initial routing",
          summary: input.text,
          extractedEntities: {},
          instructionsForReceivingAgent: "",
          sentiment: scanForNegativeSentiment(input.text).hit ? "negative" : "neutral",
        };
        persistHandoff(ROUTER_AGENT_KEY, target.key, routingPackage);
      }
    }

    session.turnCount++;
    let finalResult: Awaited<ReturnType<typeof runAgentTurn>> | undefined;

    for (let hops = 0; ; hops++) {
      const agent = agentDefs.getVersion(currentAgentKey, currentAgentVersion) ?? agentDefs.getLatestPublished(currentAgentKey);
      if (!agent) throw new Error(`No agent definition available for "${currentAgentKey}"`);

      const run = runs.start({ conversationId: input.conversationId, agentKey: agent.key, agentVersion: agent.version, trigger: hops === 0 ? "user_message" : "handoff" });

      let result: Awaited<ReturnType<typeof runAgentTurn>>;
      try {
        result = await runAgentTurn(deps, tenant, input.conversationId, run.id, agent, session.history, input.text, callbacks, handoffContext, tenant.name);
        session.history = result.updatedHistory;
        runs.complete(run.id, "completed");
      } catch (err) {
        runs.complete(run.id, "failed");
        throw err;
      }

      if (!result.handoffRequested) {
        finalResult = result;
        break;
      }

      if (hops >= MAX_HOPS_PER_REQUEST) return escalateAndReturn("handoff_cycle_detected");

      const { target, package: pkg } = result.handoffRequested;
      const nextAgent = target ? agentDefs.getForTraffic(target, input.conversationId) : undefined;
      if (!nextAgent || detectCycle(agentPath, target)) return escalateAndReturn("handoff_cycle_detected");
      if (nextAgent.agentStatus !== "active") return escalateAndReturn("target_agent_unavailable");

      agentPath = appendToPath(agentPath, target);
      currentAgentKey = nextAgent.key;
      currentAgentVersion = nextAgent.version;
      conversations.setCurrentAgentKey(input.conversationId, currentAgentKey);
      conversations.setTags(input.conversationId, [currentAgentKey]);
      conversations.updateMetadata(input.conversationId, { agentPath, agentVersion: currentAgentVersion });
      persistHandoff(agent.key, target, pkg);
      handoffContext = pkg;
    }

    const assistantMessage = messages.append({ conversationId: input.conversationId, role: "assistant", content: finalResult.assistantText });

    let state: ConversationState = "bot_active";
    if (finalResult.escalate) {
      setConversationState(conversations, events, input.conversationId, "awaiting_human", "system");
      startSlaClock(conversations, slaPolicies, input.conversationId, conversation.priority, conversation.channel);
      events.append({ conversationId: input.conversationId, type: "escalated", actor: "system", payload: { reasons: finalResult.escalationReasons } });
      state = "awaiting_human";
    } else if (finalResult.lowKbConfidence) {
      // Phase 2 M5: a review tier distinct from escalation — the bot kept
      // serving the customer, but a low-confidence retrieval is worth a
      // human's eyes later. Never touches conversation.state.
      reviewQueue.enqueue({ conversationId: input.conversationId, reason: "low_kb_confidence" });
    }

    return {
      conversationId: input.conversationId,
      state,
      assistantText: finalResult.assistantText,
      assistantMessageId: assistantMessage.id,
      cards: finalResult.cards,
      citableDocs: finalResult.citableDocs,
      handoff: finalResult.escalate,
      loopCapHit: finalResult.loopCapHit,
      escalationReasons: finalResult.escalationReasons,
    };
  });
}

/** Finds-or-creates the conversation a channel adapter should hand to processInboundTurn. */
export function ensureConversation(
  deps: { db: RuntimeDeps["db"] },
  tenant: Tenant,
  existing: Conversation | undefined,
  channel: ConversationChannel,
  metadata?: Record<string, unknown>,
  /** Phase 4 M4: an embedded widget is pinned to one specific agent (widget_configs.agent_key), not the tenant-wide default. */
  agentKey: string = DEFAULT_AGENT_KEY,
): Conversation {
  if (existing) return existing;

  const agentDefs = new AgentDefRepository(deps.db, tenant);
  // Phase 2 M6a: generated up front so getForTraffic's deterministic hash
  // has a conversation id to bucket on before the row itself exists.
  const conversationId = `CONV-${randomUUID()}`;
  const published = agentDefs.getForTraffic(agentKey, conversationId);
  if (!published) throw new Error("No published agent — run `npm run seed` first.");
  // Phase 7 M1: a draft/paused/archived agent can't start a brand-new
  // conversation — only an already-running one is grandfathered in.
  if (published.agentStatus !== "active") throw new Error(`Agent "${agentKey}" is not active (status: ${published.agentStatus})`);

  const conversations = new ConversationRepository(deps.db, tenant);
  const conversation = conversations.create({ id: conversationId, channel, agentKey, metadata: { agentVersion: published.version, ...metadata } });
  new EventRepository(deps.db, tenant).append({ conversationId: conversation.id, type: "state_changed", actor: "system", payload: { to: "bot_active" } });
  return conversation;
}
