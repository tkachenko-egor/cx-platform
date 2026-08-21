import { notFound } from "next/navigation";
import Link from "next/link";
import { getPlatformContext } from "../../../../src/platform/context";
import { AgentDefRepository } from "../../../../src/db/repositories/agent-def-repository";
import { ToolDefRepository } from "../../../../src/db/repositories/tool-repository";
import { ModelAliasRepository } from "../../../../src/db/repositories/model-alias-repository";
import { AgentEditor } from "../../../../components/admin/AgentEditor";

export const dynamic = "force-dynamic";

export default async function AgentEditorPage(props: PageProps<"/admin/agents/[key]">) {
  const { key } = await props.params;
  const { db, tenant } = await getPlatformContext();

  const agentDef = new AgentDefRepository(db, tenant).getLatestPublished(key);
  if (!agentDef) notFound();

  const availableTools = new ToolDefRepository(db, tenant).list().map((t) => ({ key: t.key, description: t.description }));
  const availableModels = new ModelAliasRepository(db, tenant).list().map((m) => ({ alias: m.alias, provider: m.provider, model: m.model }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">{key}</h1>
        <Link href={`/admin/agents/${key}/widget`} className="text-xs text-accent hover:underline">
          Widget →
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">Currently v{agentDef.version}. Saving publishes v{agentDef.version + 1} — running conversations keep the version they started on.</p>

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
        }}
        availableTools={availableTools}
        availableModels={availableModels}
      />
    </main>
  );
}
