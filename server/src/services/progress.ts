/**
 * עדכוני התקדמות: משפט קצר על מה קרה בפרויקט (מאוהד, או מסשן Claude שעבד על הפרויקט מחוץ למערכת).
 * נרשם בהיסטוריה כהתקדמות, שולח התראה בפעמון, והאחרון מוצג בכרטיס בדשבורד ובראש עמוד הפרויקט.
 */
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { getProject } from '../db/repo.js';
import { emit } from '../workflow/events.js';
import { notify } from './notifications.js';

export interface ProgressUpdate {
  text: string;
  by: string;
  at: string;
}

export function postProgressUpdate(ctx: Ctx, projectId: string, input: { text?: string; by?: string }) {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new NotFoundError('פרויקט');
  const text = String(input.text ?? '').trim().slice(0, 1000);
  if (!text) throw new GateError('יש לכתוב מה התקדם', 400);
  const by = String(input.by ?? '').trim().slice(0, 40) || ctx.config.ownerName;
  const e = emit(ctx, { projectId, type: 'project.progress', actor: by, message: text, payload: { by } });
  if (by !== ctx.config.ownerName) {
    notify(ctx, {
      projectId,
      kind: 'info',
      title: `עדכון התקדמות · ${p.name}`,
      body: text.slice(0, 160),
      link: `/projects/${projectId}`,
      dedupeKey: `progress:${e.id}`,
    });
  }
  return { text, by, at: e.createdAt } satisfies ProgressUpdate;
}

export function lastProgressUpdate(ctx: Ctx, projectId: string): ProgressUpdate | null {
  const r = ctx.db
    .prepare("SELECT message, actor, created_at FROM events WHERE project_id = ? AND type = 'project.progress' ORDER BY created_at DESC LIMIT 1")
    .get(projectId) as { message: string; actor: string; created_at: string } | undefined;
  return r ? { text: r.message, by: r.actor, at: r.created_at } : null;
}
