import { ChevronLeft, ChevronRight } from "lucide-react";

/** Client-side only — fine at this scale (a tenant's tools/articles/collections are dozens, not thousands), see Phase 5 plan. */
export function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button
        type="button"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:bg-bg disabled:opacity-40"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="text-xs text-muted">
        Page {page + 1} of {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount - 1}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:bg-bg disabled:opacity-40"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
