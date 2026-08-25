"use client";

import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Field } from "../ui/Input";

/**
 * Phase 7 M1: "clone from existing" and "start from template" — for a BPO,
 * agent #2 for a new client is mostly agent #1, so this is meant to save the
 * re-typing rather than be a full wizard. One select navigates to a
 * different `?cloneFrom=`/`?template=` on this same page; app/admin/agents/new/page.tsx
 * does the actual prefill server-side. Template and clone are mutually exclusive,
 * so this is one control with two optgroups rather than two selects a user has
 * to realize are linked.
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

  const value = cloneFrom ? `clone:${cloneFrom}` : template ? `template:${template}` : "";

  const onChange = (raw: string) => {
    if (!raw) return router.push("/admin/agents/new");
    const [kind, id] = raw.split(":");
    router.push(kind === "clone" ? `/admin/agents/new?cloneFrom=${id}` : `/admin/agents/new?template=${id}`);
  };

  return (
    <Card className="mb-5 p-6">
      <Field label="Start from" htmlFor="new-agent-start-from">
        <select
          id="new-agent-start-from"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
        >
          <option value="">Blank</option>
          <optgroup label="Template">
            {templates
              .filter((t) => t.id !== "blank")
              .map((t) => (
                <option key={t.id} value={`template:${t.id}`}>
                  {t.label}
                </option>
              ))}
          </optgroup>
          {existingAgents.length > 0 && (
            <optgroup label="Clone an existing agent">
              {existingAgents.map((key) => (
                <option key={key} value={`clone:${key}`}>
                  {key}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Field>
      {cloneFrom && <p className="mt-2 text-xs text-muted">Prompt, model, tools, persona, and language settings copied from &quot;{cloneFrom}&quot; — nothing there is affected by this.</p>}
    </Card>
  );
}
