import Link from "next/link";
import { getPlatformContext } from "../../../src/platform/context";
import { ToolDefRepository } from "../../../src/db/repositories/tool-repository";
import { ToolsManagement } from "../../../components/admin/ToolsManagement";

export const dynamic = "force-dynamic";

/** Phase 3 M7 (no-code HTTP tools) + Phase 5 M3 (split no-code vs custom, paginated). Auth/role gate lives in app/admin/layout.tsx. */
export default async function ToolsPage() {
  const { db, tenant } = await getPlatformContext();

  const tools = new ToolDefRepository(db, tenant)
    .list()
    .map((t) => ({ key: t.key, description: t.description, writeFlag: t.writeFlag, approvalPolicy: t.approvalPolicy, type: t.type }));

  const httpTools = tools.filter((t) => t.type === "http");
  const codeTools = tools.filter((t) => t.type === "code");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Tools</h1>
        <Link href="/admin/tools/new" className="text-xs text-accent hover:underline">
          + New tool
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">No-code tools call an external HTTP endpoint — no code deploy needed. Custom tools are built into the platform.</p>

      <ToolsManagement httpTools={httpTools} codeTools={codeTools} />
    </main>
  );
}
