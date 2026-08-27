import pg from "pg";

/**
 * B1: the Postgres engine behind every repository. `SqlDatabase` keeps the
 * `better-sqlite3`-shaped surface B0 left in place — `prepare(sql).get/all/run`
 * and `exec` — so repositories only had to gain `await`, not a rewrite. The
 * one real difference: every method is genuinely async now, and transactions
 * pin a single pooled client for their whole life (`tx()`).
 *
 * `?` placeholders are translated to `$1..$n` at `prepare()` time. The SQL in
 * this codebase never contains a literal `?` and never uses the `?`/`?|`/`?&`
 * jsonb operators (we use `->>`, `@>`, `jsonb_array_elements` instead) — keep
 * it that way or this translation breaks.
 */

// ─── pg type coercion, set once ──────────────────────────────────────────────
// better-sqlite3 handed back JS numbers and ISO-8601 strings; match that so no
// call site has to think about driver types.
const { types } = pg;
types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8 / COUNT(*)
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric
const toIso = (v: string | null) => (v === null ? null : new Date(v).toISOString());
types.setTypeParser(1114, toIso); // timestamp
types.setTypeParser(1184, toIso); // timestamptz
types.setTypeParser(1082, (v) => v); // date — keep as 'YYYY-MM-DD'

/**
 * `jsonb` columns come back already parsed from `pg`. This tolerates a raw
 * string too — some tests/seed paths insert a pre-stringified value, and older
 * call sites pass `JSON.stringify(...)` on the way in (harmless: pg casts
 * text→jsonb).
 */
export function fromJson<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

function translate(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${(i += 1)}`);
}

type Queryable = { query: (text: string, values?: unknown[]) => Promise<pg.QueryResult> };

export interface PreparedStatement {
  get<T = unknown>(...params: unknown[]): Promise<T | undefined>;
  all<T = unknown>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<{ changes: number }>;
}

/** The read/write surface shared by `SqlDatabase` and a pinned transaction client. */
export interface SqlExecutor {
  prepare(sql: string): PreparedStatement;
  exec(sql: string): Promise<void>;
}

/** What a bootstrap function (migrations) gets — the un-gated executor + tx. */
export interface BootstrapContext extends SqlExecutor {
  tx<T>(fn: (q: SqlExecutor) => Promise<T>): Promise<T>;
}

function makeExecutor(src: Queryable): SqlExecutor {
  return {
    prepare(sql: string): PreparedStatement {
      const text = translate(sql);
      return {
        async get<T>(...params: unknown[]): Promise<T | undefined> {
          const res = await src.query(text, params);
          return res.rows[0] as T | undefined;
        },
        async all<T>(...params: unknown[]): Promise<T[]> {
          const res = await src.query(text, params);
          return res.rows as T[];
        },
        async run(...params: unknown[]): Promise<{ changes: number }> {
          const res = await src.query(text, params);
          return { changes: res.rowCount ?? 0 };
        },
      };
    },
    async exec(sql: string): Promise<void> {
      await src.query(sql);
    },
  };
}

export class SqlDatabase implements SqlExecutor {
  #pool: pg.Pool;
  #raw: SqlExecutor;
  #gate: Promise<void> = Promise.resolve();
  /** B5: when set, every query/tx from this handle runs inside a transaction that first issues `set_config('app.tenant_id', …)`, so the row-level-security policies enforce tenant isolation as a backstop behind the repository WHERE clauses. Set via `forTenant()`; the root handle leaves it undefined (unscoped — migrations, seed, `TenantRepository`, the platform-admin lookup). */
  #tenantId?: string;

  constructor(pool: pg.Pool, tenantId?: string) {
    this.#pool = pool;
    this.#raw = makeExecutor(pool);
    this.#tenantId = tenantId;
    // A pooled client dropped while idle (server restart, disposable test DB
    // torn down) emits here; without a listener pg crashes the process. One
    // listener per pool is enough — `forTenant()` handles share the pool.
    if (pool.listenerCount("error") === 0) pool.on("error", () => {});
  }

  /**
   * B5: a handle onto the same pool that scopes every query to `tenantId` via
   * an `app.tenant_id` GUC + the RLS policies from migration 003. Repository
   * base class calls this in its constructor; callers keep passing the root
   * (unscoped) handle. Same-tenant re-scoping is a no-op.
   */
  forTenant(tenantId: string): SqlDatabase {
    if (this.#tenantId === tenantId) return this;
    const scoped = new SqlDatabase(this.#pool, tenantId);
    scoped.#gate = this.#gate;
    return scoped;
  }

  /** Runs `fn` against the un-gated engine and makes every later call wait for
   *  it. Used by client.ts to run migrations before the first repository query. */
  bootstrap(fn: (ctx: BootstrapContext) => Promise<void>): this {
    const ctx: BootstrapContext = { ...this.#raw, tx: (f) => this.#txRaw(f) };
    this.#gate = fn(ctx);
    return this;
  }

  /**
   * B5: `fn` runs in a tx that first drops to the non-superuser `cx_tenant`
   * role and sets the `app.tenant_id` GUC, so the RLS policies from migration
   * 003 enforce tenant isolation. Both are `SET LOCAL` — they unwind at
   * COMMIT/ROLLBACK, so the pooled client is clean for the next borrower.
   */
  async #txScoped<T>(fn: (q: SqlExecutor) => Promise<T>): Promise<T> {
    await this.#gate;
    const tenantId = this.#tenantId!;
    return this.#txRaw(async (q) => {
      await q.exec(`SET LOCAL ROLE cx_tenant`);
      await q.prepare(`SELECT set_config('app.tenant_id', ?, true)`).run(tenantId);
      return fn(q);
    });
  }

  async #txRaw<T>(fn: (q: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(makeExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.#raw.prepare(sql);
    const gate = this.#gate;
    if (this.#tenantId !== undefined) {
      return {
        get: <T>(...p: unknown[]) => this.#txScoped((q) => q.prepare(sql).get<T>(...p)),
        all: <T>(...p: unknown[]) => this.#txScoped((q) => q.prepare(sql).all<T>(...p)),
        run: (...p: unknown[]) => this.#txScoped((q) => q.prepare(sql).run(...p)),
      };
    }
    return {
      async get<T>(...p: unknown[]) {
        await gate;
        return stmt.get<T>(...p);
      },
      async all<T>(...p: unknown[]) {
        await gate;
        return stmt.all<T>(...p);
      },
      async run(...p: unknown[]) {
        await gate;
        return stmt.run(...p);
      },
    };
  }

  async exec(sql: string): Promise<void> {
    if (this.#tenantId !== undefined) {
      await this.#txScoped((q) => q.exec(sql));
      return;
    }
    await this.#gate;
    await this.#raw.exec(sql);
  }

  /** Runs `fn` inside a single pinned client + BEGIN/COMMIT. Every statement in
   *  `fn` must go through the passed executor, not `this`. On a `forTenant()`
   *  handle the transaction also carries the `app.tenant_id` GUC. */
  async tx<T>(fn: (q: SqlExecutor) => Promise<T>): Promise<T> {
    if (this.#tenantId !== undefined) return this.#txScoped(fn);
    await this.#gate;
    return this.#txRaw(fn);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export { pg };
