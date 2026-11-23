/**
 * הרצה בהיגספילד בלחיצת כפתור: אוהד לוחץ "הרץ" (פיילוט = שוט אחד, או הכל) על שלב התמונות / ההנפשה,
 * ועובד מקומי במחשב שלו (~/.apos/hf-worker.cjs) מריץ את ה-CLI של היגספילד בקרדיטים ומעלה את התוצאות
 * חזרה למערכת (/media/from-url). הלחיצה היא האישור לריצה — הכפתור מציג את העלות לפני.
 * מסלול אנלימיטד (דפדפן) לא רץ מכאן — רק מסלול הקרדיטים.
 */
import { hfImageCredits, hfVideoCredits, videoModelForShot } from '@apos/shared';
import type { Ctx } from '../context.js';
import { GateError, NotFoundError } from '../context.js';
import { uid } from '../db/db.js';
import { currentStoryboard, getProject, listRefsForStoryboard, listShots } from '../db/repo.js';
import { emit } from '../workflow/events.js';
import { externalRequests } from '../workflow/production.js';

/** שוטי הסטורי בורד הנוכחי לפי מזהה: מודל הנפשה ואורך */
function shotMap(ctx: Ctx, projectId: string) {
  const sb = currentStoryboard(ctx.db, projectId);
  return new Map((sb ? listShots(ctx.db, sb.id) : []).map((x) => [x.id, { m: x.animationModel, d: x.durationSec }]));
}

export type HfStage = 'images' | 'animation';
export type HfScope = 'pilot' | 'all';

