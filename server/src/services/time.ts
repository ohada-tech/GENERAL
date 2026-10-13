/**
 * מעקב זמן עבודה לפרויקט: טיימר (אחד בכל רגע), הזנה ידנית, והערכה אוטומטית מהיסטוריית הפעילות.
 * זמן "מתועד" = טיימר + ידני. ההערכה האוטומטית מוצגת בנפרד ולעולם לא מתערבבת בו.
 */
import {
  estimateActiveSeconds,
  formatDuration,
  STAGE_KEYS,
  type RunningTimer,
  type StageKey,
  type TimeEntry,
  type TimeSummary,
} from '@apos/shared';
import { z } from 'zod';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { tx, uid } from '../db/db.js';
import { getProject } from '../db/repo.js';
import { emit } from '../workflow/events.js';
import { notify } from './notifications.js';

type Row = Record<string, any>;

const mapEntry = (r: Row, now: Date): TimeEntry => {
  const end = r.ended_at ? new Date(r.ended_at) : now;
  return {
    id: r.id,
    projectId: r.project_id,
    stage: r.stage,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
    durationSec: Math.max(0, Math.round((end.getTime() - new Date(r.started_at).getTime()) / 1000)),
    note: r.note,
    source: r.source,
    createdAt: r.created_at,
  };
};

const stageSchema = z.enum(STAGE_KEYS);
const MAX_ENTRY_MIN = 24 * 60;

export function listEntries(ctx: Ctx, projectId: string): TimeEntry[] {
  const rows = ctx.db
    .prepare('SELECT * FROM time_entries WHERE project_id = ? ORDER BY started_at DESC')
    .all(projectId) as Row[];
  const now = ctx.now();
  return rows.map((r) => mapEntry(r, now));
}

export function runningTimer(ctx: Ctx): RunningTimer | null {
  const r = ctx.db
    .prepare('SELECT t.*, p.name AS project_name FROM time_entries t JOIN projects p ON p.id = t.project_id WHERE t.ended_at IS NULL')
    .get() as Row | undefined;
  return r ? { ...mapEntry(r, ctx.now()), projectName: r.project_name } : null;
}

function stopRunning(ctx: Ctx, note?: string) {
  const running = runningTimer(ctx);
  if (!running) return null;
  const end = ctx.now().toISOString();
  const finalNote = note?.trim() ? note.trim() : running.note;
  ctx.db.prepare('UPDATE time_entries SET ended_at = ?, note = ? WHERE id = ?').run(end, finalNote, running.id);
  emit(ctx, {
    projectId: running.projectId,
    type: 'time.stopped',
    actor: ctx.config.ownerName,
    message: `טיימר נעצר: ${formatDuration(running.durationSec)}${finalNote ? ` — ${finalNote}` : ''}`,
    payload: { entryId: running.id, durationSec: running.durationSec },
  });
  return running.id;
}

/** מפעיל טיימר לפרויקט. טיימר שרץ על פרויקט אחר נעצר אוטומטית. */
export function startTimer(ctx: Ctx, projectId: string, input: { stage: string; note?: string }) {
  const project = getProject(ctx.db, projectId);
  if (!project) throw new NotFoundError('פרויקט');
  const stage = stageSchema.parse(input.stage);
  return tx(ctx.db, () => {
    const prev = runningTimer(ctx);
    if (prev && prev.projectId === projectId && prev.stage === stage) return prev;
    stopRunning(ctx);
    const id = uid();
    const t = ctx.now().toISOString();
    ctx.db
      .prepare(
        "INSERT INTO time_entries (id, project_id, stage, started_at, ended_at, note, source, created_at) VALUES (?, ?, ?, ?, NULL, ?, 'timer', ?)",
      )
      .run(id, projectId, stage, t, input.note?.trim() ?? '', t);
    emit(ctx, {
      projectId,
      type: 'time.started',
      actor: ctx.config.ownerName,
      message: `טיימר הופעל${prev && prev.projectId !== projectId ? ` (נעצר טיימר בפרויקט "${prev.projectName}")` : ''}`,
      payload: { entryId: id, stage },
    });
    return runningTimer(ctx)!;
  });
}

export function stopTimer(ctx: Ctx, note?: string) {
  return tx(ctx.db, () => {
    const id = stopRunning(ctx, note);
    if (!id) throw new GateError('אין טיימר פעיל');
    return mapEntry(ctx.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id) as Row, ctx.now());
  });
}

const manualSchema = z.object({
  stage: stageSchema,
  minutes: z.number().positive().max(MAX_ENTRY_MIN),
  /** תחילת העבודה (ISO). ברירת מחדל: עכשיו פחות משך העבודה */
  startedAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().default(''),
});

