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

  constructor(pool: pg.Pool) {
    this.#pool = pool;
    this.#raw = makeExecutor(pool);
    // A pooled client dropped while idle (server restart, disposable test DB
    // torn down) emits here; without a listener pg crashes the process.
    pool.on("error", () => {});
  }

  /** Runs `fn` against the un-gated engine and makes every later call wait for
   *  it. Used by client.ts to run migrations before the first repository query. */
  bootstrap(fn: (ctx: BootstrapContext) => Promise<void>): this {
    const ctx: BootstrapContext = { ...this.#raw, tx: (f) => this.#txRaw(f) };
    this.#gate = fn(ctx);
    return this;
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
    await this.#gate;
    await this.#raw.exec(sql);
  }

  /** Runs `fn` inside a single pinned client + BEGIN/COMMIT. Every statement in
   *  `fn` must go through the passed executor, not `this`. */
  async tx<T>(fn: (q: SqlExecutor) => Promise<T>): Promise<T> {
    await this.#gate;
    return this.#txRaw(fn);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export { pg };
