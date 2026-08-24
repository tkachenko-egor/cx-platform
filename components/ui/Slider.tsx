const LOW_RGB = [16, 163, 74]; // green — conservative end
const MID_RGB = [217, 119, 6]; // amber
const HIGH_RGB = [220, 38, 38]; // red — aggressive end

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function colorForPercent(pct: number): string {
  const [from, to, t] = pct <= 0.5 ? [LOW_RGB, MID_RGB, pct / 0.5] : [MID_RGB, HIGH_RGB, (pct - 0.5) / 0.5];
  const rgb = from.map((c, i) => Math.round(lerp(c, to[i], t)));
  return `rgb(${rgb.join(",")})`;
}

/**
 * Range slider whose fill/readout color shifts green -> amber -> red across
 * its range, so "how conservative vs. aggressive is this setting" reads at a
 * glance instead of requiring the admin to interpret a raw number.
 *
 * `value` is a string, not a number, so it can represent "unset" as "" the
 * same way the plain number <Input> it replaces did (temperature/confidence
 * threshold both mean "use the provider/system default" when blank) — the
 * thumb still renders at `unsetPosition` while unset, and the readout shows
 * `unsetLabel` instead of a number.
 */
export function Slider({
  id,
  min,
  max,
  step,
  value,
  onChange,
  unsetPosition,
  unsetLabel = "Provider default",
  formatValue = (v) => v.toFixed(2),
}: {
  id?: string;
  min: number;
  max: number;
  step: number;
  value: string;
  onChange: (next: string) => void;
  unsetPosition: number;
  unsetLabel?: string;
  formatValue?: (v: number) => string;
}) {
  const isUnset = value.trim() === "";
  const numeric = isUnset ? unsetPosition : Number(value);
  const pct = (numeric - min) / (max - min);
  const color = isUnset ? "var(--color-muted)" : colorForPercent(pct);

  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={numeric}
          onChange={(e) => onChange(e.target.value)}
          className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-full outline-none"
          style={{
            background: `linear-gradient(to right, ${color} ${pct * 100}%, var(--color-border) ${pct * 100}%)`,
            accentColor: color,
          }}
        />
        <span className="w-28 shrink-0 text-right text-xs font-medium tabular-nums" style={{ color: isUnset ? "var(--color-muted)" : color }}>
          {isUnset ? unsetLabel : formatValue(numeric)}
        </span>
      </div>
      {!isUnset && (
        <button type="button" onClick={() => onChange("")} className="mt-1 text-[11px] text-muted hover:text-fg hover:underline">
          Reset to {unsetLabel.toLowerCase()}
        </button>
      )}
    </div>
  );
}
