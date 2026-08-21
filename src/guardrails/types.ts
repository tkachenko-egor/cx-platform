/** Shape stored in the (previously unused) agent_defs.guardrails JSON column. */
export interface AgentGuardrailConfig {
  input?: {
    /** Default true — deterministic marker screening (FR-6.13's Must). */
    promptInjectionScreening?: boolean;
  };
  output?: {
    /** Default true — every [doc_id] citation must resolve to a retrieved doc (FR-6.14/FR-12.7). */
    groundednessCheck?: boolean;
    /** Default true — flags PII in the reply that wasn't sourced from this turn's tool results. */
    piiLeakageCheck?: boolean;
    /** Default true — refund/medical/legal promise marker list (FR-6.14). */
    forbiddenClaimsCheck?: boolean;
    /**
     * Default false (non-blocking): stream live, check after, and on
     * failure flag + escalate for future turns — the reply already reached
     * the customer, so this is detect-and-escalate, not prevent-this-message.
     * true: buffer the full reply server-side and withhold streaming until
     * the check passes — for high-risk agents only, trading latency for
     * the ability to actually swap in a fallback message on a block.
     */
    blockingMode?: boolean;
  };
}

export interface GuardrailCheckResult {
  blocked: boolean;
  reasons: string[];
}
