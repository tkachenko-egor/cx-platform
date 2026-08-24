import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPlatformContext } from "../../../../src/platform/context";
import { requireAdminPage } from "../../../../src/auth/require-admin-page";
import { ProviderCredentialRepository } from "../../../../src/db/repositories/provider-credential-repository";
import { ToolCreateForm } from "../../../../components/admin/ToolCreateForm";

export const dynamic = "force-dynamic";

/** Phase 5 M3: tool creation carried out of the always-inline form on /admin/tools into its own route, matching the KB collections' "list page + separate create page" shape. Admin+-only (Phase 8 M3). */
export default async function NewToolPage() {
  const { db, tenant } = await getPlatformContext();
  await requireAdminPage(db, tenant);

  const toolCredentials = new ProviderCredentialRepository(db, tenant)
    .list()
    .filter((c) => c.kind === "tool_integration" && c.isActive)
    .map((c) => ({ id: c.id, label: c.label, provider: c.provider }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/admin/tools" className="flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ArrowLeft size={13} /> Tools
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-fg">New no-code tool</h1>
      <p className="mt-1 text-sm text-muted">Defines a tool backed by an external HTTP endpoint — no code deploy needed.</p>

      <ToolCreateForm toolCredentials={toolCredentials} />
    </main>
  );
}
