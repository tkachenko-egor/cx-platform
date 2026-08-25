import { z } from "zod";
import type Database from "better-sqlite3";
import type { TenantContext } from "../../tenancy/context";
import { CommerceRepo } from "./repo";

export const cancelOrderInputSchema = z.object({
  order_id: z.string().regex(/^ORD-\d{6}$/),
});

export type CancelOrderInput = z.infer<typeof cancelOrderInputSchema>;

export const cancelOrderToolDef = {
  key: "cancel_order",
  displayName: "Cancel Order",
  description:
    "Cancels an order that has not shipped yet. Only works while the order is still in a cancellable status — once it has shipped this returns ok:false so you can offer a return instead. This is a write action: the tool itself may ask for the customer's explicit confirmation before anything actually changes, so don't treat a first ok:false with needsConfirmation as a failure — relay the confirmation request to the customer and only call this again once they've said yes.",
  inputSchema: {
    type: "object" as const,
    required: ["order_id"],
    properties: {
      order_id: { type: "string", pattern: "^ORD-\\d{6}$", description: "The order to cancel, e.g. ORD-100003" },
    },
  },
};

/** Per-agent overrides live in agent_defs.tool_settings.cancel_order. */
export interface CancelOrderSettings {
  mutableStatuses: string[];
}

export const DEFAULT_CANCEL_ORDER_SETTINGS: CancelOrderSettings = { mutableStatuses: ["Processing"] };

export function resolveCancelOrderSettings(settings?: Record<string, unknown>): CancelOrderSettings {
  const configured = settings?.mutableStatuses;
  if (Array.isArray(configured) && configured.every((s) => typeof s === "string") && configured.length > 0) {
    return { mutableStatuses: configured as string[] };
  }
  return DEFAULT_CANCEL_ORDER_SETTINGS;
}

/** FR-8.5's first real write path. Approval-policy gating happens one layer up, in src/tools/registry.ts. */
export function runCancelOrder(db: Database.Database, tenant: TenantContext, input: CancelOrderInput, settings?: Record<string, unknown>) {
  const { mutableStatuses } = resolveCancelOrderSettings(settings);
  const repo = new CommerceRepo(db, tenant);
  const order = repo.findOrder(input.order_id);
  if (!order) return { ok: false as const, error: `No order found for ${input.order_id}` };
  if (!mutableStatuses.includes(order.status)) {
    return { ok: false as const, error: `Order ${input.order_id} is already ${order.status} and can no longer be cancelled.` };
  }

  repo.cancelOrder(input.order_id);
  return { ok: true as const, order_id: input.order_id, status: "Cancelled" as const };
}
