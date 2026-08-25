import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import { slugify } from "../../core/slugify";

export type ApprovalPolicy = "auto" | "confirm_with_customer" | "require_human_approval";
export type ToolType = "code" | "http";

export interface ToolDef {
  id: string;
  tenantId: string;
  /** Derived from displayName when the tool is created, then immutable — agent_defs.tool_ids, tool_calls rows and write-tool idempotency keys all reference it. */
  key: string;
  /** What admins see and edit. Renaming a tool changes only this. */
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  writeFlag: boolean;
  approvalPolicy: ApprovalPolicy;
  /** 'code' = REGISTRY-defined handler (src/tools/registry.ts), unchanged. 'http' = admin-authored, see src/tools/http-tool-executor.ts. */
  type: ToolType;
  /** HttpToolConfig shape when type === 'http'; {} for 'code'. */
  handlerConfig: Record<string, unknown>;
}

interface ToolDefRow {
  id: string;
  tenant_id: string;
  key: string;
  display_name: string;
  description: string;
  input_schema: string;
  write_flag: number;
  approval_policy: ApprovalPolicy;
  type: ToolType;
  handler_config: string;
}

function rowToToolDef(row: ToolDefRow): ToolDef {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    key: row.key,
    displayName: row.display_name || row.key,
    description: row.description,
    inputSchema: JSON.parse(row.input_schema) as Record<string, unknown>,
    writeFlag: Boolean(row.write_flag),
    approvalPolicy: row.approval_policy,
    type: row.type,
    handlerConfig: JSON.parse(row.handler_config) as Record<string, unknown>,
  };
}

/** FR-8.1: registry metadata. Handlers live in code (src/tools/**), keyed by `key`. */
export class ToolDefRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  upsert(input: {
    key: string;
    displayName?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    writeFlag: boolean;
    approvalPolicy: ApprovalPolicy;
    type?: ToolType;
    handlerConfig?: Record<string, unknown>;
  }): ToolDef {
    const type = input.type ?? "code";
    const handlerConfig = input.handlerConfig ?? {};
    const existing = this.getByKey(input.key);
    const displayName = input.displayName?.trim() || existing?.displayName || input.key;
    if (existing) {
      this.db
        .prepare(
          `UPDATE tool_defs SET display_name = ?, description = ?, input_schema = ?, write_flag = ?, approval_policy = ?, type = ?, handler_config = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(displayName, input.description, JSON.stringify(input.inputSchema), input.writeFlag ? 1 : 0, input.approvalPolicy, type, JSON.stringify(handlerConfig), existing.id, this.tenantId);
      return { ...existing, ...input, displayName, type, handlerConfig };
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tool_defs (id, tenant_id, key, display_name, description, input_schema, write_flag, approval_policy, type, handler_config, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.tenantId,
        input.key,
        displayName,
        input.description,
        JSON.stringify(input.inputSchema),
        input.writeFlag ? 1 : 0,
        input.approvalPolicy,
        type,
        JSON.stringify(handlerConfig),
        new Date().toISOString(),
      );
    return { id, tenantId: this.tenantId, key: input.key, displayName, description: input.description, inputSchema: input.inputSchema, writeFlag: input.writeFlag, approvalPolicy: input.approvalPolicy, type, handlerConfig };
  }

  /**
   * Derives a tool key from an admin-typed name, probing for collisions.
   * Only ever called when creating a tool — a key is immutable afterwards,
   * since agent_defs.tool_ids, tool_calls and idempotency keys reference it.
   */
  generateUniqueKey(alias: string): string {
    const base = slugify(alias) || "tool";
    if (!this.getByKey(base)) return base;
    for (let suffix = 2; suffix < 1000; suffix++) {
      const candidate = `${base}_${suffix}`;
      if (!this.getByKey(candidate)) return candidate;
    }
    return `${base}_${randomUUID().slice(0, 8)}`;
  }

  getByKey(key: string): ToolDef | undefined {
    const row = this.db.prepare(`SELECT * FROM tool_defs WHERE tenant_id = ? AND key = ?`).get(this.tenantId, key) as ToolDefRow | undefined;
    return row ? rowToToolDef(row) : undefined;
  }

  list(): ToolDef[] {
    const rows = this.db.prepare(`SELECT * FROM tool_defs WHERE tenant_id = ?`).all(this.tenantId) as ToolDefRow[];
    return rows.map(rowToToolDef);
  }

  /** Only ever called for type === 'http' rows — code tools have no admin lifecycle (enforced by the caller route, not here). */
  delete(key: string): void {
    this.db.prepare(`DELETE FROM tool_defs WHERE tenant_id = ? AND key = ?`).run(this.tenantId, key);
  }
}

export interface ToolCallRecord {
  id: string;
  runId: string;
  toolKey: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  status: "ok" | "error";
  latencyMs: number;
  idempotencyKey?: string;
}

interface ToolCallRow {
  id: string;
  run_id: string;
  tool_key: string;
  arguments: string;
  result: string;
  status: "ok" | "error";
  latency_ms: number;
  idempotency_key: string | null;
}

function rowToToolCall(row: ToolCallRow): ToolCallRecord {
  return {
    id: row.id,
    runId: row.run_id,
    toolKey: row.tool_key,
    arguments: JSON.parse(row.arguments) as Record<string, unknown>,
    result: JSON.parse(row.result) as Record<string, unknown>,
    status: row.status,
    latencyMs: row.latency_ms,
    idempotencyKey: row.idempotency_key ?? undefined,
  };
}

/** FR-8.10: the audit trail for any action taken on a customer's behalf. */
export class ToolCallRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  record(entry: Omit<ToolCallRecord, "id">): void {
    this.db
      .prepare(
        `INSERT INTO tool_calls (id, tenant_id, run_id, tool_key, arguments, result, status, latency_ms, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        this.tenantId,
        entry.runId,
        entry.toolKey,
        JSON.stringify(entry.arguments),
        JSON.stringify(entry.result),
        entry.status,
        entry.latencyMs,
        entry.idempotencyKey ?? null,
        new Date().toISOString(),
      );
  }

  listByRun(runId: string): ToolCallRecord[] {
    const rows = this.db.prepare(`SELECT * FROM tool_calls WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC`).all(this.tenantId, runId) as ToolCallRow[];
    return rows.map(rowToToolCall);
  }

  /** FR-8.6: look up a prior completed attempt so a retry with the same key never double-executes. */
  findByIdempotencyKey(toolKey: string, idempotencyKey: string): ToolCallRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM tool_calls WHERE tenant_id = ? AND tool_key = ? AND idempotency_key = ? ORDER BY created_at DESC LIMIT 1`)
      .get(this.tenantId, toolKey, idempotencyKey) as ToolCallRow | undefined;
    return row ? rowToToolCall(row) : undefined;
  }
}
