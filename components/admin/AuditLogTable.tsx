"use client";

import { useState } from "react";
import { Card } from "../ui/Card";
import { Pagination } from "../ui/Pagination";

export interface AuditLogRow {
  id: string;
  createdAtFormatted: string;
  actor: string;
  action: string;
  target: string;
}

const PAGE_SIZE = 15;

/** Client-only for pagination state — createdAt is pre-formatted server-side (see app/admin/audit-log/page.tsx) so this never computes a locale-dependent date itself, the exact hydration-mismatch class this codebase got bitten by before. */
export function AuditLogTable({ entries }: { entries: AuditLogRow[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const visible = entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="mt-6 space-y-3">
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="px-5 py-3 font-medium">When</th>
              <th className="px-5 py-3 font-medium">Actor</th>
              <th className="px-5 py-3 font-medium">Action</th>
              <th className="px-5 py-3 font-medium">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((entry) => (
              <tr key={entry.id}>
                <td className="px-5 py-2.5 text-xs text-muted">{entry.createdAtFormatted}</td>
                <td className="px-5 py-2.5 text-fg">{entry.actor}</td>
                <td className="px-5 py-2.5 font-mono text-xs text-fg">{entry.action}</td>
                <td className="px-5 py-2.5 font-mono text-xs text-muted">{entry.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
