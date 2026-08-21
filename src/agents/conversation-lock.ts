/**
 * FR-4.7: two inbound messages arriving during one agent run must not
 * produce interleaved replies. Phase 1 simplification: serialize per
 * conversation rather than the doc's recommended cancel-and-restart —
 * simpler, and correct if less snappy under rapid double-sends.
 */
const locks = new Map<string, Promise<unknown>>();

export function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(conversationId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(
    conversationId,
    next.catch(() => undefined),
  );
  return next;
}
