import type { TenantContext } from "../../tenancy/context";
import type { SqlDatabase } from "../../db/pg";
import { TenantScopedRepository } from "../../tenancy/repository";
import type { OpenState, OrderStatus } from "./rules";

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
  subtotal_amount: number;
  shipping_amount: number;
  tax_amount: number;
  total_amount: number;
  shipping_address: string | null;
};

export type CustomerRow = {
  customer_id: string;
  first_name: string;
  last_name: string;
  email: string;
  loyalty_tier: string;
  loyalty_points: number;
  country: string | null;
};

export type LineRow = {
  line_id: string;
  order_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  batch_number: string | null;
  expiry_date: string | null;
  is_opened: OpenState;
};

export type ProductRow = {
  product_id: string;
  sku: string;
  name: string;
  category: string | null;
  tags: string | null;
  price: number;
  stock_qty: number;
  is_promotional_item: boolean;
  rating: number | null;
  short_description: string | null;
  image_url: string | null;
};

/** Read-only queries over the generic commerce tables the built-in toolkit reads. */
export class CommerceRepo extends TenantScopedRepository {
  constructor(db: SqlDatabase, tenant: TenantContext) {
    super(db, tenant);
  }

  async findOrder(orderId: string): Promise<OrderRow | undefined> {
    return await this.db.prepare(`SELECT * FROM orders WHERE tenant_id = ? AND order_id = ?`).get(this.tenantId, orderId) as OrderRow | undefined;
  }

  async findCustomer(customerId: string): Promise<CustomerRow | undefined> {
    return await this.db.prepare(`SELECT * FROM customers WHERE tenant_id = ? AND customer_id = ?`).get(this.tenantId, customerId) as CustomerRow | undefined;
  }

  async findCustomerByEmail(email: string): Promise<CustomerRow | undefined> {
    return await this.db.prepare(`SELECT * FROM customers WHERE tenant_id = ? AND lower(email) = lower(?)`).get(this.tenantId, email) as CustomerRow | undefined;
  }

  async findLinesForOrder(orderId: string): Promise<LineRow[]> {
    return await this.db.prepare(`SELECT * FROM order_lines WHERE tenant_id = ? AND order_id = ?`).all(this.tenantId, orderId) as LineRow[];
  }

  async findLine(lineId: string): Promise<LineRow | undefined> {
    return await this.db.prepare(`SELECT * FROM order_lines WHERE tenant_id = ? AND line_id = ?`).get(this.tenantId, lineId) as LineRow | undefined;
  }

  async findLineByProductName(orderId: string, productName: string): Promise<LineRow | undefined> {
    return await this.db
      .prepare(`SELECT * FROM order_lines WHERE tenant_id = ? AND order_id = ? AND lower(product_name) = lower(?) LIMIT 1`)
      .get(this.tenantId, orderId, productName) as LineRow | undefined;
  }

  async findProduct(productId: string): Promise<ProductRow | undefined> {
    return await this.db.prepare(`SELECT * FROM products WHERE tenant_id = ? AND product_id = ?`).get(this.tenantId, productId) as ProductRow | undefined;
  }

  /** FR-8.5's first real write path — see cancel-order.ts for the status gate around it. */
  async cancelOrder(orderId: string): Promise<void> {
    await this.db.prepare(`UPDATE orders SET status = 'Cancelled' WHERE tenant_id = ? AND order_id = ?`).run(this.tenantId, orderId);
  }

  async findOrdersByCustomer(customerId: string, limit: number): Promise<{ orders: OrderRow[]; total: number }> {
    const orders = await this.db
      .prepare(`SELECT * FROM orders WHERE tenant_id = ? AND customer_id = ? ORDER BY order_date DESC LIMIT ?`)
      .all(this.tenantId, customerId, limit) as OrderRow[];
    const { n } = await this.db.prepare(`SELECT COUNT(*) n FROM orders WHERE tenant_id = ? AND customer_id = ?`).get(this.tenantId, customerId) as { n: number };
    return { orders, total: n };
  }

  /** Free-form facets only — no fixed vertical taxonomy, so any tenant's catalogue works unchanged. */
  async searchProducts(input: { query?: string; category?: string; tag?: string; priceMax?: number; inStock?: boolean; limit: number }): Promise<ProductRow[]> {
    const clauses: string[] = [`tenant_id = ?`];
    const params: unknown[] = [this.tenantId];

    if (input.query) {
      clauses.push(`(lower(name) LIKE ? OR lower(coalesce(tags, '')) LIKE ? OR lower(coalesce(short_description, '')) LIKE ?)`);
      const like = `%${input.query.toLowerCase()}%`;
      params.push(like, like, like);
    }
    if (input.category) {
      clauses.push(`lower(coalesce(category, '')) = lower(?)`);
      params.push(input.category);
    }
    if (input.tag) {
      clauses.push(`lower(coalesce(tags, '')) LIKE ?`);
      params.push(`%${input.tag.toLowerCase()}%`);
    }
    if (input.priceMax !== undefined) {
      clauses.push(`price <= ?`);
      params.push(input.priceMax);
    }
    if (input.inStock) clauses.push(`stock_qty > 0`);

    const where = `WHERE ${clauses.join(" AND ")}`;
    return await this.db.prepare(`SELECT * FROM products ${where} ORDER BY rating DESC LIMIT ?`).all(...params, input.limit) as ProductRow[];
  }
}
