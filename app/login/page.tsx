"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Input";

// DA-05: only ever redirect somewhere inside this app — a `next` value from
// the URL is untrusted input, and "//evil.com" or "https://evil.com" both
// parse as a valid relative-looking href a browser will happily follow.
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/desk";
  return raw;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

// useSearchParams needs a Suspense boundary above it (Next.js requirement
// for a client page that reads the URL) — split out so LoginPage can provide
// one without changing anything else about this page's shape.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Login failed");
      setSubmitting(false);
      return;
    }

    router.push(safeNextPath(searchParams.get("next")));
    router.refresh();
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center px-6 py-16"
      style={{ background: "radial-gradient(circle at 50% 0%, var(--color-accent-soft), var(--color-bg) 55%)" }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg shadow-sm">CX</div>
          <span className="text-lg font-semibold tracking-tight text-fg">CX Platform</span>
        </div>

        <Card className="p-8">
          <h1 className="text-xl font-semibold text-fg">Staff sign in</h1>
          <p className="mt-1 text-sm text-muted">Human desk access — seeded accounts only, no self-serve signup.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>

            {error && <p className="text-sm text-danger">{error}</p>}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>

            <a href="/forgot-password" className="block text-center text-sm text-muted hover:text-fg">
              Forgot your password?
            </a>
          </form>
        </Card>
      </div>
    </main>
  );
}
