/**
 * Amarelle Botanique's business constants and return-eligibility rule
 * chain — ported verbatim from amarelle-handoff's lib/rules.ts. This is
 * TENANT DATA/LOGIC, not platform code (see this repo's CLAUDE.md
 * invariant #5) — it lives under src/tools/amarelle/ specifically so it's
 * never mistaken for something the gateway/agent-runtime/KB layers depend
 * on.
 *
 * The rule chain order is normative: rule 3 (REACTION) evaluates before
 * rule 5 (opened) and rule 6 (window). Reordering it inverts the
 * product's central argument — do not "simplify" this into a different
 * order. (Preserved from the source repo's own invariant.)
 */

export const RULES = {
  STANDARD_WINDOW_DAYS: 30,
  DEFECT_WINDOW_DAYS: 60,
  REACTION_WINDOW_DAYS: 90,
  LABEL_FEE_EUR: "3.95",
  FREE_RETURN_TIERS: ["Or"],
  FREE_RETURN_REASONS: ["REACTION", "DEFECT", "WRONG_ITEM", "DAMAGED"],
  STORE_CREDIT_BONUS: 0.1,
  RMA_POST_DAYS_RETURNS_DOC: 10,
  RMA_POST_DAYS_SHIPPING_DOC: 14,
  MUTABLE_STATUSES: ["Processing"],
} as const;

export type OrderStatus = "Processing" | "Shipped" | "InTransit" | "Delayed" | "Delivered" | "Cancelled";

export type ReasonCode = "SEALED_UNWANTED" | "OPENED_UNWANTED" | "REACTION" | "DEFECT" | "WRONG_ITEM" | "DAMAGED" | "SHADE";

export type OpenState = "Yes" | "No" | "Unknown";

export type LoyaltyTier = "Bronze" | "Argent" | "Or";

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
    line_total_eur: number;
  };
  product: {
    is_gift_with_purchase: boolean;
    stock_qty: number;
  };
  customer: {
    loyalty_tier: LoyaltyTier;
  };
  reason: ReasonCode;
  today: string;
  opened_confirmed_by_customer?: boolean;
};

export type EligibilityRule =
  | "NOT_DELIVERED"
  | "GIFT_WITH_PURCHASE"
  | "REACTION_OVERRIDE"
  | "DEFECT_OVERRIDE"
  | "OPENED_HYGIENE"
  | "WITHIN_WINDOW"
  | "OUTSIDE_WINDOW"
  | "ASK_OPENED";

export type EligibilityAlternative = "CANCEL_ORDER" | "WAIT_FOR_DELIVERY" | "RETURN_WHOLE_ORDER" | "NOT_WHY" | "SUPERVISOR_REVIEW";

export type EligibilityApproved = {
  ok: true;
  verdict: "ELIGIBLE";
  rule: "REACTION_OVERRIDE" | "DEFECT_OVERRIDE" | "WITHIN_WINDOW";
  order_id: string;
  line_id: string;
  product_name: string;
  days_since_delivery: number;
  resolution: string;
  refund_amount_eur: string;
  return_required: boolean;
  return_shipping_fee: string;
  replacement_available: boolean;
  policy_doc: string;
  policy_quote: string;
};

