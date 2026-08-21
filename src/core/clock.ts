/**
 * Every date-window calculation depends on "today". Never call `new Date()`
 * directly in business logic — inject it via this function so DEMO_DATE can
 * freeze a demo against calendar drift (CLAUDE.md invariant #6).
 */
export function today(): string {
  const override = process.env.DEMO_DATE;
  if (override) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(override)) {
      throw new Error(`DEMO_DATE must be an ISO date (YYYY-MM-DD), got "${override}"`);
    }
    return override;
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Time-of-day-precision sibling to today() — for business logic that needs
 * more than a date (e.g. SLA due-by timestamps, Phase 2). Same
 * test-determinism contract as today(): pin via DEMO_DATETIME (a full ISO
 * 8601 datetime) rather than reaching for `new Date()` directly.
 */
export function now(): string {
  const override = process.env.DEMO_DATETIME;
  if (override) {
    const parsed = new Date(override);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`DEMO_DATETIME must be a valid ISO datetime, got "${override}"`);
    }
    return parsed.toISOString();
  }
  return new Date().toISOString();
}
