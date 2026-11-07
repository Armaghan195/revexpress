/**
 * One query interface over two Postgres implementations.
 *
 * Production sets DATABASE_URL and gets node-postgres against the real server.
 * With no DATABASE_URL the app runs PGlite, an embedded Postgres compiled to
 * WASM, storing to .pgdata/. That means `npm run dev` and the test suite work
 * on a clean machine with nothing installed, while running the same SQL dialect
 * that production will run.
 */
import fs from 'node:fs';
import path from 'node:path';

const NEWLINE = String.fromCharCode(10);

export type Row = Record<string, any>;
export interface QueryResult<T = Row> {
  rows: T[];
  rowCount: number;
}

interface Driver {
  query<T = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

let driverPromise: Promise<Driver> | null = null;

// Next.js reloads modules on edit; without this the dev server would open a new
// database handle on every save and eventually exhaust connections.
const globalStore = globalThis as unknown as { __rxDriver?: Promise<Driver> };

async function createPostgresDriver(connectionString: string): Promise<Driver> {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString,
    // Managed Postgres (Neon, Supabase, Vercel) terminates TLS at the pooler
    // with a certificate chain Node does not ship, so verification is relaxed
    // for those hosts only. A self-hosted server with a real cert keeps it on.
    ssl: /neon\.tech|supabase|vercel-storage|render\.com/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return {
    async query<T = Row>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params as any[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    },
    async close() {
      await pool.end();
    },
  };
}

/** Read the schema files that define the database, in order. */
function schemaStatements(): string[] {
  const files = ['schema.sql', 'migrations-002.sql']
    .map(name => path.join(process.cwd(), 'db', name))
    .filter(file => fs.existsSync(file));

  return files.flatMap(file =>
    fs
      .readFileSync(file, 'utf8')
      .split(/;\s*$/m)
      .map(chunk =>
        chunk
          .split(NEWLINE)
          .filter(line => !/^\s*--/.test(line))
          .join(NEWLINE)
          .trim(),
      )
      .filter(Boolean),
  );
}

async function createPgliteDriver(): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), '.pgdata');
  fs.mkdirSync(dir, { recursive: true });

  async function open(target: string) {
    const instance = new PGlite(target);
    await instance.waitReady;
    return instance;
  }

  let db;
  try {
    db = await open(dir);
  } catch (err) {
    // PGlite keeps its Postgres data directory inside a WASM filesystem. Killing
    // the process mid-write, or opening the directory from two processes at
    // once, can leave it unopenable — and the raw failure is an unhelpful
    // "Aborted()".
    //
    // There is no in-process repair: the instance that failed to open still
    // holds OS handles on the directory, so this process cannot even move it
    // aside. Recovery has to happen from a different process, so say exactly
    // what to run rather than failing with something cryptic.
    // Production sets DATABASE_URL, uses real Postgres, and never reaches this.
    throw new Error(
      [
        'The embedded development database could not be opened.',
        '',
        '  ' + dir,
        '',
        'This happens when the process was killed mid-write, or when two',
        'processes opened it at once (it allows a single writer). Only local',
        'demo data is affected. To start over:',
        '',
        '  1. stop the dev server and any db: script',
        '  2. rename or delete the .pgdata directory',
        '  3. npm run db:migrate && npm run db:seed',
        '',
        'Original error: ' + (err instanceof Error ? err.message : String(err)),
      ].join(NEWLINE),
    );
  }

  return {
    async query<T = Row>(sql: string, params: unknown[] = []) {
      const res = await db.query(sql, params as any[]);
      // For INSERT/UPDATE/DELETE there are no rows: the count lives in
      // affectedRows, and reporting rows.length there made every write look
      // like it had changed nothing.
      const affected = (res as { affectedRows?: number }).affectedRows;
      return {
        rows: (res.rows ?? []) as T[],
        rowCount: res.rows?.length ? res.rows.length : affected ?? 0,
      };
    },
    async close() {
      await db.close();
    },
  };
}

function getDriver(): Promise<Driver> {
  if (globalStore.__rxDriver) return globalStore.__rxDriver;
  const url = process.env.DATABASE_URL?.trim();
  driverPromise = url ? createPostgresDriver(url) : createPgliteDriver();
  globalStore.__rxDriver = driverPromise;
  return driverPromise;
}

/** Run a parameterised query. Always use $1 placeholders, never interpolation. */
export async function query<T = Row>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
  const driver = await getDriver();
  return driver.query<T>(sql, params);
}

/** First row, or null. */
export async function queryOne<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const { rows } = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function closeDb(): Promise<void> {
  const existing = globalStore.__rxDriver;
  if (!existing) return;
  globalStore.__rxDriver = undefined;
  driverPromise = null;
  (await existing).close().catch(() => {});
}

export function usingEmbeddedDatabase(): boolean {
  return !process.env.DATABASE_URL?.trim();
}

/** Apply the schema. Idempotent: every statement is IF NOT EXISTS or guarded. */
export async function migrate(): Promise<void> {
  for (const statement of schemaStatements()) {
    // A constraint that was never created is not worth stopping a migration for.
    await query(statement).catch(err => {
      if (!/already exists|does not exist/i.test(String(err))) throw err;
    });
  }
}
