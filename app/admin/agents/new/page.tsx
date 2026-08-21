import { getPlatformContext } from "../../../../src/platform/context";
import { ToolDefRepository } from "../../../../src/db/repositories/tool-repository";
import { ModelAliasRepository } from "../../../../src/db/repositories/model-alias-repository";
import { AgentEditor } from "../../../../components/admin/AgentEditor";

export const dynamic = "force-dynamic";

const STARTER_PROMPT = `You are a helpful customer support agent.

Be concise and friendly. Cite knowledge-base sources with [doc_id] when you use them. If you can't help, say so and offer to hand off to a human.`;

/** Phase 4 M2: agent_defs previously had no "create new" path — app/admin/agents/[key] only ever edited a key that already had a published version. */
export default async function NewAgentPage() {
  const { db, tenant } = await getPlatformContext();

  const availableTools = new ToolDefRepository(db, tenant).list().map((t) => ({ key: t.key, description: t.description }));
  const availableModels = new ModelAliasRepository(db, tenant).list().map((m) => ({ alias: m.alias, provider: m.provider, model: m.model }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">New agent</h1>
      <p className="mt-1 text-sm text-muted">Creates the first published version (v1). KB scope and handoff targets can be set up afterward from the agent&apos;s page and the flow builder.</p>

      <AgentEditor
        mode="create"
        initial={{
          key: "",
          version: 0,
          systemPrompt: STARTER_PROMPT,
          modelAlias: "",
          toolIds: [],
          guardrails: {},
          skills: [],
          kbScope: { audience: ["customer"] },
        }}
        availableTools={availableTools}
        availableModels={availableModels}
      />
    </main>
  );
}