export type EligibilityRefused = {
  ok: true;
  verdict: "NOT_ELIGIBLE";
  rule: Exclude<EligibilityRule, "ASK_OPENED" | "REACTION_OVERRIDE" | "DEFECT_OVERRIDE" | "WITHIN_WINDOW">;
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

const RETURNS_DOC = "returns-and-refunds";

function money(n: number): string {
  return n.toFixed(2);
}

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
  const days = daysSinceDelivery(order, today);

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
      policy_doc: RETURNS_DOC,
      policy_quote:
        "Orders can be cancelled free of charge while the status is still Processing. Once an order is Shipped or In transit it cannot be cancelled, but it can be returned after delivery under the rules above.",
      alternative: canCancel ? "CANCEL_ORDER" : "WAIT_FOR_DELIVERY",
      alternative_text: canCancel
        ? "It can still be cancelled while it's being prepared"
        : "It's already on its way — track it, and once it arrives the usual return rules apply",
      alternative_action_label: canCancel ? "Cancel the order" : "Track your order",
    };
  }

  // 2 — gift with purchase
  if (product.is_gift_with_purchase) {
    return {
      ok: true,
      verdict: "NOT_ELIGIBLE",
      rule: "GIFT_WITH_PURCHASE",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      refusal_reason: "Gift items have no standalone refund value",
      policy_doc: RETURNS_DOC,
      policy_quote:
        "Gift-with-purchase items and free samples. These have no standalone refund value. If you return the qualifying order in full, please include the gift.",
      alternative: "RETURN_WHOLE_ORDER",
      alternative_text: "If you return the qualifying order in full, include the gift with it",
      alternative_action_label: "Return the whole order",
    };
  }

  // 3 — REACTION ⚠ must be above rule 5 (opened) and rule 6 (window)
  if (reason === "REACTION" && days <= RULES.REACTION_WINDOW_DAYS) {
    return {
      ok: true,
      verdict: "ELIGIBLE",
      rule: "REACTION_OVERRIDE",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      resolution: "Full refund including original shipping",
      refund_amount_eur: money(line.line_total_eur),
      return_required: false,
      return_shipping_fee: "0.00",
      replacement_available: product.stock_qty > 0,
      policy_doc: RETURNS_DOC,
      policy_quote: "we accept the return regardless of whether it was opened and regardless of the 30-day window, for up to 90 days after delivery.",
    };
  }

  // 4 — defect / wrong item / damaged
  if (["DEFECT", "WRONG_ITEM", "DAMAGED"].includes(reason) && days <= RULES.DEFECT_WINDOW_DAYS) {
    return {
      ok: true,
      verdict: "ELIGIBLE",
      rule: "DEFECT_OVERRIDE",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      resolution: "Refund or replacement",
      refund_amount_eur: money(line.line_total_eur),
      return_required: true,
      return_shipping_fee: "0.00",
      replacement_available: product.stock_qty > 0,
      policy_doc: RETURNS_DOC,
      policy_quote:
        "Broken pumps, cracked caps, leaking bottles, products that arrived contaminated, and wrong items sent in error are accepted whether opened or not, for up to 60 days after delivery.",
    };
  }

  const open = openState(ctx);

  // needs-info short-circuit — before rule 5
  if (open === "NEEDS_ASKING") {
    return {
      ok: true,
      verdict: "NEEDS_INFO",
      rule: "ASK_OPENED",
      question: "Has the product been opened, or is the seal still intact?",
      why: "The stored record does not say whether this item was opened, and the answer changes the outcome.",
    };
  }

  // 5 — opened
  if (open === "Yes") {
    return {
      ok: true,
      verdict: "NOT_ELIGIBLE",
      rule: "OPENED_HYGIENE",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      refusal_reason: "Opened cosmetics can't be resold, so we can't take them back for a change of mind",
      policy_doc: RETURNS_DOC,
      policy_quote:
        "Opened or used: cannot be returned for change of mind, shade preference or scent preference. This is a hygiene requirement, not a commercial choice.",
      alternative: "NOT_WHY",
      alternative_text: "If it caused any skin reaction or is defective, we accept it regardless — tell me what happened",
      alternative_action_label: "That's not why",
    };
  }

  // 6 — inside the window
  if (days <= RULES.STANDARD_WINDOW_DAYS) {
    const freeShipping = customer.loyalty_tier === "Or";
    return {
      ok: true,
      verdict: "ELIGIBLE",
      rule: "WITHIN_WINDOW",
      order_id: order.order_id,
      line_id: line.line_id,
      product_name: line.product_name,
      days_since_delivery: days,
      resolution: "Refund to original payment method",
      refund_amount_eur: money(line.line_total_eur),
      return_required: true,
      return_shipping_fee: freeShipping ? "0.00" : RULES.LABEL_FEE_EUR,
      replacement_available: product.stock_qty > 0,
      policy_doc: RETURNS_DOC,
      policy_quote: "You may return products within 30 calendar days of the delivery date shown on your order.",
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
    refusal_reason: "This was delivered more than 30 days ago",
    policy_doc: RETURNS_DOC,
    policy_quote: "Requests made after 30 days cannot be accepted by our advisors, though you may ask for a supervisor review.",
    alternative: "SUPERVISOR_REVIEW",
    alternative_text: "A supervisor can review exceptions",
    alternative_action_label: "Request a review",
  };
}
