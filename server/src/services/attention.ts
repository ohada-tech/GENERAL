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
  // הודעה חדשה מאותו מקור על אותו פרויקט מחליפה את הקודמת — העבודה התקדמה לשלב הבא
  if (p) resolveAttention(ctx, { projectId: p.id, titlePrefix: `⏳ ${by} מחכה לך` });
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

/**
 * סוגר הודעות "מחכה לך" שכבר טופלו — כדי שהאזור הדחוף יישאר מסונכרן עם העבודה בפועל.
 * projectId: רק של הפרויקט הזה · match: מילים מתוך ההודעה · titlePrefix: לפי מי ששלח (למשל "⏳ ChatGPT QA") · before: רק ישנות מזה.
 */
export function resolveAttention(ctx: Ctx, f: { projectId?: string | null; match?: string; titlePrefix?: string; before?: string; all?: boolean }) {
  if (!f.all && !f.projectId && !f.match?.trim()) throw new GateError('יש לציין פרויקט או מילים מתוך ההודעה', 400);
  const where = ["dedupe_key LIKE 'attention:%'", 'read_at IS NULL'];
  const args: string[] = [];
  if (f.projectId) {
    where.push('project_id = ?');
    args.push(f.projectId);
  }
  if (f.match?.trim()) {
    where.push('body LIKE ?');
    args.push(`%${f.match.trim()}%`);
  }
  if (f.titlePrefix) {
    where.push('title LIKE ?');
    args.push(`${f.titlePrefix}%`);
  }
  if (f.before) {
    where.push('created_at < ?');
    args.push(f.before);
  }
  const r = ctx.db.prepare(`UPDATE notifications SET read_at = ? WHERE ${where.join(' AND ')}`).run(ctx.now().toISOString(), ...args);
  return { resolved: Number(r.changes) };
}
