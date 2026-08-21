import type { OrderStatusCard as OrderStatusCardData } from "../../src/tools/amarelle/cards";

const TONE_CLASSES: Record<string, string> = {
  good: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  attention: "bg-danger/10 text-danger",
  accent: "bg-accent/10 text-accent",
};

export function OrderStatusCard({ data }: { data: OrderStatusCardData }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-sm shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-fg">{data.order_id}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[data.status_tone] ?? ""}`}>{data.status_label}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{data.eta_label}</p>

      <ol className="mt-3 flex items-center gap-1">
        {data.steps.map((step, i) => (
          <li key={step.label} className="flex flex-1 items-center gap-1">
            <span
              className={`h-2 w-2 flex-shrink-0 rounded-full ${step.state === "todo" ? "bg-border" : step.state === "current" ? "bg-accent" : "bg-success"}`}
              aria-hidden
            />
            {i < data.steps.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      <ul className="mt-3 space-y-1">
        {data.items.map((item, i) => (
          <li key={i} className="flex justify-between text-xs text-muted">
            <span>
              {item.quantity}× {item.product_name}
            </span>
            <span>€{item.line_total_eur}</span>
          </li>
        ))}
      </ul>

      {data.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.actions.map((a) => (
            <span key={a.action} className="rounded-full border border-border px-2 py-1 text-xs text-muted">
              {a.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
