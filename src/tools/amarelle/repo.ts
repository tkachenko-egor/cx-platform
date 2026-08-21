import type Database from "better-sqlite3";
import type { TenantContext } from "../../tenancy/context";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { LoyaltyTier, OpenState, OrderStatus } from "./rules";

export type OrderRow = {
  order_id: string;
  customer_id: string;
  order_date: string;
  status: OrderStatus;
  ship_date: string | null;
  delivered_date: string | null;
  eta_date: string | null;
  carrier: string | null;
  tracking_number: string | null;
  shipping_method: string | null;
  subtotal_eur: number;
  shipping_eur: number;
  tax_eur: number;
  total_eur: number;
  shipping_address: string | null;
};

export type CustomerRow = {
  customer_id: string;
  first_name: string;
  last_name: string;
  email: string;
  loyalty_tier: LoyaltyTier;
  loyalty_points: number;
  skin_profile: string | null;
  country: string | null;
};

export type LineRow = {
  line_id: string;
  order_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_eur: number;
  line_total_eur: number;
  batch_number: string | null;
  expiry_date: string | null;
  is_opened: OpenState;
};

export type ProductRow = {
  product_id: string;
  sku: string;
  name: string;
  product_line: string | null;
  form: string | null;
  key_botanical: string | null;
  concern: string | null;
  suitable_for: string | null;
  price_eur: number;
  volume_ml: number | null;
  pao_months: number | null;
  stock_qty: number;
  is_refillable: number;
  refill_sku: string | null;
  is_gift_with_purchase: number;
  shade: string | null;
  contains_essential_oils: number;
  vegan: number;
  rating: number | null;
  short_description: string | null;
  image_url: string | null;
};

/**
 * Read-only queries over Amarelle's tenant business data
 * (customers/orders/order_lines/products), ported from amarelle-handoff's
 * lib/db/repo.ts and lib/tools/search-products.ts, adapted to the
 * tenant-scoped repository pattern. Tenant data, not platform code — see
 * CLAUDE.md invariant #5.
 */
export class AmarelleRepo extends TenantScopedRepository {
  constructor(db: Database.Database, tenant: TenantContext) {
    super(db, tenant);
  }

  findOrder(orderId: string): OrderRow | undefined {
    return this.db.prepare(`SELECT * FROM orders WHERE tenant_id = ? AND order_id = ?`).get(this.tenantId, orderId) as OrderRow | undefined;
  }

  findCustomer(customerId: string): CustomerRow | undefined {
    return this.db.prepare(`SELECT * FROM customers WHERE tenant_id = ? AND customer_id = ?`).get(this.tenantId, customerId) as CustomerRow | undefined;
  }

  findCustomerByEmail(email: string): CustomerRow | undefined {
    return this.db.prepare(`SELECT * FROM customers WHERE tenant_id = ? AND lower(email) = lower(?)`).get(this.tenantId, email) as CustomerRow | undefined;
  }

  findLinesForOrder(orderId: string): LineRow[] {
    return this.db.prepare(`SELECT * FROM order_lines WHERE tenant_id = ? AND order_id = ?`).all(this.tenantId, orderId) as LineRow[];
  }

  findLine(lineId: string): LineRow | undefined {
    return this.db.prepare(`SELECT * FROM order_lines WHERE tenant_id = ? AND line_id = ?`).get(this.tenantId, lineId) as LineRow | undefined;
  }

  findLineByProductName(orderId: string, productName: string): LineRow | undefined {
    return this.db
      .prepare(`SELECT * FROM order_lines WHERE tenant_id = ? AND order_id = ? AND lower(product_name) = lower(?) LIMIT 1`)
      .get(this.tenantId, orderId, productName) as LineRow | undefined;
  }

  findProduct(productId: string): ProductRow | undefined {
    return this.db.prepare(`SELECT * FROM products WHERE tenant_id = ? AND product_id = ?`).get(this.tenantId, productId) as ProductRow | undefined;
  }

  /** FR-8.5's first real write path — only a `Processing` order can still be cancelled (see cancel-order.ts). */
  cancelOrder(orderId: string): void {
    this.db.prepare(`UPDATE orders SET status = 'Cancelled' WHERE tenant_id = ? AND order_id = ?`).run(this.tenantId, orderId);
  }

  findOrdersByCustomer(customerId: string, limit: number): { orders: OrderRow[]; total: number } {
    const orders = this.db
      .prepare(`SELECT * FROM orders WHERE tenant_id = ? AND customer_id = ? ORDER BY order_date DESC LIMIT ?`)
      .all(this.tenantId, customerId, limit) as OrderRow[];
    const { n } = this.db.prepare(`SELECT COUNT(*) n FROM orders WHERE tenant_id = ? AND customer_id = ?`).get(this.tenantId, customerId) as { n: number };
    return { orders, total: n };
  }

  searchProducts(input: {
    query?: string;
    product_line?: string;
    concern?: string;
    suitable_for?: string;
    max_price_eur?: number;
    vegan_only?: boolean;
    refillable_only?: boolean;
    without_essential_oils?: boolean;
    in_stock_only?: boolean;
    limit: number;
  }): ProductRow[] {
    const clauses: string[] = [`tenant_id = ?`];
    const params: unknown[] = [this.tenantId];

    if (input.query) {
      clauses.push(`(lower(name) LIKE ? OR lower(key_botanical) LIKE ? OR lower(short_description) LIKE ?)`);
      const like = `%${input.query.toLowerCase()}%`;
      params.push(like, like, like);
    }
    if (input.product_line) {
      clauses.push(`product_line = ?`);
      params.push(input.product_line);
    }
    if (input.concern) {
      clauses.push(`concern = ?`);
      params.push(input.concern);
    }
    if (input.suitable_for) {
      // "All skin types" rows must match every specific profile too, or a
      // naive filter silently drops ~1/4 of the catalogue.
      clauses.push(`(suitable_for = ? OR suitable_for = 'All skin types')`);
      params.push(input.suitable_for);
    }
    if (input.max_price_eur !== undefined) {
      clauses.push(`price_eur <= ?`);
      params.push(input.max_price_eur);
    }
    if (input.vegan_only) clauses.push(`vegan = 1`);
    if (input.refillable_only) clauses.push(`is_refillable = 1`);
    if (input.without_essential_oils) clauses.push(`contains_essential_oils = 0`);
    if (input.in_stock_only) clauses.push(`stock_qty > 0`);

    const where = `WHERE ${clauses.join(" AND ")}`;
    return this.db.prepare(`SELECT * FROM products ${where} ORDER BY rating DESC LIMIT ?`).all(...params, input.limit) as ProductRow[];
  }
}
