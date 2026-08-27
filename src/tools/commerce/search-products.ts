import { z } from "zod";import type { TenantContext } from "../../tenancy/context";
import type { SqlDatabase } from "../../db/pg";
import { CommerceRepo } from "./repo";
import { DEFAULT_CURRENCY, formatMoney } from "./format";
import type { ProductResultCard } from "../cards";

export const searchProductsInputSchema = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  priceMax: z.number().optional(),
  inStock: z.boolean().default(true),
  limit: z.number().int().max(10).default(5),
});

export type SearchProductsInput = z.infer<typeof searchProductsInputSchema>;

export const searchProductsToolDef = {
  key: "search_products",
  displayName: "Search Products",
  description:
    "Use when a customer is looking for a product by name, category, attribute or price — rather than asking about an order they already placed. Also use when you need a product's attributes to answer a question about it.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Free text matched against the product name, tags and description" },
      category: { type: "string", description: "Exact category match, e.g. Electronics" },
      tag: { type: "string", description: "A single catalogue tag, e.g. wireless" },
      priceMax: { type: "number", description: "Highest price to include" },
      inStock: { type: "boolean", default: true },
      limit: { type: "integer", default: 5, maximum: 10 },
    },
  },
};

/** Per-agent overrides live in agent_defs.tool_settings.search_products. */
export interface SearchProductsSettings {
  currency: string;
}

export function resolveSearchProductsSettings(settings?: Record<string, unknown>): SearchProductsSettings {
  const currency = typeof settings?.currency === "string" && settings.currency.trim() ? settings.currency.trim() : DEFAULT_CURRENCY;
  return { currency };
}

function splitTags(tags: string | null): string[] {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function runSearchProducts(db: SqlDatabase, tenant: TenantContext, input: SearchProductsInput, settings?: Record<string, unknown>) {
  const { currency } = resolveSearchProductsSettings(settings);
  const repo = new CommerceRepo(db, tenant);
  const rows = await repo.searchProducts(input);

  const products = rows.map((p) => ({
    product_id: p.product_id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    tags: splitTags(p.tags),
    currency,
    price: formatMoney(p.price, currency),
    stock_qty: p.stock_qty,
    in_stock: p.stock_qty > 0,
    is_promotional_item: Boolean(p.is_promotional_item),
    rating: p.rating,
    short_description: p.short_description,
    url: `/products/${p.product_id}`,
  }));

  const card: ProductResultCard[] = rows.map((p) => ({
    product_id: p.product_id,
    name: p.name,
    category: p.category,
    price: formatMoney(p.price, currency),
    currency,
    tags: splitTags(p.tags),
    in_stock: p.stock_qty > 0,
    image_url: p.image_url,
    url: `/products/${p.product_id}`,
  }));

  return { ok: true as const, count: products.length, products, card: { kind: "product_results" as const, data: card } };
}
