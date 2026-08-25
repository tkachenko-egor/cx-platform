export interface RawChunk {
  heading: string | null;
  text: string;
}

/**
 * FR-7.3: structure-aware chunking. Splits on H2 headings — matching the
 * usual shape of a policy document (H1 title + intro, then H2 sections,
 * some containing tables) — and never splits a section mid-table, since a
 * section (table included) is the atomic chunk unit.
 */
export function chunkMarkdown(body: string): RawChunk[] {
  const lines = body.split(/\r?\n/);
  const chunks: RawChunk[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) chunks.push({ heading: currentHeading, text });
    buffer = [];
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      flush();
      currentHeading = h2[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return chunks;
}

/** Rough heuristic (~4 chars/token) — good enough for Phase 1 budgeting, not a real tokenizer. */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
