import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";

export type ApprovalPolicy = "auto" | "confirm_with_customer" | "require_human_approval";

export interface ToolDef {
  id: string;
  tenantId: string;
  key: string;
  description: string;
  inputSchema: Record<string, unknown>;
  writeFlag: boolean;
  approvalPolicy: ApprovalPolicy;
}

interface ToolDefRow {
  id: string;
  tenant_id: string;
  key: string;
  description: string;
  input_schema: string;
  write_flag: number;
  approval_policy: ApprovalPolicy;
}

function rowToToolDef(row: ToolDefRow): ToolDef {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    key: row.key,
    description: row.description,
    inputSchema: JSON.parse(row.input_schema) as Record<string, unknown>,
    writeFlag: Boolean(row.write_flag),
    approvalPolicy: row.approval_policy,
  };
}

/** FR-8.1: registry metadata. Handlers live in code (src/tools/**), keyed by `key`. */
export class ToolDefRepository extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  upsert(input: {
    key: string;
    description: string;
    inputSchema: Record<string, unknown>;
    writeFlag: boolean;
    approvalPolicy: ApprovalPolicy;
  }): ToolDef {
    const existing = this.getByKey(input.key);
    if (existing) {
      this.db
        .prepare(
          `UPDATE tool_defs SET description = ?, input_schema = ?, write_flag = ?, approval_policy = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(input.description, JSON.stringify(input.inputSchema), input.writeFlag ? 1 : 0, input.approvalPolicy, existing.id, this.tenantId);
      return { ...existing, ...input };
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tool_defs (id, tenant_id, key, description, input_schema, write_flag, approval_policy, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.tenantId, input.key, input.description, JSON.stringify(input.inputSchema), input.writeFlag ? 1 : 0, input.approvalPolicy, new Date().toISOString());
    return { id, tenantId: this.tenantId, ...input };
  }

  getByKey(key: string): ToolDef | undefined {
    const row = this.db.prepare(`SELECT * FROM tool_defs WHERE tenant_id = ? AND key = ?`).get(this.tenantId, key) as ToolDefRow | undefined;
    return row ? rowToToolDef(row) : undefined;
  }

  list(): ToolDef[] {
    const rows = this.db.prepare(`SELECT * FROM tool_defs WHERE tenant_id = ?`).all(this.tenantId) as ToolDefRow[];
    return rows.map(rowToToolDef);
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
}

interface ToolCallRow {
  id: string;
  run_id: string;
  tool_key: string;
  arguments: string;
  result: string;
  status: "ok" | "error";
  latency_ms: number;
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
        `INSERT INTO tool_calls (id, tenant_id, run_id, tool_key, arguments, result, status, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        new Date().toISOString(),
      );
  }

  listByRun(runId: string): ToolCallRecord[] {
    const rows = this.db.prepare(`SELECT * FROM tool_calls WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC`).all(this.tenantId, runId) as ToolCallRow[];
    return rows.map(rowToToolCall);
  }
}
