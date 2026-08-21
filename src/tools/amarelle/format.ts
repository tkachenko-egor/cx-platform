/** Amarelle-tenant presentation helpers — ported from amarelle-handoff's lib/format.ts. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatDayMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatWeekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return WEEKDAYS[d.getUTCDay()];
}

export function money(n: number): string {
  return n.toFixed(2);
}

const STATUS_LABELS: Record<string, string> = {
  Processing: "Processing",
  Shipped: "Shipped",
  InTransit: "In transit",
  Delayed: "Delayed",
  Delivered: "Delivered",
  Cancelled: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
