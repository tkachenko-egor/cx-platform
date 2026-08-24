import { Toggle } from "../ui/Toggle";

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface DayRow {
  enabled: boolean;
  start: string;
  end: string;
}

export interface WeeklyHoursRuleInput {
  day: number;
  start: string;
  end: string;
}

export function daysFromRules(rules: WeeklyHoursRuleInput[]): DayRow[] {
  return WEEKDAY_LABELS.map((_, day) => {
    const rule = rules.find((r) => r.day === day);
    return { enabled: Boolean(rule), start: rule?.start ?? "09:00", end: rule?.end ?? "17:00" };
  });
}

export function rulesFromDays(days: DayRow[]): WeeklyHoursRuleInput[] {
  const rules: WeeklyHoursRuleInput[] = [];
  days.forEach((d, day) => {
    if (d.enabled) rules.push({ day, start: d.start, end: d.end });
  });
  return rules;
}

/**
 * Pure weekly-schedule grid — the on/off toggle plus the 7 day rows.
 * Shared between the tenant-wide business-hours page (BusinessHoursEditor)
 * and the per-agent override in AgentEditor, so both stay visually and
 * behaviorally identical rather than drifting apart.
 */
export function WeeklyHoursEditor({
  enabled,
  onEnabledChange,
  days,
  onDayChange,
  timezone,
  enabledLabel = "Enable business hours",
  enabledHint,
}: {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  days: DayRow[];
  onDayChange: (index: number, patch: Partial<DayRow>) => void;
  timezone: string;
  enabledLabel?: string;
  enabledHint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-fg">{enabledLabel}</p>
          <p className="text-xs text-muted">{enabledHint ?? `Timezone: ${timezone}. When off, always treated as "open" (today's behavior).`}</p>
        </div>
        <Toggle checked={enabled} onChange={onEnabledChange} />
      </div>

      <div className="mt-4 space-y-2">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-3 text-sm">
            <label className="flex w-32 items-center gap-2">
              <input type="checkbox" checked={days[i].enabled} onChange={(e) => onDayChange(i, { enabled: e.target.checked })} disabled={!enabled} />
              <span className="text-fg">{label}</span>
            </label>
            <input
              type="time"
              value={days[i].start}
              onChange={(e) => onDayChange(i, { start: e.target.value })}
              disabled={!enabled || !days[i].enabled}
              className="rounded border border-border bg-bg px-2 py-1 text-xs disabled:opacity-50"
            />
            <span className="text-xs text-muted">to</span>
            <input
              type="time"
              value={days[i].end}
              onChange={(e) => onDayChange(i, { end: e.target.value })}
              disabled={!enabled || !days[i].enabled}
              className="rounded border border-border bg-bg px-2 py-1 text-xs disabled:opacity-50"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
