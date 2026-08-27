import type { Migration } from "../migrate";

/**
 * B5: row-level security as a tenancy backstop (NFR-4.5). Every table with a
 * `tenant_id` gets a `tenant_isolation` policy; `TenantScopedRepository`'s
 * `db` handle (`SqlDatabase.forTenant`) runs each query inside a transaction
 * that first sets `app.tenant_id`, so a repository method that forgets its
 * `WHERE tenant_id = ?` still cannot read or write another tenant's rows.
 *
 * The app's login role (`cx`) is a **superuser**, and superusers bypass RLS
 * even with `FORCE`. So a scoped query can't just set the GUC — it also drops
 * to `cx_tenant` (`NOLOGIN`, `NOSUPERUSER`) for the duration of its
 * transaction (`SET LOCAL ROLE`, see `SqlDatabase.forTenant`). `FORCE ROW
 * LEVEL SECURITY` then makes the policy bite even though `cx_tenant` will own
 * nothing.
 *
 * **The exemption is staying `cx`.** Every unscoped path — migrations,
 * `npm run seed`, `TenantRepository`, and `src/auth/platform-admin-lookup.ts`
 * (the one place a platform admin is resolved without knowing their tenant) —
 * runs on the *root* `SqlDatabase` handle, which never sets the GUC and never
 * drops the role, so it stays superuser and sees everything. No separate
 * connection string, no `BYPASSRLS` grant.
 *
 * `cx_tenant` is a cluster-global role (created once, guarded); the table
 * grants are per-database and re-applied on every template build. A future
 * migration that adds a tenant table must also `GRANT` DML on it to
 * `cx_tenant` and add the policy — or `ALTER DEFAULT PRIVILEGES` below covers
 * it if the table is created by `cx`.
 *
 * Driven off `information_schema` so it covers every current tenant table; a
 * future migration that adds one must add its own `tenant_isolation` policy
 * (or re-run this block).
 *
 * Idempotent: `ENABLE`/`FORCE` are no-ops when already set; the policy is
 * dropped and recreated.
 */
const SQL = `
DO $role$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cx_tenant') THEN
    CREATE ROLE cx_tenant NOLOGIN NOSUPERUSER;
  END IF;
END
$role$;

GRANT cx_tenant TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO cx_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cx_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cx_tenant;

DO $mig$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
    ORDER BY table_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($pol$
      CREATE POLICY tenant_isolation ON public.%I
        USING (
          nullif(current_setting('app.tenant_id', true), '') IS NULL
          OR tenant_id = current_setting('app.tenant_id', true)
        )
        WITH CHECK (
          nullif(current_setting('app.tenant_id', true), '') IS NULL
          OR tenant_id = current_setting('app.tenant_id', true)
        )
    $pol$, t);
  END LOOP;
END
$mig$;
`;

export const migration003RowLevelSecurity: Migration = {
  id: "003-row-level-security",
  async up(db) {
    await db.exec(SQL);
  },
};
