/** Presentation helpers for the built-in commerce toolkit. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const DEFAULT_CURRENCY = "USD";

export function formatDayMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatWeekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return WEEKDAYS[d.getUTCDay()];
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  UAH: "₴",
  PLN: "zł",
};

/**
 * Amounts are stored in major units (REAL), not minor units — the seed CSVs
 * and every callsite agree on that, so no cents conversion happens here.
 * An unknown currency code renders as "12.00 XYZ" rather than guessing a symbol.
 */
export function formatMoney(amount: number, currencyCode: string = DEFAULT_CURRENCY): string {
  const value = amount.toFixed(2);
  const symbol = CURRENCY_SYMBOLS[currencyCode.toUpperCase()];
  return symbol ? `${symbol}${value}` : `${value} ${currencyCode.toUpperCase()}`;
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