/** הזנה ידנית — לעבודה שנעשתה מחוץ למערכת או בלי טיימר. */
export function addManualEntry(ctx: Ctx, projectId: string, input: unknown) {
  if (!getProject(ctx.db, projectId)) throw new NotFoundError('פרויקט');
  const m = manualSchema.parse(input);
  const durMs = Math.round(m.minutes * 60_000);
  const start = m.startedAt ? new Date(m.startedAt) : new Date(ctx.now().getTime() - durMs);
  const end = new Date(start.getTime() + durMs);
  if (end.getTime() > ctx.now().getTime() + 60_000) throw new GateError('לא ניתן לתעד זמן עבודה עתידי', 400);
  return tx(ctx.db, () => {
    const id = uid();
    ctx.db
      .prepare(
        "INSERT INTO time_entries (id, project_id, stage, started_at, ended_at, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)",
      )
      .run(id, projectId, m.stage, start.toISOString(), end.toISOString(), m.note.trim(), ctx.now().toISOString());
    emit(ctx, {
      projectId,
      type: 'time.manual_added',
      actor: ctx.config.ownerName,
      message: `נוסף זמן עבודה ידני: ${formatDuration(durMs / 1000)}${m.note.trim() ? ` — ${m.note.trim()}` : ''}`,
      payload: { entryId: id, minutes: m.minutes, stage: m.stage },
    });
    return mapEntry(ctx.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id) as Row, ctx.now());
  });
}

const patchSchema = z.object({
  stage: stageSchema.optional(),
  note: z.string().optional(),
  minutes: z.number().positive().max(MAX_ENTRY_MIN).optional(),
});

export function updateEntry(ctx: Ctx, entryId: string, input: unknown) {
  const row = ctx.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId) as Row | undefined;
  if (!row) throw new NotFoundError('רישום זמן');
  const p = patchSchema.parse(input);
  if (p.minutes !== undefined && !row.ended_at) throw new GateError('לא ניתן לשנות משך של טיימר שרץ — עצור אותו קודם');
  const endedAt =
    p.minutes !== undefined ? new Date(new Date(row.started_at).getTime() + p.minutes * 60_000).toISOString() : row.ended_at;
  return tx(ctx.db, () => {
    ctx.db
      .prepare('UPDATE time_entries SET stage = ?, note = ?, ended_at = ? WHERE id = ?')
      .run(p.stage ?? row.stage, p.note !== undefined ? p.note.trim() : row.note, endedAt, entryId);
    const e = mapEntry(ctx.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId) as Row, ctx.now());
    emit(ctx, {
      projectId: row.project_id,
      type: 'time.updated',
      actor: ctx.config.ownerName,
      message: `רישום זמן עודכן (${formatDuration(e.durationSec)})`,
      payload: { entryId },
    });
    return e;
  });
}

export function deleteEntry(ctx: Ctx, entryId: string) {
  const row = ctx.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId) as Row | undefined;
  if (!row) throw new NotFoundError('רישום זמן');
  const e = mapEntry(row, ctx.now());
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM time_entries WHERE id = ?').run(entryId);
    emit(ctx, {
      projectId: row.project_id,
      type: 'time.deleted',
      actor: ctx.config.ownerName,
      message: `רישום זמן נמחק (${formatDuration(e.durationSec)})`,
      payload: { entryId },
    });
  });
}

/** סיכום זמן לפרויקט. */
export function timeSummary(ctx: Ctx, projectId: string): TimeSummary {
  const entries = listEntries(ctx, projectId);
  const byStage: Partial<Record<StageKey, number>> = {};
  for (const e of entries) byStage[e.stage] = (byStage[e.stage] ?? 0) + e.durationSec;
  // פעולות שלך בלבד (לא של ה-worker או של ספקי AI)
  const actions = ctx.db
    .prepare('SELECT created_at FROM events WHERE project_id = ? AND actor = ? ORDER BY created_at')
    .all(projectId, ctx.config.ownerName) as Row[];
  const starts = entries.map((e) => e.startedAt).sort();
  const ends = entries.map((e) => e.endedAt ?? ctx.now().toISOString()).sort();
  return {
    trackedSec: entries.reduce((a, e) => a + e.durationSec, 0),
    byStage,
    estimatedActiveSec: estimateActiveSeconds(actions.map((a) => a.created_at)),
    running: entries.find((e) => !e.endedAt) ?? null,
    entryCount: entries.length,
    firstWorkAt: starts[0] ?? null,
    lastWorkAt: ends[ends.length - 1] ?? null,
  };
}

/** סה"כ זמן מתועד לכל פרויקט + מתחילת השבוע (יום א'), לדשבורד. */
export function trackedTotals(ctx: Ctx) {
  const now = ctx.now();
  const rows = ctx.db.prepare('SELECT * FROM time_entries').all() as Row[];
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const byProject: Record<string, number> = {};
  let week = 0;
  for (const r of rows) {
    const e = mapEntry(r, now);
    byProject[e.projectId] = (byProject[e.projectId] ?? 0) + e.durationSec;
    // רק החלק של הרישום שנופל בשבוע הנוכחי
    const s = Math.max(new Date(e.startedAt).getTime(), weekStart.getTime());
    const end = e.endedAt ? new Date(e.endedAt).getTime() : now.getTime();
    if (end > s) week += Math.round((end - s) / 1000);
  }
  return { byProject, weekSec: week };
}

/** טיימר שרץ זמן חריג — כנראה נשכח. התראה אחת לכל טיימר. */
export function checkForgottenTimer(ctx: Ctx) {
  const r = runningTimer(ctx);
  if (!r || r.durationSec < ctx.config.timerMaxHours * 3600) return false;
  return notify(ctx, {
    projectId: r.projectId,
    kind: 'warning',
    title: `טיימר רץ כבר ${formatDuration(r.durationSec)}`,
    body: `${r.projectName}: אם שכחת לעצור — עצור ותקן את המשך בלשונית "זמן עבודה".`,
    link: `/projects/${r.projectId}/time`,
    dedupeKey: `timer.long:${r.id}`,
  });
}
