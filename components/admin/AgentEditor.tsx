"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, MessageSquare, Cpu, Wrench, BookOpen, Sparkles, Globe, FileSearch, Plug, X, Settings, FolderCog } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input, Label } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { KbDocumentsModal } from "./KbDocumentsModal";
import { AgentPreviewChat } from "./AgentPreviewChat";
import { MODEL_CATALOG, PROVIDER_DISPLAY_NAMES, displayNameForAlias } from "../../src/gateway/model-catalog";

export interface ToolOption {
  key: string;
  description: string;
  type?: "code" | "http";
  writeFlag?: boolean;
  approvalPolicy?: "auto" | "confirm_with_customer" | "require_human_approval";
  handlerConfig?: Record<string, unknown>;
}

/** Mirrors AgentNativeToolsConfig in src/db/repositories/agent-def-repository.ts — kept as a plain local type (not imported) so this client component doesn't pull in server/repository code. */
export interface AgentNativeToolsConfig {
  webSearch?: boolean;
  fileSearch?: boolean;
  mcp?: { enabled: boolean; serverLabel?: string; serverUrl?: string; headers?: Record<string, string> };
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
  nativeTools: AgentNativeToolsConfig;
  quickReplies: string[];
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
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

type SectionTab = "prompt" | "knowledge" | "tools" | "behavior";

const SECTION_TABS: { key: SectionTab; label: string; icon: typeof Bot }[] = [
  { key: "prompt", label: "Prompt & model", icon: MessageSquare },
  { key: "knowledge", label: "Knowledge", icon: BookOpen },
  { key: "tools", label: "Tools", icon: Wrench },
  { key: "behavior", label: "Behavior", icon: Sparkles },
];

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
  versions,
  mode = "edit",
}: {
  initial: AgentEditorInitial;
  availableTools: ToolOption[];
  availableModels: ModelAliasOption[];
  availableCollections: KbCollectionOption[];
  /** Phase 6 M4: every published version of this agent, newest first — powers the Prompt card's version dropdown. Omitted in create mode. */
  versions?: AgentEditorInitial[];
  mode?: "create" | "edit";
}) {
  const router = useRouter();
  const [key, setKey] = useState(initial.key);
  const [viewingVersion, setViewingVersion] = useState(initial.version);
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [modelAlias, setModelAlias] = useState(initial.modelAlias || availableModels[0]?.alias || "");
  const [toolIds, setToolIds] = useState<Set<string>>(new Set(initial.toolIds));
  const isLegacyKbScope = !Array.isArray(initial.kbScope.collectionIds);
  const [collectionIds, setCollectionIds] = useState<Set<string>>(new Set(Array.isArray(initial.kbScope.collectionIds) ? (initial.kbScope.collectionIds as string[]) : []));
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [guardrailsJson, setGuardrailsJson] = useState(JSON.stringify(initial.guardrails, null, 2));
  const [nativeTools, setNativeTools] = useState<AgentNativeToolsConfig>(initial.nativeTools ?? {});
  const [quickReplies, setQuickReplies] = useState<string[]>(initial.quickReplies ?? []);
  const [newQuickReply, setNewQuickReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState(availableTools);
  const [collections, setCollections] = useState(availableCollections);
  const [newKbOpen, setNewKbOpen] = useState(false);
  const [forkingTool, setForkingTool] = useState<ToolOption | null>(null);
  const [managingCollection, setManagingCollection] = useState<KbCollectionOption | null>(null);
  const [tab, setTab] = useState<SectionTab>("prompt");

  // Recomputed on every render so the preview pane's next send always uses whatever is currently
  // in the form, not a stale snapshot from when this component mounted.
  const previewDraft = useMemo(() => {
    let guardrails: Record<string, unknown>;
    try {
      guardrails = guardrailsJson.trim() ? JSON.parse(guardrailsJson) : {};
    } catch {
      guardrails = initial.guardrails;
    }
    return {
      key: mode === "create" ? key : initial.key,
      systemPrompt,
      modelAlias,
      toolIds: [...toolIds],
      guardrails,
      kbScope: { collectionIds: [...collectionIds] },
      nativeTools,
      skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
    };
  }, [mode, key, initial.key, initial.guardrails, systemPrompt, modelAlias, toolIds, guardrailsJson, collectionIds, nativeTools, skills]);

  // Older tenants can have leftover role-named aliases (e.g. "support-main") pointing at the
  // same provider+model a catalog-named alias also covers — collapse those duplicate-looking
  // options, but never drop whichever alias is actually selected right now.
  const dedupedModels = availableModels.filter((m) => {
    if (m.alias === modelAlias) return true;
    if (m.alias === m.model) return true;
    return !availableModels.some((other) => other.provider === m.provider && other.model === m.model && other.alias === other.model);
  });
  const catalogProviderOrder = [...new Set(MODEL_CATALOG.map((e) => e.provider))];
  const modelProviders = [...new Set(dedupedModels.map((m) => m.provider))].sort((a, b) => {
    const ai = catalogProviderOrder.indexOf(a);
    const bi = catalogProviderOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const selectedProvider = availableModels.find((m) => m.alias === modelAlias)?.provider;

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

  const addQuickReply = () => {
    const trimmed = newQuickReply.trim();
    if (!trimmed) return;
    setQuickReplies((prev) => [...prev, trimmed]);
    setNewQuickReply("");
  };

  const removeQuickReply = (index: number) => {
    setQuickReplies((prev) => prev.filter((_, i) => i !== index));
  };

  const loadVersion = (version: number) => {
    const found = versions?.find((v) => v.version === version);
    if (!found) return;
    setViewingVersion(version);
    setSystemPrompt(found.systemPrompt);
    setModelAlias(found.modelAlias);
    setToolIds(new Set(found.toolIds));
    setCollectionIds(new Set(Array.isArray(found.kbScope.collectionIds) ? (found.kbScope.collectionIds as string[]) : []));
    setSkills(found.skills.join(", "));
    setGuardrailsJson(JSON.stringify(found.guardrails, null, 2));
    setNativeTools(found.nativeTools ?? {});
    setQuickReplies(found.quickReplies ?? []);
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
          nativeTools,
          quickReplies,
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
    <div className="mt-6">
      {mode === "create" && (
        <Card className="mb-5 p-6">
          <SectionHeading icon={Bot} title="Identity" />
          <div className="mt-4">
            <Field label="Key" htmlFor="agent-key">
              <Input id="agent-key" value={key} onChange={(e) => setKey(e.target.value.trim().toLowerCase())} placeholder="e.g. billing-specialist" className="w-72 font-mono text-xs" />
            </Field>
            <p className="mt-1.5 text-xs text-muted">Lowercase letters, numbers, and hyphens. This is how tools, the router, and handoffs refer to this agent — it can&apos;t be changed later.</p>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <div className="flex gap-1 overflow-x-auto border-b border-border">
            {SECTION_TABS.map(({ key: tabKey, label, icon: Icon }) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setTab(tabKey)}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === tabKey ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          {tab === "prompt" && (
            <div className="space-y-5">
              <Card className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <SectionHeading icon={MessageSquare} title="Prompt" subtitle="What this agent is told to do." />
                  {versions && versions.length > 1 && (
                    <select
                      value={viewingVersion}
                      onChange={(e) => loadVersion(Number(e.target.value))}
                      className="shrink-0 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      {versions.map((v) => (
                        <option key={v.version} value={v.version}>
                          v{v.version}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {versions && viewingVersion !== initial.version && (
                  <p className="mt-2 text-xs text-warning">
                    Viewing v{viewingVersion} — Publish will create v{initial.version + 1} from this.
                  </p>
                )}
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
                    {!availableModels.some((m) => m.alias === modelAlias) && <option value={modelAlias}>{modelAlias} (unknown alias)</option>}
                    {modelProviders.map((provider) => (
                      <optgroup key={provider} label={PROVIDER_DISPLAY_NAMES[provider] ?? provider}>
                        {dedupedModels
                          .filter((m) => m.provider === provider)
                          .map((m) => (
                            <option key={m.alias} value={m.alias}>
                              {displayNameForAlias(m.provider, m.model)}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-muted">Switching this republishes immediately — no redeploy.</p>
                </div>
              </Card>
            </div>
          )}

          {tab === "knowledge" && (
            <div className="space-y-5">
              <Card className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <SectionHeading icon={BookOpen} title="Knowledge" subtitle="Which Knowledge Bases this agent can retrieve from." />
                  <button type="button" onClick={() => setNewKbOpen(true)} className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline">
                    + New Knowledge Base
                  </button>
                </div>
                <div className="mt-3 divide-y divide-border">
                  {collections.length === 0 && <p className="py-2 text-xs text-muted">No Knowledge Bases yet — create one above.</p>}
                  {collections.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <p className="min-w-0 flex-1 truncate text-sm text-fg">{c.name}</p>
                      <button type="button" onClick={() => setManagingCollection(c)} aria-label="Manage documents" title="Manage documents" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-bg hover:text-fg">
                        <FolderCog size={15} />
                      </button>
                      <Toggle checked={collectionIds.has(c.id)} onChange={() => toggleCollection(c.id)} />
                    </div>
                  ))}
                </div>
                {isLegacyKbScope && collectionIds.size === 0 && (
                  <p className="mt-2 text-xs text-warning">This agent currently uses legacy audience-based KB scoping. Selecting a Knowledge Base and republishing switches it over.</p>
                )}
              </Card>
            </div>
          )}

          {tab === "tools" && (
            <div className="space-y-5">
              {selectedProvider === "openai" && (
                <Card className="p-6">
                  <SectionHeading icon={Plug} title="Native Tools" subtitle="Hosted by OpenAI — no separate handler needed." />
                  <div className="mt-4 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-2.5">
                        <Globe size={16} className="mt-0.5 shrink-0 text-muted" />
                        <div>
                          <p className="text-sm text-fg">Web Search</p>
                          <p className="text-xs text-muted">Search the web for real-time information.</p>
                        </div>
                      </div>
                      <Toggle checked={Boolean(nativeTools.webSearch)} onChange={(next) => setNativeTools((prev) => ({ ...prev, webSearch: next }))} />
                    </div>

                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-2.5">
                        <FileSearch size={16} className="mt-0.5 shrink-0 text-muted" />
                        <div>
                          <p className="text-sm text-fg">File Search</p>
                          <p className="text-xs text-muted">Searches this agent&apos;s Knowledge selection.</p>
                        </div>
                      </div>
                      <Toggle checked={Boolean(nativeTools.fileSearch)} onChange={(next) => setNativeTools((prev) => ({ ...prev, fileSearch: next }))} />
                    </div>

                    <div>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-2.5">
                          <Plug size={16} className="mt-0.5 shrink-0 text-muted" />
                          <div>
                            <p className="text-sm text-fg">MCP Tools</p>
                            <p className="text-xs text-muted">Connect an external tool server via MCP.</p>
                          </div>
                        </div>
                        <Toggle checked={Boolean(nativeTools.mcp?.enabled)} onChange={(next) => setNativeTools((prev) => ({ ...prev, mcp: { ...prev.mcp, enabled: next } }))} />
                      </div>
                      {nativeTools.mcp?.enabled && (
                        <div className="mt-3 space-y-3 pl-7">
                          <Field label="Server label" htmlFor="mcp-server-label">
                            <Input
                              id="mcp-server-label"
                              value={nativeTools.mcp?.serverLabel ?? ""}
                              onChange={(e) => setNativeTools((prev) => ({ ...prev, mcp: { ...prev.mcp, enabled: true, serverLabel: e.target.value } }))}
                              placeholder="e.g. internal-crm"
                            />
                          </Field>
                          <Field label="Server URL" htmlFor="mcp-server-url">
                            <Input
                              id="mcp-server-url"
                              value={nativeTools.mcp?.serverUrl ?? ""}
                              onChange={(e) => setNativeTools((prev) => ({ ...prev, mcp: { ...prev.mcp, enabled: true, serverUrl: e.target.value } }))}
                              placeholder="https://mcp.example.com"
                            />
                          </Field>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              )}

              <Card className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <SectionHeading icon={Wrench} title="Tools" />
                  <Link href="/admin/tools/new" target="_blank" className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline">
                    + New tool
                  </Link>
                </div>
                <div className="mt-3 divide-y divide-border">
                  {tools.length === 0 && <p className="py-2 text-xs text-muted">No tools defined yet.</p>}
                  {tools.map((tool) => (
                    <div key={tool.key} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-fg">{tool.key}</p>
                        <p className="truncate text-xs text-muted">{tool.description}</p>
                      </div>
                      {tool.type === "http" && mode === "edit" && (
                        <button type="button" onClick={() => setForkingTool(tool)} aria-label="Customize for this agent" title="Customize for this agent" className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-bg hover:text-fg">
                          <Settings size={15} />
                        </button>
                      )}
                      <Toggle checked={toolIds.has(tool.key)} onChange={() => toggleTool(tool.key)} />
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">Opens in a new tab — full auth, write policy, and schema options live there. Write-flagged tools never actually run in the preview pane.</p>
              </Card>
            </div>
          )}

          {tab === "behavior" && (
            <div className="space-y-5">
              <Card className="p-6">
                <SectionHeading icon={MessageSquare} title="Quick replies" subtitle="Canned reply chips shown at the start of a conversation." />
                <div className="mt-4">
                  <div className="flex flex-wrap gap-2">
                    {quickReplies.map((reply, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-medium text-fg">
                        {reply}
                        <button type="button" onClick={() => removeQuickReply(i)} aria-label="Remove" className="text-muted hover:text-danger">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      value={newQuickReply}
                      onChange={(e) => setNewQuickReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addQuickReply();
                        }
                      }}
                      placeholder="e.g. Where's my order?"
                      className="w-72"
                    />
                    <Button type="button" variant="secondary" onClick={addQuickReply}>
                      Add
                    </Button>
                  </div>
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
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button disabled={busy} onClick={publish}>
            {mode === "create" ? (busy ? "Creating…" : "Create agent") : busy ? "Publishing…" : `Publish v${initial.version + 1}`}
          </Button>
        </div>

        <Card className="sticky top-6 flex h-[calc(100vh-7rem)] min-h-[420px] flex-col overflow-hidden p-0">
          <AgentPreviewChat draft={previewDraft} />
        </Card>
      </div>

      {forkingTool && (
        <ForkToolModal
          tool={forkingTool}
          agentKey={mode === "create" ? key : initial.key}
          onClose={() => setForkingTool(null)}
          onForked={(forked) => {
            setTools((prev) => [...prev, forked]);
            setToolIds((prev) => {
              const next = new Set(prev);
              next.delete(forkingTool.key);
              next.add(forked.key);
              return next;
            });
            setForkingTool(null);
          }}
        />
      )}

      {newKbOpen && (
        <NewKbModal
          onClose={() => setNewKbOpen(false)}
          onCreated={(collection) => {
            setCollections((prev) => [...prev, collection]);
            setCollectionIds((prev) => new Set(prev).add(collection.id));
            setNewKbOpen(false);
            setManagingCollection(collection);
          }}
        />
      )}

      {managingCollection && <KbDocumentsModal collectionId={managingCollection.id} collectionName={managingCollection.name} onClose={() => setManagingCollection(null)} />}
    </div>
  );
}

const modalFieldClass = "rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";

type HandlerConfig = { url?: string; method?: string; argsLocation?: string; credentialId?: string | null; authStyle?: string; authParamName?: string | null };

/**
 * Phase 6: "fork on customize" — editing a shared no-code tool from inside an agent creates a
 * private copy (key derived from the original + this agent) that only this agent uses from then
 * on; the original tool_defs row, and every other agent using it, is untouched. Reuses the plain
 * tool_defs table/CRUD — no schema change.
 */
function ForkToolModal({ tool, agentKey, onClose, onForked }: { tool: ToolOption; agentKey: string; onClose: () => void; onForked: (tool: ToolOption) => void }) {
  const original = (tool.handlerConfig ?? {}) as HandlerConfig;
  const suggestedKey = agentKey ? `${tool.key}__${agentKey}` : `${tool.key}__custom`;
  const [key, setKey] = useState(suggestedKey);
  const [description, setDescription] = useState(tool.description);
  const [url, setUrl] = useState(original.url ?? "");
  const [method, setMethod] = useState(original.method ?? "POST");
  const [writeFlag, setWriteFlag] = useState(Boolean(tool.writeFlag));
  const [approvalPolicy, setApprovalPolicy] = useState(tool.approvalPolicy ?? "auto");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fork = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          description,
          inputSchema: { type: "object", properties: {}, required: [] },
          writeFlag,
          approvalPolicy,
          handlerConfig: { ...original, url, method },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create a custom copy");
      onForked({ key, description, type: "http", writeFlag, approvalPolicy, handlerConfig: { ...original, url, method } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Customize "${tool.key}" for this agent`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-muted">Creates a private copy this agent uses instead — the original tool, and every other agent using it, is unaffected.</p>
        <Field label="New key" htmlFor="fork-tool-key">
          <Input id="fork-tool-key" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-xs" />
        </Field>
        <Field label="Description (shown to the model)" htmlFor="fork-tool-description">
          <Input id="fork-tool-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="URL" htmlFor="fork-tool-url">
          <Input id="fork-tool-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/status" />
        </Field>
        <Field label="Method" htmlFor="fork-tool-method">
          <select id="fork-tool-method" value={method} onChange={(e) => setMethod(e.target.value)} className={modalFieldClass}>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={writeFlag} onChange={(e) => setWriteFlag(e.target.checked)} />
          Write tool (mutates something)
        </label>
        <Field label="Approval policy" htmlFor="fork-tool-approval">
          <select id="fork-tool-approval" value={approvalPolicy} onChange={(e) => setApprovalPolicy(e.target.value as typeof approvalPolicy)} className={modalFieldClass}>
            {(["auto", "confirm_with_customer", "require_human_approval"] as const).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-muted">Credential and auth style are carried over from the original — manage credentials at Admin &gt; API keys.</p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button disabled={busy || !key || !description || !url} onClick={fork}>
          {busy ? "Creating…" : "Create custom copy"}
        </Button>
      </div>
    </Modal>
  );
}

/** Phase 6 M6: same fields as KbCollectionsManagement's inline create form. */
function NewKbModal({ onClose, onCreated }: { onClose: () => void; onCreated: (collection: KbCollectionOption) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/kb-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create Knowledge Base");
      const body = (await res.json()) as { collection: { id: string; name: string } };
      onCreated({ id: body.collection.id, name: body.collection.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New Knowledge Base" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" htmlFor="new-kb-name">
          <Input id="new-kb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Returns & Policies" />
        </Field>
        <Field label="Description (optional)" htmlFor="new-kb-description">
          <Input id="new-kb-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What lives in this KB" />
        </Field>
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button disabled={busy || !name.trim()} onClick={create}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
    </Modal>
  );
}
