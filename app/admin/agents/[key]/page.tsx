import { notFound } from "next/navigation";
import { getPlatformContext } from "../../../../src/platform/context";
import { AgentDefRepository } from "../../../../src/db/repositories/agent-def-repository";
import { ToolDefRepository } from "../../../../src/db/repositories/tool-repository";
import { ModelAliasRepository } from "../../../../src/db/repositories/model-alias-repository";
import { KbCollectionRepository } from "../../../../src/db/repositories/kb-collection-repository";
import { AgentEditor } from "../../../../components/admin/AgentEditor";
import { Tabs } from "../../../../components/ui/Tabs";

export const dynamic = "force-dynamic";

export default async function AgentEditorPage(props: PageProps<"/admin/agents/[key]">) {
  const { key } = await props.params;
  const { db, tenant } = await getPlatformContext();

  const agentDef = new AgentDefRepository(db, tenant).getLatestPublished(key);
  if (!agentDef) notFound();

  const availableTools = new ToolDefRepository(db, tenant)
    .list()
    .map((t) => ({ key: t.key, description: t.description, type: t.type, writeFlag: t.writeFlag, approvalPolicy: t.approvalPolicy, handlerConfig: t.handlerConfig }));
  const availableModels = new ModelAliasRepository(db, tenant).list().map((m) => ({ alias: m.alias, provider: m.provider, model: m.model }));
  const availableCollections = new KbCollectionRepository(db, tenant).list().map((c) => ({ id: c.id, name: c.name }));
  const versions = new AgentDefRepository(db, tenant).listVersions(key).map((v) => ({
    key: v.key,
    version: v.version,
    systemPrompt: v.systemPrompt,
    modelAlias: v.modelAlias,
    toolIds: v.toolIds,
    guardrails: v.guardrails,
    skills: v.skills,
    kbScope: v.kbScope,
    nativeTools: v.nativeTools,
    quickReplies: v.quickReplies,
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
          systemPrompt: agentDef.systemPrompt,
          modelAlias: agentDef.modelAlias,
          toolIds: agentDef.toolIds,
          guardrails: agentDef.guardrails,
          skills: agentDef.skills,
          kbScope: agentDef.kbScope,
          nativeTools: agentDef.nativeTools,
          quickReplies: agentDef.quickReplies,
        }}
        availableTools={availableTools}
        availableModels={availableModels}
        availableCollections={availableCollections}
        versions={versions}
      />
    </main>
  );
}
