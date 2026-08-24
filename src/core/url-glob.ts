/**
 * Phase 9 M3: simple `*`-glob path matching for widget audience targeting —
 * see app/api/embed-chat/[publicKey]/should-mount/route.ts. `*` matches any
 * run of characters, everything else is literal. No regex-injection surface
 * since the whole pattern is escaped before the wildcard is reinstated.
 */
export function matchesGlob(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? " " : `\\${c}`));
  const regex = new RegExp(`^${escaped.replaceAll(" ", ".*")}$`);
  return regex.test(path);
}
