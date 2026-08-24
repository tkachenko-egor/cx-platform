/** Shape stored in the agent_defs.guardrails JSON column. */
export interface AgentGuardrailConfig {
  input?: {
    /** Default true — deterministic marker screening (FR-6.13's Must). */
    promptInjectionScreening?: boolean;
    /** Phase 8 M2: topic/keyword list — a hit blocks the input, same as prompt injection. */
    blockedTopics?: string[];
    /** Phase 8 M2: a separate list for reporting clarity — mechanically identical to blockedTopics. */
    competitorNames?: string[];
  };
  output?: {
    /** Default true — every [doc_id] citation must resolve to a retrieved doc (FR-6.14/FR-12.7). */
    groundednessCheck?: boolean;
    /** Default true — flags PII in the reply that wasn't sourced from this turn's tool results. */
    piiLeakageCheck?: boolean;
    /**
     * Phase 8 M2: default "block" (today's only behavior). "redact" replaces
     * the matched PII with a placeholder instead of blocking the whole
     * reply — but only takes effect when blockingMode is also true, since a
     * non-blocking reply has already streamed to the customer by the time
     * this check runs (see src/guardrails/output.ts's checkPiiLeakage).
     */
    piiMode?: "block" | "redact";
    /** Default true — refund/medical/legal promise marker list (FR-6.14). */
    forbiddenClaimsCheck?: boolean;
    /** Phase 8 M2: default true — a small built-in profanity marker list, same style as forbiddenClaimsCheck. */
    profanityCheck?: boolean;
    /** Phase 8 M2: prepended to the first reply of a new conversation when set (src/channel/turn.ts) — e.g. EU AI Act disclosure copy. */
    aiDisclosureMessage?: string;
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
  /** Set only by a "redact" mode check when it found and masked PII instead of blocking. */
  redactedText?: string;
}
