import { z } from "zod";
import type Database from "better-sqlite3";
import type { TenantContext } from "../../tenancy/context";
import { AmarelleRepo } from "./repo";
import { money } from "./format";
import type { ProductResultCard } from "./cards";

export const PRODUCT_LINES = ["Face care", "Body care", "Hair care", "Fragrance", "Makeup", "Men"] as const;
export const CONCERNS = ["Firming", "Protection", "Hydration", "Repair", "Anti-ageing", "Purifying", "Radiance", "Soothing"] as const;
export const SKIN_PROFILES = ["Normal", "Dry", "Oily", "Combination", "Sensitive", "Mature", "All skin types"] as const;

export const searchProductsInputSchema = z.object({
  query: z.string().optional(),
  product_line: z.enum(PRODUCT_LINES).optional(),
  concern: z.enum(CONCERNS).optional(),
  suitable_for: z.enum(SKIN_PROFILES).optional(),
  max_price_eur: z.number().optional(),
  vegan_only: z.boolean().optional(),
  refillable_only: z.boolean().optional(),
  without_essential_oils: z.boolean().optional(),
  in_stock_only: z.boolean().default(true),
  limit: z.number().int().max(10).default(5),
});

export type SearchProductsInput = z.infer<typeof searchProductsInputSchema>;

export const searchProductsToolDef = {
  key: "search_products",
  description:
    "Use when a customer is looking for a product by skin type, concern, product line, botanical ingredient, or price — rather than asking about an order they already placed. Also use when you need a product's attributes to answer an ingredient or suitability question.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Free text matched against name, botanical and description" },
      product_line: { type: "string", enum: PRODUCT_LINES },
      concern: { type: "string", enum: CONCERNS },
      suitable_for: { type: "string", enum: SKIN_PROFILES },
      max_price_eur: { type: "number" },
      vegan_only: { type: "boolean" },
      refillable_only: { type: "boolean" },
      without_essential_oils: { type: "boolean", description: "Use for pregnancy-adjacent questions — but still refer the customer to a professional rather than advising." },
      in_stock_only: { type: "boolean", default: true },
      limit: { type: "integer", default: 5, maximum: 10 },
    },
  },
};

export function runSearchProducts(db: Database.Database, tenant: TenantContext, input: SearchProductsInput) {
  const repo = new AmarelleRepo(db, tenant);
  const rows = repo.searchProducts(input);

  const products = rows.map((p) => ({
    product_id: p.product_id,
    sku: p.sku,
    name: p.name,
    product_line: p.product_line,
    form: p.form,
    key_botanical: p.key_botanical,
    concern: p.concern,
    suitable_for: p.suitable_for,
    price_eur: money(p.price_eur),
    volume_ml: p.volume_ml,
    pao_months: p.pao_months,
    stock_qty: p.stock_qty,
    in_stock: p.stock_qty > 0,
    is_refillable: Boolean(p.is_refillable),
    refill_sku: p.refill_sku,
    is_gift_with_purchase: Boolean(p.is_gift_with_purchase),
    shade: p.shade,
    contains_essential_oils: Boolean(p.contains_essential_oils),
    vegan: Boolean(p.vegan),
    rating: p.rating,
    short_description: p.short_description,
    url: `/products/${p.product_id}`,
  }));

  const card: ProductResultCard[] = rows.map((p) => ({
    product_id: p.product_id,
    name: p.name,
    product_line: p.product_line,
    price_eur: money(p.price_eur),
    volume_ml: p.volume_ml,
    key_botanical: p.key_botanical,
    suitable_for: p.suitable_for,
    in_stock: p.stock_qty > 0,
    image_url: p.image_url,
    url: `/products/${p.product_id}`,
  }));

  return { ok: true as const, count: products.length, products, card: { kind: "product_results" as const, data: card } };
}
