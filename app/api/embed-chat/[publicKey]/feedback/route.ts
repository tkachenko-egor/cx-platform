import { getWidgetContext } from "../../../../../src/platform/widget-context";
import { recordMessageFeedback, FeedbackValidationError } from "../../../../../src/channel/feedback";
import type { FeedbackRating } from "../../../../../src/db/repositories/message-feedback-repository";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Phase 9 M4: CORS-enabled public sibling of app/api/chat/feedback/route.ts for embeds on a customer's own site, same publicKey-resolution pattern as app/api/embed-chat/[publicKey]/route.ts. */
export async function POST(req: Request, ctx: RouteContext<"/api/embed-chat/[publicKey]/feedback">) {
  const { publicKey } = await ctx.params;
  const widget = await getWidgetContext(publicKey);
  if (!widget) {
    return Response.json({ error: "Widget not found" }, { status: 404, headers: CORS_HEADERS });
  }

  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; messageId?: string; rating?: FeedbackRating; comment?: string };
  if (!body.conversationId || !body.messageId || (body.rating !== "up" && body.rating !== "down")) {
    return Response.json({ error: "conversationId, messageId, and rating ('up'|'down') are required" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const feedback = recordMessageFeedback(widget.db, widget.tenant, { conversationId: body.conversationId, messageId: body.messageId, rating: body.rating, comment: body.comment });
    return Response.json({ ok: true, feedback }, { headers: CORS_HEADERS });
  } catch (err) {
    if (err instanceof FeedbackValidationError) return Response.json({ error: err.message }, { status: 404, headers: CORS_HEADERS });
    throw err;
  }
}
