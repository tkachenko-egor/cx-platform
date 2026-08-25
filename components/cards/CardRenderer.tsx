import type { CardPayload } from "../../src/tools/cards";
import { OrderStatusCard } from "./OrderStatusCard";
import { RefusalCard } from "./RefusalCard";
import { ProductResultsCard } from "./ProductResultsCard";

/** The model never emits card markup — tools return CardPayload, and this is the only place that turns it into UI. */
export function CardRenderer({ card }: { card: CardPayload }) {
  switch (card.kind) {
    case "order_status":
      return <OrderStatusCard data={card.data} />;
    case "return_refused":
      return <RefusalCard data={card.data} />;
    case "product_results":
      return <ProductResultsCard data={card.data} />;
    default:
      return null;
  }
}
