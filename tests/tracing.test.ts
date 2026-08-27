import { afterEach, describe, expect, it, vi } from "vitest";
import { emitTrace, type TraceEvent } from "../src/tracing/trace";
import { toOtlpPayload, exportTraceEvent } from "../src/tracing/otel-exporter";

const OTEL_ENV = ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "OTEL_SERVICE_NAME"] as const;

function clearOtelEnv() {
  for (const key of OTEL_ENV) delete process.env[key];
}

function event(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return { runId: "run-1", tenantId: "tenant-1", type: "llm_call", data: {}, at: "2026-08-27T10:00:00.000Z", ...overrides };
}

interface OtlpAttr {
  key: string;
  value: { stringValue?: string; boolValue?: boolean; intValue?: string; doubleValue?: number };
}
interface OtlpSpan {
  name: string;
  traceId: string;
  status: { code: number };
  attributes: OtlpAttr[];
}
interface OtlpPayload {
  resourceSpans: [{ scopeSpans: [{ spans: [OtlpSpan] }] }];
}

/** Pull {name, attrs} out of an OTLP payload for assertions. */
function span(payload: unknown) {
  const s = (payload as OtlpPayload).resourceSpans[0].scopeSpans[0].spans[0];
  const attrs: Record<string, unknown> = {};
  for (const a of s.attributes) attrs[a.key] = a.value.stringValue ?? a.value.boolValue ?? a.value.intValue ?? a.value.doubleValue;
  return { name: s.name, traceId: s.traceId, status: s.status.code, attrs };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearOtelEnv();
});

describe("toOtlpPayload", () => {
  it("maps an llm_call event to a GenAI chat span with tokens, cost and tenant id", () => {
    const payload = toOtlpPayload(
      event({ type: "llm_call", data: { alias: "support-main", provider: "anthropic", model: "claude-sonnet-5", fallbackUsed: false, latencyMs: 1200, promptTokens: 900, completionTokens: 120, costUsd: 0.0042 } }),
      "cx-platform",
    );
    const { name, status, attrs } = span(payload);
    expect(name).toBe("chat claude-sonnet-5");
    expect(status).toBe(1); // OK
    expect(attrs["gen_ai.system"]).toBe("anthropic");
    expect(attrs["gen_ai.request.model"]).toBe("claude-sonnet-5");
    expect(attrs["gen_ai.usage.input_tokens"]).toBe("900");
    expect(attrs["gen_ai.usage.output_tokens"]).toBe("120");
    expect(attrs["gen_ai.usage.cost_usd"]).toBe(0.0042);
    expect(attrs["tenant.id"]).toBe("tenant-1");
  });

  it("maps a tool_call event to an execute_tool span, error status when the tool failed", () => {
    const payload = toOtlpPayload(event({ type: "tool_call", data: { toolKey: "lookup_order", status: "error", latencyMs: 5 } }), "cx-platform");
    const { name, status, attrs } = span(payload);
    expect(name).toBe("execute_tool lookup_order");
    expect(status).toBe(2); // ERROR
    expect(attrs["cx.tool.key"]).toBe("lookup_order");
  });

  it("gives every span from one run the same trace id", () => {
    const a = span(toOtlpPayload(event({ type: "llm_call", data: { model: "m", latencyMs: 1 } }), "cx-platform"));
    const b = span(toOtlpPayload(event({ type: "tool_call", data: { toolKey: "lookup_order", status: "ok", latencyMs: 1 } }), "cx-platform"));
    expect(a.traceId).toBe(b.traceId);
    expect(a.traceId).toHaveLength(32);
  });

  it("returns null for an event type it does not export", () => {
    expect(toOtlpPayload(event({ type: "something_else" }), "cx-platform")).toBeNull();
  });

  it("never puts prompt/completion text or tool arguments on a span", () => {
    const payload = toOtlpPayload(
      event({ type: "llm_call", data: { model: "m", latencyMs: 1, prompt: "SECRET customer message", completion: "SECRET reply" } }),
      "cx-platform",
    );
    expect(JSON.stringify(payload)).not.toContain("SECRET");
  });
});

describe("exportTraceEvent", () => {
  it("does not touch the network when OTEL_EXPORTER_OTLP_ENDPOINT is unset", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    exportTraceEvent(event({ type: "llm_call", data: { model: "m", latencyMs: 1 } }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs an OTLP payload to <endpoint>/v1/traces with configured headers when enabled", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector.local:4318/";
    process.env.OTEL_EXPORTER_OTLP_HEADERS = "x-api-key=abc123,x-tenant=acme";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    exportTraceEvent(event({ type: "llm_call", data: { model: "claude-sonnet-5", provider: "anthropic", latencyMs: 10 } }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://collector.local:4318/v1/traces");
    expect(init.headers["x-api-key"]).toBe("abc123");
    expect(init.headers["x-tenant"]).toBe("acme");
    expect(span(JSON.parse(init.body)).name).toBe("chat claude-sonnet-5");
  });

  it("swallows a failed export rather than throwing into the caller", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector.local:4318";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("collector down")));
    expect(() => exportTraceEvent(event({ type: "llm_call", data: { model: "m", latencyMs: 1 } }))).not.toThrow();
    await Promise.resolve();
  });
});

describe("emitTrace", () => {
  it("still writes the in-app console line and does not throw when export is unconfigured", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      emitTrace({ runId: "run-9", tenantId: "t-9", type: "llm_call", data: { model: "m", latencyMs: 1 } });
      expect(logSpy).toHaveBeenCalledOnce();
      expect(logSpy.mock.calls[0][0]).toContain('"trace"');
    } finally {
      logSpy.mockRestore();
    }
  });
});
