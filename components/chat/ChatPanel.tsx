"use client";

import { useEffect, useRef } from "react";
import { useChat } from "./ChatProvider";
import { Composer } from "./Composer";
import { MessageContent } from "./MessageContent";
import { CardRenderer } from "../cards/CardRenderer";

const SUGGESTIONS = ["Where's my order?", "I'd like to return something", "Help me choose a product", "My skin reacted to a product", "How long does shipping take?"];

const PHASE_BANNER: Record<string, string> = {
  awaiting_human: "A colleague has been notified and will pick this up shortly.",
  human_active: "You're now talking with a colleague.",
};

export function ChatPanel() {
  const { messages, sendMessage, retryMessage, isStreaming, toolLabel, phase, citableDocs } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

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
            <p className="text-sm text-muted">Hello — I&apos;m an AI assistant and I can help with orders, returns, and product questions. What can I do for you?</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => sendMessage(s)} className="rounded-full border border-border px-3 py-1.5 text-xs text-fg hover:border-accent hover:text-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} tabIndex={-1} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-fg px-3 py-2 text-sm text-bg">{m.text}</div>
            ) : (
              <div className="max-w-full space-y-2">
                {m.role === "agent_human" && <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Colleague</p>}
                {m.text && <MessageContent text={m.text} citableDocs={citableDocs} />}
                {m.streaming && !m.text && (
                  <span className="inline-flex gap-1" role="status" aria-label="Thinking">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
                  </span>
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
