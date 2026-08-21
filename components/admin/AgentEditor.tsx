"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, MessageSquare, Cpu, Wrench, BookOpen, Sparkles } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input, Label } from "../ui/Input";

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

export interface KbCollectionOption {
  id: string;
  name: string;
}

const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

function SectionHeading({ icon: Icon, title, subtitle }: { icon: typeof Bot; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Icon size={16} />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}

const textareaClass = "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";

export function AgentEditor({
  initial,
  availableTools,
  availableModels,
  availableCollections,
  mode = "edit",
}: {
  initial: AgentEditorInitial;
  availableTools: ToolOption[];
  availableModels: ModelAliasOption[];
  availableCollections: KbCollectionOption[];
  mode?: "create" | "edit";
}) {
  const router = useRouter();
  const [key, setKey] = useState(initial.key);
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [modelAlias, setModelAlias] = useState(initial.modelAlias || availableModels[0]?.alias || "");
  const [toolIds, setToolIds] = useState<Set<string>>(new Set(initial.toolIds));
  const isLegacyKbScope = !Array.isArray(initial.kbScope.collectionIds);
  const [collectionIds, setCollectionIds] = useState<Set<string>>(new Set(Array.isArray(initial.kbScope.collectionIds) ? (initial.kbScope.collectionIds as string[]) : []));
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

  const toggleCollection = (id: string) => {
    setCollectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
          kbScope: { collectionIds: [...collectionIds] },
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
        <Card className="p-6">
          <SectionHeading icon={Bot} title="Identity" />
          <div className="mt-4">
            <Field label="Key" htmlFor="agent-key">
              <Input id="agent-key" value={key} onChange={(e) => setKey(e.target.value.trim().toLowerCase())} placeholder="e.g. billing-specialist" className="w-72 font-mono text-xs" />
            </Field>
            <p className="mt-1.5 text-xs text-muted">Lowercase letters, numbers, and hyphens. This is how tools, the router, and handoffs refer to this agent — it can&apos;t be changed later.</p>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <SectionHeading icon={MessageSquare} title="Prompt" subtitle="What this agent is told to do." />
        <div className="mt-4">
          <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={10} className={`${textareaClass} font-mono text-xs`} />
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeading icon={Cpu} title="Model" />
        <div className="mt-4">
          <select
            value={modelAlias}
            onChange={(e) => setModelAlias(e.target.value)}
            className="w-72 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          >
            {!availableModels.some((m) => m.alias === modelAlias) && <option value={modelAlias}>{modelAlias} (not in Admin &gt; Models)</option>}
            {availableModels.map((m) => (
              <option key={m.alias} value={m.alias}>
                {m.alias} — {m.provider}:{m.model}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted">
            Switching this republishes immediately — no redeploy. Manage what each option points to under{" "}
            <Link href="/admin/models" className="text-accent hover:underline">
              Admin &gt; Models
            </Link>
            .
          </p>
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeading icon={Wrench} title="Tools" />
        <div className="mt-4 flex flex-wrap gap-2">
          {availableTools.length === 0 && <p className="text-xs text-muted">No tools defined yet.</p>}
          {availableTools.map((tool) => {
            const checked = toolIds.has(tool.key);
            return (
              <button
                key={tool.key}
                type="button"
                onClick={() => toggleTool(tool.key)}
                title={tool.description}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${checked ? "border-accent bg-accent-soft text-accent" : "border-border bg-bg text-muted hover:text-fg"}`}
              >
                {tool.key}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeading icon={BookOpen} title="Knowledge" subtitle="Which Knowledge Bases this agent can retrieve from." />
        <div className="mt-4">
          {availableCollections.length === 0 ? (
            <p className="text-xs text-muted">
              No Knowledge Bases yet — create one under{" "}
              <Link href="/admin/kb" className="text-accent hover:underline">
                Admin &gt; Knowledge base
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableCollections.map((c) => {
                const checked = collectionIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCollection(c.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${checked ? "border-accent bg-accent-soft text-accent" : "border-border bg-bg text-muted hover:text-fg"}`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
          {isLegacyKbScope && collectionIds.size === 0 && (
            <p className="mt-2 text-xs text-warning">This agent currently uses legacy audience-based KB scoping. Selecting a Knowledge Base and republishing switches it over.</p>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeading icon={Sparkles} title="Skills & guardrails" />
        <div className="mt-4 space-y-4">
          <Field label="Skills (comma-separated)" htmlFor="agent-skills">
            <Input id="agent-skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
          </Field>
          <div>
            <Label htmlFor="agent-guardrails">Guardrails (JSON)</Label>
            <textarea id="agent-guardrails" value={guardrailsJson} onChange={(e) => setGuardrailsJson(e.target.value)} rows={4} className={`mt-1.5 ${textareaClass} font-mono text-xs`} />
          </div>
        </div>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button disabled={busy} onClick={publish}>
        {mode === "create" ? (busy ? "Creating…" : "Create agent") : busy ? "Publishing…" : `Publish v${initial.version + 1}`}
      </Button>
    </div>
  );
}
