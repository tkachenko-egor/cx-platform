/**
 * Login lockout (Phase 3 M2): in-memory, fine for a single-process
 * deployment — same "fine at this scale" shape as
 * src/channel/rate-limit.ts's checkIpRateLimit, but lockout-after-N-
 * failures keyed by email rather than a sliding request cap.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

const failuresByKey = new Map<string, number[]>();

export function checkLoginAttempt(key: string): { ok: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const failures = (failuresByKey.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (failures.length >= MAX_FAILURES) {
    const oldest = failures[0];
    return { ok: false, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) };
  }
  return { ok: true };
}

export function recordFailedLogin(key: string): void {
  const now = Date.now();
  const failures = (failuresByKey.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.push(now);
  failuresByKey.set(key, failures);
}

export function clearLoginAttempts(key: string): void {
  failuresByKey.delete(key);
}
