import { PDFParse } from "pdf-parse";

/**
 * A5: PDF → Markdown for KB ingestion. A layout-aware Docling sidecar
 * (DOCLING_URL) is used when configured — it preserves headings, tables and
 * reading order, which the chunker (src/kb/chunking.ts) then sees as real
 * structure. When the sidecar is unset or unreachable, this falls back to
 * pdf-parse's text-layer extraction (the Phase 5 M2 behaviour): no OCR, and
 * headings/tables are flattened, but the guardrail against a failed import
 * is that the ingest still produces *something* rather than throwing.
 *
 * Nothing Python enters the Node process — Docling runs as its own HTTP
 * service, same thin-adapter shape as the embedding and rerank providers.
 *
 * Re-ingestion note: switching a deployment onto Docling changes the
 * extracted text (and therefore content hashes and chunk boundaries) for
 * existing PDF-sourced articles. That is a deliberate re-index — run
 * `npm run ingest-kb` (file-sourced) or re-import via the admin KB editor —
 * not a silent change. Markdown-sourced articles are unaffected.
 */
export async function extractPdfText(data: Buffer): Promise<string> {
  const doclingUrl = process.env.DOCLING_URL;
  if (doclingUrl) {
    try {
      return await extractViaDocling(data, doclingUrl);
    } catch (err) {
      console.warn(`[kb] Docling extraction failed (${err instanceof Error ? err.message : String(err)}) — falling back to pdf-parse`);
    }
  }
  return extractViaPdfParse(data);
}

/** docling-serve: multipart POST, JSON back with the Markdown export under document.md_content. */
async function extractViaDocling(data: Buffer, url: string): Promise<string> {
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(data)], { type: "application/pdf" }), "document.pdf");
  form.append("to_formats", "md");
  form.append("do_ocr", "false");

  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Docling responded ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }

  const body = (await res.json()) as { document?: { md_content?: string }; md_content?: string; markdown?: string };
  const markdown = body.document?.md_content ?? body.md_content ?? body.markdown;
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new Error("Docling returned no Markdown content");
  }
  return markdown.trim();
}

/** Phase 5 M2 behaviour: text-layer extraction only (no OCR) — normal text-based PDFs, not scanned/image-only ones. */
async function extractViaPdfParse(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText({ pageJoiner: "\n" });
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}
