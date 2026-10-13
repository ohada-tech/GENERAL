/**
 * תור משימות עמיד (SQLite). מניעת כפילויות בשתי שכבות:
 * 1. idempotency_key ייחודי — אותו Event לא יכול ליצור את אותה משימה פעמיים.
 * 2. לא נוצרת משימה מאותו סוג לפרויקט כשכבר יש אחת פעילה (queued/running).
 */
import { JOB_LABELS, type Job, type JobType } from '@apos/shared';
import type { Ctx } from '../context.js';
import { json, uid } from '../db/db.js';
import { getJob, mapJob } from '../db/repo.js';
import { emit } from './events.js';

export interface EnqueueInput {
  projectId: string;
  type: JobType;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  triggeredBy?: string;
  actor: string;
}

export interface EnqueueResult {
  job: Job;
  created: boolean;
  reason?: 'duplicate_key' | 'already_active';
}

export function enqueueJob(ctx: Ctx, input: EnqueueInput): EnqueueResult {
  const existingByKey = ctx.db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(input.idempotencyKey);
  if (existingByKey) return { job: mapJob(existingByKey as any), created: false, reason: 'duplicate_key' };

  const active = ctx.db
    .prepare(
      "SELECT * FROM jobs WHERE project_id = ? AND type = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
    )
    .get(input.projectId, input.type);
  if (active) return { job: mapJob(active as any), created: false, reason: 'already_active' };

  const id = uid();
  const ts = ctx.now().toISOString();
  ctx.db
    .prepare(
      `INSERT INTO jobs (id, project_id, type, status, mode, payload, max_attempts, idempotency_key, triggered_by, run_after, created_at)
       VALUES (?, ?, ?, 'queued', 'automatic', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.type,
      json(input.payload ?? {}),
      ctx.config.jobs.maxAttempts,
      input.idempotencyKey,
      input.triggeredBy ?? null,
      ts,
      ts,
    );
  emit(ctx, {
    projectId: input.projectId,
    type: 'job.queued',
    actor: input.actor,
    message: `משימה נוספה לתור: ${JOB_LABELS[input.type]}`,
    payload: { jobId: id, jobType: input.type },
  });
  return { job: getJob(ctx.db, id)!, created: true };
}
