import type { LucideIcon } from "lucide-react";
import { Card } from "./Card";

export function StatTile({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Icon size={14} />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
