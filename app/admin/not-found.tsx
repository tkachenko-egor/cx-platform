import Link from "next/link";

/**
 * DA-04: a mistyped admin URL (e.g. /admin/knowledge instead of /admin/kb)
 * used to fall through to Next's default black error page — no shell, no
 * nav, nothing but the back button. This segment-level not-found.tsx is
 * still wrapped by app/admin/layout.tsx, so the sidebar stays put and
 * there's an actual way forward.
 */
export default function AdminNotFound() {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-start px-6 py-16">
      <h1 className="text-2xl font-semibold text-fg">Page not found</h1>
      <p className="mt-2 text-sm text-muted">There&apos;s no admin page at this address. Double-check the URL, or head back to a page that exists.</p>
      <Link href="/admin/agents" className="mt-6 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90">
        Go to Agents
      </Link>
    </main>
  );
}
