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

function num(v: string): number | null {
  return v === "" || v === undefined ? null : Number(v);
}

function str(v: string): string | null {
  return v === "" || v === undefined ? null : v;
}

/**
 * Idempotent load of Amarelle's four CSVs (customers/orders/order_lines/products)
 * into this tenant's business tables. Ported from amarelle-handoff's seed
 * data (returns.csv/tickets.csv intentionally excluded — the tools that
 * read them are deferred past Phase 1).
 */
export function seedAmarelleBusinessData(db: Database.Database, tenantId: string): void {
  const customers = readCsv<Record<string, string>>("customers.csv");
  const orders = readCsv<Record<string, string>>("orders.csv");
  const orderLines = readCsv<Record<string, string>>("order_lines.csv");
  const products = readCsv<Record<string, string>>("products.csv");

  const run = db.transaction(() => {
    db.prepare(`DELETE FROM order_lines WHERE tenant_id = ?`).run(tenantId);
    db.prepare(`DELETE FROM orders WHERE tenant_id = ?`).run(tenantId);
    db.prepare(`DELETE FROM customers WHERE tenant_id = ?`).run(tenantId);
    db.prepare(`DELETE FROM products WHERE tenant_id = ?`).run(tenantId);

    const insertCustomer = db.prepare(
      `INSERT INTO customers (tenant_id, customer_id, first_name, last_name, email, loyalty_tier, loyalty_points, skin_profile, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of customers) {
      insertCustomer.run(tenantId, c.customer_id, c.first_name, c.last_name, c.email, c.loyalty_tier, Number(c.loyalty_points), str(c.skin_profile), str(c.country));
    }

    const insertOrder = db.prepare(
      `INSERT INTO orders (tenant_id, order_id, customer_id, order_date, status, ship_date, delivered_date, eta_date, carrier, tracking_number, shipping_method, subtotal_eur, shipping_eur, tax_eur, total_eur, shipping_address)
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
        Number(o.subtotal_eur),
        Number(o.shipping_eur),
        Number(o.tax_eur),
        Number(o.total_eur),
        str(o.shipping_address),
      );
    }

    const insertLine = db.prepare(
      `INSERT INTO order_lines (tenant_id, line_id, order_id, product_id, sku, product_name, quantity, unit_price_eur, line_total_eur, batch_number, expiry_date, is_opened)
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
        Number(l.unit_price_eur),
        Number(l.line_total_eur),
        str(l.batch_number),
        str(l.expiry_date),
        l.is_opened,
      );
    }

    const insertProduct = db.prepare(
      `INSERT INTO products (tenant_id, product_id, sku, name, product_line, form, key_botanical, concern, suitable_for, price_eur, volume_ml, pao_months, stock_qty, is_refillable, refill_sku, is_gift_with_purchase, shade, contains_essential_oils, vegan, rating, short_description, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of products) {
      insertProduct.run(
        tenantId,
        p.product_id,
        p.sku,
        p.name,
        str(p.product_line),
        str(p.form),
        str(p.key_botanical),
        str(p.concern),
        str(p.suitable_for),
        Number(p.price_eur),
        num(p.volume_ml),
        num(p.pao_months),
        Number(p.stock_qty),
        bool01(p.is_refillable),
        str(p.refill_sku),
        bool01(p.is_gift_with_purchase),
        str(p.shade),
        bool01(p.contains_essential_oils),
        bool01(p.vegan),
        p.rating ? Number(p.rating) : null,
        str(p.short_description),
        str(p.image_url),
      );
    }
  });

  run();
}
