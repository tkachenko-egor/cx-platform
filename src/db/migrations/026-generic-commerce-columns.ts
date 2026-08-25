import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/**
 * Makes the commerce domain tables vertical-neutral: the cosmetics-only
 * columns the first tenant's catalogue needed are dropped, the
 * currency-baked-in money columns are renamed to plain amounts (the currency
 * they render in is per-agent tool settings now, see
 * src/tools/commerce/format.ts), and products gains a free-form `tags`
 * column so a catalogue can carry any vertical's facets without a schema
 * change.
 *
 * Every statement is guarded on PRAGMA table_info so this is idempotent and
 * safe against a DB created from the post-change schema.sql (where the
 * columns already have their new shape). DROP/RENAME COLUMN need SQLite
 * >= 3.35; better-sqlite3 13 ships 3.53.
 */

const DROPPED_PRODUCT_COLUMNS = ["form", "key_botanical", "concern", "suitable_for", "volume_ml", "pao_months", "is_refillable", "refill_sku", "shade", "contains_essential_oils", "vegan"];

export const migration026GenericCommerceColumns: Migration = {
  id: "026_generic_commerce_columns",
  up(db: Database.Database) {
    const columnsOf = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

    const renameIfPresent = (table: string, from: string, to: string) => {
      const columns = columnsOf(table);
      if (columns.includes(from) && !columns.includes(to)) db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
    };
    const dropIfPresent = (table: string, column: string) => {
      if (columnsOf(table).includes(column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    };

    dropIfPresent("customers", "skin_profile");

    renameIfPresent("orders", "subtotal_eur", "subtotal_amount");
    renameIfPresent("orders", "shipping_eur", "shipping_amount");
    renameIfPresent("orders", "tax_eur", "tax_amount");
    renameIfPresent("orders", "total_eur", "total_amount");

    renameIfPresent("order_lines", "unit_price_eur", "unit_price");
    renameIfPresent("order_lines", "line_total_eur", "line_total");

    renameIfPresent("products", "product_line", "category");
    renameIfPresent("products", "price_eur", "price");
    renameIfPresent("products", "is_gift_with_purchase", "is_promotional_item");
    if (!columnsOf("products").includes("tags")) db.exec(`ALTER TABLE products ADD COLUMN tags TEXT`);
    for (const column of DROPPED_PRODUCT_COLUMNS) dropIfPresent("products", column);
  },
};
