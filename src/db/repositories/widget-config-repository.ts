import type Database from "better-sqlite3";
import { randomUUID, randomBytes } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export type WidgetPosition = "bottom-right" | "bottom-left";

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
  };
}

function mintPublicKey(): string {
  return `wgt_${randomBytes(12).toString("base64url")}`;
}

/** Phase 4 M4: staff-facing CRUD, always tenant-scoped. The one public, unscoped lookup an embed needs lives in src/platform/widget-context.ts instead. */
export class WidgetConfigRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  getByAgentKey(agentKey: string): WidgetConfig | undefined {
    const row = this.db.prepare(`SELECT * FROM widget_configs WHERE tenant_id = ? AND agent_key = ?`).get(this.tenantId, agentKey) as WidgetConfigRow | undefined;
    return row ? rowToConfig(row) : undefined;
  }

  /** Creates on first save for an agent that has none yet; updates (never rotates the public_key) otherwise. */
  upsert(input: { agentKey: string; title: string; greetingText: string; primaryColor: string; logoUrl: string | null; position: WidgetPosition }): WidgetConfig {
    const existing = this.getByAgentKey(input.agentKey);
    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare(
          `UPDATE widget_configs SET title = ?, greeting_text = ?, primary_color = ?, logo_url = ?, position = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(input.title, input.greetingText, input.primaryColor, input.logoUrl, input.position, now, existing.id, this.tenantId);
      return { ...existing, ...input };
    }

    const id = randomUUID();
    const publicKey = mintPublicKey();
    this.db
      .prepare(
        `INSERT INTO widget_configs (id, tenant_id, agent_key, public_key, title, greeting_text, primary_color, logo_url, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.agentKey, publicKey, input.title, input.greetingText, input.primaryColor, input.logoUrl, input.position, now, now);
    return { id, tenantId: this.tenantId, publicKey, ...input };
  }

  /** Invalidates a leaked/scraped key — the old one 404s from then on, the agent keeps its config under a fresh key. */
  rotateKey(agentKey: string): WidgetConfig | undefined {
    const existing = this.getByAgentKey(agentKey);
    if (!existing) return undefined;
    const publicKey = mintPublicKey();
    this.db.prepare(`UPDATE widget_configs SET public_key = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(publicKey, new Date().toISOString(), existing.id, this.tenantId);
    return { ...existing, publicKey };
  }
}
