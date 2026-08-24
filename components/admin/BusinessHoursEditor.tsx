"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DayRow {
  enabled: boolean;
  start: string;
  end: string;
}

export interface WeeklyHoursRuleInput {
  day: number;
  start: string;
  end: string;
}

/** Phase 9 M3: a 7-row weekly schedule — see src/core/business-hours.ts for how it's consumed. */
export function BusinessHoursEditor({ initialEnabled, initialWeeklyHours, timezone }: { initialEnabled: boolean; initialWeeklyHours: WeeklyHoursRuleInput[]; timezone: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [days, setDays] = useState<DayRow[]>(() =>
    DAYS.map((_, day) => {
      const rule = initialWeeklyHours.find((r) => r.day === day);
      return { enabled: Boolean(rule), start: rule?.start ?? "09:00", end: rule?.end ?? "17:00" };
    }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateDay = (index: number, patch: Partial<DayRow>) => setDays((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const weeklyHours: WeeklyHoursRuleInput[] = [];
      days.forEach((d, day) => {
        if (d.enabled) weeklyHours.push({ day, start: d.start, end: d.end });
      });
      const res = await fetch("/api/admin/business-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, weeklyHours }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save business hours");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-fg">Enable business hours</p>
          <p className="text-xs text-muted">Timezone: {timezone}. When off, agents are always treated as &quot;open&quot; (today&apos;s behavior).</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? "bg-accent" : "bg-border"}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {DAYS.map((label, i) => (
          <div key={label} className="flex items-center gap-3 text-sm">
            <label className="flex w-32 items-center gap-2">
              <input type="checkbox" checked={days[i].enabled} onChange={(e) => updateDay(i, { enabled: e.target.checked })} disabled={!enabled} />
              <span className="text-fg">{label}</span>
            </label>
            <input
              type="time"
              value={days[i].start}
              onChange={(e) => updateDay(i, { start: e.target.value })}
              disabled={!enabled || !days[i].enabled}
              className="rounded border border-border bg-bg px-2 py-1 text-xs disabled:opacity-50"
            />
            <span className="text-xs text-muted">to</span>
            <input
              type="time"
              value={days[i].end}
              onChange={(e) => updateDay(i, { end: e.target.value })}
              disabled={!enabled || !days[i].enabled}
              className="rounded border border-border bg-bg px-2 py-1 text-xs disabled:opacity-50"
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save business hours"}
        </Button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Card>
  );
}
