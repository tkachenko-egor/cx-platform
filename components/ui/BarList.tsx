/** Single-hue horizontal magnitude bars — one series, ranked by length, direct-labeled. No categorical palette involved, so no validator needed (see dataviz skill: sequential/magnitude uses one hue). */
export function BarList({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted">No data yet.</p>;
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3 text-sm">
          <span className="w-36 shrink-0 truncate text-fg">{row.label}</span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-bg">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right text-xs text-muted">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
