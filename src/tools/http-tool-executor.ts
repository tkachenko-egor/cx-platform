import type Database from "better-sqlite3";
import type { TenantContext } from "../tenancy/context";
import { ProviderCredentialRepository } from "../db/repositories/provider-credential-repository";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const ARGS_LOCATIONS = ["body", "query"] as const;
const AUTH_STYLES = ["bearer", "header", "query_param", "none"] as const;

/** Phase 9 M1: dot-path extraction (e.g. "customer.email"), optionally renamed via `as`. */
export interface OutputFieldMapping {
  path: string;
  as?: string;
}

export interface HttpToolConfig {
  url: string;
  method: (typeof HTTP_METHODS)[number];
  headers: Record<string, string>;
  argsLocation: (typeof ARGS_LOCATIONS)[number];
  credentialId: string | null;
  authStyle: (typeof AUTH_STYLES)[number];
  authParamName: string | null;
  timeoutMs: number;
  /** Phase 9 M1: when non-empty, `data` is replaced with just these plucked/renamed fields instead of the full upstream response verbatim. Empty/absent means today's behavior, unchanged. */
  outputFields: OutputFieldMapping[];
  /** Phase 9 M1: shown to the model instead of the technical error on a non-2xx/timeout/network failure — the real message still goes into `detail` (and the tool_calls log) either way. Unset means today's raw technical message, unchanged. */
  fallbackMessage: string | null;
}

function resolvePath(data: unknown, path: string): unknown {
  let value: unknown = data;
  for (const segment of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** Dot-path extraction/rename — no external dependency, mirrors this file's existing "small, self-contained, no new lib" style (see json-schema-lite.ts). Missing paths are silently omitted, not errors — a flaky upstream field shouldn't break the whole result. */
export function pluckFields(data: unknown, mapping: OutputFieldMapping[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const { path, as } of mapping) {
    const value = resolvePath(data, path);
    if (value !== undefined) result[as?.trim() || path] = value;
  }
  return result;
}

/** NC-01: which configured mappings resolved to nothing against the raw response — pluckFields itself stays silent (right call for a live agent turn, see above), but the tool-test endpoint uses this to warn loudly instead of handing back an unexplained `data: {}`. */
export function unresolvedOutputFields(data: unknown, mapping: OutputFieldMapping[]): string[] {
  return mapping.filter(({ path }) => resolvePath(data, path) === undefined).map(({ path }) => path);
}

/** Validates + defaults a tool_defs.handler_config JSON blob into an HttpToolConfig. Called both when building a runtime ToolSpec and server-side on tool creation — never trusts client JSON as-is. */
export function parseHttpToolConfig(raw: Record<string, unknown>): HttpToolConfig {
  if (typeof raw.url !== "string" || !raw.url) {
    throw new Error("HTTP tool config requires a non-empty \"url\"");
  }
  const method = typeof raw.method === "string" && (HTTP_METHODS as readonly string[]).includes(raw.method) ? (raw.method as HttpToolConfig["method"]) : "POST";
  const argsLocation = typeof raw.argsLocation === "string" && (ARGS_LOCATIONS as readonly string[]).includes(raw.argsLocation) ? (raw.argsLocation as HttpToolConfig["argsLocation"]) : "body";
  const authStyle = typeof raw.authStyle === "string" && (AUTH_STYLES as readonly string[]).includes(raw.authStyle) ? (raw.authStyle as HttpToolConfig["authStyle"]) : "none";
  const headers = raw.headers && typeof raw.headers === "object" ? (raw.headers as Record<string, string>) : {};
  const requestedTimeout = typeof raw.timeoutMs === "number" ? raw.timeoutMs : DEFAULT_TIMEOUT_MS;
  const outputFields = Array.isArray(raw.outputFields)
    ? (raw.outputFields as unknown[]).filter((f): f is OutputFieldMapping => Boolean(f) && typeof f === "object" && typeof (f as OutputFieldMapping).path === "string" && (f as OutputFieldMapping).path.length > 0)
    : [];

  return {
    url: raw.url,
    method,
    headers,
    argsLocation,
    credentialId: typeof raw.credentialId === "string" ? raw.credentialId : null,
    authStyle,
    authParamName: typeof raw.authParamName === "string" ? raw.authParamName : null,
    timeoutMs: Math.min(requestedTimeout, MAX_TIMEOUT_MS),
    outputFields,
    fallbackMessage: typeof raw.fallbackMessage === "string" && raw.fallbackMessage.trim() ? raw.fallbackMessage : null,
  };
}

/**
 * Generic mechanics for admin-authored HTTP tools — no tenant-specific
 * logic, lives alongside registry.ts rather than under src/tools/commerce/.
 * Mirrors every code tool's { ok: false, error } contract (FR-8.9): never
 * throws to the caller, so a bad integration can't break the agent loop.
 */
export async function runHttpTool(db: Database.Database, tenant: TenantContext, config: HttpToolConfig, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    return { ok: false, error: `Invalid tool URL: ${config.url}` };
  }

  const headers = new Headers(config.headers);
  let body: string | undefined;

  if (config.argsLocation === "query") {
    for (const [key, value] of Object.entries(args)) {
      url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  } else if (config.method !== "GET") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(args);
  }

  if (config.credentialId && config.authStyle !== "none") {
    const credential = new ProviderCredentialRepository(db, tenant).getToolCredential(config.credentialId);
    if (!credential) {
      return { ok: false, error: "Configured tool credential is missing or inactive" };
    }
    if (config.authStyle === "bearer") {
      headers.set("Authorization", `Bearer ${credential.decryptedKey}`);
    } else if (config.authStyle === "header" && config.authParamName) {
      headers.set(config.authParamName, credential.decryptedKey);
    } else if (config.authStyle === "query_param" && config.authParamName) {
      url.searchParams.set(config.authParamName, credential.decryptedKey);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, { method: config.method, headers, body, signal: controller.signal });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // Non-JSON response body — return it as raw text.
    }

    if (!response.ok) {
      const detail = `HTTP tool returned ${response.status}`;
      return config.fallbackMessage ? { ok: false, error: config.fallbackMessage, detail, status: response.status, data } : { ok: false, error: detail, status: response.status, data };
    }
    const mappedData = config.outputFields.length > 0 ? pluckFields(data, config.outputFields) : data;
    const unresolved = config.outputFields.length > 0 ? unresolvedOutputFields(data, config.outputFields) : [];
    return { ok: true, status: response.status, data: mappedData, ...(unresolved.length > 0 ? { unresolvedOutputFields: unresolved } : {}) };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    const detail = timedOut ? `HTTP tool timed out after ${config.timeoutMs}ms` : err instanceof Error ? err.message : String(err);
    return config.fallbackMessage ? { ok: false, error: config.fallbackMessage, detail } : { ok: false, error: detail };
  } finally {
    clearTimeout(timeout);
  }
}
