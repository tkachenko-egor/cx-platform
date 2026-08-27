import { randomUUID, randomBytes } from "node:crypto";
import { fromJson } from "../pg";
import type { SqlDatabase } from "../pg";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { WidgetFontKey } from "../../platform/widget-fonts";

export type WidgetPosition = "bottom-right" | "bottom-left";

/** Phase 9: simple `*`-glob path patterns — see app/api/embed-chat/[publicKey]/should-mount/route.ts. Empty/absent urlPatterns means "mount everywhere" (today's only behavior, unchanged). */
export interface AudienceRules {
  urlPatterns?: string[];
}

export interface WidgetConfig {
  id: string;
  tenantId: string;
  agentKey: string;
  publicKey: string;
  title: string;
  greetingText: string;
  primaryColor: string;
  logoUrl: string | null;
  position: WidgetPosition;
  fontFamily: WidgetFontKey;
  userBubbleColor: string;
  botBubbleColor: string;
  audienceRules: AudienceRules;
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

function rowToConfig(row: WidgetConfigRow): WidgetConfig {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentKey: row.agent_key,
    publicKey: row.public_key,
    title: row.title,
    greetingText: row.greeting_text,
    primaryColor: row.primary_color,
    logoUrl: row.logo_url,
    position: row.position,
    fontFamily: row.font_family,
    userBubbleColor: row.user_bubble_color,
    botBubbleColor: row.bot_bubble_color,
    audienceRules: fromJson<AudienceRules>(row.audience_rules),
  };
}

function mintPublicKey(): string {
  return `wgt_${randomBytes(12).toString("base64url")}`;
}

/** Phase 4 M4: staff-facing CRUD, always tenant-scoped. The one public, unscoped lookup an embed needs lives in src/platform/widget-context.ts instead. */
export class WidgetConfigRepository extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async getByAgentKey(agentKey: string): Promise<WidgetConfig | undefined> {
    const row = await this.db.prepare(`SELECT * FROM widget_configs WHERE tenant_id = ? AND agent_key = ?`).get(this.tenantId, agentKey) as WidgetConfigRow | undefined;
    return row ? rowToConfig(row) : undefined;
  }

  /** Creates on first save for an agent that has none yet; updates (never rotates the public_key) otherwise. */
  async upsert(input: {
    agentKey: string;
    title: string;
    greetingText: string;
    primaryColor: string;
    logoUrl: string | null;
    position: WidgetPosition;
    fontFamily: WidgetFontKey;
    userBubbleColor: string;
    botBubbleColor: string;
    audienceRules?: AudienceRules;
  }): Promise<WidgetConfig> {
    const existing = await this.getByAgentKey(input.agentKey);
    const now = new Date().toISOString();
    const audienceRules = input.audienceRules ?? existing?.audienceRules ?? {};
    if (existing) {
      await this.db
        .prepare(
          `UPDATE widget_configs SET title = ?, greeting_text = ?, primary_color = ?, logo_url = ?, position = ?, font_family = ?, user_bubble_color = ?, bot_bubble_color = ?, audience_rules = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(
          input.title,
          input.greetingText,
          input.primaryColor,
          input.logoUrl,
          input.position,
          input.fontFamily,
          input.userBubbleColor,
          input.botBubbleColor,
          JSON.stringify(audienceRules),
          now,
          existing.id,
          this.tenantId,
        );
      return { ...existing, ...input, audienceRules };
    }

    const id = randomUUID();
    const publicKey = mintPublicKey();
    await this.db
      .prepare(
        `INSERT INTO widget_configs (id, tenant_id, agent_key, public_key, title, greeting_text, primary_color, logo_url, position, font_family, user_bubble_color, bot_bubble_color, audience_rules, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.tenantId,
        input.agentKey,
        publicKey,
        input.title,
        input.greetingText,
        input.primaryColor,
        input.logoUrl,
        input.position,
        input.fontFamily,
        input.userBubbleColor,
        input.botBubbleColor,
        JSON.stringify(audienceRules),
        now,
        now,
      );
    return { id, tenantId: this.tenantId, publicKey, ...input, audienceRules };
  }

  /** Invalidates a leaked/scraped key — the old one 404s from then on, the agent keeps its config under a fresh key. */
  async rotateKey(agentKey: string): Promise<WidgetConfig | undefined> {
    const existing = await this.getByAgentKey(agentKey);
    if (!existing) return undefined;
    const publicKey = mintPublicKey();
    await this.db.prepare(`UPDATE widget_configs SET public_key = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(publicKey, new Date().toISOString(), existing.id, this.tenantId);
    return { ...existing, publicKey };
  }
}
