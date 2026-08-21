"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ToolOption {
  key: string;
  description: string;
}

export interface AgentEditorInitial {
  key: string;
  version: number;
  systemPrompt: string;
  modelAlias: string;
  toolIds: string[];
  guardrails: Record<string, unknown>;
  skills: string[];
}

export function AgentEditor({ initial, availableTools }: { initial: AgentEditorInitial; availableTools: ToolOption[] }) {
  const router = useRouter();
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [modelAlias, setModelAlias] = useState(initial.modelAlias);
  const [toolIds, setToolIds] = useState<Set<string>>(new Set(initial.toolIds));
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [guardrailsJson, setGuardrailsJson] = useState(JSON.stringify(initial.guardrails, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleTool = (key: string) => {
    setToolIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const publish = async () => {
    setError(null);
    let guardrails: Record<string, unknown>;
    try {
      guardrails = guardrailsJson.trim() ? JSON.parse(guardrailsJson) : {};
    } catch {
      setError("Guardrails must be valid JSON");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: initial.key,
          systemPrompt,
          modelAlias,
          toolIds: [...toolIds],
          guardrails,
          skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not publish");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-5">
      <div>
        <label className="block text-sm text-muted">System prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={10}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block text-sm text-muted">Model alias</label>
        <input
          value={modelAlias}
          onChange={(e) => setModelAlias(e.target.value)}
          className="mt-1 w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block text-sm text-muted">Tools</label>
        <div className="mt-1 flex flex-wrap gap-3">
          {availableTools.map((tool) => (
            <label key={tool.key} className="flex items-center gap-1.5 text-xs text-fg">
              <input type="checkbox" checked={toolIds.has(tool.key)} onChange={() => toggleTool(tool.key)} />
              {tool.key}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm text-muted">Skills (comma-separated)</label>
        <input
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block text-sm text-muted">Guardrails (JSON)</label>
        <textarea
          value={guardrailsJson}
          onChange={(e) => setGuardrailsJson(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button type="button" disabled={busy} onClick={publish} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50">
        {busy ? "Publishing…" : `Publish v${initial.version + 1}`}
      </button>
    </div>
  );
}
