/**
 * "שלח ללקוח": קישור פרטי לתסריט (בלי התחברות) — הלקוח פותח בכל מכשיר, אוהד רואה אם ומתי נפתח.
 * הקישור מציג רק את הדף ללקוח (בלי הערות פנימיות), אפשר לבטל אותו, והוא לא ניתן לניחוש (24 בתים אקראיים).
 */
import crypto from 'node:crypto';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { getScript } from '../db/repo.js';
import { emit } from '../workflow/events.js';

export interface ShareLink {
  token: string;
  projectId: string;
  scriptVersionId: string;
  label: string;
  lang: 'he' | 'en' | null;
  createdAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

const map = (r: any): ShareLink => ({
  token: r.token,
  projectId: r.project_id,
  scriptVersionId: r.script_version_id,
  label: r.label,
  lang: r.lang ?? null,
  createdAt: r.created_at,
  revokedAt: r.revoked_at ?? null,
  viewCount: Number(r.view_count ?? 0),
  lastViewedAt: r.last_viewed_at ?? null,
});

/** קישור פעיל לגרסה (ושפה) — אם כבר קיים, אותו קישור; אחרת חדש. נרשם בהיסטוריה כ"נשלח ללקוח". */
export function shareScript(ctx: Ctx, versionId: string, lang?: string | null) {
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  const l = lang === 'he' || lang === 'en' ? lang : null;
  const existing = ctx.db
    .prepare('SELECT * FROM share_links WHERE script_version_id = ? AND lang IS ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .get(v.id, l);
  if (existing) return map(existing);
  const token = crypto.randomBytes(24).toString('base64url');
  const now = ctx.now().toISOString();
  ctx.db
    .prepare('INSERT INTO share_links (token, project_id, script_version_id, label, lang, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(token, v.projectId, v.id, v.label, l, now);
  emit(ctx, {
    projectId: v.projectId,
    type: 'script.shared',
    actor: ctx.config.ownerName,
    message: `נוצר קישור ללקוח לתסריט v${v.label}`,
    payload: { scriptVersionId: v.id, label: v.label },
  });
  return map(ctx.db.prepare('SELECT * FROM share_links WHERE token = ?').get(token));
}

export function listShares(ctx: Ctx, versionId: string) {
  return (ctx.db.prepare('SELECT * FROM share_links WHERE script_version_id = ? ORDER BY created_at DESC').all(versionId) as any[]).map(map);
}

export function revokeShare(ctx: Ctx, token: string) {
  const r = ctx.db.prepare('UPDATE share_links SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL').run(ctx.now().toISOString(), token);
  if (!r.changes) throw new NotFoundError('קישור');
  return { revoked: true };
}

/** פתיחה של הלקוח: מחזיר את הקישור ורושם צפייה (בפעם הראשונה גם בהיסטוריה) */
export function openShare(ctx: Ctx, token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const r = ctx.db.prepare('SELECT * FROM share_links WHERE token = ?').get(token);
  if (!r) return null;
  const link = map(r);
  if (link.revokedAt) throw new GateError('הקישור בוטל', 410);
  const now = ctx.now().toISOString();
  ctx.db.prepare('UPDATE share_links SET view_count = view_count + 1, last_viewed_at = ? WHERE token = ?').run(now, token);
  if (link.viewCount === 0) {
    emit(ctx, {
      projectId: link.projectId,
      type: 'script.share_viewed',
      actor: 'לקוח',
      message: `הלקוח פתח את קישור התסריט v${link.label}`,
      payload: { scriptVersionId: link.scriptVersionId },
    });
  }
  return link;
}

/** הקישור האחרון שנשלח בפרויקט — לכרטיס בדשבורד ("נשלח לפני 3 ימים · נפתח ✓") */
export function lastShareFor(ctx: Ctx, projectId: string) {
  const r = ctx.db
    .prepare('SELECT * FROM share_links WHERE project_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .get(projectId);
  if (!r) return null;
  const l = map(r);
  return { label: l.label, sentAt: l.createdAt, viewedAt: l.lastViewedAt, views: l.viewCount };
}
