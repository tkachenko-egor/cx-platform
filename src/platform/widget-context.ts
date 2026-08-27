import { getDb } from "../db/client";
import { TenantRepository } from "../db/repositories/tenant-repository";
import { buildContext, type PlatformContext } from "./context";
import type { WidgetPosition, AudienceRules } from "../db/repositories/widget-config-repository";
import type { WidgetFontKey } from "./widget-fonts";

export interface WidgetContext extends PlatformContext {
  widgetConfig: {
    agentKey: string;
    title: string;
    greetingText: string;
    primaryColor: string;
    logoUrl: string | null;
    position: WidgetPosition;
    fontFamily: WidgetFontKey;
    userBubbleColor: string;
    botBubbleColor: string;
    audienceRules: AudienceRules;
  };
}

interface WidgetConfigRow {
  id: string;
  tenant_id: string;
  agent_key: string;
  public_key: string;
  title: string;
  greeting_text: string;
  primary_color: string;
  logo_url: string | null;
  position: WidgetPosition;
  font_family: WidgetFontKey;
  user_bubble_color: string;
  bot_bubble_color: string;
  audience_rules: string;
}

/**
 * Phase 4 M4: the second deliberate, explicitly-named cross-tenant
 * exception in this codebase (the first is src/auth/platform-admin-lookup.ts)
 * — CLAUDE.md invariant #2 exists to close the "forgot to filter" bug
 * class, and this is the one legitimate case where the caller doesn't
 * have a tenant yet to filter by. A widget embedded on a customer's own
 * site has no Host header this platform controls (getPlatformContext()'s
 * subdomain resolution doesn't apply), so the ONLY input is the public
 * key from the embed script — this one raw, unscoped lookup resolves it
 * to a tenant_id, and every read/write after that point goes through the
 * normal TenantScopedRepository path via buildContext(), same as any
 * other request. Not a pattern to copy elsewhere.
 *
 * Deliberately uncached (unlike getPlatformContext's per-slug cache):
 * caching by public_key would need its own invalidation on both key
 * rotation AND provider-credential changes, and a stale cache here means
 * a rotated/revoked key keeps silently working — worse than the small
 * per-request cost of rebuilding a provider adapter (no network calls in
 * these constructors).
 */
export async function getWidgetContext(publicKey: string): Promise<WidgetContext | undefined> {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM widget_configs WHERE public_key = ?`).get(publicKey) as WidgetConfigRow | undefined;
  if (!row) return undefined;

  const tenant = await new TenantRepository(db).getById(row.tenant_id);
  if (!tenant) return undefined;

  const context = await buildContext(tenant, db);
  return {
    ...context,
    widgetConfig: {
      agentKey: row.agent_key,
      title: row.title,
      greetingText: row.greeting_text,
      primaryColor: row.primary_color,
      logoUrl: row.logo_url,
      position: row.position,
      fontFamily: row.font_family,
      userBubbleColor: row.user_bubble_color,
      botBubbleColor: row.bot_bubble_color,
      audienceRules: JSON.parse(row.audience_rules) as AudienceRules,
    },
  };
}
