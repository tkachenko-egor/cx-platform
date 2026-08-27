import { notFound } from "next/navigation";
import { getPlatformContext } from "../../../../src/platform/context";
import { AgentDefRepository } from "../../../../src/db/repositories/agent-def-repository";
import { ToolDefRepository } from "../../../../src/db/repositories/tool-repository";
import { ModelAliasRepository } from "../../../../src/db/repositories/model-alias-repository";
import { KbCollectionRepository } from "../../../../src/db/repositories/kb-collection-repository";
import { UserRepository } from "../../../../src/db/repositories/user-repository";
import { AgentEditor } from "../../../../components/admin/AgentEditor";
import { Tabs } from "../../../../components/ui/Tabs";

export const dynamic = "force-dynamic";

export default async function AgentEditorPage(props: PageProps<"/admin/agents/[key]">) {
  const { key } = await props.params;
  const { db, tenant } = await getPlatformContext();

  const agentDefs = new AgentDefRepository(db, tenant);
  const agentDef = agentDefs.getLatestPublished(key);
  if (!agentDef) notFound();
  // Milestone 5 (Save/Publish split): a saved-but-unpublished draft, if any,
  // takes precedence over the last published version as the form's starting
  // point — "resume editing" should pick up unsaved work. `version` stays
  // the real published version's (never the draft's sentinel 0) so the
  // header/version-picker keep referring to actual history.
  const draft = agentDefs.getDraft(key);
  const formSource = draft ?? agentDef;

  const availableTools = new ToolDefRepository(db, tenant)
    .list()
    .map((t) => ({ key: t.key, displayName: t.displayName, description: t.description, type: t.type, writeFlag: t.writeFlag, approvalPolicy: t.approvalPolicy, handlerConfig: t.handlerConfig }));
  const availableModels = (await new ModelAliasRepository(db, tenant).list()).map((m) => ({ alias: m.alias, provider: m.provider, model: m.model }));
  const availableCollections = new KbCollectionRepository(db, tenant).list().map((c) => ({ id: c.id, name: c.name }));
  const availableOwners = (await new UserRepository(db, tenant).list()).map((u) => ({ id: u.id, email: u.email }));

  // Bot-level routing: every other published agent, so the "Hands off to"
  // card can offer them as handoff targets (see components/admin/AgentEditor.tsx).
  const latestByKey = new Map<string, ReturnType<typeof agentDefs.listAllPublished>[number]>();
  for (const def of agentDefs.listAllPublished()) {
    const current = latestByKey.get(def.key);
    if (!current || def.version > current.version) latestByKey.set(def.key, def);
  }
  const availableHandoffTargets = [...latestByKey.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((a) => ({ key: a.key, displayName: a.displayName, handoffTargets: a.handoffTargets }));
  const versions = agentDefs.listVersions(key).map((v) => ({
    key: v.key,
    version: v.version,
    systemPrompt: v.systemPrompt,
    modelAlias: v.modelAlias,
    toolIds: v.toolIds,
    guardrails: v.guardrails,
    skills: v.skills,
    handoffTargets: v.handoffTargets,
    kbScope: v.kbScope,
    nativeTools: v.nativeTools,
    quickReplies: v.quickReplies,
    displayName: v.displayName,
    avatarUrl: v.avatarUrl,
    internalDescription: v.internalDescription,
    ownerUserId: v.ownerUserId,
    tags: v.tags,
    agentStatus: v.agentStatus,
    environment: v.environment,
    temperature: v.temperature,
    maxOutputTokens: v.maxOutputTokens,
    costCeilingUsd: v.costCeilingUsd,
    persona: v.persona,
    languageConfig: v.languageConfig,
    escalationConfig: v.escalationConfig,
    conversationConfig: v.conversationConfig,
    enabledChannels: v.enabledChannels,
    businessHours: v.businessHours,
  }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">{key}</h1>
      <p className="mt-1 text-sm text-muted">Currently v{agentDef.version}. Saving publishes v{agentDef.version + 1} — running conversations keep the version they started on.</p>

      <div className="mt-4">
        <Tabs
          active={`/admin/agents/${key}`}
          items={[
            { href: `/admin/agents/${key}`, label: "Builder" },
            { href: `/analytics?agent=${key}`, label: "Analytics" },
            { href: `/admin/agents/${key}/widget`, label: "Widget" },
          ]}
        />
      </div>

      <AgentEditor
        initial={{
          key: agentDef.key,
          version: agentDef.version,
          systemPrompt: formSource.systemPrompt,
          modelAlias: formSource.modelAlias,
          toolIds: formSource.toolIds,
          guardrails: formSource.guardrails,
          skills: formSource.skills,
          handoffTargets: agentDef.handoffTargets,
          kbScope: formSource.kbScope,
          nativeTools: formSource.nativeTools,
          quickReplies: formSource.quickReplies,
          displayName: formSource.displayName,
          avatarUrl: formSource.avatarUrl,
          internalDescription: formSource.internalDescription,
          ownerUserId: formSource.ownerUserId,
          tags: formSource.tags,
          agentStatus: agentDef.agentStatus,
          environment: formSource.environment,
          temperature: formSource.temperature,
          maxOutputTokens: formSource.maxOutputTokens,
          costCeilingUsd: formSource.costCeilingUsd,
          persona: formSource.persona,
          languageConfig: formSource.languageConfig,
          escalationConfig: formSource.escalationConfig,
          conversationConfig: formSource.conversationConfig,
          enabledChannels: formSource.enabledChannels,
          businessHours: formSource.businessHours,
        }}
        availableTools={availableTools}
        availableModels={availableModels}
        availableCollections={availableCollections}
        availableOwners={availableOwners}
        availableHandoffTargets={availableHandoffTargets}
        versions={versions}
        tenantBusinessHours={tenant.businessHours}
        tenantTimezone={tenant.timezone}
        hasDraft={Boolean(draft)}
      />
    </main>
  );
}
