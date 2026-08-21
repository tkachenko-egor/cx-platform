import type Database from "better-sqlite3";
import type { TenantContext } from "../tenancy/context";
import { ProviderCredentialRepository } from "../db/repositories/provider-credential-repository";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const ARGS_LOCATIONS = ["body", "query"] as const;
const AUTH_STYLES = ["bearer", "header", "query_param", "none"] as const;

export interface HttpToolConfig {
  url: string;
  method: (typeof HTTP_METHODS)[number];
  headers: Record<string, string>;
  argsLocation: (typeof ARGS_LOCATIONS)[number];
  credentialId: string | null;
  authStyle: (typeof AUTH_STYLES)[number];
  authParamName: string | null;
  timeoutMs: number;
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

  return {
    url: raw.url,
    method,
    headers,
    argsLocation,
    credentialId: typeof raw.credentialId === "string" ? raw.credentialId : null,
    authStyle,
    authParamName: typeof raw.authParamName === "string" ? raw.authParamName : null,
    timeoutMs: Math.min(requestedTimeout, MAX_TIMEOUT_MS),
  };
}

/**
 * Generic mechanics for admin-authored HTTP tools — no tenant-specific
 * logic, lives alongside registry.ts rather than under src/tools/amarelle/.
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
      return { ok: false, error: `HTTP tool returned ${response.status}`, status: response.status, data };
    }
    return { ok: true, status: response.status, data };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    return { ok: false, error: timedOut ? `HTTP tool timed out after ${config.timeoutMs}ms` : err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}
