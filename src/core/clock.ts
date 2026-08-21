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
