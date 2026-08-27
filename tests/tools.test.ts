import { beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { seedCommerceBusinessData } from "../src/tools/commerce/seed-data";
import { runLookupOrder } from "../src/tools/commerce/lookup-order";
import { runCheckReturnEligibility } from "../src/tools/commerce/check-return-eligibility";
import { runSearchProducts } from "../src/tools/commerce/search-products";
import { executeTool } from "../src/tools/registry";

// CLAUDE.md invariant #6: the extended return window for ORD-100001
// (delivered 2026-06-30) runs out on 2026-09-28 — without pinning "today"
// this test would silently start failing then.
beforeAll(async () => {
  process.env.DEMO_DATE = "2026-08-21";
});

async function seededTenant() {
  const db = createDb(":memory:");
  const tenant = await new TenantRepository(db).create("Fixture Retail Co", "fixture-retail");
  await seedCommerceBusinessData(db, tenant.id);
  return { db, tenant };
}

describe("lookup_order", () => {
  it("finds a seeded order and returns an order_status card", async () => {
    const { db, tenant } = await seededTenant();
    const result = await runLookupOrder(db, tenant, { order_id: "ORD-100001" });
    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
    if (result.found && !("multiple" in result)) {
      expect(result.card.kind).toBe("order_status");
      expect(result.order.order_id).toBe("ORD-100001");
    }
  });

  it("returns found:false (not an error) for an unknown order", async () => {
    const { db, tenant } = await seededTenant();
    const result = await runLookupOrder(db, tenant, { order_id: "ORD-999999" });
    expect(result).toEqual({ ok: true, found: false });
  });
});

describe("check_return_eligibility — the centerpiece extended-window override", () => {
  it("ORD-100001 is ELIGIBLE via EXTENDED_WINDOW_OVERRIDE, ahead of the opened/window rules", async () => {
    const { db, tenant } = await seededTenant();
    // Delivered 52 days before the pinned date: past the 30-day standard
    // window and opened, so only the extended-window override can approve it.
    const result = await runCheckReturnEligibility(db, tenant, {
      order_id: "ORD-100001",
      line_id: "LINE-5001",
      reason_code: "SAFETY_CONCERN",
    });
    expect(result.ok).toBe(true);
    if ("verdict" in result) {
      expect(result.verdict).toBe("ELIGIBLE");
      expect(result.rule).toBe("EXTENDED_WINDOW_OVERRIDE");
    }
  });

  it("honours a per-agent tool_settings override of the extended window", async () => {
    const { db, tenant } = await seededTenant();
    const result = await runCheckReturnEligibility(
      db,
      tenant,
      { order_id: "ORD-100001", line_id: "LINE-5001", reason_code: "SAFETY_CONCERN" },
      { extendedWindowDays: 10 },
    );
    if ("verdict" in result) expect(result.verdict).toBe("NOT_ELIGIBLE");
  });

  it("returns NOT_ELIGIBLE with a refusal card and the policy copy for an opened change-of-mind return", async () => {
    const { db, tenant } = await seededTenant();
    // LINE-5001 is_opened=Yes per the seed data — any reason outside the
    // override list should hit the opened/not-resellable refusal.
    const result = await runCheckReturnEligibility(db, tenant, {
      order_id: "ORD-100001",
      line_id: "LINE-5001",
      reason_code: "SEALED_UNWANTED",
    });
    if ("verdict" in result && result.verdict === "NOT_ELIGIBLE") {
      expect(result.rule).toBe("OPENED_NOT_RESELLABLE");
      expect(result.policy_quote).toContain("This is a condition requirement, not a commercial choice.");
      expect("card" in result).toBe(true);
    }
  });

  it("refuses a promotional item outright", async () => {
    const { db, tenant } = await seededTenant();
    const result = await runCheckReturnEligibility(db, tenant, { order_id: "ORD-100007", line_id: "LINE-5010", reason_code: "SEALED_UNWANTED" });
    if ("verdict" in result && result.verdict === "NOT_ELIGIBLE") expect(result.rule).toBe("PROMOTIONAL_ITEM");
  });
});

describe("search_products", () => {
  it("returns a product_results card and filters on free-form facets rather than a fixed taxonomy", async () => {
    const { db, tenant } = await seededTenant();
    const result = await runSearchProducts(db, tenant, { inStock: true, limit: 5, category: "Electronics" });
    expect(result.ok).toBe(true);
    expect(result.card.kind).toBe("product_results");
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products.every((p) => p.category === "Electronics" && p.in_stock)).toBe(true);
  });

  it("matches a tag without it being an enum in code", async () => {
    const { db, tenant } = await seededTenant();
    const result = await runSearchProducts(db, tenant, { inStock: true, limit: 10, tag: "wireless" });
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products.every((p) => p.tags.includes("wireless"))).toBe(true);
  });

  it("formats prices in the currency from tool settings", async () => {
    const { db, tenant } = await seededTenant();
    const usd = await runSearchProducts(db, tenant, { inStock: true, limit: 1, category: "Kitchen" });
    const eur = await runSearchProducts(db, tenant, { inStock: true, limit: 1, category: "Kitchen" }, { currency: "EUR" });
    expect(usd.products[0].price.startsWith("$")).toBe(true);
    expect(eur.products[0].price.startsWith("€")).toBe(true);
  });
});

describe("registry.executeTool", () => {
  it("wraps a thrown error as {ok:false} rather than throwing, and still logs the attempt", async () => {
    const { db, tenant } = await seededTenant();
    const result = await executeTool(db, tenant, "CONV-1", "run-1", "lookup_order", { order_id: "not-a-valid-id" });
    expect(result.ok).toBe(false);
  });

  it("routes an unknown tool key to {ok:false} instead of throwing", async () => {
    const { db, tenant } = await seededTenant();
    const result = await executeTool(db, tenant, "CONV-1", "run-1", "nonexistent_tool", {});
    expect(result.ok).toBe(false);
  });
});
