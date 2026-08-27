import { getPlatformContext } from "../../../src/platform/context";
import { requireAdminPage } from "../../../src/auth/require-admin-page";
import { AutoTagRuleRepository } from "../../../src/db/repositories/auto-tag-rule-repository";
import { TagRulesManagement } from "../../../components/admin/TagRulesManagement";

export const dynamic = "force-dynamic";

/** Phase 9 M4: keyword -> tag mappings for deterministic auto-tagging of conversations. Admin+-only. */
export default async function TagRulesPage() {
  const { db, tenant } = await getPlatformContext();
  await requireAdminPage(db, tenant);

  const rules = (await new AutoTagRuleRepository(db, tenant).list()).map((r) => ({ id: r.id, tag: r.tag, keywords: r.keywords }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Tag rules</h1>
      <p className="mt-1 text-sm text-muted">A conversation gets tagged whenever the customer&apos;s message matches one of these keyword lists — additive, alongside the automatic per-agent tag.</p>

      <TagRulesManagement rules={rules} />
    </main>
  );
}
