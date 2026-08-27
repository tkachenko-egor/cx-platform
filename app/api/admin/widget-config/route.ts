import { getPlatformContext } from "../../../../src/platform/context";
import { WidgetConfigRepository, type WidgetPosition, type AudienceRules } from "../../../../src/db/repositories/widget-config-repository";
import { AgentDefRepository } from "../../../../src/db/repositories/agent-def-repository";
import { AuditLogRepository } from "../../../../src/db/repositories/audit-log-repository";
import { requireRole, AuthError } from "../../../../src/auth/require-role";
import { isWidgetFontKey, type WidgetFontKey } from "../../../../src/platform/widget-fonts";

export const runtime = "nodejs";

const VALID_POSITIONS: WidgetPosition[] = ["bottom-right", "bottom-left"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function GET(req: Request) {
  const { db, tenant } = await getPlatformContext();
  try {
    await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const agentKey = new URL(req.url).searchParams.get("agentKey");
  if (!agentKey) return Response.json({ error: "agentKey is required" }, { status: 400 });

  const config = await new WidgetConfigRepository(db, tenant).getByAgentKey(agentKey);
  return Response.json({ config: config ?? null });
}

/** Phase 4 M4: creates a widget on first save (minting its public_key) or updates one that already exists — never rotates the key, so an already-embedded snippet keeps working. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    agentKey?: string;
    title?: string;
    greetingText?: string;
    primaryColor?: string;
    logoUrl?: string | null;
    position?: WidgetPosition;
    fontFamily?: string;
    userBubbleColor?: string;
    botBubbleColor?: string;
    audienceRules?: AudienceRules;
  };
  if (!body.agentKey?.trim()) return Response.json({ error: "agentKey is required" }, { status: 400 });
  if (body.position && !VALID_POSITIONS.includes(body.position)) {
    return Response.json({ error: `position must be one of ${VALID_POSITIONS.join(", ")}` }, { status: 400 });
  }
  if (body.primaryColor && !HEX_COLOR.test(body.primaryColor)) {
    return Response.json({ error: "primaryColor must be a 6-digit hex color, e.g. #3454d1" }, { status: 400 });
  }
  if (body.userBubbleColor && !HEX_COLOR.test(body.userBubbleColor)) {
    return Response.json({ error: "userBubbleColor must be a 6-digit hex color, e.g. #13141a" }, { status: 400 });
  }
  if (body.botBubbleColor && !HEX_COLOR.test(body.botBubbleColor)) {
    return Response.json({ error: "botBubbleColor must be a 6-digit hex color, e.g. #f1f2f6" }, { status: 400 });
  }
  if (body.fontFamily && !isWidgetFontKey(body.fontFamily)) {
    return Response.json({ error: "fontFamily is not a supported font" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  if (!await new AgentDefRepository(db, tenant).getLatestPublished(body.agentKey)) {
    return Response.json({ error: `No published agent found for key "${body.agentKey}"` }, { status: 404 });
  }

  const widgetConfigs = new WidgetConfigRepository(db, tenant);
  const existing = await widgetConfigs.getByAgentKey(body.agentKey);
  const config = await widgetConfigs.upsert({
    agentKey: body.agentKey,
    title: body.title?.trim() || "Support",
    greetingText: body.greetingText ?? "",
    primaryColor: body.primaryColor || "#3454d1",
    logoUrl: body.logoUrl?.trim() || null,
    position: body.position ?? "bottom-right",
    fontFamily: (body.fontFamily as WidgetFontKey | undefined) ?? "inter",
    userBubbleColor: body.userBubbleColor || "#13141a",
    botBubbleColor: body.botBubbleColor || "#f1f2f6",
    audienceRules: body.audienceRules,
  });

  new AuditLogRepository(db, tenant).record({
    actorUserId: actor.id,
    action: existing ? "widget_config_updated" : "widget_config_created",
    target: body.agentKey,
  });

  return Response.json({ ok: true, config });
}

/** Rotates a widget's public key — the old key 404s from then on. Never destroys the config itself, only invalidates whatever snippet is already pasted somewhere. */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { agentKey?: string };
  if (!body.agentKey?.trim()) return Response.json({ error: "agentKey is required" }, { status: 400 });

  const { db, tenant } = await getPlatformContext();
  let actor;
  try {
    actor = await requireRole(db, tenant, "admin");
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const config = await new WidgetConfigRepository(db, tenant).rotateKey(body.agentKey);
  if (!config) return Response.json({ error: `No widget found for agent "${body.agentKey}"` }, { status: 404 });

  new AuditLogRepository(db, tenant).record({ actorUserId: actor.id, action: "widget_config_key_rotated", target: body.agentKey });

  return Response.json({ ok: true, config });
}