export interface HfRun {
  id: string;
  projectId: string;
  stage: HfStage;
  scope: HfScope;
  status: 'queued' | 'running' | 'done' | 'failed';
  total: number;
  done: number;
  credits: number;
  error: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type Row = {
  id: string;
  project_id: string;
  stage: HfStage;
  scope: HfScope;
  status: HfRun['status'];
  total: number;
  done: number;
  credits: number;
  error: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  shot_ids?: string | null;
  variants?: number;
};
const map = (r: Row): HfRun => ({
  id: r.id,
  projectId: r.project_id,
  stage: r.stage,
  scope: r.scope,
  status: r.status,
  total: r.total,
  done: r.done,
  credits: r.credits,
  error: r.error,
  requestedAt: r.requested_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

/** שם המודל ב-CLI של היגספילד */
const HF_IMAGE_JOB: Record<string, string> = { 'nano-banana-pro': 'nano_banana_pro', 'nano-banana-2': 'nano_banana_flash', 'seedream-5-lite': 'seedream_v5_lite' };
const HF_VIDEO_JOB: Record<string, string> = { 'kling-3.0': 'kling3_0', 'seedance-2': 'seedance_2_0', 'seedance-2-mini': 'seedance_2_0_mini' };

export function lastHfRun(ctx: Ctx, projectId: string, stage: HfStage): HfRun | null {
  const r = ctx.db.prepare('SELECT * FROM hf_runs WHERE project_id = ? AND stage = ? ORDER BY requested_at DESC, rowid DESC LIMIT 1').get(projectId, stage) as Row | undefined;
  return r ? map(r) : null;
}

/** מה ירוץ: הפריטים שמחכים בשלב, פיילוט = הראשון בלבד */
function pendingItems(ctx: Ctx, projectId: string, stage: HfStage, shotIds?: string[]) {
  const req = externalRequests(ctx, projectId, shotIds ? { shotIds } : {});
  return (stage === 'images' ? req.images : req.animation) as Array<NonNullable<(typeof req.images)[number]> & { approvedFrame?: { fileUrl: string } | null; durationSec?: number }>;
}

export function requestHfRun(ctx: Ctx, projectId: string, stage: HfStage, scope: HfScope, opts: { shotIds?: string[]; variants?: number } = {}) {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new NotFoundError('פרויקט');
  if (p.settings.generator !== 'higgsfield') throw new GateError('הפרויקט לא מוגדר על היגספילד', 409);
  if (p.settings.hfRoute !== 'credits') throw new GateError('הרצה בלחיצה עובדת במסלול קרדיטים. באנלימיטד — Claude מריץ בדפדפן', 409);
  const active = ctx.db.prepare("SELECT 1 FROM hf_runs WHERE project_id = ? AND stage = ? AND status IN ('queued','running')").get(projectId, stage);
  if (active) throw new GateError('כבר יש הרצה פעילה בשלב הזה', 409);
  let items = pendingItems(ctx, projectId, stage, opts.shotIds);
  if (stage === 'animation') items = items.filter((i) => i.approvedFrame);
  if (!items.length) throw new GateError(stage === 'images' ? 'אין שוטים שמחכים לתמונה' : 'אין שוטים עם תמונה מאושרת שמחכים להנפשה', 409);
  if (scope === 'pilot') items = items.slice(0, 1);
  const variants = Math.max(1, Math.min(4, Math.round(opts.variants ?? 1)));
  const credits = Math.round(costOf(ctx, projectId, stage, items) * variants * 100) / 100;
  const id = uid();
  const at = ctx.now().toISOString();
  ctx.db
    .prepare("INSERT INTO hf_runs (id, project_id, stage, scope, status, total, done, credits, error, requested_at, shot_ids, variants) VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, '', ?, ?, ?)")
    .run(id, projectId, stage, scope, items.length * variants, credits, at, opts.shotIds ? JSON.stringify(opts.shotIds) : null, variants);
  emit(ctx, {
    projectId,
    type: 'project.progress',
    actor: 'אוהד',
    message: `▶ הרצה בהיגספילד: ${stage === 'images' ? 'תמונות' : 'הנפשה'} · ${scope === 'pilot' ? 'פיילוט (שוט אחד)' : `${items.length} שוטים`} · ~${credits} קרדיטים`,
    payload: { hfRun: id, stage, scope, credits },
  });
  return map(ctx.db.prepare('SELECT * FROM hf_runs WHERE id = ?').get(id) as Row);
}

function costOf(ctx: Ctx, projectId: string, stage: HfStage, items: Array<{ shotId: string; durationSec?: number }>) {
  const p = getProject(ctx.db, projectId)!;
  if (stage === 'images') return items.length * hfImageCredits(p.settings.imageModel);
  const shots = shotMap(ctx, projectId);
  return items.reduce((a, it) => {
    const s = shots.get(it.shotId);
    return a + hfVideoCredits(videoModelForShot(s?.m ?? '', p.settings.videoModel).id, s?.d || 5);
  }, 0);
}

/** העובד במחשב: הבקשה הבאה + כל מה שצריך כדי להריץ אותה ב-CLI */
export function nextHfRun(ctx: Ctx) {
  const r = ctx.db.prepare("SELECT * FROM hf_runs WHERE status = 'queued' ORDER BY requested_at, rowid LIMIT 1").get() as Row | undefined;
  if (!r) return null;
  const run = map(r);
  const p = getProject(ctx.db, run.projectId)!;
  ctx.db.prepare("UPDATE hf_runs SET status = 'running', started_at = ? WHERE id = ?").run(ctx.now().toISOString(), run.id);
  const shotIds = r.shot_ids ? (JSON.parse(r.shot_ids) as string[]) : undefined;
  const variants = Math.max(1, r.variants || 1);
  let items = pendingItems(ctx, run.projectId, run.stage, shotIds);
  if (run.stage === 'animation') items = items.filter((i) => i.approvedFrame);
  items = items.slice(0, Math.ceil(run.total / variants));
  // וריאציות: אותו שוט כמה פעמים, כטייקים נוספים
  items = items.flatMap((it) => Array.from({ length: variants }, () => it));
  const sb = currentStoryboard(ctx.db, run.projectId);
  const refs = sb ? listRefsForStoryboard(ctx.db, sb.id).filter((x) => x.status === 'approved' && x.imageUrl) : [];
  const shots = shotMap(ctx, run.projectId);
  const aspect = externalRequests(ctx, run.projectId).aspect;
  return {
    run: { ...run, status: 'running' as const },
    project: { id: p.id, name: p.name },
    items: items.map((it) => {
      const s = shots.get(it.shotId);
      const vm = videoModelForShot(s?.m ?? '', p.settings.videoModel);
      return {
        shotId: it.shotId,
        shotNumber: it.shotNumber,
        kind: run.stage === 'images' ? 'frame' : 'clip',
        prompt: it.prompt,
        feedback: it.feedback,
        job: run.stage === 'images' ? (HF_IMAGE_JOB[p.settings.imageModel] ?? 'nano_banana_pro') : (HF_VIDEO_JOB[vm.id] ?? 'kling3_0'),
        params:
          run.stage === 'images'
            ? { aspect_ratio: aspect, ...(/nano/.test(p.settings.imageModel) ? { resolution: '2k' } : {}) }
            : { aspect_ratio: aspect, duration: Math.max(4, Math.min(10, Math.round(s?.d || 5))) },
        credits: run.stage === 'images' ? hfImageCredits(p.settings.imageModel) : hfVideoCredits(vm.id, s?.d || 5),
        references: run.stage === 'images' ? refs.filter((x) => x.shotId === it.shotId).slice(0, 6).map((x) => x.imageUrl) : [],
        startImage: run.stage === 'animation' ? (it.approvedFrame?.fileUrl ?? null) : null,
        variant: variants > 1 || !!shotIds,
      };
    }),
  };
}

export function reportHfRun(ctx: Ctx, runId: string, body: { done?: number; status?: string; error?: string }) {
  const r = ctx.db.prepare('SELECT * FROM hf_runs WHERE id = ?').get(runId) as Row | undefined;
  if (!r) throw new NotFoundError('הרצה');
  const status = body.status === 'done' || body.status === 'failed' ? body.status : r.status;
  const finished = status === 'done' || status === 'failed' ? ctx.now().toISOString() : null;
  ctx.db
    .prepare('UPDATE hf_runs SET done = ?, status = ?, error = ?, finished_at = COALESCE(?, finished_at) WHERE id = ?')
    .run(Math.max(0, Number(body.done ?? r.done)), status, String(body.error ?? r.error).slice(0, 500), finished, runId);
  if (finished) {
    emit(ctx, {
      projectId: r.project_id,
      type: 'project.progress',
      actor: 'היגספילד',
      message:
        status === 'done'
          ? `✓ ההרצה בהיגספילד הסתיימה: ${body.done ?? r.done}/${r.total} ${r.stage === 'images' ? 'תמונות' : 'קליפים'} מחכים לאישור שלך`
          : `✗ ההרצה בהיגספילד נכשלה: ${String(body.error ?? '').slice(0, 200)}`,
      payload: { hfRun: runId, status },
    });
  }
  return map(ctx.db.prepare('SELECT * FROM hf_runs WHERE id = ?').get(runId) as Row);
}

/** הרצה שנתקעה (העובד נפל באמצע) חוזרת לתור אחרי 40 דקות */
export function requeueStuckHfRuns(ctx: Ctx) {
  const cutoff = new Date(ctx.now().getTime() - 40 * 60_000).toISOString();
  ctx.db.prepare("UPDATE hf_runs SET status = 'queued' WHERE status = 'running' AND started_at < ?").run(cutoff);
}
