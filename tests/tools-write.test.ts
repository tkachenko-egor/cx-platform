import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ToolDefRepository, ToolCallRepository } from "../src/db/repositories/tool-repository";
import { ToolApprovalRepository } from "../src/db/repositories/tool-approval-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { seedCommerceBusinessData } from "../src/tools/commerce/seed-data";
import { runCancelOrder, cancelOrderToolDef } from "../src/tools/commerce/cancel-order";
import { CommerceRepo } from "../src/tools/commerce/repo";
import { executeTool, executeApprovedTool } from "../src/tools/registry";

beforeAll(async () => {
  process.env.DEMO_DATE = "2026-08-21";
});

const PROCESSING_ORDER = "ORD-100005"; // Processing per data/orders.csv
const DELIVERED_ORDER = "ORD-100001"; // Delivered — cannot be cancelled
const IN_TRANSIT_ORDER = "ORD-100002"; // InTransit — cancellable only if an agent widens mutableStatuses

async function seededTenant() {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  await seedCommerceBusinessData(db, tenant.id);
  return { db, tenant };
}

describe("runCancelOrder", () => {
  it("cancels an order still in Processing status", async () => {
    const { db, tenant } = await seededTenant();
    const result = await runCancelOrder(db, tenant, { order_id: PROCESSING_ORDER });
    expect(result).toEqual({ ok: true, order_id: PROCESSING_ORDER, status: "Cancelled" });
    expect((await new CommerceRepo(db, tenant).findOrder(PROCESSING_ORDER))?.status).toBe("Cancelled");
  });

  it("refuses to cancel an order that has already shipped/delivered", async () => {
    const { db, tenant } = await seededTenant();
    const result = await runCancelOrder(db, tenant, { order_id: DELIVERED_ORDER });
    expect(result.ok).toBe(false);
    expect((await new CommerceRepo(db, tenant).findOrder(DELIVERED_ORDER))?.status).toBe("Delivered");
  });

  it("takes its cancellable statuses from per-agent tool settings", async () => {
    const { db, tenant } = await seededTenant();
    expect((await runCancelOrder(db, tenant, { order_id: IN_TRANSIT_ORDER })).ok).toBe(false);

    const widened = await runCancelOrder(db, tenant, { order_id: IN_TRANSIT_ORDER }, { mutableStatuses: ["Processing", "InTransit"] });
    expect(widened.ok).toBe(true);
    expect((await new CommerceRepo(db, tenant).findOrder(IN_TRANSIT_ORDER))?.status).toBe("Cancelled");
  });
});

describe("executeTool — write-tool idempotency (FR-8.6)", () => {
  it("never re-executes a retry with the same conversation + arguments once the first attempt succeeded", async () => {
    const { db, tenant } = await seededTenant();
    // Default approval_policy is 'auto' when no tool_defs row exists.
    const first = await executeTool(db, tenant, "CONV-1", "run-1", "cancel_order", { order_id: PROCESSING_ORDER });
    expect(first.ok).toBe(true);

    const second = await executeTool(db, tenant, "CONV-1", "run-2", "cancel_order", { order_id: PROCESSING_ORDER });
    expect(second).toEqual(first);

    // Only one tool_calls row should exist for this idempotency key — the retry must not have re-run or re-logged.
    const rows = [...await new ToolCallRepository(db, tenant).listByRun("run-1"), ...await new ToolCallRepository(db, tenant).listByRun("run-2")];
    expect(rows).toHaveLength(1);
  });
});

