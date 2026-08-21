/**
 * FR-13.1 (basic slice): one structured line per traced event, correlated
 * by runId. This is a stand-in for a real OpenTelemetry exporter — the
 * event shape below is deliberately OTel-attribute-shaped so swapping the
 * sink later doesn't mean redesigning the schema.
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
}
