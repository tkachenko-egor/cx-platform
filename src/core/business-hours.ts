import type { BusinessHoursConfig } from "../db/repositories/tenant-repository";

/**
 * Phase 9 M3: a pure, timezone-aware weekly-hours check — uses the
 * platform's built-in Intl support (no date library dependency, same
 * "small and self-contained" spirit as src/tools/json-schema-lite.ts)
 * rather than reusing src/core/sla.ts's naive elapsed-time math, which
 * explicitly does NOT attempt a business-hours calendar (see its own
 * comment). `enabled: false` or no rules configured means "always open" —
 * the safe default, zero behavior change for a tenant that hasn't set
 * this up.
 */
export function isWithinBusinessHours(config: BusinessHoursConfig, nowIso: string, timezone: string): boolean {
  if (!config.enabled) return true;
  const rules = config.weeklyHours ?? [];
  if (rules.length === 0) return true;

  const date = new Date(nowIso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const currentMinutes = hour * 60 + minute;

  return rules.some((rule) => {
    if (rule.day !== dayIndex) return false;
    const [startH, startM] = rule.start.split(":").map(Number);
    const [endH, endM] = rule.end.split(":").map(Number);
    return currentMinutes >= startH * 60 + startM && currentMinutes < endH * 60 + endM;
  });
}
