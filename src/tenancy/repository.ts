import type { SqlDatabase } from "../db/pg";
import type { TenantContext } from "./context";

/**
 * Base class for every tenant-scoped repository. The constructor requiring
 * a TenantContext is the enforcement mechanism for FR-1.1's "cannot build a
 * query without a tenant context" design note — it is a compile-time and
 * run-time guarantee, not a convention subclasses have to remember to
 * follow. Every query a subclass writes must filter on `this.tenantId`.
 */
export abstract class TenantScopedRepository {
  protected readonly db: SqlDatabase;
  protected readonly tenantId: string;

  protected constructor(db: SqlDatabase, tenant: TenantContext) {
    if (!tenant || !tenant.tenantId) {
      throw new Error(`${new.target.name} requires a tenant context`);
    }
    this.db = db;
    this.tenantId = tenant.tenantId;
  }
}
