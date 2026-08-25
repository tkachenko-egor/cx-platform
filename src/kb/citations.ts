/**
 * Splits assistant text on [doc_id] citation markers (see the CITATION
 * section of the system prompt) into plain-text and citation segments the
 * UI can render as chips. Deliberately no hardcoded doc_id allowlist —
 * with real hybrid retrieval, any doc_id the KB actually returned this
 * turn is a legitimate citation.
 */
export type TextSegment = { type: "text"; text: string };
export type CitationSegment = { type: "citation"; docId: string };
export type MessageSegment = TextSegment | CitationSegment;

const CITATION_RE = /\[([a-z0-9-]+)\]/g;

export function parseCitations(text: string, knownDocIds: ReadonlySet<string>): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const docId = match[1];
    if (!knownDocIds.has(docId)) continue;
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ type: "text", text: text.slice(lastIndex, index) });
    segments.push({ type: "citation", docId });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: "text", text: text.slice(lastIndex) });
  return segments;
}
