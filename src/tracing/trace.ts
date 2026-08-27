import { exportTraceEvent } from "./otel-exporter";

/**
 * FR-13.1 (basic slice): one structured line per traced event, correlated
 * by runId. The event shape below is deliberately OTel-attribute-shaped so
 * swapping the sink later doesn't mean redesigning the schema.
 *
 * A6: when OTEL_EXPORTER_OTLP_ENDPOINT is set, each event is also exported
 * as an OpenTelemetry GenAI-convention span (see ./otel-exporter.ts) — in
 * addition to the console line below, never instead of it. Absent that env
 * var, exportTraceEvent is a no-op and nothing here changes.
 */
export interface TraceEvent {
  runId: string;
  tenantId: string;
  type: string;
  data: Record<string, unknown>;
  at: string;
}

export function emitTrace(event: Omit<TraceEvent, "at">): void {
  const full: TraceEvent = { ...event, at: new Date().toISOString() };
  console.log(JSON.stringify({ trace: full }));
  try {
    exportTraceEvent(full);
  } catch (err) {
    console.warn(`[tracing] span export threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}
