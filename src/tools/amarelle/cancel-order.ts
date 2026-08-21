import { z } from "zod";
import type Database from "better-sqlite3";
import type { TenantContext } from "../../tenancy/context";
import { AmarelleRepo } from "./repo";

export const cancelOrderInputSchema = z.object({
  order_id: z.string().regex(/^ORD-\d{6}$/),
});

export type CancelOrderInput = z.infer<typeof cancelOrderInputSchema>;

export const cancelOrderToolDef = {
  key: "cancel_order",
  description:
    "Cancels an order that has not shipped yet. Only works while the order is still in 'Processing' status — once it has shipped this returns ok:false so you can offer a return instead. This is a write action: the tool itself may ask for the customer's explicit confirmation before anything actually changes, so don't treat a first ok:false with needsConfirmation as a failure — relay the confirmation request to the customer and only call this again once they've said yes.",
  inputSchema: {
    type: "object" as const,
    required: ["order_id"],
    properties: {
      order_id: { type: "string", pattern: "^ORD-\\d{6}$", description: "The order to cancel, e.g. ORD-100003" },
    },
  },
};

/** FR-8.5's first real write path. Approval-policy gating happens one layer up, in src/tools/registry.ts. */
export function runCancelOrder(db: Database.Database, tenant: TenantContext, input: CancelOrderInput) {
  const repo = new AmarelleRepo(db, tenant);
  const order = repo.findOrder(input.order_id);
  if (!order) return { ok: false as const, error: `No order found for ${input.order_id}` };
  if (order.status !== "Processing") {
    return { ok: false as const, error: `Order ${input.order_id} is already ${order.status} and can no longer be cancelled.` };
  }

  repo.cancelOrder(input.order_id);
  return { ok: true as const, order_id: input.order_id, status: "Cancelled" as const };
}
