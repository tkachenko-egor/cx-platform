"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { WeeklyHoursEditor, daysFromRules, rulesFromDays, type DayRow, type WeeklyHoursRuleInput } from "./WeeklyHoursEditor";

export type { WeeklyHoursRuleInput };

/** Phase 9 M3: a 7-row weekly schedule — see src/core/business-hours.ts for how it's consumed. This is the company-wide default; an individual agent can override it (see AgentEditor's Availability card). */
export function BusinessHoursEditor({ initialEnabled, initialWeeklyHours, timezone }: { initialEnabled: boolean; initialWeeklyHours: WeeklyHoursRuleInput[]; timezone: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [days, setDays] = useState<DayRow[]>(() => daysFromRules(initialWeeklyHours));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateDay = (index: number, patch: Partial<DayRow>) => setDays((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/business-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, weeklyHours: rulesFromDays(days) }),
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
      <WeeklyHoursEditor
        enabled={enabled}
        onEnabledChange={setEnabled}
        days={days}
        onDayChange={updateDay}
        timezone={timezone}
        enabledLabel="Enable business hours"
        enabledHint={`Timezone: ${timezone}. When off, agents are always treated as "open" (today's behavior). Company-wide default — an individual agent can set its own schedule instead.`}
      />

      <div className="mt-4 flex items-center gap-3">
        <Button disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save business hours"}
        </Button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Card>
  );
}
