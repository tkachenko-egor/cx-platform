import { getPlatformContext } from "../../../src/platform/context";
import { ToolDefRepository } from "../../../src/db/repositories/tool-repository";
import { ProviderCredentialRepository } from "../../../src/db/repositories/provider-credential-repository";
import { ToolsManagement } from "../../../components/admin/ToolsManagement";

export const dynamic = "force-dynamic";

/** Phase 3 M7: no-code HTTP tools — a tenant admin can add a tool without a code deploy. Auth/role gate lives in app/admin/layout.tsx. */
export default async function ToolsPage() {
  const { db, tenant } = await getPlatformContext();

  const tools = new ToolDefRepository(db, tenant)
    .list()
    .map((t) => ({ key: t.key, description: t.description, inputSchema: t.inputSchema, writeFlag: t.writeFlag, approvalPolicy: t.approvalPolicy, type: t.type, handlerConfig: t.handlerConfig }));

  const toolCredentials = new ProviderCredentialRepository(db, tenant)
    .list()
    .filter((c) => c.kind === "tool_integration" && c.isActive)
    .map((c) => ({ id: c.id, label: c.label, provider: c.provider }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Tools</h1>
      <p className="mt-1 text-sm text-muted">
        Add a tool backed by an external HTTP endpoint — no code deploy needed. Code tools (built into the platform) are listed for visibility but managed in source.
      </p>

      <ToolsManagement tools={tools} toolCredentials={toolCredentials} />
    </main>
  );
}
