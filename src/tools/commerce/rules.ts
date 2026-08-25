/**
 * The return-eligibility rule chain used by the built-in commerce toolkit.
 * Every constant it weighs is configurable per agent through
 * `agent_defs.tool_settings.check_return_eligibility` — the defaults below
 * are the platform's out-of-the-box policy, not any one tenant's.
 *
 * The rule chain order is normative: the extended-window override (rule 3)
 * evaluates before the opened rule (5) and the standard window (6).
 * Reordering it inverts the outcome for the cases that matter most — do not
 * "simplify" this into a different order.
 */

import { formatMoney } from "./format";

export type OrderStatus = "Processing" | "Shipped" | "InTransit" | "Delayed" | "Delivered" | "Cancelled";

export const REASON_CODES = ["SEALED_UNWANTED", "OPENED_UNWANTED", "SAFETY_CONCERN", "DEFECT", "WRONG_ITEM", "DAMAGED", "SIZE_COLOR_MISMATCH"] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type OpenState = "Yes" | "No" | "Unknown";

/** Per-agent overrides for this tool live in agent_defs.tool_settings.check_return_eligibility. */
export interface ReturnPolicyConfig {
  currency: string;
  /** Change-of-mind window, counted from the delivery date. */
  standardWindowDays: number;
  /** Longer window for defective/wrong/damaged items. */
  defectWindowDays: number;
  /** Longest window, for the reasons listed in extendedWindowReasons — overrides the opened rule as well. */
  extendedWindowDays: number;
  extendedWindowReasons: ReasonCode[];
  /** Reasons that never carry a return-shipping charge. */
  freeReturnReasons: ReasonCode[];
  /** Loyalty tiers that get free return shipping regardless of reason. */
  freeReturnTiers: string[];
  /** Charged for a return label when neither the reason nor the tier makes it free. */
  returnLabelFee: number;
  /** When true, promotional/free items have no standalone refund value. */
  refusePromotionalItems: boolean;
  /** When true, an opened item can't come back for a change of mind. */
  refuseOpenedForChangeOfMind: boolean;
  /** kb_articles doc_id quoted back to the customer on a refusal. */
  policyDoc: string;
}

export const DEFAULT_RETURN_POLICY: ReturnPolicyConfig = {
  currency: "USD",
  standardWindowDays: 30,
  defectWindowDays: 60,
  extendedWindowDays: 90,
  extendedWindowReasons: ["SAFETY_CONCERN"],
  freeReturnReasons: ["SAFETY_CONCERN", "DEFECT", "WRONG_ITEM", "DAMAGED"],
  freeReturnTiers: ["Gold"],
  returnLabelFee: 3.95,
  refusePromotionalItems: true,
  refuseOpenedForChangeOfMind: true,
  policyDoc: "returns-and-refunds",
};

/** Merges an agent's tool_settings slice over the defaults; unknown/blank keys fall through untouched. */
export function resolveReturnPolicy(settings?: Record<string, unknown>): ReturnPolicyConfig {
  if (!settings) return DEFAULT_RETURN_POLICY;
  return { ...DEFAULT_RETURN_POLICY, ...(settings as Partial<ReturnPolicyConfig>) };
}

export type EligibilityContext = {
  order: {
    order_id: string;
    status: OrderStatus;
    delivered_date: string | null;
  };
  line: {
    line_id: string;
    product_name: string;
    is_opened: OpenState;
    line_total: number;
  };
  product: {
    is_promotional_item: boolean;
    stock_qty: number;
  };
  customer: {
    loyalty_tier: string;
  };
  reason: ReasonCode;
  today: string;
  opened_confirmed_by_customer?: boolean;
  policy?: ReturnPolicyConfig;
};

export type EligibilityRule =
  | "NOT_DELIVERED"
  | "PROMOTIONAL_ITEM"
  | "EXTENDED_WINDOW_OVERRIDE"
  | "DEFECT_OVERRIDE"
  | "OPENED_NOT_RESELLABLE"
  | "WITHIN_WINDOW"
  | "OUTSIDE_WINDOW"
  | "ASK_OPENED";

