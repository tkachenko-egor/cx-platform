import type { ProductResultCard } from "../../src/tools/amarelle/cards";

export function ProductResultsCard({ data }: { data: ProductResultCard[] }) {
  if (data.length === 0) {
    return <p className="text-xs text-muted">No matching products in stock right now.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {data.map((p) => (
        <div key={p.product_id} className="rounded-xl border border-border bg-surface p-2 text-xs shadow-sm">
          <p className="font-medium text-fg">{p.name}</p>
          {p.key_botanical && <p className="text-muted">{p.key_botanical}</p>}
          <p className="mt-1 font-medium text-accent">€{p.price_eur}</p>
          {!p.in_stock && <p className="text-danger">Out of stock</p>}
        </div>
      ))}
    </div>
  );
}
