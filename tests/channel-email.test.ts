import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { TenantRepository } from "../src/db/repositories/tenant-repository";
import { ConversationRepository } from "../src/db/repositories/conversation-repository";
import { MessageRepository } from "../src/db/repositories/message-repository";
import { stripQuotedContent } from "../src/channel/email/strip-quoted";
import { isAutoResponse } from "../src/channel/email/autoresponder";
import { normalizedSubjectHash, resolveEmailConversationId } from "../src/channel/email/threading";
import { EmailChannelAdapter } from "../src/channel/email/adapter";
import { StubEmailProvider } from "../src/channel/email/providers/stub";

describe("stripQuotedContent (FR-3.13)", () => {
  it("cuts off an 'On ... wrote:' quoted block", async () => {
    const body = "Thanks, that answers it!\n\nOn Mon, Jan 5, 2026 at 3:00 PM Jane <jane@example.com> wrote:\n> original question here";
    expect(stripQuotedContent(body)).toBe("Thanks, that answers it!");
  });

  it("cuts off an Outlook-style '-----Original Message-----' block", async () => {
    const body = "Sounds good.\n\n-----Original Message-----\nFrom: support@example.com\nSent: today\n\nHello!";
    expect(stripQuotedContent(body)).toBe("Sounds good.");
  });

  it("strips a plain '-- ' signature delimiter and everything after it", async () => {
    const body = "See you then.\n-- \nJane Doe\nSenior Whatever";
    expect(stripQuotedContent(body)).toBe("See you then.");
  });

  it("strips leading '>' quoted lines", async () => {
    const body = "Agreed.\n> previous line one\n> previous line two";
    expect(stripQuotedContent(body)).toBe("Agreed.");
  });

  it("leaves an ordinary reply with no quoting untouched", async () => {
    expect(stripQuotedContent("Where is my order ORD-100001?")).toBe("Where is my order ORD-100001?");
  });
});

describe("isAutoResponse (FR-3.16)", () => {
  it("detects Auto-Submitted: auto-replied", async () => {
    expect(isAutoResponse({ "auto-submitted": "auto-replied" }, "Re: your ticket")).toBe(true);
  });

  it("does not treat Auto-Submitted: no as an autoresponder", async () => {
    expect(isAutoResponse({ "auto-submitted": "no" }, "Where is my order?")).toBe(false);
  });

  it("detects a vacation-style subject even with no special headers", async () => {
    expect(isAutoResponse({}, "Automatic reply: Out of Office")).toBe(true);
  });

  it("does not flag an ordinary customer subject", async () => {
    expect(isAutoResponse({}, "Question about my order")).toBe(false);
  });
});

describe("email threading (FR-3.12)", () => {
  it("resolves an existing conversation via In-Reply-To against a stored channel_message_id", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
    const conversation = await new ConversationRepository(db, tenant).create({ channel: "email", agentKey: "support-generalist" });
    await new MessageRepository(db, tenant).append({ conversationId: conversation.id, role: "assistant", content: "reply", channelMessageId: "<first@example.com>" });

    const resolved = await resolveEmailConversationId(db, tenant, { inReplyToExternalId: "<first@example.com>", subject: "Re: help" });
    expect(resolved).toBe(conversation.id);
  });

  it("falls back to a normalized subject hash when there is no header match", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
    const conversation = await new ConversationRepository(db, tenant).create({
      channel: "email",
      agentKey: "support-generalist",
      metadata: { subjectHash: normalizedSubjectHash("Order question") },
    });

    // A reply mangled with Re:/Fwd: prefixes and different casing still hashes the same.
    const resolved = await resolveEmailConversationId(db, tenant, { subject: "Fwd: RE: order question" });
    expect(resolved).toBe(conversation.id);
  });

  it("returns undefined for a genuinely new thread", async () => {
    const db = createDb(":memory:");
    const tenant = await new TenantRepository(db).create("Tenant A", "tenant-a");
    expect(await resolveEmailConversationId(db, tenant, { subject: "Brand new question" })).toBeUndefined();
  });
});

describe("EmailChannelAdapter", () => {
  it("drops an autoresponder before it becomes a canonical message", async () => {
    const adapter = new EmailChannelAdapter(new StubEmailProvider());
    const result = adapter.receive({
      messageId: "<auto@example.com>",
      from: "vacation@example.com",
      subject: "Automatic reply: Out of Office",
      textBody: "I am currently out of office.",
      headers: {},
    });
    expect(result).toBeNull();
  });

  it("strips quoting and carries threading metadata through for an ordinary inbound email", async () => {
    const adapter = new EmailChannelAdapter(new StubEmailProvider());
    const result = adapter.receive({
      messageId: "<msg-1@example.com>",
      inReplyTo: "<msg-0@example.com>",
      from: "customer@example.com",
      subject: "Re: my order",
      textBody: "Still waiting on this.\n\nOn Mon wrote:\n> earlier text",
      headers: {},
    });
    expect(result).not.toBeNull();
    expect(result?.text).toBe("Still waiting on this.");
    expect(result?.externalMessageId).toBe("<msg-1@example.com>");
    expect(result?.inReplyToExternalId).toBe("<msg-0@example.com>");
    expect(result?.metadata?.from).toBe("customer@example.com");
  });
});
