import { getPlatformContext } from "../../../src/platform/context";
import { ModelAliasRepository } from "../../../src/db/repositories/model-alias-repository";
import { ModelsManagement } from "../../../components/admin/ModelsManagement";

export const dynamic = "force-dynamic";

/** Phase 4 M1: model_aliases were seed/script-only before this — an admin can now define what an alias points to, and agents pick from these instead of typing a raw string. Auth/role gate lives in app/admin/layout.tsx. */
export default async function ModelsPage() {
  const { db, tenant } = await getPlatformContext();

  const aliases = new ModelAliasRepository(db, tenant)
    .list()
    .map((a) => ({ alias: a.alias, provider: a.provider, model: a.model }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Models</h1>
      <p className="mt-1 text-sm text-muted">
        An alias is what an agent&apos;s model field actually points to — changing what it maps to here changes the model every agent using it runs on immediately, no redeploy.
      </p>

      <ModelsManagement aliases={aliases} />
    </main>
  );
}