describe("executeTool — sandbox environment (Phase 7 M2)", () => {
  it("simulates a write tool without mutating anything or ever creating an approval row, regardless of approval_policy", async () => {
    const { db, tenant } = await seededTenant();
    await new ToolDefRepository(db, tenant).upsert({
      key: cancelOrderToolDef.key,
      description: cancelOrderToolDef.description,
      inputSchema: cancelOrderToolDef.inputSchema,
      writeFlag: true,
      approvalPolicy: "require_human_approval",
    });

    const result = await executeTool(db, tenant, "CONV-6", "run-1", "cancel_order", { order_id: PROCESSING_ORDER }, { sandbox: true });

    expect(result).toMatchObject({ ok: true, dryRun: true });
    expect((await new CommerceRepo(db, tenant).findOrder(PROCESSING_ORDER))?.status).toBe("Processing");
    expect(await new ToolApprovalRepository(db, tenant).listPendingByConversation("CONV-6")).toHaveLength(0);

    // Still logged for visibility even though nothing actually ran.
    const rows = await new ToolCallRepository(db, tenant).listByRun("run-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
  });
});

describe("executeTool — confirm_with_customer approval policy (FR-8.5)", () => {
  async function withConfirmPolicy(db: Awaited<ReturnType<typeof seededTenant>>["db"], tenant: Awaited<ReturnType<typeof seededTenant>>["tenant"]) {
    await new ToolDefRepository(db, tenant).upsert({ key: cancelOrderToolDef.key, description: cancelOrderToolDef.description, inputSchema: cancelOrderToolDef.inputSchema, writeFlag: true, approvalPolicy: "confirm_with_customer" });
  }

  it("defers on the first attempt without mutating anything", async () => {
    const { db, tenant } = await seededTenant();
    await withConfirmPolicy(db, tenant);

    const result = await executeTool(db, tenant, "CONV-2", "run-1", "cancel_order", { order_id: PROCESSING_ORDER });
    expect(result).toMatchObject({ ok: false, needsConfirmation: true });
    expect((await new CommerceRepo(db, tenant).findOrder(PROCESSING_ORDER))?.status).toBe("Processing");
  });

  it("still defers on a same-turn retry — the model looping is not the customer confirming", async () => {
    const { db, tenant } = await seededTenant();
    await withConfirmPolicy(db, tenant);

    await executeTool(db, tenant, "CONV-2", "run-1", "cancel_order", { order_id: PROCESSING_ORDER });
    const secondSameTurn = await executeTool(db, tenant, "CONV-2", "run-1", "cancel_order", { order_id: PROCESSING_ORDER });

    expect(secondSameTurn).toMatchObject({ ok: false, needsConfirmation: true });
    expect((await new CommerceRepo(db, tenant).findOrder(PROCESSING_ORDER))?.status).toBe("Processing");
  });

  it("executes once the same request is re-issued in a later turn (the customer's confirmation)", async () => {
    const { db, tenant } = await seededTenant();
    await withConfirmPolicy(db, tenant);
    const approvals = new ToolApprovalRepository(db, tenant);

    await executeTool(db, tenant, "CONV-2", "run-1", "cancel_order", { order_id: PROCESSING_ORDER });
    const pendingApproval = (await approvals.listPendingByConversation("CONV-2"))[0];
    expect(pendingApproval).toBeDefined();

    const confirmed = await executeTool(db, tenant, "CONV-2", "run-2", "cancel_order", { order_id: PROCESSING_ORDER });

    expect(confirmed).toEqual({ ok: true, order_id: PROCESSING_ORDER, status: "Cancelled" });
    expect((await new CommerceRepo(db, tenant).findOrder(PROCESSING_ORDER))?.status).toBe("Cancelled");

    // The approval created on the first attempt is now marked approved, not left pending.
    expect(await approvals.listPendingByConversation("CONV-2")).toHaveLength(0);
    expect((await approvals.get(pendingApproval.id))?.status).toBe("approved");
  });
});

describe("executeTool — require_human_approval approval policy (FR-8.5)", () => {
  async function withHumanApprovalPolicy(db: Awaited<ReturnType<typeof seededTenant>>["db"], tenant: Awaited<ReturnType<typeof seededTenant>>["tenant"]) {
    await new ToolDefRepository(db, tenant).upsert({ key: cancelOrderToolDef.key, description: cancelOrderToolDef.description, inputSchema: cancelOrderToolDef.inputSchema, writeFlag: true, approvalPolicy: "require_human_approval" });
  }

  it("parks the call for a human instead of executing or asking the customer", async () => {
    const { db, tenant } = await seededTenant();
    await withHumanApprovalPolicy(db, tenant);

    const result = await executeTool(db, tenant, "CONV-3", "run-1", "cancel_order", { order_id: PROCESSING_ORDER });
    expect(result).toMatchObject({ ok: false, needsApproval: true });
    expect((await new CommerceRepo(db, tenant).findOrder(PROCESSING_ORDER))?.status).toBe("Processing");

    const pending = await new ToolApprovalRepository(db, tenant).listPendingByConversation("CONV-3");
    expect(pending).toHaveLength(1);
    expect(pending[0].toolKey).toBe("cancel_order");
  });

  it("executes exactly once when staff approve it, and a subsequent executeTool retry returns the cached result", async () => {
    const { db, tenant } = await seededTenant();
    await withHumanApprovalPolicy(db, tenant);
    const staff = await new UserRepository(db, tenant).create({ email: "agent@tenant.demo", passwordHash: "x", role: "agent" });

    await executeTool(db, tenant, "CONV-4", "run-1", "cancel_order", { order_id: PROCESSING_ORDER });
    const approvals = new ToolApprovalRepository(db, tenant);
    const approval = (await approvals.listPendingByConversation("CONV-4"))[0];

    const result = await executeApprovedTool(db, tenant, approval);
    await approvals.markDecided(approval.id, "approved", staff.id);

    expect(result).toEqual({ ok: true, order_id: PROCESSING_ORDER, status: "Cancelled" });
    expect((await approvals.get(approval.id))?.status).toBe("approved");

    // The agent's tool loop might call the same tool again in a later turn before it learns the outcome — must not re-cancel.
    const retry = await executeTool(db, tenant, "CONV-4", "run-2", "cancel_order", { order_id: PROCESSING_ORDER });
    expect(retry).toEqual(result);
  });

  it("tells the model the request was denied, without executing it", async () => {
    const { db, tenant } = await seededTenant();
    await withHumanApprovalPolicy(db, tenant);
    const staff = await new UserRepository(db, tenant).create({ email: "agent@tenant.demo", passwordHash: "x", role: "agent" });

    await executeTool(db, tenant, "CONV-5", "run-1", "cancel_order", { order_id: PROCESSING_ORDER });
    const approvals = new ToolApprovalRepository(db, tenant);
    const approval = (await approvals.listPendingByConversation("CONV-5"))[0];
    await approvals.markDecided(approval.id, "denied", staff.id);

    const retry = await executeTool(db, tenant, "CONV-5", "run-2", "cancel_order", { order_id: PROCESSING_ORDER });
    expect(retry).toMatchObject({ ok: false, denied: true });
    expect((await new CommerceRepo(db, tenant).findOrder(PROCESSING_ORDER))?.status).toBe("Processing");
  });
});
