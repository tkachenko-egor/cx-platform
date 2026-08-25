/**
 * Structured UI payloads. Tools return these; React renders them. The model
 * never emits card markup. Generic across tenants — money is carried as a
 * pre-formatted string plus its currency code, so no card shape assumes a
 * particular currency or vertical.
 */

export type StatusTone = "good" | "warning" | "attention" | "accent";
export type StepState = "done" | "current" | "todo";

export type OrderStatusCard = {
  order_id: string;
  order_date: string;
  status_label: string;
  status_tone: StatusTone;
  steps: { label: "Placed" | "Packed" | "In transit" | "Delivered"; state: StepState }[];
  eta_label: string;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shipping_address: string | null;
  currency: string;
  items: { product_name: string; quantity: number; line_total: string; product_url: string }[];
  actions: { label: string; action: "cancel_order" | "change_address" | "track" | "start_return" }[];
};

export type RefusalCard = {
  refusal_reason: string;
  policy_doc: string;
  policy_doc_title: string;
  policy_quote: string;
  product_name: string;
  order_id: string;
  delivered_date: string | null;
  days_since_delivery: number;
  alternative_text: string;
  alternative_action_label: string;
  alternative_action: string;
};

export type ProductResultCard = {
  product_id: string;
  name: string;
  category: string | null;
  price: string;
  currency: string;
  tags: string[];
  in_stock: boolean;
  image_url: string | null;
  url: string;
};

export type CardPayload =
  | { kind: "order_status"; data: OrderStatusCard }
  | { kind: "return_refused"; data: RefusalCard }
  | { kind: "product_results"; data: ProductResultCard[] };
