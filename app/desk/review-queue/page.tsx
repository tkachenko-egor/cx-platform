import { redirect } from "next/navigation";
import { getPlatformContext } from "../../../src/platform/context";
import { ReviewQueueRepository } from "../../../src/db/repositories/review-queue-repository";
import { getSessionUser } from "../../../src/auth/session";
import { loginRedirectPath } from "../../../src/auth/login-redirect";
import { SignOutButton } from "../../../components/desk/SignOutButton";
import { ReviewQueueList } from "../../../components/desk/ReviewQueueList";

export const dynamic = "force-dynamic";

/** Phase 2 M5: a review tier distinct from escalation — conversations the bot kept handling but that are worth a human's eyes later. */
export default async function ReviewQueuePage() {
  const { db, tenant } = await getPlatformContext();
  const user = await getSessionUser(db, tenant);
  if (!user) redirect(await loginRedirectPath());

  const items = new ReviewQueueRepository(db, tenant).listPending().map((item) => ({
    id: item.id,
    conversationId: item.conversationId,
    reason: item.reason,
    flaggedAt: new Date(item.createdAt).toLocaleString(),
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Review queue</h1>
        <p className="flex items-center gap-2 text-xs text-muted">
          {user.email} · {user.role}
          <SignOutButton />
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">
        Conversations the bot kept handling on its own, but that were flagged for a second look — e.g. a low-confidence KB retrieval it answered anyway.
      </p>

      <ReviewQueueList items={items} />
    </main>
  );
}
