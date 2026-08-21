import type { Migration } from "../migrate";
import { migration001MessagesRebuildAndThreading } from "./001-messages-rebuild-and-threading";
import { migration002RbacAndAudit } from "./002-rbac-and-audit";
import { migration003ConversationsAssignee } from "./003-conversations-assignee";
import { migration004Tickets } from "./004-tickets";
import { migration005ToolApprovals } from "./005-tool-approvals";
import { migration006Phase2Foundation } from "./006-phase2-foundation";
import { migration007CoverageGapAndSemanticCache } from "./007-coverage-gap-and-semantic-cache";
import { migration008SlaPolicies } from "./008-sla-policies";
import { migration009ReviewQueue } from "./009-review-queue";
import { migration010AgentExperiments } from "./010-agent-experiments";
import { migration011Macros } from "./011-macros";
import { migration012UserInvitesAndPasswordResets } from "./012-user-invites-and-password-resets";
import { migration013PlatformAdminFlag } from "./013-platform-admin-flag";
import { migration014ProviderCredentials } from "./014-provider-credentials";
import { migration015ToolDefsHttpType } from "./015-tool-defs-http-type";
import { migration016KbArticlesBody } from "./016-kb-articles-body";

/** Applied in order, once each, tracked in schema_migrations (see migrate.ts). */
export const ALL_MIGRATIONS: Migration[] = [
  migration001MessagesRebuildAndThreading,
  migration002RbacAndAudit,
  migration003ConversationsAssignee,
  migration004Tickets,
  migration005ToolApprovals,
  migration006Phase2Foundation,
  migration007CoverageGapAndSemanticCache,
  migration008SlaPolicies,
  migration009ReviewQueue,
  migration010AgentExperiments,
  migration011Macros,
  migration012UserInvitesAndPasswordResets,
  migration013PlatformAdminFlag,
  migration014ProviderCredentials,
  migration015ToolDefsHttpType,
  migration016KbArticlesBody,
];
