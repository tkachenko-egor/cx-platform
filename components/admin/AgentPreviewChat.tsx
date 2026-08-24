"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { MessageContent } from "../chat/MessageContent";
import { Composer } from "../chat/Composer";
import { CardRenderer } from "../cards/CardRenderer";
import type { CardPayload } from "../../src/tools/amarelle/cards";
import type { ChatMessage as GatewayMessage } from "../../src/gateway/types";
import type { AgentNativeToolsConfig } from "../../src/db/repositories/agent-def-repository";

export interface PreviewDraft {
  key?: string;
  systemPrompt: string;
  modelAlias: string;
  toolIds: string[];
  guardrails: Record<string, unknown>;
  kbScope: Record<string, unknown>;
  nativeTools: AgentNativeToolsConfig;
  skills: string[];
}

interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
}

interface TurnToolCall {
  toolKey: string;
  status: "ok" | "error";
  latencyMs: number;
}

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: CardPayload[];
  streaming?: boolean;
  error?: string;
  usage?: TurnUsage;
  toolCalls?: TurnToolCall[];
};

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

/** Milestone 6: the "how much did this cost / what did it call" strip under a test reply — read back from the same llm_calls/tool_calls rows the real cost-tracking path writes, so it's the actual numbers, not an estimate. */
function TurnStats({ usage, toolCalls }: { usage: TurnUsage; toolCalls: TurnToolCall[] }) {
  const totalTokens = usage.promptTokens + usage.completionTokens;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-1.5 text-[11px] text-muted">
      <span>{totalTokens.toLocaleString()} tokens</span>
      {usage.cachedTokens > 0 && <span>{usage.cachedTokens.toLocaleString()} cached</span>}
      <span>${usage.costUsd.toFixed(4)}</span>
      {toolCalls.length > 0 && (
        <span>
          {toolCalls.length} tool{toolCalls.length === 1 ? "" : "s"} called: {toolCalls.map((t) => `${t.toolKey}${t.status === "error" ? " (error)" : ""}`).join(", ")}
        </span>
      )}
    </div>
  );
}

/**
 * "Test as you build" pane for the agent editor (GPT Builder / Chatbase
 * playground pattern) — talks to app/api/admin/agents/preview, never to
 * /api/chat, so nothing here touches a real agent_defs row. `draft` is read
 * fresh out of a ref on every send, so a message always runs against
 * whatever is currently typed in the form, not what was there when this
 * component mounted.
 */
export function AgentPreviewChat({ draft, onClose }: { draft: PreviewDraft; onClose?: () => void }) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [citableDocs, setCitableDocs] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const historyRef = useRef<GatewayMessage[]>([]);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const reset = () => {
    conversationIdRef.current = null;
    historyRef.current = [];
    setMessages([]);
    setCitableDocs({});
    setNote(null);
  };

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: UiMessage = { id: newId(), role: "user", text: trimmed, cards: [] };
    const assistantId = newId();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", text: "", cards: [], streaming: true }]);
    setIsStreaming(true);
    setToolLabel(null);

    const updateAssistant = (patch: Partial<UiMessage>) => {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
    };

    try {
      const res = await fetch("/api/admin/agents/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversationIdRef.current, message: trimmed, history: historyRef.current, draft: draftRef.current }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        updateAssistant({ streaming: false, error: errBody.error ?? "Something went wrong." });
        return;
      }
      if (!res.body) {
        updateAssistant({ streaming: false, error: "No response from the server." });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }

          switch (event.type) {
            case "meta":
              conversationIdRef.current = event.conversationId as string;
              break;
            case "text":
              setToolLabel(null);
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + (event.delta as string) } : m)));
              break;
            case "tool_start":
              setToolLabel(`Calling ${event.name as string}…`);
              break;
            case "done": {
              const cards: CardPayload[] = (event.cards as CardPayload[] | undefined) ?? [];
              const docs = (event.citableDocs as { docId: string; title: string }[] | undefined) ?? [];
              const usage = event.usage as TurnUsage | undefined;
              const toolCalls = event.toolCalls as TurnToolCall[] | undefined;
              updateAssistant({ streaming: false, cards, usage, toolCalls });
              if (docs.length) setCitableDocs((prev) => ({ ...prev, ...Object.fromEntries(docs.map((d) => [d.docId, d.title])) }));
              historyRef.current = (event.history as GatewayMessage[] | undefined) ?? historyRef.current;
              const dropped = event.droppedWriteTools as number | undefined;
              setNote(dropped ? `${dropped} write tool${dropped === 1 ? "" : "s"} skipped in preview — test writes in a real conversation instead.` : null);
              break;
            }
            case "error":
              updateAssistant({ streaming: false, error: (event.message as string) ?? "Something went wrong." });
              break;
          }
        }
      }
    } catch {
      updateAssistant({ streaming: false, error: "Connection lost — please try again." });
    } finally {
      setIsStreaming(false);
      setToolLabel(null);
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <p className="text-sm font-semibold text-fg">Test this agent</p>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={messages.length === 0}
          title="Restart conversation"
          className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-fg disabled:opacity-40"
        >
          <RotateCcw size={14} />
        </button>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-fg">
            <X size={14} />
          </button>
        )}
      </div>

      <div aria-live="polite" className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted">
            Send a message to try your draft — model, prompt, knowledge, and tools are all live from the form. Nothing here is saved until you publish, and write tools never actually run.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-fg px-3 py-2 text-sm text-bg shadow-sm">{m.text}</div>
            ) : (
              <div className="max-w-full space-y-2">
                {m.text && <MessageContent text={m.text} citableDocs={citableDocs} />}
                {m.streaming && !m.text && (
                  <span className="inline-flex gap-1" role="status" aria-label="Thinking">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
                  </span>
                )}
                {m.error && <p className="text-xs text-danger">{m.error}</p>}
                {m.cards.map((card, i) => (
                  <CardRenderer key={i} card={card} />
                ))}
                {m.usage && !m.streaming && <TurnStats usage={m.usage} toolCalls={m.toolCalls ?? []} />}
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

      {note && <p className="border-t border-border bg-warning/5 px-4 py-2 text-xs text-warning">{note}</p>}
      <Composer onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
