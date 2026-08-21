/**
 * FR-2.2: roles with a documented permission matrix. This is that matrix,
 * as code rather than prose, so it's the enforced source of truth and not
 * just a table in a doc that drifts from what `requireRole`/`can` actually
 * check.
 */
export type Role = "owner" | "admin" | "supervisor" | "agent" | "viewer";

export type Permission =
  | "manage_agents"
  | "manage_users"
  | "manage_tenant_config"
  | "view_conversations"
  | "reply_as_human"
  | "assign_conversation"
  | "approve_write_tool"
  | "export_conversation";

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(["manage_agents", "manage_users", "manage_tenant_config", "view_conversations", "reply_as_human", "assign_conversation", "approve_write_tool", "export_conversation"]),
  admin: new Set(["manage_agents", "manage_users", "manage_tenant_config", "view_conversations", "reply_as_human", "assign_conversation", "approve_write_tool", "export_conversation"]),
  supervisor: new Set(["view_conversations", "reply_as_human", "assign_conversation", "approve_write_tool", "export_conversation"]),
  agent: new Set(["view_conversations", "reply_as_human", "approve_write_tool"]),
  viewer: new Set(["view_conversations"]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, agent: 1, supervisor: 2, admin: 3, owner: 4 };

/** Roles are a coarse hierarchy (owner outranks everyone below) for the common "at least this role" check. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
