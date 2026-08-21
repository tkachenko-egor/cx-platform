/**
 * FR-6.8: track the agent path, forbid A->B->A cycles, escalate to human
 * on repeat. Operates purely on conversation.metadata.agentPath (a plain
 * string array) — no touch to sessions-store.ts/conversation-lock.ts,
 * which stay the documented single-process simplification they already
 * are (CLAUDE.md invariant #8).
 */
const CYCLE_WINDOW = 4;

/** True if `next` already appears within the recent hop window — a repeat, not fresh ground. */
export function detectCycle(agentPath: string[], next: string): boolean {
  return agentPath.slice(-CYCLE_WINDOW).includes(next);
}

export function appendToPath(agentPath: string[], next: string): string[] {
  return [...agentPath, next];
}
