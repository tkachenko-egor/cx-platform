# Changelog

## 2026-08-25 — Remove the router agent; separate platform owner from demo tenants

Follow-up to the teardown-report pass below, from direct user feedback:
the leftover skincare-flavored content the user meant to have gone from
"remove Amarelle/Nimbus" turned out to be stale local dev-DB seed data
(fixed by a reseed), not code; the rest was two real architecture changes.

- **Router agent removed.** `src/agents/router.ts` (a separate `agent_defs`
  row that ran a forced-tool-choice classification turn before the pinned
  agent ever ran) is gone. Routing is now fully bot-level: a conversation
  always starts on its pinned/default agent, which hands off via its own
  `handoffTargets` + `handoff_to_agent` tool — the exact same mechanism a
  mid-conversation handoff already used — instead of a separate tenant-wide
  dispatcher. One mechanism instead of two. `ROUTER_AGENT_KEY`,
  `runRouterTurn`, `buildRouterPrompt`, and the `router_low_confidence`
  escalation reason are all gone; `src/channel/turn.ts`'s entry-turn
  bookkeeping now runs unconditionally (previously skipped for the plain
  default-agent case) and merges into `conversations.tags` via `addTags`
  rather than `setTags`, so it can't stomp the auto-tag scan that runs
  earlier in the same turn.
