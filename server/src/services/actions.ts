/**
 * פעולות בלחיצה על תוצרים בהיגספילד: תיקון נקודתי, תיקון כל מה שנפסל ב-QA, וריאציות.
 * כל פעולה מסמנת מה לתקן ושולחת את ההרצה בעצמה — לפי המסלול של הפרויקט:
 * קרדיטים → העובד של ה-CLI (hf-runs), אנלימיטד → Claude Code ב-Chrome (agent-tasks).
 */
import type { Ctx } from '../context.js';
import { GateError, NotFoundError } from '../context.js';
import { getMedia, getProject } from '../db/repo.js';
import { latestMedia, regenerateItem } from '../workflow/production.js';
import { requestAgentTask } from './agent-tasks.js';
import { requestHfRun } from './hf-runs.js';

type Stage = 'images' | 'animation';
const stageOf = (kind: string): Stage => (kind === 'clip' ? 'animation' : 'images');

function dispatch(ctx: Ctx, projectId: string, stage: Stage, shotIds: string[], variants = 1, note = '') {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new NotFoundError('פרויקט');
  if (p.settings.generator !== 'higgsfield') throw new GateError('הפרויקט לא מוגדר על היגספילד', 409);
  if (p.settings.hfRoute === 'credits') return { route: 'credits' as const, run: requestHfRun(ctx, projectId, stage, 'all', { shotIds, variants }) };
  return { route: 'unlimited' as const, task: requestAgentTask(ctx, projectId, { kind: 'hf_unlimited', stage, scope: 'all', shotIds, variants, note }) };
}

/** "תקן": ההערה נשמרת על הטייק, והשוט רץ מחדש עם התיקון בלבד */
export function fixItem(ctx: Ctx, mediaId: string, feedback: string) {
  const m = getMedia(ctx.db, mediaId);
  if (!m || !m.shotId) throw new NotFoundError('פריט');
  const note = feedback.trim() || ((m.params as { qa?: { note?: string } }).qa?.note ?? '');
  if (!note) throw new GateError('כתוב מה לתקן', 400);
  regenerateItem(ctx, mediaId, note);
  return dispatch(ctx, m.projectId, stageOf(m.kind), [m.shotId], 1, note);
}

/** "תקן את כל מה שנפסל ב-QA": כל טייק שהבדיקה פסלה — מחדש, עם הערת הבדיקה */
export function fixQaFailures(ctx: Ctx, projectId: string, stage: Stage) {
  const kind = stage === 'images' ? 'frame' : 'clip';
  const failed = [...latestMedia(ctx, projectId).latest.values()].filter(
    (m) => m.kind === kind && m.shotId && m.status === 'ready' && (m.params as { qa?: { verdict?: string } }).qa?.verdict === 'fail',
  );
  if (!failed.length) throw new GateError('אין טייקים שנפסלו בבדיקת האיכות', 409);
  for (const m of failed) regenerateItem(ctx, m.id, (m.params as { qa?: { note?: string } }).qa?.note ?? 'תיקון לפי בדיקת האיכות');
  return { count: failed.length, ...dispatch(ctx, projectId, stage, failed.map((m) => m.shotId!)) };
}

/** "וריאציות": עוד כמה טייקים לאותו שוט, בלי לדחות את הקיים — ואז משווים ובוחרים */
export function variants(ctx: Ctx, mediaId: string, count: number) {
  const m = getMedia(ctx.db, mediaId);
  if (!m || !m.shotId) throw new NotFoundError('פריט');
  return dispatch(ctx, m.projectId, stageOf(m.kind), [m.shotId], Math.max(2, Math.min(4, count || 3)));
}
