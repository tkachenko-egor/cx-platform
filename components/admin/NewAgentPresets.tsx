"use client";

import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Field } from "../ui/Input";

/**
 * Phase 7 M1: "clone from existing" and "start from template" — for a BPO,
 * agent #2 for a new client is mostly agent #1, so this is meant to save the
 * re-typing rather than be a full wizard. Both selects just navigate to a
 * different `?cloneFrom=`/`?template=` on this same page; app/admin/agents/new/page.tsx
 * does the actual prefill server-side.
 */
export function NewAgentPresets({
  existingAgents,
  templates,
  cloneFrom,
  template,
}: {
  existingAgents: string[];
  templates: { id: string; label: string }[];
  cloneFrom?: string;
  template?: string;
}) {
  const router = useRouter();

  return (
    <Card className="mb-5 p-6">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Start from template" htmlFor="new-agent-template">
          <select
            id="new-agent-template"
            value={cloneFrom ? "" : (template ?? "")}
            onChange={(e) => router.push(e.target.value ? `/admin/agents/new?template=${e.target.value}` : "/admin/agents/new")}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          >
            <option value="">Blank</option>
            {templates
              .filter((t) => t.id !== "blank")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Or clone an existing agent" htmlFor="new-agent-clone">
          <select
            id="new-agent-clone"
            value={cloneFrom ?? ""}
            onChange={(e) => router.push(e.target.value ? `/admin/agents/new?cloneFrom=${e.target.value}` : "/admin/agents/new")}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            disabled={existingAgents.length === 0}
          >
            <option value="">{existingAgents.length === 0 ? "No agents yet" : "None"}</option>
            {existingAgents.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {cloneFrom && <p className="mt-2 text-xs text-muted">Prompt, model, tools, persona, and language settings copied from &quot;{cloneFrom}&quot; — nothing there is affected by this.</p>}
    </Card>
  );
}
