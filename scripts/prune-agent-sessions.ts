import "dotenv/config";
import { getDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { AgentSessionRepository } from "../src/db/repositories/agent-session-repository";

/**
 * B6 retention: `agent_sessions` grows one row per conversation and is never
 * read once a conversation goes cold. Run this on a schedule (cron / a
 * platform job) to drop sessions untouched for `AGENT_SESSION_RETENTION_DAYS`
 * (default 30). The customer/desk transcript in `messages` is untouched — this
 * only clears the model's replay cache.
 */
const RETENTION_DAYS = Number(process.env.AGENT_SESSION_RETENTION_DAYS ?? 30);

async function main(): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  let total = 0;
  for (const tenant of await new TenantRepository(db).list()) {
    total += await new AgentSessionRepository(db, tenant).pruneOlderThan(cutoff);
  }
  console.log(`Pruned ${total} agent_sessions row(s) not touched since ${cutoff} (${RETENTION_DAYS}d retention).`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
