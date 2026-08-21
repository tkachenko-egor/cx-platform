/**
 * Subdomains that route to platform-level surfaces, not an ordinary
 * tenant. Kept in its own zero-dependency module so `middleware.ts` (Edge
 * runtime by default) can import it without pulling in `context.ts`'s
 * full DB/gateway graph, including the native `better-sqlite3` addon.
 */
export const RESERVED_SUBDOMAINS = new Set(["platform"]);
