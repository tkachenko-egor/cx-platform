import type { SqlDatabase } from "../db/pg";
import type { TenantContext } from "./context";

/**
 * Base class for every tenant-scoped repository. The constructor requiring
 * a TenantContext is the enforcement mechanism for FR-1.1's "cannot build a
 * query without a tenant context" design note — it is a compile-time and
 * run-time guarantee, not a convention subclasses have to remember to
 * follow. Every query a subclass writes must filter on `this.tenantId`.
 *
 * B5: `this.db` is a `forTenant()` handle — every query it runs goes through a
 * transaction that sets the `app.tenant_id` GUC, so the row-level-security
 * policies (migration 003) enforce the same isolation as a *hard* backstop
 * behind the WHERE clauses. A subclass that forgets `WHERE tenant_id = ?`
 * still can't read or write another tenant's rows.
 */
export abstract class TenantScopedRepository {
  protected readonly db: SqlDatabase;
  protected readonly tenantId: string;

  protected constructor(db: SqlDatabase, tenant: TenantContext) {
    if (!tenant || !tenant.tenantId) {
      throw new Error(`${new.target.name} requires a tenant context`);
    }
    this.db = db.forTenant(tenant.tenantId);
    this.tenantId = tenant.tenantId;
  }
}
