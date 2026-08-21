import Link from "next/link";
import { ChatProvider } from "../components/chat/ChatProvider";
import { ChatWidget } from "../components/chat/ChatWidget";

export default function DemoPage() {
  return (
    <ChatProvider>
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-3xl font-semibold text-fg">CX Platform — Phase 1 demo</h1>
        <p className="text-muted">
          Model-agnostic support agent, hybrid-retrieval KB, and human-desk copilot mode, running against the Amarelle
          Botanique tenant. Open the chat bubble in the corner to try it.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Try: &ldquo;Where&apos;s my order ORD-100001?&rdquo;</li>
          <li>Try: &ldquo;I&apos;d like to return something from ORD-100001&rdquo;</li>
          <li>Try: &ldquo;My skin reacted to a product&rdquo; (routes to a human)</li>
        </ul>
        <Link href="/desk" className="text-sm text-accent hover:underline">
          Open the human desk →
        </Link>
      </main>
      <ChatWidget />
    </ChatProvider>
  );
}
