"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";

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

const selectClass = "rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";

export function ToolCreateForm({ toolCredentials }: { toolCredentials: ToolCredentialOption[] }) {
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
      router.push("/admin/tools");
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
        <Field label="Key" htmlFor="tool-key">
          <Input id="tool-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. check_shipping_status" className="font-mono text-xs" />
        </Field>
        <Field label="Description (shown to the model)" htmlFor="tool-description">
          <Input id="tool-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
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
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button disabled={busy || !key || !description || !url} onClick={create}>
          {busy ? "Creating…" : "Create tool"}
        </Button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Card>
  );
}
