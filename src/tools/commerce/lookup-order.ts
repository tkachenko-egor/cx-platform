import { z } from "zod";
import type Database from "better-sqlite3";
import type { TenantContext } from "../../tenancy/context";
import { CommerceRepo } from "./repo";
import { daysSinceDelivery } from "./rules";
import { DEFAULT_CURRENCY, formatDayMonth, formatMoney, formatWeekday, statusLabel } from "./format";
import { today } from "../../core/clock";
import type { OrderStatusCard, StepState } from "../cards";

export const lookupOrderInputSchema = z
  .object({
    order_id: z.string().regex(/^ORD-\d{6}$/).optional(),
    email: z.string().email().optional(),
  })
  .refine((v) => v.order_id || v.email, { message: "order_id or email is required" });

export type LookupOrderInput = z.infer<typeof lookupOrderInputSchema>;

export const lookupOrderToolDef = {
  key: "lookup_order",
  displayName: "Look Up Order",
  description:
    "Use when a customer asks about the status, location, delivery date, tracking, contents or address of a specific order. Requires an order number (format ORD-100001) or the email address on the order. If given only an email and several orders match, this returns the list so you can ask which one they mean.",
  inputSchema: {
    type: "object" as const,
    properties: {
      order_id: { type: "string", pattern: "^ORD-\\d{6}$", description: "The order number, e.g. ORD-100003" },
      email: { type: "string", format: "email", description: "The email on the order. Use only when no order number is available." },
    },
  },
};

/** Per-agent overrides live in agent_defs.tool_settings.lookup_order. */
export interface LookupOrderSettings {
  currency: string;
}

export function resolveLookupOrderSettings(settings?: Record<string, unknown>): LookupOrderSettings {
  const currency = typeof settings?.currency === "string" && settings.currency.trim() ? settings.currency.trim() : DEFAULT_CURRENCY;
  return { currency };
}

const STEP_LABELS = ["Placed", "Packed", "In transit", "Delivered"] as const;

function reachedStep(status: string): number {
  return { Processing: 1, Shipped: 2, InTransit: 3, Delayed: 3, Delivered: 4, Cancelled: 1 }[status] ?? 1;
}

function buildSteps(status: string): OrderStatusCard["steps"] {
  if (status === "Delivered") return STEP_LABELS.map((label) => ({ label, state: "done" as StepState }));
  if (status === "Cancelled") return STEP_LABELS.map((label, i) => ({ label, state: (i === 0 ? "done" : "todo") as StepState }));
  const reached = reachedStep(status);
  return STEP_LABELS.map((label, i) => ({ label, state: (i < reached - 1 ? "done" : i === reached - 1 ? "current" : "todo") as StepState }));
}

function tone(status: string): OrderStatusCard["status_tone"] {
  if (status === "Delivered") return "good";
  if (status === "Delayed") return "warning";
  if (status === "Cancelled") return "attention";
  return "accent";
}

function etaLabel(order: { status: string; delivered_date: string | null; eta_date: string | null }, todayStr: string): { label: string; is_past: boolean } {
  if (order.status === "Delivered" && order.delivered_date) {
    return { label: `Delivered ${formatDayMonth(order.delivered_date)}`, is_past: false };
  }
  if (!order.eta_date) return { label: "Not yet scheduled", is_past: false };
  const isPast = order.eta_date < todayStr;
  if (isPast) return { label: `Was expected ${formatDayMonth(order.eta_date)} — running late`, is_past: true };
  return { label: `Expected ${formatWeekday(order.eta_date)} ${formatDayMonth(order.eta_date)}`, is_past: false };
}

function trackingUrl(carrier: string | null, trackingNumber: string | null): string | null {
  if (!carrier || !trackingNumber) return null;
  return `https://track.example.com/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`;
}

