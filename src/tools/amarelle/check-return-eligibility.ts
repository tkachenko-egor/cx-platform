import { z } from "zod";
import type Database from "better-sqlite3";
import type { TenantContext } from "../../tenancy/context";
import { AmarelleRepo } from "./repo";
import { checkReturnEligibility, type EligibilityContext } from "./rules";
import { today } from "../../core/clock";
import { KbArticleRepository } from "../../db/repositories/kb-repository";
import type { RefusalCard } from "./cards";

export const checkReturnEligibilityInputSchema = z.object({
  order_id: z.string().regex(/^ORD-\d{6}$/),
  line_id: z.string().optional(),
  product_name: z.string().optional(),
  reason_code: z.enum(["SEALED_UNWANTED", "OPENED_UNWANTED", "REACTION", "DEFECT", "WRONG_ITEM", "DAMAGED", "SHADE"]),
  opened_confirmed_by_customer: z.boolean().optional(),
});

export type CheckReturnEligibilityInput = z.infer<typeof checkReturnEligibilityInputSchema>;

export const checkReturnEligibilityToolDef = {
  key: "check_return_eligibility",
  description:
    "Use when a customer wants to return, refund or exchange something, before you promise anything at all. It weighs whether the item was opened, how long ago it was delivered, whether it was a gift with purchase, and the reason given. It returns a verdict, the governing rule, and the alternatives available. Do not guess an outcome — always call this.",
  inputSchema: {
    type: "object" as const,
    required: ["order_id", "reason_code"],
    properties: {
      order_id: { type: "string", pattern: "^ORD-\\d{6}$" },
      line_id: { type: "string", description: "Preferred when known, e.g. LINE-5004" },
      product_name: { type: "string", description: "Use when the line id is unknown; matched case-insensitively within the order" },
      reason_code: { type: "string", enum: ["SEALED_UNWANTED", "OPENED_UNWANTED", "REACTION", "DEFECT", "WRONG_ITEM", "DAMAGED", "SHADE"] },
      opened_confirmed_by_customer: { type: "boolean", description: "Set only when the stored open state is Unknown and the customer has told you whether the seal was broken." },
    },
  },
};

const ALTERNATIVE_ACTION_MAP: Record<string, string> = {
  CANCEL_ORDER: "cancel_order",
  WAIT_FOR_DELIVERY: "track_order",
  RETURN_WHOLE_ORDER: "return_whole_order",
  NOT_WHY: "report_reaction",
  SUPERVISOR_REVIEW: "request_review",
};

export function runCheckReturnEligibility(db: Database.Database, tenant: TenantContext, input: CheckReturnEligibilityInput) {
  const repo = new AmarelleRepo(db, tenant);
  const order = repo.findOrder(input.order_id);
  if (!order) return { ok: false as const, error: `No order found for ${input.order_id}` };

  const customer = repo.findCustomer(order.customer_id);
  if (!customer) return { ok: false as const, error: `Order ${input.order_id} has no matching customer` };

  const line = input.line_id ? repo.findLine(input.line_id) : input.product_name ? repo.findLineByProductName(input.order_id, input.product_name) : undefined;
  if (!line || line.order_id !== input.order_id) {
    return { ok: false as const, error: `Could not find that item on order ${input.order_id}` };
  }

  const product = repo.findProduct(line.product_id);
  if (!product) return { ok: false as const, error: `Product ${line.product_id} not found` };

  const ctx: EligibilityContext = {
    order: { order_id: order.order_id, status: order.status, delivered_date: order.delivered_date },
    line: { line_id: line.line_id, product_name: line.product_name, is_opened: line.is_opened, line_total_eur: line.line_total_eur },
    product: { is_gift_with_purchase: Boolean(product.is_gift_with_purchase), stock_qty: product.stock_qty },
    customer: { loyalty_tier: customer.loyalty_tier },
    reason: input.reason_code,
    today: today(),
    opened_confirmed_by_customer: input.opened_confirmed_by_customer,
  };

  const result = checkReturnEligibility(ctx);

  if (result.verdict !== "NOT_ELIGIBLE") return result;

  const doc = new KbArticleRepository(db, tenant).getByDocId(result.policy_doc);
  const card: RefusalCard = {
    refusal_reason: result.refusal_reason,
    policy_doc: result.policy_doc,
    policy_doc_title: doc?.title ?? result.policy_doc,
    policy_quote: result.policy_quote,
    product_name: result.product_name,
    order_id: result.order_id,
    delivered_date: order.delivered_date,
    days_since_delivery: result.days_since_delivery,
    alternative_text: result.alternative_text,
    alternative_action_label: result.alternative_action_label,
    alternative_action: ALTERNATIVE_ACTION_MAP[result.alternative] ?? "request_review",
  };

  return { ...result, card: { kind: "return_refused" as const, data: card } };
}
