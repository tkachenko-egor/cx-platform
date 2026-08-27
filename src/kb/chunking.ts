export interface RawChunk {
  heading: string | null;
  /** A5: ATX depth of `heading` (2 for `##`, 3 for `###`, …), or null for the pre-heading preamble chunk. */
  headingLevel: number | null;
  text: string;
  /** A5: the chunk contains a Markdown pipe table. A section (table included) is the atomic chunk unit, so a table is never split from its heading. */
  containsTable: boolean;
}

/** ATX headings of level 2+ start a new section. Level-1 (`#`, the document title) stays with the preamble — the title is already on kb_articles.title. */
const SECTION_HEADING = /^(#{2,6})\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/m;

/**
 * FR-7.3: structure-aware chunking. Splits on ATX section headings (H2 and
 * deeper) — matching the usual shape of a policy document (H1 title + intro,
 * then sections, some containing tables) — and never splits a section
 * mid-table, since a section is the atomic chunk unit.
 *
 * A5: with a layout-aware PDF extractor (src/kb/pdf-extract.ts) the input is
 * real Markdown with genuine headings and pipe tables rather than flattened
 * text, so this splitter's section boundaries and `containsTable` flag now
 * reflect the document's actual structure. Behaviour on hand-written `.md`
 * KB articles is unchanged (they already use `##` sections and no `###`).
 */
export function chunkMarkdown(body: string): RawChunk[] {
  const lines = body.split(/\r?\n/);
  const chunks: RawChunk[] = [];
  let currentHeading: string | null = null;
  let currentLevel: number | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) chunks.push({ heading: currentHeading, headingLevel: currentLevel, text, containsTable: TABLE_ROW.test(text) });
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(SECTION_HEADING);
    if (heading) {
      flush();
      currentHeading = heading[2].trim();
      currentLevel = heading[1].length;
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