- **"Routing" admin tab removed.** The tenant-wide handoff-graph page
  (`/admin/agents/flow`, `FlowCanvas`) is gone — editing which agents a
  given agent hands off to is now a "Hands off to" card inside that
  agent's own editor (Tools & skills tab), consistent with routing being a
  bot-level concern, not a tenant-level one. Still warns (via
  `src/agents/flow-graph.ts`'s existing cycle detector) when a toggle would
  create a handoff cycle.
- **Platform owner separated from demo tenants.** The platform owner
  (`is_platform_admin`) now lives in its own reserved "platform" tenant
  (slug `platform`, already excluded from ordinary tenant resolution by
  `src/platform/reserved-subdomains.ts`), never inside a demo/mock tenant —
  migration `029_platform_owner_tenant` backfills any existing
  platform-admin users into it. The platform tenant is excluded from the
  platform-admin "Companies" list. Since ordinary sessions are strictly
  tenant-scoped, `scripts/seed.ts` now seeds two distinct accounts: the
  platform owner (`SEED_OWNER_EMAIL`, for `/platform-admin`) and a separate
  fixture-tenant owner (`SEED_TENANT_OWNER_EMAIL`, for that tenant's own
  `/admin`) — without the second one, a freshly seeded DB would have no way
  to log into the demo tenant's admin panel at all.
- **Local dev DB reseeded** — dropped the stale `cx-platform.db` (still
  carrying skincare-vocabulary content and duplicate rows from pre-teardown
  seed runs) and reseeded clean.

## 2026-08-25 — Teardown report fixes

Source: an Opus 5 usability/architecture teardown of the platform (35
findings: 5 P0, 4 P1, 26 P2), built by playing a first-time admin end to
end — persona, KB, no-code tool, deployed widget. Every P0 root cause was
verified against the actual code before fixing, not just against the
report's description; several turned out smaller/more contained than the
report implied, one (AB-08) was already fixed, and one (WE-02) was
already fixed.

### P0 — blocking

- **Widget/router hijack.** A conversation created with an explicit,
  non-default pinned agent (a widget's `widget_configs.agent_key`) was
  still unconditionally rerouted by the tenant's `router` agent on turn
  1 whenever one was published, overriding the pin and answering with
  whatever the router itself decided — in this tenant, its stub model.
  A newly built agent's widget silently never received a real message,
  and its analytics stayed at zero while every run got attributed to
  `router` instead. Fixed in `src/channel/turn.ts`; verified live end
  to end (real, KB-grounded reply; correct run-count attribution).
- **KB fail-open.** An agent with every Knowledge Base deliberately
  deselected (`collectionIds: []`) fell back to the legacy audience
  filter and retrieved from every KB tenant-wide instead of nothing.
  Fixed in `src/kb/retrieval.ts` — a present-but-empty `collectionIds`
  now means "no access," distinct from an absent one (which still
  serves already-published pre-Phase-5 agents via the legacy path).
- **Silent stub model.** Agents list now shows a red **STUB** badge on
  any agent running the zero-network dev/test model, which previously
  rendered identically to a real model with no indication it echoes
  input instead of calling an LLM.
- **Orphaned routing editor.** Added "Routing" to the admin sidebar —
  the handoff-target editor (`FlowCanvas`) already existed at
  `/admin/agents/flow` but had no nav link.
- **Built-in tools hardcoded to skincare vocabulary** (`RD-05`) — left
  as-is per explicit direction; the registry mechanics themselves are
  generic (a second tenant can add HTTP tools via DB rows with zero
  code changes), so this is a positioning question, not a bug.

### P1 — serious

- Widget quick-replies no longer leak a skincare-specific fallback chip
  ("My skin reacted to a product") onto every other tenant's
  unconfigured agent.
- HTTP tool output-field mapping now warns loudly in the tool-builder
  test UI when a configured path resolves to nothing, instead of
  silently handing back `data: {}` with `ok: true`; the field's
  placeholder/help text no longer teaches the wrong root (paths
  resolve against the raw response body, not `data.…`).
- Agent publish: the Lifecycle status badge now updates immediately
  after a successful publish instead of staying stuck on "draft" until
  a manual reload.
- Human desk conversation list now shows a message preview, sender
  identity where known (email `from`, or "Anonymous visitor" for
  widget), a shortened id, and a search box, and sorts SLA-breaching
  conversations first — previously every row was just a raw UUID with
  no way to tell what it was about without opening it.

### P2 — polish

- KB import: an article's title now falls back to the body's first
  `# heading` before the raw filename when there's no frontmatter
  title.
- KB article list shows indexed chunk count (or a "not indexed"
  warning) per article.
- KB audience field offers the same suggestion hints in both places
  it's edited (agent-builder modal and the KB admin page).
- Creating a KB lands you in it instead of back on the grid.
- Tool builder: description field is now a multi-line textarea, and a
  timeout (ms) field is exposed in the UI (the config already
  supported it; there was no control for it).
- Test-pane chat renders `**bold**` instead of showing raw asterisks —
  shared `MessageContent` component, so this also fixes it for the
  real customer-facing widget — and auto-scrolls to the newest reply
  like the main chat panel already did.
- Switching an agent from Sandbox to Production now asks for
  confirmation; previously a single unconfirmed click armed every
  write tool for real.
- Widget embed snippet gets a copy button; the live preview now sits
  next to the Appearance controls it reflects instead of below a
  full-width Deploy section.
- A mistyped `/admin/*` URL gets a real 404 page with the sidebar
  intact instead of Next's bare default error page.
- Login honors a `?next=` deep link (carried via an `x-pathname`
  header middleware stamps on every request) instead of always
  dropping you on `/desk` regardless of what page was requested.
- Experiments' traffic-split field normalizes a comma decimal
  separator before parsing, instead of silently sending `NaN` under a
  comma-decimal locale.

### Investigated, intentionally left unchanged

- **Composer Enter-to-send** (`AB-02`) — the handler code is correct;
  repro attempts traced back to browser-automation artifacts, not real
  app behavior.
- **First click after page load swallowed** (`AB-05`) — real symptom,
  confirmed via a genuine hydration-error console log, but it's a
  `next dev`/Turbopack-only hiccup: a production build (`next build &&
  next start`) shows zero hydration errors on the same pages, so it
  never reaches a real customer.
- **"Start from" template/clone grouping** (`AB-08`) and **rotate-key
  confirmation** (`WE-02`) were already fixed in the current code.

### Deferred (closer to small features than one-line fixes)

- A real credential store for no-code HTTP tools (`NC-04`).
- A visual JSON-Schema builder for tool input contracts (`NC-03`).
- Array-element projection in output-field mapping, to cut token cost
  on list-shaped API responses (`NC-02`).
- Multi-file / multi-format (`.txt`, `.docx`, `.html`, `.csv`, URL
  crawl) KB import (`KB-03`).
- A read-only "assembled prompt" view in the agent builder (`AB-09`)
  and a publish confirmation/diff view (`AB-06`).
- Per-agent analytics still mixing in tenant-wide alert numbers
  (`DA-02`), and no transcript viewer for bot-only-contained
  conversations (`DA-03`).

### Verification

All fixes verified against `npm test` (228 passing), `npm run
typecheck`, `npm run lint`, and `npm run eval` (12/12 regression gate),
plus live manual verification in-browser for every P0/P1 and most P2
items — including a side-by-side dev-vs-production-build check for the
hydration finding above.

### Commits

- `11d0194` — Gateway: Claude native `web_search` tool + OpenAI
  Responses stream fixes (pre-existing uncommitted work from before
  this session, reviewed and committed as-is)
- `1ad9476` — Add Nimbus Goods demo tenant content (storefront + KB
  source) (also pre-existing)
- `39623fa` — Fix P0/P1/P2 findings from the platform teardown report
  (this session's work)
