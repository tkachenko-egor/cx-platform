import { getPlatformContext } from "../../../../src/platform/context";
import { recordMessageFeedback, FeedbackValidationError } from "../../../../src/channel/feedback";
import type { FeedbackRating } from "../../../../src/db/repositories/message-feedback-repository";

export const runtime = "nodejs";

/** Phase 9 M4: same-origin sibling of app/api/embed-chat/[publicKey]/feedback/route.ts — public, no staff auth (a customer submits this), tenant resolved via Host header like app/api/chat/route.ts. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; messageId?: string; rating?: FeedbackRating; comment?: string };
  if (!body.conversationId || !body.messageId || (body.rating !== "up" && body.rating !== "down")) {
    return Response.json({ error: "conversationId, messageId, and rating ('up'|'down') are required" }, { status: 400 });
  }

  const { db, tenant } = await getPlatformContext();
  try {
    const feedback = recordMessageFeedback(db, tenant, { conversationId: body.conversationId, messageId: body.messageId, rating: body.rating, comment: body.comment });
    return Response.json({ ok: true, feedback });
  } catch (err) {
    if (err instanceof FeedbackValidationError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