function buildOrderResult(repo: CommerceRepo, orderId: string, currency: string) {
  const order = repo.findOrder(orderId);
  if (!order) return { ok: true as const, found: false as const };

  const customer = repo.findCustomer(order.customer_id);
  const lines = repo.findLinesForOrder(orderId);
  const todayStr = today();
  const days = daysSinceDelivery(order, todayStr);
  const eta = etaLabel(order, todayStr);
  const canMutate = order.status === "Processing";

  const cardItems = lines.map((l) => ({ product_name: l.product_name, quantity: l.quantity, line_total: formatMoney(l.line_total, currency), product_url: `/products/${l.product_id}` }));

  const actions: OrderStatusCard["actions"] = [];
  if (canMutate) {
    actions.push({ label: "Cancel order", action: "cancel_order" });
    actions.push({ label: "Change address", action: "change_address" });
  }
  if (order.tracking_number) actions.push({ label: "Track", action: "track" });
  if (order.status === "Delivered") actions.push({ label: "Start a return", action: "start_return" });

  const card: OrderStatusCard = {
    order_id: order.order_id,
    order_date: order.order_date,
    status_label: statusLabel(order.status),
    status_tone: tone(order.status),
    steps: buildSteps(order.status),
    eta_label: eta.label,
    carrier: order.carrier,
    tracking_number: order.tracking_number,
    tracking_url: trackingUrl(order.carrier, order.tracking_number),
    shipping_address: order.shipping_address,
    currency,
    items: cardItems,
    actions,
  };

  return {
    ok: true as const,
    found: true as const,
    order: {
      order_id: order.order_id,
      order_date: order.order_date,
      status: order.status,
      status_label: statusLabel(order.status),
      ship_date: order.ship_date,
      delivered_date: order.delivered_date,
      eta_date: order.eta_date,
      eta_label: eta.label,
      eta_is_past: eta.is_past,
      days_since_delivery: days,
      carrier: order.carrier,
      tracking_number: order.tracking_number,
      tracking_url: trackingUrl(order.carrier, order.tracking_number),
      shipping_method: order.shipping_method,
      shipping_address: order.shipping_address,
      currency,
      subtotal: formatMoney(order.subtotal_amount, currency),
      shipping: formatMoney(order.shipping_amount, currency),
      tax: formatMoney(order.tax_amount, currency),
      total: formatMoney(order.total_amount, currency),
      can_cancel: canMutate,
      can_change_address: canMutate,
    },
    customer: customer && {
      customer_id: customer.customer_id,
      first_name: customer.first_name,
      loyalty_tier: customer.loyalty_tier,
      country: customer.country,
    },
    lines: lines.map((l) => {
      const product = repo.findProduct(l.product_id);
      return {
        line_id: l.line_id,
        product_id: l.product_id,
        product_name: l.product_name,
        sku: l.sku,
        quantity: l.quantity,
        unit_price: formatMoney(l.unit_price, currency),
        line_total: formatMoney(l.line_total, currency),
        batch_number: l.batch_number,
        expiry_date: l.expiry_date,
        is_opened: l.is_opened,
        is_promotional_item: Boolean(product?.is_promotional_item),
        stock_qty: product?.stock_qty ?? 0,
      };
    }),
    card: { kind: "order_status" as const, data: card },
  };
}

export function runLookupOrder(db: Database.Database, tenant: TenantContext, input: LookupOrderInput, settings?: Record<string, unknown>) {
  const { currency } = resolveLookupOrderSettings(settings);
  const repo = new CommerceRepo(db, tenant);
  if (input.order_id) return buildOrderResult(repo, input.order_id, currency);

  const customer = repo.findCustomerByEmail(input.email!);
  if (!customer) return { ok: true as const, found: false as const };

  const { orders, total } = repo.findOrdersByCustomer(customer.customer_id, 5);
  if (orders.length === 0) return { ok: true as const, found: false as const };
  if (orders.length === 1 && total === 1) return buildOrderResult(repo, orders[0].order_id, currency);

  return {
    ok: true as const,
    found: true as const,
    multiple: true as const,
    total_matches: total,
    orders: orders.map((o) => ({ order_id: o.order_id, order_date: o.order_date, status: o.status, total: formatMoney(o.total_amount, currency) })),
  };
}
