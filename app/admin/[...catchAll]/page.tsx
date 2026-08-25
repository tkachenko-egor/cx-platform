import Link from "next/link";

/**
 * DA-04: app/admin/not-found.tsx only fires for an explicit notFound() call
 * or an unresolved dynamic segment — a URL that matches no route at all
 * under /admin/* (e.g. /admin/knowledge, a reasonable guess for /admin/kb)
 * never enters that layout's tree, so it fell through to the root's bare
 * "404 This page could not be found." with no shell or nav. A catch-all
 * route is the only way to keep app/admin/layout.tsx's sidebar for those.
 */
export default function AdminCatchAll() {
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
