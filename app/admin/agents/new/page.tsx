import { getPlatformContext } from "../../../../src/platform/context";
import { AgentDefRepository, type AgentPersonaConfig } from "../../../../src/db/repositories/agent-def-repository";
import { ToolDefRepository } from "../../../../src/db/repositories/tool-repository";
import { ModelAliasRepository } from "../../../../src/db/repositories/model-alias-repository";
import { KbCollectionRepository } from "../../../../src/db/repositories/kb-collection-repository";
import { UserRepository } from "../../../../src/db/repositories/user-repository";
import { AgentEditor } from "../../../../components/admin/AgentEditor";
import { NewAgentPresets } from "../../../../components/admin/NewAgentPresets";
import { Tabs } from "../../../../components/ui/Tabs";

export const dynamic = "force-dynamic";

const STARTER_PROMPT = `You are a helpful customer support agent.

Be concise and friendly. Cite knowledge-base sources with [doc_id] when you use them. If you can't help, say so and offer to hand off to a human.`;

/** Phase 7 M1: a small in-code preset list — cross-tenant DB-shared templates would need a platform-level concept that doesn't exist yet, so this mirrors STARTER_PROMPT's existing precedent instead. */
const TEMPLATES: Record<string, { label: string; systemPrompt: string; persona?: AgentPersonaConfig }> = {
  blank: { label: "Blank", systemPrompt: STARTER_PROMPT },
  "support-generalist": {
    label: "Customer Support Generalist",
    systemPrompt: `You are a customer support generalist. Help with orders, account questions, and general product questions. Cite knowledge-base sources with [doc_id]. Hand off anything you can't resolve.`,
    persona: { tone: "Friendly", responseLength: "standard" },
  },
  "billing-specialist": {
    label: "Billing Specialist",
    systemPrompt: `You handle billing, payments, charges and refund-status questions. Hand off anything outside that scope to the right specialist rather than guessing. Cite knowledge-base sources with [doc_id].`,
    persona: { tone: "Formal", responseLength: "brief" },
  },
  "returns-specialist": {
    label: "Returns & Refunds Specialist",
    systemPrompt: `You handle return eligibility, refund status, and exchange questions. Never promise an outcome the return-eligibility tool hasn't confirmed. Cite knowledge-base sources with [doc_id].`,
    persona: { tone: "Friendly", responseLength: "standard" },
  },
};

/** Phase 4 M2: agent_defs previously had no "create new" path — app/admin/agents/[key] only ever edited a key that already had a published version. Phase 7 M1: adds ?cloneFrom=<key> (copy an existing agent's config) and ?template=<id> (start from a TEMPLATES preset). */
export default async function NewAgentPage(props: { searchParams: Promise<{ cloneFrom?: string; template?: string }> }) {
  const { db, tenant } = await getPlatformContext();
  const { cloneFrom, template } = await props.searchParams;

  const availableTools = new ToolDefRepository(db, tenant)
    .list()
    .map((t) => ({ key: t.key, description: t.description, type: t.type, writeFlag: t.writeFlag, approvalPolicy: t.approvalPolicy, handlerConfig: t.handlerConfig }));
  const availableModels = new ModelAliasRepository(db, tenant).list().map((m) => ({ alias: m.alias, provider: m.provider, model: m.model }));
  const availableCollections = new KbCollectionRepository(db, tenant).list().map((c) => ({ id: c.id, name: c.name }));
  const availableOwners = new UserRepository(db, tenant).list().map((u) => ({ id: u.id, email: u.email }));
  const agentDefs = new AgentDefRepository(db, tenant);
  const existingAgents = [...new Set(agentDefs.listAllPublished().map((a) => a.key))].sort();

  const cloneSource = cloneFrom ? agentDefs.getLatestPublished(cloneFrom) : undefined;
  const chosenTemplate = !cloneSource && template ? TEMPLATES[template] : undefined;

  const initial = cloneSource
    ? {
        key: "",
        version: 0,
        systemPrompt: cloneSource.systemPrompt,
        modelAlias: cloneSource.modelAlias,
        toolIds: cloneSource.toolIds,
        guardrails: cloneSource.guardrails,
        skills: cloneSource.skills,
        kbScope: cloneSource.kbScope,
        nativeTools: cloneSource.nativeTools,
        quickReplies: cloneSource.quickReplies,
        displayName: cloneSource.displayName,
        avatarUrl: cloneSource.avatarUrl,
        internalDescription: cloneSource.internalDescription,
        ownerUserId: cloneSource.ownerUserId,
        tags: cloneSource.tags,
        agentStatus: "draft" as const,
        environment: "sandbox" as const,
        temperature: cloneSource.temperature,
        maxOutputTokens: cloneSource.maxOutputTokens,
        costCeilingUsd: cloneSource.costCeilingUsd,
        persona: cloneSource.persona,
        languageConfig: cloneSource.languageConfig,
        escalationConfig: cloneSource.escalationConfig,
      }
    : {
        key: "",
        version: 0,
        systemPrompt: chosenTemplate?.systemPrompt ?? STARTER_PROMPT,
        modelAlias: "",
        toolIds: [],
        guardrails: {},
        skills: [],
        kbScope: { collectionIds: [] },
        nativeTools: {},
        quickReplies: [],
        displayName: "",
        avatarUrl: null,
        internalDescription: "",
        ownerUserId: null,
        tags: [],
        agentStatus: "draft" as const,
        environment: "sandbox" as const,
        temperature: null,
        maxOutputTokens: null,
        costCeilingUsd: null,
        persona: chosenTemplate?.persona ?? {},
        languageConfig: {},
        escalationConfig: {},
      };

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">New agent</h1>
      <p className="mt-1 text-sm text-muted">Creates the first published version (v1), starting in draft status and the sandbox environment. KB scope and handoff targets can be set up afterward from the agent&apos;s page.</p>

      <div className="mt-4">
        <Tabs
          active="/admin/agents/new"
          items={[
            { href: "/admin/agents/new", label: "Builder" },
            { href: "#", label: "Analytics", disabled: true },
            { href: "#", label: "Widget", disabled: true },
          ]}
        />
      </div>

      <NewAgentPresets existingAgents={existingAgents} templates={Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label }))} cloneFrom={cloneFrom} template={template} />

      <AgentEditor
        key={cloneFrom ?? template ?? "blank"}
        mode="create"
        initial={initial}
        availableTools={availableTools}
        availableModels={availableModels}
        availableCollections={availableCollections}
        availableOwners={availableOwners}
      />
    </main>
  );
}
