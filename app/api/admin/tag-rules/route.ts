import { getPlatformContext } from "../../../../src/platform/context";
import { AutoTagRuleRepository } from "../../../../src/db/repositories/auto-tag-rule-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";

export const runtime = "nodejs";

export async function GET() {
  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const rules = await new AutoTagRuleRepository(db, tenant).list();
  return Response.json({ rules });
}

/** Phase 9 M4: keyword -> tag mappings for deterministic auto-tagging — see src/channel/turn.ts's scanAutoTags. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { tag?: string; keywords?: string[] };
  if (!body.tag?.trim() || !body.keywords?.length) {
    return Response.json({ error: "tag and at least one keyword are required" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const rule = await new AutoTagRuleRepository(db, tenant).create({ tag: body.tag.trim(), keywords: body.keywords.map((k) => k.trim()).filter(Boolean) });
  await new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "auto_tag_rule_created", target: rule.tag });

  return Response.json({ ok: true, rule });
}
