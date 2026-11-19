/**
 * סבבי תיקונים אחרי מסירה ללקוח: הלקוח מחזיר הערות על סרטון שנמסר — נפתח סבב (1, 2, …),
 * ההערות הן רשימה שמסמנים אחת אחת, והפרויקט חוזר להפקה עד שסוגרים את הסבב ומוסרים שוב.
 * כמה סבבים כלולים במחיר — settings.includedRevisionRounds (ברירת מחדל 2); מעבר לזה מסומן כחריגה.
 */
import type { Ctx } from '../context.js';
import { GateError, NotFoundError } from '../context.js';
import { json, tx, uid } from '../db/db.js';
import { getProject } from '../db/repo.js';
import { emit } from '../workflow/events.js';
import { resolveAttention } from './attention.js';

export interface RevisionItem {
  text: string;
  done: boolean;
}

export interface RevisionRound {
  id: string;
  projectId: string;
  number: number;
  items: RevisionItem[];
  source: string;
  openedAt: string;
  closedAt: string | null;
  closeNote: string;
}

export interface RevisionSummary {
  count: number;
  included: number;
  open: { id: string; number: number; total: number; done: number } | null;
}

type Row = { id: string; project_id: string; number: number; items: string; source: string; opened_at: string; closed_at: string | null; close_note: string };
const map = (r: Row): RevisionRound => ({
  id: r.id,
  projectId: r.project_id,
  number: r.number,
  items: JSON.parse(r.items) as RevisionItem[],
  source: r.source,
  openedAt: r.opened_at,
  closedAt: r.closed_at,
  closeNote: r.close_note,
});

export function listRevisions(ctx: Ctx, projectId: string): RevisionRound[] {
  return (ctx.db.prepare('SELECT * FROM revision_rounds WHERE project_id = ? ORDER BY number').all(projectId) as Row[]).map(map);
}

function mustRound(ctx: Ctx, id: string) {
  const r = ctx.db.prepare('SELECT * FROM revision_rounds WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new NotFoundError('סבב תיקונים');
  return map(r);
}

/** "שורה לכל הערה" → פריטים. מוריד מספור ותבליטים בתחילת שורה */
export function parseItems(notes: string): RevisionItem[] {
  return notes
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 60)
    .map((text) => ({ text: text.slice(0, 500), done: false }));
}

export function revisionSummary(ctx: Ctx, projectId: string, included: number): RevisionSummary | null {
  const rounds = listRevisions(ctx, projectId);
  if (!rounds.length) return null;
  const open = rounds.find((r) => !r.closedAt) ?? null;
  return {
    count: rounds.length,
    included,
    open: open ? { id: open.id, number: open.number, total: open.items.length, done: open.items.filter((i) => i.done).length } : null,
  };
}

export function openRevision(ctx: Ctx, projectId: string, input: { notes?: string; source?: string }) {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new NotFoundError('פרויקט');
  const items = parseItems(String(input.notes ?? ''));
  if (!items.length) throw new GateError('כתוב את הערות הלקוח — שורה לכל הערה', 400);
  if (listRevisions(ctx, projectId).some((r) => !r.closedAt)) throw new GateError('יש כבר סבב תיקונים פתוח — הוסף אליו הערות או סגור אותו', 409);
  const number = listRevisions(ctx, projectId).length + 1;
  const at = ctx.now().toISOString();
  const id = uid();
  const source = String(input.source ?? 'הלקוח').slice(0, 40);
  tx(ctx.db, () => {
    ctx.db
      .prepare('INSERT INTO revision_rounds (id, project_id, number, items, source, opened_at, closed_at, close_note) VALUES (?, ?, ?, ?, ?, ?, NULL, \'\')')
      .run(id, projectId, number, json(items), source, at);
    // הפרויקט חוזר להפקה עד שהסבב נסגר
    ctx.db.prepare('UPDATE projects SET delivered_at = NULL, updated_at = ? WHERE id = ?').run(at, projectId);
    const over = number > p.settings.includedRevisionRounds;
    emit(ctx, {
      projectId,
      type: 'project.progress',
      actor: source,
      message: `🔁 נפתח סבב תיקונים ${number}${over ? ` (מעבר ל-${p.settings.includedRevisionRounds} הכלולים)` : ''}: ${items.length} הערות`,
      payload: { revision: number, items: items.length, over },
    });
  });
  return mustRound(ctx, id);
}

export function addRevisionItems(ctx: Ctx, roundId: string, notes: string) {
  const r = mustRound(ctx, roundId);
  if (r.closedAt) throw new GateError('הסבב כבר נסגר', 409);
  const items = [...r.items, ...parseItems(notes)].slice(0, 100);
  ctx.db.prepare('UPDATE revision_rounds SET items = ? WHERE id = ?').run(json(items), roundId);
  return mustRound(ctx, roundId);
}

export function setRevisionItem(ctx: Ctx, roundId: string, index: number, done: boolean) {
  const r = mustRound(ctx, roundId);
  if (!r.items[index]) throw new NotFoundError('הערה');
  r.items[index].done = done;
  ctx.db.prepare('UPDATE revision_rounds SET items = ? WHERE id = ?').run(json(r.items), roundId);
  return mustRound(ctx, roundId);
}

/** סגירת סבב = הגרסה המתוקנת נמסרה. הפרויקט חוזר ל"נמסרו" */
export function closeRevision(ctx: Ctx, roundId: string, note = '') {
  const r = mustRound(ctx, roundId);
  if (r.closedAt) return r;
  const at = ctx.now().toISOString();
  const closeNote = String(note).trim().slice(0, 300);
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE revision_rounds SET closed_at = ?, close_note = ? WHERE id = ?').run(at, closeNote, roundId);
    ctx.db.prepare('UPDATE projects SET delivered_at = ?, updated_at = ? WHERE id = ?').run(at, at, r.projectId);
    resolveAttention(ctx, { projectId: r.projectId });
    const open = r.items.filter((i) => !i.done).length;
    emit(ctx, {
      projectId: r.projectId,
      type: 'project.progress',
      actor: 'אוהד',
      message: `✅ סבב תיקונים ${r.number} נמסר${open ? ` (${open} הערות לא סומנו)` : ''}${closeNote ? `: ${closeNote}` : ''}`,
      payload: { revision: r.number, closed: true, delivered: true },
    });
  });
  return mustRound(ctx, roundId);
}

/** "נמסר" בזמן שיש סבב פתוח — סוגר אותו */
export function closeOpenRevision(ctx: Ctx, projectId: string, note = '') {
  const open = listRevisions(ctx, projectId).find((r) => !r.closedAt);
  if (open) closeRevision(ctx, open.id, note);
}
