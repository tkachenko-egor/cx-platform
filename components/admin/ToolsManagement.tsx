"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench, Code2, Trash2 } from "lucide-react";
import { Card } from "../ui/Card";
import { Pagination } from "../ui/Pagination";

type ApprovalPolicy = "auto" | "confirm_with_customer" | "require_human_approval";

export interface ToolRow {
  key: string;
  description: string;
  writeFlag: boolean;
  approvalPolicy: ApprovalPolicy;
  type: "code" | "http";
}

const PAGE_SIZE = 10;

function ToolRowItem({ tool, onDelete, busy }: { tool: ToolRow; onDelete?: (key: string) => void; busy: boolean }) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        {tool.type === "http" ? <Wrench size={16} className="shrink-0 text-muted" /> : <Code2 size={16} className="shrink-0 text-muted" />}
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">
            {tool.key} {tool.writeFlag && <span className="text-xs text-muted">· write · {tool.approvalPolicy}</span>}
          </p>
          <p className="truncate text-xs text-muted">{tool.description}</p>
        </div>
      </div>
      {onDelete && (
        <button type="button" disabled={busy} onClick={() => onDelete(tool.key)} aria-label="Delete" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50">
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}

export function ToolsManagement({ httpTools, codeTools }: { httpTools: ToolRow[]; codeTools: ToolRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(httpTools.length / PAGE_SIZE));
  const visible = httpTools.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const deleteTool = async (key: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tools/${key}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete tool");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-8">
      {error && <p className="text-xs text-danger">{error}</p>}

      <section>
        <h2 className="text-sm font-semibold text-fg">No-code tools</h2>
        <p className="mt-0.5 text-xs text-muted">Admin-defined HTTP tools — no code deploy needed.</p>
        {httpTools.length === 0 ? (
          <Card className="mt-3 p-8 text-center text-sm text-muted">No no-code tools yet.</Card>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface shadow-sm">
              {visible.map((tool) => (
                <ToolRowItem key={tool.key} tool={tool} onDelete={deleteTool} busy={busy} />
              ))}
            </ul>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-fg">Custom tools</h2>
        <p className="mt-0.5 text-xs text-muted">Built into the platform (src/tools/registry.ts) — managed in source, listed here for visibility only.</p>
        {codeTools.length === 0 ? (
          <Card className="mt-3 p-8 text-center text-sm text-muted">No custom tools registered.</Card>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface shadow-sm">
            {codeTools.map((tool) => (
              <ToolRowItem key={tool.key} tool={tool} busy={busy} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
