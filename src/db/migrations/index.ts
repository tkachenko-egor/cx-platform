import type { Migration } from "../migrate";
import { migration001MessagesRebuildAndThreading } from "./001-messages-rebuild-and-threading";
import { migration002RbacAndAudit } from "./002-rbac-and-audit";
import { migration003ConversationsAssignee } from "./003-conversations-assignee";
import { migration004Tickets } from "./004-tickets";

/** Applied in order, once each, tracked in schema_migrations (see migrate.ts). */
export const ALL_MIGRATIONS: Migration[] = [migration001MessagesRebuildAndThreading, migration002RbacAndAudit, migration003ConversationsAssignee, migration004Tickets];
