import type { RuntimeDeps } from "./runtime";
import type { AgentDef } from "../db/repositories/agent-def-repository";
import type { TenantContext } from "../tenancy/context";
import type { ChatRequest } from "../gateway/types";

export interface RouterResult {
  target: string;
  /** "low" on any fallback path — out-of-enum, missing tool call, or a misconfigured router with no targets. */
  confidence: "high" | "low";
}

const ROUTE_TOOL_NAME = "route_to_agent";

/**
 * FR-6.6: router output is a constrained enum, never free text. The router
 * is still an agent_defs row (FR-6.1), but instead of the normal
 * tool-calling loop it issues one non-streaming call offering exactly one
 * tool — route_to_agent — whose target enum is the router's own
 * handoffTargets column. No new gateway capability (no forced-tool-choice
 * field on ChatRequest): with nothing else to call and a directive system
 * prompt, this is sufficient, and an out-of-enum or missing call just falls
 * back to the router's first configured target rather than failing the turn.
 */
export async function runRouterTurn(deps: RuntimeDeps, tenant: TenantContext, runId: string, routerAgent: AgentDef, userText: string): Promise<RouterResult> {
  const targets = routerAgent.handoffTargets;
  if (targets.length === 0) {
    return { target: "", confidence: "low" };
  }

  const request: ChatRequest = {
    messages: [
      { role: "system", content: routerAgent.systemPrompt },
      { role: "user", content: userText },
    ],
    tools: [
      {
        name: ROUTE_TOOL_NAME,
        description: "Route this customer message to the single best specialist to handle it. Always call this — never answer the customer directly.",
        parameters: {
          type: "object",
          required: ["target"],
          properties: {
            target: { type: "string", enum: targets, description: "Which specialist should handle this." },
          },
        },
      },
    ],
    maxOutputTokens: 256,
  };

  const response = await deps.gateway.chat(tenant, routerAgent.modelAlias, runId, request);
  const call = response.toolCalls.find((c) => c.name === ROUTE_TOOL_NAME);
  const target = call?.arguments.target;

  if (typeof target === "string" && targets.includes(target)) {
    return { target, confidence: "high" };
  }
  return { target: targets[0], confidence: "low" };
}
