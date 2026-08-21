"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ApprovalPolicy = "auto" | "confirm_with_customer" | "require_human_approval";
const APPROVAL_POLICIES: ApprovalPolicy[] = ["auto", "confirm_with_customer", "require_human_approval"];

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

type ArgsLocation = "body" | "query";
type AuthStyle = "bearer" | "header" | "query_param" | "none";
const AUTH_STYLES: AuthStyle[] = ["none", "bearer", "header", "query_param"];

export interface ToolRow {
  key: string;
  description: string;
  inputSchema: Record<string, unknown>;
  writeFlag: boolean;
  approvalPolicy: ApprovalPolicy;
  type: "code" | "http";
  handlerConfig: Record<string, unknown>;
}

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

export function ToolsManagement({ tools, toolCredentials }: { tools: ToolRow[]; toolCredentials: ToolCredentialOption[] }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [inputSchemaJson, setInputSchemaJson] = useState(DEFAULT_INPUT_SCHEMA);
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<HttpMethod>("POST");
  const [argsLocation, setArgsLocation] = useState<ArgsLocation>("body");
  const [credentialId, setCredentialId] = useState("");
  const [authStyle, setAuthStyle] = useState<AuthStyle>("none");
  const [authParamName, setAuthParamName] = useState("");
  const [writeFlag, setWriteFlag] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("auto");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const createTool = async () => {
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
          key,
          description,
          inputSchema,
          writeFlag,
          approvalPolicy,
          handlerConfig: {
            url,
            method,
            argsLocation,
            credentialId: credentialId || null,
            authStyle,
            authParamName: authParamName || null,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create tool");
      setKey("");
      setDescription("");
      setUrl("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteTool = async (toolKey: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tools/${toolKey}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete tool");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-fg">New HTTP tool</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Key</span>
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. check_shipping_status" className="rounded border border-border bg-bg px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Description (shown to the model)</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="rounded border border-border bg-bg px-2 py-1" />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs text-muted">URL</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/status" className="rounded border border-border bg-bg px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} className="rounded border border-border bg-bg px-2 py-1">
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Arguments go in</span>
            <select value={argsLocation} onChange={(e) => setArgsLocation(e.target.value as ArgsLocation)} className="rounded border border-border bg-bg px-2 py-1">
              <option value="body">JSON body</option>
              <option value="query">Query string</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Credential</span>
            <select value={credentialId} onChange={(e) => setCredentialId(e.target.value)} className="rounded border border-border bg-bg px-2 py-1">
              <option value="">None</option>
              {toolCredentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.provider})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Auth style</span>
            <select value={authStyle} onChange={(e) => setAuthStyle(e.target.value as AuthStyle)} className="rounded border border-border bg-bg px-2 py-1">
              {AUTH_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {(authStyle === "header" || authStyle === "query_param") && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">{authStyle === "header" ? "Header name" : "Query param name"}</span>
              <input value={authParamName} onChange={(e) => setAuthParamName(e.target.value)} className="rounded border border-border bg-bg px-2 py-1" />
            </label>
          )}
          {authStyle === "query_param" && <p className="col-span-2 text-xs text-danger">The key will be sent in the URL — more exposure-prone (e.g. server logs) than a header. Use only if the API requires it.</p>}
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs text-muted">Input schema (JSON Schema — loosely validated: required keys + type)</span>
            <textarea
              value={inputSchemaJson}
              onChange={(e) => setInputSchemaJson(e.target.value)}
              rows={5}
              className="rounded border border-border bg-bg px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-fg">
            <input type="checkbox" checked={writeFlag} onChange={(e) => setWriteFlag(e.target.checked)} />
            Write tool (mutates something)
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Approval policy</span>
            <select value={approvalPolicy} onChange={(e) => setApprovalPolicy(e.target.value as ApprovalPolicy)} className="rounded border border-border bg-bg px-2 py-1">
              {APPROVAL_POLICIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" disabled={busy || !key || !description || !url} onClick={createTool} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50">
          Create tool
        </button>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted">Tools</h2>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
          {tools.map((tool) => (
            <li key={tool.key} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-fg">
                  {tool.key} <span className="text-xs text-muted">({tool.type})</span> {tool.writeFlag && <span className="text-xs text-muted">· write · {tool.approvalPolicy}</span>}
                </p>
                <p className="text-xs text-muted">{tool.description}</p>
              </div>
              {tool.type === "http" && (
                <button type="button" disabled={busy} onClick={() => deleteTool(tool.key)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg disabled:opacity-50">
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
