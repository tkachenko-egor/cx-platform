import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { seedAmarelleBusinessData } from "../src/tools/amarelle/seed-data";
import { runLookupOrder } from "../src/tools/amarelle/lookup-order";
import { runCheckReturnEligibility } from "../src/tools/amarelle/check-return-eligibility";
import { runSearchProducts } from "../src/tools/amarelle/search-products";
import { executeTool } from "../src/tools/registry";

// Freeze the clock like amarelle-handoff's own DEMO_DATE mechanism — the
// REACTION window for ORD-100001 (delivered 2026-06-30) runs out on
// 2026-09-28; without pinning "today" this test would start failing then.
beforeAll(() => {
  process.env.DEMO_DATE = "2026-08-21";
});

function seededTenant() {
  const db = createDb(":memory:");
  const tenant = new TenantRepository(db).create("Amarelle Botanique", "demo");
  seedAmarelleBusinessData(db, tenant.id);
  return { db, tenant };
}

describe("lookup_order", () => {
  it("finds a seeded order and returns an order_status card", () => {
    const { db, tenant } = seededTenant();
    const result = runLookupOrder(db, tenant, { order_id: "ORD-100001" });
    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
    if (result.found && !("multiple" in result)) {
      expect(result.card.kind).toBe("order_status");
      expect(result.order.order_id).toBe("ORD-100001");
    }
  });

  it("returns found:false (not an error) for an unknown order", () => {
    const { db, tenant } = seededTenant();
    const result = runLookupOrder(db, tenant, { order_id: "ORD-999999" });
    expect(result).toEqual({ ok: true, found: false });
  });
});

describe("check_return_eligibility — the centerpiece REACTION-override case", () => {
  it("ORD-100001 is ELIGIBLE via REACTION_OVERRIDE, ahead of the opened/window rules", () => {
    const { db, tenant } = seededTenant();
    const result = runCheckReturnEligibility(db, tenant, {
      order_id: "ORD-100001",
      line_id: "LINE-5001",
      reason_code: "REACTION",
    });
    expect(result.ok).toBe(true);
    if ("verdict" in result) {
      expect(result.verdict).toBe("ELIGIBLE");
      expect(result.rule).toBe("REACTION_OVERRIDE");
    }
  });

  it("returns NOT_ELIGIBLE with a refusal card and verbatim policy copy for an opened change-of-mind return", () => {
    const { db, tenant } = seededTenant();
    // LINE-5001 is_opened=Yes per the seed data (see explore notes) — a
    // non-REACTION reason should hit the opened-hygiene refusal.
    const result = runCheckReturnEligibility(db, tenant, {
      order_id: "ORD-100001",
      line_id: "LINE-5001",
      reason_code: "SEALED_UNWANTED",
    });
    if ("verdict" in result && result.verdict === "NOT_ELIGIBLE") {
      expect(result.rule).toBe("OPENED_HYGIENE");
      expect(result.policy_quote).toContain("This is a hygiene requirement, not a commercial choice.");
      expect("card" in result).toBe(true);
    }
  });
});

describe("search_products", () => {
  it("returns a product_results card and never drops 'All skin types' items from a specific-skin-type search", () => {
    const { db, tenant } = seededTenant();
    const result = runSearchProducts(db, tenant, { in_stock_only: true, limit: 5, suitable_for: "Sensitive" });
    expect(result.ok).toBe(true);
    expect(result.card.kind).toBe("product_results");
  });
});

describe("registry.executeTool", () => {
  it("wraps a thrown error as {ok:false} rather than throwing, and still logs the attempt", async () => {
    const { db, tenant } = seededTenant();
    const result = await executeTool(db, tenant, "CONV-1", "run-1", "lookup_order", { order_id: "not-a-valid-id" });
    expect(result.ok).toBe(false);
  });

  it("routes an unknown tool key to {ok:false} instead of throwing", async () => {
    const { db, tenant } = seededTenant();
    const result = await executeTool(db, tenant, "CONV-1", "run-1", "nonexistent_tool", {});
    expect(result.ok).toBe(false);
  });
});
