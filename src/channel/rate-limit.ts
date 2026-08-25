/**
 * Minimal in-memory rate limiting (NFR-4.8): a per-IP cap on /api/chat,
 * plus a hard per-conversation turn cap. In-memory is fine for a
 * single-process Phase 1 deployment.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_TURNS_PER_CONVERSATION = 60;

const ipHits = new Map<string, number[]>();

export function checkIpRateLimit(ip: string): { ok: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = hits[0];
    return { ok: false, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) };
  }
  hits.push(now);
  ipHits.set(ip, hits);
  return { ok: true };
}

/** Phase 8 M1: cap is overridable per-agent (agent_defs.escalation_config.turnCountCap) — defaults to the global constant when omitted. */
export function conversationTurnCapExceeded(turnCount: number, cap: number = MAX_TURNS_PER_CONVERSATION): boolean {
  return turnCount >= cap;
}
