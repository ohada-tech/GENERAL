/**
 * Worker: מריץ משימות מהתור, מתעד כל ניסיון, מבצע Retry עם backoff,
 * מזהה משימות תקועות ופרויקטים ללא התקדמות.
 * משימות של פרויקט מושהה/עצור לא נאספות.
 */
import { JOB_LABELS, type Job, type JobType } from '@apos/shared';
import { GateError, type Ctx } from '../context.js';
import { json, tx, uid } from '../db/db.js';
import { getJob, lastEventAt, listProjects, mapJob } from '../db/repo.js';
import { ProviderError } from '../providers/types.js';
import { emit } from '../workflow/events.js';
import { HANDLERS, type JobHandler } from './handlers.js';
import { checkForgottenTimer } from '../services/time.js';

const WORKER = 'worker';

export function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retryable;
  if (err instanceof GateError) return false;
  return true; // שגיאה לא צפויה — ננסה שוב עד למגבלת הניסיונות
}

export function backoffSeconds(ctx: Ctx, attempt: number): number {
  return ctx.config.jobs.retryBaseSeconds * 2 ** Math.max(0, attempt - 1);
}

function claimNext(ctx: Ctx): Job | null {
  return tx(ctx.db, () => {
    const ts = ctx.now().toISOString();
    const row = ctx.db
      .prepare(
        `SELECT j.* FROM jobs j JOIN projects p ON p.id = j.project_id
         WHERE j.status = 'queued' AND j.run_after <= ? AND p.pipeline_state = 'active'
         ORDER BY j.run_after, j.created_at LIMIT 1`,
      )
      .get(ts);
    if (!row) return null;
    const job = mapJob(row as any);
    const res = ctx.db
      .prepare(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = ?, heartbeat_at = ?, last_error = NULL WHERE id = ? AND status = 'queued'",
      )
      .run(ts, ts, job.id);
    if (Number(res.changes) !== 1) return null;
    const attempt = job.attempts + 1;
    ctx.db
      .prepare('INSERT INTO job_attempts (id, job_id, attempt, started_at) VALUES (?, ?, ?, ?)')
      .run(uid(), job.id, attempt, ts);
    emit(ctx, {
      projectId: job.projectId,
      type: 'job.started',
      actor: WORKER,
      message: `התחילה הרצה: ${JOB_LABELS[job.type]} (ניסיון ${attempt}/${job.maxAttempts})`,
      payload: { jobId: job.id, jobType: job.type, attempt },
    });
    return getJob(ctx.db, job.id);
  });
}

function closeAttempt(ctx: Ctx, job: Job, ok: boolean, error: string | null) {
  ctx.db
    .prepare('UPDATE job_attempts SET finished_at = ?, ok = ?, error = ? WHERE job_id = ? AND attempt = ?')
    .run(ctx.now().toISOString(), ok ? 1 : 0, error, job.id, job.attempts);
}

/** מטפל בכישלון: Retry אם אפשר, אחרת failed (הפרויקט יוצג כחסום בשלב המתאים). */
export function failJob(ctx: Ctx, job: Job, err: unknown, handlers: Record<JobType, JobHandler<any>> = HANDLERS) {
  const message = err instanceof Error ? err.message : String(err);
  const retryable = isRetryable(err);
  tx(ctx.db, () => {
    const cur = getJob(ctx.db, job.id);
    if (!cur || cur.status !== 'running') return; // בוטלה בינתיים
    closeAttempt(ctx, cur, false, message);
    if (retryable && cur.attempts < cur.maxAttempts) {
      const delay = backoffSeconds(ctx, cur.attempts);
      const runAfter = new Date(ctx.now().getTime() + delay * 1000).toISOString();
      ctx.db
        .prepare("UPDATE jobs SET status = 'queued', run_after = ?, last_error = ?, heartbeat_at = NULL WHERE id = ?")
        .run(runAfter, message, cur.id);
      emit(ctx, {
        projectId: cur.projectId,
        type: 'job.retry_scheduled',
        actor: WORKER,
        message: `ניסיון ${cur.attempts} נכשל (${message}). ניסיון חוזר בעוד ${delay} שניות.`,
        payload: { jobId: cur.id, jobType: cur.type, attempt: cur.attempts, error: message, runAfter },
      });
    } else {
      ctx.db
        .prepare("UPDATE jobs SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?")
        .run(ctx.now().toISOString(), message, cur.id);
      handlers[cur.type]?.onFinalFail?.(ctx, cur, err);
      emit(ctx, {
        projectId: cur.projectId,
        type: 'job.failed',
        actor: WORKER,
        message: `${JOB_LABELS[cur.type]} נכשלה${retryable ? ` אחרי ${cur.attempts} ניסיונות` : ''}: ${message}`,
        payload: { jobId: cur.id, jobType: cur.type, error: message, retryable },
      });
    }
  });
}

