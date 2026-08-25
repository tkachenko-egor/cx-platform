"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { slugify } from "../../src/core/slugify";

type ApprovalPolicy = "auto" | "confirm_with_customer" | "require_human_approval";
const APPROVAL_POLICIES: ApprovalPolicy[] = ["auto", "confirm_with_customer", "require_human_approval"];

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

type ArgsLocation = "body" | "query";
type AuthStyle = "bearer" | "header" | "query_param" | "none";
const AUTH_STYLES: AuthStyle[] = ["none", "bearer", "header", "query_param"];

export interface ToolCredentialOption {
  id: string;
  label: string;
  provider: string;
}

const DEFAULT_INPUT_SCHEMA = `{
  "type": "object",
  "properties": {},
  "required": []
}`;

const DEFAULT_SAMPLE_ARGS = `{}`;

interface OutputFieldRow {
  path: string;
  as: string;
}

const selectClass = "rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";

export function ToolCreateForm({ toolCredentials }: { toolCredentials: ToolCredentialOption[] }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [inputSchemaJson, setInputSchemaJson] = useState(DEFAULT_INPUT_SCHEMA);
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<HttpMethod>("POST");
  const [argsLocation, setArgsLocation] = useState<ArgsLocation>("body");
  const [credentialId, setCredentialId] = useState("");
  const [authStyle, setAuthStyle] = useState<AuthStyle>("none");
  const [authParamName, setAuthParamName] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("10000");
  const [writeFlag, setWriteFlag] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("auto");
  const [outputFields, setOutputFields] = useState<OutputFieldRow[]>([]);
  const [fallbackMessage, setFallbackMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sampleArgsJson, setSampleArgsJson] = useState(DEFAULT_SAMPLE_ARGS);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testWarning, setTestWarning] = useState<string[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const handlerConfig = () => ({
    url,
    method,
    argsLocation,
    credentialId: credentialId || null,
    authStyle,
    authParamName: authParamName || null,
    outputFields: outputFields.filter((f) => f.path.trim()).map((f) => ({ path: f.path.trim(), as: f.as.trim() || undefined })),
    fallbackMessage: fallbackMessage.trim() || null,
    timeoutMs: timeoutMs.trim() ? Number(timeoutMs) : undefined,
  });

  const addOutputField = () => setOutputFields((prev) => [...prev, { path: "", as: "" }]);
  const updateOutputField = (index: number, patch: Partial<OutputFieldRow>) => setOutputFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const removeOutputField = (index: number) => setOutputFields((prev) => prev.filter((_, i) => i !== index));

  const runTest = async () => {
    setTestError(null);
    setTestResult(null);
    setTestWarning(null);
    let sampleArgs: Record<string, unknown>;
    try {
      sampleArgs = sampleArgsJson.trim() ? JSON.parse(sampleArgsJson) : {};
    } catch {
      setTestError("Sample args must be valid JSON");
      return;
    }

    setTesting(true);
    try {
      const res = await fetch("/api/admin/tools/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handlerConfig: handlerConfig(), sampleArgs }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Test failed");
      setTestResult(JSON.stringify(body.result, null, 2));
      // NC-01: an output field mapping that didn't resolve against the raw
      // response leaves `data` empty (or missing that key) with `ok: true` —
      // easy to miss. Surface it loudly instead of a silent green result.
      const unresolved = body.result?.unresolvedOutputFields;
      if (Array.isArray(unresolved) && unresolved.length > 0) setTestWarning(unresolved);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const create = async () => {
    setError(null);
    let inputSchema: Record<string, unknown>;
    try {
      inputSchema = JSON.parse(inputSchemaJson);
    } catch {
      setError("Input schema must be valid JSON");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          description,
          inputSchema,
          writeFlag,
          approvalPolicy,
          handlerConfig: handlerConfig(),
        }),
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created.error ?? "Could not create tool");
      setCreatedKey(created.tool?.key ?? slugify(displayName));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="tool-display-name">
          <Input id="tool-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Check Shipping Status" />
        </Field>
        <Field label="Identifier (generated)" htmlFor="tool-key-preview">
          <Input id="tool-key-preview" value={createdKey ?? slugify(displayName)} readOnly disabled className="font-mono text-xs" />
          <p className="mt-1.5 text-xs text-muted">Derived from the name and fixed once the tool exists — renaming it later never changes this.</p>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description (shown to the model — this is the model's entire instruction for when to call it)" htmlFor="tool-description">
            <textarea
              id="tool-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="URL" htmlFor="tool-url">
            <Input id="tool-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/status" />
          </Field>
        </div>
        <Field label="Method" htmlFor="tool-method">
          <select id="tool-method" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} className={selectClass}>
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Arguments go in" htmlFor="tool-args-location">
          <select id="tool-args-location" value={argsLocation} onChange={(e) => setArgsLocation(e.target.value as ArgsLocation)} className={selectClass}>
            <option value="body">JSON body</option>
            <option value="query">Query string</option>
          </select>
        </Field>
        <Field label="Timeout (ms, max 30000)" htmlFor="tool-timeout">
          <Input id="tool-timeout" type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} placeholder="10000" />
        </Field>
        <Field label="Credential" htmlFor="tool-credential">
          <select id="tool-credential" value={credentialId} onChange={(e) => setCredentialId(e.target.value)} className={selectClass}>
            <option value="">None</option>
            {toolCredentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.provider})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Auth style" htmlFor="tool-auth-style">
          <select id="tool-auth-style" value={authStyle} onChange={(e) => setAuthStyle(e.target.value as AuthStyle)} className={selectClass}>
            {AUTH_STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        {(authStyle === "header" || authStyle === "query_param") && (
          <Field label={authStyle === "header" ? "Header name" : "Query param name"} htmlFor="tool-auth-param">
            <Input id="tool-auth-param" value={authParamName} onChange={(e) => setAuthParamName(e.target.value)} />
          </Field>
        )}
        {authStyle === "query_param" && <p className="text-xs text-danger sm:col-span-2">The key will be sent in the URL — more exposure-prone (e.g. server logs) than a header. Use only if the API requires it.</p>}
        <div className="sm:col-span-2">
          <Field label="Input schema (JSON Schema — loosely validated: required keys + type)" htmlFor="tool-input-schema">
            <textarea
              id="tool-input-schema"
              value={inputSchemaJson}
              onChange={(e) => setInputSchemaJson(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={writeFlag} onChange={(e) => setWriteFlag(e.target.checked)} />
          Write tool (mutates something)
        </label>
        <Field label="Approval policy" htmlFor="tool-approval-policy">
          <select id="tool-approval-policy" value={approvalPolicy} onChange={(e) => setApprovalPolicy(e.target.value as ApprovalPolicy)} className={selectClass}>
            {APPROVAL_POLICIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Fallback error message (optional)" htmlFor="tool-fallback-message">
            <Input id="tool-fallback-message" value={fallbackMessage} onChange={(e) => setFallbackMessage(e.target.value)} placeholder="e.g. Shipping lookup is temporarily unavailable — apologize and offer to try again shortly." />
          </Field>
          <p className="mt-1.5 text-xs text-muted">Shown to the model instead of the raw technical error on a failed call. Leave blank to keep today&apos;s raw error message.</p>
        </div>
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-fg">Output field mapping (optional)</span>
            <button type="button" onClick={addOutputField} className="text-xs text-accent hover:underline">
              + Add field
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">
            Blank means the model sees the full response verbatim. Add fields to send only a plucked/renamed subset instead — paths resolve against the raw response body itself (e.g. <code className="font-mono">customer.email</code>, not{" "}
            <code className="font-mono">data.customer.email</code>).
          </p>
          <div className="mt-2 space-y-2">
            {outputFields.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={f.path} onChange={(e) => updateOutputField(i, { path: e.target.value })} placeholder="e.g. customer.email" className="font-mono text-xs" />
                <span className="text-xs text-muted">as</span>
                <Input value={f.as} onChange={(e) => updateOutputField(i, { as: e.target.value })} placeholder="(same name)" className="font-mono text-xs" />
                <button type="button" onClick={() => removeOutputField(i)} className="shrink-0 text-xs text-danger hover:underline">
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border p-4">
        <p className="text-sm font-medium text-fg">Test this configuration</p>
        <p className="mt-1 text-xs text-muted">Runs a real request with the settings above — nothing here gets saved until you click Create tool.</p>
        <div className="mt-3">
          <Field label="Sample arguments (JSON)" htmlFor="tool-sample-args">
            <textarea
              id="tool-sample-args"
              value={sampleArgsJson}
              onChange={(e) => setSampleArgsJson(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button type="button" variant="secondary" disabled={testing || !url} onClick={runTest}>
            {testing ? "Running…" : "Run test"}
          </Button>
          {testError && <p className="text-xs text-danger">{testError}</p>}
        </div>
        {testWarning && (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {testWarning.length === 1 ? `Mapping "${testWarning[0]}" didn't match anything in the response` : `${testWarning.length} mappings didn't match anything in the response: ${testWarning.join(", ")}`} — check the
            path against the raw response below (paths resolve against the response body itself, not <code className="font-mono">data.…</code>).
          </p>
        )}
        {testResult && <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-border bg-bg p-3 text-xs text-fg">{testResult}</pre>}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button disabled={busy || !displayName || !description || !url || Boolean(createdKey)} onClick={create}>
          {busy ? "Creating…" : "Create tool"}
        </Button>
        {createdKey && (
          <p className="text-xs text-muted">
            Created as <code className="font-mono text-fg">{createdKey}</code> —{" "}
            <Link href="/admin/tools" className="text-accent hover:underline">
              back to tools
            </Link>
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Card>
  );
}
