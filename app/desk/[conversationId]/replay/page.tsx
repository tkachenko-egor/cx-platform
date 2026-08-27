import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPlatformContext } from "../../../../src/platform/context";
import { ConversationRepository } from "../../../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../../../src/db/repositories/message-repository";
import { EventRepository } from "../../../../src/db/repositories/event-repository";
import { getSessionUser } from "../../../../src/auth/session";
import { loginRedirectPath } from "../../../../src/auth/login-redirect";
import { ReplayTimeline, type ReplayItem } from "../../../../components/desk/ReplayTimeline";

export const dynamic = "force-dynamic";

function describeEvent(type: string, payload: Record<string, unknown>, actor: string): string {
  switch (type) {
    case "state_changed":
      return `state → ${String(payload.to ?? "?")}`;
    case "handoff":
      return `handoff: ${String(payload.from ?? "?")} → ${String(payload.to ?? "?")}${payload.reason ? ` (${String(payload.reason)})` : ""}`;
    case "assigned":
      return `${String(payload.action ?? "assigned")} by ${actor}`;
    case "escalated": {
      const reasons = Array.isArray(payload.reasons) ? (payload.reasons as unknown[]).join(", ") : "";
      return reasons ? `escalated: ${reasons}` : "escalated";
    }
    default:
      return type;
  }
}

/** Phase 2 M7b: replay is UI composition of two already-reliable read paths (M1's event-integrity fix) — no new schema/repository. */
export default async function ReplayPage({ params }: PageProps<"/desk/[conversationId]/replay">) {
  const { conversationId } = await params;
  const { db, tenant } = await getPlatformContext();

  const user = await getSessionUser(db, tenant);
  if (!user) redirect(await loginRedirectPath());

  const conversation = await new ConversationRepository(db, tenant).get(conversationId);
  if (!conversation) notFound();

  const messages = await new MessageRepository(db, tenant).listByConversation(conversationId, { includeInternal: true });
  const events = await new EventRepository(db, tenant).listByConversation(conversationId);

  const sortable: { sortKey: string; item: ReplayItem }[] = [
    ...messages.map((m) => ({
      sortKey: m.createdAt,
      item: { id: m.id, kind: "message" as const, time: new Date(m.createdAt).toLocaleString(), label: m.role, detail: m.content, dimmed: m.visibility === "internal" },
    })),
    ...events.map((e) => ({
      sortKey: e.createdAt,
      item: { id: e.id, kind: "event" as const, time: new Date(e.createdAt).toLocaleString(), label: e.type, detail: describeEvent(e.type, e.payload, e.actor) },
    })),
  ];
  const items: ReplayItem[] = sortable.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((s) => s.item);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href={`/desk/${conversationId}`} className="text-xs text-accent hover:underline">
        ← Conversation
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-fg">Replay — {conversationId}</h1>
      <p className="text-sm text-muted">Scrub through every message and state change in order.</p>

      <ReplayTimeline items={items} />
    </main>
  );
}
