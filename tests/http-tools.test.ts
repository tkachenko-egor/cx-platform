import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ToolDefRepository, ToolCallRepository } from "../src/db/repositories/tool-repository";
import { ToolApprovalRepository } from "../src/db/repositories/tool-approval-repository";
import { ProviderCredentialRepository } from "../src/db/repositories/provider-credential-repository";
import { UserRepository } from "../src/db/repositories/user-repository";
import { executeTool } from "../src/tools/registry";

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seededTenant() {
  const db = createDb(":memory:");
  const tenant = new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  return { db, tenant };
}

const READ_ONLY_SCHEMA = { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] };

describe("http tools — resolveToolSpec finds a DB-defined 'http' tool_defs row (no REGISTRY entry)", () => {
  it("executes a GET request and returns { ok: true, data } from the response", async () => {
    const { db, tenant } = seededTenant();
    new ToolDefRepository(db, tenant).upsert({
      key: "check_shipping_status",
      description: "Checks shipping status",
      inputSchema: READ_ONLY_SCHEMA,
      writeFlag: false,
      approvalPolicy: "auto",
      type: "http",
      handlerConfig: { url: "https://carrier.example.com/status", method: "GET", argsLocation: "query" },
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "in_transit" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeTool(db, tenant, "CONV-1", "run-1", "check_shipping_status", { order_id: "ORD-1" });

    expect(result).toEqual({ ok: true, status: 200, data: { status: "in_transit" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toContain("order_id=ORD-1");

    // FR-8.10: every call is logged, same as a code tool.
    const logged = new ToolCallRepository(db, tenant).listByRun("run-1");
    expect(logged).toHaveLength(1);
    expect(logged[0].status).toBe("ok");
  });

  it("returns { ok: false } instead of throwing when the endpoint errors, and still logs it", async () => {
    const { db, tenant } = seededTenant();
    new ToolDefRepository(db, tenant).upsert({
      key: "check_shipping_status",
      description: "Checks shipping status",
      inputSchema: READ_ONLY_SCHEMA,
      writeFlag: false,
      approvalPolicy: "auto",
      type: "http",
      handlerConfig: { url: "https://carrier.example.com/status", method: "GET", argsLocation: "query" },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));

    const result = await executeTool(db, tenant, "CONV-1", "run-1", "check_shipping_status", { order_id: "ORD-1" });
    expect(result.ok).toBe(false);

    const logged = new ToolCallRepository(db, tenant).listByRun("run-1");
    expect(logged[0].status).toBe("error");
  });

  it("injects a tool_integration credential as a bearer token", async () => {
    const { db, tenant } = seededTenant();
    const owner = new UserRepository(db, tenant).create({ email: "owner@demo.test", passwordHash: "x", role: "owner" });
    const credential = new ProviderCredentialRepository(db, tenant).createToolCredential({ provider: "carrier", label: "Carrier key", plaintextKey: "carrier-secret-token", ownerUserId: owner.id });
    new ToolDefRepository(db, tenant).upsert({
      key: "check_shipping_status",
      description: "Checks shipping status",
      inputSchema: READ_ONLY_SCHEMA,
      writeFlag: false,
      approvalPolicy: "auto",
      type: "http",
      handlerConfig: { url: "https://carrier.example.com/status", method: "POST", argsLocation: "body", credentialId: credential.id, authStyle: "bearer" },
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await executeTool(db, tenant, "CONV-1", "run-1", "check_shipping_status", { order_id: "ORD-1" });

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer carrier-secret-token");
  });
});

describe("http tools — write-flag + approval-policy gate applies unchanged (invariant #7)", () => {
  it("a write-flagged HTTP tool with confirm_with_customer defers instead of calling fetch", async () => {
    const { db, tenant } = seededTenant();
    new ToolDefRepository(db, tenant).upsert({
      key: "cancel_shipment",
      description: "Cancels a shipment",
      inputSchema: READ_ONLY_SCHEMA,
      writeFlag: true,
      approvalPolicy: "confirm_with_customer",
      type: "http",
      handlerConfig: { url: "https://carrier.example.com/cancel", method: "POST" },
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeTool(db, tenant, "CONV-2", "run-1", "cancel_shipment", { order_id: "ORD-1" });

    expect(result).toMatchObject({ ok: false, needsConfirmation: true });
    expect(fetchMock).not.toHaveBeenCalled();

    const pending = new ToolApprovalRepository(db, tenant).listPendingByConversation("CONV-2");
    expect(pending).toHaveLength(1);
    expect(pending[0].toolKey).toBe("cancel_shipment");
  });

  it("executes once the same request is re-issued in a later turn, same as a code write tool", async () => {
    const { db, tenant } = seededTenant();
    new ToolDefRepository(db, tenant).upsert({
      key: "cancel_shipment",
      description: "Cancels a shipment",
      inputSchema: READ_ONLY_SCHEMA,
      writeFlag: true,
      approvalPolicy: "confirm_with_customer",
      type: "http",
      handlerConfig: { url: "https://carrier.example.com/cancel", method: "POST" },
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cancelled: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await executeTool(db, tenant, "CONV-2", "run-1", "cancel_shipment", { order_id: "ORD-1" });
    expect(fetchMock).not.toHaveBeenCalled();

    const confirmed = await executeTool(db, tenant, "CONV-2", "run-2", "cancel_shipment", { order_id: "ORD-1" });
    expect(confirmed).toEqual({ ok: true, status: 200, data: { cancelled: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("http tools — deleting a tool degrades like a removed REGISTRY entry, never a crash", () => {
  it("an unknown/deleted http tool key returns { ok: false } via the same 'Unknown tool' path", async () => {
    const { db, tenant } = seededTenant();
    const result = await executeTool(db, tenant, "CONV-1", "run-1", "never_created", { order_id: "ORD-1" });
    expect(result).toEqual({ ok: false, error: "Unknown tool: never_created" });
  });
});
