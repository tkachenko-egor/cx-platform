"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, MessageSquare, Cpu, Wrench, BookOpen, Sparkles, Globe, FileSearch, Plug, X, Settings, FolderCog, UserCircle, Smile, Languages, AlertTriangle, Shield, Waypoints } from "lucide-react";
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

/** Mirrors AgentPersonaConfig/AgentLanguageConfig in src/db/repositories/agent-def-repository.ts — kept local for the same reason as AgentNativeToolsConfig above. */
export interface AgentCannedMessages {
  greeting?: string;
  fallback?: string;
  handoff?: string;
  outOfHours?: string;
  idleTimeout?: string;
}

export interface AgentCannedMessageOverride extends AgentCannedMessages {
  channel?: string;
  language?: string;
}

export interface AgentPersonaConfig {
  tone?: string;
  customTone?: string;
  formality?: "ty" | "vy" | "auto";
  responseLength?: "brief" | "standard" | "detailed";
  emojiPolicy?: "never" | "sparing" | "liberal";
  doNotSayList?: string[];
  brandVocabulary?: string[];
  cannedMessages?: { default?: AgentCannedMessages; overrides?: AgentCannedMessageOverride[] };
}

export interface AgentLanguageConfig {
  supportedLanguages?: string[];
  defaultLanguage?: string;
  autoDetect?: boolean;
  alwaysAnswerInCustomerLanguage?: boolean;
  mixedInputHandling?: "transliterate_to_native" | "answer_as_written" | "ask_preference";
}

/** Mirrors AgentEscalationConfig in src/db/repositories/agent-def-repository.ts — kept local, same reason as the types above. */
export interface AgentEscalationConfig {
  humanRequestKeywords?: string[];
  negativeSentimentKeywords?: string[];
  severeSymptomKeywords?: string[];
  reactionKeywords?: string[];
  escalateOnLowConfidence?: boolean;
  confidenceThreshold?: number;
  nFailedAttempts?: number;
  turnCountCap?: number;
}

/** Mirrors AgentGuardrailConfig in src/guardrails/types.ts — kept local, same reason as the types above. */
export interface AgentGuardrailConfig {
  input?: {
    promptInjectionScreening?: boolean;
    blockedTopics?: string[];
    competitorNames?: string[];
  };
  output?: {
    groundednessCheck?: boolean;
    piiLeakageCheck?: boolean;
    piiMode?: "block" | "redact";
    forbiddenClaimsCheck?: boolean;
    profanityCheck?: boolean;
    aiDisclosureMessage?: string;
    blockingMode?: boolean;
  };
}

/** Mirrors AgentConversationConfig in src/db/repositories/agent-def-repository.ts — kept local, same reason as the types above. */
export interface AgentConversationConfig {
  inScopeTopics?: string[];
  outOfScopeTopics?: string[];
  requiredSlots?: string[];
  memoryScope?: "full" | "recent";
  recentTurnLimit?: number;
  variables?: Record<string, string>;
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
  displayName: string;
  avatarUrl: string | null;
  internalDescription: string;
  ownerUserId: string | null;
  tags: string[];
  agentStatus: "draft" | "active" | "paused" | "archived";
  environment: "sandbox" | "production";
  temperature: number | null;
  maxOutputTokens: number | null;
  costCeilingUsd: number | null;
  persona: AgentPersonaConfig;
  languageConfig: AgentLanguageConfig;
  escalationConfig: AgentEscalationConfig;
  conversationConfig: AgentConversationConfig;
  enabledChannels: string[];
}

export interface OwnerOption {
  id: string;
  email: string;
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

/** Phase 8: shared chip-list input for the several new keyword/topic lists (escalation triggers, blocked topics, competitor names) — same visual pattern the do-not-say/brand-vocabulary/supported-language inputs already use inline, pulled into one component once there were enough repeats to justify it. */
function ChipListInput({ id, label, values, onChange, placeholder }: { id: string; label: string; values: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-medium text-fg">
            {v}
            <button type="button" onClick={() => onChange(values.filter((_, idx) => idx !== i))} aria-label="Remove" className="text-muted hover:text-danger">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !draft.trim()) return;
            e.preventDefault();
            onChange([...values, draft.trim()]);
            setDraft("");
          }}
          placeholder={placeholder}
          className="w-64"
        />
      </div>
    </div>
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

type SectionTab = "identity" | "prompt" | "persona" | "language" | "conversation" | "knowledge" | "tools" | "escalation" | "guardrails" | "behavior";

