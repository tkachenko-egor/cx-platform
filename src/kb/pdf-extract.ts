import { PDFParse } from "pdf-parse";

/** Phase 5 M2: text-layer extraction only (no OCR) — covers normal text-based PDFs (policy docs, product sheets exported from Word/Docs), not scanned/image-only ones. */
export async function extractPdfText(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText({ pageJoiner: "\n" });
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}
