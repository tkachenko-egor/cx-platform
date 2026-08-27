import type Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

function readCsv<T extends Record<string, string>>(file: string): T[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
  return parse(raw, { columns: true, skip_empty_lines: true }) as T[];
}

function bool01(v: string): number {
  return v === "Yes" ? 1 : 0;
}

function str(v: string): string | null {
  return v === "" || v === undefined ? null : v;
}

/**
 * Idempotent load of the four fixture CSVs
 * (customers/orders/order_lines/products) into a tenant's commerce tables —
 * generic sample retail data, the starting point any tenant replaces with
 * its own.
 */
export function seedCommerceBusinessData(db: Database.Database, tenantId: string): void {
  const customers = readCsv<Record<string, string>>("customers.csv");
  const orders = readCsv<Record<string, string>>("orders.csv");
  const orderLines = readCsv<Record<string, string>>("order_lines.csv");
  const products = readCsv<Record<string, string>>("products.csv");

  // B1: real async tx, pinned pooled client — sync better-sqlite3 tx for now.
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM order_lines WHERE tenant_id = ?`).run(tenantId);
    db.prepare(`DELETE FROM orders WHERE tenant_id = ?`).run(tenantId);
    db.prepare(`DELETE FROM customers WHERE tenant_id = ?`).run(tenantId);
    db.prepare(`DELETE FROM products WHERE tenant_id = ?`).run(tenantId);

    const insertCustomer = db.prepare(
      `INSERT INTO customers (tenant_id, customer_id, first_name, last_name, email, loyalty_tier, loyalty_points, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of customers) {
      insertCustomer.run(tenantId, c.customer_id, c.first_name, c.last_name, c.email, c.loyalty_tier, Number(c.loyalty_points), str(c.country));
    }

    const insertOrder = db.prepare(
      `INSERT INTO orders (tenant_id, order_id, customer_id, order_date, status, ship_date, delivered_date, eta_date, carrier, tracking_number, shipping_method, subtotal_amount, shipping_amount, tax_amount, total_amount, shipping_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const o of orders) {
      insertOrder.run(
        tenantId,
        o.order_id,
        o.customer_id,
        o.order_date,
        o.status,
        str(o.ship_date),
        str(o.delivered_date),
        str(o.eta_date),
        str(o.carrier),
        str(o.tracking_number),
        str(o.shipping_method),
        Number(o.subtotal_amount),
        Number(o.shipping_amount),
        Number(o.tax_amount),
        Number(o.total_amount),
        str(o.shipping_address),
      );
    }

    const insertLine = db.prepare(
      `INSERT INTO order_lines (tenant_id, line_id, order_id, product_id, sku, product_name, quantity, unit_price, line_total, batch_number, expiry_date, is_opened)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of orderLines) {
      insertLine.run(
        tenantId,
        l.line_id,
        l.order_id,
        l.product_id,
        l.sku,
        l.product_name,
        Number(l.quantity),
        Number(l.unit_price),
        Number(l.line_total),
        str(l.batch_number),
        str(l.expiry_date),
        l.is_opened,
      );
    }

    const insertProduct = db.prepare(
      `INSERT INTO products (tenant_id, product_id, sku, name, category, tags, price, stock_qty, is_promotional_item, rating, short_description, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of products) {
      insertProduct.run(
        tenantId,
        p.product_id,
        p.sku,
        p.name,
        str(p.category),
        str(p.tags),
        Number(p.price),
        Number(p.stock_qty),
        bool01(p.is_promotional_item),
        p.rating ? Number(p.rating) : null,
        str(p.short_description),
        str(p.image_url),
      );
    }
  });

  run();
}