export type EligibilityAlternative = "CANCEL_ORDER" | "WAIT_FOR_DELIVERY" | "RETURN_WHOLE_ORDER" | "NOT_WHY" | "SUPERVISOR_REVIEW";

export type EligibilityApproved = {
  ok: true;
  verdict: "ELIGIBLE";
  rule: "EXTENDED_WINDOW_OVERRIDE" | "DEFECT_OVERRIDE" | "WITHIN_WINDOW";
  order_id: string;
  line_id: string;
  product_name: string;
  days_since_delivery: number;
  resolution: string;
  currency: string;
  refund_amount: string;
  return_required: boolean;
  return_shipping_fee: string;
  replacement_available: boolean;
  policy_doc: string;
  policy_quote: string;
};

export type EligibilityRefused = {
  ok: true;
  verdict: "NOT_ELIGIBLE";
  rule: Exclude<EligibilityRule, "ASK_OPENED" | "EXTENDED_WINDOW_OVERRIDE" | "DEFECT_OVERRIDE" | "WITHIN_WINDOW">;
  order_id: string;
  line_id: string;
  product_name: string;
  days_since_delivery: number;
  refusal_reason: string;
  policy_doc: string;
  policy_quote: string;
  alternative: EligibilityAlternative;
  alternative_text: string;
  alternative_action_label: string;
};

export type EligibilityNeedsInfo = {
  ok: true;
  verdict: "NEEDS_INFO";
  rule: "ASK_OPENED";
  question: string;
  why: string;
};

export type EligibilityResult = EligibilityApproved | EligibilityRefused | EligibilityNeedsInfo;

export function daysSinceDelivery(order: { delivered_date: string | null }, todayStr: string): number {
  if (!order.delivered_date) return -1;
  const delivered = Date.parse(`${order.delivered_date}T00:00:00Z`);
  const now = Date.parse(`${todayStr}T00:00:00Z`);
  return Math.floor((now - delivered) / 86_400_000);
}

function openState(ctx: EligibilityContext): OpenState | "NEEDS_ASKING" {
  if (ctx.line.is_opened === "Unknown") {
    if (ctx.opened_confirmed_by_customer === undefined) return "NEEDS_ASKING";
    return ctx.opened_confirmed_by_customer ? "Yes" : "No";
  }
  return ctx.line.is_opened;
}

