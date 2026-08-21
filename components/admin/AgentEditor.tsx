"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
  kbScope: Record<string, unknown>;
}

export interface ModelAliasOption {
  alias: string;
  provider: string;
  model: string;
}

const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

export function AgentEditor({
  initial,
  availableTools,
  availableModels,
  mode = "edit",
}: {
  initial: AgentEditorInitial;
  availableTools: ToolOption[];
  availableModels: ModelAliasOption[];
  mode?: "create" | "edit";
}) {
  const router = useRouter();
  const [key, setKey] = useState(initial.key);
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [modelAlias, setModelAlias] = useState(initial.modelAlias || availableModels[0]?.alias || "");
  const [toolIds, setToolIds] = useState<Set<string>>(new Set(initial.toolIds));
  const [kbAudiences, setKbAudiences] = useState((Array.isArray(initial.kbScope.audience) ? (initial.kbScope.audience as string[]) : ["customer"]).join(", "));
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [guardrailsJson, setGuardrailsJson] = useState(JSON.stringify(initial.guardrails, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleTool = (toolKey: string) => {
    setToolIds((prev) => {
      const next = new Set(prev);
      if (next.has(toolKey)) next.delete(toolKey);
      else next.add(toolKey);
      return next;
    });
  };

  const publish = async () => {
    setError(null);
    if (mode === "create" && !KEY_PATTERN.test(key)) {
      setError("Key must start with a letter and contain only lowercase letters, numbers, and hyphens");
      return;
    }
    if (!modelAlias) {
      setError("Choose a model");
      return;
    }
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
          key: mode === "create" ? key : initial.key,
          isCreate: mode === "create",
          systemPrompt,
          modelAlias,
          toolIds: [...toolIds],
          guardrails,
          skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
          kbScope: { audience: kbAudiences.split(",").map((s) => s.trim()).filter(Boolean) },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not publish");
      if (mode === "create") {
        router.push(`/admin/agents/${key}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-5">
      {mode === "create" && (
        <div>
          <label className="block text-sm text-muted">Key</label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value.trim().toLowerCase())}
            placeholder="e.g. billing-specialist"
            className="mt-1 w-64 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-fg outline-none focus:border-accent"
          />
          <p className="mt-1 text-xs text-muted">Lowercase letters, numbers, and hyphens. This is how tools, the router, and handoffs refer to this agent — it can&apos;t be changed later.</p>
        </div>
      )}

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
        <label className="block text-sm text-muted">Model</label>
        <select
          value={modelAlias}
          onChange={(e) => setModelAlias(e.target.value)}
          className="mt-1 w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        >
          {!availableModels.some((m) => m.alias === modelAlias) && (
            <option value={modelAlias}>{modelAlias} (not in Admin &gt; Models)</option>
          )}
          {availableModels.map((m) => (
            <option key={m.alias} value={m.alias}>
              {m.alias} — {m.provider}:{m.model}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">
          Switching this republishes immediately — no redeploy. Manage what each option points to under{" "}
          <Link href="/admin/models" className="text-accent hover:underline">
            Admin &gt; Models
          </Link>
          .
        </p>
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
        <label className="block text-sm text-muted">KB audiences (comma-separated)</label>
        <input
          value={kbAudiences}
          onChange={(e) => setKbAudiences(e.target.value)}
          placeholder="customer"
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-muted">
          Retrieval only pulls from articles tagged with one of these. Manage articles under{" "}
          <Link href="/admin/kb" className="text-accent hover:underline">
            Admin &gt; Knowledge base
          </Link>
          .
        </p>
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
        {mode === "create" ? (busy ? "Creating…" : "Create agent") : busy ? "Publishing…" : `Publish v${initial.version + 1}`}
      </button>
    </div>
  );
}
