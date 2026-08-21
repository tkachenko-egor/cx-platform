import type { RefusalCard as RefusalCardData } from "../../src/tools/amarelle/cards";

export function RefusalCard({ data }: { data: RefusalCardData }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-sm shadow-sm">
      <p className="font-medium text-fg">{data.refusal_reason}</p>
      <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs italic text-muted">
        {data.policy_quote} — {data.policy_doc_title}
      </blockquote>
      <p className="mt-2 text-xs text-muted">{data.alternative_text}</p>
      <span className="mt-2 inline-block rounded-full border border-border px-2 py-1 text-xs text-accent">{data.alternative_action_label}</span>
    </div>
  );
}
