import { getPlatformContext } from "../../../../../src/platform/context";
import { ConversationRepository } from "../../../../../src/db/repositories/conversation-repository";
import { MessageRepository } from "../../../../../src/db/repositories/message-repository";
import { TicketRepository } from "../../../../../src/db/repositories/ticket-repository";
import { EmailChannelAdapter } from "../../../../../src/channel/email/adapter";
import { resolveEmailConversationId, normalizedSubjectHash } from "../../../../../src/channel/email/threading";
import { ensureConversation, processInboundTurn } from "../../../../../src/channel/turn";
import { selectEmailProvider } from "../../../../../src/channel/email/select-provider";

export const runtime = "nodejs";

/** Postmark's inbound-parse webhook shape (FR-3.11) — the one concrete provider format this route speaks. */
interface PostmarkInboundPayload {
  MessageID?: string;
  From?: string;
  Subject?: string;
  TextBody?: string;
  Headers?: { Name: string; Value: string }[];
}

function headersToRecord(headers: { Name: string; Value: string }[] = []): Record<string, string> {
  const record: Record<string, string> = {};
  for (const h of headers) record[h.Name.toLowerCase()] = h.Value;
  return record;
}

/** FR-3.11-3.17: webhook receiver — inbound email in, threaded conversation + ticket + agent reply out. */
export async function POST(req: Request) {
  const payload = (await req.json().catch(() => null)) as PostmarkInboundPayload | null;
  if (!payload?.MessageID || !payload.TextBody) {
    return Response.json({ error: "Invalid inbound email payload" }, { status: 400 });
  }

  const headers = headersToRecord(payload.Headers);
  const adapter = new EmailChannelAdapter(selectEmailProvider());
  const inbound = adapter.receive({
    messageId: payload.MessageID,
    inReplyTo: headers["in-reply-to"],
    references: headers["references"]?.split(/\s+/).filter(Boolean),
    from: payload.From ?? "unknown@unknown",
    subject: payload.Subject ?? "(no subject)",
    textBody: payload.TextBody,
    headers,
  });

  if (!inbound) {
    // FR-3.16: dropped as an autoresponder — never reply, never create a ticket.
    return Response.json({ ok: true, dropped: "autoresponder" });
  }

  const { db, tenant, gateway, embeddings } = await getPlatformContext();
  const conversations = new ConversationRepository(db, tenant);
  const tickets = new TicketRepository(db, tenant);

  const subject = (inbound.metadata?.subject as string | undefined) ?? "(no subject)";
  const from = inbound.metadata?.from as string | undefined;
  const references = (inbound.metadata?.references as string[] | undefined) ?? [];

  const existingId = resolveEmailConversationId(db, tenant, { inReplyToExternalId: inbound.inReplyToExternalId, references, subject });
  const existing = existingId ? conversations.get(existingId) : undefined;
  const isNewThread = !existing;

  let conversation;
  try {
    conversation = await ensureConversation({ db }, tenant, existing, "email", { subjectHash: normalizedSubjectHash(subject), from, subject });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  const ticket = isNewThread ? tickets.create({ conversationId: conversation.id, subject }) : tickets.getByConversation(conversation.id);

  const result = await processInboundTurn(
    { db, gateway, embeddings },
    tenant,
    { conversationId: conversation.id, text: inbound.text, channelMessageId: inbound.externalMessageId },
  );

  if (ticket) {
    tickets.setStatus(ticket.id, result.handoff ? "pending_internal" : "pending_customer");
  }

  if (result.assistantText && from) {
    const receipt = await adapter.send({
      conversationId: conversation.id,
      text: result.assistantText,
      metadata: { to: from, subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`, inReplyTo: inbound.externalMessageId },
    });
    if (receipt.ok && receipt.detail && result.assistantMessageId) {
      new MessageRepository(db, tenant).setChannelMessageId(result.assistantMessageId, receipt.detail);
    }
  }

  return Response.json({ ok: true, conversationId: conversation.id, ticketId: ticket?.id, state: result.state });
}
