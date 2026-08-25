"use client";

import { useEffect, useRef } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { useChat } from "./ChatProvider";
import { Composer } from "./Composer";
import { MessageContent } from "./MessageContent";
import { MessageBubble } from "./MessageBubble";
import { CardRenderer } from "../cards/CardRenderer";

// RD-04: vertical-neutral fallback only — this component is shared by every
// tenant, so it must never hardcode one brand's product category (previously
// leaked a skincare-specific chip onto agents with no configured quick
// replies, i.e. every brand-new agent before Voice & conversation is touched).
const SUGGESTIONS = ["Where's my order?", "I'd like to return something", "Talk to a human", "What are your business hours?"];

const PHASE_BANNER: Record<string, string> = {
  awaiting_human: "A colleague has been notified and will pick this up shortly.",
  human_active: "You're now talking with a colleague.",
};

export function ChatPanel() {
  const { messages, sendMessage, retryMessage, submitFeedback, isStreaming, toolLabel, phase, citableDocs, greeting, quickReplies } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const suggestions = quickReplies && quickReplies.length > 0 ? quickReplies : SUGGESTIONS;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, toolLabel]);

  const banner = PHASE_BANNER[phase];

  return (
    <div className="flex h-full flex-col bg-surface">
      {banner && <div className="border-b border-border bg-accent/10 px-4 py-2 text-xs text-accent">{banner}</div>}

      <div ref={scrollRef} aria-live="polite" className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-muted">{greeting}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-fg transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} tabIndex={-1} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <MessageBubble role="user">{m.text}</MessageBubble>
            ) : (
              <div className="max-w-full space-y-2">
                {m.role === "agent_human" && <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Colleague</p>}
                {(m.text || m.streaming) && (
                  <MessageBubble role="bot">
                    {m.text && <MessageContent text={m.text} citableDocs={citableDocs} />}
                    {m.streaming && !m.text && (
                      <span className="inline-flex gap-1" role="status" aria-label="Thinking">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
                      </span>
                    )}
                  </MessageBubble>
                )}
                {m.error && (
                  <p className="text-xs text-danger">
                    {m.error}{" "}
                    <button type="button" onClick={() => retryMessage(m.id)} disabled={isStreaming} className="font-medium underline disabled:opacity-50">
                      Retry
                    </button>
                  </p>
                )}
                {m.cards.map((card, i) => (
                  <CardRenderer key={i} card={card} />
                ))}
                {m.role === "assistant" && !m.streaming && !m.error && m.dbId && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => submitFeedback(m.dbId!, "up")}
                      aria-label="Good response"
                      aria-pressed={m.feedback === "up"}
                      className={`rounded-lg p-1 transition-colors ${m.feedback === "up" ? "text-accent" : "text-muted hover:text-fg"}`}
                    >
                      <ThumbsUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => submitFeedback(m.dbId!, "down")}
                      aria-label="Bad response"
                      aria-pressed={m.feedback === "down"}
                      className={`rounded-lg p-1 transition-colors ${m.feedback === "down" ? "text-danger" : "text-muted hover:text-fg"}`}
                    >
                      <ThumbsDown size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {toolLabel && (
          <p role="status" className="text-xs text-muted">
            {toolLabel}
          </p>
        )}
      </div>

      <Composer onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
