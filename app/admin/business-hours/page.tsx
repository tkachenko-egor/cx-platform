import { getPlatformContext } from "../../../src/platform/context";
import { requireAdminPage } from "../../../src/auth/require-admin-page";
import { BusinessHoursEditor } from "../../../components/admin/BusinessHoursEditor";

export const dynamic = "force-dynamic";

/** Phase 9 M3: tenant-wide weekly schedule — see src/core/business-hours.ts. Admin+-only. */
export default async function BusinessHoursPage() {
  const { db, tenant } = await getPlatformContext();
  await requireAdminPage(db, tenant);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Business hours</h1>
      <p className="mt-1 text-sm text-muted">
        When set and an agent is about to hand off outside these hours, its out-of-hours canned message (Persona tab, per agent) is used instead of the usual handoff line.
      </p>

      <BusinessHoursEditor initialEnabled={Boolean(tenant.businessHours.enabled)} initialWeeklyHours={tenant.businessHours.weeklyHours ?? []} timezone={tenant.timezone} />
    </main>
  );
}
