/**
 * FR-6.7: what one agent hands another isn't "the whole transcript" — it's
 * this structured object. Both the router's dispatch and a specialist's
 * mid-turn handoff request produce/consume the same shape.
 */
export interface HandoffPackage {
  reason: string;
  summary: string;
  extractedEntities: Record<string, string>;
  instructionsForReceivingAgent: string;
  /** FR-9.3: set from the deterministic sentiment scan (src/agents/escalation.ts), not the model — so a receiving human sees it without re-reading the transcript. */
  sentiment?: "negative" | "neutral";
}

export const HANDOFF_TOOL_NAME = "handoff_to_agent";

/** FR-6.6-shaped: specialists get this offered alongside their real tools whenever they have somewhere to hand off to. */
export function handoffToolDefinition(targets: string[]): { name: string; description: string; parameters: Record<string, unknown> } {
  return {
    name: HANDOFF_TOOL_NAME,
    description: "Hand this conversation to a different specialist when the customer's need is outside your scope. Do not guess at their answer — hand off instead.",
    parameters: {
      type: "object",
      required: ["target", "reason", "summary"],
      properties: {
        target: { type: "string", enum: targets, description: "Which specialist should take over." },
        reason: { type: "string", description: "Why this needs a different specialist." },
        summary: { type: "string", description: "What the customer needs and what you already tried, so the receiving agent doesn't have to ask again." },
        instructions_for_receiving_agent: { type: "string", description: "Anything specific the receiving agent should do next." },
        extracted_entities: { type: "string", description: 'JSON object of key facts already established, e.g. {"order_id":"ORD-100001"}' },
      },
    },
  };
}

/** Parses the handoff tool's arguments into a HandoffPackage, defensively — a malformed extracted_entities blob just yields {}. */
export function parseHandoffPackage(args: Record<string, unknown>): HandoffPackage {
  let extractedEntities: Record<string, string> = {};
  if (typeof args.extracted_entities === "string") {
    try {
      const parsed: unknown = JSON.parse(args.extracted_entities);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        extractedEntities = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
      }
    } catch {
      // Left as {} — a malformed blob from the model shouldn't break the handoff.
    }
  }

  return {
    reason: typeof args.reason === "string" ? args.reason : "",
    summary: typeof args.summary === "string" ? args.summary : "",
    extractedEntities,
    instructionsForReceivingAgent: typeof args.instructions_for_receiving_agent === "string" ? args.instructions_for_receiving_agent : "",
  };
}
