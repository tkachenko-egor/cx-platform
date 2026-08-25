/**
 * Phase 6 M2: single source of truth for every model an admin can pick for
 * an agent, grouped by provider. Plain data — editing this list needs no
 * other code change (the Agent Editor's dropdown, the Agents list display
 * name, and the seed script's auto-seeded aliases all read from here).
 */
export interface ModelCatalogEntry {
  provider: string;
  model: string;
  displayName: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { provider: "anthropic", model: "claude-opus-5", displayName: "Opus 5" },
  { provider: "anthropic", model: "claude-sonnet-5", displayName: "Sonnet 5" },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" },
  { provider: "anthropic", model: "claude-fable-5", displayName: "Fable 5" },
  { provider: "openai", model: "gpt-5.1", displayName: "GPT-5.1" },
  { provider: "openai", model: "gpt-5.1-mini", displayName: "GPT-5.1 mini" },
  { provider: "openai", model: "gpt-5.1-nano", displayName: "GPT-5.1 nano" },
];

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export function findCatalogEntry(provider: string, model: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((e) => e.provider === provider && e.model === model);
}

export function displayNameForAlias(provider: string, model: string): string {
  return findCatalogEntry(provider, model)?.displayName ?? model;
}

/** The zero-network dev/test fixture (src/gateway/providers/stub.ts) — never a real model, but nothing else in the resolved alias marks it as such, so callers must check the provider explicitly before showing a model name as if it were live. */
export function isStubProvider(provider: string): boolean {
  return provider === "stub";
}
