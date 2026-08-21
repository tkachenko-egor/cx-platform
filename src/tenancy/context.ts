/**
 * FR-1.1: every persisted entity carries a tenant_id, and queries are
 * tenant-scoped at the data-access layer — not left to callers to remember.
 * TenantContext is the value that makes that scoping possible.
 */
export interface TenantContext {
  readonly tenantId: string;
}

export function requireTenant(context: TenantContext | null | undefined): TenantContext {
  if (!context || !context.tenantId) {
    throw new Error("A tenant context is required here");
  }
  return context;
}
