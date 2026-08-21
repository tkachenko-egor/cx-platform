import { notFound } from "next/navigation";
import { getPlatformContext } from "../../../../../src/platform/context";
import { AgentDefRepository } from "../../../../../src/db/repositories/agent-def-repository";
import { WidgetConfigRepository } from "../../../../../src/db/repositories/widget-config-repository";
import { WidgetConfigEditor } from "../../../../../components/admin/WidgetConfigEditor";
import { Tabs } from "../../../../../components/ui/Tabs";

export const dynamic = "force-dynamic";

/** Phase 4 M4: deploy surface for a published agent — before this there was no way to put an agent in front of a real customer short of running the platform's own demo page. */
export default async function AgentWidgetPage(props: PageProps<"/admin/agents/[key]/widget">) {
  const { key } = await props.params;
  const { db, tenant } = await getPlatformContext();

  const agentDef = new AgentDefRepository(db, tenant).getLatestPublished(key);
  if (!agentDef) notFound();

  const config = new WidgetConfigRepository(db, tenant).getByAgentKey(key);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">{key}</h1>
      <p className="mt-1 text-sm text-muted">Embed this agent on any website. Colors, greeting, and logo update live for anyone with the snippet already pasted — no re-embed needed.</p>

      <div className="mt-4">
        <Tabs
          active={`/admin/agents/${key}/widget`}
          items={[
            { href: `/admin/agents/${key}`, label: "Builder" },
            { href: `/analytics?agent=${key}`, label: "Analytics" },
            { href: `/admin/agents/${key}/widget`, label: "Widget" },
          ]}
        />
      </div>

      <WidgetConfigEditor
        agentKey={key}
        initial={
          config
            ? {
                title: config.title,
                greetingText: config.greetingText,
                primaryColor: config.primaryColor,
                logoUrl: config.logoUrl,
                position: config.position,
                publicKey: config.publicKey,
                fontFamily: config.fontFamily,
                userBubbleColor: config.userBubbleColor,
                botBubbleColor: config.botBubbleColor,
              }
            : null
        }
      />
    </main>
  );
}
