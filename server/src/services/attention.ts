/**
 * "מחכה לך": סשן של Claude (או כל כלי אחר) נעצר ומחכה לתשובה / פעולה של אוהד.
 * נרשם בפעמון ובהיסטוריה של הפרויקט, וקופץ מיד כהתראת Push — כדי שפרויקט לא ייתקע שעה בלי שאוהד יודע.
 */
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { getProject } from '../db/repo.js';
import { emit } from '../workflow/events.js';
import { notify } from './notifications.js';

export function needsOwner(ctx: Ctx, input: { projectId?: string; text?: string; by?: string; link?: string }) {
  const text = String(input.text ?? '').trim().slice(0, 500);
  if (!text) throw new GateError('יש לכתוב מה צריך מאוהד', 400);
  const by = String(input.by ?? '').trim().slice(0, 40) || 'Claude';
  const p = input.projectId ? getProject(ctx.db, input.projectId) : null;
  if (input.projectId && !p) throw new NotFoundError('פרויקט');
  const link = String(input.link ?? '').trim();
  const e = p ? emit(ctx, { projectId: p.id, type: 'project.progress', actor: by, message: `⏳ מחכה לך: ${text}`, payload: { by, attention: true } }) : null;
  notify(ctx, {
    projectId: p?.id ?? null,
    kind: 'approval_needed',
    title: `⏳ ${by} מחכה לך${p ? ` · ${p.name}` : ''}`,
    body: text,
    // קישור חיצוני (למשל לסשן) רק ב-https; אחרת — הפרויקט
    link: /^https:\/\//.test(link) || link.startsWith('/') ? link : p ? `/projects/${p.id}` : '/',
    dedupeKey: `attention:${e?.id ?? ctx.now().toISOString()}:${text.slice(0, 40)}`,
  });
  return { ok: true, project: p?.name ?? null };
}
