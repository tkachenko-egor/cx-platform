import { createHash, randomBytes } from "node:crypto";
import type { TraceEvent } from "./trace";

/**
 * A6: opt-in OpenTelemetry export for trace events. Emits OTLP/HTTP spans
 * following the GenAI semantic conventions, *in addition to* the in-app
 * `console.log({ trace })` line in ./trace.ts — never instead of it.
 *
 * No SDK dependency: the OTLP/HTTP JSON shape is stable and small, so this
 * is a raw fetch adapter like src/gateway/embeddings/openai.ts. Absent
 * OTEL_EXPORTER_OTLP_ENDPOINT this is a synchronous no-op that does not
 * touch the network — `npm test` and the desk trace panel are unaffected.
 *
 * What goes on a span: model / provider / alias / token counts / cost /
 * latency / tool key / outcome, and the tenant id as `tenant.id`. What must
 * never go on a span: prompt or completion text, retrieved chunk content,
 * tool arguments or results, or any customer message — none of those are
 * in a TraceEvent today and none may be added here.
 */

interface OtelConfig {
  endpoint: string;
  headers: Record<string, string>;
  serviceName: string;
}

function readConfig(): OtelConfig | null {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return null;
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    serviceName: process.env.OTEL_SERVICE_NAME || "cx-platform",
  };
}

/** `OTEL_EXPORTER_OTLP_HEADERS` is the spec's `key1=value1,key2=value2` form. */
function parseHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return headers;
}

type AttrValue = string | number | boolean;

function attributes(map: Record<string, AttrValue | undefined>) {
  return Object.entries(map)
    .filter(([, v]) => v !== undefined)
    .map(([key, v]) => ({
      key,
      value:
        typeof v === "string"
          ? { stringValue: v }
          : typeof v === "boolean"
            ? { boolValue: v }
            : Number.isInteger(v)
              ? { intValue: String(v) }
              : { doubleValue: v as number },
    }));
}

/** All spans from one turn share a trace id derived from runId, so a collector groups them. */
function traceIdFor(runId: string): string {
  return createHash("sha256").update(runId).digest("hex").slice(0, 32);
}

function num(data: Record<string, unknown>, key: string): number | undefined {
  const v = data[key];
  return typeof v === "number" ? v : undefined;
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === "string" ? v : undefined;
}

/** Build the OTLP span payload for one TraceEvent, or null if this event type isn't exported. */
export function toOtlpPayload(event: TraceEvent, serviceName: string): unknown | null {
  const endNs = BigInt(new Date(event.at).getTime()) * 1_000_000n;
  const latencyMs = num(event.data, "latencyMs") ?? 0;
  const startNs = endNs - BigInt(Math.round(latencyMs * 1_000_000));

  let name: string;
  let spanAttrs: Record<string, AttrValue | undefined>;
  let isError = false;

  switch (event.type) {
    case "llm_call":
    case "llm_call_error":
    case "llm_call_skipped": {
      const model = str(event.data, "model");
      name = `chat ${model ?? "unknown"}`;
      isError = event.type !== "llm_call";
      spanAttrs = {
        "gen_ai.operation.name": "chat",
        "gen_ai.system": str(event.data, "provider"),
        "gen_ai.request.model": model,
        "gen_ai.usage.input_tokens": num(event.data, "promptTokens"),
        "gen_ai.usage.output_tokens": num(event.data, "completionTokens"),
        "gen_ai.usage.cost_usd": num(event.data, "costUsd"),
        "cx.model_alias": str(event.data, "alias"),
        "cx.fallback_used": typeof event.data.fallbackUsed === "boolean" ? event.data.fallbackUsed : undefined,
        "error.type": str(event.data, "errorType"),
      };
      break;
    }
    case "tool_call": {
      const toolKey = str(event.data, "toolKey");
      name = `execute_tool ${toolKey ?? "unknown"}`;
      isError = str(event.data, "status") === "error";
      spanAttrs = {
        "cx.tool.key": toolKey,
        "cx.tool.status": str(event.data, "status"),
      };
      break;
    }
    default:
      return null;
  }

  return {
    resourceSpans: [
      {
        resource: { attributes: attributes({ "service.name": serviceName }) },
        scopeSpans: [
          {
            scope: { name: "cx-platform/tracing" },
            spans: [
              {
                traceId: traceIdFor(event.runId),
                spanId: randomBytes(8).toString("hex"),
                name,
                kind: 3, // SPAN_KIND_CLIENT
                startTimeUnixNano: startNs.toString(),
                endTimeUnixNano: endNs.toString(),
                attributes: attributes({ ...spanAttrs, "tenant.id": event.tenantId }),
                status: { code: isError ? 2 : 1 }, // ERROR : OK
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Fire-and-forget OTLP export. Never throws — a tracing failure must not break a turn. */
export function exportTraceEvent(event: TraceEvent): void {
  const config = readConfig();
  if (!config) return;

  const payload = toOtlpPayload(event, config.serviceName);
  if (!payload) return;

  void fetch(`${config.endpoint}/v1/traces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...config.headers },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn(`[tracing] OTLP export failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}
