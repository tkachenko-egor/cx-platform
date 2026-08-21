import { parseCitations } from "../../src/kb/citations";

/**
 * Deliberately minimal — no markdown dependency. The assistant's style
 * instruction is "two to four sentences, bullets only for real lists," so
 * line breaks are the only structure worth preserving; anything richer
 * belongs on a card, not in-stream text.
 */
export function MessageContent({ text, citableDocs }: { text: string; citableDocs: Record<string, string> }) {
  const knownDocIds = new Set(Object.keys(citableDocs));
  const segments = parseCitations(text, knownDocIds);

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <span key={i}>{seg.text}</span>
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
