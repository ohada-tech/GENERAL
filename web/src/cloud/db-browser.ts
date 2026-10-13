/**
 * תחליף דפדפני ל-server/src/db/db.ts: אותו API (prepare().get/all/run, exec, tx)
 * מעל sql.js (SQLite שקומפל ל-JS). כך כל לוגיקת ה-workflow של השרת רצה כמו שהיא.
 */
import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js';
import type { Database, SqlValue } from 'sql.js';
import { MIGRATIONS } from '../../../server/src/db/schema';

type Param = SqlValue | boolean | undefined;
const norm = (params: Param[]): SqlValue[] =>
  params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

const TX_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

export class BrowserDB {
  constructor(
    readonly raw: Database,
    private readonly onWrite: () => void,
  ) {}

  exec(sql: string) {
    this.raw.exec(sql);
    if (!TX_CONTROL.test(sql)) this.onWrite();
  }

  prepare(sql: string) {
    const raw = this.raw;
    const withStmt = <T>(params: Param[], fn: (s: ReturnType<Database['prepare']>) => T): T => {
      const stmt = raw.prepare(sql);
      try {
        if (params.length) stmt.bind(norm(params));
        return fn(stmt);
      } finally {
        stmt.free();
      }
    };
    return {
      get: (...params: Param[]) => withStmt(params, (s) => (s.step() ? s.getAsObject() : undefined)),
      all: (...params: Param[]) =>
        withStmt(params, (s) => {
          const rows: Record<string, SqlValue>[] = [];
          while (s.step()) rows.push(s.getAsObject());
          return rows;
        }),
      run: (...params: Param[]) => {
        withStmt(params, (s) => s.step());
        const changes = raw.getRowsModified();
        if (changes > 0) this.onWrite();
        return { changes, lastInsertRowid: 0 };
      },
    };
  }

  export() {
    return this.raw.export();
  }

  close() {
    this.raw.close();
  }
}

export type DB = BrowserDB;

export async function openBrowserDb(bytes: Uint8Array | null, onWrite: () => void): Promise<DB> {
  const SQL = await initSqlJs();
  const db = new BrowserDB(new SQL.Database(bytes ?? undefined), onWrite);
  db.raw.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

/** קיים רק כדי לשמור על חתימת המודול המקורי — בענן פותחים עם openBrowserDb. */
export function openDb(): DB {
  throw new Error('openDb לא זמין בדפדפן — השתמש ב-openBrowserDb');
}

function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null } | undefined;
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1);
    });
  }
}

let depth = 0;
export function tx<T>(db: DB, fn: () => T): T {
  const sp = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const out = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return out;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const json = (v: unknown) => JSON.stringify(v ?? null);
export const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
