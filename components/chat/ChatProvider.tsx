"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { CardPayload } from "../../src/tools/amarelle/cards";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "agent_human";
  text: string;
  cards: CardPayload[];
  streaming?: boolean;
  error?: string;
  /** Phase 9 M4: the real messages.id row this bubble was persisted as — set once the "done" event arrives, since the client-side `id` above is generated before the server even responds. Feedback submission needs this, not the client id. */
  dbId?: string;
  feedback?: "up" | "down";
};

type ConversationPhase = "bot_active" | "awaiting_human" | "human_active" | "resolved";

type ChatContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<void>;
  retryMessage: (assistantMessageId: string) => void;
  submitFeedback: (assistantMessageId: string, rating: "up" | "down") => Promise<void>;
  isStreaming: boolean;
  toolLabel: string | null;
  phase: ConversationPhase;
  citableDocs: Record<string, string>;
  hasUnread: boolean;
  greeting: string;
  quickReplies?: string[];
};

const ChatContext = createContext<ChatContextValue | null>(null);

const TOOL_LABELS: Record<string, string> = {
  lookup_order: "Checking your order…",
  check_return_eligibility: "Checking eligibility…",
  search_products: "Searching products…",
};

const POLL_INTERVAL_MS = 3000;
const DEFAULT_GREETING = "Hello — I'm an AI assistant and I can help with orders, returns, and product questions. What can I do for you?";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
}

export function ChatProvider({
  children,
  chatEndpoint = "/api/chat",
  messagesEndpointBase = "/api/conversations",
  feedbackEndpoint = "/api/chat/feedback",
  greeting = DEFAULT_GREETING,
  quickReplies,
}: {
  children: ReactNode;
  /** Phase 4 M4: an embed page points these at /api/embed-chat/{publicKey} instead — same-origin demo widget (app/page.tsx) keeps the defaults untouched. */
  chatEndpoint?: string;
  messagesEndpointBase?: string;
  /** Phase 9 M4: same same-origin-default / embed-override split as chatEndpoint. */
  feedbackEndpoint?: string;
  greeting?: string;
  /** Phase 6 M5: the agent's admin-authored quick-reply chips — undefined (not just empty) falls back to ChatPanel's hardcoded SUGGESTIONS. */
  quickReplies?: string[];
}) {
  const [open, setOpenState] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [phase, setPhase] = useState<ConversationPhase>("bot_active");
  const [citableDocs, setCitableDocs] = useState<Record<string, string>>({});
  const [hasUnread, setHasUnread] = useState(false);

  const conversationIdRef = useRef<string | null>(null);
  const openRef = useRef(open);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (next) setHasUnread(false);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const conversationId = conversationIdRef.current;
      if (!conversationId) return;
      try {
        const res = await fetch(`${messagesEndpointBase}/${conversationId}/messages`);
        if (!res.ok) return;
        const body = (await res.json()) as { state: ConversationPhase; messages: { id: string; role: string; content: string }[] };
        setPhase(body.state);
        for (const m of body.messages) {
          if (m.role !== "agent_human" || knownMessageIdsRef.current.has(m.id)) continue;
          knownMessageIdsRef.current.add(m.id);
          setMessages((prev) => [...prev, { id: m.id, role: "agent_human", text: m.content, cards: [] }]);
          if (!openRef.current) setHasUnread(true);
        }
        if (body.state === "bot_active" || body.state === "resolved") stopPolling();
      } catch {
        // transient — next tick retries
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling, messagesEndpointBase]);

  useEffect(() => stopPolling, [stopPolling]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMsg: ChatMessage = { id: newId(), role: "user", text: trimmed, cards: [] };
      const assistantId = newId();
      setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", text: "", cards: [], streaming: true }]);
      setIsStreaming(true);
      setToolLabel(null);

      const updateAssistant = (patch: Partial<ChatMessage>) => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
      };

      try {
        const res = await fetch(chatEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conversationIdRef.current, message: trimmed }),
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
                setToolLabel(TOOL_LABELS[event.name as string] ?? "Working…");
                break;
              case "handoff":
                setPhase(event.state as ConversationPhase);
                startPolling();
                break;
              case "done": {
                const cards: CardPayload[] = (event.cards as CardPayload[] | undefined) ?? [];
                const docs = (event.citableDocs as { docId: string; title: string }[] | undefined) ?? [];
                updateAssistant({ streaming: false, cards, dbId: event.assistantMessageId as string | undefined });
                if (docs.length) {
                  setCitableDocs((prev) => ({ ...prev, ...Object.fromEntries(docs.map((d) => [d.docId, d.title])) }));
                }
                if (!openRef.current) setHasUnread(true);
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
    },
    [startPolling, chatEndpoint],
  );

  const submitFeedback = useCallback(
    async (assistantMessageId: string, rating: "up" | "down") => {
      const conversationId = conversationIdRef.current;
      if (!conversationId) return;
      // Optimistic — a failed submit just leaves the buttons re-clickable rather than showing an error state, low-stakes enough not to need one.
      setMessages((prev) => prev.map((m) => (m.dbId === assistantMessageId ? { ...m, feedback: rating } : m)));
      try {
        await fetch(feedbackEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, messageId: assistantMessageId, rating }),
        });
      } catch {
        // best-effort
      }
    },
    [feedbackEndpoint],
  );

  const retryMessage = useCallback(
    (assistantMessageId: string) => {
      const current = messagesRef.current;
      const idx = current.findIndex((m) => m.id === assistantMessageId);
      if (idx <= 0) return;
      const userText = current[idx - 1]?.text;
      if (!userText) return;
      setMessages(current.slice(0, idx - 1));
      sendMessage(userText);
    },
    [sendMessage],
  );

  return (
    <ChatContext.Provider value={{ open, setOpen, messages, sendMessage, retryMessage, submitFeedback, isStreaming, toolLabel, phase, citableDocs, hasUnread, greeting, quickReplies }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
}
