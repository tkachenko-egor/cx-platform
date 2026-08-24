import { getPlatformContext } from "../../../src/platform/context";
import { requireAdminPage } from "../../../src/auth/require-admin-page";
import { ProviderCredentialRepository } from "../../../src/db/repositories/provider-credential-repository";
import { UserRepository } from "../../../src/db/repositories/user-repository";
import { ApiKeysManagement } from "../../../components/admin/ApiKeysManagement";

export const dynamic = "force-dynamic";

/** Phase 3 M7: DB-backed provider API keys, replacing the shared ANTHROPIC_API_KEY/OPENAI_API_KEY env vars. Admin+-only (Phase 8 M3) — see app/admin/layout.tsx's comment. */
export default async function ApiKeysPage() {
  const { db, tenant } = await getPlatformContext();
  await requireAdminPage(db, tenant);
  const users = new UserRepository(db, tenant);

  const credentials = new ProviderCredentialRepository(db, tenant)
    .list()
    .filter((c) => c.kind === "llm_provider")
    .map((c) => ({
      id: c.id,
      provider: c.provider,
      label: c.label,
      keyLast4: c.keyLast4,
      ownerEmail: users.get(c.ownerUserId)?.email ?? "unknown",
      isActive: c.isActive,
      createdAtFormatted: new Date(c.createdAt).toLocaleString(),
    }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">API Keys</h1>
      <p className="mt-1 text-sm text-muted">
        Set the tenant&apos;s Anthropic/OpenAI key here instead of a shared env var. Each key is attributed to the admin who added it; setting a new key immediately replaces which one is in effect.
      </p>

      <ApiKeysManagement credentials={credentials} />
    </main>
  );
}