async function execute(ctx: Ctx, job: Job, handlers: Record<JobType, JobHandler<any>>) {
  const handler = handlers[job.type];
  // דופק: משימות ארוכות (וידאו) לא ייחשבו תקועות כל עוד התהליך חי
  const beat = setInterval(() => {
    try {
      ctx.db.prepare("UPDATE jobs SET heartbeat_at = ? WHERE id = ? AND status = 'running'").run(ctx.now().toISOString(), job.id);
    } catch {
      /* ignore */
    }
  }, 30_000);
  try {
    if (!handler) throw new GateError(`אין מטפל למשימה ${job.type}`);
    const result = await handler.run(ctx, job);
    tx(ctx.db, () => {
      const cur = getJob(ctx.db, job.id);
      if (!cur || cur.status !== 'running') {
        emit(ctx, {
          projectId: job.projectId,
          type: 'job.result_discarded',
          actor: WORKER,
          message: `תוצאת ${JOB_LABELS[job.type]} לא נשמרה — המשימה בוטלה בזמן הריצה`,
          payload: { jobId: job.id },
        });
        return;
      }
      const out = handler.persist(ctx, cur, result);
      ctx.db
        .prepare("UPDATE jobs SET status = 'succeeded', finished_at = ?, result = ?, last_error = NULL WHERE id = ?")
        .run(ctx.now().toISOString(), json(out), cur.id);
      closeAttempt(ctx, cur, true, null);
      emit(ctx, {
        projectId: cur.projectId,
        type: 'job.succeeded',
        actor: WORKER,
        message: `הושלמה: ${JOB_LABELS[cur.type]}`,
        payload: { jobId: cur.id, jobType: cur.type, result: out },
      });
    });
  } catch (err) {
    failJob(ctx, job, err, handlers);
  } finally {
    clearInterval(beat);
  }
}

/** מריץ משימה אחת אם קיימת. מחזיר true אם רצה משימה. */
export async function runOnce(ctx: Ctx, handlers = HANDLERS): Promise<boolean> {
  const job = claimNext(ctx);
  if (!job) return false;
  await execute(ctx, job, handlers);
  return true;
}

/** מריץ עד שהתור ריק (לבדיקות / הרצה ידנית). */
export async function drain(ctx: Ctx, handlers = HANDLERS, max = 50) {
  let n = 0;
  while (n < max && (await runOnce(ctx, handlers))) n++;
  return n;
}

/** משימות running שלא דיווחו heartbeat מעבר לסף — נחשבות תקועות. */
export function recoverStuckJobs(ctx: Ctx, opts: { all?: boolean } = {}) {
  const threshold = new Date(ctx.now().getTime() - ctx.config.jobs.stuckMinutes * 60_000).toISOString();
  const rows = opts.all
    ? ctx.db.prepare("SELECT * FROM jobs WHERE status = 'running'").all()
    : ctx.db.prepare("SELECT * FROM jobs WHERE status = 'running' AND heartbeat_at < ?").all(threshold);
  for (const r of rows) {
    const job = mapJob(r as any);
    failJob(
      ctx,
      job,
      new ProviderError(
        opts.all ? 'השרת הופעל מחדש באמצע הריצה' : `המשימה תקועה מעל ${ctx.config.jobs.stuckMinutes} דקות`,
        true,
        'stuck',
      ),
    );
  }
  return rows.length;
}

/** פרויקט פעיל ללא אירוע התקדמות במשך X ימים — נרשם חסם "תקוע". */
export function detectStalledProjects(ctx: Ctx, isCompleted: (projectId: string) => boolean) {
  const limitMs = ctx.config.stalledProjectDays * 86_400_000;
  let count = 0;
  for (const p of listProjects(ctx.db)) {
    if (p.pipelineState !== 'active' || isCompleted(p.id)) continue;
    const last = lastEventAt(ctx.db, p.id) ?? p.createdAt;
    if (ctx.now().getTime() - new Date(last).getTime() < limitMs) continue;
    const key = `stalled:${p.id}:${last}`;
    const reason = `אין התקדמות מאז ${new Date(last).toLocaleDateString('he-IL')}`;
    const res = ctx.db
      .prepare(
        "INSERT OR IGNORE INTO blockers (id, project_id, stage, reason, source, dedupe_key, created_at) VALUES (?, ?, 'brief', ?, 'stalled', ?, ?)",
      )
      .run(uid(), p.id, reason, key, ctx.now().toISOString());
    if (Number(res.changes) > 0) {
      count++;
      emit(ctx, {
        projectId: p.id,
        type: 'project.stalled',
        actor: WORKER,
        message: reason,
        payload: { reason, blockerKey: key },
      });
    }
  }
  return count;
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

/** לולאת Worker בתהליך השרת. */
export function startWorker(ctx: Ctx, isCompleted: (projectId: string) => boolean): WorkerHandle {
  recoverStuckJobs(ctx, { all: true });
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  let lastMaintenance = 0;

  // כמה משימות במקביל (יצירת תמונות/וידאו לכמה שוטים בבת אחת)
  const inFlight = new Set<Promise<void>>();
  const loop = async () => {
    while (!stopped) {
      try {
        if (Date.now() - lastMaintenance > 60_000) {
          lastMaintenance = Date.now();
          recoverStuckJobs(ctx);
          detectStalledProjects(ctx, isCompleted);
          checkForgottenTimer(ctx);
        }
        let claimed = false;
        while (inFlight.size < Math.max(1, ctx.config.jobs.concurrency)) {
          const job = claimNext(ctx);
          if (!job) break;
          claimed = true;
          const p: Promise<void> = execute(ctx, job, HANDLERS).finally(() => inFlight.delete(p));
          inFlight.add(p);
        }
        if (!claimed) await new Promise((r) => setTimeout(r, ctx.config.jobs.pollMs));
      } catch (err) {
        console.error('[worker] loop error', err);
        await new Promise((r) => setTimeout(r, ctx.config.jobs.pollMs));
      }
    }
    await Promise.allSettled([...inFlight]);
  };
  running = loop();
  return {
    async stop() {
      stopped = true;
      await running;
    },
  };
}
