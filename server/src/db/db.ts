import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { defaultDueDate } from '@apos/shared';
import { MIGRATIONS } from './schema.js';

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  backfillDueDates(db);
  return db;
}

/** פרויקט פעיל בלי תאריך יעד מקבל 7 ימי עסקים מכניסת הפרויקט (מסומן כמילוי אוטומטי) */
function backfillDueDates(db: DB) {
  const rows = db.prepare('SELECT id, brief, created_at FROM projects WHERE delivered_at IS NULL').all() as Array<{ id: string; brief: string; created_at: string }>;
  const upd = db.prepare('UPDATE projects SET brief = ? WHERE id = ?');
  for (const r of rows) {
    const b = parse<Record<string, unknown> | null>(r.brief, null);
    if (!b || (typeof b.dueDate === 'string' && b.dueDate.trim())) continue;
    const aiFilled = Array.isArray(b.aiFilled) ? (b.aiFilled as string[]) : [];
    upd.run(json({ ...b, dueDate: defaultDueDate(r.created_at), aiFilled: [...new Set([...aiFilled, 'dueDate'])] }), r.id);
  }
}

function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1);
    });
  }
}

let depth = 0;
/** טרנזקציה סינכרונית (תומכת בקינון ע"י SAVEPOINT). */
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