const SECTION_TABS: { key: SectionTab; label: string; icon: typeof Bot }[] = [
  { key: "identity", label: "Identity", icon: UserCircle },
  { key: "prompt", label: "Prompt & model", icon: MessageSquare },
  { key: "persona", label: "Persona", icon: Smile },
  { key: "language", label: "Language", icon: Languages },
  { key: "conversation", label: "Conversation", icon: Waypoints },
  { key: "knowledge", label: "Knowledge", icon: BookOpen },
  { key: "tools", label: "Tools", icon: Wrench },
  { key: "escalation", label: "Escalation", icon: AlertTriangle },
  { key: "guardrails", label: "Guardrails", icon: Shield },
  { key: "behavior", label: "Behavior", icon: Sparkles },
];

const TONE_PRESETS = ["Neutral", "Formal", "Friendly", "Playful", "Custom"];
const AGENT_STATUSES = ["draft", "active", "paused", "archived"] as const;
const CHANNEL_OPTIONS = ["widget", "email"] as const;

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
  availableOwners = [],
  versions,
  mode = "edit",
}: {
  initial: AgentEditorInitial;
  availableTools: ToolOption[];
  availableModels: ModelAliasOption[];
  availableCollections: KbCollectionOption[];
  /** Phase 7 M1: for the Identity tab's owner picker. */
  availableOwners?: OwnerOption[];
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
  /** Phase 8 M3: set when a supervisor's publish was queued for admin approval instead of going live immediately. */
  const [pendingApprovalMessage, setPendingApprovalMessage] = useState<string | null>(null);
  const [tools, setTools] = useState(availableTools);
  const [collections, setCollections] = useState(availableCollections);
  const [newKbOpen, setNewKbOpen] = useState(false);
  const [forkingTool, setForkingTool] = useState<ToolOption | null>(null);
  const [managingCollection, setManagingCollection] = useState<KbCollectionOption | null>(null);
  const [tab, setTab] = useState<SectionTab>("prompt");

  // Phase 7 M1: identity & lifecycle
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? "");
  const [internalDescription, setInternalDescription] = useState(initial.internalDescription);
  const [ownerUserId, setOwnerUserId] = useState(initial.ownerUserId ?? "");
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [agentStatus, setAgentStatus] = useState(initial.agentStatus);
  const [environment, setEnvironment] = useState(initial.environment);
  const [changeNotes, setChangeNotes] = useState("");

  // Phase 7 M2: model & engine controls
  const [temperature, setTemperature] = useState(initial.temperature != null ? String(initial.temperature) : "");
  const [maxOutputTokens, setMaxOutputTokens] = useState(initial.maxOutputTokens != null ? String(initial.maxOutputTokens) : "");
  const [costCeilingUsd, setCostCeilingUsd] = useState(initial.costCeilingUsd != null ? String(initial.costCeilingUsd) : "");

  // Phase 7 M3: persona & language
  const [persona, setPersona] = useState<AgentPersonaConfig>(initial.persona ?? {});
  const [languageConfig, setLanguageConfig] = useState<AgentLanguageConfig>(initial.languageConfig ?? {});
  const [newDoNotSay, setNewDoNotSay] = useState("");
  const [newBrandWord, setNewBrandWord] = useState("");
  const [newLanguage, setNewLanguage] = useState("");

  // Phase 8 M1: escalation triggers
  const [escalationConfig, setEscalationConfig] = useState<AgentEscalationConfig>(initial.escalationConfig ?? {});
  const [confidenceThreshold, setConfidenceThreshold] = useState(initial.escalationConfig?.confidenceThreshold != null ? String(initial.escalationConfig.confidenceThreshold) : "");
  const [nFailedAttempts, setNFailedAttempts] = useState(initial.escalationConfig?.nFailedAttempts != null ? String(initial.escalationConfig.nFailedAttempts) : "");
  const [turnCountCap, setTurnCountCap] = useState(initial.escalationConfig?.turnCountCap != null ? String(initial.escalationConfig.turnCountCap) : "");

  // Phase 9 M2/M3: conversation logic + channel allowlist
  const [conversationConfig, setConversationConfig] = useState<AgentConversationConfig>(initial.conversationConfig ?? {});
  const [recentTurnLimit, setRecentTurnLimit] = useState(initial.conversationConfig?.recentTurnLimit != null ? String(initial.conversationConfig.recentTurnLimit) : "");
  const [newVariableKey, setNewVariableKey] = useState("");
  const [newVariableValue, setNewVariableValue] = useState("");
  const [enabledChannels, setEnabledChannels] = useState<Set<string>>(new Set(initial.enabledChannels ?? []));

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
      displayName,
      systemPrompt,
      modelAlias,
      toolIds: [...toolIds],
      guardrails,
      kbScope: { collectionIds: [...collectionIds] },
      nativeTools,
      skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      temperature: temperature.trim() ? Number(temperature) : null,
      maxOutputTokens: maxOutputTokens.trim() ? Number(maxOutputTokens) : null,
      persona,
      languageConfig,
      escalationConfig: { ...escalationConfig, confidenceThreshold: confidenceThreshold.trim() ? Number(confidenceThreshold) : undefined, nFailedAttempts: nFailedAttempts.trim() ? Number(nFailedAttempts) : undefined },
      conversationConfig: { ...conversationConfig, recentTurnLimit: recentTurnLimit.trim() ? Number(recentTurnLimit) : undefined },
    };
  }, [
    mode,
    key,
    initial.key,
    initial.guardrails,
    displayName,
    systemPrompt,
    modelAlias,
    toolIds,
    guardrailsJson,
    collectionIds,
    nativeTools,
    skills,
    temperature,
    maxOutputTokens,
    persona,
    languageConfig,
    escalationConfig,
    confidenceThreshold,
    nFailedAttempts,
    conversationConfig,
    recentTurnLimit,
  ]);

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

  // Phase 8 M2: guardrailsJson stays the single source of truth (unchanged
  // from before — previewDraft/publish() already parse it) — these helpers
  // just let the friendly toggle grid read/write into it instead of raw
  // JSON, with an "Advanced (raw JSON)" fallback still editing the same string.
  const parseGuardrails = (): AgentGuardrailConfig => {
    try {
      return guardrailsJson.trim() ? JSON.parse(guardrailsJson) : {};
    } catch {
      return {};
    }
  };
  const guardrails = parseGuardrails();
  const updateGuardrailInput = (patch: Partial<NonNullable<AgentGuardrailConfig["input"]>>) => {
    const g = parseGuardrails();
    setGuardrailsJson(JSON.stringify({ ...g, input: { ...g.input, ...patch } }, null, 2));
  };
  const updateGuardrailOutput = (patch: Partial<NonNullable<AgentGuardrailConfig["output"]>>) => {
    const g = parseGuardrails();
    setGuardrailsJson(JSON.stringify({ ...g, output: { ...g.output, ...patch } }, null, 2));
  };

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
    setDisplayName(found.displayName);
    setAvatarUrl(found.avatarUrl ?? "");
    setInternalDescription(found.internalDescription);
    setOwnerUserId(found.ownerUserId ?? "");
    setTags(found.tags.join(", "));
    setAgentStatus(found.agentStatus);
    setEnvironment(found.environment);
    setTemperature(found.temperature != null ? String(found.temperature) : "");
    setMaxOutputTokens(found.maxOutputTokens != null ? String(found.maxOutputTokens) : "");
    setCostCeilingUsd(found.costCeilingUsd != null ? String(found.costCeilingUsd) : "");
    setPersona(found.persona ?? {});
    setLanguageConfig(found.languageConfig ?? {});
    setEscalationConfig(found.escalationConfig ?? {});
    setConfidenceThreshold(found.escalationConfig?.confidenceThreshold != null ? String(found.escalationConfig.confidenceThreshold) : "");
    setNFailedAttempts(found.escalationConfig?.nFailedAttempts != null ? String(found.escalationConfig.nFailedAttempts) : "");
    setTurnCountCap(found.escalationConfig?.turnCountCap != null ? String(found.escalationConfig.turnCountCap) : "");
    setConversationConfig(found.conversationConfig ?? {});
    setRecentTurnLimit(found.conversationConfig?.recentTurnLimit != null ? String(found.conversationConfig.recentTurnLimit) : "");
    setEnabledChannels(new Set(found.enabledChannels ?? []));
  };

  const publish = async () => {
    setError(null);
    setPendingApprovalMessage(null);
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
          displayName,
          avatarUrl: avatarUrl.trim() || null,
          internalDescription,
          ownerUserId: ownerUserId || null,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          agentStatus,
          environment,
          changeNotes,
          temperature: temperature.trim() ? Number(temperature) : null,
          maxOutputTokens: maxOutputTokens.trim() ? Number(maxOutputTokens) : null,
          costCeilingUsd: costCeilingUsd.trim() ? Number(costCeilingUsd) : null,
          persona,
          languageConfig,
          escalationConfig: {
            ...escalationConfig,
            confidenceThreshold: confidenceThreshold.trim() ? Number(confidenceThreshold) : undefined,
            nFailedAttempts: nFailedAttempts.trim() ? Number(nFailedAttempts) : undefined,
            turnCountCap: turnCountCap.trim() ? Number(turnCountCap) : undefined,
          },
          conversationConfig: { ...conversationConfig, recentTurnLimit: recentTurnLimit.trim() ? Number(recentTurnLimit) : undefined },
          enabledChannels: [...enabledChannels],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not publish");
      if (body.pendingApproval) {
        setPendingApprovalMessage("Submitted for admin approval — this won't go live until an admin or owner approves it.");
        setBusy(false);
        return;
      }
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
          <SectionHeading icon={Bot} title="Key" />
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
                <div className="mt-5 grid grid-cols-3 gap-4">
                  <Field label="Temperature" htmlFor="agent-temperature">
                    <Input
                      id="agent-temperature"
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={temperature}
                      onChange={(e) => setTemperature(e.target.value)}
                      placeholder="Provider default"
                    />
                  </Field>
                  <Field label="Max response length (tokens)" htmlFor="agent-max-tokens">
                    <Input id="agent-max-tokens" type="number" min={1} value={maxOutputTokens} onChange={(e) => setMaxOutputTokens(e.target.value)} placeholder="1024" />
                  </Field>
                  <Field label="Cost ceiling per conversation ($)" htmlFor="agent-cost-ceiling">
                    <Input id="agent-cost-ceiling" type="number" min={0} step={0.01} value={costCeilingUsd} onChange={(e) => setCostCeilingUsd(e.target.value)} placeholder="Unlimited" />
                  </Field>
                </div>
                <p className="mt-1.5 text-xs text-muted">Blank fields use the provider default / no cap. Once the ceiling is spent, the conversation hands off to a colleague instead of calling the model again.</p>
              </Card>
            </div>
          )}

          {tab === "identity" && (
            <div className="space-y-5">
              <Card className="p-6">
                <SectionHeading icon={UserCircle} title="Identity" subtitle="How this agent is described and organized in the admin — never shown to the model." />
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Field label="Display name" htmlFor="agent-display-name">
                    <Input id="agent-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Billing Specialist" />
                  </Field>
                  <Field label="Avatar URL" htmlFor="agent-avatar-url">
                    <Input id="agent-avatar-url" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
                  </Field>
                </div>
                <div className="mt-4">
                  <Label htmlFor="agent-internal-description">Internal description</Label>
                  <textarea
                    id="agent-internal-description"
                    value={internalDescription}
                    onChange={(e) => setInternalDescription(e.target.value)}
                    rows={2}
                    placeholder="What this agent is for, for your own team — not the model."
                    className={`mt-1.5 ${textareaClass}`}
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Field label="Owner" htmlFor="agent-owner">
                    <select
                      id="agent-owner"
                      value={ownerUserId}
                      onChange={(e) => setOwnerUserId(e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      <option value="">Unassigned</option>
                      {availableOwners.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.email}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tags (comma-separated)" htmlFor="agent-tags">
                    <Input id="agent-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. billing, tier-1" />
                  </Field>
                </div>
              </Card>

              <Card className="p-6">
                <SectionHeading icon={Sparkles} title="Lifecycle" subtitle="Status controls whether this agent can be routed a new conversation." />
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Field label="Status" htmlFor="agent-status">
                    <select
                      id="agent-status"
                      value={agentStatus}
                      onChange={(e) => setAgentStatus(e.target.value as typeof agentStatus)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      {AGENT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div>
                    <Label htmlFor="agent-environment">Environment</Label>
                    <div id="agent-environment" className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEnvironment("sandbox")}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium ${environment === "sandbox" ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}
                      >
                        Sandbox
                      </button>
                      <button
                        type="button"
                        onClick={() => setEnvironment("production")}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium ${environment === "production" ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}
                      >
                        Production
                      </button>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted">
                  Draft, paused, and archived agents are never picked for a new conversation (existing conversations keep running unaffected). A sandbox agent&apos;s write tools always simulate — nothing is ever actually
                  changed.
                </p>
                <div className="mt-4 border-t border-border pt-4">
                  <Label htmlFor="agent-channels">Enabled channels</Label>
                  <div id="agent-channels" className="mt-1.5 flex items-center gap-4">
                    {CHANNEL_OPTIONS.map((c) => (
                      <label key={c} className="flex items-center gap-2 text-sm text-fg">
                        <input
                          type="checkbox"
                          checked={enabledChannels.has(c)}
                          onChange={() =>
                            setEnabledChannels((prev) => {
                              const next = new Set(prev);
                              if (next.has(c)) next.delete(c);
                              else next.add(c);
                              return next;
                            })
                          }
                        />
                        {c}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">Nothing checked means every channel (today&apos;s behavior). Check one or more to restrict this agent to only those.</p>
                </div>
              </Card>
            </div>
          )}

          {tab === "persona" && (
            <div className="space-y-5">
              <Card className="p-6">
                <SectionHeading icon={Smile} title="Tone & voice" />
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Field label="Tone preset" htmlFor="persona-tone">
                    <select
                      id="persona-tone"
                      value={persona.tone ?? "Neutral"}
                      onChange={(e) => setPersona((prev) => ({ ...prev, tone: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      {TONE_PRESETS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Formality" htmlFor="persona-formality">
                    <select
                      id="persona-formality"
                      value={persona.formality ?? "auto"}
                      onChange={(e) => setPersona((prev) => ({ ...prev, formality: e.target.value as AgentPersonaConfig["formality"] }))}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      <option value="auto">Let the model judge</option>
                      <option value="ty">Informal (ти)</option>
                      <option value="vy">Formal (ви)</option>
                    </select>
                  </Field>
                </div>
                {persona.tone === "Custom" && (
                  <div className="mt-4">
                    <Label htmlFor="persona-custom-tone">Custom tone description</Label>
                    <textarea
                      id="persona-custom-tone"
                      value={persona.customTone ?? ""}
                      onChange={(e) => setPersona((prev) => ({ ...prev, customTone: e.target.value }))}
                      rows={2}
                      className={`mt-1.5 ${textareaClass}`}
                    />
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Field label="Response length" htmlFor="persona-response-length">
                    <select
                      id="persona-response-length"
                      value={persona.responseLength ?? "standard"}
                      onChange={(e) => setPersona((prev) => ({ ...prev, responseLength: e.target.value as AgentPersonaConfig["responseLength"] }))}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      <option value="brief">Brief</option>
                      <option value="standard">Standard</option>
                      <option value="detailed">Detailed</option>
                    </select>
                  </Field>
                  <Field label="Emoji policy" htmlFor="persona-emoji">
                    <select
                      id="persona-emoji"
                      value={persona.emojiPolicy ?? "sparing"}
                      onChange={(e) => setPersona((prev) => ({ ...prev, emojiPolicy: e.target.value as AgentPersonaConfig["emojiPolicy"] }))}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      <option value="never">Never</option>
                      <option value="sparing">Sparing</option>
                      <option value="liberal">Liberal</option>
                    </select>
                  </Field>
                </div>
              </Card>

              <Card className="p-6">
                <SectionHeading icon={X} title="Do-not-say list & brand vocabulary" />
                <div className="mt-4 space-y-4">
                  <div>
                    <Label htmlFor="persona-do-not-say">Never say</Label>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {(persona.doNotSayList ?? []).map((word, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-medium text-fg">
                          {word}
                          <button
                            type="button"
                            onClick={() => setPersona((prev) => ({ ...prev, doNotSayList: (prev.doNotSayList ?? []).filter((_, idx) => idx !== i) }))}
                            aria-label="Remove"
                            className="text-muted hover:text-danger"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        id="persona-do-not-say"
                        value={newDoNotSay}
                        onChange={(e) => setNewDoNotSay(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" || !newDoNotSay.trim()) return;
                          e.preventDefault();
                          setPersona((prev) => ({ ...prev, doNotSayList: [...(prev.doNotSayList ?? []), newDoNotSay.trim()] }));
                          setNewDoNotSay("");
                        }}
                        placeholder="e.g. guaranteed"
                        className="w-64"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="persona-brand-vocab">Brand vocabulary</Label>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {(persona.brandVocabulary ?? []).map((word, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-medium text-fg">
                          {word}
                          <button
                            type="button"
                            onClick={() => setPersona((prev) => ({ ...prev, brandVocabulary: (prev.brandVocabulary ?? []).filter((_, idx) => idx !== i) }))}
                            aria-label="Remove"
                            className="text-muted hover:text-danger"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        id="persona-brand-vocab"
                        value={newBrandWord}
                        onChange={(e) => setNewBrandWord(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" || !newBrandWord.trim()) return;
                          e.preventDefault();
                          setPersona((prev) => ({ ...prev, brandVocabulary: [...(prev.brandVocabulary ?? []), newBrandWord.trim()] }));
                          setNewBrandWord("");
                        }}
                        placeholder="e.g. glow ritual"
                        className="w-64"
                      />
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <SectionHeading icon={MessageSquare} title="Canned messages" subtitle="Overridable per channel/language from the same config." />
                <div className="mt-4 grid grid-cols-2 gap-4">
                  {(["greeting", "fallback", "handoff", "outOfHours", "idleTimeout"] as const).map((field) => (
                    <Field key={field} label={field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} htmlFor={`canned-${field}`}>
                      <Input
                        id={`canned-${field}`}
                        value={persona.cannedMessages?.default?.[field] ?? ""}
                        onChange={(e) =>
                          setPersona((prev) => ({
                            ...prev,
                            cannedMessages: { ...prev.cannedMessages, default: { ...prev.cannedMessages?.default, [field]: e.target.value } },
                          }))
                        }
                      />
                    </Field>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">Out-of-hours is used instead of the usual handoff line when a handoff happens outside business hours (set at Business hours). Idle-timeout is stored here for a later trigger — no idle-timeout mechanism sends it automatically yet.</p>
              </Card>
            </div>
          )}

          {tab === "language" && (
            <div className="space-y-5">
              <Card className="p-6">
                <SectionHeading icon={Languages} title="Language" />
                <div className="mt-4">
                  <Label htmlFor="language-supported">Supported languages</Label>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {(languageConfig.supportedLanguages ?? []).map((lang, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-medium text-fg">
                        {lang}
                        <button
                          type="button"
                          onClick={() => setLanguageConfig((prev) => ({ ...prev, supportedLanguages: (prev.supportedLanguages ?? []).filter((_, idx) => idx !== i) }))}
                          aria-label="Remove"
                          className="text-muted hover:text-danger"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      id="language-supported"
                      value={newLanguage}
                      onChange={(e) => setNewLanguage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || !newLanguage.trim()) return;
                        e.preventDefault();
                        setLanguageConfig((prev) => ({ ...prev, supportedLanguages: [...(prev.supportedLanguages ?? []), newLanguage.trim()] }));
                        setNewLanguage("");
                      }}
                      placeholder="e.g. Ukrainian"
                      className="w-64"
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Field label="Default language" htmlFor="language-default">
                    <Input id="language-default" value={languageConfig.defaultLanguage ?? ""} onChange={(e) => setLanguageConfig((prev) => ({ ...prev, defaultLanguage: e.target.value }))} placeholder="e.g. Ukrainian" />
                  </Field>
                  <Field label="Mixed / transliterated input" htmlFor="language-mixed-input">
                    <select
                      id="language-mixed-input"
                      value={languageConfig.mixedInputHandling ?? "transliterate_to_native"}
                      onChange={(e) => setLanguageConfig((prev) => ({ ...prev, mixedInputHandling: e.target.value as AgentLanguageConfig["mixedInputHandling"] }))}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      <option value="transliterate_to_native">Reply in native script</option>
                      <option value="answer_as_written">Mirror the customer&apos;s script</option>
                      <option value="ask_preference">Ask once which script to use</option>
                    </select>
                  </Field>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-fg">Auto-detect language</p>
                      <p className="text-xs text-muted">Otherwise always treat the customer as writing in the default language above.</p>
                    </div>
                    <Toggle checked={Boolean(languageConfig.autoDetect)} onChange={(next) => setLanguageConfig((prev) => ({ ...prev, autoDetect: next }))} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-fg">Always answer in the customer&apos;s language</p>
                      <p className="text-xs text-muted">Overrides the default language whenever they differ.</p>
                    </div>
                    <Toggle checked={Boolean(languageConfig.alwaysAnswerInCustomerLanguage)} onChange={(next) => setLanguageConfig((prev) => ({ ...prev, alwaysAnswerInCustomerLanguage: next }))} />
                  </div>
                </div>
              </Card>
            </div>
          )}

          {tab === "conversation" && (
            <div className="space-y-5">
              <Card className="p-6">
                <SectionHeading icon={Waypoints} title="Scope" subtitle="Prompt-level guidance, not a hard gate — the model can still stray." />
                <div className="mt-4 grid grid-cols-2 gap-6">
                  <ChipListInput
                    id="conversation-in-scope"
                    label="In-scope topics"
                    values={conversationConfig.inScopeTopics ?? []}
                    onChange={(next) => setConversationConfig((prev) => ({ ...prev, inScopeTopics: next }))}
                    placeholder="e.g. billing, order status"
                  />
                  <ChipListInput
                    id="conversation-out-of-scope"
                    label="Out-of-scope topics"
                    values={conversationConfig.outOfScopeTopics ?? []}
                    onChange={(next) => setConversationConfig((prev) => ({ ...prev, outOfScopeTopics: next }))}
                    placeholder="e.g. legal advice"
                  />
                </div>
                <div className="mt-4">
                  <ChipListInput
                    id="conversation-required-slots"
                    label="Required slots (ask for these before proceeding)"
                    values={conversationConfig.requiredSlots ?? []}
                    onChange={(next) => setConversationConfig((prev) => ({ ...prev, requiredSlots: next }))}
                    placeholder="e.g. order number"
                  />
                </div>
              </Card>

              <Card className="p-6">
                <SectionHeading icon={Waypoints} title="Memory" />
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Field label="Scope" htmlFor="conversation-memory-scope">
                    <select
                      id="conversation-memory-scope"
                      value={conversationConfig.memoryScope ?? "full"}
                      onChange={(e) => setConversationConfig((prev) => ({ ...prev, memoryScope: e.target.value as AgentConversationConfig["memoryScope"] }))}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      <option value="full">Full conversation history</option>
                      <option value="recent">Recent turns only</option>
                    </select>
                  </Field>
                  {conversationConfig.memoryScope === "recent" && (
                    <Field label="Turn limit" htmlFor="conversation-recent-limit">
                      <Input id="conversation-recent-limit" type="number" min={1} value={recentTurnLimit} onChange={(e) => setRecentTurnLimit(e.target.value)} placeholder="20" />
                    </Field>
                  )}
                </div>
              </Card>

              <Card className="p-6">
                <SectionHeading icon={Waypoints} title="Custom variables" subtitle="Usable in the prompt as {{KEY}}, alongside the built-in TENANT_NAME/AGENT_NAME/TODAY." />
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(conversationConfig.variables ?? {}).map(([k, v]) => (
                    <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-medium text-fg">
                      <span className="font-mono">{`{{${k}}}`}</span> = {v}
                      <button
                        type="button"
                        onClick={() =>
                          setConversationConfig((prev) => {
                            const next = { ...(prev.variables ?? {}) };
                            delete next[k];
                            return { ...prev, variables: next };
                          })
                        }
                        aria-label="Remove"
                        className="text-muted hover:text-danger"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input value={newVariableKey} onChange={(e) => setNewVariableKey(e.target.value)} placeholder="KEY" className="w-32 font-mono text-xs" />
                  <Input value={newVariableValue} onChange={(e) => setNewVariableValue(e.target.value)} placeholder="value" className="w-48" />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!newVariableKey.trim() || !newVariableValue.trim()}
                    onClick={() => {
                      setConversationConfig((prev) => ({ ...prev, variables: { ...(prev.variables ?? {}), [newVariableKey.trim()]: newVariableValue.trim() } }));
                      setNewVariableKey("");
                      setNewVariableValue("");
                    }}
                  >
                    Add
                  </Button>
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

          {tab === "escalation" && (
            <div className="space-y-5">
              <Card className="p-6">
                <SectionHeading icon={AlertTriangle} title="Trigger keywords" subtitle="Appended to this agent's built-in scanner lists — never replaces them." />
                <div className="mt-4 grid grid-cols-2 gap-6">
                  <ChipListInput
                    id="escalation-human-request"
                    label="Human-request keywords"
                    values={escalationConfig.humanRequestKeywords ?? []}
                    onChange={(next) => setEscalationConfig((prev) => ({ ...prev, humanRequestKeywords: next }))}
                    placeholder="e.g. talk to your manager"
                  />
                  <ChipListInput
                    id="escalation-negative-sentiment"
                    label="Negative-sentiment keywords"
                    values={escalationConfig.negativeSentimentKeywords ?? []}
                    onChange={(next) => setEscalationConfig((prev) => ({ ...prev, negativeSentimentKeywords: next }))}
                    placeholder="e.g. taking my business elsewhere"
                  />
                  <ChipListInput
                    id="escalation-severe-symptom"
                    label="Severe-symptom keywords"
                    values={escalationConfig.severeSymptomKeywords ?? []}
                    onChange={(next) => setEscalationConfig((prev) => ({ ...prev, severeSymptomKeywords: next }))}
                    placeholder="e.g. anaphylaxis"
                  />
                  <ChipListInput
                    id="escalation-reaction"
                    label="Reaction-mention keywords"
                    values={escalationConfig.reactionKeywords ?? []}
                    onChange={(next) => setEscalationConfig((prev) => ({ ...prev, reactionKeywords: next }))}
                    placeholder="e.g. flare-up"
                  />
                </div>
              </Card>

              <Card className="p-6">
                <SectionHeading icon={AlertTriangle} title="Thresholds" />
                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-fg">Escalate on low KB confidence</p>
                    <p className="text-xs text-muted">Off by default — a low-confidence retrieval only gets flagged for later review, doesn&apos;t hand off immediately.</p>
                  </div>
                  <Toggle checked={Boolean(escalationConfig.escalateOnLowConfidence)} onChange={(next) => setEscalationConfig((prev) => ({ ...prev, escalateOnLowConfidence: next }))} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <Field label="Confidence threshold" htmlFor="escalation-confidence-threshold">
                    <Input id="escalation-confidence-threshold" type="number" min={0} max={1} step={0.01} value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(e.target.value)} placeholder="default" />
                  </Field>
                  <Field label="N failed attempts" htmlFor="escalation-n-failed">
                    <Input id="escalation-n-failed" type="number" min={1} value={nFailedAttempts} onChange={(e) => setNFailedAttempts(e.target.value)} placeholder="Off" />
                  </Field>
                  <Field label="Turn-count cap" htmlFor="escalation-turn-cap">
                    <Input id="escalation-turn-cap" type="number" min={1} value={turnCountCap} onChange={(e) => setTurnCountCap(e.target.value)} placeholder="60" />
                  </Field>
                </div>
              </Card>
            </div>
          )}

          {tab === "guardrails" && (
            <div className="space-y-5">
              <Card className="p-6">
                <SectionHeading icon={Shield} title="Input" subtitle="Checked before the model is called." />
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-fg">Prompt-injection screening</p>
                    <Toggle checked={guardrails.input?.promptInjectionScreening !== false} onChange={(next) => updateGuardrailInput({ promptInjectionScreening: next })} />
                  </div>
                  <ChipListInput
                    id="guardrail-blocked-topics"
                    label="Blocked topics"
                    values={guardrails.input?.blockedTopics ?? []}
                    onChange={(next) => updateGuardrailInput({ blockedTopics: next })}
                    placeholder="e.g. legal advice"
                  />
                  <ChipListInput
                    id="guardrail-competitor-names"
                    label="Competitor names"
                    values={guardrails.input?.competitorNames ?? []}
                    onChange={(next) => updateGuardrailInput({ competitorNames: next })}
                    placeholder="e.g. Acme Corp"
                  />
                </div>
              </Card>

              <Card className="p-6">
                <SectionHeading icon={Shield} title="Output" subtitle="Checked once the model has a final reply." />
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-fg">Groundedness check</p>
                    <Toggle checked={guardrails.output?.groundednessCheck !== false} onChange={(next) => updateGuardrailOutput({ groundednessCheck: next })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-fg">Forbidden-claims check</p>
                    <Toggle checked={guardrails.output?.forbiddenClaimsCheck !== false} onChange={(next) => updateGuardrailOutput({ forbiddenClaimsCheck: next })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-fg">Profanity check</p>
                    <Toggle checked={guardrails.output?.profanityCheck !== false} onChange={(next) => updateGuardrailOutput({ profanityCheck: next })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-fg">Buffer the full reply before sending (blockingMode)</p>
                    <Toggle checked={Boolean(guardrails.output?.blockingMode)} onChange={(next) => updateGuardrailOutput({ blockingMode: next })} />
                  </div>
                  <Field label="PII handling" htmlFor="guardrail-pii-mode">
                    <select
                      id="guardrail-pii-mode"
                      value={guardrails.output?.piiMode ?? "block"}
                      onChange={(e) => updateGuardrailOutput({ piiMode: e.target.value as "block" | "redact" })}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                    >
                      <option value="block">Block the reply</option>
                      <option value="redact">Redact and send</option>
                    </select>
                    <p className="mt-1.5 text-xs text-muted">Redact only takes effect with &quot;buffer the full reply&quot; on above — a streamed reply has already reached the customer by the time PII is detected.</p>
                  </Field>
                  <Field label="AI disclosure message" htmlFor="guardrail-ai-disclosure">
                    <Input
                      id="guardrail-ai-disclosure"
                      value={guardrails.output?.aiDisclosureMessage ?? ""}
                      onChange={(e) => updateGuardrailOutput({ aiDisclosureMessage: e.target.value })}
                      placeholder="e.g. You're chatting with an AI assistant."
                    />
                    <p className="mt-1.5 text-xs text-muted">Prepended to this agent&apos;s first reply in every new conversation.</p>
                  </Field>
                </div>
              </Card>

              <details className="rounded-xl border border-border bg-surface p-4">
                <summary className="cursor-pointer text-xs font-medium text-muted">Advanced (raw JSON)</summary>
                <textarea value={guardrailsJson} onChange={(e) => setGuardrailsJson(e.target.value)} rows={6} className={`mt-3 ${textareaClass} font-mono text-xs`} />
              </details>
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
                <SectionHeading icon={Sparkles} title="Skills" />
                <div className="mt-4">
                  <Field label="Skills (comma-separated)" htmlFor="agent-skills">
                    <Input id="agent-skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
                  </Field>
                  <p className="mt-1.5 text-xs text-muted">Guardrails moved to their own tab.</p>
                </div>
              </Card>
            </div>
          )}

          {mode === "edit" && (
            <div>
              <Label htmlFor="agent-change-notes">Change notes (optional)</Label>
              <Input id="agent-change-notes" value={changeNotes} onChange={(e) => setChangeNotes(e.target.value)} placeholder="What changed in this version, and why" className="mt-1.5" />
            </div>
          )}

          {pendingApprovalMessage && <p className="text-sm text-warning">{pendingApprovalMessage}</p>}
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
