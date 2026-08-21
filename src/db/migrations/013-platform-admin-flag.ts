import type Database from "better-sqlite3";
import type { Migration } from "../migrate";

/** Phase 3 M4: a designated owner can also administer tenants platform-wide (elevated owner role, per the user's own choice over a separate platform_admins identity system). */
export const migration013PlatformAdminFlag: Migration = {
  id: "013_platform_admin_flag",
  up(db: Database.Database) {
    const columns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
    if (columns.some((c) => c.name === "is_platform_admin")) return;
    db.exec(`ALTER TABLE users ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0`);
  },
};
