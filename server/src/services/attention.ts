/**
 * "מחכה לך": סשן של Claude (או כל כלי אחר) נעצר ומחכה לתשובה / פעולה של אוהד.
 * נרשם בפעמון ובהיסטוריה של הפרויקט, וקופץ מיד כהתראת Push — כדי שפרויקט לא ייתקע שעה בלי שאוהד יודע.
 */
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { getProject } from '../db/repo.js';
import { emit } from '../workflow/events.js';
import { notify } from './notifications.js';
import { assertReadableText } from './text-guard.js';

/**
 * נושא של הודעה: מה שלפני הנקודתיים בפתיחה ("כונן C: …", "Fireberry: …").
 * הודעה חדשה על אותו נושא מאותו שולח מחליפה את הקודמת — גם בלי פרויקט — כדי ש"מחכה לך" לא יתמלא בכפולים.
 */
export function attentionTopic(text: string): string | null {
  const m = /^\s*([^:：\n]{2,30})[:：]/.exec(text);
  return m ? m[1].trim().toLowerCase() : null;
}

export function needsOwner(ctx: Ctx, input: { projectId?: string; text?: string; by?: string; link?: string }) {
  const text = String(input.text ?? '').trim().slice(0, 500);
  if (!text) throw new GateError('יש לכתוב מה צריך מאוהד', 400);
  assertReadableText(text);
  const by = String(input.by ?? '').trim().slice(0, 40) || 'Claude';
  const p = input.projectId ? getProject(ctx.db, input.projectId) : null;
  if (input.projectId && !p) throw new NotFoundError('פרויקט');
  const link = String(input.link ?? '').trim();
  // הודעה חדשה מאותו מקור על אותו פרויקט מחליפה את הקודמת — העבודה התקדמה לשלב הבא
  if (p) resolveAttention(ctx, { projectId: p.id, titlePrefix: `⏳ ${by} מחכה לך` });
  // בלי פרויקט: הודעה על אותו נושא ("כונן C: …") מחליפה את הקודמת
  const topic = attentionTopic(text);
  if (!p && topic) supersedeTopic(ctx, by, topic);
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

/** סוגר הודעות פתוחות בלי פרויקט מאותו שולח ועל אותו נושא — נשארת רק החדשה שתיכנס עכשיו */
function supersedeTopic(ctx: Ctx, by: string, topic: string) {
  const rows = ctx.db
    .prepare(`SELECT id, body FROM notifications WHERE dedupe_key LIKE 'attention:%' AND read_at IS NULL AND project_id IS NULL AND title = ?`)
    .all(`⏳ ${by} מחכה לך`) as Array<{ id: string; body: string }>;
  const ids = rows.filter((r) => attentionTopic(r.body) === topic).map((r) => r.id);
  const at = ctx.now().toISOString();
  const upd = ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?');
  for (const id of ids) upd.run(at, id);
  return ids.length;
}

/**
 * ניקוי "מחכה לך" (בהפעלת השרת): מכפולים על אותו נושא נשארת רק האחרונה,
 * ופרויקט שכבר נמסר לא מחזיק שום הודעה פתוחה. רק מסמן כטופל — לא מוחק.
 */
export function tidyAttention(ctx: Ctx) {
  const at = ctx.now().toISOString();
  const delivered = ctx.db
    .prepare(
      `UPDATE notifications SET read_at = ? WHERE dedupe_key LIKE 'attention:%' AND read_at IS NULL
         AND project_id IN (SELECT id FROM projects WHERE delivered_at IS NOT NULL AND delivered_at > '' AND delivered_at >= notifications.created_at)`,
    )
    .run(at);
  const rows = ctx.db
    .prepare(`SELECT id, title, body FROM notifications WHERE dedupe_key LIKE 'attention:%' AND read_at IS NULL AND project_id IS NULL ORDER BY created_at DESC, rowid DESC`)
    .all() as Array<{ id: string; title: string; body: string }>;
  const seen = new Set<string>();
  const upd = ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?');
  let dup = 0;
  for (const r of rows) {
    const topic = attentionTopic(r.body);
    if (!topic) continue;
    const key = `${r.title}|${topic}`;
    if (seen.has(key)) {
      upd.run(at, r.id);
      dup++;
    } else seen.add(key);
  }
  return { delivered: Number(delivered.changes), duplicates: dup };
}