export function checkReturnEligibility(ctx: EligibilityContext): EligibilityResult {
  const { order, line, product, customer, reason, today } = ctx;
  const policy = ctx.policy ?? DEFAULT_RETURN_POLICY;
  const days = daysSinceDelivery(order, today);
  const freeShipping = policy.freeReturnTiers.includes(customer.loyalty_tier) || policy.freeReturnReasons.includes(reason);

  // 1 — not delivered yet
  if (days === -1) {
    const canCancel = order.status === "Processing";
    return {
      ok: true,
      verdict: "NOT_ELIGIBLE",
      rule: "NOT_DELIVERED",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      refusal_reason: "This order hasn't arrived yet",
      policy_doc: policy.policyDoc,
      policy_quote:
        "Orders can be cancelled free of charge while the status is still Processing. Once an order has shipped it cannot be cancelled, but it can be returned after delivery under the rules above.",
      alternative: canCancel ? "CANCEL_ORDER" : "WAIT_FOR_DELIVERY",
      alternative_text: canCancel
        ? "It can still be cancelled while it's being prepared"
        : "It's already on its way — track it, and once it arrives the usual return rules apply",
      alternative_action_label: canCancel ? "Cancel the order" : "Track your order",
    };
  }

  // 2 — promotional / free item
  if (policy.refusePromotionalItems && product.is_promotional_item) {
    return {
      ok: true,
      verdict: "NOT_ELIGIBLE",
      rule: "PROMOTIONAL_ITEM",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      refusal_reason: "Promotional items have no standalone refund value",
      policy_doc: policy.policyDoc,
      policy_quote: "Free gifts and promotional items have no standalone refund value. If you return the qualifying order in full, please include them.",
      alternative: "RETURN_WHOLE_ORDER",
      alternative_text: "If you return the qualifying order in full, include the promotional item with it",
      alternative_action_label: "Return the whole order",
    };
  }

  // 3 — extended-window override ⚠ must stay above rule 5 (opened) and rule 6 (window)
  if (policy.extendedWindowReasons.includes(reason) && days <= policy.extendedWindowDays) {
    return {
      ok: true,
      verdict: "ELIGIBLE",
      rule: "EXTENDED_WINDOW_OVERRIDE",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      resolution: "Full refund including original shipping",
      currency: policy.currency,
      refund_amount: formatMoney(line.line_total, policy.currency),
      return_required: false,
      return_shipping_fee: formatMoney(0, policy.currency),
      replacement_available: product.stock_qty > 0,
      policy_doc: policy.policyDoc,
      policy_quote: `We accept the return regardless of whether it was opened and regardless of the ${policy.standardWindowDays}-day window, for up to ${policy.extendedWindowDays} days after delivery.`,
    };
  }

  // 4 — defect / wrong item / damaged
  if (["DEFECT", "WRONG_ITEM", "DAMAGED"].includes(reason) && days <= policy.defectWindowDays) {
    return {
      ok: true,
      verdict: "ELIGIBLE",
      rule: "DEFECT_OVERRIDE",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      resolution: "Refund or replacement",
      currency: policy.currency,
      refund_amount: formatMoney(line.line_total, policy.currency),
      return_required: true,
      return_shipping_fee: formatMoney(0, policy.currency),
      replacement_available: product.stock_qty > 0,
      policy_doc: policy.policyDoc,
      policy_quote: `Items that arrived faulty or damaged, and wrong items sent in error, are accepted whether opened or not, for up to ${policy.defectWindowDays} days after delivery.`,
    };
  }

  const open = openState(ctx);

  // needs-info short-circuit — before rule 5
  if (policy.refuseOpenedForChangeOfMind && open === "NEEDS_ASKING") {
    return {
      ok: true,
      verdict: "NEEDS_INFO",
      rule: "ASK_OPENED",
      question: "Has the item been opened, or is the packaging still sealed?",
      why: "The stored record does not say whether this item was opened, and the answer changes the outcome.",
    };
  }

  // 5 — opened
  if (policy.refuseOpenedForChangeOfMind && open === "Yes") {
    return {
      ok: true,
      verdict: "NOT_ELIGIBLE",
      rule: "OPENED_NOT_RESELLABLE",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      refusal_reason: "An opened item can't be resold, so we can't take it back for a change of mind",
      policy_doc: policy.policyDoc,
      policy_quote: "Opened or used items cannot be returned for a change of mind. This is a condition requirement, not a commercial choice.",
      alternative: "NOT_WHY",
      alternative_text: "If it arrived faulty, damaged or raised a safety concern, we accept it regardless — tell me what happened",
      alternative_action_label: "That's not why",
    };
  }

  // 6 — inside the window
  if (days <= policy.standardWindowDays) {
    return {
      ok: true,
      verdict: "ELIGIBLE",
      rule: "WITHIN_WINDOW",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      resolution: "Refund to original payment method",
      currency: policy.currency,
      refund_amount: formatMoney(line.line_total, policy.currency),
      return_required: true,
      return_shipping_fee: formatMoney(freeShipping ? 0 : policy.returnLabelFee, policy.currency),
      replacement_available: product.stock_qty > 0,
      policy_doc: policy.policyDoc,
      policy_quote: `You may return items within ${policy.standardWindowDays} calendar days of the delivery date shown on your order.`,
    };
  }

  // 7 — outside the window
  return {
    ok: true,
    verdict: "NOT_ELIGIBLE",
    rule: "OUTSIDE_WINDOW",
    order_id: order.order_id,
    line_id: line.line_id,
    product_name: line.product_name,
    days_since_delivery: days,
    refusal_reason: `This was delivered more than ${policy.standardWindowDays} days ago`,
    policy_doc: policy.policyDoc,
    policy_quote: `Requests made after ${policy.standardWindowDays} days cannot be accepted by our advisors, though you may ask for a supervisor review.`,
    alternative: "SUPERVISOR_REVIEW",
    alternative_text: "A supervisor can review exceptions",
    alternative_action_label: "Request a review",
  };
}
