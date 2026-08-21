/**
 * FR-3.13: strip quoted replies and signatures before the text reaches an
 * agent — otherwise every reply re-sends the entire thread history as
 * "new" customer text.
 */
export function stripQuotedContent(body: string): string {
  let text = body.replace(/\r\n/g, "\n");

  // RFC 3676 signature delimiter: a line that is exactly "-- ", and everything after it.
  const sigMatch = text.match(/\n-- \s*\n/);
  if (sigMatch?.index !== undefined) {
    text = text.slice(0, sigMatch.index);
  }

  const lines = text.split("\n");
  let cutAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^On .{0,160} wrote:$/.test(line)) {
      cutAt = i;
      break;
    }
    if (/^-{2,}\s?Original Message\s?-{2,}$/i.test(line)) {
      cutAt = i;
      break;
    }
  }
  text = lines.slice(0, cutAt).join("\n");

  // Plain-text quoted lines ("> ...").
  text = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");

  return text.trim();
}
