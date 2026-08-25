/** Turns an admin-typed name into a safe identifier: lowercase, non-alphanumerics collapsed to single underscores, trimmed, capped at 64 chars. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
    .replace(/_+$/g, "");
}
