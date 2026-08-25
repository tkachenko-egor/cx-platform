import type { ReactNode } from "react";
import { parseCitations } from "../../src/kb/citations";

const BOLD_RE = /\*\*(.+?)\*\*/g;

/**
 * AB-03: the style instruction ("two to four sentences, bullets only for
 * real lists") doesn't stop the model from reaching for **bold** anyway —
 * it's a common LLM habit regardless of prompting — and this component used
 * to render it completely literally, asterisks and all, to real customers.
 * Still deliberately minimal (no markdown library): only **bold** is
 * unwrapped into <strong>, nothing richer. That belongs on a card.
 */
function renderInlineMarkdown(text: string, keyPrefix: string) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  for (const match of text.matchAll(BOLD_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(<span key={`${keyPrefix}-${i++}`}>{text.slice(lastIndex, index)}</span>);
    parts.push(<strong key={`${keyPrefix}-${i++}`}>{match[1]}</strong>);
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(<span key={`${keyPrefix}-${i++}`}>{text.slice(lastIndex)}</span>);
  return parts;
}

export function MessageContent({ text, citableDocs }: { text: string; citableDocs: Record<string, string> }) {
  const knownDocIds = new Set(Object.keys(citableDocs));
  const segments = parseCitations(text, knownDocIds);

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <span key={i}>{renderInlineMarkdown(seg.text, `seg-${i}`)}</span>
        ) : (
          <a
            key={i}
            href={`/kb/${seg.docId}`}
            className="mx-0.5 inline-block rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-accent hover:underline"
          >
            {citableDocs[seg.docId] ?? seg.docId}
          </a>
        ),
      )}
    </p>
  );
}
